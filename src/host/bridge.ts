/**
 * The nested `dsh-mcp-client` bridge: its stdio argv + config, the stderr
 * capture wrapper, and the logger wrapper that captures its own log lines into
 * the live mirror.
 *
 * The bridge's *logical* argv is the public contract the tests and the README
 * quote. By default it is the `chrome-devtools-mcp` this package depends on,
 * pinned, run by the same Node that runs the host —
 * `<node> <chrome-devtools-mcp cli> [extraFlags]`, the way dsh's own
 * chrome-devtools provider runs it: no `npx`, no registry on every start, the
 * same route on Linux, WSL and Windows (breaking in 2.0). A row that names its
 * own `command` or `package` keeps `<command> -y <package> [extraFlags]`.
 * `--executablePath=<chromePath>` is appended only when a path is configured
 * and the flags list does not already pin an executable. In the default "log"
 * stderr mode that argv is not spawned
 * raw: {@link buildBridgeSpawn} launches it through ancestros' Node wrapper, which
 * hands the argv over verbatim (the child never sees the wrapper) and sends only
 * stderr into a per-spawn log file, leaving stdout to carry the MCP protocol
 * stream. Without this wrapper every startup/progress line npx prints would
 * land directly on the dsh console — exactly what makes the connection feel
 * loud. "console" mode spawns the argv unwrapped (inherited stderr, debug).
 *
 * The logger wrapper exists because dsh-mcp-client reports connection problems
 * only through `ctx.logger`: without it the card would never surface a
 * failed/recovered bridge.
 */
import { fileURLToPath } from "node:url";
import { buildSpawn, stderrLogPath } from "@comecaramelos/dsh-ancesters/host";
import { LOG_LEVELS } from "./constants.js";
import { carriesExecutablePath, flagsSkipCheck } from "./flags.js";
import { readConfigField } from "./values.js";
import type * as McpClient from "@deepseek-ai/dsh-mcp-client";

import type {
    BridgeSpawnOptions,
    BridgeSpawnResult,
    BridgeSpawnTarget,
    BridgeStderrLogPathOptions,
    BridgeStderrMode,
    ChromeMcpConfig
} from "./types/index.js";

/** The row defaults that mean "the pinned server": a row that never named its
 * own launcher. */
const DEFAULT_COMMAND = "npx";
const DEFAULT_PACKAGE = "chrome-devtools-mcp@latest";

/** The CLI of the `chrome-devtools-mcp` this package depends on (pinned). */
export function pinnedServerCli(): string {
    return fileURLToPath(import.meta.resolve("chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js"));
}

/** Whether a row runs the pinned server: it names no launcher of its own (the
 * schema defaults, or blanks). */
export function usesPinnedServer(entry: Pick<ChromeMcpConfig, "command" | "package">): boolean {
    const command = String(entry.command ?? "").trim();
    const pkg = String(entry.package ?? "").trim();
    return (command === "" || command === DEFAULT_COMMAND) && (pkg === "" || pkg === DEFAULT_PACKAGE);
}

/** The executable one row's server runs under: this Node for the pinned
 * server, the row's own `command` otherwise. */
export function serverCommand(entry: Pick<ChromeMcpConfig, "command" | "package">, execPath: string = process.execPath): string {
    return usesPinnedServer(entry) ? execPath : String(entry.command);
}

/**
 * Build the stdio argv tail for one flags list — `<pinned cli> [extraFlags]`
 * for the pinned server, `-y <package> [extraFlags]` for a row's own launcher;
 * the argv {@link buildBridgeSpawn} runs after {@link serverCommand}.
 * When `chromePath` is set and the flags do not already carry an executable-path
 * option, `--executablePath=<path>` is appended (upstream option:
 * https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md).
 * A connect-mode flag takes the whole executable out of the argv: with
 * `--browserUrl` / `--wsEndpoint` present there is nothing local to launch, so
 * the path is never appended next to it — the bridge connects, it does not
 * launch.
 */
export function buildServerArgs(entry: ChromeMcpConfig, extraFlags: string[]): string[] {
    const flags = Array.isArray(extraFlags) ? extraFlags.filter((flag): flag is string => typeof flag === "string") : [];
    const args: string[] = usesPinnedServer(entry) ? [pinnedServerCli(), ...flags] : ["-y", entry.package, ...flags];
    // `chromePath` is a volatile field, so what it carries is either a reference
    // or the value a caller handed in explicitly (the resolved selection).
    const executable = readConfigField(entry.chromePath, "").trim();
    if (executable !== "" && !flags.some((flag) => carriesExecutablePath(flag)) && !flagsSkipCheck(flags)) {
        args.push(`--executablePath=${executable}`);
    }
    return args;
}

