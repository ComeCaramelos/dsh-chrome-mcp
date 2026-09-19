// Materializes lib/client.js in a stubbed browser environment (the same
// window.__ModuleLoader__.load contract the shell's module system uses) and
// exercises the card: registration, snapshot projection, render tree, the
// flags editor write path, and the re-check poll.
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
// Stateful useState: the card keeps `open`/`isChecking` across re-renders, so
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
	checkRevision: 0,
	chromeVersion: "",
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
const requireStub = (spec) => {
	if (spec === "react") return react;
	if (spec === "react/jsx-runtime") return jsxRuntime;
	if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
	throw new Error(`unexpected require: ${spec}`);
};

// ── materialize ──────────────────────────────────────────────────────────
// setTimeout/clearTimeout stand in for the browser globals the recheck poll
// schedules against (the real bundle runs in a page).
vm.runInNewContext(bundle, {
	window,
	document,
	require: undefined,
	console,
	setTimeout,
	clearTimeout
});
assert.ok(registration, "bundle registered with __ModuleLoader__");
assert.equal(registration.id, "@comecaramelos/dsh-chrome-mcp");
const factoryResult = registration.factory(requireStub);
assert.equal(typeof factoryResult.apply, "function", "exports.apply");
assert.equal(JSON.stringify(factoryResult.inject), JSON.stringify(["slots", "locale", "settingsScope"]), "exports.inject");
assert.equal(styles.length, 1, "one style tag injected");
assert.ok(styles[0].dataset.pluginCss === "@comecaramelos/dsh-chrome-mcp/ChromeMcpCard.module.css");

// ── settings scope stub ──────────────────────────────────────────────────
const scopeSnapshot = {
	status: "ready",
	value: {
		extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
		recheckNonce: 0,
		lastError: "",
		checkRevision: 0,
		chromeVersion: ""
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
// Shared describe-mirror stub: the recheck action re-reads it while the
// host's in-memory check state is en route. Bump the served checkRevision to
// let a poll settle.
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
				"title", "description", "flagsTitle", "flagsHint", "flagsPlaceholder", "flagsSave",
				"versionTitle", "check", "checking", "docsMessage", "statusError", "statusOk",
				"chromeMissing", "readOnly", "expand", "collapse"
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
		recheck: () => scope.set("recheckNonce", 123)
	});
	react.useState = _useState;
	react.useEffect = _useEffect;
	react.useId = _useId;
	if (lastHookCount !== null) assert.equal(hookCount, lastHookCount, "hook count stable across renders");
	lastHookCount = hookCount;
	return result;
}
function walk(node, found = []) {
	if (node === null || node === undefined || typeof node !== "object") return found;
	if (Array.isArray(node)) {
		node.forEach((child) => walk(child, found));
		return found;
	}
	if (node.type !== undefined) {
		found.push(node);
		const children = node.children ?? (node.props ? node.props.children : undefined);
		if (children !== undefined) walk(children, found);
	}
	return found;
}
const isNode = (type, className) => (n) => n.type === type && n.props?.className === className;
/** Button identified by its localizable label (both body buttons share CSS.button). */
const isLabel = (label) => (n) => n.type === "button" && n.props?.children === label;
function findDot(t) {
	return walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith("dshcmc_dot "));
}
function dotState(dot) {
	return dot.props.className.includes("dshcmc_dotError") ? "error" : "none";
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
	checkRevision: 0
});
tree = render(storeState);
assert.ok(tree && tree.type === "li", "card root is an li");
assert.equal(tree.props.className, "dshcmc_card", "no cardOpen class while collapsed");
let header = walk(tree).find(isNode("button", "dshcmc_header"));
assert.ok(header, "header disclosure button rendered");
assert.equal(header.props["aria-expanded"], false, "card collapsed by default");
assert.equal(header.props["aria-label"], "expand: title", "header aria-label names the action and card");
assert.ok(header.props["aria-controls"], "header has aria-controls");
assert.equal(walk(tree).find(isNode("div", "dshcmc_body")), undefined, "body div absent while collapsed");
assert.equal(walk(tree).find(isNode("p", "dshcmc_docs")), undefined, "docs message row absent while collapsed");

