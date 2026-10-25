/**
 * Types — the configuration form's layers, the live mirror, and the settings
 * service surface the Host reads and writes through.
 *
 * Since dsh 0.2.0 there is one `Config` (./../schema.ts) and one form per profile
 * row: the card edits the row's volatile fields, and every live answer the Host
 * has to serve rides the very same references. So there is no separate persisted
 * section and no base layer to publish over — what the Host reads for the fields
 * it edits is one read of the row's two layers, and what it serves is one
 * volatile commit of the mirror.
 */
import type { BridgeStderrMode } from "./stderr.js";
import type { ChromeExecutableEntry, ChromeExecutableStatus, EffectiveChromeSource } from "./executable.js";
import type { WindowsChromeStatus } from "./windows.js";

/**
 * The fields the card edits — the fields the Host persists, and the only ones
 * whose commits the Host routes (a commit touching nothing here changes nothing
 * the bridge runs with).
 */
export type ConfigUserFields = {
    extraFlags: string[];
    /** Written by the card's **Fetch executables** action: one host run that
     * re-probes the saved rows and folds what it finds back into them. */
    refreshExecutablesNonce: number;
    /** Written by the card's **Prelaunch Windows Chrome** button: one host run that
     * locates the Windows Chrome, proves the mirrored-loopback prereq, launches
     * it with a debugging port and leaves the bridge in connect mode. Same
     * trigger idiom as `refreshExecutablesNonce` — an action travels as one write
     * the Host reacts to, never a push channel. */
    openWindowsChromeNonce: number;
    /** The executable the bridge launches with: picked in the picker (a saved
     * row's path), or seeded once by the host; "" = nothing resolved yet. There
     * is no "auto" state to fall back to. */
    chromePath: string;
    /** The saved-executables rows: `{ id: path, name: label }`, the dropdown's
     * catalog (see ./catalog.ts). User-authored; a scan merges what it finds
     * into them without dropping a name the user chose. */
    executables: ChromeExecutableEntry[];
    /** The ids of saved rows the user dropped — Host-authored, never edited by
     * the card, and read by every merge step so a deleted row is never folded
     * back in (see ../controller/runs.ts). */
    droppedExecutables: string[];
    /** **Legacy** MRU of hand-typed executables (oldest drops off past
     * `CUSTOM_PATHS_CAP`). Nothing writes it any more: the saved rows replace it,
     * and a host whose profile still carries it folds its paths into the rows on
     * the first run (see ./catalog.ts). */
    chromeCustomPaths: string[];
    /** The card's "Reduce log output" toggle: "log" captures the bridge's
     * stderr into the log file, "console" echoes it. "" follows the row
     * config `bridgeStderr`. */
    stderrMode: "" | BridgeStderrMode;
};

/**
 * The live mirror: what the Host answers through the same volatile references
 * the card edits, and never persists. Every field here is a volatile field of the
 * single `Config`, published by one commit per change batch.
 */
export type ConfigLiveFields = {
    /** Last check/connection failure, human-readable; "" when healthy. */
    lastError: string;
    /** The last failure was "no Chrome executable detected". */
    chromeMissing: boolean;
    /** Completion signal of one executable run (a merged scan, and the probe of
     * what is selected that follows it). The one counter every executable action
     * waits on. */
    executableDiscoveryRevision: number;
    /** The `--version` line the selected executable answered with; "" when
     * nothing answered (nothing selected, a connect mode, a blocked path). */
    chromeVersion: string;
    /** Per-row probe status, keyed by path. Never persisted — the *rows*
     * themselves are user-authored. */
    executableStatus: ChromeExecutableStatus[];
    /** Executable the bridge actually launches with; "" when nothing is fixed. */
    effectiveChromePath: string;
    /** Where `effectiveChromePath` came from. */
    effectiveSource: EffectiveChromeSource;
    /** The mode the bridge actually routes console output through — what the
     * card's toggle is checked against, so it never reads a phantom state. */
    stderrEffective: BridgeStderrMode;
    /** The canonical default extra-flags list — what the card's Restore defaults
     * action appends, keeping whatever the rows already carry. */
    defaultExtraFlags: string[];
    /** The recommended WSL ↔ Windows extra-flags list — what the card's **Flags
     * WSL** action appends, missing entries only. */
    wslExtraFlags: string[];
    /** True while this Host runs under WSL **and** the effective executable is a
     * Windows binary (see ./platform.ts) — the state the card's notice explains. */
    wslWindowsExecutable: boolean;
    /** What the **Prelaunch Windows Chrome** run is doing right now. The whole
     * Windows path lives host-side, so the card renders this one field and
     * carries no list of Windows paths or reachability rules. */
    windowsChromeStatus: WindowsChromeStatus;
    /** True while the bridge launches with a connect-mode flag
     * (`--browserUrl` / `--wsEndpoint`): there is then no local executable to
     * launch or probe, so the card mutes the picker instead of claiming a local
     * selection the bridge is not running. */
    carriesConnectionMode: boolean;
    /** The flags the live connection actually launches with (mirrored from the
     * last resolve) — what the machine page states as running, not what the
     * layers were last configured with. Empty while nothing resolves. */
    runningFlags: string[];
    /** The note the live connection answered with — where its console output
     * goes, or the debugging URL the Windows run connected to. */
    runningNote: string;
};

