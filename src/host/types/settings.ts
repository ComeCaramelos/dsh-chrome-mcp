/**
 * Types — the persisted settings section and its composition layers.
 *
 * What the user edits (and only that persists), the in-memory base layer served
 * alongside it, the resolved value the client card reads, and the `settings`
 * service surface this host half installs the section into. Split out of the
 * single `types.ts`.
 */
import type { BridgeStderrMode } from "./stderr.js";
import type { ChromeExecutableEntry, ChromeExecutableStatus, EffectiveChromeSource } from "./executable.js";
import type { WindowsChromeStatus } from "./windows.js";

/**
 * User-authored settings fields — the only keys that persist.
 */
export type SettingsUserFields = {
    extraFlags: string[];
    /** Written by the card's **Search executables** action: one host run that
     * re-probes the saved rows and folds what it finds back into them. */
    refreshExecutablesNonce: number;
    /** Written by the card's **Prelaunch Windows Chrome** button: one host run that
     * locates the Windows Chrome, proves the mirrored-loopback prereq, launches
     * it with a debugging port and leaves the bridge in connect mode. Same
     * trigger idiom as `refreshExecutablesNonce` — there is no push channel, so
     * an action travels as one write that the host reacts to. */
    openWindowsChromeNonce: number;
    /** The executable the bridge launches with: picked in the picker (a saved
     * row's path), or seeded once by the host; "" = nothing resolved yet. There
     * is no "auto" state to fall back to. */
    chromePath: string;
    /** The saved-executables rows: `{ id: path, name: label }`, the dropdown's
     * catalog (see ./catalog.ts). Persisted, user-authored; a scan merges what it
     * finds into them without dropping a name the user chose. */
    executables: ChromeExecutableEntry[];
    /** **Legacy** MRU of hand-typed executables (oldest drops off past
     * `CUSTOM_PATHS_CAP`). Nothing writes it any more: the saved rows replace it,
     * and a host whose settings still carry it folds its paths into the rows on
     * the first run (see ./catalog.ts). */
    chromeCustomPaths: string[];
    /** The card's "Reduce log output" toggle: "log" captures the bridge's
     * stderr into the log file, "console" echoes it. "" follows the row
     * config `bridgeStderr`. */
    stderrMode: "" | BridgeStderrMode;
};

/**
 * In-memory composition base layer served alongside the user layer.
 */
export type SettingsBaseLayer = {
    lastError: string;
    chromeMissing: boolean;
    /** Completion signal of one executable run (a merged scan, and the probe of
     * what is selected that follows it). The one counter every executable action
     * waits on — the reference plugin names it
     * `executableDiscoveryRevision` for the same job. */
    executableDiscoveryRevision: number;
    /** The `--version` line the selected executable answered with; "" when
     * nothing answered (nothing selected, a connect mode, a blocked path). */
    chromeVersion: string;
    /** Per-row probe status, keyed by path: the version a row answered with, and
     * the failure for a row that is present but not runnable (or blocked). Base
     * layer, never persisted — the *rows* themselves are user-authored and live
     * in the persisted layer. */
    executableStatus: ChromeExecutableStatus[];
    /** Executable the bridge actually launches with; "" when nothing is fixed. */
    effectiveChromePath: string;
    /** Where `effectiveChromePath` came from. */
    effectiveSource: EffectiveChromeSource;
    /** True while the running host is WSL **and** the effective executable is a
     * Windows binary: it cannot be launched across the interop boundary, so the
     * card shows the static notice that spells out the configuration a Windows
     * browser does need. Base layer, never persisted. */
    wslWindowsExecutable: boolean;
    /** Row-config `bridgeStderr` in effect (static base-layer mirror; never
     * persisted) — the fallback when the user `stderrMode` is "". */
    rowStderr: BridgeStderrMode;
    /** The canonical default extra-flags list (static base-layer mirror of
     * `DEFAULT_EXTRA_FLAGS`; never persisted) — what the card's Restore
     * defaults action appends, keeping whatever the user already has. */
    defaultExtraFlags: string[];
    /** The recommended WSL ↔ Windows extra-flags list (static base-layer
     * mirror of `WSL_EXTRA_FLAGS`; never persisted) — what the card's **Flags
     * WSL** action appends, missing entries only, keeping everything the rows
     * already carry. */
    wslExtraFlags: string[];
    /** What the **Prelaunch Windows Chrome** run is doing right now (base layer;
     * never persisted). The whole Windows path lives host-side — locate,
     * prereq, launch, port — so the card renders this one field and carries
     * no list of Windows paths or of reachability rules. */
    windowsChromeStatus: WindowsChromeStatus;
    /** True while the bridge launches with a connect-mode flag
     * (`--browserUrl` / `--wsEndpoint`): there is then no local executable to
     * launch or probe, so the card mutes the picker instead of claiming a
     * local selection the bridge is not running. */
    carriesConnectionMode: boolean;
};

/**
 * Resolved value served to the client card.
 */
export type SettingsResolved = SettingsUserFields & SettingsBaseLayer;

/**
 * Validated settings section as consumed by the validate hook.
 */
export type ValidatedSettings = {
    extraFlags: string[];
    stderrMode: "" | BridgeStderrMode;
    chromePath: string;
    executables: ChromeExecutableEntry[];
};

/** One `settings.mutate` operation: `set` a path, or `unset` it. */
export type SettingsOp =
    | { op: "set"; path: string[]; value?: unknown }
    | { op: "unset"; path: string[] };

/** Surface of the `settings` service as consumed here. */
export interface SettingsService {
    document?: Record<string, Record<string, any> | undefined> | undefined;
    mutate(ns: string, ops: SettingsOp[]): Promise<unknown> | unknown;
    installSection(
        ctx: unknown,
        ns: string,
        schema: unknown,
        base: Partial<SettingsResolved>,
        hooks: {
            setSource?: (source: () => SettingsResolved) => void;
            validate?: (value: SettingsResolved) => void;
            onChange?: () => void;
        }
    ): void;
}
