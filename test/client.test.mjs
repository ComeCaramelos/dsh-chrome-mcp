// Materializes lib/client.js in a stubbed browser environment (the same
// window.__ModuleLoader__.load contract the shell's module system uses) and
// exercises the card: registration against the Plugins row-configuration slot,
// snapshot projection off the configuration form, the render tree, the staged
// write path (stage → apply, or discard), the saved-executable picker (the pill,
// the rows and the search action) and the immediate host-run triggers, which
// settle as the served revision advances — there is no poll loop any more.
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
/** A DOM node stand-in: enough tree for the shared toast mirror (root, one
 * node per notice) to append, remove and be found by its data attribute. */
function stubNode(tag) {
	const node = {
		tag,
		dataset: {},
		textContent: "",
		children: [],
		setAttribute() {},
		appendChild(child) {
			node.children.push(child);
			return child;
		},
		removeChild(child) {
			node.children = node.children.filter((candidate) => candidate !== child);
		},
		remove() {
			const at = mountedContainers.indexOf(node);
			if (at !== -1) mountedContainers.splice(at, 1);
		}
	};
	return node;
}
const document = {
	querySelector: () => null,
	// The shared toast mirror finds its one page-wide root by its attribute.
	querySelectorAll: (selector) =>
		selector === "div[data-dsh-ancesters-toasts]" ? mountedContainers.filter((node) => node.dataset.dshAncestersToasts === "1") : [],
	createElement: stubNode,
	head: { appendChild: (el) => styles.push(el) },
	body: { appendChild: (el) => mountedContainers.push(el) }
};
// Everything appended to the page body — the shared toast mirror's one root —
// is recorded so the mount/dispose assertions can read it.
const mountedContainers = [];
// Stateful useState: the body keeps the dropdown open/busy/dialog state across re-renders, so
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
	// The toast host is mounted with createElement and reads the store through
	// useSyncExternalStore; the stub answers the store's current snapshot.
	createElement: (type, props) => materialize(type, props, undefined, "jsx"),
	useSyncExternalStore: (subscribe, getSnapshot) => (subscribe === undefined || getSnapshot === undefined ? null : getSnapshot()),
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

// The card store is the shared controller's (dsh-ancesters): it publishes its
// own snapshot shape (`values`, `dirty`, `notice`, …), and the card renders the
// projection of it (`cardState`, the bundle's test surface). `storeState` reads
// exactly that projection — what the card renders — plus the pending notice,
// off whatever the controller published last; nothing writes a field by hand.
let cardController = undefined;
const storeState = new Proxy({}, {
	get: (_target, key) => {
		if (cardController === undefined) return undefined;
		if (key === "notice") return cardController.getSnapshot().notice;
		return factoryResultRef.current.cardState(cardController)[key];
	}
});
/** Filled once the bundle is materialized (the proxy reads it lazily). */
const factoryResultRef = { current: undefined };
const storeListeners = new Set();
const clientStore = {
	createSnapshotStore: (initial) => {
		let value = initial;
		return {
			getSnapshot: () => value,
			subscribe: (fn) => (storeListeners.add(fn), () => storeListeners.delete(fn)),
			set: (next) => {
				value = next;
				for (const fn of [...storeListeners]) fn();
			}
		};
	}
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
	}),
	// Minimal toast stand-in: no hooks/portals, but it stays findable by role
	// and text so the failure-toast render path is assertable.
	Toast: (props) => ({
		kind: "jsx",
		type: "div",
		props: {
			role: "alert",
			"data-toast-text": props.text,
			onDone: props.onDone
		},
		children: undefined
	}),
	IconWarningOutline16: { displayName: "IconWarningOutline16" }
};
const requireStub = (spec) => {
	if (spec === "react") return react;
	if (spec === "react/jsx-runtime") return jsxRuntime;
	if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
	throw new Error(`unexpected require: ${spec}`);
};

// ── materialize ──────────────────────────────────────────────────────────
// setTimeout/clearTimeout stand in for the browser globals the settle waits
// schedule their deadlines against (the real bundle runs in a page). The
// wait's budget (90 s) makes real waiting impractical in a unit test, so
// these route through a controllable queue the test flushes on demand.
const sandboxTimers = new Map();
let sandboxTimerId = 0;
const sandboxSetTimeout = (fn, _delay) => {
	sandboxTimerId += 1;
	sandboxTimers.set(sandboxTimerId, fn);
	return sandboxTimerId;
};
const sandboxClearTimeout = (id) => {
	sandboxTimers.delete(id);
};
/** Run every currently-armed timer callback exactly once (drains the queue). */
function runPendingTimers() {
	const due = [...sandboxTimers.values()];
	sandboxTimers.clear();
	for (const fn of due) fn();
}
vm.runInNewContext(bundle, {
	window,
	document,
	require: undefined,
	console,
	setTimeout: sandboxSetTimeout,
	clearTimeout: sandboxClearTimeout,
	setInterval: () => 1,
	clearInterval: () => {}
});
assert.ok(registration, "bundle registered with __ModuleLoader__");
assert.equal(registration.id, "@comecaramelos/dsh-chrome-mcp");
const factoryResult = registration.factory(requireStub);
factoryResultRef.current = factoryResult;
assert.equal(typeof factoryResult.apply, "function", "exports.apply");
assert.equal(JSON.stringify(factoryResult.inject), JSON.stringify(["configForms", "slots", "locale", "remote", "remote.settings"]), "exports.inject — the shared card's services");
// The live keys every card write clears are exactly the Host's mirror keys: a
// key the browser half forgot would be persisted by the next save.
{
	const { liveMirrorKeys } = await import("../lib/host/values.js");
	assert.deepEqual([...factoryResult.LIVE_KEYS].sort(), [...liveMirrorKeys()].sort(), "the client's live keys mirror the host's");
}
// The one exported wait budget stands where the old poll budgets stood: the
// surface for tests/diagnostics, ignored by the loader.
assert.equal(factoryResult.RUN_SETTLE_TIMEOUT_MS, 90000, "the settle deadline is exported for tests/diagnostics");

// ── configuration form stub ──────────────────────────────────────────────
// One form, read through `getSnapshot`/`subscribe` and written through
// `mutate` — the whole surface the card half talks to since dsh 0.2.0. The
// served section carries every field the card renders: the fields it edits and
// the live state the Host answers with, both in the same resolved section.
const formValue = {
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	chromePath: "",
	executables: [],
	stderrMode: "",
	stderrEffective: "log",
	lastError: "",
	chromeMissing: false,
	executableDiscoveryRevision: 0,
	chromeVersion: "",
	executableStatus: [],
	effectiveChromePath: "",
	effectiveSource: "",
	defaultExtraFlags: [],
	wslExtraFlags: [],
	wslWindowsExecutable: false,
	windowsChromeStatus: { state: "off", port: 0, error: "" },
	carriesConnectionMode: false,
	refreshExecutablesNonce: 0,
	openWindowsChromeNonce: 0
};
const form = {
	status: "ready",
	value: formValue,
	revision: 1,
	writable: true
};
/** Every field mutation the form answered for, in write order. */
const writes = [];
/**
 * How many write *passes* the stub still refuses. A pass is one `mutate` answer:
 * a refused pass means the Host answered that the view it holds has moved past the
 * one the write was fenced on (every live commit it publishes advances it), and the
 * pass comes back `false` only after the Host document has been re-read — so the
 * next pass is fenced on what the Host now holds. Refusing k passes for k under the
 * card's pass budget models a Host that answers while the write is crossing the
 * wire, and refusing the whole budget is what a real refusal looks like.
 */
let refusedPasses = 0;
/** The `expectedRevision` every write pass carried — undefined means the form
 * fenced the pass on its own mirrored view, which is what a live card edits
 * through. */
