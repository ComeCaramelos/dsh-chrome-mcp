/**
 * The nested `dsh-mcp-client` bridge: its stdio argv + config, the stderr
 * capture wrapper, and the logger wrapper that captures its own log lines into
 * the settings base layer.
 *
 * The bridge's *logical* argv is the public contract the tests and the README
 * quote — `npx -y <package> [extraFlags]`, with `--executablePath=<chromePath>`
 * appended only when a path is configured and the flags list does not already
 * pin an executable. In the default "log" stderr mode that argv is not spawned
 * raw: {@link buildBridgeSpawn} wraps it in a `sh -c` whose script `exec`s the
 * argv positionally (so the child never sees the wrapper) and redirects only
 * stderr into a per-spawn log file, leaving stdout to carry the MCP protocol
 * stream. Without this wrapper every startup/progress line npx prints would
 * land directly on the dsh console — exactly what makes the connection feel
 * loud. "console" mode spawns the argv unwrapped (inherited stderr, debug).
 *
 * The logger wrapper exists because dsh-mcp-client reports connection problems
 * only through `ctx.logger`: without it the card would never surface a
 * failed/recovered bridge.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LOG_LEVELS, SH_PATH_CANDIDATES } from "./constants.js";
import { carriesExecutablePath, flagsSkipCheck } from "./flags.js";
import type * as McpClient from "@deepseek-ai/dsh-mcp-client";

import type {
    BridgeSpawnOptions,
    BridgeSpawnResult,
    BridgeSpawnTarget,
    BridgeStderrLogPathOptions,
    BridgeStderrMode,
    ChromeMcpConfig
} from "./types/index.js";

/**
 * The `sh -c` script behind a redirecting bridge spawn: keep stdout as the MCP
 * protocol stream (only stdout carries it), send stderr to the captured log
 * file, and fail with 127 (and a message ON stderr) if the executable is
 * missing — otherwise the transport would report a bare exit code and the
 * reason would be buried in the log file.
 */
const BRIDGE_STDERR_SHELL_SCRIPT = [
    'BRIDGE="$1"',
    'LOG="$2"',
    "shift 2",
    'command -v "$BRIDGE" >/dev/null 2>&1 || { echo "chrome-devtools-mcp: bridge executable not found: $BRIDGE" >&2; exit 127; }',
    'exec "$BRIDGE" "$@" 2>"$LOG"'
].join("; ");

/**
 * Build the stdio argv tail for one flags list:
 * `-y <package> [extraFlags]`, the argv tail {@link buildBridgeSpawn} runs, so
 * the logical invocation is `npx -y chrome-devtools-mcp@latest [extraFlags]`.
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
    const args: string[] = ["-y", entry.package, ...flags];
    const executable = typeof entry.chromePath === "string" ? entry.chromePath.trim() : "";
    if (executable !== "" && !flags.some((flag) => carriesExecutablePath(flag)) && !flagsSkipCheck(flags)) {
        args.push(`--executablePath=${executable}`);
    }
    return args;
}

/** Prefix of the private per-host directory the stderr sinks live in. */
const PRIVATE_DIR_PREFIX = "dsh-chrome-mcp-";

/** The private directory, created once per host process. Module-level so a
 * later spawn reuses the very same directory instead of littering tmp. */
let privateDir = "";

/**
 * Default location of the bridge stderr log: **one private directory per host
 * process**, created exclusively (`mkdtemp`) and mode `0700`, holding one log
 * per bridge (`<serverName>-bridge.log`). The wrapper truncates it on every
 * spawn, so it always holds the latest bridge session's output.
 *
 * Nothing here is predictable: neither the directory name nor the file inside
 * it can be planted by another local principal before the first spawn, and
 * every redirect stays inside the private directory (`2>"$LOG"` with `$LOG`
 * pointing at it — a plain `O_WRONLY|O_CREAT|O_TRUNC` redirect there can only
 * create or truncate what the owner already owns).
 *
 * `options.tmpdir` keeps the old flat naming for tests and diagnostics, so a
 * caller that needs a deterministic path still gets one.
 * @param serverName - the bridge server namespace.
 * @param options - tmpdir/pid overrides for tests and diagnostics.
 */
