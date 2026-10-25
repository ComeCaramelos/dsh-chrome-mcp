/**
 * @comecaramelos/dsh-chrome-mcp — host half, public surface.
 *
 * A **component** of the `dsh-mcp-manager` bundle: this package registers the
 * `chrome` and `chrome-windows` kinds of MCP connection with the manager's
 * `mcpConnections` service — the first runs `chrome-devtools-mcp` as a local
 * stdio connection (`npx -y chrome-devtools-mcp@latest [extraFlags]`, wrapped
 * for its stderr), the second drives the Windows-side Chrome through the WSL
 * interop mount and connects to its debugging port. Whether a connection runs
 * is the manager pool's decision, not this package's; the row itself starts
 * nothing.
 *
 * Identity is the row's **profile entry id** (`mcp-chrome`), read off the
 * plugin's own fiber — not a namespace of its own, and `serverName` is no longer
 * part of it (a connection's tool namespace is its own `entry.id`).
 *
 * What stays in the row is machine state — the saved executable rows, the
 * seeded selection, the defaults the connections follow when they carry no own
 * answer — and the card surface that edits it: the extra-flags rows, the
 * Chrome executable picker, and error reporting.
 *
 * Persistence boundary: only the user-authored fields land in the profile's own
 * patch layer — `extraFlags` (the default flags list),
 * `chromePath` (the default executable: the picker's pick or the host's seed),
 * `executables` (the saved-executable rows: `{ id: path, name: label }`),
 * `droppedExecutables`, `chromeCustomPaths` (**legacy** MRU, folded once),
 * `refreshExecutablesNonce` (**Fetch executables** trigger),
 * `openWindowsChromeNonce` (**Prelaunch Windows Chrome** trigger),
 * `stderrMode` (the default console-output mode) and `migrationDismissed`
 * (whether the standalone-config translation was turned down; see D4).
 *
 * Status state (`lastError`, `executableDiscoveryRevision`, `chromeVersion`,
 * `executableStatus`, `chromeMissing`, `effectiveChromePath`, `effectiveSource`,
 * `stderrEffective`, `wslWindowsExecutable`, the static `defaultExtraFlags`
 * mirror, the static `wslExtraFlags` mirror, `windowsChromeStatus`,
 * `carriesConnectionMode`, `runningFlags` and `runningNote`) is the **live
 * mirror**: every one of them is a `.volatile()` field of the same `Config` the
 * form edits, published by committing that mirror onto this fiber's entry — a
 * purely volatile commit persists nothing, never remounts the fiber, and is what
 * the card settles its snapshot on. The controller reads the two layers the
 * distinction needs (`user` = what the patch carries, `base` = what the row
 * config carries under it) off the described form row, never off a document of
 * its own.
 *
 * Everything behind this surface lives in ./host/*:
 *
 *   ./host/apply.ts       the wiring (controller + kinds + form + tool + commands)
 *   ./host/manager.ts     the `mcpConnections` seam (register, notify, propose)
 *   ./host/kind.ts        the two kinds: fields, choices, `resolve`
 *   ./host/migration.ts   the standalone-config translation (D4)
 *   ./host/controller/  live state: the mirror + its publish, runs, captures
 *   ./host/settings.ts    form attach, entry-id rule, commit routing
 *   ./host/catalog.ts     the saved-executable rows the picker edits
 *   ./host/discovery/   the candidate paths + `--version` probes + check run
 *   ./host/bridge.ts      the bridge argv + spawn wrapper, stderr log
 *   ./host/flags.ts       extra-flags validation + flag predicates
 *   ./host/platform.ts    WSL detection + the Windows-executable predicate
 *   ./host/values.ts      precedence resolution + the form's layer reads
 *   ./host/status.ts      error classification + tool-result notes
 *   ./host/schema.ts      the single `Config`
 *   ./host/constants.ts   fixed identifiers, budgets, patterns
 *
 * Config (the single `Config`, cordis row + form):
 *   serverName          legacy tool namespace (ignored by connections; the
 *                       standalone translation reads it as the entry `id`)
 *   command             launcher executable        (default "npx")
 *   package             npm spec to npx            (default "chrome-devtools-mcp@latest")
 *   extraFlags          default flags appended after the spec  (.volatile())
 *                       (default ["--no-usage-statistics", "--no-performance-crux"])
 *   chromePath          the default executable selection  (.volatile())
 *   chromePaths         scan candidate list when nothing is picked
 *                       (default defaultChromePaths(), mirroring upstream's
 *                       stable-channel locations)
 *   env / cwd / toolCallTimeoutMs / maxInstructionBytes / failOnStartupError /
 *                       reconnect defaults every connection config carries with
 *                       whatever its own fields answer instead
 *
 * One plugin instance per dsh host: the entry id is fixed.
 */

// ── identity ────────────────────────────────────────────────────────────────
export { inject, name } from "./host/plugin-meta.js";

