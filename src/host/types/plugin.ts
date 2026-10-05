/**
 * Types — the nested bridge fiber and the tool-call captures.
 *
 * The narrow structural views over the two things this host half listens on but
 * does not own: the `dsh-mcp-client` bridge fiber its flag/executable changes
 * drive, and the tool-call result/execution the post-execute listener sees. Split
 * out of the single `types.ts`.
 */

/**
 * Nested `dsh-mcp-client` bridge fiber. `update` is the only method the host
 * calls, but it is consumed through the fiber's own readiness: cordis restarts
 * a fiber only while it is ACTIVE, so an update is chained on the settle.
 */
export interface McpBridge {
    update(config: unknown): unknown;
    /** Cordis `Fiber & PromiseLike<Fiber>`: settles once the fiber does. */
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown): PromiseLike<unknown>;
}

/**
 * Tool-call result as returned by the MCP tools-service (settled promise).
 */
export interface ToolCallResult {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
}

/**
 * Tool call execution context as received by the post-execute listener.
 */
export interface ToolCallExecution {
    name: string;
}