// ── expand via the header button ──────────────────────────────────────────
header.props.onClick();
tree = render(storeState);
assert.ok(String(tree.props.className).includes("dshcmc_cardOpen"), "cardOpen class while expanded");
assert.equal(
	walk(tree).find(isNode("button", "dshcmc_header")).props["aria-expanded"],
	true,
	"aria-expanded flips open"
);
const nodes = walk(tree);

// configuration-guide message (product spec) with the upstream link
const docs = nodes.find(isNode("p", "dshcmc_docs"));
assert.ok(docs, "docs message paragraph rendered once expanded");
assert.ok(
	docs.props.children.some((c) => typeof c === "string" && c.includes("docsMessage")),
	"docs paragraph carries the localizable message"
);
const link = nodes.find(isNode("a", "dshcmc_link"));
assert.ok(link, "configuration docs link rendered once expanded");
assert.equal(link.props.href, DOCS_URL, "link points at the upstream configuration docs");
assert.equal(link.props.target, "_blank");
assert.equal(link.props.children, DOCS_URL, "link label is the URL itself");

// flags editor (writable mode renders the textarea + save button)
const fieldTitle = nodes.find(isNode("div", "dshcmc_fieldTitle"));
assert.ok(fieldTitle, "flags field title rendered");
assert.equal(fieldTitle.props.children, "flagsTitle");
assert.ok(walk(tree).find(isNode("div", "dshcmc_fieldDesc")), "flags field description rendered");
const editor = nodes.find(isNode("textarea", "dshcmc_text"));
assert.ok(editor, "flags textarea rendered while writable");
assert.equal(editor.props.placeholder, "flagsPlaceholder", "textarea placeholder is localizable");
assert.equal(editor.props.defaultValue, "--no-usage-statistics\n--no-performance-crux", "textarea pre-fills the persisted flags, one per line");
const saveBtn = nodes.find(isLabel("flagsSave"));
assert.ok(saveBtn, "save-flags button rendered");
assert.equal(saveBtn.props.disabled, false, "save enabled while writable");
const check = nodes.find(isLabel("check"));
assert.ok(check, "re-check button rendered");
assert.equal(check.props.disabled, false);

// version row absent until a check discovers one
assert.equal(walk(tree).find(isLabel("versionTitle")), undefined, "version row absent while version unknown");
const versionValue = walk(tree).find(isNode("p", "dshcmc_value"));
assert.equal(versionValue, undefined, "no version paragraph while unknown");

// healthy: no error dot
assert.equal(findDot(tree), undefined, "no status dot while healthy");
assert.equal(walk(tree).find(isNode("p", "dshcmc_error")), undefined, "no error paragraph while healthy");

// ── version line after a successful check ────────────────────────────────
Object.assign(storeState, { chromeVersion: "Google Chrome 139.0.7258.0" });
tree = render(storeState);
const versionNodes = walk(tree);
assert.ok(
	versionNodes.some((n) => n.type === "div" && n.props?.className === "dshcmc_fieldTitle" && n.props.children === "versionTitle"),
	"version field title rendered when a version is known"
);
const versionP = versionNodes.find(isNode("p", "dshcmc_value"));
assert.ok(versionP, "version value paragraph rendered");
assert.equal(versionP.props.children, "Google Chrome 139.0.7258.0", "version text displayed");
Object.assign(storeState, { chromeVersion: "" });

// ── empty flags placeholder ───────────────────────────────────────────────
Object.assign(storeState, { extraFlags: [] });
tree = render(storeState);
const emptyEditor = walk(tree).find(isNode("textarea", "dshcmc_text"));
assert.ok(emptyEditor, "textarea still rendered with empty flags");
assert.equal(emptyEditor.props.defaultValue, "", "empty flags show an empty editor");
assert.equal(emptyEditor.props.placeholder, "flagsPlaceholder", "placeholder invites the default");
Object.assign(storeState, { extraFlags: ["--no-usage-statistics", "--no-performance-crux"] });

