/**
 * Host-half assembly — the wiring file.
 *
 * `apply` is deliberately the only host module that knows the two parts
 * exist; each part keeps its own behavior:
 *
 *   ./controller/   the live bridge state (entry, bridge, checks, captures)
 *   ./settings.ts     the namespace install + commit routing + validation
 *
 * The ordering rule that must survive the split: read the live settings value
 * through `source()` at commit time, never capture it — cordis starts the
 * `settings` injection callback after `apply` returns, so a captured value
 * would pin every consumer to the row config and no mid-session GUI edit
 * would ever reach the running bridge.
 *
 * Mount the DSH Chrome MCP server bridge and its settings-backed card.
 * Flags precedence: settings user layer (UI edit) > FLAGS_ENV_VAR (launch
 * env) > row config `extraFlags` > schema default.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link ChromeMcpConfig}.
 */
import { createChromeMcpController } from "./controller/index.js";
import { installChromeMcpSection } from "./settings.js";
import { installPrelaunchWindowsChromeTool } from "./tool.js";
import type { ChromeMcpConfig, PluginContext } from "./types/index.js";

export function apply(ctx: PluginContext, config: ChromeMcpConfig): void {
    const controller = createChromeMcpController(ctx, config);
    installChromeMcpSection(ctx, controller);
    installPrelaunchWindowsChromeTool(ctx, controller);
}
