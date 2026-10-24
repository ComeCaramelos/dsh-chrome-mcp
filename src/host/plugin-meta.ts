/**
 * Host-half plugin identity.
 *
 * `name` is what the cordis loader reports for diagnostics and `inject` is the
 * list of host services this half needs of its own; the connection fibers
 * declare the tools, so the only service this row itself asks for is the
 * manager's.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = "chrome-devtools-mcp";

/**
 * The host services this component needs of its own.
 *
 * `mcpConnections` is what the MCP manager *provides*: it is how this component
 * says "there are two kinds of connection here — `chrome` and `chrome-windows`
 * — and here is what one runs with". Declaring it is what the component being a
 * component means — without the manager the injection never answers, so the row
 * describes itself, answers its pickers, and starts nothing.
 */
export const inject: string[] = ["mcpConnections"];
