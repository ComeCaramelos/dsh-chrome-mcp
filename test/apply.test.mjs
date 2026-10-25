// Runtime-wiring tests for apply(ctx, config) on the dsh 0.2.0 config-form
// surfaces: the plugin mounts as the profile entry `mcp-chrome`, user writes
// land in the row's **user layer** (`settings.update(entryId, { field })` — no
// `settings.yaml`, no section installs), live Host state is published through
// the **volatile references** (`entry.update({ config: { …current, …live } },
// false, false)` + `settings.describe()`), and form commits arrive as
// `loader/volatile-update` paths — a live-only commit is ignored there, so
// publishing never re-enters the routing it belongs to.
//
// Since the component model the row starts **no bridge of its own**: it
// registers the `chrome` + `chrome-windows` kinds with the manager's
// `mcpConnections` service, and whatever answers a live connection runs with is
// mirrored back (`runningFlags`, `runningNote`). The tests below therefore drive
// the kinds through the fake service rather than a nested fiber — no `ctx.plugin`
// is reached anymore, and a component without the manager starts nothing.
// Run: node test/apply.test.mjs.
import assert from "node:assert/strict";
import { apply, createChromeWindowsKind, pinnedServerCli } from "../lib/index.js";
import { createLiveMirror, liveMirrorKeys } from "../lib/host/values.js";
import { DISCOVERY_RETRY_DELAY_MS, DISCOVERY_RETRY_MAX, KIND_FIELDS, KIND_ID_CHROME, KIND_ID_WINDOWS } from "../lib/host/constants.js";

/** The pinned `chrome-devtools-mcp` CLI the default row runs under this Node. */
const CLI = pinnedServerCli();

/**
 * Virtual timers for the bounded retry of a failed run (M6). The retry arms at
 * the constant's own delay; letting a real 15 s timer fire mid-suite would make
 * every late answer depend on suite timing. So a timer armed at exactly that
 * delay is captured instead of scheduled — it fires only when a case pumps it —
 * while every other `setTimeout` stays real. A case that arms retries from
 * earlier blocks pumps this queue itself; the queue is pinned to what the case
 * armed just before firing.
 */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const retryTimers = [];
globalThis.setTimeout = (fn, delay, ...rest) => {
	if (delay === DISCOVERY_RETRY_DELAY_MS) {
		const entry = { fn, cleared: false };
		retryTimers.push(entry);
		return entry;
	}
	return realSetTimeout(fn, delay, ...rest);
};
globalThis.clearTimeout = (id) => {
	if (id !== null && id !== void 0 && typeof id === "object" && "fn" in id) id.cleared = true;
	else realClearTimeout(id);
};
/** Fire the oldest pending retry timer; false when nothing was armed. */
function fireRetryTimer() {
	for (const timer of retryTimers) {
		if (!timer.cleared) {
			timer.cleared = true;
			timer.fn();
			return true;
		}
	}
	return false;
}
/** Keep only what the next apply arms. */
function pinRetryTimers() {
	retryTimers.length = 0;
}

/** The live mirror fields, read off the Host module itself: what every Host
 * write-back carries as `unset` ops so the live answers never ride a write into
 * the stored row. */
const LIVE_MIRROR_FIELDS = liveMirrorKeys();

/** What one live-mirror field answers when nothing stands answered for it — the
 * opening answer a write's `unset` ops return the running references to. */
const LIVE_MIRROR_DEFAULTS = createLiveMirror();

/** Every `.volatile()` field: what `apply` receives as a live reference; every ordinary field stays a plain value. */
const VOLATILE_FIELDS = new Set([
	"extraFlags",
	"chromePath",
	"executables",
	"chromeCustomPaths",
	"stderrMode",
	"refreshExecutablesNonce",
	"openWindowsChromeNonce",
	"migrationDismissed",
	"lastError",
	"chromeMissing",
	"executableDiscoveryRevision",
	"chromeVersion",
	"executableStatus",
	"effectiveChromePath",
	"effectiveSource",
	"stderrEffective",
	"defaultExtraFlags",
	"wslExtraFlags",
	"wslWindowsExecutable",
	"windowsChromeStatus",
	"carriesConnectionMode",
	"runningFlags",
	"runningNote"
]);

/**
 * Stubbed host half consumed by apply() — the loader shape the migrated host
 * talks to: a fiber whose own loader entry carries the profile entry id
 * (`mcp-chrome`), the described form row (`describe()[ns]` answering the two
 * layers), persistence through `settings.update(entryId, { field })` keyed by
 * that same entry id, the volatile-update routing hook, the tools service, and
 * the manager's `mcpConnections` service (the fake records what the component
 * registers, proposes, invalidates and notifies).
 * @param options - `row` (what the row config carries; the described base
 * layer), `user` (what the profile patch layer already carries), `env` (the
 * launch environment — an empty map answers plain Linux, so the suite never
 * depends on the machine running it), `deps` (the host halves `apply` overrides
 * — the Windows run and the Windows-side executables a WSL host would locate on
 * disk, pinned off by default for the same reason: a run must never answer for
 * whatever browser happens to be installed here), `settings` (false drops the
 * service, leaving only the references — the cold path), `commands` (false drops
 * the commands plane — the shape a host without slash commands answers to, where
 * the command half stands down instead of failing), `manager` (false answers
 * *without* a manager mounted — the component then registers nothing and starts
 * nothing), `serviceEntries`/`serviceLines` (the manager's live entries and their
 * lines, keyed by entry id), `describedBase` (the row-config layer the described
 * row answers with, pinned separately from what the references resolve — the
 * shape a drift between the two takes).
 */
function stub(options = {}) {
	return stubWith(options);
}

/** Whether a simulated launch environment carries a WSL marker. */
function isWslEnv(env) {
	return env !== undefined && ["WSL_DISTRO_NAME", "WSL_DISTRO_LABEL", "WSL_INTEROP"].some((name) => typeof env[name] === "string" && env[name] !== "");
}

