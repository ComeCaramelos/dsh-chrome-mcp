/**
 * Error classification and status notes — the human-readable half.
 *
 * Every capture path (check failure, bridge log line, tool-call result) ends
 * in one capped line written to the base layer's `lastError`; `isChromeMissing`
 * decides whether that line is the known, developer-actionable "no Chrome
 * executable detected" state (`chromeMissing`) or a generic failure.
 */
import { ERROR_CAP } from "./constants.js";
import type { ToolCallResult } from "./types/index.js";

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
 * Summarize one chrome-tool call result for the card's status line. Failed
 * calls return "<tool> failed: <first text line>" — tool-level errors
 * (browser unreachable, "Target closed", …) are returned to the calling
 * agent and never route through the bridge logger, so this is the only
 * capture point. Successes return null: the caller clears the stored error.
 * @param toolName - fully qualified registered name (`mcp__<server>__<tool>`).
 * @param result - settled tools-service execution result.
 * @returns the note, or null when the call did not fail.
 */
export function toolResultNote(toolName: string, result: ToolCallResult | null | undefined): string | null {
    if (!result || result.isError !== true) return null;
    const blocks = Array.isArray(result.content) ? result.content : [];
    let text = blocks
        .filter((block) => block && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join(" ");
    if (text === "" && result.error && typeof result.error.message === "string") text = result.error.message;
    if (text === "") text = result.error === void 0 ? "unknown error" : String(result.error);
    return firstLine(`${toolName.split("__").pop()} failed: ${text}`);
}
