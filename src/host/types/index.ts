/**
 * Host-half shared types — the whole surface.
 *
 * Everything a module needs without importing its implementation, split into
 * sections by concern and re-exported here so `from "./types/index.js"` still
 * names all of it:
 *
 *   ./stderr.ts     where the bridge console goes + the stderr-wrapper shapes
 *   ./config.ts     the config `apply` receives + reconnect + PluginContext
 *   ./executable.ts the saved-executable rows + source tag
 *   ./windows.ts    the Prelaunch Windows Chrome run's states + outcome
 *   ./settings.ts   the configuration form's layers, the live mirror, the service
 *   ./plugin.ts     the bridge fiber + the tool-call captures
 *
 * Structural views stay narrow: only what the host half actually calls.
 */
export type { BridgeStderrMode, BridgeStderrNotice, BridgeSpawnTarget, BridgeSpawnOptions, BridgeSpawnResult, BridgeStderrLogPathOptions } from "./stderr.js";
export type { ChromeMcpConfig, ConfigField, ReconnectConfig, PluginContext } from "./config.js";
export type { ChromeExecutableEntry, ChromeExecutableStatus, EffectiveChromeSource } from "./executable.js";
export type { WindowsChromeState, WindowsChromeStatus, WindowsChromeLinkAnswer, WindowsChromeRun } from "./windows.js";
export type {
    ConfigUserFields,
    ConfigLiveFields,
    ConfigLayerFields,
    ConfigLayers,
    SettingsForms,
    SettingsFormRow,
    SettingsPathOp,
    ChromeMcpForm
} from "./settings.js";
export type { McpBridge, ToolCallExecution, ToolCallResult } from "./plugin.js";
export type { CommandDefinition, CommandInvocation, CommandResult } from "./services.js";
