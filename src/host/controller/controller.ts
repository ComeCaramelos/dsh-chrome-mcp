/**
 * Host half — live state: `createChromeMcpController`.
 *
 * One controller per apply(): the live mirror the Host publishes, the serialized
 * executable runs, the Windows run half, and the capture paths — tool-call
 * results reaching the live mirror. Every live answer is written into
 * `state.live` and published through the volatile references (see ./publish.ts);
 * form commits route in through the controller methods, never the other way
 * round.
 *
 * Since the component model, the controller starts nothing: every live bridge is
 * a connection of the manager's, answered through ./kind.ts. What this half owns
 * is the machine — the executable catalog and its runs, the Windows run, the
 * layers, and the mirror — plus the seam the manager reads it through (the
 * connection service sits on `state.connections`, installed by ../manager.ts).
 *
 * The executable state keeps the rule that there is no auto mode: the saved
 * **rows** (`{ id: path, name: label }`) are what every picker lists, the
 * *selection* is what the default answers run with, and a run refreshes both —
 * it probes every candidate the rows and the row config carry, merges what it
 * finds into the rows (names kept), and seeds a never-configured host exactly
 * once. A fixed path that later breaks stays fixed and reads broken instead of
 * being re-resolved.
 *
 * This file is only the assembly: it resolves the config-derived pieces, seeds
 * the live mirror, and wires the public methods to the behavior modules that sit
 * alongside it (see ./index.ts for the layout). Everything that actually *does*
 * something lives there, not here.
 */
import { existsSync } from "node:fs";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

import { FLAGS_ENV_VAR, WSL_WINDOWS_LAUNCH_ERROR } from "../constants.js";
import { flagsSkipCheck } from "../flags.js";
import { isWindowsExecutablePath, isWindowsSubsystemForLinux } from "../platform.js";
import { findWindowsChromeExecutables, runWindowsChromeConnect, type WindowsChromeRunOptions } from "../windows/index.js";
import {
    createLiveMirror,
    readConfigForm,
    readConfigLayers,
    readDefaultExtraFlags,
    readWslExtraFlags,
    resolveEnvFlags,
    resolveLaunchFlags,
    resolveSelection,
    resolveStderrModeFromLayers
} from "../values.js";
import type {
    ChromeMcpConfig,
    EffectiveChromeSource,
    PluginContext,
    WindowsChromeRun
} from "../types/index.js";

import { registerToolCapture } from "./captures.js";
import { noteRunning as mirrorRunning } from "./connections.js";
import { onFormCommit } from "./commits.js";
import { noteSelection } from "./notes.js";
import { dismissMigration, } from "./persist.js";
import { publishLive } from "./publish.js";
import { cancelDiscoveryRetry, prelaunchWindowsChrome, queue, selectChromePath } from "./runs.js";
import { prelaunchWindowsForConnection } from "./windows-run.js";
import type { Controller, ControllerState } from "./state.js";

/** Public alias: the controller object the form, commands and kinds work
 * through is the internal `Controller` type itself. */
export type ChromeMcpController = Controller;

/**
 * Optional overrides for tests and diagnostics: the Windows Chrome run is the
 * only half that reaches outside the process (it opens TCP sockets and spawns
 * through the interop mount), so a wiring test replaces just this one — the same
 * injectability rule every other platform half follows.
 */
export type ChromeMcpControllerDeps = {
    runWindowsChrome?: (options: WindowsChromeRunOptions) => Promise<WindowsChromeRun>;
    /** The Windows-side executables this host carries, in preference order. The
     * machine half of the candidate fold — the real one locates through the
     * interop mount; a test supplies the answer list it wants folded. */
    windowsExecutables?: () => string[];
    /** The platform the WSL probe reads; defaults to `process.platform`. A test
     * that simulates a WSL host through its launch environment states `linux`
     * here too — the environment alone never makes a Windows host WSL. */
    platform?: NodeJS.Platform;
};

/**
 * Build the live state for one row page. The controller is also the public
 * surface (`ChromeMcpController` — the same object the form, the commands and
 * the kinds work through); what each method does lives in the sibling modules.
 * @param ctx - plugin context.
 * @param config - the validated config `apply` received: every `.volatile()`
 * field a reference rather than a value (read them through `readConfigField`).
 * @param deps - optional host overrides (tests replace the Windows run;
 * everything else resolves from this process).
 */
