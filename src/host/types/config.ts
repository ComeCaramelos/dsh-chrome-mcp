/**
 * Types — the validated row config and the plugin context.
 *
 * The config a cordis plugin row carries (every field defaulting through the
 * zod schema in ./schema.ts) and the narrow service/fiber views this host half
 * actually calls. Split out of the single `types.ts`. Structural views stay
 * narrow: only what the host half calls, widened no further than that.
 */
import type { Context } from "@deepseek-ai/cordis";

import type { BridgeStderrMode } from "./stderr.js";

/**
 * A validated row config (every field carries a schema default).
 * Mirrors the zod schema shape for typed access in apply().
 */
export type ChromeMcpConfig = {
    serverName: string;
    command: string;
    package: string;
    extraFlags: string[];
    chromePath: string;
    chromePaths: string[];
    env: Record<string, string>;
    cwd: string;
    toolCallTimeoutMs: number;
    failOnStartupError: boolean;
    reconnect: ReconnectConfig;
    /** Bridge console-output routing: "log" (default) redirects the child's
     * stderr into a log file; "console" echoes it. The card's "Reduce log
     * output" toggle (the persisted `stderrMode`) overrides this. */
    bridgeStderr: BridgeStderrMode;
    /** Optional absolute path for the stderr log ("" → the private per-process
     * directory created by `mkdtemp`, holding `<serverName>-bridge.log`). */
    bridgeStderrLog: string;
};

/** Reconnect policy, mirroring the `dsh-mcp-client` bridge config. */
export type ReconnectConfig = {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
};

/**
 * Plugin context as consumed by this host half. `ctx.effect`, `ctx.inject`,
 * `ctx.plugin`, and `ctx.get` all come from cordis `Context` itself.
 */
export type PluginContext = Context;
