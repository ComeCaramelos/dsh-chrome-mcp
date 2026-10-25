/**
 * The single zod `Config` of the plugin row.
 *
 * Since dsh 0.2.0 the Web GUI card edits the **row configuration** through the
 * profile's configuration form — there is no separate `settings.yaml` namespace
 * and no base layer to publish state over. So one schema carries everything the
 * card reads and writes, and every field the card touches is declared
 * `.volatile()`: a volatile field is editable through the form without
 * remounting the plugin, its user layer rides the profile patch instead of
 * `settings.yaml`, and a live value the Host commits never reaches the patch
 * (the form write strips the volatile fields out of the stored layer before
 * merging).
 *
 * Ordinary fields (`serverName`, `command`, `package`, `chromePaths`, `env`,
 * `cwd`, `toolCallTimeoutMs`, `maxInstructionBytes`, `failOnStartupError`,
 * `reconnect`, `bridgeStderrLog`) are composition-only: the card reads them, it
 * never edits them, and a form write naming one of them is refused by
 * dsh-settings.
 *
 * Host-resolved fields carry the live value in the reference, so the Host
 * publishes them through the live mirror (dsh-ancesters `createLiveMirror`) — never with the form.
 */
import z from "@deepseek-ai/schemastery";

import {
    CHROME_PATH_PATTERN,
    DEFAULT_EXTRA_FLAGS,
    EFFECTIVE_SOURCE_PATTERN,
    EXTRA_FLAG_PATTERN,
    OPTIONAL_PATH_PATTERN,
    STDERR_MODE_FIELD_PATTERN,
    WINDOWS_CHROME_STATE_PATTERN,
    WSL_EXTRA_FLAGS
} from "./constants.js";
import { defaultChromePaths } from "./discovery/index.js";

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
const Reconnect = z.object({
    enabled: z.boolean().default(true),
    initialDelayMs: z.number().min(1).max(600000).default(500),
    maxDelayMs: z.number().min(1).max(600000).default(30000),
    maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10)
});

/**
 * One saved-executable catalog row: `id` is the path that goes on the wire
 * (`--executablePath=<id>`), `name` the label the user chose for the UI
 * ("" = render the path). User layer.
 */
const ExecutableEntry = z.object({
    id: z.string().default("").pattern(CHROME_PATH_PATTERN),
    name: z.string().default("")
});

/** What one saved row's probe answered with, keyed by its id (`path`): the
 * `--version` line, the failure that makes it not runnable, and the note that
 * explains an executable this host offers without probing (`note` is never a
 * failure — the one case is a Windows executable under WSL, driven by the
 * **Prelaunch Windows Chrome** run). */
const ExecutableStatus = z.object({
    path: z.string().default("").pattern(CHROME_PATH_PATTERN),
    version: z.string().default(""),
    error: z.string().default(""),
    note: z.string().default("")
});

/** The served Windows-Chrome state: what the **Prelaunch Windows Chrome** run is
 * doing, the debugging port it settled on (0 = none) and the failure line. */
const WindowsChromeStatus = z.object({
    state: z.string().pattern(WINDOWS_CHROME_STATE_PATTERN).default("off"),
    port: z.number().default(0),
    error: z.string().default("")
});

/**
 * The plugin row's configuration, and the configuration form the Web GUI card
 * edits. Every `.volatile()` field below is live: a user edit lands in the
 * profile patch and commits without a remount, and the Host's own live answers
 * ride the same references without ever being persisted.
 */
