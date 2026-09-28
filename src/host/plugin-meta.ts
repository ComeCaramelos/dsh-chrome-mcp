/**
 * Host-half plugin identity.
 *
 * `name` is what the cordis loader reports for diagnostics and `inject` is the
 * list of host services this half needs of its own; the nested mcp-client row
 * declares the tools, so nothing is injected here.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "chrome-devtools-mcp";

/** No host services of our own: the nested bridge declares `tools`. */
export const inject: string[] = [];
