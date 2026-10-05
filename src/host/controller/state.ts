/**
 * Controller internals — the live state + the context every controller method
 * reads.
 *
 * The public half (`createChromeMcpController`, `ChromeMcpController`,
 * `ChromeMcpControllerDeps`) lives in ./controller.ts; the behavior it wires
 * together is split across the sibling modules here (`notes`, `bridge-run`,
 * `runs`, `windows-run`, `persist`, `captures`, `commits`). This file names the
 * state those helpers share — every base-layer mutation targets `state.entry`,
 * every run reads its source through `state.source`, and the immutable context
 * pieces a method needs to act on (the row config, the WSL answer, the injected
 * Windows run) sit alongside it. Nothing here is part of the public surface.
 */
import type {
    BridgeStderrMode,
    ChromeMcpConfig,
    ChromeExecutableEntry,
    EffectiveChromeSource,
    McpBridge,
    PluginContext,
    SettingsResolved,
    WindowsChromeRun
} from "../types/index.js";
import type { WindowsChromeRunOptions } from "../windows/index.js";

/** The live state one controller instance owns and mutates. */
export interface ControllerState {
    /** The composition base layer served alongside the user layer. */
    entry: SettingsResolved;
    /** The live resolved settings source (swapped by the installSection hook). */
    source: () => SettingsResolved;
    /** Flags the nested bridge currently launches with. */
    runningFlags: string[];
    /** Effective bridge stderr mode ("log"/"console"). */
    runningStderrMode: BridgeStderrMode;
    /** Executable the bridge actually launches with. */
    runningChromePath: string;
    /** Where that executable came from. */
    runningChromeSource: EffectiveChromeSource;
    /** The saved rows the last commit served, already normalized. */
    runningExecutables: ChromeExecutableEntry[];
    /** Last emitted stderr notice key (keeps the announce silent across churn). */
    stderrNotice: string;
    /** Last observed `refreshExecutablesNonce` (undefined until first commit). */
    lastRefreshNonce: number | undefined;
    /** Last observed `openWindowsChromeNonce` (undefined until first commit). */
    lastWindowsNonce: number | undefined;
    /** The executable this host seeded on the first run ("" = nothing). */
    seededPath: string;
    /** Whether the user layer has ever carried a path. */
    seenUserSelection: boolean;
    /** Serializes runs so rapid actions never interleave. */
    runs: Promise<unknown>;
    /** Whether the WSL + Windows-executable warning has been logged already. */
    wslNoticeShown: boolean;
    /** Whether the workspace `.chrome` view "kept" notice has been logged. */
    profileLinkKeptShown: boolean;
    /** Whether the legacy hand-typed MRU has been folded into the rows already. */
    legacyPathsMerged: boolean;
}

/** Everything a controller method needs: the immutable context + the state. */
export interface Controller {
    ctx: PluginContext;
    config: ChromeMcpConfig;
    /** True on a WSL host (where the Windows run is the only working path). */
    wslHost: boolean;
    /** A path this host must never exec (a Windows binary under WSL). */
    blockedForPlatform: (candidate: string) => string;
    /** The row-config executable source ("" = unset). */
    rowChromePath: string;
    /** The row-config extra flags, executable-path flag folded out. */
    rowFlags: string[];
    /** The Windows run half — injected by tests, the real one otherwise. */
    windowsChrome: (options: WindowsChromeRunOptions) => Promise<WindowsChromeRun>;
    /** The nested bridge fiber, driven by every flag/executable/stderr switch. */
    bridge: McpBridge;
    /** The live mutable state. */
    state: ControllerState;
}
