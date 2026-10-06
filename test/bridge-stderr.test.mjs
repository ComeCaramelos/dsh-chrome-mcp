// Tests for bridge-stderr capture (lib/index.js buildBridgeSpawn /
// bridgeStderrLogPath / resolveStderrMode / readPersistedStderrMode). The
// console noise comes from the MCP stdio transport spawning `npx` with
// inherited stderr; the wrapper must preserve the logical `npx -y <package>
// [extraFlags]` invocation while sending only stderr to a log file (stdout
// stays the MCP protocol stream). Mirrors the reference plugin's gateway
// stderr capture.
// Run: node test/bridge-stderr.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bridgeStderrLogPath, buildBridgeSpawn, readPersistedStderrMode, resolveStderrMode } from "../lib/index.js";

// ── effective-mode resolution: UI toggle > row config, never a third state ──
assert.equal(resolveStderrMode("log", "console"), "log", "explicit log override wins over row config console");
assert.equal(resolveStderrMode("console", "log"), "console", "explicit console override wins over row config log");
assert.equal(resolveStderrMode("", "console"), "console", "untouched toggle falls back to row config");
assert.equal(resolveStderrMode("", "log"), "log", "untouched toggle + default row config = capture");
assert.equal(resolveStderrMode(void 0, "log"), "log", "missing override falls back");
assert.equal(resolveStderrMode("bogus", "log"), "log", "invalid override is ignored, not trusted");
{
	const settings = (section) => ({ get: (name) => (name === "settings" ? { document: { "chrome-mcp": section } } : void 0) });
	assert.equal(readPersistedStderrMode(settings({ stderrMode: "console" })), "console", "persisted console selection");
	assert.equal(readPersistedStderrMode(settings({ stderrMode: "log" })), "log", "persisted log selection");
	assert.equal(readPersistedStderrMode(settings({ stderrMode: "" })), "", "empty persisted value means auto");
	assert.equal(readPersistedStderrMode(settings({ stderrMode: "bogus" })), "", "invalid persisted value ignored");
	assert.equal(readPersistedStderrMode(settings({})), "", "absent field means auto");
	assert.equal(readPersistedStderrMode(settings(void 0)), "", "absent section means auto");
	assert.equal(readPersistedStderrMode({ get: () => void 0 }), "", "no settings service means auto (onChange applies later)");
}

const target = { command: "npx", args: ["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics", "--no-performance-crux"] };
const options = { platform: "linux", exists: (candidate) => candidate === "/bin/sh", tmpdir: "/tmp", pid: 4321 };

// Default mode: wrapped in sh -c, npx argv preserved, stderr -> log file.
let built = buildBridgeSpawn(target, options);
assert.equal(built.command, "/bin/sh");
assert.equal(built.args[0], "-c");
assert.equal(built.args[2], "chrome-devtools-mcp");
assert.equal(built.args[3], "npx");
assert.equal(built.args[4], "/tmp/dsh-chrome-mcp-bridge-bridge-4321.log");
assert.deepEqual(built.args.slice(5), target.args);
assert.equal(built.redirect, "/tmp/dsh-chrome-mcp-bridge-bridge-4321.log");
assert.equal(built.fallback, "");

