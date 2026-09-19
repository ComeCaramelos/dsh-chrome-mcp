/**
 * @comecaramelos/dsh-chrome-mcp — host half.
 *
 * Connects the Chrome DevTools MCP server (`chrome-devtools-mcp`, launched as
 * `npx -y chrome-devtools-mcp@latest [extraFlags]`) as an MCP server through
 * the stock @deepseek-ai/dsh-mcp-client bridge, and exposes the user-facing
 * settings — extra flags, re-check trigger, and error reporting — under the
 * `chrome-mcp` settings namespace: the Web GUI's Plugins settings page
 * renders a card (see ./client.js) keyed by that namespace. Editing the
 * extra flags re-applies the nested mcp-client plugin in place
 * (fiber.update), which restarts the bridge with the new arguments.
 *
 * Persistence boundary: only the user-authored fields land in
 * `$DSH_HOME/settings.yaml` — `extraFlags` (the last UI edit, used to launch
 * on (re)start) and `recheckNonce` (the client→host recheck trigger; a module
 * plugin has no other host channel, `harness.handle` is reserved for
 * code-string halves). Status state (`lastError`, `checkRevision`,
 * `chromeVersion`, `chromeMissing`) rides the composition base layer — served to the client
 * inside the resolved value, held in memory, never persisted.
 *
 * One plugin instance per dsh host: the settings namespace is fixed.
 *
 * Config (cordis row):
 *   serverName          tool namespace prefix       (default "chrome")
 *   command             launcher executable        (default "npx")
 *   package             npm spec to npx            (default "chrome-devtools-mcp@latest")
 *   extraFlags          flags appended after the spec
 *                       (default ["--no-usage-statistics", "--no-performance-crux"])
 *   chromePath          Chrome executable path override appended as
 *                       `--executablePath=<path>`; "" = check discovery
 *                       (see discoverChrome; a non-empty path is probed)
 *   chromePaths         discovery candidate list when chromePath is ""
 *                       (default defaultChromePaths(), mirroring upstream's
 *                       stable-channel locations)
 *   env / cwd / toolCallTimeoutMs / failOnStartupError / reconnect
 *                       passed through to dsh-mcp-client
 */
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";

/** Cordis plugin name used by loader diagnostics. */
const name = "chrome-devtools-mcp";

/** No host services of our own: the nested bridge declares `tools`. */
const inject = [];

/** Fixed settings namespace; also the client card's slot key. */
export const SETTINGS_NAMESPACE = "chrome-mcp";

/**
 * Flag entries are appended verbatim to the bridge argv and reach Chrome via
 * a direct execve (no shell), so shell metacharacters cannot execute here.
 * What must never reach argv is control characters (newlines, NULs) — they
 * corrupt the argument framing, so entries may not contain any.
 */
const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;

/** Flags every launch carries unless the user overrides them. */
export const DEFAULT_EXTRA_FLAGS = ["--no-usage-statistics", "--no-performance-crux"];

/** Upstream configuration docs surfaced by the client card link. */
export const CONFIGURATION_DOCS_URL =
	"https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md";

/** Reconnect policy passthrough; mirrors dsh-mcp-client's schema. */
const Reconnect = z.object({
	enabled: z.boolean().default(true),
	initialDelayMs: z.number().min(1).max(600000).default(500),
	maxDelayMs: z.number().min(1).max(600000).default(30000),
	maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(10)
});

/**
 * Google Chrome stable-channel locations probed by discovery when
 * `chromePath` is empty — mirrors the upstream (puppeteer) system-channel
 * resolution. WSL Windows-side locations (`/mnt/c/...`) are deliberately
 * absent: the interop launch cannot work (see .probe), and reporting a found
 * Windows binary as healthy would be a false negative for the known
 * executable-missing error. Unknown platforms probe nothing.
 */
export const DEFAULT_CHROME_PATHS = {
	linux: [
		"/opt/google/chrome/chrome",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/local/bin/google-chrome",
		"google-chrome"
	],
	darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	win32: [
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
	]
};