const fences = [];
/** Live keys a write cleared, in order — never a served value. */
const clears = [];
const formListeners = new Set();
const formStub = {
	getSnapshot: () => form,
	subscribe: (fn) => (formListeners.add(fn), () => formListeners.delete(fn)),
	// A real form's `mutate` fences and recovers through its own `this`, so the
	// door has to stand as a method of the form, not as a detached reference.
	// The guard below is what pins that: called bare, this stub refuses — which
	// is what a detached reference of a real form would do outright.
	mutate(ops, revision) {
		if (this === undefined) return Promise.resolve(false);
		fences.push(revision);
		if (refusedPasses > 0) {
			refusedPasses -= 1;
			return Promise.resolve(false);
		}
		for (const op of ops) {
			const field = op.path.join(".") || "(root)";
			// A live key's clear keeps it out of the profile file; the Host's
			// mirror answers it again at once, so the served value stands.
			if (op.op === "unset") {
				clears.push(field);
				continue;
			}
			writes.push([field, op.value]);
			formValue[field] = op.value;
		}
		form.revision += 1;
		notifyForm();
		return Promise.resolve(true);
	}
};
/** A served change: the revision advances and every subscriber is told. */
function notifyForm() {
	form.revision += 1;
	for (const fn of Array.from(formListeners)) fn();
}
/**
 * The Host's own run answering: it writes what it found and moves its run
 * counter, which is what settles every armed executable action — no poll, no
 * re-read, no wall clock.
 */
function runAnswered(fields) {
	return serve({
		executableDiscoveryRevision: formValue.executableDiscoveryRevision + 1,
		...fields
	});
}