function stubWith(options) {
	const row = options.row ?? {};
	const rowConfig = {
		serverName: "chrome",
		command: "npx",
		package: "chrome-devtools-mcp@latest",
		extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
		chromePath: "",
		executables: [],
		chromeCustomPaths: [],
		stderrMode: "",
		refreshExecutablesNonce: 0,
		openWindowsChromeNonce: 0,
		migrationDismissed: false,
		// Empty candidate list: the empty-chromePath check must not spawn real
		// browser discovery in a unit stub (host determinism).
		chromePaths: [],
		env: {},
		cwd: "",
		toolCallTimeoutMs: 60000,
		maxInstructionBytes: 32768,
		failOnStartupError: false,
		// "console" so this stub's argv assertion sees the logical invocation
		// unwrapped (the default "log" capture wrapper is covered separately by
		// the buildBridgeSpawn assertions in parse.test.mjs).
		bridgeStderr: "console",
		bridgeStderrLog: "",
		reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
		...row
	};
	// The described row's **base** layer: what the row config carries. A case can
	// pin it apart from what `apply` receives as references — that is how a layer
	// that states one answer while the references answer another gets exercised
	// (the drift that made the stderr toggle a dead control).
	const baseLayer = options.describedBase === void 0 ? { ...row } : { ...row, ...options.describedBase };
	const userLayer = { ...options.user };
	const envValues = options.env === void 0 ? {} : options.env;

	const state = {
		logs: [],
		kinds: [],
		proposals: [],
		invalidations: [],
		notifications: 0,
		serviceEntries: (options.serviceEntries ?? []).map((entry) => ({ extra: {}, ...entry })),
		serviceLines: { ...(options.serviceLines ?? {}) },
		tools: [],
		toolHandler: void 0,
		volatileHandler: void 0,
		configured: 0,
		writes: [],
		commits: [],
		commandDefs: [],
		effectCleanups: [],
		extendCalls: 0,
		entry: void 0,
		user: userLayer,
		config: {},
		// The machine halves the host would otherwise reach for: the Windows
		// run, and the Windows-side executables a WSL host locates through the
		// interop mount. Both stay stubbed for the reason the empty candidate
		// list above follows — a run must never answer for whatever browser
		// happens to be installed on the machine running the suite. A case that
		// wants a fold hands in its own answer list.
		// A simulated WSL host is a Linux host: the probe reads the platform too.
		deps: { windowsExecutables: () => [], ...(isWslEnv(options.env) ? { platform: "linux" } : {}), ...(options.deps ?? {}) }
	};
	const logger = { trace() {}, debug() {}, info: log, warn: log, error: log, fatal() {} };
	function log(...args) {
		state.logs.push(args);
	}
	const settings = {
		// `value` is the **resolved** row: what the references answer, live Host
		// commits included, so it stands for the published config rather than an
		// empty object.
		describe: () => [{ ns: "mcp-chrome", user: { ...userLayer }, base: { ...baseLayer }, value: { ...state.entry.options.config } }],
		mutate: async (ns, ops) => {
			// What lands in the row: the fields the write's `set` ops name, plus
			// every live-only field the live layer is standing answered for —
			// this is what the write channel answers volatile fields off of, and
			// why every write-back carries an `unset` for each: without it the
			// live answers ride the write into the file.
			const patch = {};
			for (const op of ops) {
				if (op.op === "set") patch[op.path.join(".")] = op.value;
				continue;
			}
			for (const key of LIVE_MIRROR_FIELDS) {
				if (!Object.prototype.hasOwnProperty.call(state.entry.options.config, key)) continue;
				if (ops.some((op) => op.op === "unset" && op.path[0] === key)) continue;
				patch[key] = state.entry.options.config[key];
			}
			state.writes.push({ ns, ops, patch });
			// The write lands in the profile patch layer — the user layer, which
			// the references resolve over the row config from then on. A cleared
			// live field drops out of the row: what the references answer is the
			// row config's own, never a live value that once rode a write.
			Object.assign(userLayer, patch);
			for (const op of ops) {
				if (op.op === "unset") delete userLayer[op.path[0]];
			}
			// What the write's `unset` ops answer **in the running references**: every
			// live-only field goes back to the mirror's opening answer (the row config
			// carries none of them, measured live 2026-10-13). The reset is answered as
			// the write lands, not when it is issued — and it stands whether or not the
			// stored write itself does.
			const reset = () => {
				for (const op of ops) {
					if (op.op !== "unset") continue;
					const key = op.path[0];
					if (LIVE_MIRROR_FIELDS.indexOf(key) === -1) continue;
					state.entry.options.config[key] = LIVE_MIRROR_DEFAULTS[key];
				}
			};
			if (options.writeRefused === true) {
				// A row whose configuration is overridden elsewhere refuses the write
				// — still answering the ops it applied, then rejecting.
				return new Promise((_resolve, reject) => {
					setTimeout(() => {
						reset();
						reject(new Error(`Configuration for "${ns}" is overridden by a home patch or command-line overlay`));
					}, 20);
				});
			}
			reset();
		},
		configure: (_presentation, _owner) => {
			state.configured += 1;
			return () => {
				state.configured -= 1;
			};
		}
	};
	state.entry = {
		options: { id: "mcp-chrome", config: { ...rowConfig } },
		update: (next, create, force) => {
			state.entry.options.config = { ...state.entry.options.config, ...next.config };
			state.commits.push({ create, force, paths: Object.keys(next.config) });
		}
	};
	for (const [key, value] of Object.entries(rowConfig)) {
		state.config[key] = VOLATILE_FIELDS.has(key)
			? { get: () => (Object.prototype.hasOwnProperty.call(userLayer, key) ? userLayer[key] : value) }
			: value;
	}
	state.ctx = {
		logger,
		fiber: { state: 2, entry: state.entry, await: async () => undefined },
		get(key) {
			// A settings service is only "up" (and thus readable/persistable)
			// when the stub says so: without it the host answers off the
			// references alone and cannot persist a seeded selection.
			if (key === "settings" && options.settings !== false) return settings;
			// The host resolves the launch environment through this slot, and it
			// is how a test pins "are we under WSL?" without depending on the
			// machine running the suite: a supplied map answers for the whole
			// environment, so an empty one is plain Linux.
			if (key === "launchEnvironment") {
				const values = envValues;
				return {
					get: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? { value: values[name] } : void 0)
				};
			}
			return void 0;
		},
		on(event, handler) {
			if (event === "tools/post-execute") state.toolHandler = handler;
			if (event === "loader/volatile-update") state.volatileHandler = handler;
		},
		extend() {
			// Nothing should reach this any more — the component model starts no
			// nested fiber of its own. A call is counted so the "starts nothing"
			// rule can be pinned.
			state.extendCalls += 1;
			return {
				plugin() {
					return { update: () => void 0 };
				}
			};
		},
		inject(deps, callback) {
			if (deps.includes("tools")) callback({ tools: { register: (definition) => { state.tools.push(definition); return () => { state.tools.length = 0; }; } } });
			if (deps.includes("settings") && options.settings !== false) callback({ settings });
			// The commands plane — present by default, absent when a case says the
			// host has none (`commands: false`, the headless-mirror test). The
			// disposer removes the definition again, which is what pins that a hot
			// re-apply never collides on the prior registrations.
			if (deps.includes("commands") && options.commands !== false) {
				callback({
					commands: {
						register(definition) {
							state.commandDefs.push(definition);
							return () => {
								const index = state.commandDefs.indexOf(definition);
								if (index !== -1) state.commandDefs.splice(index, 1);
							};
						}
					}
				});
			}
			// The manager's connection service. A component that does not get it
			// answers its own page and registers nothing — `manager: false` is
			// exactly that shape.
			if (deps.includes("mcpConnections") && options.manager !== false) {
				callback({
					mcpConnections: {
						registerKind(kind) {
							state.kinds.push(kind);
							return () => {
								const index = state.kinds.indexOf(kind);
								if (index !== -1) state.kinds.splice(index, 1);
							};
						},
						notifyKindsChanged() {
							state.notifications += 1;
						},
						propose(proposal) {
							state.proposals.push(proposal);
							return () => {
								const index = state.proposals.indexOf(proposal);
								if (index !== -1) state.proposals.splice(index, 1);
							};
						},
						entries: () => state.serviceEntries.map((entry) => ({ ...entry, extra: { ...entry.extra } })),
						line: (id) => (Object.prototype.hasOwnProperty.call(state.serviceLines, id) ? { id, state: state.serviceLines[id] } : void 0),
						invalidate: (id) => {
							state.invalidations.push(id);
						}
					}
				});
			}
		},
		effect(execute) {
			// Effects return their cleanup; a case that wants disposal drives it
			// through `state.effectCleanups`.
			const cleanup = execute();
			if (typeof cleanup === "function") state.effectCleanups.push(cleanup);
			return { dispose: Promise.resolve() };
		}
	};
	return state;
}

/** Route one user-authored write: it lands in the profile patch layer (the user
 * layer) and arrives back on this fiber as one volatile-update path. */
function commitUser(state, field, value) {
	state.user[field] = value;
	state.volatileHandler([[field]]);
}

/** The live mirror as it was published — every Host answer reaches the card
 * through one volatile commit onto the entry config. */
const published = (state) => state.entry.options.config;

/** Spawning a process (the `--version` probe of `process.execPath` these
 * cases lean on) is an order of magnitude slower on Windows: the fixed ticks
 * scale with it there, so a case waits for the probe rather than the clock. */
const SETTLE_SCALE = process.platform === "win32" ? 15 : 1;

/** A literal path inside a RegExp: every metacharacter escaped — a Windows
 * path's `\` and `.` included, not only `/`. */
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

/** What a probe of `process.execPath` answers: its `--version` line on POSIX;
 * on Windows nothing is spawned (a Chromium browser asked `--version` there
 * opens a window), and `node.exe` has no version folder beside it. */
const PROBED_VERSION = process.platform === "win32" ? /^version unknown$/u : /^v\d+\./u;
const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms * SETTLE_SCALE));

/** Wait until `condition()` holds, up to `ms` — for answers that ride a real
 * process (a `--version` probe of `process.execPath`), whose spawn takes far
 * longer on Windows than a fixed tick allows. */
const settleUntil = async (condition, ms = 5000) => {
	const deadline = Date.now() + ms;
	while (!condition() && Date.now() < deadline) await settle(20);
};

const settled = async () => ({ kind: "accept" });

/** The connection entry a kind `resolve` answers: manager shape, no own answer
 * unless the case names one. */
const entry = (id, kind, extra = {}) => ({ id, kind, extra, label: id, enabled: true });

/** The manager-visible surface: `resolve` one entry through a registered kind. */
async function resolveEntry(state, kindId, live) {
	const kind = state.kinds.find((candidate) => candidate.id === kindId);
	assert.ok(kind !== void 0, `the "${kindId}" kind stands registered`);
	return await kind.resolve(live, { logger: state.ctx.logger });
}