/** The default discovery candidate list for one platform; [] probes nothing. */
export function defaultChromePaths(platform = process.platform) {
	const candidates = DEFAULT_CHROME_PATHS[platform];
	return Array.isArray(candidates) ? [...candidates] : [];
}

export const Config = z.object({
	serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/).default("chrome"),
	command: z.string().default("npx"),
	package: z.string().min(1).default("chrome-devtools-mcp@latest"),
	extraFlags: z.array(String).default(["--no-usage-statistics", "--no-performance-crux"]),
	chromePath: z.string().default(""),
	chromePaths: z.array(String).default(defaultChromePaths()),
	env: z.dict(String).default({}),
	cwd: z.string().default(""),
	toolCallTimeoutMs: z.number().default(60000),
	failOnStartupError: z.boolean().default(false),
	reconnect: Reconnect
});

/**
 * User-settings section served to the Web GUI card.
 *
 * Persisted (user layer in `$DSH_HOME/settings.yaml`): `extraFlags` and
 * `recheckNonce`. Served but never persisted (composition base layer held in
 * memory by the host): `lastError`, `checkRevision`, `chromeVersion`, `chromeMissing` — the
 * client's recheck poll stops when the served `checkRevision` advances past
 * its click-time value.
 */
export const SettingsSchema = z.object({
	/** Flags appended after `npx -y <package>`; persisted last UI edit. */
	extraFlags: z.array(String).default(["--no-usage-statistics", "--no-performance-crux"]),
	/** Written by the UI re-check button; the host reacts to its change. */
	recheckNonce: z.number().default(0),
	/** Last check/connection failure, human-readable; empty when healthy. */
	lastError: z.string().default(""),
	/** Known error: the last failure was "no Chrome executable detected". */
	chromeMissing: z.boolean().default(false),
	/** Check run counter (success or failure); completion signal for the client. */
	checkRevision: z.number().default(0),
	/** Chrome executable version discovered by the last check; "" when unknown. */
	chromeVersion: z.string().default("")
});

/** Timeout for one check subprocess (chrome executable probe). */
const CHECK_TIMEOUT_MS = 15000;

/** Max length of a reported error line. */
const ERROR_CAP = 240;

/**
 * Validate a user-authored extraFlags list: a plain array of flag strings
 * carrying no control characters (argv is execve'd without a shell). Throws
 * with the offending entry so the settings layer can surface it.
 * @param value - candidate flags array.
 * @returns true when valid.
 */
export function validateExtraFlags(value) {
	if (!Array.isArray(value)) {
		throw new Error("extraFlags must be an array of strings");
	}
	for (const flag of value) {
		if (typeof flag !== "string" || flag === "") {
			throw new Error("extraFlags entries must be non-empty strings");
		}
		if (CONTROL_PATTERN.test(flag)) {
			throw new Error(`extraFlags entry "${flag}" contains control characters`);
		}
	}
	return true;
}

/** True when a flag already selects the Chrome executable (upstream flags:
 * `--executablePath` / `--executable-path` / `-e`, with or without `=`). */
function carriesExecutablePath(flag) {
	return /^(?:--executablePath|--executable-path|-e)(?:=|(?=\s)|$)/u.test(flag);
}

/**
 * Build the stdio argv tail for one flags list:
 * `-y <package> [extraFlags]`, spawned with `command` (default `npx`), so the
 * final invocation is `npx -y chrome-devtools-mcp@latest [extraFlags]`. When
 * `chromePath` is set and the flags do not already carry an executable-path
 * option, `--executablePath=<path>` is appended (upstream option:
 * https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md).
 */
export function buildServerArgs(entry, extraFlags) {
	const flags = Array.isArray(extraFlags) ? extraFlags.filter((flag) => typeof flag === "string") : [];
	const args = ["-y", entry.package, ...flags];
	const executable = typeof entry.chromePath === "string" ? entry.chromePath.trim() : "";
	if (executable !== "" && !flags.some((flag) => carriesExecutablePath(flag))) {
		args.push(`--executablePath=${executable}`);
	}
	return args;
}

/** True when two flags lists are element-wise equal (flags are arrays). */
export function sameFlags(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	return a.every((flag, index) => flag === b[index]);
}

