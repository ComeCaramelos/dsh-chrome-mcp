/**
 * Controller internals — the live state + the context every controller method
 * reads.
 *
 * The public half (`createChromeMcpController`, `ChromeMcpController`,
 * `ChromeMcpControllerDeps`) lives in ./controller.ts; the behavior it wires
 * together is split across the sibling modules here (`notes`, `connections`,
 * `runs`, `windows-run`, `persist`, `captures`, `commits`). This file names the
 * state those helpers share — every live answer targets `state.live` and reaches
 * the card through `publishLive`, every layer read goes through `state.source`,
 * and the immutable context pieces a method needs to act on (the row config, the
 * WSL answer, the injected Windows run, the manager's connection service) sit
 * alongside it. Nothing here is part of the public surface.
 */
import type {
    BridgeStderrMode,
    ChromeMcpConfig,
    ChromeExecutableEntry,
    ConfigLayers,
    ConfigLiveFields,
    ChromeMcpForm,
    EffectiveChromeSource,
    PluginContext,
    WindowsChromeRun
} from "../types/index.js";
import type { WindowsChromeRunOptions } from "../windows/index.js";
import type { LiveMirror } from "@comecaramelos/dsh-ancesters/host";
import type { McpConnectionsService } from "@comecaramelos/dsh-mcp-manager/api";
import type { RunningAnswers } from "./connections.js";

/** The live state one controller instance owns and mutates. */
export interface ControllerState {
    /** The live mirror — what every Host answer carries, published through the
     * volatile references on every change batch, never persisted. */
    live: ConfigLiveFields;
    /** The configuration form once it is attached (undefined until the settings
     * service resolves and the row's entry id is known). */
    form: ChromeMcpForm | undefined;
    /** Read the form's layers (the user layer over the row config). Swapped when
     * the form attaches; before that the references answer alone. */
    source: () => ConfigLayers;
    /** Flags the default answers run with — what a connection with no own
     * `extra` answer is answered with. Mirrored from the last resolve, so what
     * the machine page states is what is running, not what was last configured. */
    runningFlags: string[];
    /** Effective console-output mode of the default answer ("log"/"console"). */
    runningStderrMode: BridgeStderrMode;
    /** Executable the default answer launches with. */
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
    /**
     * One bounded retry of a FAILED executable run. The run chain answers once
     * per queue and never re-tries on its own — a host that answers empty (the
     * shape a WSL boot takes while the interop mount is not served yet) would
     * read "not found" until someone pressed Fetch. So a failing run arms
     * **one** retry behind `DISCOVERY_RETRY_DELAY_MS`, capped across the
     * instance at `DISCOVERY_RETRY_MAX`, and any run that no longer stands
     * failed resets the count. Cancelled when the instance is disposed.
     */
    retryTimer: NodeJS.Timeout | undefined;
    /** Consecutive scheduled retries after failed runs; reset on a non-failed
     * run. */
    retriesPending: number;
    /** Set once this instance is disposed: a late retry answer must not fire
     * runs for an instance that no longer exists. */
    disposed: boolean;
    /** Whether the WSL + Windows-executable warning has been logged already. */
    wslNoticeShown: boolean;
    /** Whether the workspace `.chrome` view "kept" notice has been logged. */
    profileLinkKeptShown: boolean;
    /** Whether the legacy hand-typed MRU has been folded into the rows already. */
    legacyPathsMerged: boolean;
    /** Whether the row config's legacy `--executablePath` fold has been announced
     * already (one warn line, however often the layers churn). */
    legacyPinAnnounced: boolean;
    /** The live mirror (ancestros' `createLiveMirror`), stood up on the first
     * publish. */
    mirror: LiveMirror | undefined;
    /** Set while one coalesced "kinds changed" notice is already queued. */
    kindsNotifyQueued: boolean;
    /** The manager's `mcpConnections` service while the manager runs it (see
     * ../manager.ts). Undefined when no manager stands behind this row — the
     * component then answers the row's own page and starts nothing. */
    connections: McpConnectionsService | undefined;
    /** Says "what a picker would answer just moved" (./../manager.ts installs
     * the real half); a no-op until then. */
    notifyKindsChanged: () => void;
}

