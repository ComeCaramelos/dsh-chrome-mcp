// Runtime-wiring tests for apply(ctx, config): the `tools/post-execute`
// capture must write chrome-tool failures into the base-layer lastError and
// clear them on the next success. Run: node test/apply.test.mjs.
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

const config = {
	serverName: "chrome",
	command: "npx",
	package: "chrome-devtools-mcp@latest",
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	chromePath: "",
	// Empty candidate list: the empty-chromePath check must not spawn real
	// browser discovery in a unit stub (host determinism).
	chromePaths: [],
	env: {},
	cwd: "",
	toolCallTimeoutMs: 60000,
	failOnStartupError: false,
	// "console" so this stub's argv assertion sees the logical invocation
	// unwrapped (the default "log" capture wrapper is covered separately by
	// the buildBridgeSpawn assertions in parse.test.mjs).
	bridgeStderr: "console",
	bridgeStderrLog: "",
	reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
};

/** Stubbed host ctx surface consumed by apply(). */
function stub(options = {}) {
	const state = { logs: [], bridges: [], updates: [], tools: [], toolHandler: void 0, entry: void 0, hooks: void 0 };
	const logger = { trace() {}, debug() {}, info: log, warn: log, error: log, fatal() {} };
	function log(...args) { state.logs.push(args); }
	const settingsCtx = {
		settings: {
			installSection(_ctx, _ns, _schema, entry, hooks) {
				state.entry = entry;
				state.hooks = hooks;
				hooks.setSource(() => entry);
				hooks.onChange();
			}
		}
	};
	const toolCtx = {
		on(_event, handler) {
			state.toolHandler = handler;
		}
	};
	state.ctx = {
		logger,
		get(key) {
			// A settings service is only "up" (and thus readable/persistable)
			// when the stub says so: without it the host reads row config and
			// cannot persist a seeded selection.
			if (key === "settings" && options.settings) return options.settings;
			// The host resolves the launch environment through this slot, and it
			// is how a test pins "are we under WSL?" without depending on the
			// machine running the suite: a supplied map answers for the whole
			// environment, so an empty one is plain Linux.
			if (key === "launchEnvironment" && options.env !== void 0) {
				const values = options.env;
				return {
					get: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? { value: values[name] } : void 0)
				};
			}
			return void 0;
		},
		on(event, handler) {
			if (event === "tools/post-execute") state.toolHandler = handler;
		},
		extend() {
			return {
				plugin(ctor, bridgeCfg) {
					state.bridges.push(bridgeCfg);
					return {
						update: (cfg) => {
							state.updates.push(cfg);
						}
					};
				}
			};
		},
		inject(deps, callback) {
			if (deps.includes("tools")) callback({ tools: { register: (definition) => state.tools.push(definition) } });
			if (deps.includes("settings")) callback(settingsCtx);
		},
		effect(execute) {
			execute();
			return { dispose: Promise.resolve() };
		}
	};
	return state;
}

const settled = async () => ({ kind: "accept" });

// apply() registers the post-execute listener scoped to the tools service.
const state = stub();
apply(state.ctx, config);
assert.equal(typeof state.toolHandler, "function", "tools/post-execute listener registered");
assert.equal(state.tools.length, 1, "apply registers the Windows Chrome tool alongside the listener");
assert.equal(state.tools[0].name, "prelaunch_windows_chrome", "the public tool name");
assert.equal(state.bridges.length, 1, "one bridge mounted");
assert.deepEqual(state.bridges[0].args, ["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics", "--no-performance-crux"], "bridge argv shape fixed");

