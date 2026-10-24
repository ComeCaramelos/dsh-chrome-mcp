/**
 * Host-half assembly — the wiring file.
 *
 * `apply` is deliberately the only host module that knows the parts exist; each
 * part keeps its own behavior:
 *
 *   ./controller/   the live mirror, the executable runs, the Windows run, the
 *                   capture paths
 *   ./manager.ts    the `chrome` + `chrome-windows` kinds and the standalone
 *                   translation — what this component says to the manager
 *   ./settings.ts   the configuration form's attach + commit routing + id rule
 *   ./commands/     the two headless-mirror slash commands
 *   ./tool.ts       the MCP-side `prelaunch_windows_chrome` trigger
 *
 * The ordering rule that must survive the split: read the live layers through
 * `source()` at commit time, never capture them — cordis starts the `settings`
 * injection callback after `apply` returns, so a captured value would pin every
 * consumer to the row config and no mid-session GUI edit would ever reach a
 * live connection.
 *
 * What changed with the component model: this row **no longer starts a bridge
 * of its own**. It answers live `chrome` / `chrome-windows` connections instead,
 * and answers nothing at all when no manager is mounted. Mounting therefore
 * stands up the machine half (the mirror, the executable catalog, the runs) and
 * registers the kinds; whether anything runs is the pool's decision.
 *
 * @param ctx - plugin context.
 * @param config - validated config (every volatile field a reference).
 */
import { createChromeMcpController, type ChromeMcpControllerDeps } from "./controller/index.js";
import { installChromeMcpCommands } from "./commands/index.js";
import { attachToManager } from "./manager.js";
import { installChromeMcpForm } from "./settings.js";
import { installPrelaunchWindowsChromeTool } from "./tool.js";
import type { ChromeMcpConfig, PluginContext } from "./types/index.js";

/**
 * @param deps - the controller's optional host overrides, passed straight
 * through. Nothing ordinary supplies them — the wiring reaches the machine
 * through the controller's own defaults, so this parameter is what lets a test
 * or a diagnostic answer the machine half (the Windows run, the Windows-side
 * executables the run folds into a candidate list) with a known list.
 */
export function apply(ctx: PluginContext, config: ChromeMcpConfig, deps: ChromeMcpControllerDeps = {}): void {
    const controller = createChromeMcpController(ctx, config, deps);
    // Stand the instance down when the mount goes away: a hot re-apply must not
    // leave the previous instance's late answers (a scheduled retry above all)
    // firing runs no one asked for.
    ctx.effect(() => () => {
        controller.dispose();
    }, "chrome-mcp: controller teardown");
    // The kinds come first, before the form: a connection saved under either
    // kind is answered through them, and a proposal names them by id.
    attachToManager(ctx, controller);
    installChromeMcpForm(ctx, controller);
    installPrelaunchWindowsChromeTool(ctx, controller);
    installChromeMcpCommands(ctx, config, controller);
}