// ── fixed identifiers and budgets ───────────────────────────────────────────
export {
    CONFIGURATION_DOCS_URL,
    DEFAULT_EXTRA_FLAGS,
    ENTRY_ID,
    FLAGS_ENV_VAR,
    WINDOWS_CHROME_CANDIDATES,
    WINDOWS_CHROME_PORT,
    WINDOWS_CHROME_PORT_POOL,
    WINDOWS_CHROME_PREREQ_PORTS,
    WSL_EXTRA_FLAGS
} from "./host/constants.js";

// ── the single schema ───────────────────────────────────────────────────────
export { Config } from "./host/schema.js";

// ── the wiring ──────────────────────────────────────────────────────────────
export { apply } from "./host/apply.js";

// ── the connection kinds, and what one entry answers with ────────────────────
export {
    createChromeKinds,
    createChromeKind,
    createChromeWindowsKind,
    entryExecutable,
    entryExtraFlags,
    entryStderrMode,
    executableChoices,
    joinFlagLines,
    parseFlagLines
} from "./host/kind.js";
// What a standalone row config means now (D4), and whether it was turned down.
export { carriesStandaloneConfig, migrationDismissed, standaloneProposal } from "./host/migration.js";
// The `mcpConnections` seam itself.
export { attachToManager, isOwnedKind } from "./host/manager.js";

// ── the configuration form's identity + routing ─────────────────────────────
export { chromeMcpEntryId } from "./host/settings.js";

// ── the behavior tests and diagnostics drive directly ───────────────────────
export { bridgeConfig, bridgeStderrLogPath, buildBridgeSpawn, buildServerArgs, captureLogger, pinnedServerCli, serverCommand, usesPinnedServer } from "./host/bridge.js";
export {
    checkChrome,
    chromeExecutableCandidates,
    DEFAULT_CHROME_PATHS,
    defaultChromePaths,
    discoverChrome,
    probeExecutable,
    readWindowsInstallVersion,
    scanChromeExecutables
} from "./host/discovery/index.js";
export { isChromeMissing, toolResultNote } from "./host/status.js";
export { WINDOWS_VERSION_UNKNOWN } from "./host/constants.js";
export { isWindowsExecutablePath, isWindowsExecutableUnderWsl, isWindowsSubsystemForLinux } from "./host/platform.js";
// The Windows Chrome run behind the **Prelaunch Windows Chrome** button: locate,
// prereq, launch, port and the connect-mode flag it writes.
export {
    browserUrlFlagPort,
    findWindowsChromeExecutable,
    findWindowsChromeExecutables,
    linkWindowsChromeProfile,
    runWindowsChromeConnect,
    windowsChromeLandingHtml,
    windowsChromeLandingPath,
    windowsChromeLandingUrl,
    windowsChromeLocalAppData,
    windowsChromeProfileDir,
    windowsChromeUrl,
    windowsChromeProjectDir,
    windowsFileUrl,
    windowsPathToMount,
    withBrowserUrlFlag
} from "./host/windows/index.js";
// The MCP tool that carries the same run to the agent: registration + the
// `prelaunch_windows_chrome` definition.
export { PRELAUNCH_WINDOWS_CHROME_NAME, installPrelaunchWindowsChromeTool, prelaunchWindowsChromeDefinition } from "./host/tool.js";
export {
    carriesConfigFile,
    carriesConnectionMode,
    carriesExecutablePath,
    carriesOtherChannel,
    extractExecutablePathFlag,
    flagsSkipCheck,
    flagsSkipProbe,
    sameFlags,
    stripExecutablePathFlags,
    validateExtraFlags
} from "./host/flags.js";
export {
    createLiveMirror,
    liveMirrorKeys,
    normalizeCustomPaths,
    readConfigField,
    readConfigForm,
    readConfigLayers,
    readPersistedChromePath,
    readPersistedCustomPaths,
    readPersistedFlags,
    readPersistedStderrMode,
    readSavedExecutables,
    resolveEffectiveChromePath,
    resolveEnvFlags,
    resolveLaunchFlags,
    resolveSelection,
    resolveStderrMode
} from "./host/values.js";
// The saved-executable rows: pure helpers over `{ id: path, name: label }`, the
// list the picker edits and a merged run extends.
export { entryIds, entryLabel, findEntry, isValidEntryId, mergeEntries, normalizeEntries } from "./host/catalog.js";

// The controller, the form-attach wrapper, the live publish and the bridge spawn
// argv stay off this surface: they are implementation, and widening it is a
// public-API change.

export type {
    BridgeStderrMode,
    ChromeMcpConfig,
    ConfigField,
    ConfigLayers,
    ConfigLayerFields,
    ConfigLiveFields,
    ConfigUserFields,
    EffectiveChromeSource,
    ReconnectConfig
} from "./host/types/index.js";
export type { ChromeExecutableEntry, ChromeExecutableStatus } from "./host/types/index.js";
export type {
    ChromeMcpForm,
    McpBridge,
    PluginContext,
    SettingsFormRow,
    SettingsForms,
    ToolCallExecution,
    ToolCallResult,
    WindowsChromeRun,
    WindowsChromeState,
    WindowsChromeStatus
} from "./host/types/index.js";
export type { ConfigFormValues } from "./host/schema.js";
