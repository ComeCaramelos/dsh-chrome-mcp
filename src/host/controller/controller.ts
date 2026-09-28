/**
 * Host half — live state: `createChromeMcpController`.
 *
 * One controller per apply(): the composition base layer (`entry`), the live
 * resolved settings source, the nested bridge, the serialized executable runs,
 * and the two capture paths — bridge log lines and tool-call results. Every
 * base-layer mutation happens here; settings commits route in through the
 * controller methods, never the other way round.
 *
 * The executable state follows the reference plugin's picker shape and the rule
 * that there is no auto mode: the saved **rows** (`{ id: path, name: label }`)
 * are what the card's dropdown lists, the *selection* is what the bridge
 * launches with, and a run refreshes both — it probes every candidate the rows
 * and the row config carry, merges what it finds into the rows (names kept), and
 * seeds a never-configured host exactly once. A fixed path that later breaks
 * stays fixed and reads broken instead of being re-resolved.
 *
 * This file is only the assembly: it resolves the config-derived pieces, builds
 * the base layer, makes the initial bridge connection, and wires the public
 * methods to the behavior modules that sit alongside it (see ./index.ts for the
 * layout). Everything that actually *does* something lives there, not here.
 */
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

import { bridgeConfig, captureLogger } from "../bridge.js";
import { DEFAULT_EXTRA_FLAGS, FLAGS_ENV_VAR, WSL_EXTRA_FLAGS, WSL_WINDOWS_LAUNCH_ERROR } from "../constants.js";
import { extractExecutablePathFlag, flagsSkipCheck, stripExecutablePathFlags } from "../flags.js";
import { isWindowsExecutablePath, isWindowsSubsystemForLinux } from "../platform.js";
import { runWindowsChromeConnect, type WindowsChromeRunOptions } from "../windows/index.js";
import { readPersistedChromePath, readPersistedFlags, readPersistedStderrMode, resolveEnvFlags, resolveStderrMode } from "../values.js";
import type {
    BridgeStderrMode,
    ChromeMcpConfig,
    EffectiveChromeSource,
    PluginContext,
    SettingsResolved,
    WindowsChromeRun
} from "../types/index.js";

import { configForBridge } from "./bridge-run.js";
import { noteBridgeLog, registerToolCapture } from "./captures.js";
import { onSettingsChange } from "./commits.js";
import { noteSelection, noteStderr } from "./notes.js";
import { prelaunchWindowsChrome, queue } from "./runs.js";
import type { Controller, ControllerState } from "./state.js";

/** The live state one apply() keeps in memory. */
export interface ChromeMcpController {
    /** The composition base layer served alongside the user layer. */
    readonly entry: SettingsResolved;
    /** Swap the live resolved settings source (installSection hook). */
    setSource(next: () => SettingsResolved): void;
    /** Route one settings commit: relaunch on flag or executable drift, and run
     * one executable refresh on the search trigger. */
    onSettingsChange(): void;
    /** Run one executable refresh (probe the candidates, merge what is found
     * into the saved rows, seed a never-configured host). Runs are serialized so
     * rapid actions never interleave. */
    run(): Promise<unknown>;
    /** Run the Windows Chrome path once (locate, prereq, port, launch, connect)
     * on the same one-run-at-a-time chain the button drives through, and answer
     * with what the run stated. This is the MCP-tool surface of the button: the
     * trigger is the call itself — nothing is persisted, so a booting host never
     * launches a browser on its own. Resolves after the run settles. */
    prelaunchWindowsChrome(): Promise<string>;
}

/**
 * Optional overrides for tests and diagnostics: the Windows Chrome run is the
 * only half that reaches outside the process (it opens TCP sockets and spawns
 * through the interop mount), so a wiring test replaces just this one — the same
 * injectability rule every other platform half follows.
 */
export type ChromeMcpControllerDeps = {
    runWindowsChrome?: (options: WindowsChromeRunOptions) => Promise<WindowsChromeRun>;
};

/**
 * Build the live state for one bridge + card pairing.
 * @param ctx - plugin context.
 * @param config - validated row config.
 * @param deps - optional host overrides (tests replace the Windows run;
 * everything else resolves from this process).
 */