export const Config = z.object({
    serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("chrome"),
    command: z.string().default("npx"),
    package: z.string().min(1).default("chrome-devtools-mcp@latest"),
    /** Flags appended after `npx -y <package>`; the card's last UI edit. The
     * field's own pattern is what refuses them (an entry that carries a control
     * character never resolves, so a write is refused Host-side rather than
     * landing in argv); an executable-pinning flag is rejected by the Host fold
     * because the executable is picked below. */
    extraFlags: z.array(z.string().pattern(EXTRA_FLAG_PATTERN)).default(DEFAULT_EXTRA_FLAGS).volatile(),
    chromePaths: z.array(String).default(defaultChromePaths()),
    env: z.dict(String).default({}),
    cwd: z.string().default(""),
    toolCallTimeoutMs: z.number().default(60000),
    /** Ceiling for the bridge's server instructions (UTF-8 bytes, attribution
     * included); an oversized description rejects the connection. Mirrors
     * `dsh-mcp-client`'s own field and default (32768) — a passthrough for a
     * server whose instructions run longer than the cap. */
    maxInstructionBytes: z.number().step(1).min(1).default(32768),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect,
    /** Bridge console-output routing: "log" (default) redirects the spawned
     * npx child's inherited stderr into a per-spawn log file so its progress
     * / startup lines stay out of the dsh console; "console" inherits it
     * (debug). The card's "Reduce log output" toggle (`stderrMode`) overrides
     * this. See {@link buildBridgeSpawn}. */
    bridgeStderr: z.union([z.const("log"), z.const("console")]).default("log"),
    /** Log path override for "log" mode; "" = auto (see
     * {@link bridgeStderrLogPath}). Absolute paths only. */
    bridgeStderrLog: z.string().default("").pattern(OPTIONAL_PATH_PATTERN),

    // ---- user-authored, form-editable -------------------------------------

    /**
     * The executable the bridge launches with: picked in the picker (a saved
     * row's `id`) or seeded once by the Host's first scan. "" = nothing
     * resolved yet — there is no auto state to fall back to.
     */
    chromePath: z.string().default("").pattern(CHROME_PATH_PATTERN).volatile(),
    /** The picker's saved rows — `{ id: path, name: label }`, user-authored. The
     * Host re-normalizes (trim, dedupe, caps) on every read, and a scan merges
     * what it discovers into them without dropping a name the user chose. */
    executables: z.array(ExecutableEntry).default([]).volatile(),
    /** The ids of saved rows the user dropped. Every run folds what it found
     * back into the rows, and the found list keeps answering a path the user
     * just deleted, so without this record a dropped row stood back up on the
     * very run the deletion queued (measured live 2026-10-12: the (x86)
     * Windows-executable row read as a delete that never landed). Merge steps
     * skip every id standing here; a list write carrying the id again clears
     * it. Host-authored: the card never edits this field. */
    droppedExecutables: z.array(z.string().default("").pattern(CHROME_PATH_PATTERN)).default([]).volatile(),
    /**
     * **Legacy** MRU of hand-typed executables, newest first. The saved rows
     * replace it: a Host whose profile still carries it folds its paths into
     * the rows during the first scan (see ./catalog.ts `mergeEntries`), so the
     * field is read once and never written again.
     */
    chromeCustomPaths: z.array(z.string().default("").pattern(CHROME_PATH_PATTERN)).default([]).volatile(),
    /**
     * The card's "Reduce log output" toggle: "log" captures the bridge's
     * stderr into the log file, "console" echoes it (debug). "" follows the
     * row-config `bridgeStderr`.
     */
    stderrMode: z.string().default("").pattern(STDERR_MODE_FIELD_PATTERN).volatile(),
    /** The mode the bridge actually routes console output through — the UI
     * toggle when it states one, else the row config. Mirrored live so the
     * toggle never reads a phantom state (see `resolveStderrMode`). */
    stderrEffective: z.union([z.const("log"), z.const("console")]).default("log").volatile(),
    /** Written by the card's **Fetch executables** button; the Host reacts by
     * re-probing the saved rows and merging what it finds back into them. */
    refreshExecutablesNonce: z.number().default(0).volatile(),
    /** Written by the card's **Prelaunch Windows Chrome** button; the Host
     * reacts by running the Windows launch: locate the Windows Chrome, prove
     * the mirrored-loopback prereq, launch it with a debugging port, and write
     * the `--browserUrl` connect entry that leaves the bridge in connect mode. */
    openWindowsChromeNonce: z.number().default(0).volatile(),
    /**
     * Whether the translation of this row's **standalone** configuration was
     * offered and turned down. Host-authored:
     * the card never edits it — only the proposal's dismiss action does.
     */
    migrationDismissed: z.boolean().default(false).volatile(),

    // ---- Host-published live state ----------------------------------------

    /** Last check/connection failure, human-readable; empty when healthy. */
    lastError: z.string().default("").volatile(),
    /** Known error: the last failure was "no Chrome executable detected". */
    chromeMissing: z.boolean().default(false).volatile(),
    /** Executable-run counter (success or failure); completion signal for every
     * executable action the card can take. */
    executableDiscoveryRevision: z.number().default(0).volatile(),
    /** The version the **selected** executable answered with; "" when nothing
     * answered — nothing picked, a connect mode, or a blocked path. */
    chromeVersion: z.string().default("").volatile(),
    /** Per-row probe status keyed by path: the version the row answered with,
     * and the failure for a row that is present but not runnable (or blocked). */
    executableStatus: z.array(ExecutableStatus).default([]).volatile(),
    /** The path the bridge actually launches with ("" when nothing is fixed). */
    effectiveChromePath: z.string().default("").pattern(CHROME_PATH_PATTERN).volatile(),
    /** Where `effectiveChromePath` came from — picked (`"selected"`), row config
     * (`"row-config"`) or nothing yet (""). */
    effectiveSource: z.string().default("").pattern(EFFECTIVE_SOURCE_PATTERN).volatile(),
    /** The canonical default extra-flags list — the list the card's **Restore
     * defaults** control appends to what the editor holds. Mirror of
     * `DEFAULT_EXTRA_FLAGS`, served so the card carries no copy of it. */
    defaultExtraFlags: z.array(String).default(DEFAULT_EXTRA_FLAGS).volatile(),
    /** The recommended WSL ↔ Windows extra-flags list — the list the card's
     * **Flags WSL** control appends, missing entries only. Mirror of
     * `WSL_EXTRA_FLAGS`, served so the card carries no copy of it. */
    wslExtraFlags: z.array(String).default(WSL_EXTRA_FLAGS).volatile(),
    /** True while this Host runs under WSL and the selected executable is a
     * Windows binary — the state the card's notice explains (see ./platform.ts). */
    wslWindowsExecutable: z.boolean().default(false).volatile(),
    /** What the **Prelaunch Windows Chrome** run is doing — the single field
     * the card derives the button's state, its disabled reason and the pill's
     * connect-mode muting from. Every half (locate, prereq, launch, port) lives
     * Host-side (./windows/), so the card carries no list of Windows paths or
     * reachability rules. */
    windowsChromeStatus: WindowsChromeStatus.default({ state: "off", port: 0, error: "" }).volatile(),
    /** True while the bridge launches with a connect-mode flag (`--browserUrl`
     * / `--wsEndpoint`): no local executable is then launched or probed, so the
     * card mutes the picker. */
    carriesConnectionMode: z.boolean().default(false).volatile(),
    /** The flags a live connection of this component's own kinds actually
     * launches with — mirrored from the last `resolve`, not from any layer, so
     * the machine page states what is running rather than what was last
     * configured. Empty while nothing resolves. */
    runningFlags: z.array(String).default([]).volatile(),
    /** The note the last live connection answered with — where its console
     * output goes, or the Windows URL it connected to. "" when the answer was
     * silent. */
    runningNote: z.string().default("").volatile()
});

/** What one row's configuration **form** answers with — every field resolved to a
 * plain, nullable value (`TypeS`, not `TypeT`: the volatile fields stay plain here,
 * they are not wrapped references). This is the stored/described shape: what a
 * described settings row carries, and what the card reads out of its snapshot.
 * What `apply` receives is **not** this shape — every `.volatile()` field of it
 * arrives as a reference instead, which is why the host half carries its own
 * runtime view in ./types/config.ts (`ChromeMcpConfig`). */
export type ConfigFormValues = Schemastery.TypeS<typeof Config>;