// ── read-only deployment: no editor, value shown as text ─────────────────
Object.assign(storeState, { writable: false });
tree = render(storeState);
const roNodes = walk(tree);
assert.equal(roNodes.find(isNode("textarea", "dshcmc_text")), undefined, "no textarea while read-only");
assert.equal(
	roNodes.find((n) => n.type === "button" && n.props?.children === "flagsSave"),
	undefined,
	"no save control while read-only"
);
const roValue = roNodes.find(isNode("p", "dshcmc_value"));
assert.ok(roValue, "read-only mode shows the flags as a value paragraph");
assert.equal(roValue.props.children, "--no-usage-statistics\n--no-performance-crux");
const roCheck = roNodes.find(isLabel("check"));
assert.equal(roCheck.props.disabled, true, "re-check disabled while read-only");
Object.assign(storeState, { writable: true });

// ── error dot (chrome-executable/connection error reporting) ────────────────
// The red header dot — with the full error message as its title — is the
// single error surface: no body paragraph, no header badge.
Object.assign(storeState, { lastError: "Chrome executable not found at /nope/chrome" });
tree = render(storeState);
const errHeader = walk(tree).find(isNode("button", "dshcmc_header"));
let dot = findDot(tree);
assert.ok(dot, "status dot rendered while lastError is present");
assert.equal(dotState(dot), "error");
assert.equal(dot.props.role, "img");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "Chrome executable not found at /nope/chrome", "dot title carries the message");
assert.equal(walk(tree).find(isNode("p", "dshcmc_error")), undefined, "no body error paragraph — dot tooltip is the message surface");
assert.equal(walk(tree).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith("dshcmc_badge")), undefined, "no header badge");
// Title stays fixed (docker pattern): error only on dot tooltip
let nameSpan = walk(tree).find(isNode("span", "dshcmc_name"));
assert.ok(nameSpan, "name span still rendered with error");
assert.equal(nameSpan.props.children, "title", "title stays unchanged regardless of error");
assert.equal(nameSpan.props.title, undefined, "name span has no tooltip");
// aria-label stays fixed ("collapse" depends on open state, not error)
assert.ok(errHeader.props["aria-label"] === "expand: title" || errHeader.props["aria-label"] === "collapse: title", "aria-label unchanged by error");
Object.assign(storeState, { lastError: "" });
tree = render(storeState);
assert.equal(findDot(tree), undefined, "dot hidden again when healthy");
// Title remains stable across renders
header = walk(tree).find(isNode("button", "dshcmc_header"));
assert.equal(walk(tree).find(isNode("span", "dshcmc_name")).props.children, "title", "title stable when healthy");

// ── long error message: dot title shows full text ──────────────────────────
Object.assign(storeState, { lastError: "A very long error message that exceeds forty five characters so it should be truncated" });
tree = render(storeState);
dot = findDot(tree);
assert.ok(dot, "status dot rendered with long error");
assert.equal(dot.props.title, "A very long error message that exceeds forty five characters so it should be truncated", "dot title keeps full error text");
assert.equal(walk(tree).find(isNode("span", "dshcmc_name")).props.children, "title", "title stays fixed with long error");
Object.assign(storeState, { lastError: "" });

// ── known "executable missing" error: same single dot surface ─────────────
// chromeMissing (host-served) no longer renders a header badge: the known
// not-found state is reported exactly like any other error — the red dot with
// the full "Chrome executable not found…" message as its title. The flag also
// keeps the dot alive on its own (see the flag-alone case below).
const findBadge = (t) =>
	walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith("dshcmc_badge"));
Object.assign(storeState, { chromeMissing: true, lastError: "Chrome executable not found: /usr/bin/google-chrome" });
tree = render(storeState);
assert.equal(findBadge(tree), undefined, "missing-executable known error renders no header badge");
let missingDot = findDot(tree);
assert.ok(missingDot, "missing error renders the header error dot");
assert.equal(missingDot.props.role, "img", "dot is an img-role element");
assert.equal(missingDot.props.title, "Chrome executable not found: /usr/bin/google-chrome", "dot title carries the full known-error message");
assert.equal(walk(tree).find(isNode("p", "dshcmc_error")), undefined, "known error is not repeated as a body paragraph");
Object.assign(storeState, { chromeMissing: false, lastError: "" });
tree = render(storeState);
assert.equal(findDot(tree), undefined, "no dot while healthy");
// A generic (non-missing) error surfaces identically: just the dot.
Object.assign(storeState, { chromeMissing: false, lastError: "Protocol error (Target.setDiscoverTargets): Target closed" });
tree = render(storeState);
assert.equal(findBadge(tree), undefined, "generic error renders no badge");
assert.ok(findDot(tree), "generic error keeps only the dot");
Object.assign(storeState, { lastError: "" });