/** stdio config for the nested mcp-client bridge for one flags list. */
function bridgeConfig(entry, extraFlags) {
	return {
		serverName: entry.serverName,
		transport: "stdio",
		command: entry.command,
		args: buildServerArgs(entry, extraFlags),
		env: entry.env,
		cwd: entry.cwd,
		toolCallTimeoutMs: entry.toolCallTimeoutMs,
		failOnStartupError: entry.failOnStartupError,
		reconnect: entry.reconnect
	};
}

/** First non-empty line of a text block, capped. */
function firstLine(text, cap = ERROR_CAP) {
	const line = String(text ?? "")
		.split(/\r?\n/u)
		.find((candidate) => candidate.trim() !== "") ?? "";
	return line.trim().slice(0, cap);
}


/** True when one extraFlag declares a connect mode (no local executable). */
function carriesConnectionMode(flag) {
	return /^--(?:browserUrl|wsEndpoint)(?:=|(?=\s)|$)/iu.test(flag);
}

/**
 * Spawn one `chromePath --version` probe (scrubbed parent env, bounded
 * timeout). Resolves the first stdout line (the version); ENOENT rejects with
 * "Chrome executable not found: <path>" carrying code "ENOENT"; a non-zero
 * exit rejects with the first non-empty stderr/stdout line.
 */
function probeExecutable(target) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(target, ["--version"], {
				env: scrubbedParentEnv(),
				stdio: ["ignore", "pipe", "pipe"],
				timeout: CHECK_TIMEOUT_MS,
				killSignal: "SIGKILL"
			});
		} catch (error) {
			reject(new Error(`could not run "${target} --version": ${String(error)}`));
			return;
		}
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) => {
			const code = error && typeof error.code === "string" ? error.code : "";
			if (code === "ENOENT") {
				const missing = new Error(`Chrome executable not found: ${target}`);
				missing.code = "ENOENT";
				reject(missing);
				return;
			}
			reject(new Error(`could not run "${target} --version": ${String(error)}`));
		});
		child.on("close", (code) => {
			if (code === null) {
				reject(new Error(`"${target} --version" timed out after ${String(CHECK_TIMEOUT_MS)}ms`));
				return;
			}
			if (code !== 0) {
				const detail =
					firstLine(stderr) !== "" ? firstLine(stderr) : firstLine(stdout) !== "" ? firstLine(stdout) : `exit code ${String(code)}`;
				reject(new Error(`"${target} --version" failed: ${detail}`));
				return;
			}
			resolve(firstLine(stdout));
		});
	});
}

/**
 * Discover a usable Google Chrome executable when `chromePath` is empty:
 * spawn `--version` for every candidate in order. The first runnable
 * candidate resolves its version line. A candidate that exists but is not
 * usable (non-ENOENT failure) reports that detail — the binary is there and
 * broken. All candidates ENOENT reject with the known executable-not-found
 * error listing the checked paths. An empty candidate list resolves "" —
 * nothing probed (unknown platform).
 * @param candidatePaths - candidate executable paths (default: platform list).
 * @returns the discovered executable version line.
 */
export async function discoverChrome(candidatePaths) {
	const candidates = (Array.isArray(candidatePaths) ? candidatePaths : defaultChromePaths())
		.map((candidate) => String(candidate ?? "").trim())
		.filter((candidate) => candidate !== "");
	if (candidates.length === 0) return "";
	let presentFailure = "";
	for (const candidate of candidates) {
		try {
			return await probeExecutable(candidate);
		} catch (error) {
			const code = error && typeof error.code === "string" ? error.code : "";
			if (code === "ENOENT") continue;
			if (presentFailure === "") presentFailure = error instanceof Error ? error.message : String(error);
		}
	}
	if (presentFailure !== "") throw new Error(presentFailure);
	throw new Error(`Chrome executable not found: no executable detected (checked: ${candidates.join(", ")})`);
}

