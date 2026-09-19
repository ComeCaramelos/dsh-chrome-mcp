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
	reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
};

/** Stubbed host ctx surface consumed by apply(). */
function stub() {
	const state = { logs: [], bridges: [], toolHandler: void 0, entry: void 0, hooks: void 0 };
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
			if (key === "settings") return void 0;
			return void 0;
		},
		on(event, handler) {
			if (event === "tools/post-execute") state.toolHandler = handler;
		},
		extend() {
			return {
				plugin(ctor, bridgeCfg) {
					state.bridges.push(bridgeCfg);
					return { update: () => {} };
				}
			};
		},
		inject(deps, callback) {
			if (deps.includes("settings")) callback(settingsCtx);
		}
	};
	return state;
}

const settled = async () => ({ kind: "accept" });

// apply() registers the post-execute listener scoped to the tools service.
const state = stub();
apply(state.ctx, config);
assert.equal(typeof state.toolHandler, "function", "tools/post-execute listener registered");
assert.equal(state.bridges.length, 1, "one bridge mounted");
assert.deepEqual(state.bridges[0].args, ["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics", "--no-performance-crux"], "bridge argv shape fixed");

// The initial check runs at registration (chromePath empty + empty
// candidate list → nothing probed; the resolved value shows chromeVersion ""
// and checkRevision advanced).
// resolved value shows chromeVersion "" and checkRevision advanced).
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(state.entry.chromeVersion, "", "empty chromePath probes nothing");
assert.equal(state.entry.checkRevision, 1, "registration ran one check");

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

// A re-check with an empty chromePath runs no probe and must not clear the
// captured state — the absence is discovered upstream, so silence is not
// proof of health.
state.entry.lastError = "Chrome executable not found: /nope/chrome";
state.entry.chromeMissing = true;
const revisionBefore = state.entry.checkRevision;
state.entry.recheckNonce = 1;
state.hooks.onChange();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(state.entry.checkRevision, revisionBefore + 1, "recheck ran and counted");
assert.equal(state.entry.lastError, "Chrome executable not found: /nope/chrome", "no-probe check leaves captured errors alone");
assert.equal(state.entry.chromeMissing, true, "no-probe check leaves the known-error flag alone");

// Chrome not installed: a check with empty chromePath over a deterministic
// absent candidate list (what a host without Chrome does by default) flags
// the known executable-missing state at registration — no tool call needed,
// because upstream only starts the browser lazily on tool calls.
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
	assert.equal(missing.entry.checkRevision, 1, "the flagging check counted");
	assert.match(
		missing.entry.lastError,
		/^Chrome executable not found: /u,
		"the known error keeps its canonical prefix"
	);
}

console.log("apply.test.mjs: all assertions passed");