// apply() mounts the form (one profile entry, its own entry id), registers the
// post-execute listener and the Windows tool, and stands up the manager seam.
const state = stub();
apply(state.ctx, state.config, state.deps);
assert.equal(typeof state.volatileHandler, "function", "the configuration-form commit listener registered");
assert.equal(typeof state.toolHandler, "function", "tools/post-execute listener registered");
assert.equal(state.tools.length, 1, "apply registers the Windows Chrome tool alongside the listener");
assert.equal(state.tools[0].name, "prelaunch_windows_chrome", "the public tool name");
assert.equal(state.configured, 1, "the generated configuration page is turned off exactly once");
// The kinds stand registered with the manager — the component's whole say about
// connections: the local bridge everywhere, and the Windows browser through WSL
// only where a WSL host can drive it.
assert.deepEqual(
	state.kinds.map((kind) => [kind.id, kind.label]),
	[["chrome", "Chrome MCP"]],
	"off WSL only the local kind registers"
);
{
	const wsl = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(wsl.ctx, wsl.config, wsl.deps);
	assert.deepEqual(
		wsl.kinds.map((kind) => [kind.id, kind.label]),
		[
			["chrome", "Chrome MCP"],
			["chrome-windows", "Windows Chrome (WSL debug port)"]
		],
		"on WSL both kinds register at mount time, in this order"
	);
	const windowsFields = wsl.kinds[1].fields.map((field) => field.key);
	assert.deepEqual(windowsFields, ["extraFlags", "stderrMode"], "the Windows kind has no executable to pick — the run locates it");
}
assert.equal(state.kinds.every((kind) => kind.transport === "none"), true, "the fields carry everything: no transport shape to render");
assert.equal(state.kinds.every((kind) => "maxEntries" in (kind) === false), true, "neither kind caps its entries");
assert.equal(state.kinds.every((kind) => "actions" in kind === false), true, "neither kind carries actions (yet)");
{
	const chromeFields = state.kinds[0].fields.map((field) => [field.key, field.type]).sort();
	assert.deepEqual(chromeFields, [["executable", "select"], ["extraFlags", "lines"], ["stderrMode", "boolean"]], "the chrome editor is the executable, the flags and the console-output mode");
	assert.equal(state.kinds.every((kind) => kind.fields.every((field) => "composer" in field === false)), true, "no field claims the conversation composer");
}
// The component model starts nothing of its own: no nested fiber is mounted,
// and nothing is mounted again — a live connection is what decides whether
// anything runs.
assert.equal(state.extendCalls, 0, "no fiber is mounted by this component any more");
// A component without the manager answers its own page and says nothing: no
// kinds registered, no proposals, no invalidations, no notifications.
{
	const orphan = stub({ manager: false });
	apply(orphan.ctx, orphan.config, orphan.deps);
	await settle(20);
	assert.equal(orphan.kinds.length, 0, "without the manager there is nothing to register with");
	assert.equal(orphan.notifications, 0, "and nothing to notify");
	assert.equal(orphan.extendCalls, 0, "and nothing started");
}

// The registration run probes the whole candidate list and what the selection
// points at (nothing here: empty chromePath + empty candidate list → nothing
// probed, no statuses), and publishes the answers through the volatile config.
await settle();
assert.equal(published(state).chromeVersion, "", "empty chromePath probes nothing");
assert.equal(published(state).executableDiscoveryRevision, 1, "registration ran one executable run");
assert.deepEqual(published(state).executableStatus, [], "nothing found → no answers to render");
assert.equal(state.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "executables")).length, 0, "nothing merged → no saved rows persisted");
assert.equal(published(state).effectiveChromePath, "", "nothing resolved → no effective path");
assert.deepEqual(
	published(state).defaultExtraFlags,
	["--no-usage-statistics", "--no-performance-crux"],
	"the live mirror carries the canonical defaults list the card's restore control recovers"
);
assert.deepEqual(
	published(state).wslExtraFlags,
	["--chromeArg=--remote-debugging-port=9222"],
	"and the recommended WSL flag the card's Flags WSL control appends"
);
// A live commit merges nothing else, creates nothing, and never takes the
// ordinary-update path (that would remount the fiber).
assert.equal(state.commits.every((commit) => commit.create === false), true, "a live commit never creates an entry");
assert.equal(state.commits.every((commit) => commit.force === false), true, "a live commit never forces the ordinary-update path");
// The manager is told what the pickers would answer is standing: a publish with
// the manager mounted says so (the Host-served choices move with it).
assert.equal(state.notifications >= 1, true, "every publish re-notifies the kind fields");

// ── what the `chrome` kind answers a live connection with ───────────────────
// An entry with no answers of its own is resolved from the row: the fixed
// pinned `<node> <chrome-devtools-mcp cli> [flags]` argv, wrapped for its stderr, with
// the row's passthroughs riding along, and `serverName` = the entry's own id —
// the tool namespace is the connection's, not the row's.
{
	const s = stub();
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const resolved = await resolveEntry(s, "chrome", entry("dev", "chrome"));
	assert.equal(resolved.error, void 0, "the entry resolves");
	assert.equal(resolved.config.serverName, "dev", "the tool namespace is the connection's entry id");
	assert.equal(resolved.config.command, process.execPath, "the pinned server runs under the host's own Node");
	assert.deepEqual(resolved.config.args, [CLI, "--no-usage-statistics", "--no-performance-crux"], "the argv shape is fixed");
	assert.equal(resolved.config.toolCallTimeoutMs, 60000, "the row default tool timeout rides the connection config");
	assert.equal(resolved.config.maxInstructionBytes, 32768, "no stated ceiling → the default instructions ceiling rides along");
	// Whatever a live connection answers runs with is mirrored back — the card
	// states what is standing, not what was last configured.
	await settle(10);
	assert.deepEqual(published(s).runningFlags, ["--no-usage-statistics", "--no-performance-crux"], "the mirror states the running flags");
	assert.equal(published(s).runningNote, "", "a plain local answer carries no note");
	// What the row leaves alone stands at the schema default; what it states rides
	// along verbatim.
	const capped = stub({ row: { maxInstructionBytes: 98304 } });
	apply(capped.ctx, capped.config, capped.deps);
	const cappedResolved = await resolveEntry(capped, "chrome", entry("dev", "chrome"));
	assert.equal(cappedResolved.config.maxInstructionBytes, 98304, "a stated ceiling rides the connection config verbatim");
}

// An entry carries its own answers: the `lines` field is what it launches with
// (one flag per line), the executable picks by **path**, and the stderr select
// switches the spawn wrapper. Whatever an entry states itself never follows a
// later row edit — which is exactly why the drift paths leave them standing.
{
	const s = stub();
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const own = await resolveEntry(s, "chrome", entry("own", "chrome", { [KIND_FIELDS.extraFlags]: "--headless\n--custom" }));
	assert.deepEqual(own.config.args, [CLI, "--headless", "--custom"], "the entry's own flags, not the row's default");
	const picked = await resolveEntry(s, "chrome", entry("pick", "chrome", { [KIND_FIELDS.executable]: process.execPath }));
	assert.equal(picked.config.args.at(-1), `--executablePath=${process.execPath}`, "the pick rides argv as a path");
	const echo = await resolveEntry(s, "chrome", entry("echo", "chrome", { [KIND_FIELDS.stderrMode]: "console" }));
	assert.equal(echo.config.args[0], CLI, "console echo spawns unwrapped");
	assert.equal(echo.note ?? "", "", "and answers no note");
	// The toggle: off echoes to the console, on reduces into the log file.
	const off = await resolveEntry(s, "chrome", entry("off", "chrome", { [KIND_FIELDS.stderrMode]: "false" }));
	assert.equal(off.config.args[0], CLI, "a toggle turned off spawns unwrapped, like `console`");
	const on = await resolveEntry(s, "chrome", entry("on", "chrome", { [KIND_FIELDS.stderrMode]: "true" }));
	assert.notEqual(on.config.args[0], CLI, "a toggle turned on goes through the log wrapper, like `log`");
}

// The one answer a live `chrome` connection cannot carry out: the Windows binary
// across the interop boundary answers its `--version` but cannot be launched
// from here — the refusal is a line, naming what to use instead.
{
	const s = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const blocked = await resolveEntry(s, "chrome", entry("blocked", "chrome", { [KIND_FIELDS.executable]: "C:\\dsh-chrome-mcp-test\\chrome.exe" }));
	assert.equal(blocked.config, void 0, "the blocked pick resolves nothing");
	assert.match(blocked.error, /cannot be driven from this host/u, "the answer is a line naming the reason");
	assert.match(blocked.error, /Prelaunch Windows Chrome/u, "and it names the run that drives the Windows browser instead");
}