// The registration run probes the whole candidate list and what the selection
// points at (nothing here: empty chromePath + empty candidate list → nothing
// probed, no statuses).
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(state.entry.chromeVersion, "", "empty chromePath probes nothing");
assert.equal(state.entry.executableDiscoveryRevision, 1, "registration ran one executable run");
assert.deepEqual(state.entry.executableStatus, [], "nothing found → no answers to render");
assert.deepEqual(state.entry.executables, [], "nothing merged → no saved rows");
assert.equal(state.entry.effectiveChromePath, "", "nothing resolved → no effective path");
assert.equal(state.entry.effectiveSource, "", "nothing resolved → no source");
assert.deepEqual(
	state.entry.defaultExtraFlags,
	["--no-usage-statistics", "--no-performance-crux"],
	"the base layer carries the canonical defaults list the card's restore control recovers"
);
assert.deepEqual(
	state.entry.wslExtraFlags,
	["--chromeArg=--remote-debugging-port=9222"],
	"and the recommended WSL flag the card's Flags WSL control appends"
);

// A failed chrome-tool call stores "<tool> failed: ..." in the base layer.
await state.toolHandler(
	{ name: "mcp__chrome__new_page" },
	{ isError: true, content: [{ type: "text", text: "Protocol error (Target.setDiscoverTargets): Target closed" }] },
	settled
);
assert.equal(
	state.entry.lastError,
	"new_page failed: Protocol error (Target.setDiscoverTargets): Target closed",
	"failed chrome-tool call surfaces on the card"
);

// A successful chrome-tool call clears it (current health, not history).
await state.toolHandler({ name: "mcp__chrome__list_pages" }, { content: [{ type: "text", text: "[]" }] }, settled);
assert.equal(state.entry.lastError, "", "success clears the tool note");

// Calls outside this server's namespace must not touch the status.
state.entry.lastError = "keep me";
await state.toolHandler({ name: "bash" }, { isError: true, content: [{ type: "text", text: "boom" }] }, settled);
assert.equal(state.entry.lastError, "keep me", "non-chrome tools ignored");

// The listener passes the tool decision through unchanged.
const decision = await state.toolHandler(
	{ name: "mcp__chrome__take_screenshot" },
	{ isError: true, content: [{ type: "text", text: "MCP error -32602" }] },
	settled
);
assert.equal(decision.kind, "accept", "decision passes through");
assert.equal(state.entry.lastError, "take_screenshot failed: MCP error -32602", "validation failure surfaces too");

// The known error: a launch-failure chrome-tool note flags chromeMissing so
// the client can badge the card header; the next success clears the flag.
await state.toolHandler(
	{ name: "mcp__chrome__new_page" },
	{ isError: true, content: [{ type: "text", text: "Failed to launch the browser process" }] },
	settled
);
assert.equal(state.entry.chromeMissing, true, "launch-failure note flags the known executable-missing error");
await state.toolHandler({ name: "mcp__chrome__list_pages" }, { content: [{ type: "text", text: "[]" }] }, settled);
assert.equal(state.entry.chromeMissing, false, "chrome-tool success clears the known-error flag");
await state.toolHandler(
	{ name: "mcp__chrome__navigate_page" },
	{ isError: true, content: [{ type: "text", text: "Could not find Chrome (ver. 139.0.7258.0)" }] },
	settled
);
assert.equal(state.entry.chromeMissing, true, "upstream discovery failure also flags the known error");

// **Search executables** re-runs the same work on demand: the run counter
// advances, and a run that probes nothing (an empty selection) must not clear
// the captured state — the absence is discovered upstream, so silence is not
// proof of health.
state.entry.lastError = "Chrome executable not found: /nope/chrome";
state.entry.chromeMissing = true;
const revisionBefore = state.entry.executableDiscoveryRevision;
state.entry.refreshExecutablesNonce = 1;
state.hooks.onChange();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(state.entry.executableDiscoveryRevision, revisionBefore + 1, "the search action counted");
assert.equal(state.entry.lastError, "Chrome executable not found: /nope/chrome", "a no-probe run leaves captured errors alone");
assert.equal(state.entry.chromeMissing, true, "a no-probe run leaves the known-error flag alone");