/** Everything a controller method needs: the immutable context + the state.
 * `ChromeMcpController` is this same type — the public surface is the object
 * itself, and every consumer (the form, the commands, the kinds) works through
 * one and the same instance. */
export interface Controller {
    ctx: PluginContext;
    /** The config `apply` validated. Every `.volatile()` field here is a
     * reference, not a value — read them through `readConfigField`. */
    config: ChromeMcpConfig;
    /** True on a WSL host (where the Windows run is the only working path). */
    wslHost: boolean;
    /** True on a Linux host. The candidate list models the stable-channel
     * installs a Linux host carries, so the executable-missing answer's advice
     * keys on this (see `runs.ts`); WSL is the case with the Windows-side
     * alternative next to it. */
    linuxHost: boolean;
    /** A path this host must never exec (a Windows binary under WSL). */
    blockedForPlatform: (candidate: string) => string;
    /** The `DSH_CHROME_MCP_FLAGS` answer from the launch environment (anything
     * the caller did not supply is "no answer"). */
    launchFlags: unknown;
    /** The Windows run half — injected by tests, the real one otherwise. */
    windowsChrome: (options: WindowsChromeRunOptions) => Promise<WindowsChromeRun>;
    /** The Windows-side executables this host carries, in preference order and
     * in their Windows spelling — located through the interop mount, `[]` off
     * WSL. A run folds them into its candidate list (they are never probed: a
     * Windows binary answers `note`, never a version) so the picker can name the
     * executable a run drives instead of hiding it. */
    windowsExecutables: () => string[];
    /** The live mutable state. */
    state: ControllerState;
    /** Bind the configuration form to this controller (the first call also serves
     * as the mount's first read, so the registration run fires off the first
     * commit's nonce diffs instead of being called separately). */
    attachForm(form: ChromeMcpForm): void;
    /** Drop the form again — the references stand in for the layers until it
     * returns. */
    detachForm(): void;
    /** Route one configuration-form commit: re-derive the default answers, and
     * run one executable refresh on the fetch trigger. */
    onFormCommit(): void;
    /** Run one executable refresh (probe the candidates, merge what is found
     * into the saved rows, seed a never-configured host) and re-probe the
     * selection — the whole fetch the card's **Fetch executables** fires. Runs
     * are serialized so rapid actions never interleave. */
    run(): Promise<unknown>;
    /** Read the configuration form's live layers — the same read every commit
     * and every run makes (the references, plus the described row once it
     * exists). A headless surface (the slash commands) reads the saved rows
     * through it. */
    source(): ConfigLayers;
    /** The live mirror — every answer the Host has standing. Headless surfaces
     * (the slash commands) read their answers off it and write nothing to it:
     * answers belong to the controller's own modules. */
    readonly live: ConfigLiveFields;
    /** Write one executable selection through the Host write-back channel — the
     * same persisted `chromePath` field the card's picker writes — and re-fire
     * the run behind it. `""` clears the user layer back to the row config. */
    selectChromePath(path: string): Promise<void>;
    /** Run the Windows Chrome path once (locate, prereq, port, launch, wait for
     * the bind) on the same one-run-at-a-time chain the button drives through,
     * and answer with what the run stated. */
    prelaunchWindowsChrome(): Promise<string>;
    /** Mirror what one live connection answered it runs with (./connections.ts).
     * Every kind `resolve` ends with this. */
    noteRunning(entry: { id: string }, answers: RunningAnswers): void;
    /** Drive the prelaunch machinery once for a live `chrome-windows`
     * connection's async `resolve`. */
    prelaunchForConnection(): Promise<WindowsChromeRun>;
    /** Mark the standalone-config translation dismissed (./../migration.ts
     * D4): the row's `migrationDismissed` flips true so the offer stops. */
    dismissMigration(): void;
    /** Stand this instance down: nothing late (the bounded retry behind a failed
     * run most of all) may fire runs for an instance that no longer exists. A
     * hot re-apply disposes the prior instance this way. */
    dispose(): void;
}