// The same pick on a host that is **not** WSL — Windows itself — is a plain
// local launch: the debug pipe works on this side of the boundary.
{
	const s = stub({ deps: { platform: "win32" } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const native = await resolveEntry(s, "chrome", entry("native", "chrome", { [KIND_FIELDS.executable]: "C:\\dsh-chrome-mcp-test\\chrome.exe" }));
	assert.equal(native.error, void 0, "on Windows itself the pick is not blocked");
	assert.equal(native.config.args.at(-1), "--executablePath=C:\\dsh-chrome-mcp-test\\chrome.exe", "it launches as a local executable");
}

// The `select` offers what only the Host knows: the saved rows, the scan
// answers, the Windows executables this host carries, and what a live connection
// runs with. The options are Host-served functions — read when the manager asks
// — which is why the notify rule above matters.
{
	const s = stub({ row: { executables: [{ id: "/usr/bin/chromium", name: "Chromium" }, { id: "/opt/chrome", name: "" }] }, env: { WSL_DISTRO_NAME: "Ubuntu-24.04" }, deps: { windowsExecutables: () => ["C:\\Windows\\chrome.exe"] } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const field = s.kinds[0].fields.find((candidate) => candidate.key === "executable");
	assert.equal(typeof field.options, "function", "the choices are Host-served");
	const choices = field.options().map((choice) => choice.value);
	assert.deepEqual(choices, ["/usr/bin/chromium", "/opt/chrome", "C:\\Windows\\chrome.exe"], "saved rows first, then the Windows-side executables this host carries");
}

// The one thing the live mirror keeps for connections: the note. A local answer
// with a stderr redirect says where the log lands — that is the connection's
// `note`, mirrored back through `runningNote` too.
{
	const s = stub({ row: { bridgeStderr: "log" } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const resolved = await resolveEntry(s, "chrome", entry("dev", "chrome"));
	assert.match(resolved.note, /bridge stderr → /u, "the log destination is the connection's note");
	await settle(10);
	assert.match(published(s).runningNote, /bridge stderr → /u, "and it mirrors back into the live state");
}

// A live connection that follows the row's default is handed back for a
// re-prepare when that default drifts — the diff decides against the resolved
// config, so a connection answering the same thing it runs with stands.
{
	const s = stub({
		serviceEntries: [
			entry("follower", "chrome", {}),
			entry("own-flags", "chrome", { [KIND_FIELDS.extraFlags]: "--own" })
		],
		serviceLines: { "own-flags": "connected" }
	});
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	// Registering hands nothing back: the manager itself reconciles when a
	// kind arrives, so mounting invalidates no connection.
	assert.deepEqual(s.invalidations, [], "mounting hands no connection back");
	commitUser(s, "extraFlags", ["--headless"]);
	await settle(60);
	assert.equal(s.invalidations.includes("own-flags"), false, "an entry carrying its own flags does not follow the row");
	assert.equal(s.invalidations.includes("follower"), true, "the follower is handed back for a re-prepare");
	s.invalidations.length = 0;
	commitUser(s, "stderrMode", "log");
	await settle(60);
	assert.deepEqual(s.invalidations.sort(), [...s.serviceEntries.map((live) => live.id)].sort(), "the stderr wrapper is fixed at spawn: every live connection re-spawns");
}

// A rows change is a list change, not a connection change: the executable run
// refreshes, and no connection is handed back.
{
	const s = stub({ serviceEntries: [entry("follower", "chrome", {})] });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	s.invalidations.length = 0;
	const revisionBefore = published(s).executableDiscoveryRevision;
	commitUser(s, "executables", [{ id: "/nonexistent-dir/row-should-not-exist", name: "saved" }]);
	await settle(10);
	assert.equal(published(s).executableDiscoveryRevision, revisionBefore + 1, "a rows change ran a refresh");
	assert.equal(s.invalidations.length, 0, "and handed no connection back");
}

// The kind fields' answers reach the running state: resolving one entry mirrors
// what it runs with, and every subsequent publish of that state keeps saying
// the pickers moved.
{
	const s = stub({ serviceEntries: [entry("dev", "chrome", {})] });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const notificationsBefore = s.notifications;
	const resolved = await resolveEntry(s, "chrome", entry("dev", "chrome", { [KIND_FIELDS.extraFlags]: "--mirror-me" }));
	assert.equal(resolved.config.args.includes("--mirror-me"), true, "the entry answers with its own flags");
	await settle(10);
	assert.equal(s.notifications > notificationsBefore, true, "answering a connection notifies the pickers");
	assert.deepEqual(published(s).runningFlags, ["--mirror-me"], "the running state now states the live connection");
}

// A live-only commit routes nothing: recomposition echoes publish no mirror, so
// a re-assertion never chases its own echo.
{
	const echoed = stub({ row: { chromePath: "/nonexistent-dir/picked-in-the-card" } });
	apply(echoed.ctx, echoed.config, echoed.deps);
	await settle(60);
	echoed.entry.options.config = { serverName: "chrome", command: "npx", chromePath: "/nonexistent-dir/picked-in-the-card" };
	const before = echoed.commits.length;
	echoed.volatileHandler([["lastError"], ["chromeMissing"], ["executableStatus"], ["effectiveChromePath"], ["effectiveSource"], ["wslWindowsExecutable"]]);
	await settle(60);
	assert.equal(echoed.commits.length, before, "a live-only commit publishes nothing — no echo re-assertion, no revision churn");
	assert.equal(echoed.writes.length, 0, "and nothing reaches the patch row: a live answer is not persisted state");
}
// A commit that names a user field routes, and routing re-publishes as it always
// has — this half is unchanged.
{
	const routed = stub({ row: { chromePath: "/nonexistent-dir/picked-in-the-card" } });
	apply(routed.ctx, routed.config, routed.deps);
	await settle(60);
	const before = routed.commits.length;
	commitUser(routed, "chromePath", "/nonexistent-dir/picked-in-the-card");
	await settle(120);
	assert.equal(routed.commits.length > before, true, "the routed commit publishes the mirror back");
	assert.equal(published(routed).effectiveChromePath, "/nonexistent-dir/picked-in-the-card", "…and the selection it answers with is the one that was written");
}

// ── the `chrome-windows` kind ────────────────────────────────────────────────
// Preparing this kind IS the prelaunch: locate, prereq, free port, launch, wait
// for the bind. Off WSL the host cannot answer it, so it is never offered; the
// kind itself still refuses there, with the answer the card shows.
{
	const s = stub();
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	assert.equal(s.kinds.some((kind) => kind.id === "chrome-windows"), false, "off WSL the picker never lists it");
	const controller = { wslHost: false };
	const off = await createChromeWindowsKind(controller).resolve(entry("win", "chrome-windows", {}));
	assert.equal(off.config, void 0, "off WSL nothing runs");
	assert.match(off.error, /not a WSL instance/u, "the refusal is the platform answer");
	assert.match(off.error, /Chrome MCP kind/u, "and points back at the local kind");
}
{
	// A WSL host whose run connects: the local `chrome-devtools-mcp` runs in
	// connect mode against the debugging port the run settled on, with the run's
	// URL riding argv — never written back into the row's config.
	const connect = async () => ({ state: "connected", port: 9222, url: "http://127.0.0.1:9222", profileDir: "C:\\Users\\x\\.dsh-chrome", error: "" });
	const s = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" }, deps: { runWindowsChrome: connect } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const resolved = await resolveEntry(s, "chrome-windows", entry("win", "chrome-windows", { [KIND_FIELDS.extraFlags]: "--headless" }));
	assert.equal(resolved.error, void 0, "the entry resolves");
	assert.equal(resolved.config.command, process.execPath, "the local bridge runs the same fixed argv…");
	assert.equal(resolved.config.args.includes("--browserUrl=http://127.0.0.1:9222"), true, "…carrying the debugging port as a connect-mode flag");
	assert.equal(resolved.config.args.includes("--headless"), true, "the entry's own flags ride along");
	assert.match(resolved.note, /Windows Chrome connected at http:\/\/127\.0\.0\.1:9222/u, "the note states what the run drove");
	await settle(20);
	assert.deepEqual(published(s).runningFlags, ["--headless", "--browserUrl=http://127.0.0.1:9222"], "the connect-mode flags are what the running state states");
	assert.equal(published(s).windowsChromeStatus.state, "connected", "and the run's own state is mirrored");
	assert.equal(published(s).windowsChromeStatus.port, 9222, "…with the port it settled on");
	// The run answers its own failure the same way: a line with the run's state,
	// never a silent retry.
	const failed = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" }, deps: { runWindowsChrome: async () => ({ state: "not-found", port: 0, url: "", profileDir: "", error: "no Windows chrome located" }) } });
	apply(failed.ctx, failed.config, failed.deps);
	await settle(20);
	const failure = await resolveEntry(failed, "chrome-windows", entry("win", "chrome-windows", {}));
	assert.equal(failure.config, void 0, "a run that did not connect resolves nothing");
	assert.match(failure.error, /did not connect \(not-found\): no Windows chrome located/u, "the line carries the run's own answer");
}

// The tool is the same run, answered once: connected answers carry the port; the
// live connections' text says who drives it.
{
	const connect = async () => ({ state: "connected", port: 9333, url: "http://127.0.0.1:9333", profileDir: "C:\\Users\\x\\.dsh-chrome", error: "" });
	const s = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" }, deps: { runWindowsChrome: connect } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	const answer = await s.tools[0].execute();
	assert.match(answer.text, /http:\/\/127\.0\.0\.1:9333/, "the tool answers the debugging URL");
	assert.match(answer.text, /No Windows Chrome connection exists yet/u, "with none standing it names the kind that would drive it");
	// With one standing the run refreshes it instead.
	const live = stub({
		env: { WSL_DISTRO_NAME: "Ubuntu-24.04" },
		deps: { runWindowsChrome: connect },
		serviceEntries: [entry("win", "chrome-windows", {})],
		serviceLines: { win: "connected" }
	});
	apply(live.ctx, live.config, live.deps);
	await settle(20);
	const liveAnswer = await live.tools[0].execute();
	assert.match(liveAnswer.text, /stand live against it/u, "live connections are named as refreshed, not restarted");
	// Off WSL the tool answers plainly.
	const plain = stub();
	apply(plain.ctx, plain.config, plain.deps);
	const plainAnswer = await plain.tools[0].execute();
	assert.match(plainAnswer.text, /not a WSL instance/u, "the off-WSL answer is plain");
}

// ── the standalone translation (D4) ─────────────────────────────────────────
// A row whose own config still *means* a connection is offered as one — once,
// through the manager, with the kind the config stands for. Nothing lands in
// `servers` without a click.
{
	const s = stub({ row: { extraFlags: ["--headless"] } });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	assert.equal(s.proposals.length, 1, "the standalone config is offered as a connection");
	const [proposal] = s.proposals;
	assert.equal(proposal.id, "mcp-chrome-standalone", "the offer is keyed to this row");
	assert.equal(proposal.entry.id, "chrome", "the entry id is the old `serverName`");
	assert.equal(proposal.entry.kind, "chrome", "the kind is the local bridge");
	assert.equal(proposal.entry.extra.extraFlags, "--headless", "what the row's flags list carries moves into the entry");
	assert.match(proposal.title, /Chrome MCP connection/u, "the title names the kind");
	// The refusal is remembered **here**: this row's config says `no` once.
	proposal.onDismiss();
	await settle(40);
	const dismissed = s.writes.find((write) => write.ops.some((op) => op.op === "set" && op.path[0] === "migrationDismissed"));
	assert.ok(dismissed !== void 0, "the dismissal persists into this row");
	assert.equal(dismissed.patch.migrationDismissed, true, "as the one Host write the offer path makes");
}
{
	// An already-dismissed row stands down, and a row that states nothing
	// special has nothing to say.
	const dismissed = stub({ row: { extraFlags: ["--headless"] }, user: { migrationDismissed: true } });
	apply(dismissed.ctx, dismissed.config, dismissed.deps);
	await settle(20);
	assert.equal(dismissed.proposals.length, 0, "a dismissed row offers nothing");
	// (The stub's own `bridgeStderr: "console"` is itself a stand-alone statement
	// the migration carries into the entry — an untouched row means *no* such
	// statement anywhere, which the harness's default does not model.)
	const plain = stub({ row: { bridgeStderr: "log" } });
	apply(plain.ctx, plain.config, plain.deps);
	await settle(20);
	assert.equal(plain.proposals.length, 0, "an untouched row offers nothing either");
	// Connect mode is what a Windows host translated itself into: the offer names
	// the kind that drives it through the run.
	const connect = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" }, row: { extraFlags: ["--browserUrl=http://127.0.0.1:9222"] } });
	apply(connect.ctx, connect.config, connect.deps);
	await settle(20);
	assert.equal(connect.proposals.length, 1, "the connect-mode row is offered too");
	assert.equal(connect.proposals[0].entry.kind, "chrome-windows", "off a WSL host the offer names the Windows kind");
	// Without the manager the offer goes nowhere — but the row still answers.
	const orphan = stub({ row: { extraFlags: ["--headless"] }, manager: false });
	apply(orphan.ctx, orphan.config, orphan.deps);
	await settle(20);
	assert.equal(orphan.proposals.length, 0, "no manager, no offer");
}

// ── tool-call capture, per connection ───────────────────────────────────────
// A browser-level failure never reaches a line: it is what the tool call
// answers. With connections live the namespaces are their entry ids; with none
// standing the capture falls back to the row's `serverName`.
{
	const s = stub({
		serviceEntries: [entry("dev", "chrome", {}), entry("other", "otherkind", {})],
		serviceLines: { dev: "connected", other: "connected" }
	});
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	await s.toolHandler({ name: "mcp__dev__new_page" }, { isError: true, content: [{ type: "text", text: "Protocol error (Target.setDiscoverTargets): Target closed" }] }, settled);
	await settle();
	assert.equal(
		published(s).lastError,
		"new_page failed: Protocol error (Target.setDiscoverTargets): Target closed",
		"a live connection's failure surfaces on the card"
	);
	await s.toolHandler({ name: "mcp__other__anything" }, { isError: true, content: [{ type: "text", text: "not ours" }] }, settled);
	await settle();
	assert.equal(published(s).lastError, "new_page failed: Protocol error (Target.setDiscoverTargets): Target closed", "another component's connections are not this component's business");
	await s.toolHandler({ name: "mcp__dev__list_pages" }, { content: [{ type: "text", text: "[]" }] }, settled);
	await settle();
	assert.equal(published(s).lastError, "", "success clears the note");
	// The listener passes the tool decision through unchanged.
	const decision = await s.toolHandler({ name: "mcp__dev__take_screenshot" }, { isError: true, content: [{ type: "text", text: "MCP error -32602" }] }, settled);
	await settle();
	assert.equal(decision.kind, "accept", "decision passes through");
	assert.equal(published(s).lastError, "take_screenshot failed: MCP error -32602", "validation failure surfaces too");
	// The known error: a launch-failure chrome-tool note flags chromeMissing so
	// the client can badge the card header; the next success clears the flag.
	await s.toolHandler(
		{ name: "mcp__dev__new_page" },
		{ isError: true, content: [{ type: "text", text: "Failed to launch the browser process" }] },
		settled
	);
	await settle();
	assert.equal(published(s).chromeMissing, true, "launch-failure note flags the known executable-missing error");
	await s.toolHandler({ name: "mcp__dev__list_pages" }, { content: [{ type: "text", text: "[]" }] }, settled);
	await settle();
	assert.equal(published(s).chromeMissing, false, "chrome-tool success clears the known-error flag");
}
// With no connection standing the row's own `serverName` still names the
// namespace (a connection answered under it still counts as this component's).
{
	const s = stub();
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	await s.toolHandler({ name: "mcp__chrome__navigate_page" }, { isError: true, content: [{ type: "text", text: "Navigation timed out" }] }, settled);
	await settle();
	assert.equal(published(s).lastError, "navigate_page failed: Navigation timed out", "the serverName namespace is captured without connections");
	await s.toolHandler({ name: "bash" }, { isError: true, content: [{ type: "text", text: "boom" }] }, settled);
	await settle();
	assert.equal(published(s).lastError, "navigate_page failed: Navigation timed out", "and a non-chrome tool is ignored");
}

// The known error is **persistent**: once the probe of the fixed selection has
// answered that the executable is gone, the answer stands until something
// proves it wrong — a probe answering a version, or a chrome-tool call that
// succeeded — and connection noise never displaces it.
{
	const pinned = stub({ row: { chromePath: "/nonexistent-dir/absent-chrome" } });
	apply(pinned.ctx, pinned.config, pinned.deps);
	await settle(40);
	assert.equal(published(pinned).chromeMissing, true, "an absent fixed selection flags the known error on the registration run");
	assert.match(
		published(pinned).lastError,
		/^Chrome executable not found: \/nonexistent-dir\/absent-chrome$/u,
		"and the answer names the selection"
	);
	// A flag change that never reaches a live connection clears nothing.
	commitUser(pinned, "extraFlags", ["--no-usage-statistics"]);
	await settle(60);
	assert.equal(published(pinned).chromeMissing, true, "a flags commit does not clear the known error");
	assert.match(
		published(pinned).lastError,
		/^Chrome executable not found: \/nonexistent-dir\/absent-chrome$/u,
		"the answer stands through it"
	);
	// Evidence is what clears it: a chrome-tool call that actually succeeded
	// proves the executable runs.
	await pinned.toolHandler({ name: "mcp__chrome__list_pages" }, { content: [{ type: "text", text: "[]" }] }, settled);
	await settle();
	assert.equal(published(pinned).chromeMissing, false, "a successful chrome-tool call clears the known error");
	assert.equal(published(pinned).lastError, "", "and the answer with it");
}

// Chrome not installed: a run over a deterministic absent candidate list (what
// a host without Chrome does by default) flags the known executable-missing
// state at registration — no tool call needed, because upstream only starts the
// browser lazily on tool calls.
{
	const missing = stub({ row: { chromePaths: ["/nonexistent-dir/chrome-should-not-exist"] } });
	apply(missing.ctx, missing.config, missing.deps);
	await settle(40);
	const advice = process.platform === "linux"
		? "; install Google Chrome inside the Linux environment (chrome-devtools-mcp never downloads one)"
		: "";
	assert.equal(
		published(missing).lastError,
		`Chrome executable not found: no executable detected (checked: /nonexistent-dir/chrome-should-not-exist)${advice}`,
		"discovery miss surfaces the known error without any tool call"
	);
	assert.equal(published(missing).chromeMissing, true, "the state is badged in the card header");
	assert.equal(published(missing).executableDiscoveryRevision, 1, "the flagging run counted");
}

// A Windows executable **is** a candidate the card can name, so a run whose only
// candidate is one must answer *why it is not runnable*, not that nothing was
// found.
{
	const wsl = stub({
		env: { WSL_DISTRO_NAME: "Ubuntu-22.04" },
		row: { chromePaths: ["C:\\dsh-chrome-mcp-test\\chrome.exe"] }
	});
	apply(wsl.ctx, wsl.config, wsl.deps);
	await settle(40);
	const blockedLine = published(wsl).lastError;
	assert.match(blockedLine, /cannot be launched from WSL/u, "the answer states the platform rule, not a missing file");
	assert.match(blockedLine, /Prelaunch Windows Chrome/u, "and names the run that drives it instead");
	assert.equal(published(wsl).chromeMissing, true, "and the run still reads as nothing runnable");
}

// An executable check that ran **no** probe answers nothing: a config file and a
// channel other than `stable` must neither seed a local executable nor badge the
// known missing state — no evidence, never health.
for (const flags of [["--config=/tmp/chrome.json"], ["--channel=beta"]]) {
	const skip = stub({
		row: {
			extraFlags: ["--no-usage-statistics", ...flags],
			chromePaths: [process.execPath]
		}
	});
	apply(skip.ctx, skip.config, skip.deps);
	await settle(60);
	const answer = published(skip);
	assert.equal(answer.effectiveChromePath, "", "the run seeds nothing behind a muting flag");
	assert.equal(answer.chromeMissing, false, "and badges nothing");
	assert.equal(answer.lastError, "", "a check that ran no probe clears nothing and claims nothing");
}

// A pick in the dropdown changes what the **default** answers launch with: the
// live connections that follow the row are handed back for a re-prepare, and
// the executable run re-runs behind the write.
{
	const s = stub({ serviceEntries: [entry("follower", "chrome", {})] });
	apply(s.ctx, s.config, s.deps);
	await settle(20);
	s.invalidations.length = 0;
	commitUser(s, "chromePath", process.execPath);
	await settleUntil(() => PROBED_VERSION.test(String(published(s).chromeVersion ?? "")));
	assert.equal(published(s).effectiveChromePath, process.execPath, "the pill's path is the default the connections follow");
	assert.equal(published(s).effectiveSource, "selected", "the origin is the selection");
	assert.match(published(s).chromeVersion, PROBED_VERSION, "the probe followed the selection");
	assert.equal(s.invalidations.includes("follower"), true, "and the connections that follow the row are handed back");
}

// A pinned executable that later breaks is reported broken, never silently
// substituted: the scan drops it from what is runnable and the probe reports
// the known error, while the selection stays exactly where the user put it.
{
	const broken = stub();
	apply(broken.ctx, broken.config, broken.deps);
	commitUser(broken, "chromePath", process.execPath);
	await settle(80);
	assert.notEqual(published(broken).chromeVersion, "", "a working selection answers with a version");
	commitUser(broken, "chromePath", "/nonexistent-dir/chrome-should-not-exist");
	await settle(60);
	assert.equal(published(broken).effectiveChromePath, "/nonexistent-dir/chrome-should-not-exist", "a broken pin is not re-resolved");
	assert.equal(published(broken).chromeMissing, true, "the broken pin flags the known error");
	assert.equal(published(broken).chromeVersion, "", "a failed probe clears the version it no longer knows");
	assert.match(published(broken).lastError, /^Chrome executable not found: \//u, "the error names the path");
}

// A saved row is a candidate like any other: a run probes it, its answer is
// published under its id, and a row the user renamed keeps that name through
// the merge.
{
	const saved = stub();
	apply(saved.ctx, saved.config, saved.deps);
	commitUser(saved, "executables", [{ id: process.execPath, name: "my chrome" }]);
	await settle(80);
	const statuses = published(saved).executableStatus;
	assert.equal(statuses.length, 1, "the saved row was probed");
	assert.equal(statuses[0].path, process.execPath, "its answer is published under the row's id");
	assert.match(statuses[0].version, PROBED_VERSION, "a runnable row answers with its version");
}

// A host still carrying the **legacy** hand-typed list folds it into the rows
// once, before the merge.
{
	const legacy = stub({ row: { chromePaths: [] }, user: { chromeCustomPaths: ["/legacy-dir/older-chrome", process.execPath] } });
	apply(legacy.ctx, legacy.config, legacy.deps);
	await settle(60);
	const rowWrites = legacy.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "executables"));
	assert.equal(rowWrites.length, 1, "the legacy paths were folded into the rows exactly once");
	assert.deepEqual(
		rowWrites[0].patch.executables,
		[
			{ id: "/legacy-dir/older-chrome", name: "" },
			{ id: process.execPath, name: "" }
		],
		"the folded rows keep the stored order, nameless"
	);
}

// First run on a host that never picked one: the host **seeds** the selection
// once from what the scan found, persisting it through the settings service
// keyed by the profile entry id, and folds what it found into the saved rows.
{
	const fresh = stub({ row: { chromePaths: [process.execPath, "/nonexistent-dir/absent"] } });
	apply(fresh.ctx, fresh.config, fresh.deps);
	await settleUntil(() => fresh.writes.some((write) => Object.prototype.hasOwnProperty.call(write.patch, "chromePath")) && fresh.writes.some((write) => Object.prototype.hasOwnProperty.call(write.patch, "executables")));
	assert.ok(fresh.writes.length >= 1, "the host persisted something on the first run");
	assert.deepEqual([...new Set(fresh.writes.map((write) => write.ns))], ["mcp-chrome"], "every write is keyed by the profile entry id");
	assert.equal(
		fresh.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "chromePath")).length,
		1,
		"the seeded path was persisted exactly once"
	);
	assert.equal(fresh.writes.find((write) => Object.prototype.hasOwnProperty.call(write.patch, "chromePath")).patch.chromePath, process.execPath, "the seeded value is the runnable candidate");
	assert.equal(published(fresh).effectiveChromePath, process.execPath, "the seeded path is what the default answers with");
	const rowWrites = fresh.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "executables"));
	assert.equal(rowWrites.length, 1, "what the run found was merged into the saved rows once");
	assert.deepEqual(
		rowWrites[0].patch.executables,
		[{ id: process.execPath, name: "" }],
		"a found path lands as a nameless row — its user names it later"
	);
}

// ── the WSL + Windows-executable notice ────────────────────────────────────
// A host running inside WSL that has selected the Windows binary is the one
// state no probe can report — and the rule that a Windows binary is offered but
// never launched is what both the run and the kind follow.
const WINDOWS_CHROME = "C:\\dsh-chrome-mcp-test\\chrome.exe";
const warnedWsl = (st) => st.logs.filter((args) => String(args.join(" ")).includes("under WSL")).length;

{
	const wsl = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" }, row: { chromePaths: [], chromePath: WINDOWS_CHROME } });
	apply(wsl.ctx, wsl.config, wsl.deps);
	await settle(40);
	assert.equal(published(wsl).wslWindowsExecutable, true, "a Windows executable on a WSL host is published on the live mirror");
	assert.equal(published(wsl).effectiveChromePath, WINDOWS_CHROME, "and the path itself keeps being the effective one");
	assert.equal(warnedWsl(wsl), 1, "the trap is called out exactly once, not on every selection note");
	// Under WSL the path is never exec'd at all — the state is never an error,
	// the notice owns it.
	assert.equal(published(wsl).chromeVersion, "", "the probe never runs, so it answers no version");
	assert.equal(published(wsl).lastError, "", "and the state never lands as an error line");
	assert.equal(published(wsl).chromeMissing, false, "nothing is flagged missing — the path is there, only unlaunchable");
}

{
	const picked = stub({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } });
	apply(picked.ctx, picked.config, picked.deps);
	await settle(5);
	assert.equal(published(picked).wslWindowsExecutable, false, "nothing selected is no notice");
	commitUser(picked, "chromePath", WINDOWS_CHROME);
	await settle(60);
	assert.equal(published(picked).wslWindowsExecutable, true, "the pick reports the same state");
	assert.equal(warnedWsl(picked), 1, "and warns once across the writes it triggers");
	assert.equal(published(picked).chromeVersion, "", "the pick answers no version, because it is not exec'd");
	assert.equal(published(picked).lastError, "", "and the failure stays out of the error line, which the notice owns");
}

