/**
 * Controller — the tool-call result capture that reaches the live mirror.
 *
 * A settled browser-tool result that failed becomes the newest `lastError`,
 * classified into the known "executable missing" flag so the single red status
 * dot keeps its whole story. The write is a live mirror write: published through
 * the references, never persisted.
 *
 * What the bridge-log capture used to be, the connection lines are now: every
 * failure the nested fiber answers with reaches the manager's own line for the
 * entry that spawned it, and the tool-call surface is the one failure path that
 * never reaches any line — a browser-level problem (target closed, dialog stuck,
 * protocol timeout) is returned to the calling agent and lands nowhere else.
 * Hence only the tool capture survives here.
 *
 * The prefix rule changed with the component model: a connection publishes under
 * `mcp__<entry id>__`, where the entry id is the manager's, not the row's old
 * `serverName`. So the capture answers for whichever live connection of this
 * component's own kinds carries the tool; a tool outside this component's
 * namespace never touches the mirror.
 */
import { captureToolResults } from "@comecaramelos/dsh-ancesters/host";

import { isChromeMissing } from "../status.js";

import { publishLive } from "./publish.js";
import type { Controller } from "./state.js";

/**
 * Register the tool-call status capture: browser-level failures surface only as
 * the calling agent's tool result, never on a line, so a settled result whose
 * registered name is prefixed `mcp__<id>__` for one of this component's live
 * connections and carries `isError` writes the failure into the live mirror; a
 * successful chrome-tool call clears both, so the card reports current health.
 * A success is *evidence* — what a missing selection never produces — while an
 * unrelated failure line never displaces the known executable-missing answer
 * standing (the rule the old bridge-log capture followed too). The body is
 * wrapped in try/catch (warn only — a capture fault must never break a tool
 * call) and returns `next()` unchanged.
 */
export function registerToolCapture(controller: Controller): void {
    // The listener, the prefix match, the note and the never-break-a-tool-call
    // wrapping are ancestros' `captureToolResults`; the prefixes are asked on
    // every call, because the live connections come and go.
    captureToolResults(controller.ctx as never, {
        name: `dsh-chrome-mcp(${controller.config.serverName})`,
        prefix: (name: string) => ownedToolPrefix(controller).some((prefix) => name.startsWith(prefix)),
        onResult: (note) => {
            if (note === null) {
                controller.state.live.lastError = "";
                controller.state.live.chromeMissing = false;
            } else if (isChromeMissing(note) || !controller.state.live.chromeMissing) {
                controller.state.live.lastError = note;
                controller.state.live.chromeMissing = isChromeMissing(note);
            }
            publishLive(controller);
        }
    });
}

/** The namespaces whose tool calls belong to this component: every live
 * connection of the component's own kinds answers under its entry id. A tool
 * named anywhere else (another component's connection, a core stdio entry) is
 * simply not this component's business. */
function ownedToolPrefixes(controller: Controller): string[] {
    const service = controller.state.connections;
    if (service === void 0) return [];
    const prefixes: string[] = [];
    try {
        for (const entry of service.entries()) {
            if (entry.kind !== "chrome" && entry.kind !== "chrome-windows") continue;
            prefixes.push(`mcp__${entry.id}__`);
        }
    } catch {
        return [];
    }
    return prefixes;
}

function ownedToolPrefix(controller: Controller): string[] {
    const prefixes = ownedToolPrefixes(controller);
    // The row's own `serverName` still names the tools while the connection was
    // answered under it (the migration-era config), so a captured tool under
    // that namespace is also ours.
    return prefixes.length > 0 ? prefixes : [`mcp__${controller.config.serverName}__`];
}