/** One layer's answers: a field is absent when that layer said nothing. */
export type ConfigLayerFields = { [K in keyof ConfigUserFields]?: ConfigUserFields[K] };

/**
 * One read of the form: what runs now (the references resolve the user layer over
 * the row config, which is exactly what the bridge launches with) plus the two
 * layers the distinction "did the user edit this, or does the row config say it"
 * reads. Before the form is attached the references answer for both layers, so
 * the first commit settles the distinction.
 */
export type ConfigLayers = {
    value: ConfigUserFields;
    user: ConfigLayerFields;
    base: ConfigLayerFields;
};

/**
 * Surface of the `settings` service (`SettingsForms`) as consumed here. Typed
 * structurally the way `tool.ts` types the tools service: the service lives in
 * the loader's module table, and the Host only reads a described row, writes a
 * patch and turns the generated page off. The patch row is keyed by the
 * **profile entry id**, never by a namespace of the Host's own.
 */
/**
 * One ordered edit a write carries through `mutate`: a `set` names a field with
 * a value; an `unset` returns the field to whatever the row config answers (an
 * unset of a path no layer answers drops out of the stored row entirely — this
 * is exactly how the Host clears its live-only fields back to their row-config
 * answers; see ./values.ts `liveMirrorKeys`).
 */
export type SettingsPathOp = { op: "set"; path: readonly string[]; value: unknown } | { op: "unset"; path: readonly string[] };

export interface SettingsForms {
    describe(options?: unknown): SettingsFormRow[];
    /** Write one user-authored field into the row's own patch layer (the store
     * dsh 0.2.0 uses instead of `settings.yaml`). Never called with a live field. */
    update(entryId: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<unknown> | unknown;
    /** One ordered field edit; every edit addresses a volatile field, and an
     * `unset` falls back to the row-config answer. The Host's write-backs go
     * through this channel, carrying the live-only fields' clear alongside the
     * one user field they write, so a live answer can never ride a write back
     * into the stored layer (see ./values.ts). */
    mutate(entryId: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<unknown> | unknown;
    /** `auto: false` keeps the generated page off while the card owns the row's
     * page. Disposable, and calling it twice for one fiber throws. */
    configure(presentation: { auto?: boolean }, owner?: unknown): () => void;
}

/** One described settings row (dsh-ancesters `readFormRow`), narrowed to what the Host consults. */
export interface SettingsFormRow {
    /** The profile entry id this row is keyed by. */
    ns: string;
    /** Live effective value, Host live commits included. */
    value?: unknown;
    /** Composition base — what the row config carries under the user layer. */
    base?: unknown;
    /** What the profile patch carries (`{}` when it carries nothing). */
    user?: unknown;
}

/** Everything the Host keeps about the form once it attaches. */
export interface ChromeMcpForm {
    /** The row's profile entry id — the key every read and write goes through. */
    entryId: string;
    /** The form service itself (undefined on the cold path, where only the
     * references answer). */
    settings?: SettingsForms;
}
