// Materializes lib/client.js in a stubbed browser environment (the same
// window.__ModuleLoader__.load contract the shell's module system uses) and
// exercises the card: registration, snapshot projection, render tree, the
// flags editor write path, the saved-executable picker (the pill, the rows and
// the search action) and the poll that waits on the host's executable run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// ── stubs ────────────────────────────────────────────────────────────────
let registration = null;
const window = { __ModuleLoader__: { load: (reg) => (registration = reg) } };
const styles = [];
const document = {
	querySelector: () => null,
	createElement: (tag) => ({
		tag,
		dataset: {},
		textContent: "",
		setAttribute() {}
	}),
	head: { appendChild: (el) => styles.push(el) }
};
// Stateful useState: the card keeps `open`/`isRunning` across re-renders, so
// the stub must persist hook values by call slot. Renders reset the slot index.
let hookStates = [];
let hookIndex = 0;
let lastHookCount = null;
const react = {
	useId: () => ":r1:",
	useState: (init) => {
		const i = hookIndex++;
		if (!(i in hookStates)) hookStates[i] = typeof init === "function" ? init() : init;
		const set = (next) => {
			hookStates[i] = typeof next === "function" ? next(hookStates[i]) : next;
		};
		return [hookStates[i], set];
	},
	// useRef keeps one persistent object per call site (refs must not be
	// re-created across renders, matching the real implementation).
	useRef: (init) => {
		const refs = (react.useRef._refs ??= []);
		const i = (react.useRef._index = (react.useRef._index ?? 0) + 1) - 1;
		if (!(i in refs)) refs[i] = { current: init };
		return refs[i];
	},
	useEffect: () => {}
};
function materialize(type, props, key, kind) {
	const node = { kind, type, props, key, children: props?.children };
	return node;
}
const jsxRuntime = {
	jsx: (type, props, key) => materialize(type, props, key, "jsx"),
	jsxs: (type, props, key) => materialize(type, props, key, "jsxs")
};

const storeState = {
	available: false,
	writable: false,
	extraFlags: [],
	lastError: "",
	chromeMissing: false,
	executableDiscoveryRevision: 0,
	chromeVersion: "",
	executables: [],
	executableStatus: [],
	chromePath: "",
	effectiveChromePath: "",
	effectiveSource: "",
	stderrMode: "",
	rowStderr: "log",
	defaultExtraFlags: [],
	wslExtraFlags: [],
	wslWindowsExecutable: false,
	windowsChromeStatus: { state: "off", port: 0, error: "" },
	carriesConnectionMode: false,
	actionError: ""
};
const listeners = new Set();
const clientStore = {
	createSnapshotStore: (initial) => ({
		getSnapshot: () => storeState,
		subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
		set: (next) => Object.assign(storeState, next)
	})
};
/**
 * The card's shell primitives, stubbed here: the dropdown list, its selection
 * tick, the portal and the keyboard handling belong to them, so the assertions
 * only ever see `props` (what was handed in) plus the rendered nodes they
 * produce.
 */