// The Windows executables this host carries join the run's answer list — offered,
// never probed. A host off WSL folds nothing.
{
	const located = stub({
		env: { WSL_DISTRO_NAME: "Ubuntu-24.04" },
		row: { chromePaths: [] },
		deps: { windowsExecutables: () => [WINDOWS_CHROME] }
	});
	apply(located.ctx, located.config, located.deps);
	await settle(60);
	const statuses = published(located).executableStatus;
	assert.equal(statuses.length, 1, "the executables this host carries join the run's answer list");
	assert.equal(statuses[0].path, WINDOWS_CHROME, "answered under the path it stands for");
	assert.equal(statuses[0].version, "", "and nothing was probed to answer it");
	assert.match(statuses[0].note, /cannot be launched from WSL/u, "what it offers carries the note that says so, not a version");
	const merged = located.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "executables"));
	assert.deepEqual(merged[0].patch.executables, [{ id: WINDOWS_CHROME, name: "" }], "the offered executable becomes a saved row");
	assert.equal(published(located).wslWindowsExecutable, false, "nothing selected is no notice — offering is not selecting");
}

// A dropped row stays dropped: without a record of what the user dropped, the
// very run the deletion queues would fold the row straight back in.
{
	const dropped = stub({
		env: { WSL_DISTRO_NAME: "Ubuntu-24.04" },
		row: { chromePaths: [], chromePath: WINDOWS_CHROME, executables: [{ id: WINDOWS_CHROME, name: "Located" }] },
		deps: { windowsExecutables: () => [WINDOWS_CHROME] }
	});
	apply(dropped.ctx, dropped.config, dropped.deps);
	await settle(60);
	commitUser(dropped, "executables", []);
	await settle(150);
	const folded = dropped.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "executables"));
	assert.equal(folded.length, 0, "the found path is not folded back into the rows the user dropped");
	const record = dropped.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "droppedExecutables"));
	assert.ok(record.length >= 1, "the dropped id is recorded so later merge steps skip it");
	assert.deepEqual(record.at(-1).patch.droppedExecutables, [WINDOWS_CHROME], "recorded as exactly the dropped id");
	commitUser(dropped, "executables", [{ id: WINDOWS_CHROME, name: "Located" }]);
	await settle(150);
	const cleared = dropped.writes.filter((write) => Object.prototype.hasOwnProperty.call(write.patch, "droppedExecutables"));
	assert.ok(cleared.length >= 2, "clearing the record is one write like recording it");
	assert.deepEqual(cleared.at(-1).patch.droppedExecutables, [], "and the re-added id no longer stands dropped");
}