export function createChromeMcpController(ctx: PluginContext, config: ChromeMcpConfig, deps: ChromeMcpControllerDeps = {}): ChromeMcpController {
    // The Windows run half — injectable for wiring tests, default is the real
    // one (TCP samples + the interop launch).
    const windowsChrome = typeof deps.runWindowsChrome === "function" ? deps.runWindowsChrome : runWindowsChromeConnect;
    const launchEnvironment = launchEnvironmentOf(ctx);
    const envValue = launchEnvironment.get(FLAGS_ENV_VAR)?.value;
    // Where the plugin runs: a WSL host plus a Windows executable is a selection
    // the bridge can never launch (its debug pipes do not cross the interop
    // boundary, and its debugging port stays on the Windows loopback). The launch
    // environment is authoritative inside a host, so the answer is deterministic;
    // a bare call falls back to the interop marker.
    const wslHost = isWindowsSubsystemForLinux({ env: (name) => launchEnvironment.get(name)?.value });

    // A path this host must never exec. There is only one: a Windows
    // `chrome.exe` selected on a WSL host. Its `--version` probe answers (so the
    // selection looks healthy) but answering attaches to the Windows browser
    // session, and that **starts a browser instance** no tool call could drive —
    // see WSL_WINDOWS_LAUNCH_ERROR. The run keeps such an entry visible carrying
    // this reason; the probe answers nothing instead of paying for it.
    const blockedForPlatform = (candidate: string): string =>
        wslHost && isWindowsExecutablePath(candidate) ? WSL_WINDOWS_LAUNCH_ERROR : "";

    // A row-level `--executablePath` used to be the only way to pin an
    // executable. The picker owns it now, so the flag is read out of the row
    // flags here — it becomes the row-config source of the selection, and the
    // flag itself never reaches argv as a second source of truth.
    const rowChromePath = config.chromePath.trim() !== "" ? config.chromePath.trim() : extractExecutablePathFlag(config.extraFlags);
    const rowFlags = stripExecutablePathFlags(config.extraFlags);
    if (rowChromePath !== "" && config.chromePath.trim() === "" && extractExecutablePathFlag(config.extraFlags) !== "") {
        ctx.logger.warn(
            `chrome-devtools-mcp(${config.serverName}): an extraFlags "--executablePath" in the row config is now the \`chromePath\` source ("${rowChromePath}"); the flag itself is dropped from the bridge argv`
        );
    }

    const baseFlags = resolveEnvFlags(rowFlags, envValue);
    if (typeof envValue === "string" && envValue.trim() !== "" && baseFlags === rowFlags) {
        ctx.logger.warn(`chrome-devtools-mcp(${config.serverName}): ignoring ${FLAGS_ENV_VAR} — invalid flags list; using row config`);
    }
    // The persisted UI selection wins over env/row config: seed the first bridge
    // spawn with it. When the settings service is not up yet this yields the base
    // flags, and the installSection initial onChange below switches the bridge to
    // the persisted selection in place right after.
    const initialFlags = readPersistedFlags(ctx) ?? baseFlags;

    // The initial selection: persisted `chromePath` → row config → nothing.
    // Nothing here consults discovery: the first run does, and only seeds if both
    // layers are silent.
    const persistedChromePath = readPersistedChromePath(ctx);
    const runningChromePath = persistedChromePath !== "" ? persistedChromePath : rowChromePath;
    const runningChromeSource: EffectiveChromeSource = persistedChromePath !== "" ? "selected" : rowChromePath !== "" ? "row-config" : "";

    // The effective bridge stderr mode: the persisted UI toggle when set, else the
    // row-config `bridgeStderr`. Every spawn reads it, and a UI write hot-switches
    // it (restarting the connection).
    const runningStderrMode: BridgeStderrMode = resolveStderrMode(readPersistedStderrMode(ctx), config.bridgeStderr);

    // Composition base layer: part of the resolved value served to the client but
    // never persisted. See ./types/index.ts (SettingsBaseLayer) for the whole
    // shape; the static `defaultExtraFlags`/`wslExtraFlags` mirrors feed the card's
    // Restore defaults / Flags WSL actions, and `windowsChromeStatus` reads off
    // this host from the start (the Windows path simply does not exist off WSL).
    const entry: SettingsResolved = {
        extraFlags: initialFlags,
        refreshExecutablesNonce: 0,
        openWindowsChromeNonce: 0,
        chromePath: "",
        executables: [],
        chromeCustomPaths: [],
        stderrMode: "",
        lastError: "",
        chromeMissing: false,
        executableDiscoveryRevision: 0,
        chromeVersion: "",
        executableStatus: [],
        effectiveChromePath: runningChromePath,
        effectiveSource: runningChromeSource,
        wslWindowsExecutable: wslHost && isWindowsExecutablePath(runningChromePath),
        rowStderr: config.bridgeStderr === "console" ? "console" : "log",
        defaultExtraFlags: [...DEFAULT_EXTRA_FLAGS],
        wslExtraFlags: [...WSL_EXTRA_FLAGS],
        windowsChromeStatus: { state: wslHost ? "off" : "not-applicable", port: 0, error: "" },
        carriesConnectionMode: flagsSkipCheck(initialFlags)
    };

    const state: ControllerState = {
        entry,
        source: () => entry,
        runningFlags: initialFlags,
        runningStderrMode,
        runningChromePath,
        runningChromeSource,
        runningExecutables: [],
        stderrNotice: "",
        lastRefreshNonce: void 0,
        lastWindowsNonce: void 0,
        seededPath: "",
        seenUserSelection: false,
        runs: Promise.resolve(),
        wslNoticeShown: false,
        profileLinkKeptShown: false,
        legacyPathsMerged: false
    };
    const controller: Controller = {
        ctx,
        config,
        wslHost,
        blockedForPlatform,
        rowChromePath,
        rowFlags,
        windowsChrome,
        bridge: undefined as unknown as Controller["bridge"],
        state
    };

    // Initial connection with the resolved flags + the resolved selection. The
    // bridge-log capture rides only on the bridge scope: our own logs bypass it,
    // so our own warns never masquerade as connection errors.
    const bridgeScope = ctx.extend({ logger: captureLogger(ctx.logger as unknown as Record<string, (...args: unknown[]) => unknown>, (level, args) => noteBridgeLog(controller, level, args)) });
    const initial = bridgeConfig(configForBridge(controller, initialFlags), initialFlags, runningStderrMode);
    noteStderr(controller, initial);
    controller.bridge = bridgeScope.plugin(McpClient, initial.config) as Controller["bridge"];
    noteSelection(controller);

    // Tool-level status: browser-level failures are returned to the calling agent
    // and never reach the bridge logger.
    registerToolCapture(controller);

    return {
        entry,
        setSource: (next) => {
            state.source = next;
        },
        run: () => queue(controller, "refresh"),
        prelaunchWindowsChrome: () => prelaunchWindowsChrome(controller),
        onSettingsChange: () => onSettingsChange(controller)
    };
}