const menuProps = [];
const primitives = {
	Menu: (props) => {
		menuProps.push(props);
		return props.anchor;
	},
	// Switch primitive stub: a findable typed node carrying its raw props so
	// the toggle state and the onChange wiring are assertable.
	Switch: (props) => ({
		kind: "jsx",
		type: "Switch",
		props,
		children: undefined
	})
};
const requireStub = (spec) => {
	if (spec === "react") return react;
	if (spec === "react/jsx-runtime") return jsxRuntime;
	if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${spec}`);
};

// ── materialize ──────────────────────────────────────────────────────────
// setTimeout/clearTimeout stand in for the browser globals the action poll
// schedules against (the real bundle runs in a page). The card's probe-age clock
// ticks on the interval form of the same pair.
vm.runInNewContext(bundle, {
	window,
	document,
	require: undefined,
	console,
	setTimeout,
	clearTimeout,
	setInterval: () => 1,
	clearInterval: () => {}
});
assert.ok(registration, "bundle registered with __ModuleLoader__");
assert.equal(registration.id, "@comecaramelos/dsh-chrome-mcp");
const factoryResult = registration.factory(requireStub);
assert.equal(typeof factoryResult.apply, "function", "exports.apply");
assert.equal(JSON.stringify(factoryResult.inject), JSON.stringify(["slots", "locale", "settingsScope"]), "exports.inject");

// ── settings scope stub ──────────────────────────────────────────────────
const scopeSnapshot = {
	status: "ready",
	value: {
		extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
		refreshExecutablesNonce: 0,
		chromePath: "",
		executables: [],
		stderrMode: "",
		lastError: "",
		executableDiscoveryRevision: 0,
		chromeVersion: "",
		executableStatus: [],
		effectiveChromePath: "",
		effectiveSource: ""
	},
	writable: true,
	revision: 1
};
const writes = [];
let rejectNextFlagsWrite = false;
const scope = {
	getSnapshot: () => scopeSnapshot,
	subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
	set: (field, value) => {
		if (field === "extraFlags" && rejectNextFlagsWrite) {
			rejectNextFlagsWrite = false;
			return Promise.reject(new Error("write rejected by host"));
		}
		writes.push([field, value]);
		scopeSnapshot.value = { ...scopeSnapshot.value, [field]: value };
		listeners.forEach((fn) => fn());
		return Promise.resolve();
	}
};
// Shared describe-mirror stub: an executable action re-reads it while the
// host's run is still en route. Advance the served revision to let a poll
// settle.
const mirror = {
	loadCalls: 0,
	load: () => {
		mirror.loadCalls += 1;
		return Promise.resolve();
	}
};

// ── cordis client ctx stub ───────────────────────────────────────────────
const registeredSlotEntries = [];
const ctx = {
	effect: (fn) => {
		const disposer = fn();
		return { dispose: () => (disposer?.dispose?.() ?? disposer?.()) };
	},
	locale: {
		register: (ns, dicts) => {
			assert.equal(ns, "chromeMcp");
			assert.ok(dicts.en);
			var required = [
				"title", "description", "flagsTitle", "flagsHint", "flagsEmpty", "flagsValueLabel",
				"flagsValuePlaceholder", "addFlag", "removeFlag", "flagsRestore", "flagsRestoreTitle",
				"flagsWsl", "flagsWslTitle",
				"openWindowsChrome", "openWindowsChromeTitle", "openWindowsChromeBusy",
				"windowsChromeNotWsl", "windowsChromeNotFound", "windowsChromeUnreachable",
				"connectModeLabel", "connectModeHint",
				"executableLabel", "executableHint", "executableNone", "unavailableSuffix",
				"executableRows", "executableIdLabel", "executableIdPlaceholder", "executableNameLabel",
				"namePlaceholder", "addExecutable", "removeExecutable", "fetchExecutables",
				"fetching", "executableEmpty",
				"dialogExecutablesTitle", "dialogExecutablesDescription", "dialogEmpty",
				"searchExecutables", "selectAll", "addSelected", "candidateSaved", "close", "cancel",
				"wslWindowsTitle", "wslWindowsNote",
				"probing", "versionLabel", "probeJustNow", "probeSecondsAgo", "probeMinutesAgo",
				"probeHoursAgo",
				"reduceLabel", "reduceTitle", "reduceHint", "docsMessage", "docsLinkLabel",
				"statusError", "statusOk", "chromeMissing", "readOnly", "expand", "collapse",
				"apply", "discard", "saving", "unsaved", "saveFailed"
			];
			for (var i = 0; i < required.length; i++) {
				assert.ok(required[i] in dicts.en, "en has key: " + required[i]);
			}
		},
		bind: () => (key) => key
	},
	settingsScope: {
		bind: (spec) => (assert.equal(spec.namespace, "chrome-mcp"), scope),
		describe: () => mirror
	},
	slots: {
		inject: (slot, registerFn) => {
			assert.equal(slot, "settings.plugin.item");
			registerFn(); // factory calls ctx.slots.register below
		},
		register: (options, Component) => {
			registeredSlotEntries.push([options, Component]);
			return () => {}; // disposer
		}
	}
};

factoryResult.apply(ctx);
// ── stylesheet ───────────────────────────────────────────────────────────
// The card's stylesheet rides in on apply(): one <style> element carrying the
// CSS-modules compilation result. Class names are scoped by the build step
// (`scripts/build-client.mjs`) as `<hash>_<local>`, so the render assertions
// below resolve every local name through CLS().
assert.equal(styles.length, 1, "one style tag injected");
assert.ok(styles[0].dataset.pluginCss === "@comecaramelos/dsh-chrome-mcp/ChromeMcpCard.module.css");
const PREFIX = styles[0].textContent.match(/\.([a-z0-9]{6})_/)[1];
const CLS = (local) => PREFIX + "_" + local;

assert.equal(registeredSlotEntries.length, 1, "one settings.plugin.item entry");
const [options, Component] = registeredSlotEntries[0];
assert.equal(options.name, "settings.plugin.item");
assert.equal(options.key, "chrome-mcp");
assert.equal(options.locale, "chromeMcp");
assert.equal(typeof Component, "function");

// ── render helpers ────────────────────────────────────────────────────────
function render(state) {
	hookIndex = 0;
	var hookCount = 0;
	var _useState = react.useState;
	var _useEffect = react.useEffect;
	var _useId = react.useId;
	react.useState = function (init) { ++hookCount; return _useState.call(this, init); };
	react.useEffect = function () { ++hookCount; return _useEffect.call(this); };
	react.useId = function () { ++hookCount; return _useId.call(this); };
	var result = Component({
		t: (k) => k,
		useChromeMcpCard: (sel) => sel(state),
		saveFlags: (v) => scope.set("extraFlags", v),
		toggleStderr: () => {
			var cur = typeof state.stderrMode === "string" && state.stderrMode !== "" ? state.stderrMode : (state.rowStderr === "console" ? "console" : "log");
			return scope.set("stderrMode", cur === "log" ? "console" : "log");
		},
		// Stands in for the controller's executable actions: what the card
		// calls is what the controller writes.
		selectExecutable: (id) => scope.set("chromePath", id),
		saveExecutables: (entries) => scope.set("executables", entries),
		refreshExecutables: () => {
			// Read the run's answer list *before* the trigger write lands: the
			// write re-publishes the controller's own snapshot, which carries
			// the statuses the card asked for, not what the fetch resolves with.
			const found = candidatesOf(state);
			scope.set("refreshExecutablesNonce", 999);
			return Promise.resolve(found);
		},
		addExecutables: (ids) =>
			scope.set("executables", (state.executables ?? []).concat(ids.map((id) => ({ id: id, name: "" })))),
		// Stands in for the Windows Chrome action: the trigger write, exactly as
		// the controller writes it.
		openWindowsChrome: () => scope.set("openWindowsChromeNonce", 1234),
		refresh: () => Promise.resolve()
	});
	react.useState = _useState;
	react.useEffect = _useEffect;
	react.useId = _useId;
	if (lastHookCount !== null) assert.equal(hookCount, lastHookCount, "hook count stable across renders");
	lastHookCount = hookCount;
	// Expand the tree's function components exactly once, in render order — the
	// same thing React does when it reconciles. Calling them again from a
	// traversal would hand them fresh hook slots and a component would read its
	// state from the wrong slot.
	expand(result);
	return result;
}

/** Keep the render argument and the scope stub in step: an executable action
 * writes the scope, and the live controller republishes the card store from
 * it — so a field the test wants served has to ride both. */
function serve(fields) {
	Object.assign(storeState, fields);
	Object.assign(scopeSnapshot.value, fields);
	return storeState;
}

/** The candidate list the fetch action resolves with — exactly what the real
 * controller hands back after the host's run settles: every path the run
 * looked at and what it answered for it. */
function candidatesOf(state) {
	return (state.executableStatus ?? []).slice();
}
/** Expand a materialized tree in place: a component node is replaced by what it
 * renders, so a plain structural walk sees everything. */
function expand(node) {
	if (node === null || node === undefined || typeof node !== "object") return;
	if (Array.isArray(node)) {
		node.forEach(expand);
		return;
	}
	if (typeof node.type === "function") {
		const out = node.type(node.props);
		node.children = out;
		expand(out);
		return;
	}
	if (node.children !== undefined) expand(node.children);
}
function walk(node, found = []) {
	if (node === null || node === undefined || typeof node !== "object") return found;
	if (Array.isArray(node)) {
		node.forEach((child) => walk(child, found));
		return found;
	}
	if (node.type !== undefined) {
		found.push(node);
		if (node.children !== undefined) walk(node.children, found);
	}
	return found;
}
const isNode = (type, className) => (n) => n.type === type && n.props?.className === className;
/** The read-only value paragraph: nothing renders one any more (the
 * executable reads on the pill, the flags read as their own rows), so any use of
 * it is a regression against the row shape. */
const values = (t) => walk(t).filter((n) => n.type === "p" && n.props?.className === CLS("value"));
/** The executable-run result line — rendered only once the host knows a
 * version, so a run is more than a label flip. */
const resultLine = (t) => walk(t).find((n) => n.type === "p" && n.props?.className === CLS("result"));
/** Button identified by its localizable label. */
const isLabel = (label) => (n) => n.type === "button" && n.props?.children === label;
const findPill = (t) => walk(t).find(isNode("button", CLS("selector")));
/** One bordered box per saved executable (the two-field row shape: the extra
 * flags list rides its own single-field variant, matched through `catalogRowSingle`). */
const rowBoxes = (t) => walk(t).filter((n) => n.type === "div" && n.props?.className === CLS("catalogRow"));
const rowInputs = (t) => walk(t).filter(isNode("input", CLS("catalogInput")));
/** The extra-flags list, read through its single-field rows: one monospaced
 * field per saved flag, one delete control per box. */
const flagBoxes = (t) =>
	walk(t).filter((n) => n.type === "div" && n.props?.className === CLS("catalogRow") + " " + CLS("catalogRowSingle"));
const flagFields = (t) =>
	walk(t).filter(
		(n) => n.type === "input" && typeof n.props?.className === "string" && n.props.className.includes(CLS("catalogInputMono"))
	);
const flagTrashes = (t) => walk(t).filter((n) => n.type === "button" && n.props?.title === "removeFlag");
const findTrash = (t) =>
	walk(t).find(
		(n) => n.type === "button" && typeof n.props?.className === "string" && n.props.className.includes(CLS("iconButton"))
	);
function findDot(t) {
	return walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith(CLS("dot") + " "));
}
function dotState(dot) {
	return dot.props.className.includes(CLS("dotError")) ? "error" : "none";
}

const DOCS_URL =
	"https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md";

// ── render 1: unavailable ────────────────────────────────────────────────
Object.assign(storeState, { available: false });
let tree = render(storeState);
assert.equal(tree, null, "renders nothing while namespace is unavailable");

// ── render 2: available, collapsed by default ─────────────────────────────
Object.assign(storeState, {
	available: true,
	writable: true,
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	lastError: "",
	chromeVersion: "",
	actionError: "",
	executableDiscoveryRevision: 0
});
tree = render(storeState);
assert.ok(tree && tree.type === "li", "card root is an li");
assert.equal(tree.props.className, CLS("card"), "no cardOpen class while collapsed");
let header = walk(tree).find(isNode("button", CLS("header")));
assert.ok(header, "header disclosure button rendered");
assert.equal(header.props["aria-expanded"], false, "card collapsed by default");
assert.equal(header.props["aria-label"], "expand: title", "header aria-label names the action and card");
assert.ok(header.props["aria-controls"], "header has aria-controls");
assert.equal(walk(tree).find(isNode("div", CLS("body"))), undefined, "body div absent while collapsed");
assert.equal(walk(tree).find(isNode("a", CLS("docsLink"))), undefined, "configuration-guide link row absent while collapsed");

// ── expand via the header button ──────────────────────────────────────────
header.props.onClick();
tree = render(storeState);
assert.ok(String(tree.props.className).includes(CLS("cardOpen")), "cardOpen class while expanded");
assert.equal(
	walk(tree).find(isNode("button", CLS("header"))).props["aria-expanded"],
	true,
	"aria-expanded flips open"
);
const nodes = walk(tree);

// configuration-guide link: an icon + short label beside the Extra flags title
const link = nodes.find(isNode("a", CLS("docsLink")));
assert.ok(link, "configuration-guide link rendered once expanded");
assert.equal(link.props.href, DOCS_URL, "link points at the upstream configuration docs");
assert.equal(link.props.target, "_blank");

// Extra flags (writable mode renders one row per saved flag, no free-form box)
const fieldTitle = walk(tree).find(
	(n) => n.type === "span" && n.props?.className === CLS("fieldTitle") && n.props.children === "flagsTitle"
);
assert.ok(fieldTitle, "flags field title rendered");
assert.ok(walk(tree).find(isNode("div", CLS("fieldDesc"))), "flags field description rendered");
assert.equal(walk(tree).find(isNode("textarea")), undefined, "no free-form editor: the flags list replaced the textarea");
// The flags rows now sit behind the same collapsed <details> disclosure the
// saved executables use — so the expanded body carries two disclosure blocks.
assert.equal(
	walk(tree).filter((n) => n.type === "details" && n.props?.className === CLS("disclosure")).length,
	2,
	"both row lists — the saved executables and the extra flags — live behind a disclosure"
);
assert.ok(
	walk(tree).find(
		(n) => n.type === "span" && n.props?.className === CLS("disclosureLabel") && n.props.children === "flagsRows"
	),
	"the flags list opens on a disclosure head naming its rows"
);
assert.equal(flagBoxes(tree).length, 2, "one single-field row per saved flag");
const flagRows = flagFields(tree);
assert.equal(flagRows.length, 2, "each flag row is one field wide");
assert.equal(flagRows[0].props.value, "--no-usage-statistics", "a row field carries the saved flag");
assert.equal(flagRows[1].props.value, "--no-performance-crux", "and so does the next one");
assert.equal(flagRows[0].props.placeholder, "flagsValuePlaceholder", "the field's placeholder is localizable");
assert.equal(flagRows[0].props["aria-label"], "flagsValueLabel 1", "each row field labels itself by index");
assert.equal(flagTrashes(tree).length, 2, "each flag row carries its own delete control");
assert.ok(walk(tree).find(isLabel("addFlag")), "the flags list carries an add-flag control");
// No separate save control: a blur/Enter commits the whole list, the way the
// executable rows do.
assert.equal(
	walk(tree).find((n) => n.type === "button" && typeof n.props?.children === "string" && n.props.children.includes("flagsSave")),
	undefined,
	"no save control: the rows commit on their own"
);
// The Restore-defaults control is the list's own action: enabled only while the
// host actually serves a defaults list (base layer), it keeps what the rows
// carry and appends just the missing defaults.
Object.assign(storeState, {
	defaultExtraFlags: ["--no-usage-statistics", "--no-performance-crux"]
});
tree = render(storeState);
const restoreBtn = walk(tree).find(isLabel("flagsRestore"));
assert.ok(restoreBtn, "restore-defaults button rendered");
assert.equal(restoreBtn.props.disabled, false, "restore enabled while the host serves defaults");
assert.equal(restoreBtn.props.title, "flagsRestoreTitle", "its tooltip is localizable");
Object.assign(storeState, { defaultExtraFlags: [] });
assert.equal(walk(render(storeState)).find(isLabel("flagsRestore")).props.disabled, true, "no defaults served → nothing to recover");
// ── the Flags WSL control ────────────────────────────────────────────────────
// The recommended WSL ↔ Windows flags are host-served too (base layer), so the
// control is enabled only while the host actually serves that list.
Object.assign(storeState, {
	wslExtraFlags: ["--chromeArg=--remote-debugging-port=9222"]
});
tree = render(storeState);
const wslBtn = walk(tree).find(isLabel("flagsWsl"));
assert.ok(wslBtn, "the WSL-flags button renders");
assert.equal(wslBtn.props.disabled, false, "WSL enabled while the host serves recommended flags");
assert.equal(wslBtn.props.title, "flagsWslTitle", "its tooltip is localizable");
Object.assign(storeState, { wslExtraFlags: [] });
assert.equal(walk(render(storeState)).find(isLabel("flagsWsl")).props.disabled, true, "no recommended flags served → nothing to add");
// ── the executable picker ─────────────────────────────────────────────────
// Nothing saved yet: the pill invites a pick, the empty-state notice says what
// to do, and the saved rows live behind a collapsed disclosure.
const pill = findPill(tree);
assert.ok(pill, "the pill that anchors the dropdown renders");
assert.equal(pill.props.children[0].props.children, "executableNone", "an unresolved selection invites a pick");
assert.equal(pill.props["aria-expanded"], false, "the dropdown starts closed");
assert.equal(pill.props["aria-haspopup"], "menu", "the pill is a menu trigger");
assert.equal(values(tree).length, 0, "no separate value line — the pill states the selection itself");
assert.ok(
	walk(tree).find((n) => n.type === "p" && n.props?.className === CLS("empty")),
	"with nothing saved the card says what to do"
);
assert.ok(walk(tree).find(isNode("details", CLS("disclosure"))), "the saved rows live behind a disclosure");
assert.ok(walk(tree).find(isNode("summary", CLS("disclosureSummary"))), "the disclosure carries its head");
assert.ok(walk(tree).find(isNode("span", CLS("disclosureCount"))), "the head counts the rows");
const search = walk(tree).find(isLabel("fetchExecutables"));
assert.ok(search, "the search-executables action renders inside the disclosure");
assert.equal(search.props.disabled, false, "search is available while writable");

// ── the Prelaunch Windows Chrome button ───────────────────────────────────────
// The button rides the executable block's action line next to the fetch
// control, and its whole disabled reason is localizable copy — the card never
// re-derives reachability or the Windows path list.
Object.assign(storeState, { windowsChromeStatus: { state: "off", port: 0, error: "" } });
tree = render(storeState);
const winBtn = walk(tree).find(isLabel("openWindowsChrome"));
assert.ok(winBtn, "the Windows Chrome button renders");
assert.equal(winBtn.props.disabled, false, "off + writable → the run can be launched");
assert.equal(winBtn.props.title, "openWindowsChromeTitle", "its tooltip is localizable");
// launch-failed is an idle answer: retry is available.
Object.assign(storeState, { windowsChromeStatus: { state: "launch-failed", port: 0, error: "could not start Windows Chrome" } });
assert.equal(walk(render(storeState)).find(isLabel("openWindowsChrome")).props.disabled, false, "a failed launch is retryable");
// Every failure answer disables with its own reason.
Object.assign(storeState, { windowsChromeStatus: { state: "unreachable", port: 0, error: "no-alcanzable" } });
{
	const t2 = render(storeState);
	const b2 = walk(t2).find((n) => n.type === "button" && n.props?.title === "windowsChromeUnreachable");
	assert.ok(b2, "unreachable renders with its prereq tooltip");
	assert.equal(b2.props.disabled, true, "nothing can launch into an unreachable loopback");
	assert.equal(b2.props.children, "openWindowsChrome", "the busy label belongs to the busy state only");
}
Object.assign(storeState, { windowsChromeStatus: { state: "not-found", port: 0, error: "no Windows Chrome found" } });
assert.equal(walk(render(storeState)).find((n) => n.type === "button" && n.props?.title === "windowsChromeNotFound").props.disabled, true, "no Windows binary → disabled");
Object.assign(storeState, { windowsChromeStatus: { state: "not-applicable", port: 0, error: "" } });
assert.equal(walk(render(storeState)).find((n) => n.type === "button" && n.props?.title === "windowsChromeNotWsl").props.disabled, true, "off-WSL → disabled");
Object.assign(storeState, { windowsChromeStatus: { state: "launching", port: 9222, error: "" } });
{
	const t3 = render(storeState);
	const busy = walk(t3).find(isLabel("openWindowsChromeBusy"));
	assert.ok(busy, "while launching the button reads as busy");
	assert.equal(busy.props.disabled, true, "busy cannot be clicked twice");
}
Object.assign(storeState, { windowsChromeStatus: { state: "off", port: 0, error: "" } });
// A read-only deployment disables it like every other control.
const writable = storeState.writable;
Object.assign(storeState, { writable: false });
assert.equal(walk(render(storeState)).find(isLabel("openWindowsChrome")).props.disabled, true, "read-only → disabled");
Object.assign(storeState, { writable: writable });
// Clicking writes the trigger field (the same nonce idiom as every executable
// action — there is no push channel).
Object.assign(storeState, { windowsChromeStatus: { state: "off", port: 0, error: "" } });
const winTree = render(storeState);
const winWritesBefore = writes.filter(([f]) => f === "openWindowsChromeNonce").length;
walk(winTree).find(isLabel("openWindowsChrome")).props.onClick();
assert.equal(writes.filter(([f]) => f === "openWindowsChromeNonce").length, winWritesBefore + 1, "the click writes the trigger nonce");
// healthy: no error dot
assert.equal(findDot(tree), undefined, "no status dot while healthy");
assert.equal(walk(tree).find(isNode("p", CLS("error"))), undefined, "no error paragraph while healthy");

// ── connect mode: the pill reads the connect address but stays openable ──
// A connect-mode flag means the bridge connects instead of launching, so the
// pill shows the connect address rather than a local executable it never ran —
// but the dropdown keeps working, so the rows stay editable while connected.
Object.assign(storeState, { carriesConnectionMode: true, effectiveChromePath: "/usr/bin/google-chrome", chromeVersion: "" });
const cmTree = render(storeState);
const cmPill = findPill(cmTree);
assert.equal(cmPill.props.disabled, false, "connect mode leaves the pill openable — connect is not a lock on the saved rows");
assert.equal(cmPill.props.children[0].props.children, "connectModeLabel", "the pill reads connect mode, not the local selection");
{
	const hint = walk(cmTree).find((n) => n.type === "div" && n.props?.className === CLS("fieldDesc") && n.props.children === "connectModeHint");
	assert.ok(hint, "the picker explains connect mode in place of the local hint");
}
Object.assign(storeState, { carriesConnectionMode: false });

// ── the saved rows ────────────────────────────────────────────────────────
// One row per saved executable: the id is what goes on the wire, the name is
// what the card shows. A row whose probe failed is tagged in the list and
// carries its failure under the row. There is no "auto" entry to look for.
Object.assign(storeState, {
	executables: [
		{ id: "/usr/bin/google-chrome", name: "system" },
		{ id: "/home/u/chrome", name: "" },
		{ id: "/broken/chrome", name: "broken" }
	],
	executableStatus: [
		{ path: "/usr/bin/google-chrome", version: "Google Chrome 139.0.7258.0", error: "" },
		{ path: "/home/u/chrome", version: "Google Chrome 138.0.0.0", error: "" },
		{ path: "/broken/chrome", version: "", error: "executable not found: /broken/chrome" }
	],
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected"
});
tree = render(storeState);
const lastMenu = menuProps.at(-1);
assert.ok(lastMenu, "the card handed the dropdown primitive its list");
// Cross-realm: the arrays come from the bundle's Array.prototype, so compare
// their serialization, not their identities.
assert.equal(
	JSON.stringify(lastMenu.items.map((item) => item.label)),
	JSON.stringify(["system", "/home/u/chrome", "broken (unavailableSuffix)"]),
	"a row's label is its saved name, else its path, tagged when its probe failed"
);
assert.equal(
	JSON.stringify(lastMenu.items.map((item) => item.id)),
	JSON.stringify(["/usr/bin/google-chrome", "/home/u/chrome", "/broken/chrome"]),
	"a row's id is what goes on the wire"
);
assert.equal(lastMenu.selectedId, "/usr/bin/google-chrome", "the effective path is ticked");
assert.equal(lastMenu.open, false, "the list stays closed until the pill is clicked");
assert.equal(lastMenu.portal, true, "the list is portalled out of the card row");
const filled = findPill(tree);
assert.equal(filled.props.children[0].props.children, "system", "the pill shows the saved name, not the version");
assert.equal(filled.props.title, "/usr/bin/google-chrome", "the pill's title is the full path");
const rows = rowBoxes(tree);
assert.equal(rows.length, 3, "one row per saved executable");
const inputs = rowInputs(tree);
assert.equal(inputs.length, 6, "each row carries its path and its display name");
assert.equal(inputs[0].props.value, "/usr/bin/google-chrome", "the first row's path field");
assert.equal(inputs[1].props.value, "system", "and its saved name");
assert.equal(inputs[1].props.placeholder, "namePlaceholder", "an unnamed row invites a label");
assert.ok(findTrash(tree), "a row carries a delete control");
assert.ok(walk(tree).find(isLabel("addExecutable")), "add-executable button rendered");
// A row carries no status of its own: the answers the host's run gives live in
// the dialog the fetch action opens, the same shape the reference card uses.
assert.equal(
	walk(tree).filter((n) => String(n.props?.className ?? "").startsWith(CLS("rowStatus"))).length,
	0,
	"no inline status line under a row"
);

// What runs is always offered, even when it is not (or is no longer) a saved
// row: a host-seeded path, or one the row config alone carries.
Object.assign(storeState, { executables: [], effectiveChromePath: "/opt/chrome", effectiveSource: "row-config" });
tree = render(storeState);
const fallbackMenu = menuProps.at(-1);
assert.equal(
	JSON.stringify(fallbackMenu.items.map((item) => item.id)),
	JSON.stringify(["/opt/chrome"]),
	"what runs is offered even without a row"
);
assert.equal(findPill(tree).props.children[0].props.children, "/opt/chrome", "with no name saved the pill shows the path");
Object.assign(storeState, { effectiveSource: "selected" });

// picking a row writes the selection (the host restarts the bridge)
menuProps.length = 0;
findPill(tree).props.onClick();
tree = render(storeState);
// The dropdown is rendered as a component, so its props reach the log when the
// walker expands it — exactly once per render.
walk(tree);
const opened = menuProps.at(-1);
assert.equal(opened.open, true, "clicking the pill opens the list");
writes.length = 0;
opened.onSelect("/home/u/chrome");
assert.ok(writes.some(([f, v]) => f === "chromePath" && v === "/home/u/chrome"), "picking a saved path writes chromePath");

// ── editing the rows ──────────────────────────────────────────────────────
Object.assign(storeState, {
	executables: [
		{ id: "/usr/bin/google-chrome", name: "system" },
		{ id: "/home/u/chrome", name: "" }
	],
	executableStatus: [],
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected"
});
tree = render(storeState);
writes.length = 0;
// Typing does not persist on every keystroke: the whole list lands once the
// edit settles (blur or Enter). The stub does not re-render on setState, so the
// rows are re-rendered by hand — the blur handler must close over the draft
// that was just typed.
rowInputs(render(storeState))[1].props.onChange({ target: { value: "browser" } });
rowInputs(render(storeState))[1].props.onBlur();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(writes.length, 1, "a settled edit writes once");
assert.equal(writes[0][0], "executables", "and writes the rows list");
assert.equal(
	JSON.stringify(writes[0][1].map((row) => row.name)),
	JSON.stringify(["browser", ""]),
	"the edit lands in the rows without touching their paths"
);
// A delete is structural: it persists immediately, with no settled edit, and it
// deletes the row its control sits on — the list order is the saved order.
writes.length = 0;
findTrash(render(storeState)).props.onClick();
assert.equal(JSON.stringify(writes.map(([f]) => f)), JSON.stringify(["executables"]), "a delete persists on the spot");
assert.equal(
	JSON.stringify(writes[0][1].map((row) => row.id)),
	JSON.stringify(["/home/u/chrome"]),
	"the deleted row is gone from what is saved"
);
assert.equal(
	JSON.stringify(writes[0][1].map((row) => row.name)),
	JSON.stringify([""]),
	"the delete keeps the remaining row exactly as it was saved"
);
// What was committed comes back as the served list: the pending draft gives way
// to it (a render-phase state update), so a later settle writes nothing.
Object.assign(storeState, { executables: [{ id: "/home/u/chrome", name: "" }] });
writes.length = 0;
render(storeState); // the served change lands: the draft gives way to the list
rowInputs(render(storeState))[0].props.onBlur();
assert.equal(writes.length, 0, "re-committing what is already saved changes nothing");
// "Add executable" is local until the row carries a path: an id-less row would
// be stripped, so the blank row only lands once it is typed in and committed.
writes.length = 0;
walk(render(storeState)).find(isLabel("addExecutable")).props.onClick();
assert.equal(writes.length, 0, "adding a blank row writes nothing yet");
rowInputs(render(storeState))[2].props.onChange({ target: { value: "/opt/chrome" } });
rowInputs(render(storeState))[2].props.onBlur();
assert.equal(
	JSON.stringify(writes.map(([f]) => f)),
	JSON.stringify(["executables"]),
	"a path typed into the blank row commits it"
);
assert.equal(
	JSON.stringify(writes[0][1].map((row) => row.id)),
	JSON.stringify(["/home/u/chrome", "/opt/chrome"]),
	"the new row lands behind the saved ones"
);
Object.assign(storeState, {
	executables: [
		{ id: "/home/u/chrome", name: "" },
		{ id: "/opt/chrome", name: "" }
	]
});

// ── the search action ─────────────────────────────────────────────────────
// The whole fetch section serves both planes: the scope stub drives the live
// controller's republish, the render argument what the card reads.
serve({
	executables: [],
	executableStatus: [],
	effectiveChromePath: "",
	effectiveSource: "",
	chromeVersion: ""
});
const fetchedStatuses = [
	{ path: "/usr/bin/google-chrome", version: "Google Chrome 139.0.7258.0", error: "" },
	{ path: "/home/u/chrome", version: "Google Chrome 138.0.0.0", error: "" },
	{ path: "/broken/chrome", version: "", error: "executable not found: /broken/chrome" }
];
serve({
	executables: [
		{ id: "/usr/bin/google-chrome", name: "" },
		{ id: "/home/u/chrome", name: "" }
	],
	executableStatus: fetchedStatuses,
	chromePath: "/usr/bin/google-chrome",
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected"
});
writes.length = 0;
walk(render(storeState)).find(isLabel("fetchExecutables")).props.onClick();
assert.ok(writes.some(([f]) => f === "refreshExecutablesNonce"), "searching writes the run trigger");
// Let the action promise settle: its `.finally` clears the busy label. The
// run's answer list lands one step later (the scope write resolves first).
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));

// ── the run opens the choose-to-add dialog ────────────────────────────────
// The run answered for every path it looked at, so the card opens the dialog
// over that answer list — the reference card's modal, same shape.
tree = render(storeState);
const dialogNode = walk(tree).find(isNode("div", CLS("fetchDialog")));
assert.ok(dialogNode, "the fetch opens the choose-to-add dialog");
assert.equal(dialogNode.props.role, "dialog", "it renders as a dialog");
assert.equal(dialogNode.props["aria-modal"], "true", "and reads as modal");
const dialogTitle = walk(tree).find(isNode("h2", CLS("dialogTitle")));
assert.equal(dialogTitle.props.children, "dialogExecutablesTitle", "the title is localizable");
const candidates = walk(tree).filter(isNode("li", CLS("candidate")));
assert.equal(candidates.length, 3, "one dialog row per path the run answered for");
const candidateIds = walk(tree).filter(isNode("span", CLS("candidateId"))).map((n) => n.props.children);
assert.equal(
	JSON.stringify(candidateIds),
	JSON.stringify(["/usr/bin/google-chrome", "/home/u/chrome", "/broken/chrome"]),
	"a candidate row names the path it stands for"
);
const notes = walk(tree).filter(isNode("span", CLS("candidateNote"))).map((n) => n.props.children);
assert.equal(
	JSON.stringify(notes),
	JSON.stringify(["Google Chrome 139.0.7258.0", "Google Chrome 138.0.0.0", "executable not found: /broken/chrome"]),
	"a candidate row carries the answer the run gave for it"
);
const candidateChecks = walk(tree).filter((n) => n.type === "input" && n.props?.type === "checkbox");
assert.equal(
	JSON.stringify(candidateChecks.map((n) => n.props.checked)),
	JSON.stringify([true, true, false]),
	"the paths the rows already carry arrive ticked, the new one open"
);
assert.equal(
	JSON.stringify(candidateChecks.map((n) => n.props.disabled)),
	JSON.stringify([true, true, false]),
	"a saved row is ticked and locked — removal is the row list's job"
);
const dialogFooter = walk(tree).find(isNode("div", CLS("dialogFooter")));
assert.ok(dialogFooter, "the dialog carries its footer buttons");
const dialogButtons = walk(tree).filter(
	(n) => n.type === "button" && String(n.props?.className ?? "").includes(CLS("dialogButton"))
);
assert.equal(dialogButtons.length, 2, "Cancel + Add selected");
assert.equal(dialogButtons[0].props.children, "cancel", "the first reads Cancel");
assert.ok(dialogButtons[1].props.className.includes(CLS("dialogButtonPrimary")), "the second reads as the primary action");
// Cancel leaves the rows untouched.
dialogButtons[0].props.onClick();
writes.length = 0;
tree = render(storeState);
assert.equal(walk(tree).find(isNode("div", CLS("fetchDialog"))), undefined, "cancel closes the dialog");
assert.equal(writes.length, 0, "cancel writes nothing");

// ── the run's result line ─────────────────────────────────────────────────
Object.assign(storeState, { effectiveChromePath: "/usr/bin/google-chrome", chromeVersion: "Google Chrome 139.0.0" });
tree = render(storeState);
const line = resultLine(tree);
assert.ok(line, "the probed version renders on its own line");
assert.equal(line.props.role, "status", "the line announces itself as live status");
assert.equal(line.props.children[0], "versionLabel", "the label is localizable");
assert.equal(
	line.props.children[1].props.children,
	"Google Chrome 139.0.0",
	"the line carries the version the run read"
);
// A failure keeps the dot as its single surface, and the host clears the
// version on a failed run — so the line never outlives the answer it quotes.
Object.assign(storeState, {
	chromeVersion: "",
	lastError: "Chrome executable not found: /usr/bin/google-chrome",
	chromeMissing: true
});
tree = render(storeState);
assert.equal(resultLine(tree), undefined, "a failed run leaves no version line");
assert.equal(dotState(findDot(tree)), "error", "the failure surfaces through the header dot");
Object.assign(storeState, { lastError: "", chromeMissing: false });

// ── "Reduce log output" toggle ────────────────────────────────────────────
// The Switch primitive is checked exactly when the host resolves "log"
// (explicit stderrMode "log", or "" + rowStderr "log"); a click flips it.
const findToggle = (t) => walk(t).find((n) => n.type === "Switch");
// rowStderr "log" fallback → checked.
Object.assign(storeState, { stderrMode: "", rowStderr: "log" });
tree = render(storeState);
let toggle = findToggle(tree);
assert.ok(toggle, "reduce-log-output Switch rendered once expanded");
assert.equal(toggle.props.checked, true, "checked when the resolved mode is log");
assert.equal(toggle.props.disabled, false, "enabled while writable");
const reduceTitle = walk(tree).find(
	(n) => n.type === "span" && n.props?.className === CLS("toggleLabel") && n.props.title === "reduceTitle"
);
assert.ok(reduceTitle, "the toggle is wrapped in the element carrying the tooltip");
assert.equal(toggle.props.label, "reduceLabel", "the Switch names itself through `label`");
const reduceFieldTitle = walk(tree).find(
	(n) => n.type === "span" && n.props?.className === CLS("fieldTitle") && n.props.children === "reduceLabel"
);
assert.ok(reduceFieldTitle, "the switch block carries its title in the field row");
// Explicit console mode → unchecked.
Object.assign(storeState, { stderrMode: "console" });
tree = render(storeState);
assert.equal(findToggle(tree).props.checked, false, "unchecked when the resolved mode is console");
// Empty + rowStderr console → unchecked.
Object.assign(storeState, { stderrMode: "", rowStderr: "console" });
tree = render(storeState);
assert.equal(findToggle(tree).props.checked, false, "rowStderr console falls through to unchecked");
// Flipping persists the opposite mode: console rowStderr → click → "log".
writes.length = 0;
findToggle(tree).props.onChange();
assert.ok(writes.some(([f, v]) => f === "stderrMode" && v === "log"), "toggling off (console) persists log mode");
// log rowStderr → click → console.
Object.assign(storeState, { stderrMode: "", rowStderr: "log" });
tree = render(storeState);
writes.length = 0;
findToggle(tree).props.onChange();
assert.ok(writes.some(([f, v]) => f === "stderrMode" && v === "console"), "toggling off (log) persists console mode");
// Read-only: the toggle is present but disabled.
Object.assign(storeState, { stderrMode: "", rowStderr: "log", writable: false });
tree = render(storeState);
assert.equal(findToggle(tree).props.disabled, true, "toggle disabled while read-only");

// ── read-only deployment: no write controls; rows inert ───────────────────
Object.assign(storeState, { extraFlags: ["--no-usage-statistics", "--no-performance-crux"], writable: false });
tree = render(storeState);
const roNodes = walk(tree);
assert.equal(roNodes.find(isNode("textarea")), undefined, "no free-form editor while read-only");
assert.equal(
	roNodes.find((n) => n.type === "button" && n.props?.children === "flagsRestore").props.disabled,
	true,
	"the restore-defaults control is present but inert while read-only"
);
assert.equal(
	roNodes.find((n) => n.type === "button" && n.props?.children === "flagsWsl").props.disabled,
	true,
	"the recommended-flags control is present but inert while read-only"
);
const roFlagFields = flagFields(tree);
assert.equal(roFlagFields.length, 2, "the flags list still reads while read-only");
assert.equal(roFlagFields.every((node) => node.props.disabled), true, "no flag can be edited while read-only");
assert.equal(flagTrashes(tree).every((node) => node.props.disabled), true, "a saved flag cannot be deleted while read-only");
assert.equal(roNodes.find(isLabel("addFlag")).props.disabled, true, "no new flags while read-only");
assert.equal(rowInputs(tree).every((node) => node.props.disabled), true, "row fields are inert while read-only");
assert.equal(findTrash(tree).props.disabled, true, "a row cannot be deleted while read-only");
assert.equal(walk(tree).find(isLabel("addExecutable")).props.disabled, true, "no new rows while read-only");
assert.equal(walk(tree).find(isLabel("fetchExecutables")).props.disabled, true, "no search while read-only");
assert.equal(findPill(tree).props.disabled, true, "the pill is inert while read-only");
Object.assign(storeState, { writable: true });

// ── error dot (chrome-executable/connection error reporting) ───────────────
// The red header dot — with the full error message as its title — is the
// single error surface: no body paragraph, no header badge.
Object.assign(storeState, { lastError: "Chrome executable not found at /nope/chrome" });
tree = render(storeState);
const errHeader = walk(tree).find(isNode("button", CLS("header")));
let dot = findDot(tree);
assert.ok(dot, "status dot rendered while lastError is present");
assert.equal(dotState(dot), "error");
assert.equal(dot.props.role, "img");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "Chrome executable not found at /nope/chrome", "dot title carries the message");
const errorLine = walk(tree).find(isNode("p", CLS("error")));
assert.ok(errorLine, "the captured error also reads as a body paragraph (the reference card's shape)");
assert.equal(errorLine.props.role, "status", "the line announces itself as live status");
assert.equal(errorLine.props.children, "Chrome executable not found at /nope/chrome", "the line carries the message");
assert.equal(walk(tree).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith(CLS("badge"))), undefined, "no header badge");
// Title stays fixed (reference pattern): error only on the dot tooltip.
let nameSpan = walk(tree).find(isNode("span", CLS("name")));
assert.ok(nameSpan, "name span still rendered with error");
assert.equal(nameSpan.props.children, "title", "title stays unchanged regardless of error");
assert.equal(nameSpan.props.title, undefined, "name span has no tooltip");
// aria-label stays fixed ("collapse" depends on open state, not error)
assert.ok(errHeader.props["aria-label"] === "expand: title" || errHeader.props["aria-label"] === "collapse: title", "aria-label unchanged by error");
Object.assign(storeState, { lastError: "" });
tree = render(storeState);
assert.equal(findDot(tree), undefined, "dot hidden again when healthy");
// Title remains stable across renders
header = walk(tree).find(isNode("button", CLS("header")));
assert.equal(walk(tree).find(isNode("span", CLS("name"))).props.children, "title", "title stable when healthy");

// ── known "executable missing" error: same single dot surface ─────────────
// chromeMissing (host-served) carries no dedicated UI: the known not-found
// state is reported exactly like any other error — the red dot with the full
// "Chrome executable not found…" message as its title. The flag also keeps the
// dot alive on its own (a bridge update clears the captured message, not the
// flag), with the tooltip falling back to the short label.
const findBadge = (t) =>
	walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith(CLS("badge")));
Object.assign(storeState, { chromeMissing: true, lastError: "Chrome executable not found: /usr/bin/google-chrome" });
tree = render(storeState);
assert.equal(findBadge(tree), undefined, "missing-executable known error renders no header badge");
let missingDot = findDot(tree);
assert.ok(missingDot, "missing error renders the header error dot");
assert.equal(missingDot.props.role, "img", "dot is an img-role element");
assert.equal(missingDot.props.title, "Chrome executable not found: /usr/bin/google-chrome", "dot title carries the full known-error message");
const knownLine = walk(tree).find(isNode("p", CLS("error")));
assert.ok(knownLine, "the captured known error reads as a body paragraph too");
assert.equal(knownLine.props.children, "Chrome executable not found: /usr/bin/google-chrome", "the line carries the known-error message");
Object.assign(storeState, { chromeMissing: false, lastError: "" });
tree = render(storeState);
assert.equal(findDot(tree), undefined, "no dot while healthy");
Object.assign(storeState, { chromeMissing: true, lastError: "" });
tree = render(storeState);
const missingOnlyDot = findDot(tree);
assert.ok(missingOnlyDot, "chromeMissing alone keeps the error dot visible");
assert.equal(missingOnlyDot.props.title, "chromeMissing", "tooltip falls back to the not-found label without a captured message");
assert.equal(findBadge(tree), undefined, "still no badge — the dot remains the only surface");
Object.assign(storeState, { chromeMissing: false });
tree = render(storeState);
assert.equal(findDot(tree), undefined, "healthy again once the known flag clears");

// ── the staged form: nothing applies until Apply; the footer carries it ─────
// The form writes nothing as it is edited: every editable field stages until an
// Apply lands it, and the footer marks the pending state. The footer's Discard
// drops the whole draft (reverting every staged value) and then closes the body.
Object.assign(storeState, { writable: true, dirty: false, saving: false, failed: false });
writes.length = 0;
tree = render(storeState);
let footer = walk(tree).find(isNode("div", CLS("footer")));
assert.ok(footer, "the staged form's footer renders inside the body");
const findApply = (t) =>
	walk(t).find((n) => n.type === "button" && String(n.props?.className ?? "").includes(CLS("footerButtonPrimary")));
const findDiscard = (t) =>
	walk(t).find((n) =>
		n.type === "button" &&
		String(n.props?.className ?? "").includes(CLS("footerButton")) &&
		!String(n.props?.className ?? "").includes(CLS("footerButtonPrimary")));
assert.equal(findBadge(tree), undefined, "no unsaved badge while nothing is staged");
let applyBtn = findApply(tree);
assert.ok(applyBtn, "the footer carries an Apply button");
assert.equal(applyBtn.props.disabled, true, "Apply is inert while nothing is staged");
let discardBtn = findDiscard(tree);
assert.ok(discardBtn, "the footer carries a Discard button");
assert.equal(discardBtn.props.children, "discard", "the secondary action is the localisation of Discard");
assert.equal(applyBtn.props.children, "apply", "the primary action is the localisation of Apply");

// A staged edit marks the card: the unsaved badge shows beside the title and
// Apply becomes live.
Object.assign(storeState, { dirty: true });
tree = render(storeState);
assert.ok(findBadge(tree), "the unsaved badge appears beside the title while an edit is staged");
assert.equal(findBadge(tree).props.children, "unsaved", "the badge copy reads unsaved");
assert.equal(findApply(tree).props.disabled, false, "Apply goes live with a staged edit");
// Saving: the primary reads the busy label while a save is in flight.
Object.assign(storeState, { saving: true });
tree = render(storeState);
assert.equal(findApply(tree).props.disabled, true, "Apply stays inert while a save is in flight");
assert.equal(findApply(tree).props.children, "saving", "the primary reads the saving copy mid-save");
// A rejected save adds the footer's own failure line.
Object.assign(storeState, { saving: false, failed: true });
tree = render(storeState);
const footerError = walk(tree).find(isNode("p", CLS("footerError")));
assert.ok(footerError, "a rejected save reads as the footer's own failure line");
assert.equal(footerError.props.children, "saveFailed", "the failure line copy is localizable");
Object.assign(storeState, { failed: false });

// Discard drops the staged draft and collapses the body — it persists nothing,
// so nothing on the wire changed; the controller-level test below proves the
// draft is reverted.
Object.assign(storeState, { dirty: true });
tree = render(storeState);
findDiscard(tree).props.onClick();
tree = render(storeState);
assert.equal(walk(tree).find(isNode("div", CLS("body"))), undefined, "Discard hides the body (collapse)");
assert.equal(
	walk(tree).find(isNode("button", CLS("header"))).props["aria-expanded"],
	false,
	"Discard leaves the card collapsed"
);
assert.equal(writes.length, 0, "Discard persisted nothing");
// Re-open so the rest of the suite renders the body again.
walk(render(storeState)).find(isNode("button", CLS("header"))).props.onClick();
tree = render(storeState);
Object.assign(storeState, { dirty: false });

// ── controller staging: nothing persists until apply; a save lands every draft
// ───────────────────────────────────────────────────────────────────────────
const face = options.inject();
assert.equal(JSON.stringify(face.hooks.chromeMcpCard.getSnapshot()), JSON.stringify(storeState),
	"controller inject returns same snapshot store");

// A staged edit writes nothing: it only marks the card dirty and reads as the
// draft (the flag rows on screen show it) — the persisted list is untouched.
const servedFlags = scopeSnapshot.value.extraFlags;
writes.length = 0;
await face.saveFlags(["--headless"]);
tree = render(storeState);
assert.equal(findDot(tree), undefined, "staging a flags edit raises no error surface");
assert.equal(writes.length, 0, "a staged flags edit persists nothing");
assert.equal(storeState.dirty, true, "a staged flags edit marks the card dirty");
assert.equal(storeState.failed, false, "nothing has failed yet");
assert.equal(storeState.saving, false, "no save in flight while only staged");

// Applying lands it; a rejection surfaces on the same surface a live write had.
rejectNextFlagsWrite = true;
await face.apply();
tree = render(storeState);
dot = findDot(tree);
assert.ok(dot, "a rejected save raises the status dot");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "write rejected by host", "dot title carries the rejection message");
const actionLine = walk(tree).find(isNode("p", CLS("error")));
assert.ok(actionLine, "a rejected save also reads as a body paragraph");
assert.equal(actionLine.props.children, "write rejected by host", "the paragraph carries the rejection message");
assert.equal(storeState.dirty, true, "the failed draft survives a rejected save for correction");
assert.equal(storeState.failed, true, "the card reports the save was not accepted");
// The rejected field is never written.
assert.equal(writes.length, 0, "a rejected write persists nothing");
// Restore: retrying the apply lands the same draft → healthy → dot hidden, no
// longer dirty, the flag rows read what the wire now carries.
await face.apply();
tree = render(storeState);
assert.equal(findDot(tree), undefined, "dot hidden again after a successful save");
assert.equal(storeState.dirty, false, "a landed draft is no longer dirty");
assert.equal(storeState.failed, false, "the rejection clears once the save lands");
assert.ok(writes.some(([f, v]) => f === "extraFlags" && JSON.stringify(v) === JSON.stringify(["--headless"])),
	"apply wrote the staged flags list");
Object.assign(storeState, { extraFlags: servedFlags });

// ── discarding a staged edit reverts it; nothing was ever written ──────────
// The card's Discard drops the draft; the served field reappears untouched and
// the dirty mark clears. No field reaches the wire, because only `apply` writes.
scopeSnapshot.value = { ...scopeSnapshot.value, extraFlags: ["--served-flag"] };
scopeSnapshot.base = { ...scopeSnapshot.value };
listeners.forEach((fn) => fn());
writes.length = 0;
await face.saveFlags(["--staged-only"]);
tree = render(storeState);
assert.equal(storeState.dirty, true, "a staged flags edit is dirty before it is discarded");
assert.equal(storeState.failed, false, "nothing failed while the edit was only staged");
assert.equal(
	JSON.stringify(storeState.extraFlags) === JSON.stringify(["--staged-only"]),
	true,
	"the flag rows read the staged value while it is staged"
);
face.discard();
tree = render(storeState);
assert.equal(storeState.dirty, false, "discarding the draft clears the dirty state");
assert.equal(
	JSON.stringify(storeState.extraFlags) === JSON.stringify(["--served-flag"]),
	true,
	"discarding reverts the flag rows to what the host already serves"
);
assert.equal(writes.length, 0, "discarding writes nothing — only apply persists");

// ── the Restore-defaults control: append what is missing, keep everything ──
// The card keeps the whole current list (a line the user typed, or any saved
// flag) and appends only the defaults it does not already carry — it is a
// recovery action, never a reset.
Object.assign(storeState, {
	extraFlags: ["--keep-me", "--no-usage-statistics"],
	defaultExtraFlags: ["--no-usage-statistics", "--no-performance-crux"]
});
tree = render(storeState);
const restoreClick = walk(tree).find(isLabel("flagsRestore"));
assert.ok(restoreClick, "restore control rendered with the current snapshot");
assert.equal(restoreClick.props.disabled, false, "enabled while missing defaults are served");
writes.length = 0;
restoreClick.props.onClick();
assert.ok(
	writes.some(
		([field, value]) =>
			field === "extraFlags" &&
			JSON.stringify(value) ===
			JSON.stringify(["--keep-me", "--no-usage-statistics", "--no-performance-crux"])
	),
	"restore writes the current list plus the missing defaults, losing nothing"
);
// Nothing missing: the merged list is the current one — the write keeps every
// current line.
writes.length = 0;
Object.assign(storeState, {
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	defaultExtraFlags: ["--no-usage-statistics", "--no-performance-crux"]
});
tree = render(storeState);
walk(tree).find(isLabel("flagsRestore")).props.onClick();
assert.ok(
	writes.some(
		([field, value]) =>
			field === "extraFlags" &&
			JSON.stringify(value) === JSON.stringify(["--no-usage-statistics", "--no-performance-crux"])
	),
	"nothing missing writes exactly what is already there"
);
Object.assign(storeState, { extraFlags: ["--no-usage-statistics", "--no-performance-crux"], defaultExtraFlags: [] });

// ── the Flags WSL control: the same merge rule, the recommended list ────────
// Everything the rows already carry keeps its place (nothing is dropped,
// nothing is modified); only the recommended WSL ↔ Windows flags the host
// still misses append — the very same job the restore control does for the
// defaults list, against the other host-served list.
Object.assign(storeState, {
	extraFlags: ["--keep-me"],
	wslExtraFlags: ["--chromeArg=--remote-debugging-port=9222"]
});
tree = render(storeState);
const wslClick = walk(tree).find(isLabel("flagsWsl"));
assert.ok(wslClick, "WSL control rendered with the current snapshot");
assert.equal(wslClick.props.disabled, false, "enabled while missing recommended flags are served");
writes.length = 0;
wslClick.props.onClick();
assert.ok(
	writes.some(
		([field, value]) =>
			field === "extraFlags" &&
			JSON.stringify(value) ===
			JSON.stringify(["--keep-me", "--chromeArg=--remote-debugging-port=9222"])
	),
	"the control writes the current list plus the missing recommended flags, losing nothing"
);
// Nothing missing: no duplicates are appended — the write is exactly what is
// already there.
writes.length = 0;
Object.assign(storeState, {
	extraFlags: ["--chromeArg=--remote-debugging-port=9222"],
	wslExtraFlags: ["--chromeArg=--remote-debugging-port=9222"]
});
tree = render(storeState);
walk(tree).find(isLabel("flagsWsl")).props.onClick();
assert.ok(
	writes.some(
		([field, value]) =>
			field === "extraFlags" &&
			JSON.stringify(value) === JSON.stringify(["--chromeArg=--remote-debugging-port=9222"])
	),
	"nothing missing writes exactly what is already there"
);
Object.assign(storeState, { extraFlags: ["--no-usage-statistics", "--no-performance-crux"], wslExtraFlags: [] });

// ── the extra-flags rows behave exactly like the saved executable rows ─────
// One row per flag, one field per row: typing is local until it settles (a blur
// or Enter commits the whole list), a delete is structural and persists on the
// spot, and an added row is local until it carries text — nothing about the
// widget differs for the list having a single field instead of two.
Object.assign(storeState, {
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	defaultExtraFlags: []
});
writes.length = 0;
flagFields(render(storeState))[0].props.onChange({ target: { value: "  --headless  " } });
flagFields(render(storeState))[0].props.onBlur();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(writes.length, 1, "a settled flags edit writes once");
assert.equal(writes[0][0], "extraFlags", "a flag edit writes the flags list");
assert.equal(
	JSON.stringify(writes[0][1]),
	JSON.stringify(["--headless", "--no-performance-crux"]),
	"the row's text is trimmed in place, keeping the list's order"
);
// A delete is structural: it persists immediately, and it deletes the row its
// control sits on.
writes.length = 0;
flagTrashes(render(storeState))[1].props.onClick();
assert.equal(writes.length, 1, "deleting a flag persists on the spot");
assert.equal(
	JSON.stringify(writes.map(([f]) => f)),
	JSON.stringify(["extraFlags"]),
	"and it writes exactly one field"
);
assert.equal(JSON.stringify(writes[0][1]), JSON.stringify(["--headless"]), "the deleted flag is gone from what is saved");
// What was committed comes back as the served list: the draft gives way to it,
// so re-committing the same rows writes nothing.
Object.assign(storeState, { extraFlags: ["--headless"] });
writes.length = 0;
render(storeState);
flagFields(render(storeState))[0].props.onBlur();
assert.equal(writes.length, 0, "re-committing what is already saved writes nothing");
// "Add flag" is local until the row carries a value: the blank row only lands
// once it is typed in.
writes.length = 0;
walk(render(storeState)).find(isLabel("addFlag")).props.onClick();
assert.equal(writes.length, 0, "adding a blank flag row writes nothing yet");
assert.equal(flagFields(render(storeState)).length, 2, "the blank row shows as a second row");
flagFields(render(storeState))[1].props.onChange({ target: { value: "--isolated" } });
flagFields(render(storeState))[1].props.onKeyDown({ key: "Enter" });
assert.ok(
	writes.some(
		([field, value]) => field === "extraFlags" && JSON.stringify(value) === JSON.stringify(["--headless", "--isolated"])
	),
	"Enter commits the whole flags list"
);
// An entry that is only whitespace is dropped instead of persisted (the write
// side rejects an empty flag), and a repeated one folds to its first row — the
// same normalization the saved executable rows apply to a repeated id.
Object.assign(storeState, { extraFlags: ["--headless", "--isolated"] });
writes.length = 0;
render(storeState);
flagFields(render(storeState))[1].props.onChange({ target: { value: "   " } });
flagFields(render(storeState))[1].props.onBlur();
assert.ok(
	writes.some(([field, value]) => field === "extraFlags" && JSON.stringify(value) === JSON.stringify(["--headless"])),
	"a row left blank is dropped on the way out"
);
Object.assign(storeState, { extraFlags: ["--headless", "--isolated"] });
writes.length = 0;
render(storeState);
flagFields(render(storeState))[1].props.onChange({ target: { value: "--headless" } });
flagFields(render(storeState))[1].props.onBlur();
assert.ok(
	writes.some(([field, value]) => field === "extraFlags" && JSON.stringify(value) === JSON.stringify(["--headless"])),
	"a repeated flag folds to its first row"
);
// Nothing saved: the list says what to do, the same empty line the executable
// rows carry.
Object.assign(storeState, { extraFlags: [] });
render(storeState); // the served change lands: the draft gives way to it
tree = render(storeState);
assert.equal(flagFields(tree).length, 0, "no flag rows while nothing is saved");
assert.ok(
	walk(tree).some((n) => n.type === "p" && n.props?.className === CLS("empty") && n.props.children === "flagsEmpty"),
	"the flags list's own empty line says what to do"
);
Object.assign(storeState, { extraFlags: ["--no-usage-statistics", "--no-performance-crux"] });

// ── controller executable actions ─────────────────────────────────────────
// Every executable action writes its field and then polls the shared describe
// mirror until the host advances the served run revision (the host keeps the
// executable state in its in-memory base layer and has no push channel).
const loadsBefore = mirror.loadCalls;
const searchPromise = face.refreshExecutables();
assert.ok(
	writes.some(([f, v]) => f === "refreshExecutablesNonce" && typeof v === "number"),
	"searching writes a numeric refreshExecutablesNonce"
);
assert.equal(mirror.loadCalls, loadsBefore, "no mirror re-read before the first poll tick");
await new Promise((resolve) => setTimeout(resolve, 900));
assert.ok(mirror.loadCalls >= loadsBefore + 1, "the wait re-reads the settings mirror while the run is en route");
scopeSnapshot.value = { ...scopeSnapshot.value, executableDiscoveryRevision: 1 };
scopeSnapshot.base = { ...scopeSnapshot.value, executableDiscoveryRevision: 1 };
listeners.forEach((fn) => fn());
await searchPromise;
assert.equal(storeState.executableDiscoveryRevision, 1, "the card store picked up the advanced run revision");

// Staging saved rows normalizes them (trimmed, deduped, capped) into the draft,
// but writes nothing until applied; only `apply` lands the list on the wire.
scopeSnapshot.value = { ...scopeSnapshot.value, executables: [] };
listeners.forEach((fn) => fn());
writes.length = 0;
await face.saveExecutables([
	{ id: "  /opt/chrome  ", name: "  local  " },
	{ id: "/opt/chrome", name: "a duplicate id drops" },
	{ id: "", name: "no path drops" },
	null
]);
assert.equal(writes.length, 0, "staging rows writes nothing yet");
assert.equal(storeState.dirty, true, "a staged rows edit marks the card dirty");
assert.equal(
	JSON.stringify(storeState.executables) === JSON.stringify([{ id: "/opt/chrome", name: "local" }]),
	true,
	"the draft reads normalized on screen"
);
// Applying persists the normalized list and waits on the run revision it bumps.
const rowsPromise = face.apply();
assert.ok(
	writes.some(([f, v]) => f === "executables" && JSON.stringify(v) === JSON.stringify([{ id: "/opt/chrome", name: "local" }])),
	"apply writes the normalized rows list"
);
scopeSnapshot.value = { ...scopeSnapshot.value, executables: [{ id: "/opt/chrome", name: "local" }], executableDiscoveryRevision: 2 };
scopeSnapshot.base = { ...scopeSnapshot.value, executableDiscoveryRevision: 2 };
listeners.forEach((fn) => fn());
await rowsPromise;
assert.equal(storeState.executableDiscoveryRevision, 2, "a rows save settles on the run revision");
assert.equal(storeState.dirty, false, "a landed rows draft is no longer dirty");

// Staging a selection is the same shape: the pill shows the staged path without
// touching the wire; applying writes chromePath and waits the run revision.
scopeSnapshot.value = { ...scopeSnapshot.value, chromePath: "", effectiveChromePath: "", effectiveSource: "" };
scopeSnapshot.base = { ...scopeSnapshot.value, effectiveChromePath: "", effectiveSource: "" };
listeners.forEach((fn) => fn());
writes.length = 0;
await face.selectExecutable("/usr/bin/google-chrome");
assert.equal(writes.length, 0, "staging a selection writes nothing yet");
assert.equal(storeState.effectiveChromePath, "/usr/bin/google-chrome", "the pill shows the staged selection");
assert.equal(storeState.dirty, true, "a staged selection marks the card dirty");
const selectPromise = face.apply();
assert.ok(writes.some(([f, v]) => f === "chromePath" && v === "/usr/bin/google-chrome"), "apply writes chromePath");
scopeSnapshot.value = { ...scopeSnapshot.value, chromePath: "/usr/bin/google-chrome", executableDiscoveryRevision: 3 };
scopeSnapshot.base = {
	...scopeSnapshot.value,
	executableDiscoveryRevision: 3,
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected"
};
listeners.forEach((fn) => fn());
await selectPromise;
assert.equal(storeState.executableDiscoveryRevision, 3, "the selection change settled on the run revision");
assert.equal(storeState.effectiveChromePath, "/usr/bin/google-chrome", "the pill follows what the host resolved");
assert.equal(storeState.dirty, false, "a landed selection draft is no longer dirty");
// Selecting nothing is not an action.
writes.length = 0;
await face.selectExecutable("   ");
assert.equal(writes.length, 0, "an empty selection is a no-op");
// Re-saving what is already there stages nothing — it is not dirty.
writes.length = 0;
await face.saveExecutables(storeState.executables);
assert.equal(writes.length, 0, "re-saving identical rows stages nothing");
assert.equal(storeState.dirty, false, "identical rows leave the card clean");

// ── adding a discovered executable stages into the dropdown ───────────────
// Picking candidates in the fetch dialog merges them into the saved rows as a
// staged write: the new executable shows up in the dropdown's option list right
// away, but the persisted rows are untouched until the edit is applied.
scopeSnapshot.value = { ...scopeSnapshot.value, executables: [{ id: "/usr/bin/google-chrome", name: "system" }] };
scopeSnapshot.base = { ...scopeSnapshot.value };
listeners.forEach((fn) => fn());
writes.length = 0;
await face.addExecutables(["/opt/firefox", "/nonexistent-dir/edge"]);
assert.equal(writes.length, 0, "adding executables stages the merge without applying");
assert.equal(storeState.dirty, true, "a merged-in executable marks the card dirty");
{
	const ids = storeState.executables.map((entry) => entry.id);
	assert.equal(ids.includes("/opt/firefox"), true, "the merged id reads in the rows list");
	assert.equal(ids.includes("/nonexistent-dir/edge"), true, "every merged id reads in the rows list");
	render(storeState);
	const addMenu = menuProps.at(-1);
	assert.ok(addMenu, "the dropdown primitive received its list");
	const optionIds = addMenu.items.map((item) => item.id);
	assert.equal(
		optionIds.includes("/opt/firefox"),
		true,
		"a staged executable is already offered in the dropdown's options"
	);
}
// Apply lands the merged rows and rides the executable run's revision.
const addPromise = face.apply();
assert.ok(
	writes.some(([f, v]) => f === "executables" && v.some((entry) => entry.id === "/opt/firefox")),
	"apply persists the merged rows"
);
const addLanded = storeState.executables.some((entry) => entry.id === "/opt/firefox");
scopeSnapshot.value = { ...scopeSnapshot.value, executables: storeState.executables, executableDiscoveryRevision: 5 };
scopeSnapshot.base = { ...scopeSnapshot.value, executableDiscoveryRevision: 5 };
listeners.forEach((fn) => fn());
await addPromise;
assert.equal(storeState.dirty, false, "a landed executable merge is no longer dirty");

// ── describe base layer: where the status rides ───────────────────────────
// The host holds check/connection status in the composition base layer, which
// describe() clones fresh on every read; the frozen resolved value folds the
// base in only at commits. Status must therefore be served from the base
// clone — base-only changes (the registration-time run, bridge/tool captures)
// never reach the resolved value. The **rows** keep reading the resolved value:
// they are user-authored, not host state.
scopeSnapshot.base = {
	extraFlags: ["--host-seeded"],
	lastError: "Protocol error (Target.setDiscoverTargets): Target closed",
	chromeMissing: false,
	executableDiscoveryRevision: 9,
	chromeVersion: "Google Chrome 139.0.0",
	executableStatus: [{ path: "/opt/chrome", version: "Google Chrome 139.0.0", error: "" }],
	effectiveChromePath: "/opt/chrome",
	effectiveSource: "selected",
	defaultExtraFlags: ["--from-host-default"]
};
scopeSnapshot.value = {
	...scopeSnapshot.value,
	lastError: "stale resolved value",
	executableDiscoveryRevision: 4,
	chromeVersion: "",
	executables: [{ id: "/opt/chrome", name: "saved by hand" }]
};
listeners.forEach((fn) => fn());
assert.equal(storeState.lastError, "Protocol error (Target.setDiscoverTargets): Target closed", "lastError is served from the fresh base clone, not the stale resolved value");
assert.equal(storeState.executableDiscoveryRevision, 9, "the run revision is served from the base clone");
assert.equal(storeState.chromeVersion, "Google Chrome 139.0.0", "chromeVersion is served from the base clone");
assert.equal(storeState.effectiveChromePath, "/opt/chrome", "the effective executable comes from the base clone");
assert.equal(storeState.effectiveSource, "selected", "and so does where it came from");
assert.equal(storeState.executableStatus.length, 1, "the per-row answers are served from the base clone");
assert.equal(
	JSON.stringify(storeState.defaultExtraFlags) === JSON.stringify(["--from-host-default"]),
	true,
	"the default-flags list is served from the base clone (a host static, like rowStderr)"
);
assert.equal(
	JSON.stringify(storeState.executables) === JSON.stringify([{ id: "/opt/chrome", name: "saved by hand" }]),
	true,
	"the rows keep reading the resolved value (the user layer wins)"
);
assert.equal(JSON.stringify(storeState.extraFlags) === JSON.stringify(scopeSnapshot.value.extraFlags), true, "extraFlags keeps reading the resolved value (the user layer wins over the host-seeded base field)");
const baseTree = render(storeState);
const baseDot = findDot(baseTree);
assert.ok(baseDot, "base-served error lights the header dot");
assert.equal(baseDot.props.title, "Protocol error (Target.setDiscoverTargets): Target closed", "the dot tooltip comes from the base clone");
// Restore a healthy mirror state for the sections that follow.
scopeSnapshot.base = void 0;
scopeSnapshot.value = { ...scopeSnapshot.value, lastError: "", executableDiscoveryRevision: 1, chromeVersion: "" };
listeners.forEach((fn) => fn());

// ── startup catch-up poll ─────────────────────────────────────────────────
// The host runs its first executable run at registration time — *after* the
// card's first describe read — and a module plugin has no push channel. So a
// controller whose first served revision is 0 re-reads the describe mirror
// until the run lands: this is how a Chrome-less host lights the error dot
// right after dsh starts, without any user action. A second apply mounts a
// second, clean controller against a fresh scope/mirror stub.
const scopeSnapshot2 = {
	status: "ready",
	value: { extraFlags: ["--no-usage-statistics", "--no-performance-crux"], refreshExecutablesNonce: 0, chromePath: "", executables: [], stderrMode: "", lastError: "", executableDiscoveryRevision: 0, chromeVersion: "" },
	base: { extraFlags: [], refreshExecutablesNonce: 0, lastError: "", chromeMissing: false, executableDiscoveryRevision: 0, chromeVersion: "" },
	writable: true,
	revision: 1
};
const listeners2 = new Set();
const writes2 = [];
const scope2 = {
	getSnapshot: () => scopeSnapshot2,
	subscribe: (fn) => (listeners2.add(fn), () => listeners2.delete(fn)),
	set: (field, value) => {
		writes2.push([field, value]);
		scopeSnapshot2.value = { ...scopeSnapshot2.value, [field]: value };
		listeners2.forEach((fn) => fn());
		return Promise.resolve();
	}
};
const mirror2 = {
	loadCalls: 0,
	load: () => {
		mirror2.loadCalls += 1;
		return Promise.resolve();
	}
};
factoryResult.apply({
	effect: (fn) => {
		const disposer = fn();
		return { dispose: () => (disposer?.dispose?.() ?? disposer?.()) };
	},
	locale: { register: () => {}, bind: () => (key) => key },
	settingsScope: { bind: () => scope2, describe: () => mirror2 },
	slots: { inject: (slot, registerFn) => registerFn(), register: () => () => {} }
});
assert.equal(writes2.length, 0, "the catch-up poll performs no settings writes");
const catchupLoadsBefore = mirror2.loadCalls;
await new Promise((resolve) => setTimeout(resolve, 900));
assert.ok(mirror2.loadCalls >= catchupLoadsBefore + 1, "the catch-up poll re-reads the mirror while the first run revision is still 0");
// The registration-time run fails in the base layer only (no commit) — the
// fresh clone wins over the stale resolved value, and the wait settles.
scopeSnapshot2.base = {
	...scopeSnapshot2.base,
	lastError: "Chrome executable not found: no executable detected (checked: /usr/bin/google-chrome)",
	chromeMissing: true,
	executableDiscoveryRevision: 1
};
const catchupLoadsAfterAdvance = mirror2.loadCalls;
listeners2.forEach((fn) => fn());
assert.equal(storeState.lastError, "Chrome executable not found: no executable detected (checked: /usr/bin/google-chrome)", "the startup failure is served through the base clone");
assert.equal(storeState.chromeMissing, true, "the known flag arrives with the startup failure");
assert.equal(storeState.executableDiscoveryRevision, 1, "the catch-up poll picked the advanced revision up");
const catchupTree = render(storeState);
const catchupDot = findDot(catchupTree);
assert.ok(catchupDot, "the startup failure lights the header dot without any user action");
assert.equal(catchupDot.props.title, "Chrome executable not found: no executable detected (checked: /usr/bin/google-chrome)", "the startup failure message rides the dot tooltip");
await new Promise((resolve) => setTimeout(resolve, 1600));
assert.ok(mirror2.loadCalls <= catchupLoadsAfterAdvance + 1, "the catch-up poll settles once the revision advanced");
// The startup failure clears like any other: a probed success lands in the
// base clone and the next read reports health.
scopeSnapshot2.base = { ...scopeSnapshot2.base, lastError: "", chromeMissing: false, chromeVersion: "Google Chrome 139.0.0" };
listeners2.forEach((fn) => fn());
assert.equal(storeState.lastError, "", "a probed success clears the startup failure");
assert.equal(storeState.chromeMissing, false, "and the known flag with it");
const clearedTree = render(storeState);
assert.equal(findDot(clearedTree), undefined, "healthy again: no dot");

// ── the Windows-executable-under-WSL notice ────────────────────────────────
// Only the host half knows where it is running, so the state rides the base
// clone like every other status field, and the card renders its static notice
// on that alone: nothing has failed (a Windows binary answers --version across
// the interop boundary), the configuration it needs is simply different.
scopeSnapshot2.base = { ...scopeSnapshot2.base, wslWindowsExecutable: true };
listeners2.forEach((fn) => fn());
assert.equal(storeState.wslWindowsExecutable, true, "the interop mirror arrives through the base clone");
const wslTree = render(storeState);
const notice = walk(wslTree).find(isNode("div", CLS("notice")));
assert.ok(notice, "the notice renders while the host reports the state");
assert.equal(notice.props.role, "note", "it reads as a note, not as the error dot or a live region");
assert.equal(notice.props.children[0].props.children, "wslWindowsTitle", "its heading is its own key");
assert.equal(notice.props.children[1].props.children, "wslWindowsNote", "the body is the static configuration copy");
scopeSnapshot2.base = { ...scopeSnapshot2.base, wslWindowsExecutable: false };
listeners2.forEach((fn) => fn());
assert.equal(storeState.wslWindowsExecutable, false, "the mirror clears with the state");
assert.equal(walk(render(storeState)).find(isNode("div", CLS("notice"))), undefined, "no notice while the state is off");

// ── the search action's busy state ────────────────────────────────────────
const findLabeled = (t, labels) =>
	walk(t).find((n) => n.type === "button" && typeof n.props?.children === "string" && labels.includes(n.props.children));
Object.assign(storeState, { writable: true, effectiveChromePath: "/usr/bin/google-chrome", effectiveSource: "selected" });
// The busy-state click below writes through the scope, which republishes the
// store: keep the resolved effective path and the served version in the scope
// value so the republish does not blank them out again.
scopeSnapshot.value = {
	...scopeSnapshot.value,
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected",
	chromeVersion: "Google Chrome 139.0.0"
};
tree = render(storeState);
let searchBtn = findLabeled(tree, ["fetchExecutables", "fetching"]);
searchBtn.props.onClick();
tree = render(storeState);
searchBtn = findLabeled(tree, ["fetchExecutables", "fetching"]);
assert.equal(searchBtn.props.children, "fetching", "the action reads busy while the run is in flight");
assert.equal(searchBtn.props.disabled, true, "and is disabled while it runs");
// The result line narrates the run itself: the version a healthy host answers
// with is usually what the line already said, so the run is the visible part.
assert.equal(resultLine(tree).props.children, "probing", "the result line says the run is in flight");
await new Promise((resolve) => setTimeout(resolve, 0));
tree = render(storeState);
searchBtn = findLabeled(tree, ["fetchExecutables", "fetching"]);
assert.equal(searchBtn.props.children, "fetchExecutables", "the action returns to idle once it settles");
assert.equal(searchBtn.props.disabled, false, "and re-enables with it");
// Once it settles the line carries the answer and ages it, so a run that
// changes nothing else still visibly moves the line.
const settledLine = resultLine(tree);
assert.equal(
	settledLine.props.children[1].props.children,
	"Google Chrome 139.0.0",
	"the settled line carries the probed version"
);
assert.equal(settledLine.props.children[2].props.children, "probeJustNow", "the run ages the line");

console.log("client.test.mjs: all assertions passed");