/**
 * Probe one check run:
 *
 * - `chromePath` non-empty → probe that executable (ENOENT → "Chrome
 *   executable not found: <path>"; non-zero → first stderr/stdout line;
 *   success → the version line).
 * - `chromePath` empty → run {@link discoverChrome} over the candidate list
 *   (row-config `chromePaths`, default {@link defaultChromePaths}). Nothing
 *   usable → the known executable-missing error; a found executable resolves
 *   its version line.
 * - the extra flags already pin an executable (`--executablePath`, …) or a
 *   connect mode (`--browserUrl` / `--wsEndpoint`) → resolve "": the bridge
 *   resolves the executable (or needs none) itself; nothing left to check.
 *
 * NOTE: from WSL the executable must be a Linux binary. Launching the
 * Windows chrome.exe through the WSL interop layer fails: chrome-devtools-mcp
 * connects with `pipe: true` (inherited fd 3/4), and Windows-side processes
 * cannot receive those pipes from WSL; the WebSocket fallback hard-codes
 * 127.0.0.1 in the DevToolsActivePort file, unreachable across the WSL2 NAT
 * bridge. Verified empirically 2025-09-19; do not "fix" discovery by pointing
 * candidates or chromePath at a /mnt/c executable.
 * @param entry - validated {@link Config}.
 * @param extraFlags - the flags list the bridge currently launches with; only
 *   inspected for pinning/connect-mode options.
 * @returns the executable version line, or "" when nothing is probed.
 */
