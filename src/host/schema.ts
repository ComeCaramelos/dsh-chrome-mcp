/**
 * The two zod schemas: the cordis row config and the settings section.
 *
 * The row config validates what lives in the profile (one row per plugin
 * instance); the settings schema describes the namespace the Web GUI card
 * edits — the persisted user layer (flags, the executable selection, the saved
 * executable rows, the stderr toggle and the one action trigger) plus the
 * base-layer status fields served alongside it.
 */
import z from "@deepseek-ai/schemastery";

import {
    CHROME_PATH_PATTERN,
    DEFAULT_EXTRA_FLAGS,
    EFFECTIVE_SOURCE_PATTERN,
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

export const Config = z.object({
    serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("chrome"),
    command: z.string().default("npx"),
    package: z.string().min(1).default("chrome-devtools-mcp@latest"),
    extraFlags: z.array(String).default(DEFAULT_EXTRA_FLAGS),
    chromePath: z.string().default(""),
    chromePaths: z.array(String).default(defaultChromePaths()),
    env: z.dict(String).default({}),
    cwd: z.string().default(""),
    toolCallTimeoutMs: z.number().default(60000),
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
    bridgeStderrLog: z.string().default("").pattern(OPTIONAL_PATH_PATTERN)
});

/** One saved-executable catalog row: `id` is the path that goes on the wire
 * (`--executablePath=<id>`), `name` the label the user chose for the UI
 * ("" = render the path). Persisted. */
const ExecutableEntrySchema = z.object({
    id: z.string().default("").pattern(CHROME_PATH_PATTERN),
    name: z.string().default("")
});

/** What one saved row's probe answered with, keyed by its id (`path`): the
 * `--version` line, and the failure that makes it not runnable. Base layer. */
const ExecutableStatusSchema = z.object({
    path: z.string().default("").pattern(CHROME_PATH_PATTERN),
    version: z.string().default(""),
    error: z.string().default("")
});

/** The served Windows-Chrome state: what the **Prelaunch Windows Chrome** run is
 * doing, the debugging port it settled on (0 = none) and the failure line.
 * Base layer. */
const WindowsChromeStatusSchema = z.object({
    state: z.string().pattern(WINDOWS_CHROME_STATE_PATTERN).default("off"),
    port: z.number().default(0),
    error: z.string().default("")
});

/**
 * User-settings section served to the Web GUI card.
 *
 * Persisted (user layer in `$DSH_HOME/settings.yaml`): `extraFlags`,
 * `chromePath` (the executable the picker selected — or that the host seeded
 * once), `executables` (the saved-executables rows: `id` = path, `name` = UI
 * label), `refreshExecutablesNonce` (the card's **Search executables**
 * trigger), `openWindowsChromeNonce` (the card's **Prelaunch Windows Chrome**
 * trigger), `chromeCustomPaths` (the **legacy** hand-typed MRU: folded into the
 * rows once by the first scan, never written again) and `stderrMode` (the
 * "Reduce log output" toggle: "log" captures the bridge's stderr into a
 * per-spawn log file, "console" echoes it, "" follows the row-config
 * `bridgeStderr`).
 * Served but never persisted (composition base layer held in memory by the
 * host): `lastError`, `executableDiscoveryRevision`, `chromeVersion`,
 * `executableStatus`, `chromeMissing`, `effectiveChromePath`,
 * `effectiveSource`, `wslWindowsExecutable`, `windowsChromeStatus`,
 * `carriesConnectionMode`, the static `rowStderr` mirror, the static
 * `defaultExtraFlags` mirror (the canonical defaults list the card's
 * **Restore defaults** control appends) and the static `wslExtraFlags` mirror
 * (the recommended WSL ↔ Windows flags the card's **Flags WSL** control
 * appends) — the client's polls stop when the served revision advances past its
 * action-time value.
 */
export const SettingsSchema = z.object({
    /** Flags appended after `npx -y <package>`; persisted last UI edit. An
     * executable-pinning flag is rejected: the executable is picked below. */
    extraFlags: z.array(String).default(DEFAULT_EXTRA_FLAGS),
    /** Written by the UI **Search executables** button; the host reacts to it by
     * re-probing the saved rows and merging what it finds back into them. */
    refreshExecutablesNonce: z.number().default(0),
    /** Written by the UI **Prelaunch Windows Chrome** button; the host reacts to it
     * by running the Windows launch: locate the Windows Chrome, prove the
     * mirrored-loopback prereq, launch it with a debugging port, and write the
     * `--browserUrl` connect entry that leaves the bridge in connect mode. */
    openWindowsChromeNonce: z.number().default(0),
    /**
     * The executable the bridge launches with: picked in the picker (a saved
     * row's `id`) or seeded once by the host's first scan. "" = nothing resolved
     * yet — there is no auto state to fall back to.
     */
    chromePath: z.string().default("").pattern(CHROME_PATH_PATTERN),
    /** The picker's saved rows — `{ id: path, name: label }`, user-authored. The
     * host re-normalizes (trim, dedupe, caps) on every read, and a scan merges
     * what it discovers into them without dropping a name the user chose. */
    executables: z.array(ExecutableEntrySchema).default([]),
    /**
     * **Legacy** MRU of hand-typed executables, newest first. The saved rows
     * replace it: a host whose settings still carry it folds its paths into the
     * rows during the first scan (see ./catalog.ts `mergeEntries`), so the field
     * is read once and never written again.
     */
    chromeCustomPaths: z.array(z.string().default("").pattern(CHROME_PATH_PATTERN)).default([]),
    /**
     * Persisted UI "Reduce log output" toggle: "log" captures the bridge's
     * stderr into the log file, "console" echoes it (debug). "" follows the
     * row-config `bridgeStderr` (mirrored into `rowStderr`).
     */
    stderrMode: z.string().default("").pattern(STDERR_MODE_FIELD_PATTERN),
    /** Last check/connection failure, human-readable; empty when healthy. */
    lastError: z.string().default(""),
    /** Known error: the last failure was "no Chrome executable detected". */
    chromeMissing: z.boolean().default(false),
    /** Executable-run counter (success or failure); completion signal for every
     * executable action the card can take. */
    executableDiscoveryRevision: z.number().default(0),
    /** The version the **selected** executable answered with; "" when nothing
     * answered — nothing picked, a connect mode, or a blocked path. */
    chromeVersion: z.string().default(""),
    /** Per-row probe status keyed by path: the version the row answered with,
     * and the failure for a row that is present but not runnable (or blocked).
     * Base layer, never persisted — the rows themselves live in the user
     * layer. */
    executableStatus: z.array(ExecutableStatusSchema).default([]),
    /** The path the bridge actually launches with ("" when nothing is fixed).
     * Base layer, never persisted. */
    effectiveChromePath: z.string().default("").pattern(CHROME_PATH_PATTERN),
    /** Where `effectiveChromePath` came from — picked (`"selected"`), row config
     * (`"row-config"`) or nothing yet (""). Base layer, never persisted. */
    effectiveSource: z.string().default("").pattern(EFFECTIVE_SOURCE_PATTERN),
    /** Row-config `bridgeStderr` in effect (static base layer; never
     * persisted) — the fallback when `stderrMode` is "". */
    rowStderr: z.union([z.const("log"), z.const("console")]).default("log"),
    /** The canonical default extra-flags list (static base layer; never
     * persisted) — the list the card's **Restore defaults** control appends to
     * what the editor holds. Mirror of `DEFAULT_EXTRA_FLAGS`. */
    defaultExtraFlags: z.array(String).default(DEFAULT_EXTRA_FLAGS),
    /** The recommended WSL ↔ Windows extra-flags list (static base layer;
     * never persisted) — the list the card's **Flags WSL** control appends to
     * what the editor holds, missing entries only. Mirror of
     * `WSL_EXTRA_FLAGS`. */
    wslExtraFlags: z.array(String).default(WSL_EXTRA_FLAGS),
    /** True while this host runs under WSL and the selected executable is a
     * Windows binary — the state the card's notice explains. Base layer, never
     * persisted (see ./platform.ts). */
    wslWindowsExecutable: z.boolean().default(false),
    /** What the **Prelaunch Windows Chrome** run is doing (base layer; never
     * persisted) — the single field the card derives the button's state, its
     * disabled reason and the pill's connect-mode muting from. The locate,
     * prereq, launch and port answers all live host-side (./windows/), so
     * the card never carries a list of Windows paths or reachability rules. */
    windowsChromeStatus: WindowsChromeStatusSchema.default({ state: "off", port: 0, error: "" }),
    /** True while the bridge launches with a connect-mode flag
     * (`--browserUrl` / `--wsEndpoint`): no local executable is then launched
     * or probed, so the card mutes the picker. Base layer, never persisted. */
    carriesConnectionMode: z.boolean().default(false)
});