// Saving rows is a list change, not a connection change: the bridge is not
// restarted with a new executable, and the run counter advances.
{
	const rows = stub();
	apply(rows.ctx, { ...config, chromePaths: [] });
	await new Promise((resolve) => setTimeout(resolve, 5));
	const updatesBefore = rows.updates.length;
	const revisionBefore = rows.entry.executableDiscoveryRevision;
	rows.entry.executables = [{ id: "/nonexistent-dir/row-should-not-exist", name: "saved" }];
	rows.hooks.onChange();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(rows.entry.executableDiscoveryRevision, revisionBefore + 1, "a rows change ran a refresh");
	assert.equal(rows.updates.length, updatesBefore, "a rows change did not restart the bridge with a new argv");
}

// Chrome not installed: a run over a deterministic absent candidate list (what
// a host without Chrome does by default) flags the known executable-missing
// state at registration — no tool call needed, because upstream only starts the
// browser lazily on tool calls.
{
	const missing = stub();
	apply(missing.ctx, { ...config, chromePaths: ["/nonexistent-dir/chrome-should-not-exist"] });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(
		missing.entry.lastError,
		"Chrome executable not found: no executable detected (checked: /nonexistent-dir/chrome-should-not-exist)",
		"discovery miss surfaces the known error without any tool call"
	);
	assert.equal(missing.entry.chromeMissing, true, "the state is badged in the card header");
	assert.equal(missing.entry.executableDiscoveryRevision, 1, "the flagging run counted");
	assert.match(
		missing.entry.lastError,
		/^Chrome executable not found: /u,
		"the known error keeps its canonical prefix"
	);
}

// A pick in the dropdown restarts the bridge **carrying** what the pill shows
// and re-runs scan+probe against it.
{
	const picked = stub();
	apply(picked.ctx, { ...config, chromePaths: [] });
	const target = process.execPath;
	picked.entry.chromePath = target;
	picked.hooks.onChange();
	await new Promise((resolve) => setTimeout(resolve, 30));
	const last = picked.updates.at(-1);
	assert.ok(last, "a selection write updated the bridge");
	assert.equal(last.args.at(-1), `--executablePath=${target}`, "argv pins the picked executable");
	assert.equal(picked.entry.effectiveChromePath, target, "the pill's path is what the bridge launches");
	assert.equal(picked.entry.effectiveSource, "selected", "the origin is the selection");
	assert.match(picked.entry.chromeVersion, /^v\d+\./u, "the probe followed the selection");
}