// ── known flag alone: bridge-update success clears lastError, not the flag ─
// applyFlags clears lastError on a successful bridge update while the host
// keeps chromeMissing until a probed success / reconnect line — the single
// dot keeps that known state visible, tooltip falling back to the label.
Object.assign(storeState, { chromeMissing: true, lastError: "" });
tree = render(storeState);
let missingOnlyDot = findDot(tree);
assert.ok(missingOnlyDot, "chromeMissing alone keeps the error dot visible");
assert.equal(missingOnlyDot.props.title, "chromeMissing", "tooltip falls back to the not-found label without a captured message");
assert.equal(missingOnlyDot.props["aria-label"], "statusError");
assert.equal(findBadge(tree), undefined, "still no badge — the dot remains the only surface");
Object.assign(storeState, { chromeMissing: false });
tree = render(storeState);
assert.equal(findDot(tree), undefined, "healthy again once the known flag clears");

// ── controller write path (rejected save → actionError) ───────────────────
const face = options.inject();
assert.equal(JSON.stringify(face.hooks.chromeMcpCard.getSnapshot()), JSON.stringify(storeState),
	"controller inject returns same snapshot store");
rejectNextFlagsWrite = true;
await face.saveFlags(["--headless"]);
tree = render(storeState);
dot = findDot(tree);
assert.ok(dot, "rejected flags write raises the status dot");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "write rejected by host", "dot title carries the rejection message");
assert.equal(walk(tree).find(isNode("p", "dshcmc_error")), undefined, "no body paragraph for actionError — the dot tooltip carries it");
// restore: a successful save clears actionError → healthy → dot hidden
await face.saveFlags(["--isolated"]);
tree = render(storeState);
assert.equal(findDot(tree), undefined, "dot hidden again after successful save");
assert.ok(writes.some(([f, v]) => f === "extraFlags" && JSON.stringify(v) === JSON.stringify(["--isolated"])),
	"saveFlags wrote the flags list");
Object.assign(storeState, { extraFlags: ["--no-usage-statistics", "--no-performance-crux"] });

// ── controller recheck path ───────────────────────────────────────────────
// recheck writes a numeric recheckNonce, then polls the shared describe
// mirror until the host advances the served checkRevision (the host keeps the
// check state in its in-memory base layer and has no push channel).
const mirrorLoadBefore = mirror.loadCalls;
const recheckPromise = face.recheck();
assert.ok(
	writes.some(([f, v]) => f === "recheckNonce" && typeof v === "number"),
	"recheck writes a numeric recheckNonce"
);
assert.equal(mirror.loadCalls, mirrorLoadBefore, "no mirror re-read before the first poll tick");
// first poll tick (700ms) fires, then the host advances the served revision
await new Promise((resolve) => setTimeout(resolve, 900));
assert.ok(mirror.loadCalls >= mirrorLoadBefore + 1, "poll re-reads the settings mirror while the check runs");
scopeSnapshot.value = { ...scopeSnapshot.value, checkRevision: scopeSnapshot.value.checkRevision + 1 };
listeners.forEach((fn) => fn());
await recheckPromise;
assert.equal(storeState.checkRevision, 1, "card store picked up the advanced check revision");

