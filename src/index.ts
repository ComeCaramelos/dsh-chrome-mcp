/**
 * @comecaramelos/dsh-chrome-mcp — host half, public surface.
 *
 * Connects the DSH Chrome MCP server (`chrome-devtools-mcp`, launched as
 * `npx -y chrome-devtools-mcp@latest [extraFlags]`) as an MCP server through
 * the stock @deepseek-ai/dsh-mcp-client bridge, and exposes the user-facing
 * settings — extra flags, the Chrome executable picker, and error reporting —
 * under the `chrome-mcp` settings namespace: the Web GUI's Plugins settings
 * page renders a card (see ./client.js) keyed by that namespace. Editing the
 * extra flags re-applies the nested mcp-client plugin in place
 * (fiber.update), which restarts the bridge with the new arguments; so does
 * picking another executable.
 *
 * Persistence boundary: only the user-authored fields land in
 * `$DSH_HOME/settings.yaml` — `extraFlags` (the last UI edit, used to launch
 * on (re)start), `chromePath` (the executable the picker selected — or that the
 * host seeded once), `executables` (the saved-executable rows: `{ id: path,
 * name: label }` — the catalog shape the reference plugin's picker edits),
 * `refreshExecutablesNonce` (the card's **Search executables** trigger),
 * `stderrMode` (the card's
 * "Reduce log output" toggle: "log" captures the bridge's stderr into a
 * per-spawn log file, "console" echoes it, "" follows the row-config
 * `bridgeStderr`) and `chromeCustomPaths` (the **legacy** MRU of hand-typed
 * paths, folded into the rows once and never written again). A module plugin
 * has no host→client push channel (`harness.handle` is reserved for
 * code-string halves), which is why the card's executable action travels as the
 * `refreshExecutablesNonce` trigger. Status state (`lastError`,
 * `executableDiscoveryRevision`, `chromeVersion`, `executableStatus`,
 * `chromeMissing`, `effectiveChromePath`, `effectiveSource`,
 * `wslWindowsExecutable`, the static `rowStderr` mirror, the static
 * `defaultExtraFlags` mirror and the static
 * `wslExtraFlags` mirror ride the composition
 * base layer — served to the client inside the resolved value, held in memory,
 * never persisted.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 *
 * Everything behind this surface lives in ./host/*:
 *
 *   ./host/apply.ts       the wiring (controller + section)
 *   ./host/controller/  live state: base layer, bridge, checks, captures
 *   ./host/settings.ts    namespace install, commit routing, validation
 *   ./host/catalog.ts     the saved-executable rows the picker edits
 *   ./host/discovery/   the candidate paths + `--version` probes + check run
 *   ./host/bridge.ts      the bridge argv + config, stderr wrapper, log capture
 *   ./host/flags.ts       extra-flags validation + flag predicates
 *   ./host/platform.ts    WSL detection + the Windows-executable predicate
 *   ./host/values.ts      precedence resolution + persisted reads
 *   ./host/status.ts      error classification + tool-result notes
 *   ./host/schema.ts      the zod schemas
 *   ./host/constants.ts   fixed identifiers, budgets, patterns
 *
 * Config (cordis row):
 *   serverName          tool namespace prefix       (default "chrome")
 *   command             launcher executable        (default "npx")
 *   package             npm spec to npx            (default "chrome-devtools-mcp@latest")
 *   extraFlags          flags appended after the spec
 *                       (default ["--no-usage-statistics", "--no-performance-crux"])
 *   chromePath          row-config executable, appended as
 *                       `--executablePath=<path>` — the fallback source of the
 *                       selection for hosts whose card never picked one
 *                       (a `--executablePath` flag left in `extraFlags` is
 *                       folded into this source)
 *   chromePaths         scan candidate list when nothing is picked
 *                       (default defaultChromePaths(), mirroring upstream's
 *                       stable-channel locations)
 *   env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect
 *                       passed through to dsh-mcp-client
 */

// ── identity ────────────────────────────────────────────────────────────────
export { inject, name } from "./host/plugin-meta.js";

// ── fixed identifiers and budgets ───────────────────────────────────────────
export {
    CONFIGURATION_DOCS_URL,
    DEFAULT_EXTRA_FLAGS,
    FLAGS_ENV_VAR,
    SETTINGS_NAMESPACE,
    WINDOWS_CHROME_CANDIDATES,
    WINDOWS_CHROME_PORT,
    WINDOWS_CHROME_PORT_POOL,
    WINDOWS_CHROME_PREREQ_PORTS,
    WSL_EXTRA_FLAGS
} from "./host/constants.js";

// ── the two schemas ─────────────────────────────────────────────────────────
export { Config, SettingsSchema } from "./host/schema.js";

// ── the wiring ──────────────────────────────────────────────────────────────
export { apply } from "./host/apply.js";

// ── the behavior tests and diagnostics drive directly ───────────────────────
export { bridgeConfig, bridgeStderrLogPath, buildBridgeSpawn, buildServerArgs, captureLogger } from "./host/bridge.js";
export {
    checkChrome,
    chromeExecutableCandidates,
    DEFAULT_CHROME_PATHS,
    defaultChromePaths,
    discoverChrome,
    scanChromeExecutables
} from "./host/discovery/index.js";
export { isChromeMissing, toolResultNote } from "./host/status.js";
export { isWindowsExecutablePath, isWindowsExecutableUnderWsl, isWindowsSubsystemForLinux } from "./host/platform.js";
// The Windows Chrome run behind the **Prelaunch Windows Chrome** button: locate,
// prereq, launch, port and the connect-mode flag it writes.
export {
    browserUrlFlagPort,
    findWindowsChromeExecutable,
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
export { carriesExecutablePath, extractExecutablePathFlag, sameFlags, stripExecutablePathFlags, validateExtraFlags } from "./host/flags.js";
export {
    normalizeCustomPaths,
    readPersistedChromePath,
    readPersistedCustomPaths,
    readPersistedFlags,
    readPersistedStderrMode,
    resolveEffectiveChromePath,
    resolveEnvFlags,
    resolveStderrMode
} from "./host/values.js";
// The saved-executable rows: pure helpers over `{ id: path, name: label }`, the
// list the picker edits and a merged run extends.
export { entryIds, entryLabel, findEntry, isValidEntryId, mergeEntries, normalizeEntries } from "./host/catalog.js";

// The controller, the installSection wrapper, the bridge spawn argv and the
// internal predicates stay off this surface: they are implementation, and
// widening it is a public-API change.

export type {
    BridgeStderrMode,
    ChromeMcpConfig,
    EffectiveChromeSource,
    ReconnectConfig
} from "./host/types/index.js";
export type { ChromeExecutableEntry, ChromeExecutableStatus } from "./host/types/index.js";
export type {
    McpBridge,
    PluginContext,
    SettingsBaseLayer,
    SettingsOp,
    SettingsResolved,
    SettingsService,
    SettingsUserFields,
    ToolCallExecution,
    ToolCallResult,
    ValidatedSettings,
    WindowsChromeRun,
    WindowsChromeState,
    WindowsChromeStatus
} from "./host/types/index.js";