export function bridgeStderrLogPath(serverName: unknown, options: BridgeStderrLogPathOptions = {}): string {
    const safe = typeof serverName === "string" ? serverName.replace(/[^A-Za-z0-9_-]/gu, "-") : "bridge";
    if (typeof options.tmpdir === "string" && options.tmpdir !== "") {
        const pid = options.pid === void 0 ? process.pid : options.pid;
        return path.join(options.tmpdir, `dsh-chrome-mcp-${safe}-bridge-${pid}.log`);
    }
    if (privateDir === "" || !fs.existsSync(privateDir)) {
        // (Re)create when it was never made or a tmp reaper took it away, so a
        // spawn never redirects stderr into a path that no longer exists.
        try {
            privateDir = fs.mkdtempSync(path.join(os.tmpdir(), PRIVATE_DIR_PREFIX));
        } catch {
            // No private directory is possible (an unwritable tmp, a sandbox
            // that denies the write): fall back to the flat name rather than
            // failing the spawn — a logless bridge is a broken bridge.
            const pid = options.pid === void 0 ? process.pid : options.pid;
            return path.join(os.tmpdir(), `dsh-chrome-mcp-${safe}-bridge-${pid}.log`);
        }
        try {
            fs.chmodSync(privateDir, 0o700);
        } catch {
            // mode bits stay whatever mkdtemp applied (already 0700); a failure
            // here cannot widen access.
        }
    }
    return path.join(privateDir, `${safe}-bridge.log`);
}

/**
 * Build the stdio spawn target for one bridge run, honouring the effective
 * stderr mode. The MCP stdio transport spawns the child with the default
 * `stderr: "inherit"`, so every line it prints lands on the dsh console. "log"
 * (default) wraps the spawn in `sh -c`: stdout keeps flowing as the MCP
 * protocol stream, stderr is redirected into a log file. "console" returns the
 * raw command/args (inherited console output). When no POSIX shell is available
 * the redirect is impossible: the raw command is returned with `fallback` set,
 * and the host's {@link noteStderr} warns once.
 * @param target - { command, args, stderr?, logPath?, serverName? }.
 * @param options - platform/exists/tmpdir/pid overrides for tests.
 * @returns { command, args, redirect, fallback } — the log file when redirected
 * ("" otherwise) and why not ("" when redirected or console).
 */
export function buildBridgeSpawn(target: BridgeSpawnTarget, options: BridgeSpawnOptions = {}): BridgeSpawnResult {
    const raw: BridgeSpawnResult = { command: target.command, args: [...target.args], redirect: "", fallback: "" };
    const mode: BridgeStderrMode = target.stderr === void 0 ? "log" : target.stderr;
    if (mode !== "log") return raw;
    const platform = options.platform === void 0 ? process.platform : options.platform;
    if (platform !== "linux" && platform !== "darwin") return { ...raw, fallback: "platform" };
    const exists =
        options.exists === void 0
            ? (candidate: string) => {
                  try {
                      fs.accessSync(candidate, fs.constants.X_OK);
                      return true;
                  } catch {
                      return false;
                  }
              }
            : options.exists;
    const sh = SH_PATH_CANDIDATES.find((candidate) => exists(candidate));
    if (sh === void 0) return { ...raw, fallback: "shell" };
    const logPath =
        typeof target.logPath === "string" && target.logPath !== ""
            ? target.logPath
            : bridgeStderrLogPath(target.serverName ?? "bridge", options);
    return {
        command: sh,
        args: ["-c", BRIDGE_STDERR_SHELL_SCRIPT, "chrome-devtools-mcp", target.command, logPath, ...target.args],
        redirect: logPath,
        fallback: ""
    };
}

/**
 * stdio config for the nested mcp-client bridge for one flags list + effective
 * stderr mode. The args keep the user's original logical invocation shape
 * (`npx -y <package> [extraFlags]`, run as `command`), wrapped through
 * {@link buildBridgeSpawn} so the child's stderr lands in a log file instead of
 * the console when the mode is "log". The returned config carries only
 * dsh-mcp-client fields; `redirect`/`fallback` describe the wrapper for the
 * host's own diagnostics.
 */
export function bridgeConfig(entry: ChromeMcpConfig, extraFlags: string[], stderrMode?: BridgeStderrMode) {
    const spawned = buildBridgeSpawn(
        {
            command: entry.command,
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
        failOnStartupError: entry.failOnStartupError,
        reconnect: entry.reconnect
    };
    return { config, redirect: spawned.redirect, fallback: spawned.fallback };
}

/**
 * Wrap a logger so a callback observes every level call before the
 * original runs. Used to capture the nested bridge's own log lines (the only
 * surface dsh-mcp-client exposes for connection failures — reconnect
 * backoff warnings, spawn failures, give-ups) into the settings base layer.
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