// ── describe base layer: where the status rides ───────────────────────────
// The host holds check/connection status in the composition base layer, which
// describe() clones fresh on every read; the frozen resolved value folds the
// base in only at commits. Status must therefore be served from the base
// clone — base-only changes (the registration-time check, bridge/tool
// captures) never reach the resolved value.
scopeSnapshot.base = {
	extraFlags: ["--host-seeded"],
	lastError: "Protocol error (Target.setDiscoverTargets): Target closed",
	chromeMissing: false,
	checkRevision: 9,
	chromeVersion: "Google Chrome 139.0.0"
};
scopeSnapshot.value = { ...scopeSnapshot.value, lastError: "stale resolved value", checkRevision: 4, chromeVersion: "" };
listeners.forEach((fn) => fn());
assert.equal(storeState.lastError, "Protocol error (Target.setDiscoverTargets): Target closed", "lastError is served from the fresh base clone, not the stale resolved value");
assert.equal(storeState.checkRevision, 9, "checkRevision is served from the base clone");
assert.equal(storeState.chromeVersion, "Google Chrome 139.0.0", "chromeVersion is served from the base clone");
assert.equal(JSON.stringify(storeState.extraFlags) === JSON.stringify(scopeSnapshot.value.extraFlags), true, "extraFlags keeps reading the resolved value (the user layer wins over the host-seeded base field)");
const baseTree = render(storeState);
const baseDot = findDot(baseTree);
assert.ok(baseDot, "base-served error lights the header dot");
assert.equal(baseDot.props.title, "Protocol error (Target.setDiscoverTargets): Target closed", "the dot tooltip comes from the base clone");
// Restore a healthy mirror state for the sections that follow.
scopeSnapshot.base = void 0;
scopeSnapshot.value = { ...scopeSnapshot.value, lastError: "", checkRevision: 1, chromeVersion: "" };
listeners.forEach((fn) => fn());

// ── startup catch-up poll ─────────────────────────────────────────────────
// The host runs the executable check at registration time — *after* the
// card's first describe read — and a module plugin has no push channel. So a
// controller whose first served revision is 0 re-reads the describe mirror
// until the check lands: this is how a Chrome-less host lights the error dot
// right after dsh starts, without any user action. A second apply mounts a
// second, clean controller against a fresh scope/mirror stub.
const scopeSnapshot2 = {
	status: "ready",
	value: { extraFlags: ["--no-usage-statistics", "--no-performance-crux"], recheckNonce: 0, lastError: "", checkRevision: 0, chromeVersion: "" },
	base: { extraFlags: [], recheckNonce: 0, lastError: "", chromeMissing: false, checkRevision: 0, chromeVersion: "" },
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
assert.ok(mirror2.loadCalls >= catchupLoadsBefore + 1, "the catch-up poll re-reads the mirror while the first check revision is still 0");
// The registration-time check fails in the base layer only (no commit) — the
// fresh clone wins over the stale resolved value, and the wait settles.
scopeSnapshot2.base = { ...scopeSnapshot2.base, lastError: "Chrome executable not found: no executable detected (checked: /usr/bin/google-chrome)", chromeMissing: true, checkRevision: 1 };
const catchupLoadsAfterAdvance = mirror2.loadCalls;
listeners2.forEach((fn) => fn());
assert.equal(storeState.lastError, "Chrome executable not found: no executable detected (checked: /usr/bin/google-chrome)", "the startup failure is served through the base clone");
assert.equal(storeState.chromeMissing, true, "the known flag arrives with the startup failure");
assert.equal(storeState.checkRevision, 1, "the catch-up poll picked the advanced revision up");
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

// ── checking lifecycle ────────────────────────────────────────────────────
const findCheckBtn = (t) =>
	walk(t).find((n) => n.type === "button" && (n.props?.children === "check" || n.props?.children === "checking"));
tree = render(storeState);
let checkBtn = findCheckBtn(tree);
checkBtn.props.onClick();
tree = render(storeState);
checkBtn = findCheckBtn(tree);
assert.equal(checkBtn.props.children, "checking", "re-check button shows checking");
assert.equal(checkBtn.props.disabled, true, "button disabled while checking");
await Promise.resolve();
tree = render(storeState);
checkBtn = findCheckBtn(tree);
assert.equal(checkBtn.props.children, "check", "button back to idle after flush");
checkBtn = findCheckBtn(tree);
assert.equal(checkBtn.props.disabled, false, "button re-enabled after flush");

console.log("client.test.mjs: all assertions passed");