export function createChromeMcpController(ctx: PluginContext, config: ChromeMcpConfig, deps: ChromeMcpControllerDeps = {}): Controller {
    // The Windows run half — injectable for tests, default is the real one (TCP
    // samples + the interop launch).
    const windowsChrome = typeof deps.runWindowsChrome === "function" ? deps.runWindowsChrome : runWindowsChromeConnect;
    const launchEnvironment = launchEnvironmentOf(ctx);
    const launchFlags = launchEnvironment.get(FLAGS_ENV_VAR)?.value;
    // Where the plugin runs: a WSL host plus a Windows executable is a selection
    // the local bridge can never launch (its debug pipes do not cross the interop
    // boundary, and its debugging port stays on the Windows loopback). The launch
    // environment is authoritative inside a host, so the answer is deterministic;
    // a bare call falls back to the interop marker.
    const wslHost = isWindowsSubsystemForLinux({ platform: deps.platform, env: (name) => launchEnvironment.get(name)?.value });
    // The Linux half of the host: the executable candidate list models the
    // stable-channel installs a Linux host carries, so this is what keys the
    // executable-missing answer's advice (see runs.ts). WSL is the case with the
    // Windows-side alternative next to it.
    const linuxHost = process.platform === "linux";

    // A path this host must never exec. There is only one: a Windows
    // `chrome.exe` selected on a WSL host. Its `--version` probe answers (so the
    // selection looks healthy) but answering attaches to the Windows browser
    // session, and that **starts a browser instance** no tool call could drive —
    // see WSL_WINDOWS_LAUNCH_ERROR. The runs keep such an entry visible carrying
    // this reason; the probe answers nothing instead of paying for it.
    const blockedForPlatform = (candidate: string): string =>
        wslHost && isWindowsExecutablePath(candidate) ? WSL_WINDOWS_LAUNCH_ERROR : "";

    // The Windows-side executables this host carries, located through the interop
    // mount. An executable run folds them into its candidate list so the picker
    // can name the Windows browser the **Prelaunch Windows Chrome** run drives
    // instead of hiding it. Being offered only, they are never spawned (see
    // `blockedForPlatform`): an entry answers a note, never a version, and never
    // seeds. Locating them is the machine half of the fold, injected the same way
    // the run's own `exists` half is — a host off WSL answers nothing, and a
    // machine that carries none of them answers nothing either.
    const windowsExecutables = typeof deps.windowsExecutables === "function"
        ? deps.windowsExecutables
        : (): string[] => (wslHost ? findWindowsChromeExecutables(existsSync) : []);

    // The configuration form's layers as they answer right now. The references
    // resolve the user layer over the row config, so every answer here is the
    // effective one; the two layers the "did the user say this, or is it the row
    // config" distinction reads only answer once the form attaches, and the first
    // commit read settles it.
    const layers = readConfigLayers(config);

    // Default launch flags (highest first): the user layer,
    // `DSH_CHROME_MCP_FLAGS`, the row config, the schema default. What a
    // connection with no own answer is resolved with starts on them.
    const initialFlags = resolveLaunchFlags(layers, launchFlags);
    if (typeof launchFlags === "string" && launchFlags.trim() !== "" && resolveEnvFlags([], launchFlags).length === 0) {
        ctx.logger.warn(`dsh-chrome-mcp(${config.serverName}): ignoring ${FLAGS_ENV_VAR} — invalid flags list; using the resolved configuration`);
    }

    // The initial selection: what the user layer says, else what the row config
    // says (a legacy row-level `--executablePath` folded in — the picker owns that
    // flag, so it becomes the row-config source of the selection and never reaches
    // argv as a second source of truth), else nothing. Nothing here consults
    // discovery: the first run does, and only seeds when both layers are silent.
    const selection = resolveSelection(layers);
    const runningChromePath = selection.path;
    const runningChromeSource: EffectiveChromeSource = selection.source;

    // The effective console-output mode: what the user layer's toggle says, then
    // what the row config carries, then the row's `bridgeStderr`. Every spawn
    // wrapper reads it.
    const runningStderrMode = resolveStderrModeFromLayers(layers, config.bridgeStderr);

    // The mirror's opening answers: what the default answers would run with, not
    // what a host with no answers would serve. `windowsChromeStatus` in particular
    // reads off this host from the start — the Windows path simply does not exist
    // off WSL.
    const live = createLiveMirror();
    live.effectiveChromePath = runningChromePath;
    live.effectiveSource = runningChromeSource;
    live.stderrEffective = runningStderrMode;
    live.wslWindowsExecutable = wslHost && runningChromePath !== "" && isWindowsExecutablePath(runningChromePath);
    live.carriesConnectionMode = flagsSkipCheck(initialFlags);
    live.windowsChromeStatus = { state: wslHost ? "off" : "not-applicable", port: 0, error: "" };
    live.defaultExtraFlags = readDefaultExtraFlags();
    live.wslExtraFlags = readWslExtraFlags();

    const state: ControllerState = {
        live,
        form: void 0,
        // The live layers read: the references answer what runs now, and once the
        // form is described the two layers answer the distinction with it. This is
        // read live on every commit — cordis starts the `settings` injection
        // callback after `apply` returns, so nothing may be captured here.
        source: () => readConfigLayers(config, state.form?.settings ? readConfigForm(state.form.settings, state.form.entryId) : void 0),
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
        retryTimer: void 0,
        retriesPending: 0,
        disposed: false,
        wslNoticeShown: false,
        profileLinkKeptShown: false,
        legacyPathsMerged: false,
        legacyPinAnnounced: false,
        mirror: void 0,
        kindsNotifyQueued: false,
        // The manager seam opens empty: `attachToManager` fills it in once the
        // service answers. A component without the manager answers its own page
        // and starts nothing — exactly as a row with no connections should.
        connections: void 0,
        notifyKindsChanged: () => void 0
    };

    const controller: Controller = {
        ctx,
        config,
        wslHost,
        linuxHost,
        blockedForPlatform,
        launchFlags,
        windowsChrome,
        windowsExecutables,
        state,
        attachForm(form) {
            state.form = form;
            const nowDescribed = form.settings !== void 0;
            // The first attach is the mount's commit read: no nonce has been
            // observed yet, so its nonce diff fires the registration run. The step
            // where the row starts being *described* is routed too, for the one
            // thing the references cannot answer: which layer a value came from.
            // Until it answers there, the launch environment sits above whatever
            // the references carry, so a saved UI edit has to be re-read against
            // the user layer the moment that layer exists.
            const first = !routed;
            const layersArrived = nowDescribed && !described;
            routed = true;
            described = nowDescribed;
            if (!first && !layersArrived) return;
            onFormCommit(controller);
        },
        detachForm() {
            // Only the described row's layers go away: the references keep
            // answering, so nothing else has to be undone.
            state.form = void 0;
            routed = false;
            described = false;
        },
        onFormCommit: () => onFormCommit(controller),
        run: () => queue(controller, "probe"),
        source: () => state.source(),
        // The live mirror, by reference: controller modules write its fields in
        // place, publish reads them off `state.live`, and every other surface
        // (the commands) reads the very same answers out of it.
        get live() {
            return state.live;
        },
        selectChromePath: (path) => selectChromePath(controller, path),
        prelaunchWindowsChrome: () => prelaunchWindowsChrome(controller),
        noteRunning(entry, answers) {
            mirrorRunning(controller, entry.id, answers);
        },
        prelaunchForConnection: () => prelaunchWindowsForConnection(controller),
        dismissMigration: () => dismissMigration(controller),
        dispose: () => {
            // Every late answer stands down: the run chain drains on its own (the
            // chain is per-instance, no shared resource left behind), and the one
            // timer this instance owns is cancelled.
            state.disposed = true;
            cancelDiscoveryRetry(controller);
        }
    };

    // Form routing arrives in two steps — the entry id as soon as this fiber knows
    // its own entry, then the described row once the settings service resolves —
    // and the layers read live off it either way (the two flags above are what
    // mark the difference between "never described" and "described before").
    let routed = false;
    let described = false;

    // Tool-level status: browser-level failures are returned to the calling agent
    // and never reach a line of their own.
    registerToolCapture(controller);

    // Seed the mirror before the first snapshot lands (a card that reads before
    // anything ran still gets the real opening answers, never defaults).
    noteSelection(controller);

    return controller;
}