// Off WSL the very same path is just a selection: probed like any other path.
{
	const plain = stub({ env: {}, row: { chromePaths: [], chromePath: WINDOWS_CHROME } });
	apply(plain.ctx, plain.config, plain.deps);
	await settle(5);
	assert.equal(published(plain).wslWindowsExecutable, false, "a Windows path on a plain Linux host is simply the selection");
	assert.equal(warnedWsl(plain), 0, "nothing is warned when the host is not WSL");
	await settle(60);
	assert.match(published(plain).lastError, /executable not found: C:/u, "off WSL the path is probed, and answered with what the probe found");
}

// ── the effective stderr mode answers from every layer that states it ───────
{
	const drifted = stub({ row: { bridgeStderr: "log" }, describedBase: { stderrMode: "console" } });
	apply(drifted.ctx, drifted.config, drifted.deps);
	await settle(60);
	assert.equal(published(drifted).stderrEffective, "console", "the row config's own `stderrMode` answers the effective mode");
	// What a live connection spawns with follows the same answer: console is
	// unwrapped, whatever was configured as the row default notwithstanding.
	const unwrapped = await resolveEntry(drifted, "chrome", entry("dev", "chrome"));
	assert.equal(unwrapped.config.args[0], CLI, "console means no stderr wrapper");
	// The mirror stays honest: a commit that changes nothing the connections do
	// still answers what they do, so the card never diffs against a lag.
	commitUser(drifted, "extraFlags", ["--no-usage-statistics"]);
	await settle(60);
	assert.equal(published(drifted).stderrEffective, "console", "every commit re-states the effective mode");
}
{
	const userSaid = stub({ row: { bridgeStderr: "log" }, describedBase: { stderrMode: "console" }, user: { stderrMode: "log" } });
	apply(userSaid.ctx, userSaid.config, userSaid.deps);
	await settle(60);
	assert.equal(published(userSaid).stderrEffective, "log", "the UI layer states the mode the connections run with");
	const wrapped = await resolveEntry(userSaid, "chrome", entry("dev", "chrome"));
	assert.match(String(wrapped.config.args[0]), /stderr-wrapper.js$/u, "so the spawn carries the stderr wrapper");
	assert.match(wrapped.note ?? "", /bridge stderr → /u, "and the destination is stated on the connection");
}