/**
 * Default location of the bridge stderr log — `@comecaramelos/dsh-ancesters`'
 * private per-host directory (`mkdtemp`, mode `0700`), one
 * `<serverName>-bridge.log` per bridge, truncated on every spawn. Nothing in it
 * can be planted by another local principal before the first spawn.
 *
 * `options.tmpdir` keeps a flat, deterministic name for tests and diagnostics.
 * @param serverName - the bridge server namespace.
 * @param options - tmpdir/pid overrides for tests and diagnostics.
 */
export function bridgeStderrLogPath(serverName: unknown, options: BridgeStderrLogPathOptions = {}): string {
    return stderrLogPath(serverName, options);
}

/**
 * Build the stdio spawn target for one bridge run, honouring the effective
 * stderr mode. The MCP stdio transport spawns the child with the default
 * `stderr: "inherit"`, so every line it prints lands on the dsh console.
 * "log" (default) launches the argv through ancestros' Node wrapper (D5:
 * `process.execPath` + a shipped script, the same route on Linux, WSL and
 * Windows): stdout keeps flowing as the MCP protocol stream, stderr goes to
 * the log file, the argv reaches the child verbatim. "console" returns the raw
 * command/args (inherited console output).
 * @param target - { command, args, stderr?, logPath?, serverName? }.
 * @param options - execPath/tmpdir/pid overrides for tests.
 * @returns { command, args, redirect } — the log file when redirected, "" when
 * the console echoes. There is no fallback left: Node is always there.
 */
export function buildBridgeSpawn(target: BridgeSpawnTarget, options: BridgeSpawnOptions = {}): BridgeSpawnResult {
    const mode: BridgeStderrMode = target.stderr === void 0 ? "log" : target.stderr;
    return buildSpawn(
        {
            command: target.command,
            args: [...target.args],
            stderr: mode,
            ...(typeof target.logPath === "string" && target.logPath !== "" ? { logPath: target.logPath } : {}),
            serverName: target.serverName ?? "bridge"
        },
        options
    );
}

/**
 * stdio config for the nested mcp-client bridge for one flags list + effective
 * stderr mode. The args keep the user's original logical invocation shape
 * (`npx -y <package> [extraFlags]`, run as `command`), wrapped through
 * {@link buildBridgeSpawn} so the child's stderr lands in a log file instead of
 * the console when the mode is "log". The returned config carries only
 * dsh-mcp-client fields; `redirect` describes the wrapper for the
 * host's own diagnostics.
 */
export function bridgeConfig(entry: ChromeMcpConfig, extraFlags: string[], stderrMode?: BridgeStderrMode) {
    const spawned = buildBridgeSpawn(
        {
            command: serverCommand(entry),
            args: buildServerArgs(entry, extraFlags),
            stderr: stderrMode === void 0 ? entry.bridgeStderr : stderrMode,
            logPath: entry.bridgeStderrLog,
            serverName: entry.serverName
        },
        {}
    );
    const config: McpClient.StdioConfig = {
        serverName: entry.serverName,
        transport: "stdio",
        command: spawned.command,
        args: spawned.args,
        env: entry.env,
        cwd: entry.cwd,
        toolCallTimeoutMs: entry.toolCallTimeoutMs,
        maxInstructionBytes: entry.maxInstructionBytes,
        failOnStartupError: entry.failOnStartupError,
        reconnect: entry.reconnect
    };
    return { config, redirect: spawned.redirect };
}

/**
 * Wrap a logger so a callback observes every level call before the
 * original runs. Used to capture the nested bridge's own log lines (the only
 * surface dsh-mcp-client exposes for connection failures — reconnect
 * backoff warnings, spawn failures, give-ups) into the live mirror.
 * The wrapper shares the underlying LoggerService (exporters/buffer included)
 * and only shadows the level methods.
 * @param base - the base logger to wrap (cordis LoggerService).
 * @param note - callback invoked for every log level before the original runs.
 */
export function captureLogger(
    base: Record<string, (...args: unknown[]) => unknown>,
    note: (level: string, args: unknown[]) => void
): Record<string, (...args: unknown[]) => unknown> {
    const wrapper: Record<string, (...args: unknown[]) => unknown> = ((...args: unknown[]) => {
        const callBase = base as unknown as (...args: unknown[]) => unknown;
        return callBase(...args);
    }) as unknown as Record<string, (...args: unknown[]) => unknown>;
    Object.setPrototypeOf(wrapper, Object.getPrototypeOf(base));
    Object.assign(wrapper, base);
    for (const level of LOG_LEVELS) {
        wrapper[level] = (...args: unknown[]) => {
            note(level, args);
            return (base[level] as (...args: unknown[]) => unknown)?.(...args);
        };
    }
    return wrapper;
}