// The script keeps stdout (the protocol stream) and only routes stderr.
assert.match(built.args[1], /exec "\$BRIDGE" "\$@" 2>\"\$LOG\"/);
// A missing executable fails loud with 127 + a message ON stderr.
assert.match(built.args[1], /exit 127/);

// console mode: raw command/args, no redirect, no fallback.
built = buildBridgeSpawn({ ...target, stderr: "console" }, options);
assert.equal(built.command, "npx");
assert.deepEqual(built.args, target.args);
assert.equal(built.redirect, "");
assert.equal(built.fallback, "");

// Platform without a known POSIX shell: identity + platform fallback.
built = buildBridgeSpawn(target, { ...options, platform: "win32" });
assert.equal(built.command, "npx");
assert.deepEqual(built.args, target.args);
assert.equal(built.fallback, "platform");

// No sh found: identity + shell fallback.
built = buildBridgeSpawn(target, { ...options, exists: () => false });
assert.equal(built.command, "npx");
assert.deepEqual(built.args, target.args);
assert.equal(built.fallback, "shell");

// logPath override wins over the default.
built = buildBridgeSpawn({ ...target, logPath: "/custom/path/b.log" }, options);
assert.equal(built.args[4], "/custom/path/b.log");
assert.equal(built.redirect, "/custom/path/b.log");

// serverName shapes the default path.
const named = bridgeStderrLogPath("chrome-tools", { tmpdir: "/tmp", pid: 7 });
assert.equal(named, "/tmp/dsh-chrome-mcp-chrome-tools-bridge-7.log");

// Default derivation (no tmpdir override) must NOT be a predictable name in
// the world-writable temp namespace: it lands inside a private directory
// created exclusively for this host process (audit run-1 C-1 — a sink named
// from `serverName` + `pid` is one symlink any local principal can plant).
{
	const first = bridgeStderrLogPath("chrome", {});
	const second = bridgeStderrLogPath("chrome", {});
	assert.equal(first, second, "the sink path is stable for the host process — no directory churn per spawn");
	assert.equal(first.includes(`-bridge-${process.pid}.log`), false, "the path carries no pid anyone can predict");
	const sinkDir = path.dirname(first);
	assert.equal(sinkDir !== path.resolve(os.tmpdir()), true, "the sink lives inside a directory of its own, not in the temp root");
	assert.equal(path.basename(sinkDir).startsWith("dsh-chrome-mcp-"), true, "the private directory carries the plugin prefix");
	if (process.platform === "linux" || process.platform === "darwin") {
		const dirMode = fs.statSync(sinkDir).mode & 0o777;
		assert.equal(dirMode, 0o700, "the private directory is owner-only — nothing can be planted next to the sink");
	}
	if (fs.existsSync(sinkDir) && fs.readdirSync(sinkDir).length === 0) fs.rmdirSync(sinkDir);
}

// A chromePath pin (--executablePath=…) stays part of the preserved argv tail.
built = buildBridgeSpawn({ ...target, args: [...target.args, "--executablePath=/usr/bin/google-chrome"] }, options);
assert.deepEqual(built.args.slice(5), [...target.args, "--executablePath=/usr/bin/google-chrome"]);

// ── Integration: a real sh spawn keeps stdout clean and writes stderr to
// the log file, proving the transport-visible protocol stream survives and
// only stderr is diverted.
if (process.platform === "linux" || process.platform === "darwin") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-chm-stderr-"));
	try {
		const logPath = path.join(dir, "bridge.log");
		const fake = path.join(dir, "npx");
		fs.writeFileSync(fake, "#!/bin/sh\nprintf 'PROTO-OK\\n'\nprintf 'NOISE-LINE\\n' >&2\nexit 0\n");
		fs.chmodSync(fake, 0o755);
		const wrapped = buildBridgeSpawn({ command: fake, args: ["-y", "chrome-devtools-mcp@latest", "--headless"], stderr: "log", logPath });
		let stdout = "";
		const code = await new Promise((resolve) => {
			const child = spawn(wrapped.command, wrapped.args, { stdio: ["ignore", "pipe", "ignore"] });
			child.stdout.on("data", (chunk) => (stdout += String(chunk)));
			child.once("close", resolve);
			child.once("error", () => resolve(-1));
		});
		assert.equal(code, 0, "wrapped bridge exited 0");
		assert.equal(stdout, "PROTO-OK\n", "stdout (the protocol stream) reaches the transport untouched");

		const logged = fs.readFileSync(logPath, "utf8");
		assert.ok(logged.includes("NOISE-LINE"), "stderr landed in the log file");

		// argv preserved verbatim across the wrapper.
		const argvFake = path.join(dir, "argv-echo");
		const argvLog = path.join(dir, "argv.log");
		fs.writeFileSync(argvFake, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 0\n");
		fs.chmodSync(argvFake, 0o755);
		const argvWrapped = buildBridgeSpawn({ command: argvFake, args: ["-y", "chrome-devtools-mcp@latest", "--user-data dir"] , stderr: "log", logPath: argvLog });
		const echoed = await new Promise((resolve, reject) => {
			const child = spawn(argvWrapped.command, argvWrapped.args, { stdio: ["ignore", "pipe", "ignore"] });
			let out = "";
			child.stdout.on("data", (chunk) => (out += String(chunk)));
			child.once("close", () => resolve(out));
			child.once("error", reject);
		});
		assert.equal(echoed, "-y\nchrome-devtools-mcp@latest\n--user-data dir\n", "argv preserved verbatim (a space inside one flag value stays a single entry)");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

console.log("bridge-stderr.test.mjs: all assertions passed");