// ── cordis client ctx stub ───────────────────────────────────────────────
const registeredSlotEntries = [];
// Every effect the bundle registers is recorded, so a test can hand the card
// half back the way the shell's teardown would.
const effectDisposers = [];
const ctx = {
	effect: (fn) => {
		const disposer = fn();
		effectDisposers.push(() => (typeof disposer === "function" ? disposer() : disposer === undefined ? undefined : disposer.dispose?.()));
		return { dispose: () => effectDisposers.at(-1)?.() };
	},
	locale: {
		register: (ns, dicts) => {
			assert.equal(ns, "chromeMcp");
			assert.ok(dicts.en);
			var required = [
				"flagsTitle", "flagsHint", "flagsEmpty", "flagsValueLabel",
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
				"statusError", "statusOk", "chromeMissing", "readOnly",
				"toastStall", "toastError",
				"apply", "discard", "saving", "unsaved", "saveFailed"
			];
			for (var i = 0; i < required.length; i++) {
				assert.ok(required[i] in dicts.en, "en has key: " + required[i]);
			}
		},
		bind: () => (key) => key
	},
	configForms: {
		get: (entryId) => (assert.equal(entryId, "mcp-chrome"), formStub)
	},
	slots: {
		inject: (slot, registerFn) => {
			assert.equal(slot, "plugins.row.config");
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
const ownSheets = styles.filter((style) => style.dataset.pluginCss === "@comecaramelos/dsh-chrome-mcp/ChromeMcpCard.module.css");
assert.equal(ownSheets.length, 1, "the card's own style tag is injected once (the shared card sheet rides beside it)");
const PREFIX = ownSheets[0].textContent.match(/\.([a-z0-9]{6})_/)[1];
const CLS = (local) => PREFIX + "_" + local;

// ── the failure-toast host ───────────────────────────────────────────────
// The card slot only renders while the row page is open, so the body-mounted
// toast root (the shared `toasts` hole) is mounted by apply() regardless of any
// page: a failure that lands while the user is elsewhere in the app must
// announce immediately.
const toastRootNodes = () => mountedContainers.filter((node) => node.dataset.dshAncestersToasts === "1");
assert.equal(toastRootNodes().length, 1, "apply() mounts exactly one page-wide toast root");
/** The toast the root shows for this card right now, or undefined. */
function shownToast() {
	return toastRootNodes()[0].children[0];
}

// ── registration ─────────────────────────────────────────────────────────
// Configuration since dsh 0.2.0 lives on the **row**, and the row arrives
// through the manager bundle's patch: the card registers the row-configuration
// slot under the key the Plugins page composes — `<bundle>#<row id>`, the
// bundle a person installs, not the package the row runs.
assert.equal(registeredSlotEntries.length, 1, "one row-configuration entry");
const [options, Component] = registeredSlotEntries[0];
assert.equal(options.name, "plugins.row.config");
assert.equal(options.key, "@comecaramelos/dsh-mcp-manager-bundle#mcp-chrome");
assert.equal(options.locale, "chromeMcp");
assert.equal(typeof Component, "function");
// The injected face is the shared controller (and its store); the actions the
// card's controls call are the seam's, each one a call on that controller.
const injected = options.inject();
assert.ok(injected.store, "the card store is injected");
cardController = injected.controller;
assert.equal(typeof cardController.stage, "function", "the shared controller is injected");
const face = {
	...factoryResult.cardActions(cardController),
	clearNotice: (seq) => cardController.clearNotice(seq)
};
assert.equal(typeof face.saveFlags, "function", "the flags write is composed");

// ── render helpers ────────────────────────────────────────────────────────
/**
 * Serve fields through the form — the only way live state reaches the card:
 * assigning them is a revision advance, the subscribers republish, and the card
 * renders whatever that produced. `writable` is the form's own answer, not a
 * field of the served section.
 */
function serve(fields) {
	if (fields !== undefined) {
		const next = { ...fields };
		if ("writable" in next) {
			form.writable = next.writable;
			delete next.writable;
		}
		Object.assign(formValue, next);
	}
	notifyForm();
	return storeState;
}

/**
 * The props the shell hands the component: locale copy, the snapshot hook the
 * injected store synthesizes, the actions the same face injects, and the shape
 * the page renders this row's configuration for (`page` carries no form of its
 * own — this half holds the shared form itself).
 */
function cardProps(extra) {
	return {
		t: (k) => k,
		view: "page",
		form: undefined,
		useChromeMcpCard: (sel) => sel(storeState),
		saveFlags: face.saveFlags,
		toggleStderr: face.toggleStderr,
		selectExecutable: face.selectExecutable,
		saveExecutables: face.saveExecutables,
		refreshExecutables: face.refreshExecutables,
		addExecutables: face.addExecutables,
		openWindowsChrome: face.openWindowsChrome,
		apply: face.apply,
		discard: face.discard,
		adoptForm: face.adoptForm,
		...extra
	};
}
/** The props of the render `render()` last performed. */
let lastProps = undefined;

/**
 * Render the registered component. Everything the card reads comes off the
 * injected store, so a render is only ever as current as the last served
 * revision — the same wiring the shell gives it.
 */
function render(fields, overrides) {
	serve(fields);
	hookIndex = 0;
	react.useRef._index = 0;
	var hookCount = 0;
	// The card's own effects are collected during its render and run once it has
	// returned, because adopting the page's form publishes — and a store update
	// handed in during a render is what the reconciler would refuse. (The blocks
	// the body composes out of the card run their hooks during the expansion
	// below; the only effect among them is the probe-age clock, which the
	// sandbox's `setInterval` swallows anyway.)
	var pendingEffects = [];
	var _useState = react.useState;
	var _useEffect = react.useEffect;
	var _useId = react.useId;
	react.useState = function (init) { ++hookCount; return _useState.call(this, init); };
	react.useEffect = function (fn) { ++hookCount; pendingEffects.push(fn); return undefined; };
	react.useId = function () { ++hookCount; return _useId.call(this); };
	lastProps = cardProps(overrides);
	// The shared body answers its list of blocks; this card declares exactly
	// one, so the tree under test is that block (an empty list is "nothing").
	var result = Component(lastProps);
	if (Array.isArray(result) && result.length === 1) result = result[0];
	react.useState = _useState;
	react.useEffect = _useEffect;
	react.useId = _useId;
	if (lastHookCount !== null) assert.equal(hookCount, lastHookCount, "hook count stable across renders");
	lastHookCount = hookCount;
	// The commit phase: every effect the card handed in runs, and what the same
	// slot handed back last render is released first.
	for (var i = 0; i < pendingEffects.length; i++) {
		var previous = commitDisposers[i];
		if (previous !== undefined) previous();
		var next = pendingEffects[i]();
		commitDisposers[i] = typeof next === "function" ? next : undefined;
	}
	commitDisposers.length = pendingEffects.length;
	// Expand the tree's function components exactly once, in render order — the
	// same thing React does when it reconciles. Calling them again from a
	// traversal would hand them fresh hook slots and a component would read its
	// state from the wrong slot.
	expand(result);
	return result;
}
/** What each of the card's effect slots handed back last render, keyed by slot. */
const commitDisposers = [];

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
const findFooterApply = (t) => walk(t).find(isNode("button", CLS("footerButton") + " " + CLS("footerButtonPrimary")));
const findFooterDiscard = (t) => walk(t).find(isNode("button", CLS("footerButton")));
const findBadge = (t) => walk(t).find(isNode("span", CLS("badge")));
/** The body's one error line: the dot-leading paragraph the failure rides. */
const errorLine = (t) => walk(t).find((n) => n.type === "p" && n.props?.className === CLS("error") && Array.isArray(n.props?.children));
function findDot(t) {
	return walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith(CLS("dot") + " "));
}
/** The WSL + Windows-executable notice: the body's one `role="note"` block. */
const findNotice = (t) => walk(t).find((n) => n.props?.role === "note");
function dotState(dot) {
	return dot.props.className.includes(CLS("dotError")) ? "error" : "none";
}
/** Let every settled write and every armed settle run to completion. */
const settled = async () => {
	for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const DOCS_URL =
	"https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md";

// ── render 1: nothing served ─────────────────────────────────────────────
// A form the Host does not expose answers `unavailable`, and the card renders
// nothing at all.
form.status = "unavailable";
let tree = render();
assert.equal(Array.isArray(tree) && tree.length === 0, true, "renders nothing while the entry is unavailable");

// ── render 2: served ─────────────────────────────────────────────────────
// Since dsh 0.2.0 the Plugins page owns the section and its identity line, so
// this half is no longer a collapsable card: what renders is the section's own
// stack of blocks, everything visible, with no header toggling it.
form.status = "ready";
tree = render({
	writable: true,
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	executables: [],
	executableStatus: []
});
assert.ok(tree && tree.type === "div", "the body is a plain block, not a list item");
assert.equal(tree.props.className, CLS("body"), "the root is the body stack");
const nodes = walk(tree);
assert.equal(nodes.find(isNode("button", CLS("header"))), undefined, "no disclosure header of our own");
assert.equal(nodes.find((n) => n.props?.className?.includes?.(CLS("chevron"))), undefined, "no expand chevron rides along");
assert.ok(nodes.every((n) => n.props?.["aria-controls"] === undefined), "nothing collapses anything");
assert.ok(nodes.find(isNode("div", CLS("catalog"))), "the executable catalog renders inline");
assert.ok(nodes.find(isNode("a", CLS("docsLink"))), "the configuration-guide link renders inline");

// ── the page shape ───────────────────────────────────────────────────────
// The Plugins page asks for one of two shapes of the same slot; only the page
// body is ours to render, and it is rendered for the row's own key.
// The summary shape is rendered through the same component, so its hooks run in
// the same slots — the tree is simply empty.
hookIndex = 0;
const summaryTree = Component(cardProps({ view: "summary" }));
assert.equal(summaryTree, null, "the page asks the summary shape for nothing — the row's own one-liner stands");
// A page render hands none of its own — the summary shape may hand no form at
// all — so the shared form this half took from `configForms` is what stands.
hookIndex = 0;
const noFormBody = Component(cardProps({ view: "page", form: undefined }));
const noFormTree = Array.isArray(noFormBody) && noFormBody.length === 1 ? noFormBody[0] : noFormBody;
assert.ok(noFormTree && noFormTree.type === "div", "the page shape renders off the shared form");

// configuration-guide link: an icon + short label beside the Extra flags title
const link = nodes.find(isNode("a", CLS("docsLink")));
assert.ok(link, "the configuration-guide link renders with the body");
assert.equal(link.props.href, DOCS_URL, "link points at the upstream configuration docs");
assert.equal(link.props.target, "_blank");

// Extra flags (writable mode renders one row per saved flag, no free-form box)
const fieldTitle = walk(tree).find(
	(n) => n.type === "span" && n.props?.className === CLS("fieldTitle") && n.props.children === "flagsTitle"
);
assert.ok(fieldTitle, "flags field title rendered");
assert.ok(walk(tree).find(isNode("div", CLS("fieldDesc"))), "flags field description rendered");
assert.equal(walk(tree).find(isNode("textarea")), undefined, "no free-form editor: the flags list replaced the textarea");
// The flags rows sit behind the same <details> disclosure the saved executables
// use — so the body carries two disclosure blocks.
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
// No separate save control: a blur/Enter stages the whole list, the way the
// executable rows do; what persists it is the form's own Apply.
assert.equal(
	walk(tree).find((n) => n.type === "button" && typeof n.props?.children === "string" && n.props.children.includes("flagsSave")),
	undefined,
	"no save control: the rows stage on their own"
);

// ── the staged form ──────────────────────────────────────────────────────
// Nothing is written as it is edited: a settled edit stages into the card's own
// draft, the card announces it, and the form's **Apply** is what lands it.
serve({ extraFlags: ["--no-usage-statistics", "--no-performance-crux"] });
tree = render();
writes.length = 0;
assert.equal(storeState.dirty, false, "a served card is not dirty");
assert.equal(findBadge(tree), undefined, "no unsaved badge while nothing is staged");
assert.equal(findFooterApply(tree).props.disabled, true, "nothing staged → the form cannot be applied");
// Typing alone is not an edit: the whole list lands when the edit settles.
flagFields(tree)[1].props.onChange({ target: { value: "--headless" } });
tree = render();
assert.equal(writes.length, 0, "a keystroke writes nothing");
assert.equal(storeState.dirty, false, "an unsettled keystroke is not yet a staged edit");
flagFields(tree)[1].props.onBlur();
await settled();
tree = render();
assert.equal(writes.length, 0, "a settled flags edit stages — it writes nothing");
assert.equal(storeState.dirty, true, "an edit that differs from what is served is dirty");
assert.equal(findBadge(tree).props.children, "unsaved", "the card announces the staged edit");
assert.equal(findFooterApply(tree).props.disabled, false, "staged edits make the form applicable");
// The draft overlays what is served: the row reads what applying would store.
assert.equal(flagFields(tree)[1].props.value, "--headless", "the row already shows the staged flag");
// An edit that lands back on what is served stages nothing.
flagFields(render())[1].props.onChange({ target: { value: "--no-performance-crux" } });
flagFields(render())[1].props.onBlur();
await settled();
assert.equal(storeState.dirty, false, "re-editing back onto the served value is not dirty");
assert.equal(writes.length, 0, "and it writes nothing");

// ── what Apply lands ─────────────────────────────────────────────────────
// Only the two staged fields: rows and selection write on the spot, so an apply
// carries exactly what differs.
flagFields(render())[1].props.onChange({ target: { value: "--headless" } });
flagFields(render())[1].props.onBlur();
await settled();
writes.length = 0;
clears.length = 0;
findFooterApply(render()).props.onClick();
await settled();
assert.equal(
	JSON.stringify(writes.map(([f]) => f)),
	JSON.stringify(["extraFlags"]),
	"one save persists the staged flags — nothing else rides along"
);
assert.deepEqual([...clears].sort(), [...factoryResult.LIVE_KEYS].sort(), "and it clears every live key, so none is persisted with it");
assert.equal(
	JSON.stringify(writes[0][1]),
	JSON.stringify(["--no-usage-statistics", "--headless"]),
	"the whole list lands at once"
);
// The draft that landed is the served list: not dirty, and nothing else rides a
// later apply.
assert.equal(storeState.dirty, false, "the landed edit stops being dirty");
writes.length = 0;
await face.apply();
assert.equal(writes.length, 0, "an inert form writes nothing");

// ── discard ──────────────────────────────────────────────────────────────
// Discard drops the whole draft, reverting every staged value to what the Host
// already serves. Nothing was persisted, so what reads back is the served list.
flagFields(render())[1].props.onChange({ target: { value: "--staged-only" } });
flagFields(render())[1].props.onBlur();
await settled();
writes.length = 0;
findFooterDiscard(render()).props.onClick();
await settled();
assert.equal(writes.length, 0, "discarding writes nothing — only apply persists");
assert.equal(storeState.dirty, false, "discarding clears the staged edit");
tree = render();
assert.equal(flagFields(tree)[1].props.value, "--headless", "the served value reads back — a discarded edit never reached the Host");

// ── a write the Host answers as behind ───────────────────────────────────
// The Host refuses a write whose fence it has moved past — the revision advances
// every time it answers with live state, which under a live card is continuously:
// while an action runs the Host probes what is selected, restarts the connection
// for it and reports what it found, and every one of those answers advances the
// revision. That answer is not a broken edit, it is "read me again" — and the
// shell's own recovery read is what moves the fence, so the edit is re-issued
// until it lands. A whole-card action — the pill picking an executable above all,
// on the very host whose answers keep arriving — would read as a dead control
// without it, which is the regression this pins: refusing a pass *once* would
// never have caught a Host that answers more than once per write.
tree = render();
flagFields(tree)[1].props.onChange({ target: { value: "--stale-fence" } });
flagFields(render())[1].props.onBlur();
await settled();
refusedPasses = 3;
writes.length = 0;
findFooterApply(render()).props.onClick();
await settled();
assert.equal(writes.length, 1, "every refused pass is re-issued until the Host answers it");
assert.equal(storeState.failed, false, "an answer that only says the view moved is not a failed save");
assert.equal(storeState.dirty, false, "and the edit is not left staged once it lands");
assert.equal(flagFields(render())[1].props.value, "--stale-fence", "the retried edit reads back as served");

// ── a write the Host refuses outright ────────────────────────────────────
// A write refused for its whole pass budget is a real refusal: nothing is
// persisted, the edit is kept, and the card says so rather than letting the card
// fall back to what the Host answers — which is what an un-retried write reads
// like, every field snapping back to the value it had before the edit.
tree = render();
flagFields(tree)[1].props.onChange({ target: { value: "--refused" } });
flagFields(render())[1].props.onBlur();
await settled();
refusedPasses = 4;
writes.length = 0;
findFooterApply(render()).props.onClick();
await settled();
assert.equal(writes.length, 0, "a write refused for its whole budget persists nothing");
assert.equal(storeState.failed, true, "an outright refusal is reported");
tree = render();
assert.ok(walk(tree).find((n) => n.type === "p" && n.props?.className === CLS("footerError")), "the failure reads as its own line");
assert.equal(storeState.dirty, true, "a refused save keeps the staged edit");
// The next accepted write clears the failure line.
flagFields(render())[1].props.onChange({ target: { value: "--accepted" } });
flagFields(render())[1].props.onBlur();
await settled();
findFooterApply(render()).props.onClick();
await settled();
assert.equal(storeState.failed, false, "the next accepted save clears the failure");
assert.equal(writes.length, 1, "and the edit lands");

// ── the pass carries no card-side fence ──────────────────────────────────
// Every pass re-fences on what the *form* mirrors, so no pass can be fenced on a
// view that is already behind. A card-read revision is always at least one live
// commit behind under a running Host — that is what made an executable pick get
// refused over and over until it simply did not land, the whole card snapping back
// to what the Host had been answering.
fences.length = 0;
writes.length = 0;
flagFields(render())[1].props.onChange({ target: { value: "--no-fence" } });
flagFields(render())[1].props.onBlur();
await settled();
findFooterApply(render()).props.onClick();
await settled();
assert.equal(writes.length, 1, "the edit lands on the first pass");
assert.ok(fences.length > 0, "the write did reach the form");
assert.ok(fences.every((revision) => revision === undefined), "no pass carried a revision read by the card");

// ── "Reduce log output" rides the same staged form ───────────────────────
// It flips the effective mode and stages it, exactly like a flag edit.
const toggles = () => walk(render()).filter((n) => n.type === "Switch");
serve({ stderrMode: "" });
assert.equal(toggles()[0].props.checked, true, "checked while the Host routes stderr to the log file");
writes.length = 0;
toggles()[0].props.onChange();
await settled();
assert.equal(writes.length, 0, "a stderr flip stages — nothing is persisted on the click");
assert.equal(storeState.dirty, true, "the flip reads as a staged edit");
writes.length = 0;
await face.apply();
assert.ok(writes.some(([f, v]) => f === "stderrMode" && v === "console"), "applying persists the flipped mode");
// Flipping back onto what is already effective stages nothing.
serve({ stderrMode: "console" });
writes.length = 0;
toggles()[0].props.onChange();
await settled();
toggles()[0].props.onChange();
await settled();
assert.equal(writes.length, 0, "a flip back onto what is effective writes nothing");
assert.equal(storeState.dirty, false, "and is not dirty");
serve({ stderrMode: "" });

// A mirror that lagged the field it measures must never turn the switch into a
// dead control. What the field states wins, so the flip stages the other mode,
// reads as a staged edit, and applying persists it — the control answers for
// whatever the profile's own row carried.
serve({ stderrMode: "console", stderrEffective: "log" });
writes.length = 0;
assert.equal(toggles()[0].props.checked, false, "the switch states what the field says, not what the mirror lagged on");
toggles()[0].props.onChange();
await settled();
assert.equal(storeState.stderrMode, "log", "the flip stages the other mode, not the mirror's stale answer");
assert.equal(storeState.dirty, true, "and that is a real staged edit");
assert.equal(writes.length, 0, "the click still persists nothing");
await face.apply();
assert.ok(writes.some(([f, v]) => f === "stderrMode" && v === "log"), "applying persists the flipped mode, mirror or no mirror");
serve({ stderrMode: "", stderrEffective: "log" });

// ── Restore defaults / Flags WSL ride the same list ─────────────────────
// Both keep every flag the rows carry and append only what the Host's own list
// is missing; the card carries no copy of either list. They ride the same staged
// form, so a merged list is what **Apply** writes.
serve({
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	defaultExtraFlags: ["--no-usage-statistics", "--no-performance-crux", "--isolated"]
});
writes.length = 0;
const restoreBtn = walk(render()).find(isLabel("flagsRestore"));
assert.ok(restoreBtn, "restore-defaults button rendered");
assert.equal(restoreBtn.props.disabled, false, "restore enabled while the Host serves defaults");
assert.equal(restoreBtn.props.title, "flagsRestoreTitle", "its tooltip is localizable");
restoreBtn.props.onClick();
await settled();
assert.equal(writes.length, 0, "restore stages like any other flag edit");
assert.equal(
	JSON.stringify(storeState.extraFlags),
	JSON.stringify(["--no-usage-statistics", "--no-performance-crux", "--isolated"]),
	"the merged list reads through the rows: nothing dropped, only what was missing appended"
);
writes.length = 0;
findFooterApply(render()).props.onClick();
await settled();
assert.equal(
	JSON.stringify(writes.map(([f]) => f)),
	JSON.stringify(["extraFlags"]),
	"one save persists the merged list"
);
// A list that already carries every default stages — and writes — nothing.
writes.length = 0;
walk(render()).find(isLabel("flagsRestore")).props.onClick();
await settled();
assert.equal(storeState.dirty, false, "nothing to recover is not an edit");
await face.apply();
assert.equal(writes.length, 0, "and an inert merge writes nothing");
serve({ defaultExtraFlags: [] });
tree = render();
assert.equal(walk(tree).find(isLabel("flagsRestore")).props.disabled, true, "no defaults served → nothing to recover");
// ── the Flags WSL control ────────────────────────────────────────────────
// The recommended WSL ↔ Windows flags are Host-served too, so the control is
// enabled only while the Host actually serves that list.
serve({
	wslExtraFlags: ["--chromeArg=--remote-debugging-port=9222"],
	extraFlags: ["--no-usage-statistics", "--no-performance-crux", "--isolated"]
});
tree = render();
const wslBtn = walk(tree).find(isLabel("flagsWsl"));
assert.ok(wslBtn, "the WSL-flags button renders");
assert.equal(wslBtn.props.disabled, false, "WSL enabled while the Host serves recommended flags");
assert.equal(wslBtn.props.title, "flagsWslTitle", "its tooltip is localizable");
writes.length = 0;
wslBtn.props.onClick();
await settled();
findFooterApply(render()).props.onClick();
await settled();
assert.ok(
	writes.some(
		([f, v]) => f === "extraFlags" && JSON.stringify(v) ===
			JSON.stringify(["--no-usage-statistics", "--no-performance-crux", "--isolated", "--chromeArg=--remote-debugging-port=9222"])
	),
	"the control writes the current list plus the missing recommended flags, losing nothing"
);
writes.length = 0;
serve({ wslExtraFlags: [] });
tree = render();
assert.equal(walk(tree).find(isLabel("flagsWsl")).props.disabled, true, "no recommended flags served → nothing to add");

// ── the executable picker ─────────────────────────────────────────────────
// Nothing saved yet: the pill invites a pick, the empty-state notice says what
// to do, and the saved rows live behind a collapsed disclosure.
tree = render({ executables: [], executableStatus: [], effectiveChromePath: "", effectiveSource: "", chromeVersion: "" });
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
const windowsStates = [
	["off", true, "off + writable → the run can be launched"],
	["launch-failed", true, "a failed launch is retryable"]
];
for (const [state, enabled, note] of windowsStates) {
	serve({ windowsChromeStatus: { state, port: 0, error: "" } });
	const button = walk(render()).find(isLabel("openWindowsChrome"));
	assert.ok(button, `the Windows Chrome button renders for ${state}`);
	assert.equal(button.props.disabled, !enabled, note);
	assert.equal(button.props.title, "openWindowsChromeTitle", "its tooltip is localizable");
}
// Every idle answer carries its own tooltip; nothing but `not-applicable`
// removes the run — a `not-found` or `unreachable` is a retryable answer, and a
// disabled button would leave the notice pointing at a dead control.
for (const [state, title, disabled] of [
	["unreachable", "windowsChromeUnreachable", false],
	["not-found", "windowsChromeNotFound", false],
	["not-applicable", "windowsChromeNotWsl", true]
]) {
	serve({ windowsChromeStatus: { state, port: 0, error: "x" } });
	const tree2 = render();
	const b2 = walk(tree2).find((n) => n.type === "button" && n.props?.title === title);
	assert.ok(b2, `${state} renders with its own tooltip`);
	assert.equal(b2.props.disabled, disabled, disabled ? `${state} is no run at all` : `${state} is retryable — the run answers again on the next click`);
	assert.equal(b2.props.children, "openWindowsChrome", "the busy label belongs to the busy state only");
}
serve({ windowsChromeStatus: { state: "launching", port: 9222, error: "" } });
{
	const busyTree = render();
	const busy = walk(busyTree).find(isLabel("openWindowsChromeBusy"));
	assert.ok(busy, "while launching the button reads as busy");
	assert.equal(busy.props.disabled, true, "busy cannot be clicked twice");
}
serve({ windowsChromeStatus: { state: "off", port: 0, error: "" } });
// A read-only deployment disables it like every other control.
const writableBefore = form.writable;
tree = render({ writable: false });
assert.equal(walk(tree).find(isLabel("openWindowsChrome")).props.disabled, true, "read-only → disabled");
assert.ok(
	walk(tree).find((n) => n.type === "p" && n.props?.className === CLS("readOnly")),
	"a read-only deployment says so"
);
render({ writable: writableBefore });
// Clicking writes the trigger field (the same nonce idiom as every executable
// run) and stays busy until the Host's own run counter answers.
writes.length = 0;
const winTree = render();
walk(winTree).find(isLabel("openWindowsChrome")).props.onClick();
assert.equal(JSON.stringify(writes.map(([f]) => f)), JSON.stringify(["openWindowsChromeNonce"]), "the click writes the trigger nonce");
// The run answers with its own counter: the button leaves its busy overlay off a
// served change, not off a clock.
runAnswered({ windowsChromeStatus: { state: "connected", port: 9222, error: "" } });
await settled();

// healthy: no error dot
assert.equal(findDot(tree), undefined, "no status dot while healthy");
assert.equal(walk(tree).find(isNode("p", CLS("error"))), undefined, "no error paragraph while healthy");

// ── connect mode: the pill reads the connect address but stays openable ──
// A connect-mode flag means the bridge connects instead of launching, so the
// pill shows the connect address rather than a local executable it never ran —
// but the dropdown keeps working, so the rows stay editable while connected.
serve({
	carriesConnectionMode: true,
	effectiveChromePath: "/usr/bin/google-chrome",
	chromeVersion: "",
	windowsChromeStatus: { state: "off", port: 0, error: "" }
});
const cmTree = render();
const cmPill = findPill(cmTree);
assert.equal(cmPill.props.disabled, false, "connect mode leaves the pill openable — connect is not a lock on the saved rows");
assert.equal(cmPill.props.children[0].props.children, "connectModeLabel", "the pill reads connect mode, not the local selection");
{
	const hint = walk(cmTree).find((n) => n.type === "div" && n.props?.className === CLS("fieldDesc") && n.props.children === "connectModeHint");
	assert.ok(hint, "the picker explains connect mode in place of the local hint");
}
serve({ carriesConnectionMode: false });

// The mirror's answer is not the only thing the pill asks. A connect entry in the
// **saved flags** is what the bridge launches with — the same precedence the flags
// rows edit — and it is a real config field, never erased by the reset window a
// write pass leaves behind. So while the saved flags carry one, the pill states
// connect mode even where the live answer has gone quiet (measured live 2026-10-13:
// after **Prelaunch Windows Chrome** the pill fell back to the saved executable
// name while `windowsChromeStatus` still answered `connected`, and a later
// unrelated save turned connect mode back on by itself).
serve({
	carriesConnectionMode: false,
	extraFlags: ["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9222"],
	effectiveChromePath: "/usr/bin/google-chrome"
});
{
	const savedTree = render();
	const savedConnect = findPill(savedTree);
	assert.equal(savedConnect.props.children[0].props.children, "connectModeLabel", "a saved connect entry answers connect mode when the mirror has not answered");
	const hint = walk(savedTree).find((n) => n.type === "div" && n.props?.className === CLS("fieldDesc") && n.props.children === "connectModeHint");
	assert.ok(hint, "and the picker says so the same way it does for the mirror's answer");
}

// The same predicate the Host's mirror and the probe skip key on, spelled out:
// `--browserUrl=` and `--wsEndpoint`, and nothing that merely looks like them.
serve({ extraFlags: ["--no-usage-statistics", "--wsEndpoint=ws://127.0.0.1:9222/devtools"] });
assert.equal(findPill(render()).props.children[0].props.children, "connectModeLabel", "the endpoint spelling answers connect mode too");
serve({ extraFlags: ["--no-usage-statistics", "--browserUrlish", "--nowWss"] });
assert.notEqual(findPill(render()).props.children[0].props.children, "connectModeLabel", "a flag that only looks like a connect entry is not connect mode");
serve({ extraFlags: ["--no-usage-statistics", "--no-performance-crux"], effectiveChromePath: "" });

// ── the saved rows ────────────────────────────────────────────────────────
// One row per saved executable: the id is what goes on the wire, the name is
// what the card shows. A row whose probe failed is tagged in the list. There is
// no "auto" entry to look for.
serve({
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
tree = render();
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
// A row carries no status of its own: the answers the Host's run gives live in
// the dialog the fetch action opens, the same shape the reference card uses.
assert.equal(
	walk(tree).filter((n) => String(n.props?.className ?? "").startsWith(CLS("rowStatus"))).length,
	0,
	"no inline status line under a row"
);

// A Windows executable the host offers *without* probing it: no version, no
// failure, only the note that names the run driving it. Selecting it is exactly
// what the card should let the user do, so the option reads as selectable, not
// tagged unrunnable — the tag belongs to a probe that failed.
serve({
	executables: [{ id: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", name: "Windows Chrome" }],
	executableStatus: [
		{
			path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			version: "",
			error: "",
			note: "Windows chrome.exe cannot be launched from WSL — run Prelaunch Windows Chrome to drive it in connect mode"
		}
	],
	effectiveChromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	effectiveSource: "selected"
});
tree = render();
assert.equal(
	JSON.stringify(menuProps.at(-1).items.map((item) => item.label)),
	JSON.stringify(["Windows Chrome"]),
	"a note-carrying executable reads as a selectable option, not a failed probe"
);

// What runs is always offered, even when it is not (or is no longer) a saved
// row: a Host-seeded path, or one the row config alone carries.
serve({ executables: [], effectiveChromePath: "/opt/chrome", effectiveSource: "row-config" });
tree = render();
const fallbackMenu = menuProps.at(-1);
assert.equal(
	JSON.stringify(fallbackMenu.items.map((item) => item.id)),
	JSON.stringify(["/opt/chrome"]),
	"what runs is offered even without a row"
);
assert.equal(findPill(tree).props.children[0].props.children, "/opt/chrome", "with no name saved the pill shows the path");
serve({ effectiveSource: "selected" });

// ── a live answer that has not landed is not a reverted pick ─────────────
// A config write recomposes the row's config, and a recomposition answers the
// live-only fields with their opening answers — nothing in the row persists them.
// So `effectiveChromePath` can read empty for a moment while the saved selection
// stands exactly where the user left it. A card that read that as "no executable
// detected" is a pick that had landed reading as a reverted pick (measured live
// 2026-10-12), so what the mirror has not answered is answered by the saved
// selection — that is what the bridge will run.
serve({ effectiveChromePath: "", effectiveSource: "", chromePath: "/nonexistent-dir/kept-pick" });
tree = render();
assert.equal(
	findPill(tree).props.children[0].props.children,
	"/nonexistent-dir/kept-pick",
	"an unanswered mirror states the saved selection, not nothing selected"
);
assert.equal(
	findPill(tree).props.title,
	"/nonexistent-dir/kept-pick",
	"and the pill's tooltip names the same path it states"
);
// A selection the host must never exec is the one case where an empty effective
// path *is* the answer: WSL host, Windows executable, nothing local launches.
// The mirror's own flag keeps that reading instead of the saved path.
serve({
	effectiveChromePath: "",
	effectiveSource: "",
	chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	wslWindowsExecutable: true
});
assert.equal(
	findPill(render()).props.children[0].props.children,
	"executableNone",
	"a blocked selection still invites a pick — nothing local would run"
);
serve({ effectiveChromePath: "", effectiveSource: "", chromePath: "", wslWindowsExecutable: false });
assert.equal(
	findPill(render()).props.children[0].props.children,
	"executableNone",
	"and a host with nothing saved still invites one"
);

// ── a live answer that has not landed is not a reverted notice ───────────
// The same recomposition that empties the effective path answers the WSL
// + Windows-executable flag false, which would blink the notice off and back
// on with every write (measured live: a notice that appears and drops off
// again). The flag reads false for a reason the card cannot tell apart — "no
// Windows executable is selected" is what a real answer says; the reset is
// "not answered yet" — so the last answer stands for as long as the Host has
// not answered the selection, and only a real false drops it.
{
	const WSL_PICK = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
	serve({ effectiveChromePath: "", effectiveSource: "", chromePath: WSL_PICK, wslWindowsExecutable: true });
	assert.equal(findNotice(render()) !== undefined, true, "the notice stands while the Host reports the blocked selection");
	// The moment after a config write: every live answer reads back as its
	// opening answer, and the saved selection stands.
	serve({ effectiveChromePath: "", effectiveSource: "", chromePath: WSL_PICK, wslWindowsExecutable: false });
	assert.equal(findNotice(render()) !== undefined, true, "the reset keeps the notice instead of dropping it");
	// …and the pill keeps stating that same selection. The hold stands the
	// notice up, never the path: a pill that blanks during the write's own reset
	// window is a selection the user never dropped, lost on every save (measured
	// live 2026-10-12 — the Host answers the Windows path itself once it answers
	// at all, so the blank was only ever the reset reading as an answer).
	assert.equal(
		findPill(render()).props.children[0].props.children,
		WSL_PICK,
		"the reset states the saved selection, not nothing selected"
	);
	// Once the Host answers with something it *can* run, the false is an
	// answer, not a gap.
	serve({ effectiveChromePath: "/usr/bin/google-chrome", effectiveSource: "selected", chromePath: "/usr/bin/google-chrome", wslWindowsExecutable: false });
	assert.equal(findNotice(render()) === undefined, true, "a false that answers a runnable selection drops the notice");
	serve({ effectiveChromePath: "", effectiveSource: "", chromePath: "", wslWindowsExecutable: false });
}

// ── picking an executable is an immediate write ──────────────────────────
// The selection drives the bridge's own restart, so it is written on the click
// and never staged.
menuProps.length = 0;
findPill(render()).props.onClick();
tree = render();
const opened = menuProps.at(-1);
assert.equal(opened.open, true, "clicking the pill opens the list");
serve({ executables: [{ id: "/usr/bin/google-chrome", name: "system" }, { id: "/home/u/chrome", name: "" }] });
tree = render();
walk(tree);
const opened2 = menuProps.at(-1);
writes.length = 0;
opened2.onSelect("/home/u/chrome");
assert.ok(
	writes.some(([f, v]) => f === "chromePath" && v === "/home/u/chrome"),
	"picking a saved path writes chromePath straight away"
);
await settled();
// What runs is what the Host answers with, and a no-op pick is not a write.
serve({
	chromePath: "/home/u/chrome",
	effectiveChromePath: "/home/u/chrome",
	effectiveSource: "selected"
});
writes.length = 0;
await face.selectExecutable("/home/u/chrome");
assert.equal(writes.length, 0, "picking what already runs writes nothing");
await face.selectExecutable("   ");
assert.equal(writes.length, 0, "an unusable path writes nothing");

// ── editing the rows ─────────────────────────────────────────────────────
// Rows are what the Host's next run reads, so a settled edit is an immediate
// whole-list write. Typing does not persist on every keystroke: the list lands
// once the edit settles (blur or Enter).
serve({
	executables: [
		{ id: "/usr/bin/google-chrome", name: "system" },
		{ id: "/home/u/chrome", name: "" }
	],
	executableStatus: [],
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected"
});
tree = render();
writes.length = 0;
// The stub does not re-render on setState, so the rows are re-rendered by hand —
// the blur handler must close over the draft that was just typed.
rowInputs(render())[1].props.onChange({ target: { value: "browser" } });
rowInputs(render())[1].props.onBlur();
await settled();
assert.equal(JSON.stringify(writes.map(([f]) => f)), JSON.stringify(["executables"]), "a settled edit writes once");
assert.equal(
	JSON.stringify(writes[0][1].map((row) => row.name)),
	JSON.stringify(["browser", ""]),
	"the edit lands in the rows without touching their paths"
);
// A delete is structural: it persists immediately, and it deletes the row its
// control sits on — the list order is the saved order.
writes.length = 0;
serve({ executables: [{ id: "/usr/bin/google-chrome", name: "system" }, { id: "/home/u/chrome", name: "" }] });
findTrash(render()).props.onClick();
await settled();
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
// What was committed comes back as the served list, so re-committing it writes
// nothing.
serve({ executables: [{ id: "/home/u/chrome", name: "" }] });
writes.length = 0;
rowInputs(render())[0].props.onBlur();
await settled();
assert.equal(writes.length, 0, "re-committing what is already saved changes nothing");
// "Add executable" is local until the row carries a path: an id-less row would
// be stripped, so the blank row only lands once it is typed in and committed.
writes.length = 0;
walk(render()).find(isLabel("addExecutable")).props.onClick();
assert.equal(writes.length, 0, "adding a blank row writes nothing yet");
rowInputs(render())[2].props.onChange({ target: { value: "/opt/chrome" } });
rowInputs(render())[2].props.onBlur();
await settled();
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
serve({
	executables: [
		{ id: "/home/u/chrome", name: "" },
		{ id: "/opt/chrome", name: "" }
	]
});

// ── the search action ─────────────────────────────────────────────────────
// A fetch writes the run trigger and opens its dialog over what the run answered
// for — read off the served mirror once it settles, never off a re-read.
serve({ executables: [], executableStatus: [], effectiveChromePath: "", effectiveSource: "", chromeVersion: "" });
writes.length = 0;
tree = render();
walk(tree).find(isLabel("fetchExecutables")).props.onClick();
await settled();
assert.equal(JSON.stringify(writes.map(([f]) => f)), JSON.stringify(["refreshExecutablesNonce"]), "searching writes the run trigger");
tree = render();
assert.ok(
	walk(tree).find((n) => n.type === "p" && n.props?.className === CLS("result") && n.props.children === "probing"),
	"a run in flight is visible on the probe line"
);
// The run answers: its counter moves and its per-path answers come back.
const fetchedStatuses = [
	{ path: "/usr/bin/google-chrome", version: "Google Chrome 139.0.7258.0", error: "" },
	{ path: "/home/u/chrome", version: "Google Chrome 138.0.0.0", error: "" },
	{ path: "/broken/chrome", version: "", error: "executable not found: /broken/chrome" },
	// A Windows executable a WSL host offers without probing it: no version, no
	// failure — the note states why, and names the run that drives it.
	{
		path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		version: "",
		error: "",
		note: "Windows chrome.exe cannot be launched from WSL — run Prelaunch Windows Chrome to drive it in connect mode"
	}
];
runAnswered({
	executables: [
		{ id: "/usr/bin/google-chrome", name: "" },
		{ id: "/home/u/chrome", name: "" }
	],
	executableStatus: fetchedStatuses,
	chromePath: "/usr/bin/google-chrome",
	effectiveChromePath: "/usr/bin/google-chrome",
	effectiveSource: "selected"
});
await settled();
tree = render();
{
	const dialog = walk(tree).find(isNode("div", CLS("fetchDialog")));
	assert.ok(dialog, "the settled run opens the choose-to-add dialog");
	assert.equal(dialog.props.role, "dialog", "the dialog is announced as a dialog");
	const candidates = walk(dialog).filter((n) => n.type === "li" && n.props?.className === CLS("candidate"));
	assert.equal(candidates.length, 4, "one candidate row per path the run answered for");
	const notes = walk(dialog)
		.filter((n) => n.type === "span" && n.props?.className === CLS("candidateNote"))
		.map((n) => n.props.children);
	assert.equal(
		JSON.stringify(notes),
		JSON.stringify([
			"Google Chrome 139.0.7258.0",
			"Google Chrome 138.0.0.0",
			"executable not found: /broken/chrome",
			"Windows chrome.exe cannot be launched from WSL — run Prelaunch Windows Chrome to drive it in connect mode"
		]),
		"every row carries what the run said about it — a version, a failure, or the note that says why nothing did"
	);
	const checks = walk(dialog).filter((n) => n.type === "input" && n.props?.type === "checkbox");
	assert.equal(checks.length, 4, "one checkbox per candidate");
	assert.equal(checks[0].props.checked, true, "a path the rows already carry reads saved");
	assert.equal(checks[0].props.disabled, true, "and cannot be unchecked here — removal is the row's delete control");
	assert.equal(checks[3].props.disabled, false, "an executable offered without being probed is still offered for adding");
	assert.ok(walk(dialog).find(isLabel("selectAll")), "select-all rides the dialog's own toolbar");
	assert.ok(walk(dialog).find(isLabel("addSelected")), "add-selected is the dialog's action");
	assert.ok(walk(dialog).find(isLabel("cancel")), "cancel leaves the catalog untouched");
	// A search field sifts long path lists.
	const searchField = walk(dialog).find(isNode("input", CLS("candidateSearch")));
	searchField.props.onChange({ target: { value: "broken" } });
	tree = render();
	assert.equal(
		walk(tree).filter((n) => n.type === "li" && n.props?.className === CLS("candidate")).length,
		1,
		"the search field sifts the list"
	);
	searchField.props.onChange({ target: { value: "zzz" } });
	tree = render();
	assert.ok(walk(tree).find(isNode("p", CLS("empty"))), "nothing matches the search");
	searchField.props.onChange({ target: { value: "" } });
	tree = render();
	// "Cancel" closes the dialog and writes nothing — the catalog is untouched.
	writes.length = 0;
	walk(render()).find(isLabel("cancel")).props.onClick();
	await settled();
	assert.equal(writes.length, 0, "cancel writes nothing");
}
// A second search writes the trigger once more, and picking what the dialog
// offers merges into the rows as one whole-list write.
writes.length = 0;
walk(render()).find(isLabel("fetchExecutables")).props.onClick();
await settled();
assert.ok(writes.some(([f]) => f === "refreshExecutablesNonce"), "re-running the search writes the trigger once more");
runAnswered({ executableStatus: fetchedStatuses });
await settled();
const dialog2 = walk(render()).find(isNode("div", CLS("fetchDialog")));
assert.ok(dialog2, "the settled run reopens the dialog");
// The dialog hands back what was ticked: the saved paths read ticked and
// disabled, so ticking what is missing is the one thing that changes the list.
const boxes = walk(render()).filter((n) => n.type === "input" && n.props?.type === "checkbox");
boxes[2].props.onChange({ target: { checked: true } });
writes.length = 0;
walk(render()).find(isLabel("addSelected")).props.onClick();
await settled();
assert.equal(
	JSON.stringify(writes.map(([f]) => f)),
	JSON.stringify(["executables"]),
	"picking the dialog's paths writes the whole list once"
);
assert.equal(
	JSON.stringify(writes[0][1].map((row) => row.id)),
	JSON.stringify(["/usr/bin/google-chrome", "/home/u/chrome", "/broken/chrome"]),
	"what the dialog offered merges in behind what the rows already carry"
);
serve({
	executables: [
		{ id: "/usr/bin/google-chrome", name: "" },
		{ id: "/home/u/chrome", name: "" },
		{ id: "/broken/chrome", name: "" }
	]
});

// ── the probe result line ────────────────────────────────────────────────
// A run that answers with the version already on screen leaves nothing else to
// look at, so the line reads the version and ages it off the card's own clock.
serve({ chromeVersion: "Google Chrome 139.0.7258.0" });
tree = render();
{
	const line = resultLine(tree);
	assert.ok(line, "the run's answer for the selection reads as its own line");
	assert.equal(line.props.children[0], "versionLabel", "the line names what it answers");
	assert.equal(line.props.children[1].props.children, "Google Chrome 139.0.7258.0", "it quotes the version");
}
serve({ chromeVersion: "" });
assert.equal(resultLine(render()), undefined, "no version answered → no result line");

// ── the error line ───────────────────────────────────────────────────────
// With no header of ours to carry a dot, one body line reports what went wrong:
// the dot leading it, then the failure itself.
serve({ lastError: "Could not find Chrome (ver. 139.0.7258.0)" });
tree = render();
{
	const line = errorLine(tree);
	assert.ok(line, "a captured failure reads as the body's status line");
	assert.equal(line.props.role, "status", "the line announces itself as status");
	const dot = findDot(tree);
	assert.ok(dot, "the failure leads with the red dot");
	assert.equal(dotState(dot), "error", "the dot reads as an error");
	assert.equal(dot.props["aria-label"], "statusError", "and says so for assistive tech");
	assert.equal(dot.props.title, "Could not find Chrome (ver. 139.0.7258.0)", "the tooltip holds the whole message");
	assert.equal(line.props.children[1], "Could not find Chrome (ver. 139.0.7258.0)", "the line states what failed");
}
// A failing host run reports through the same line: what the controller holds as
// its own action failure is folded into what the line carries, so the failure has
// one place to be read, never two paragraphs.
// The known "executable not found" state: with no error text to quote the line
// carries the short label, and the dot stays red.
serve({ lastError: "", chromeMissing: true });
tree = render();
{
	const line = errorLine(tree);
	assert.ok(line, "the missing-executable state reads on the status line");
	assert.equal(line.props.children[1], "chromeMissing", "the short label stands for the whole state");
	const dot = findDot(tree);
	assert.equal(dotState(dot), "error", "the missing-executable flag keeps the dot red");
	assert.equal(dot.props.title, "chromeMissing", "and the tooltip reads the short label");
}
serve({ chromeMissing: false, lastError: "" });
assert.equal(errorLine(render()), undefined, "nothing reported → no status line");

// ── the idle card schedules no poll timer ────────────────────────────────
// Every live answer arrives through the form's own subscription, so nothing
// here re-reads on a clock. The one timer the bundle is allowed to arm is the
// settle deadline behind a host-run action (./wait.ts) — an idle card, or a
// settled write, schedules nothing.
{
	const armedBefore = sandboxTimers.size;
	render();
	await settled();
	assert.equal(sandboxTimers.size, armedBefore, "rendering and settling a write schedule no timer of any kind — live state pushes, it is never polled");
}

// ── the page hands its own form handle ───────────────────────────────────
// A `view: "page"` render arrives with the page's own form: the same mirror,
// its own write door, so the card's edits share the page's fence instead of
// racing it. Adopting happens in the effect that follows a render — so the door
// stands only for as long as the page hands that form, and a render that hands
// none back stands the shared form in again.
const pageWrites = [];
const pageFences = [];
const pageForm = {
	state: { status: "ready", value: formValue, revision: form.revision, writable: true },
	mutate: (ops, revision) => {
		pageFences.push(revision);
		for (const op of ops) if (op.op !== "unset") pageWrites.push([op.path.join(".") || "(root)", op.value]);
		return Promise.resolve(true);
	}
};
// Stage through the page shape, then apply without leaving that shape.
const staged = () => render(undefined, { view: "page", form: pageForm, t: (key) => key });
render(undefined, { view: "page", form: pageForm });
writes.length = 0;
pageWrites.length = 0;
face.saveFlags(["--page-door"]);
await settled();
findFooterApply(staged()).props.onClick();
await settled();
assert.equal(writes.length, 0, "while the page's form stands, the shared form writes nothing");
assert.equal(
	JSON.stringify(pageWrites.map(([f]) => f)),
	JSON.stringify(["extraFlags"]),
	"the staged edit lands through the page's own door"
);
assert.equal(JSON.stringify(pageWrites[0][1]), JSON.stringify(["--page-door"]), "the staged list is what lands");
assert.ok(pageFences.length > 0, "the page's door carried the write");
assert.ok(pageFences.every((revision) => revision === undefined),
	"and the card handed it no revision of its own — the page's form fences on what it mirrors");
// The same card, rendered without a form of the page's own, stands the shared
// form's door back in.
render(undefined, { view: "page", form: undefined });
writes.length = 0;
pageWrites.length = 0;
face.saveFlags(["--shared-door"]);
await settled();
findFooterApply(render()).props.onClick();
await settled();
assert.equal(writes.length, 1, "the next staged edit takes the shared door again");
assert.equal(pageWrites.length, 0, "and the page's door is closed");
serve({ extraFlags: ["--shared-door"] });

// ── the dropdown over a Host that keeps answering ────────────────────────
// The regression this pins: picking an executable on a Host that is answering —
// the run it just started probes the selection, restarts the connection for it
// and reports what it found — used to come back refused every time and land
// nowhere. The whole form then read as reset: nothing was persisted, so every
// field fell back to what the Host had been answering, and the pill went back to
// the path it had before the pick. The door below answers exactly that way: a
// pass carrying a revision comes back refused until that revision is the one the
// Host holds, and the Host holds a new one every pass. A card that hands no
// revision, and is re-issued against the read that answered it, still lands.
let liveRevision = 5;
const liveWrites = [];
const liveForm = {
	getSnapshot: () => ({ status: "ready", value: formValue, revision: liveRevision, writable: true }),
	subscribe: () => () => {},
	mutate: (ops, revision) => {
		if (revision !== undefined && revision !== liveRevision) return Promise.resolve(false);
		for (const op of ops) if (op.op !== "unset") liveWrites.push([op.path.join(".") || "(root)", op.value]);
		liveRevision += 1;
		notifyForm();
		return Promise.resolve(true);
	}
};
render(undefined, { view: "page", form: liveForm });
writes.length = 0;
const picked = face.selectExecutable("/nonexistent-dir/selected-under-churn");
// The write is crossing the wire while the Host answers: serve what the run it
// started reports back, which is what settles the pick.
serve({ executableDiscoveryRevision: formValue.executableDiscoveryRevision + 1 });
await picked;
assert.equal(JSON.stringify(liveWrites.map(([f]) => f)), JSON.stringify(["chromePath"]),
	"the selection reaches a Host that keeps answering");
assert.equal(storeState.failed, false, "and it is not reported as a failure");
render(undefined, { view: "page", form: undefined });

// ── the settle deadline: a host that answers nothing still answers ───────
// The two host-run actions are settled by the mirror — but a host that moves
// no counter must not hold the card busy forever. The wait carries a wall-clock
// deadline (RUN_SETTLE_TIMEOUT_MS): on expiry the promise resolves, nothing
// re-runs, and one `stall` notice is staged for the body-mounted toast host.
{
	// Nothing should be left armed by the sections above — every earlier wait
	// settled off the mirror. Drain and clear defensively either way.
	runPendingTimers();
	await settled();
	if (storeState.notice !== null) face.clearNotice(storeState.notice.seq);
	assert.equal(sandboxTimers.size, 0, "no timer stands armed while the card is idle");

	serve({
		lastError: "",
		chromeMissing: false,
		executableDiscoveryRevision: formValue.executableDiscoveryRevision + 1
	});
	writes.length = 0;
	const stallPromise = face.refreshExecutables();
	await settled();
	assert.ok(
		writes.some(([field]) => field === "refreshExecutablesNonce"),
		"the fetch trigger reached the Host before the wait expired"
	);
	assert.equal(sandboxTimers.size, 1, "the un-answered wait armed exactly one deadline timer");
	runPendingTimers();
	await stallPromise;
	await settled();
	assert.equal(writes.filter(([field]) => field === "refreshExecutablesNonce").length, 1, "the stall path re-runs nothing");
	assert.ok(storeState.notice !== null && storeState.notice.kind === "stall", "the stalled wait staged one stall notice");
	assert.equal(storeState.notice.text, "", "a stall carries no host line of its own");
	// The only clock left standing is the toast's own dismissal.
	assert.equal(sandboxTimers.size, 1, "one timer stands: the toast's dismissal, not a re-run");
	face.clearNotice(storeState.notice.seq);
	assert.equal(storeState.notice, null, "the controller dismisses the staged notice");
	assert.equal(sandboxTimers.size, 0, "and its dismissal clock goes with it");
}

// ── the body-mounted failure-toast host ──────────────────────────────────
// The notice is announced by the toast host mounted at `document.body`, not by
// the row card — the row page only lives while the user has the Plugins row
// open, and a failure that lands elsewhere in the app must read immediately.
{
	serve({ chromeMissing: false });
	if (storeState.notice !== null) face.clearNotice(storeState.notice.seq);
	assert.equal(shownToast(), undefined, "the idle host shows no toast");

	cardController.noteNotice("stall", "");
	let toast = shownToast();
	assert.ok(toast, "the host surfaces a toast without the row page rendering");
	assert.equal(toast.textContent, "toastStall", "a silent stall reads the locale copy");

	serve({ chromeMissing: true });
	toast = shownToast();
	assert.equal(toast.textContent, "chromeMissing", "with the known missing-executable flag standing, the stall reads that line instead");
	serve({ chromeMissing: false });

	cardController.noteNotice("error", "Chrome executable not found: /nope");
	toast = shownToast();
	assert.equal(toast.textContent, "Chrome executable not found: /nope", "an error notice carries the Host's own line");
	toast.onclick();
	assert.equal(storeState.notice, null, "the toast's own dismiss clears through the controller");

	cardController.noteNotice("stall", "");
	const liveSeq = storeState.notice.seq;
	face.clearNotice(liveSeq - 1);
	assert.ok(storeState.notice !== null, "clearNotice with a stale seq leaves the live notice alone");
	face.clearNotice(liveSeq);
	assert.equal(storeState.notice, null, "clearNotice with the live seq clears");

	cardController.noteNotice("error", "dup");
	const toastNode = (t) => walk(t).find((n) => n.props && n.props["data-toast-text"] !== undefined);
	tree = render();
	assert.equal(toastNode(tree), undefined, "the card never renders the toast — only the body host does");
	assert.equal(toastRootNodes()[0].children.length, 1, "one toast per pending notice");
	face.clearNotice(storeState.notice.seq);
}

// ── disposal releases every subscription ─────────────────────────────────
// Handing the card back must release what it took from the form: a gone card
// publishes nothing, so a later served revision never arrives through it. The
// `then` that follows a write still re-checks this, because an accepted write
// can settle after the card is already gone.
const beforeDispose = JSON.stringify(storeState);
for (const dispose of effectDisposers.splice(0)) dispose();
serve({ chromeVersion: "Google Chrome 150.0.0.0", executables: [{ id: "/nonexistent-dir/chrome", name: "" }] });
await settled();
assert.equal(JSON.stringify(storeState), beforeDispose, "a disposed card publishes nothing more");