export function checkChrome(entry, extraFlags) {
	const target = typeof entry.chromePath === "string" ? entry.chromePath.trim() : "";
	if (target !== "") return probeExecutable(target);
	const flags = Array.isArray(extraFlags)
		? extraFlags
		: Array.isArray(entry.extraFlags)
			? entry.extraFlags
			: [];
	if (flags.some((flag) => typeof flag === "string" && (carriesExecutablePath(flag) || carriesConnectionMode(flag)))) {
		return Promise.resolve("");
	}
	return discoverChrome(entry.chromePaths);
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
export function isChromeMissing(text) {
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
export function toolResultNote(toolName, result) {
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

/**
 * Environment variable that seeds the launch flags for one dsh run: a
 * whitespace-separated extraFlags list, e.g.
 * `DSH_CHROME_MCP_FLAGS="--headless --isolated"`.
 */
export const FLAGS_ENV_VAR = "DSH_CHROME_MCP_FLAGS";

/**
 * Parse a whitespace-separated flags list from the environment.
 * @param configured - the row config `extraFlags` value.
 * @param envValue - `DSH_CHROME_MCP_FLAGS` as seen in the launch env.
 * @returns the env flags when the value is a non-empty string whose every
 * entry is valid, else `configured` (the caller decides on warnings).
 */
export function resolveEnvFlags(configured, envValue) {
	if (typeof envValue !== "string" || envValue.trim() === "") return configured;
	const flags = envValue.split(/\s+/u).filter((flag) => flag !== "");
	try {
		validateExtraFlags(flags);
	} catch {
		return configured;
	}
	return flags;
}

/**
 * Read the last UI-selected extraFlags list from the persisted user layer
 * when the settings service is already up and the stored value is valid.
 * The host consults this before the first bridge spawn so the very first
 * connection launches with the persisted flags — and every in-process
 * reconnect, which reuses the bridge config, comes back on them as well.
 * @param ctx - plugin context.
 * @returns the persisted flags array, or undefined when absent, invalid, or
 * the settings service is not available yet (the installSection initial
 * onChange then applies the persisted selection in place).
 */
export function readPersistedFlags(ctx) {
	try {
		const settings = ctx.get("settings");
		const section = settings?.document?.[SETTINGS_NAMESPACE];
		if (section === null || typeof section !== "object" || Array.isArray(section)) return void 0;
		const value = section.extraFlags;
		if (Array.isArray(value) && value.every((flag) => typeof flag === "string" && flag !== "")) {
			return [...value];
		}
	} catch {
		// settings service not available yet: row config defaults apply.
	}
	return void 0;
}

/**
 * Wrap a logger callable so a callback observes every level call before the
 * original runs. Used to capture the nested bridge's own log lines (the only
 * surface dsh-mcp-client exposes for connection failures — reconnect
 * backoff warnings, spawn failures, give-ups) into the settings base layer.
 * The wrapper shares the underlying LoggerService (exporters/buffer included)
 * and only shadows the level methods.
 */
export function captureLogger(base, note) {
	const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
	const wrapper = (...args) => base(...args);
	if (base && typeof base === "object") Object.setPrototypeOf(wrapper, Object.getPrototypeOf(base));
	Object.assign(wrapper, base);
	for (const level of levels) {
		wrapper[level] = (...args) => {
			note(level, args);
			return base?.[level]?.(...args);
		};
	}
	return wrapper;
}

/** Log lines the bridge emits after a lost connection recovered — clear
 * the captured connection error when one shows up. */
const BRIDGE_RECONNECTED = /reconnected and re-synced tools/u;

/**
 * Mount the Chrome DevTools MCP server bridge and its settings-backed card.
 * Flags precedence: settings user layer (UI edit) > FLAGS_ENV_VAR (launch
 * env) > row config `extraFlags` > schema default.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
function apply(ctx, config) {
	const ns = SETTINGS_NAMESPACE;
	const envValue = launchEnvironmentOf(ctx).get(FLAGS_ENV_VAR)?.value;
	const baseFlags = resolveEnvFlags(config.extraFlags, envValue);
	if (typeof envValue === "string" && envValue.trim() !== "" && baseFlags === config.extraFlags) {
		ctx.logger.warn(`chrome-devtools-mcp(${config.serverName}): ignoring ${FLAGS_ENV_VAR} — invalid flags list; using row config`);
	}
	// The persisted UI selection wins over env/row config: seed the first
	// bridge spawn with it. When the settings service is not up yet this
	// yields the base flags, and the installSection initial onChange below
	// switches the bridge to the persisted selection in place right after.
	const initialFlags = readPersistedFlags(ctx) ?? baseFlags;

	// Composition base layer: part of the resolved value served to the client
	// but never persisted. Check/connection status lives here, in memory.
	const entry = {
		extraFlags: initialFlags,
		recheckNonce: 0,
		lastError: "",
		chromeMissing: false,
		checkRevision: 0,
		chromeVersion: ""
	};
	/** Live resolved settings value; swapped by installSection hooks. */
	let source = () => entry;
	/** Flags the nested bridge currently launches with. */
	let runningFlags = initialFlags;
	/** Last recheckNonce observed; undefined until the first settings commit. */
	let lastNonce = void 0;
	/** Serializes check runs so rapid rechecks never interleave. */
	let checks = Promise.resolve();

	/**
	 * One executable check; the result lands in the base layer (in memory).
	 * The client reads the base layer fresh on every describe read, and polls
	 * the shared describe mirror for the advance — via the re-check button and
	 * via a one-time startup catch-up poll, since the registration-time check
	 * lands after the card's first read.
	 */
	const runCheck = () => {
		checks = checks
			.then(async () => {
				try {
					const live = source();
					const version = await checkChrome({
						...config,
						extraFlags: Array.isArray(live.extraFlags) ? live.extraFlags : config.extraFlags
					});
					entry.chromeVersion = version;
					// Nothing-to-check ("") must not clear captured bridge/tool
					// status (the known "executable missing" error included);
					// only a probed/discovered success proves health.
					if (version !== "") {
						entry.lastError = "";
						entry.chromeMissing = false;
					}
				} catch (error) {
					entry.lastError = firstLine(error instanceof Error ? error.message : String(error));
					entry.chromeMissing = isChromeMissing(entry.lastError);
					ctx.logger.warn(`chrome-devtools-mcp(${config.serverName}): check failed: ${entry.lastError}`);
				}
				entry.checkRevision += 1;
			})
			.catch(() => {});
		return checks;
	};

	/**
	 * Mirror bridge log lines into the base layer. dsh-mcp-client reports
	 * connection problems only through its logger (reconnect warnings with
	 * "connection failed/lost", give-up errors, spawn failures), and a
	 * module plugin has no push channel to clients — so the newest failure
	 * line becomes `lastError`, and the "reconnected and re-synced tools"
	 * success line clears it. The wrapper lives only on the bridge scope;
	 * our own logs bypass it, and our own warns never masquerade as
	 * connection errors.
	 */
	const noteBridgeLog = (level, args) => {
		const message = args
			.map((arg) => (arg instanceof Error ? (arg.stack ?? arg.message ?? String(arg)) : String(arg)))
			.join(" ");
		if (level === "error" || level === "warn") {
			entry.lastError = firstLine(message);
			// Classify the captured line: an executable-discovery or launch
			// failure is the known "Chrome not found" state (chromeMissing).
			// It is UI-surfaced exactly like any other error — the card's red
			// status dot with the full message as its title (no badge).
			entry.chromeMissing = isChromeMissing(message);
		} else if (level === "info" && BRIDGE_RECONNECTED.test(message)) {
			entry.lastError = "";
			entry.chromeMissing = false;
		}
	};

	// Tool-level status: chrome MCP tool failures (browser unreachable,
	// "Target closed", …) are returned to the calling agent and never reach
	// the bridge logger, so without this hook the card would show a clean
	// status while tools fail. Failed calls store the note; any successful
	// chrome-tool call clears it — the card tracks current health. Registered
	// plainly on this ctx: untagged listeners pass the tools-scoped waterfall
	// filter globally, for every agent (prevalent production pattern:
	// dsh-hooks-codex / dsh-tool-fs-search).
	const toolPrefix = `mcp__${config.serverName}__`;
	ctx.on("tools/post-execute", async (exec, result, next) => {
		try {
			if (typeof exec.name === "string" && exec.name.startsWith(toolPrefix)) {
				const note = toolResultNote(exec.name, result);
				entry.lastError = note ?? "";
				entry.chromeMissing = note === null ? false : isChromeMissing(note);
			}
		} catch (error) {
			ctx.logger.warn(`chrome-devtools-mcp(${config.serverName}): tool status capture failed: ${String(error)}`);
		}
		return next();
	});

	// Initial connection with the resolved flags. The bridge scope shadows
	// `logger` (cordis `extend` semantics: own props shadow inherited ones,
	// parent untouched) so only the bridge's own log lines route through
	// noteBridgeLog; our own logs stay on the original logger.
	const bridgeScope = ctx.extend({ logger: captureLogger(ctx.logger, noteBridgeLog) });
	const bridge = bridgeScope.plugin(McpClient, bridgeConfig(config, initialFlags));

	/** Re-apply the nested bridge with one flags list; failures logged, never thrown. */
	const applyFlags = (flags) => {
		runningFlags = flags;
		ctx.logger.info(`chrome-devtools-mcp(${config.serverName}): relaunching bridge with flags [${flags.join(" ")}]`);
		Promise.resolve(bridge.update(bridgeConfig(config, flags)))
			.then(() => {
				entry.lastError = "";
				// Intentionally NOT clearing `chromeMissing`: a successful
				// bridge update proves the flags took (clears the captured
				// connection error) but says nothing about the executable —
				// the known not-found flag clears only on a probed success or
				// the reconnect line, and the client dot keeps it visible.
			})
			.catch((error) => ctx.logger.error(`chrome-devtools-mcp(${config.serverName}): flags update failed: ${String(error)}`));
	};

	ctx.inject(["settings"], (settingsCtx) => {
		const settings = settingsCtx.settings;
		settings.installSection(ctx, ns, SettingsSchema, entry, {
			setSource: (next) => {
				source = next;
			},
			validate: (value) => {
				try {
					validateExtraFlags(value.extraFlags);
				} catch (error) {
					throw new Error(`settings "${ns}": ${String(error.message ?? error)}`);
				}
			},
			onChange: () => {
				try {
					const current = source();
					if (!sameFlags(current.extraFlags, runningFlags)) applyFlags(current.extraFlags);
					if (current.recheckNonce !== lastNonce) {
						lastNonce = current.recheckNonce;
						runCheck();
					}
				} catch (error) {
					ctx.logger.error(`chrome-devtools-mcp(${config.serverName}): ${String(error)}`);
				}
			}
		});
	});
}

export { apply, inject, name };