// A pinned executable that later breaks is reported broken, never silently
// substituted: the scan drops it from what is runnable and the probe reports
// the known error, while the selection stays exactly where the user put it.
{
	const broken = stub();
	apply(broken.ctx, { ...config, chromePaths: [] });
	// First what the card claims works, then the same path goes bad: the failed
	// probe must not keep quoting the version the earlier run answered with.
	broken.entry.chromePath = process.execPath;
	broken.hooks.onChange();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.notEqual(broken.entry.chromeVersion, "", "a working selection answers with a version");
	broken.entry.chromePath = "/nonexistent-dir/chrome-should-not-exist";
	broken.hooks.onChange();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(broken.entry.effectiveChromePath, "/nonexistent-dir/chrome-should-not-exist", "a broken pin is not re-resolved");
	assert.equal(broken.entry.chromeMissing, true, "the broken pin flags the known error");
	assert.equal(broken.entry.chromeVersion, "", "a failed probe clears the version it no longer knows");
	assert.match(broken.entry.lastError, /^Chrome executable not found: \//u, "the error names the path");
	assert.deepEqual(broken.entry.executableStatus, [], "an absent path answers no status");
}

// First run on a host that never picked one: the host **seeds** the selection
// once from what the scan found, persisting it so the next boot starts from
// the same answer, and folds what it found into the saved rows.
{
	const writes = [];
	const fresh = stub({
		settings: {
			document: {},
			mutate(_ns, ops) {
				writes.push(...ops);
				return Promise.resolve();
			}
		}
	});
	apply(fresh.ctx, { ...config, chromePaths: [process.execPath, "/nonexistent-dir/absent"] });
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(
		writes.filter((op) => op.path && String(op.path) === "chromePath").length,
		1,
		"the seeded path was persisted exactly once"
	);
	assert.equal(writes.at(-1).value, process.execPath, "the seeded value is the runnable candidate");
	assert.equal(fresh.entry.effectiveChromePath, process.execPath, "the seeded path is what the bridge runs");
	assert.equal(fresh.entry.effectiveSource, "selected", "a seeded path is an ordinary selection");
	const rowWrites = writes.filter((op) => op.path && String(op.path) === "executables");
	assert.equal(rowWrites.length, 1, "what the run found was merged into the saved rows once");
	assert.deepEqual(
		rowWrites[0].value,
		[{ id: process.execPath, name: "" }],
		"a found path lands as a nameless row — its user names it later"
	);
	assert.equal(fresh.entry.executableStatus.length, 1, "the absent candidate answers no status");
	assert.match(fresh.entry.executableStatus[0].version, /^v\d+\./u, "a found path answers with its version");
}

// A host still carrying the **legacy** hand-typed list folds it into the rows
// once, before the merge — the older field is a source of saved paths, not a
// second source of truth the picker would keep consulting forever.
{
	const writes = [];
	const legacy = stub({
		settings: {
			document: { "chrome-mcp": { chromeCustomPaths: ["/legacy-dir/older-chrome", process.execPath] } },
			mutate(_ns, ops) {
				writes.push(...ops);
				return Promise.resolve();
			}
		}
	});
	apply(legacy.ctx, { ...config, chromePaths: [] });
	await new Promise((resolve) => setTimeout(resolve, 40));
	const rowWrites = writes.filter((op) => op.path && String(op.path) === "executables");
	assert.equal(rowWrites.length, 1, "the legacy paths were folded into the rows exactly once");
	assert.deepEqual(
		rowWrites[0].value,
		[
			{ id: "/legacy-dir/older-chrome", name: "" },
			{ id: process.execPath, name: "" }
		],
		"the folded rows keep the stored order, nameless"
	);
	assert.equal(
		writes.filter((op) => op.path && String(op.path) === "chromePath").length,
		1,
		"the only runnable folded path is what got seeded"
	);
}

// A saved row is a candidate like any other: a run probes it, its answer is
// published under its id, and a row the user renamed keeps that name through
// the merge — nothing a search finds overwrites what the card was told to show.
{
	const saved = stub();
	apply(saved.ctx, { ...config, chromePaths: [] });
	saved.entry.executables = [{ id: process.execPath, name: "my chrome" }];
	saved.hooks.onChange();
	await new Promise((resolve) => setTimeout(resolve, 60));
	const statuses = saved.entry.executableStatus;
	assert.equal(statuses.length, 1, "the saved row was probed");
	assert.equal(statuses[0].path, process.execPath, "its answer is published under the row's id");
	assert.match(statuses[0].version, /^v\d+\./u, "a runnable row answers with its version");
}

// ── the WSL + Windows-executable notice ────────────────────────────────────
// A host running inside WSL that has selected the Windows binary is the one
// state no probe can report: across the interop boundary `chrome.exe --version`
// answers correctly, so the pill looks healthy and the check stays quiet until
// the first tool call. The host publishes it from the platform plus the
// selection, and takes the one step no probe can justify — it **never execs
// that path**. Attaching to the Windows browser session *is* how `--version`
// answers here, and attaching starts a browser instance that nothing could
// drive. The card renders the static configuration recipe on it instead.
// Off WSL the very same selection *is* probed, so the path still has to be one
// that CANNOT exist — the rule every other case follows with
// `/nonexistent-dir/…`. The drive-letter spelling is absent on a Linux host and
// still reads as Windows-side to the picker.
const WINDOWS_CHROME = "C:\\dsh-chrome-mcp-test\\chrome.exe";
const warnedWsl = (state) => state.logs.filter((args) => String(args.join(" ")).includes("under WSL")).length;

// The state on a WSL host, from the row config with nothing picked yet.
{
	const wsl = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(wsl.ctx, { ...config, chromePaths: [], chromePath: WINDOWS_CHROME });
	assert.equal(wsl.entry.wslWindowsExecutable, true, "a Windows executable on a WSL host is published to the base layer");
	assert.equal(wsl.entry.effectiveChromePath, WINDOWS_CHROME, "and the path itself keeps being the effective one");
	assert.equal(warnedWsl(wsl), 1, "the trap is called out exactly once, not on every selection note");
	// Under WSL the path is never exec'd at all. Its `--version` answers (the
	// very reason the selection looks healthy) but answering attaches to the
	// Windows browser session, and that starts a browser instance nothing could
	// drive — so the check stays silent and the notice above is the whole report:
	// no version, no error line, nothing missing.
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(wsl.entry.chromeVersion, "", "the probe never runs, so it answers no version");
	assert.equal(wsl.entry.lastError, "", "and the state never lands as an error line");
	assert.equal(wsl.entry.chromeMissing, false, "nothing is flagged missing — the path is there, only unlaunchable");
}

// The same state when the card picks it by hand: the pick is what the bridge
// launches with, so the warning follows it.
{
	const picked = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(picked.ctx, { ...config, chromePaths: [] });
	assert.equal(picked.entry.wslWindowsExecutable, false, "nothing selected is no notice");
	picked.entry.chromePath = WINDOWS_CHROME;
	picked.hooks.onChange();
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(picked.entry.wslWindowsExecutable, true, "the pick reports the same state");
	assert.equal(warnedWsl(picked), 1, "and warns once across the restart it triggers");
	// What the card picked is what the bridge would launch with, and under WSL
	// that launch is impossible — so, again, the pick is never exec'd.
	assert.equal(picked.entry.chromeVersion, "", "the pick answers no version, because it is not exec'd");
	assert.equal(picked.entry.lastError, "", "and the failure stays out of the error line, which the notice owns");
}

// A Windows path coming out of the row config's candidate list instead of a
// pick: the same rule applies to the **run**. It keeps its place — carrying the
// host's own reason — and it is never spawned, which is what a run that "just
// probes what exists" would otherwise pay for: a browser instance on the Windows
// side.
{
	const listed = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(listed.ctx, { ...config, chromePaths: [WINDOWS_CHROME] });
	await new Promise((resolve) => setTimeout(resolve, 40));
	const statuses = listed.entry.executableStatus;
	assert.equal(statuses.length, 1, "a blocked candidate keeps its place in the run, not dropped out of the list");
	assert.equal(statuses[0].path, WINDOWS_CHROME, "the answer is published under the path it stands for");
	assert.equal(statuses[0].version, "", "and it answers no version, because it was never spawned");
	assert.match(statuses[0].error, /cannot be launched from WSL/u, "the status carries the platform reason, not a probe failure");
	assert.equal(listed.entry.chromeVersion, "", "nothing seeded from it: a blocked entry is not a runnable one");
}

// Off WSL the very same path is just a selection: nothing to explain, and it is
// probed like any other path would be — the block is platform-keyed, not a rule
// about how Windows paths look.
{
	const plain = stub({ env: {} });
	apply(plain.ctx, { ...config, chromePaths: [], chromePath: WINDOWS_CHROME });
	assert.equal(plain.entry.wslWindowsExecutable, false, "a Windows path on a plain Linux host is simply the selection");
	assert.equal(warnedWsl(plain), 0, "nothing is warned when the host is not WSL");
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.match(plain.entry.lastError, /executable not found: C:/u, "off WSL the path is probed, and answered with what the probe found");
}

// Under WSL but with a Linux executable: what runs is runnable, no notice.
{
	const wsl = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(wsl.ctx, { ...config, chromePaths: [], chromePath: process.execPath });
	assert.equal(wsl.entry.wslWindowsExecutable, false, "a Linux executable under WSL needs no notice");
	assert.equal(warnedWsl(wsl), 0, "and is never warned about");
}

console.log("apply.test.mjs: all assertions passed");
