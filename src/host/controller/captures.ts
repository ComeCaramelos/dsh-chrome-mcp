/**
 * Controller — the two capture paths that reach the base layer.
 *
 * A module plugin has no push channel to clients, so both capture paths write
 * straight into the base layer: the newest bridge-log failure line becomes
 * `lastError`, and a settled browser-tool result that failed does the same (the
 * two never duplicate — bridge logs never reach the tool surface and vice
 * versa). Each capture is classified into the known "executable missing" flag so
 * the single red status dot keeps its whole story.
 */
import { BRIDGE_RECONNECTED } from "../constants.js";
import { firstLine, isChromeMissing, toolResultNote } from "../status.js";
import type { ToolCallExecution, ToolCallResult } from "../types/index.js";

import type { Controller } from "./state.js";

/**
 * Fold bridge log lines into the base layer. dsh-mcp-client reports connection
 * problems only through its logger (reconnect warnings with "connection
 * failed/lost", give-up errors, spawn failures), and a module plugin has no
 * push channel to clients — so the newest failure line becomes `lastError`, and
 * the "reconnected and re-synced tools" success line clears it. The wrapper
 * lives only on the bridge scope; our own logs bypass it, so our own warns never
 * masquerade as connection errors.
 */
export function noteBridgeLog(controller: Controller, level: string, args: unknown[]): void {
    const message = args
        .map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message ?? String(arg)) : String(arg)))
        .join(" ");
    if (level === "error" || level === "warn") {
        controller.state.entry.lastError = firstLine(message);
        controller.state.entry.chromeMissing = isChromeMissing(message);
    } else if (level === "info" && BRIDGE_RECONNECTED.test(message)) {
        controller.state.entry.lastError = "";
        controller.state.entry.chromeMissing = false;
    }
}

/**
 * Register the tool-call status capture: browser-level failures surface only as
 * the calling agent's tool result, never on the bridge logger, so a settled
 * result whose registered name is prefixed `mcp__<serverName>__` and carries
 * `isError` writes the failure into the base layer; a successful chrome-tool call
 * clears both, so the card reports current health. The body is wrapped in
 * try/catch (warn only — a capture fault must never break a tool call) and
 * returns `next()` unchanged.
 */
export function registerToolCapture(controller: Controller): void {
    const toolPrefix = `mcp__${controller.config.serverName}__`;
    (controller.ctx.on as (event: string, handler: (exec: ToolCallExecution, result: ToolCallResult, next: () => unknown) => unknown) => void)(
        "tools/post-execute",
        async (exec: ToolCallExecution, result: ToolCallResult, next: () => unknown) => {
            try {
                if (typeof exec.name === "string" && exec.name.startsWith(toolPrefix)) {
                    const note = toolResultNote(exec.name, result);
                    controller.state.entry.lastError = note ?? "";
                    controller.state.entry.chromeMissing = note === null ? false : isChromeMissing(note);
                }
            } catch (error) {
                controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): tool status capture failed: ${String(error)}`);
            }
            return next();
        });
}
