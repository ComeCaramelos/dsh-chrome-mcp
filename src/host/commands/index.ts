/**
 * Slash commands — the headless mirror of the card's two executable actions.
 *
 * The Web card is the primary surface, but a host with no GUI (or a user in an
 * agent conversation) gets the same two actions: `/chrome-path` picks the
 * executable and `/chrome-refresh` re-runs the discovery, both writing the SAME
 * persisted fields through the SAME write-back channel as the card, so the pill,
 * the command and the default answers never disagree.
 *
 * Registration rides the `commands` service lazily for the same reason the
 * MCP tool avoids a static injection: the service may resolve only after
 * `apply` returns, and a host without a commands plane simply gets no
 * registration. Every `register()` disposer is retained so a hot re-apply of
 * this plugin releases them — the registry throws on a duplicate name.
 */
import type { ChromeMcpController } from "../controller/index.js";
import type { ChromeMcpConfig, CommandDefinition, PluginContext } from "../types/index.js";
import { createChromePathCommand } from "./chrome-path.js";
import { createChromeRefreshCommand } from "./chrome-refresh.js";

/** The commands plane narrowed to what this half uses (the same structural view
 * `tool.ts` keeps for the tools service). */
interface CommandsService {
    register(definition: CommandDefinition): () => void;
}

/**
 * Register this plugin's commands on the `commands` service.
 *
 * @param ctx - plugin context.
 * @param config - the validated row config (only the log prefix reads it).
 * @param controller - the live state the commands drive through.
 */
export function installChromeMcpCommands(ctx: PluginContext, config: ChromeMcpConfig, controller: ChromeMcpController): void {
    ctx.effect(() => {
        const commandDisposers: Array<() => void> = [];
        let registered = false;
        ctx.inject(["commands"], (inner: PluginContext) => {
            if (registered) return;
            const commands = (inner as { commands?: CommandsService }).commands;
            // A host without a commands plane answers this half with nothing.
            if (commands === undefined) return;
            registered = true;
            for (const definition of [createChromePathCommand(controller), createChromeRefreshCommand(controller)]) {
                // The registry throws on a duplicate name — a re-apply racing a
                // still-live registration. The earlier definitions stay live, so
                // a warning beats breaking `apply`.
                try {
                    commandDisposers.push(commands.register(definition));
                } catch (error) {
                    ctx.logger.warn(`dsh-chrome-mcp(${config.serverName}): command "${definition.name}" registration skipped: ${String(error)}`);
                }
            }
        });
        return () => {
            for (const dispose of commandDisposers.splice(0)) dispose();
            registered = false;
        };
    }, "chrome-mcp: slash commands");
}
