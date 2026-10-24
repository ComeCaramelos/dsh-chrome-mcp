/**
 * Error classification and status notes — the human-readable half.
 *
 * Every capture path (check failure, bridge log line, tool-call result) ends
 * in one capped line written to the live mirror's `lastError`; `isChromeMissing`
 * decides whether that line is the known, developer-actionable "no Chrome
 * executable detected" state (`chromeMissing`) or a generic failure.
 */
import { ERROR_CAP } from "./constants.js";

/** First non-empty line of a text block, capped. */
export function firstLine(text: unknown, cap: number = ERROR_CAP): string {
    const line = String(text ?? "")
        .split(/\r?\n/u)
        .find((candidate) => candidate.trim() !== "") ?? "";
    return line.trim().slice(0, cap);
}

/**
 * Recognizes the known, developer-actionable error "no Chrome executable was
 * detected": our own ENOENT/discovery lines, the upstream executable-discovery
 * failures ("Could not find Google Chrome executable for channel 'stable'
 * at:", puppeteer's configured-path miss), and the umbrella launch failure
 * chrome-devtools-mcp surfaces when it cannot start a browser binary. Upstream
 * starts the browser lazily (on the first tool call), so the check probe is
 * what surfaces the state without any tool call. Anything else is a generic
 * check or connection error.
 * @param text - an error message (or first line thereof).
 * @returns true when the failure is the known executable-missing state.
 */
export function isChromeMissing(text: unknown): boolean {
    const message = String(text ?? "");
    return (
        /chrome executable not found/iu.test(message) ||
        /could not find (?:google )?chrome(?: executable)?/iu.test(message) ||
        /browser was not found at the configured executablePath/iu.test(message) ||
        /failed to launch the browser process/iu.test(message)
    );
}

/**
 * Summarize one chrome-tool call result for the card's status line — the rule
 * is ancestros' (`host/status.toolResultNote`): failed calls answer
 * "<tool> failed: <first text line>", successes `null` (the caller clears the
 * stored error). Tool-level errors (browser unreachable, "Target closed", …)
 * are returned to the calling agent and never reach a bridge line, so the
 * tool-call capture is the only place they surface.
 */
export { toolResultNote } from "@comecaramelos/dsh-ancesters/host";