// ── a persisted write never carries the live mirror ─────────────────────────
{
	const healed = stub({ row: { chromePaths: [process.execPath, "/nonexistent-dir/absent"] } });
	Object.assign(healed.user, { lastError: "stale failure", effectiveChromePath: "/stale/path", chromeMissing: true });
	apply(healed.ctx, healed.config, healed.deps);
	await settle(120);
	assert.ok(healed.writes.length >= 1, "the run wrote something back");
	for (const write of healed.writes) {
		for (const key of LIVE_MIRROR_FIELDS) {
			assert.equal(
				Object.prototype.hasOwnProperty.call(write.patch, key),
				false,
				`a write-back never lands the live field ${key} in the stored row`
			);
			assert.equal(
				Object.prototype.hasOwnProperty.call(healed.user, key),
				false,
				`…and a leaked live field drops out of the row entirely (${key})`
			);
		}
		assert.deepEqual(
			write.ops.filter((op) => op.op === "unset").map((op) => op.path[0]).sort(),
			[...LIVE_MIRROR_FIELDS].sort(),
			"every write-back carries the unset for every live field — the whole clear, in order"
		);
	}
	const seeded = healed.writes.find((write) => Object.prototype.hasOwnProperty.call(write.patch, "chromePath"));
	assert.ok(seeded !== undefined, "the seeded selection was persisted");
	assert.equal(healed.user.chromePath, process.execPath, "the seeded path stands in the row");
}

// ── the headless mirror: /chrome-path and /chrome-refresh ───────────────────
{
	const s = stub();
	apply(s.ctx, s.config, s.deps);
	const names = s.commandDefs.map((definition) => definition.name).sort();
	assert.deepEqual(names, ["chrome-path", "chrome-refresh"], "the two commands register alongside the tool");
	for (const definition of s.commandDefs) {
		assert.equal(typeof definition.description, "string", `the ${definition.name} command carries a description`);
		assert.ok(definition.input.hint.length > 0, `the ${definition.name} command carries an input hint`);
		assert.equal(typeof definition.handler, "function", `the ${definition.name} command has a handler`);
	}
	// Disposal releases the registrations — and the kinds. A hot re-apply must
	// leave nothing standing behind.
	for (const cleanup of s.effectCleanups) cleanup();
	assert.equal(s.commandDefs.length, 0, "disposal releases both command registrations");
	assert.equal(s.kinds.length, 0, "and withdraws the connection kinds with it");
}

// A host without a commands plane answers the half with nothing — registration
// stands down; the rest of the component is exactly as it was.
{
	const s = stub({ commands: false });
	apply(s.ctx, s.config, s.deps);
	assert.equal(s.commandDefs.length, 0, "no commands service, no registrations");
	assert.equal(s.kinds.length, 1, "the kinds register regardless");
}

// `/chrome-path` with no argument reads the pill: current selection, saved
// rows, usage.
{
	const s = stub({ user: { chromePath: process.execPath }, row: { executables: [{ id: "/usr/bin/chromium", name: "Chromium" }, { id: "/opt/chrome", name: "" }] } });
	apply(s.ctx, s.config, s.deps);
	await settle(120);
	const command = s.commandDefs.find((definition) => definition.name === "chrome-path");
	const answer = await command.handler({ rawInput: "   " });
	assert.equal(answer.kind, "success");
	assert.match(answer.text, new RegExp(`Current executable: ${escapeRe(process.execPath)}`), "the current selection reads first");
	assert.match(answer.text, /- Chromium/, "a saved row reads by its name");
	assert.match(answer.text, /Usage: \/chrome-path/, "the usage line rides along");
}

// A path write goes through the Host write-back channel — the whole live clear
// riding along — moves the default, re-runs the executable run behind it, and
// hands the live connections that follow the row back to the pool.
{
	const s = stub({ serviceEntries: [entry("follower", "chrome", {})] });
	apply(s.ctx, s.config, s.deps);
	await settle(120);
	s.invalidations.length = 0;
	const command = s.commandDefs.find((definition) => definition.name === "chrome-path");
	const answer = await command.handler({ rawInput: process.execPath });
	assert.equal(answer.kind, "success");
	assert.match(answer.text, new RegExp(`selected: ${escapeRe(process.execPath)}`), "the answer states the selected executable");
	const selectionWrite = s.writes.find((write) => write.ops.some((op) => op.op === "set" && op.path[0] === "chromePath" && op.value === process.execPath));
	assert.ok(selectionWrite !== void 0, "the write landed through the Host write-back channel");
	for (const key of LIVE_MIRROR_FIELDS) {
		assert.equal(
			selectionWrite.ops.some((op) => op.op === "unset" && op.path[0] === key),
			true,
			`the selection write clears the live field ${key} like every Host write-back does`
		);
	}
	await settle(150);
	assert.equal(s.user.chromePath, process.execPath, "the persisted row answers the selection");
	assert.equal(published(s).effectiveChromePath, process.execPath, "the live mirror answers the new selection");
	assert.equal(s.invalidations.includes("follower"), true, "the connections that follow the row are handed back");
}

// `/chrome-path none` clears the user selection back to the row config.
{
	const s = stub({ user: { chromePath: "/gone/executable" }, row: { chromePaths: [] } });
	apply(s.ctx, s.config, s.deps);
	await settle(120);
	const command = s.commandDefs.find((definition) => definition.name === "chrome-path");
	const cleared = await command.handler({ rawInput: "none" });
	assert.equal(cleared.kind, "success");
	assert.equal(s.user.chromePath, "", "the cleared write lands as the row's empty answer");
	await settle(150);
	assert.equal(published(s).effectiveChromePath, "", "the default answers launch with nothing fixed again");
}
{
	const s = stub({ row: { chromePaths: [] } });
	apply(s.ctx, s.config, s.deps);
	await settle(120);
	const command = s.commandDefs.find((definition) => definition.name === "chrome-path");
	const noop = await command.handler({ rawInput: "none" });
	assert.equal(noop.kind, "success");
	assert.match(noop.text, /nothing to clear/, "clearing what stands uncleared says so instead of writing");
}

// Control characters never reach the write — the schema's path pattern is the
// same gate a GUI write would run through.
{
	const s = stub();
	apply(s.ctx, s.config, s.deps);
	const command = s.commandDefs.find((definition) => definition.name === "chrome-path");
	const refused = await command.handler({ rawInput: "/tmp/evil\nexec" });
	assert.equal(refused.kind, "error", "a control character in the path is refused on the command door");
	assert.equal(s.writes.length, 0, "and nothing was persisted");
}

// `/chrome-refresh` runs one executable run and reads the answers off the live
// mirror.
{
	const s = stub({ row: { chromePaths: [process.execPath, "/nonexistent-dir/absent"] } });
	apply(s.ctx, s.config, s.deps);
	await settle(150);
	const command = s.commandDefs.find((definition) => definition.name === "chrome-refresh");
	const before = published(s).executableDiscoveryRevision;
	const report = await command.handler({ rawInput: "" });
	assert.equal(report.kind, "success", "a run that found something reports it");
	assert.ok(published(s).executableDiscoveryRevision > before, "the run bumped the completion counter before the report read it");
	assert.match(report.text, /1 runnable/, "the found path is counted");
	// The refresh moves the pickers' answers too: what a `select` offers just
	// changed.
	assert.equal(state.notifications >= 1, true, "the refresh notifies the kind fields");
}

// ── M6: the bounded retry of a failed executable run ────────────────────────
{
	pinRetryTimers();
	const missing = stub({ row: { chromePaths: ["/nonexistent-dir/chrome-should-not-exist"] } });
	apply(missing.ctx, missing.config, missing.deps);
	await settle(60);
	assert.equal(published(missing).chromeMissing, true, "the first run settles standing failed");
	const firstRevision = published(missing).executableDiscoveryRevision;
	assert.equal(firstRevision, 1, "the registration run counted");
	assert.equal(retryTimers.length, 1, "the failed run armed one bounded retry");
	assert.equal(retryTimers[0].cleared, false, "it stands armed");
	for (let bump = 2; bump <= DISCOVERY_RETRY_MAX; bump++) {
		assert.equal(fireRetryTimer(), true, `the ${String(bump - 1)}st retry fires the run again`);
		await settle(60);
		assert.equal(published(missing).executableDiscoveryRevision, firstRevision + bump - 1, "a retry bumps the counter the way a manual run does");
		assert.equal(published(missing).chromeMissing, true, "a failed retry re-states the known error without clearing it");
		assert.equal(retryTimers.filter((timer) => !timer.cleared).length, 1, "the failing retry armed exactly one more");
	}
	assert.equal(fireRetryTimer(), true, "the last armed retry fires the run");
	await settle(60);
	assert.equal(fireRetryTimer(), false, "nothing is armed beyond the cap");
	assert.equal(published(missing).executableDiscoveryRevision, firstRevision + DISCOVERY_RETRY_MAX, "the counter stays capped");
	assert.equal(missing.writes.length, 0, "retries never persist");
}

// A run that answers stands no retry: the retry keys on what the mirror states,
// not on the run's mere presence.
{
	pinRetryTimers();
	const healthy = stub({ row: { chromePaths: [process.execPath] } });
	apply(healthy.ctx, healthy.config, healthy.deps);
	await settle(80);
	assert.equal(published(healthy).chromeMissing, false, "the run answered for the executable");
	assert.equal(retryTimers.length, 0, "a healthy run arms no retry");
}

// Disposal cancels a pending retry: an instance that no longer exists must not
// fire runs nobody asked for.
{
	pinRetryTimers();
	const gone = stub({ row: { chromePaths: ["/nonexistent-dir/chrome-should-not-exist"] } });
	apply(gone.ctx, gone.config, gone.deps);
	await settle(60);
	assert.equal(retryTimers.length, 1, "the failed run armed one pending retry");
	const before = published(gone).executableDiscoveryRevision;
	for (const cleanup of gone.effectCleanups) cleanup();
	assert.equal(retryTimers.every((timer) => timer.cleared), true, "disposal clears the pending retry timer");
	assert.equal(fireRetryTimer(), false, "nothing stands armed after disposal");
	await settle(150);
	assert.equal(published(gone).executableDiscoveryRevision, before, "the disposed instance runs no retry");
}

console.log("apply.test.mjs: all assertions passed");
