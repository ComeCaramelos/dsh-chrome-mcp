// Materializes lib/client.js in a stubbed browser environment (the same
// window.__ModuleLoader__.load contract the shell's module system uses) and
// exercises the card: registration, snapshot projection, and render tree.
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
const mountedContainers = [];
const document = {
    querySelector: () => null,
    createElement: (tag) => ({
        tag,
        dataset: {},
        textContent: "",
        hidden: false,
        remove() {},
        setAttribute() {}
    }),
    body: {
        children: [],
        appendChild: (el) => (document.body.children.push(el), mountedContainers.push(el))
    },
    head: { appendChild: (el) => styles.push(el) }
};
// Stateful useState: the card keeps `open` across re-renders, so the stub
// must persist hook values by call slot. Renders reset the slot index.
let hookStates = [];
let hookIndex = 0;
let lastHookCount = null;
const react = {
    // The toast host subscribes to the store through the standard hook — in
    // this harness the render is manual, so reading the snapshot is enough.
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    createElement: (type, props) => ({ type, props }),
    useId: () => ":r1:",
    useState: (init) => {
        const i = hookIndex++;
        if (!(i in hookStates)) hookStates[i] = typeof init === "function" ? init() : init;
        const set = (next) => {
            hookStates[i] = typeof next === "function" ? next(hookStates[i]) : next;
        };
        return [hookStates[i], set];
    },
    useEffect: () => {}
};
function materialize(type, props, key, kind) {
    const node = { kind, type, props, key, children: props?.children };
    // React calls function components; the stub must too, or the
    // primitives.Menu subtree (anchor + items) would never materialize.
    if (typeof type === "function") {
        const rendered = type(props);
        if (rendered === null || rendered === void 0) {
            node.type = undefined;
            node.props = undefined;
            node.children = undefined;
        } else {
            node.type = rendered.type;
            node.props = rendered.props;
            node.children = rendered.children;
        }
    }
    return node;
}
const jsxRuntime = {
    jsx: (type, props, key) => materialize(type, props, key, "jsx"),
    jsxs: (type, props, key) => materialize(type, props, key, "jsxs")
};
// Menu primitive stub: renders the anchor, and while open the items as
// menuitem buttons (the real primitive portals a positioned role=menu list).
const primitives = {
    // Minimal toast stand-in: no hooks/portals, but keeps the element findable
    // by its role and text so the failure-toast render path is assertable.
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
    IconWarningOutline16: { displayName: "IconWarningOutline16" },
    Menu: (props) => ({
        kind: "jsx",
        type: "Menu",
        props,
        children: [
            props.anchor,
            ...(props.open
                ? [props.items.map((item) => ({
                        kind: "jsx",
                        type: "button",
                        props: {
                            "data-menu-item": item.id,
                            "aria-current": item.id === props.selectedId ? "true" : undefined,
                            onClick: () => props.onSelect(item.id)
                        }
                    }))]
                : [])
        ]
    })
};

const storeState = {
    available: false,
    writable: false,
    profile: "",
    profiles: [],
    lastRefreshError: "",
    discoveryRevision: 0,
    actionError: "",
    notice: null
};
const listeners = new Set();
const clientStore = {
    createSnapshotStore: (initial) => ({
        getSnapshot: () => storeState,
        subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
        set: (next) => Object.assign(storeState, next)
    })
};
const toastRoots = [];
const reactDomClient = {
    createRoot: (container) => {
        const root = {
            container,
            element: null,
            renderCount: 0,
            unmountCount: 0,
            render(element) {
                root.element = element;
                root.renderCount += 1;
            },
            unmount() {
                root.unmountCount += 1;
            }
        };
        toastRoots.push(root);
        return root;
    }
};
const requireStub = (spec) => {
    if (spec === "react") return react;
    if (spec === "react/jsx-runtime") return jsxRuntime;
    if (spec === "@deepseek-ai/dsh-client-store") return clientStore;
    if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
    if (spec === "react-dom/client") return reactDomClient;
    throw new Error(`unexpected require: ${spec}`);
};

// ── materialize ──────────────────────────────────────────────────────────
// setTimeout/clearTimeout stand in for the browser globals the refresh poll
// schedules against (the real bundle runs in a page). The poll's 15 s cadence
// makes real waiting impractical in a unit test, so these route through a
// controllable queue the test flushes on demand.
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
    clearTimeout: sandboxClearTimeout
});
assert.ok(registration, "bundle registered with __ModuleLoader__");
assert.equal(registration.id, "@comecaramelos/dsh-docker-desktop-mcp");
const factoryResult = registration.factory(requireStub);
assert.equal(typeof factoryResult.apply, "function", "exports.apply");
assert.equal(JSON.stringify(factoryResult.inject), JSON.stringify(["slots", "locale", "settingsScope"]), "exports.inject");
assert.equal(factoryResult.DISCOVERY_POLL_MAX_TICKS, 5, "discovery poll attempt cap (no infinite retry loop)");
assert.equal(factoryResult.DISCOVERY_POLL_TICK_MS, 15000, "poll tick cadence exported");
assert.ok(factoryResult.DISCOVERY_POLL_MAX_TICKS * factoryResult.DISCOVERY_POLL_TICK_MS >= factoryResult.DISCOVERY_POLL_TIMEOUT_MS, "attempt cap covers the wall-clock budget");
assert.equal(styles.length, 1, "one style tag injected");
assert.ok(styles[0].dataset.pluginCss === "@comecaramelos/dsh-docker-desktop-mcp/DockerMcpCard.module.css");

// ── settings scope stub ──────────────────────────────────────────────────
const scopeSnapshot = {
    status: "ready",
    value: {
        profile: "default",
        profiles: ["alpha", "beta"],
        refreshNonce: 0,
        lastRefreshError: "",
        discoveryRevision: 0
    },
    writable: true,
    revision: 1
};
const writes = [];
let rejectNextProfileWrite = false;
const scope = {
    getSnapshot: () => scopeSnapshot,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    set: (field, value) => {
        if (field === "profile" && rejectNextProfileWrite) {
            rejectNextProfileWrite = false;
            return Promise.reject(new Error("write rejected by host"));
        }
        writes.push([field, value]);
        scopeSnapshot.value = { ...scopeSnapshot.value, [field]: value };
        listeners.forEach((fn) => fn());
        return Promise.resolve();
    }
};
// Shared describe-mirror stub: the refresh action re-reads it while the
// host's in-memory discovery state is en route. Bump the served
// discoveryRevision to let a poll settle.
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
        return { dispose: () => disposer?.dispose?.() ?? disposer?.() }
    },
    locale: {
        register: (ns, dicts) => {
            assert.equal(ns, "dockerDesktopMcp");
            assert.ok(dicts.en);
            var required = ["title", "description", "profileLabel", "hint", "refresh", "refreshing", "readOnly", "empty", "statusMissing", "statusError", "statusUnreachable", "expand", "collapse"];
            var enKeys = Object.keys(dicts.en).sort();
            assert.equal(JSON.stringify(enKeys), JSON.stringify(required.slice().sort()), "en key set");
            for (var i = 0; i < required.length; i++) {
                assert.ok(required[i] in dicts.en, "en has key: " + required[i]);
            }
        },
        bind: () => (key) => key
    },
    settingsScope: {
        bind: (spec) => (assert.equal(spec.namespace, "docker-desktop-mcp"), scope),
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
assert.equal(options.key, "docker-desktop-mcp");
assert.equal(options.locale, "dockerDesktopMcp");
assert.equal(typeof Component, "function");

// ── B.0: boot mirror poll (regression) ─────────────────────────────────
// The host runs profile discovery when it registers the settings section,
// usually while this card is still mounting, and that base-layer bump never
// travels on the wire. A freshly mounted card must therefore re-read the
// shared describe mirror on its own — without it the card reads "Profile not
// found" until the user clicks Refresh.
{
    const bootLoads = mirror.loadCalls;
    runPendingTimers();
    await Promise.resolve();
    assert.ok(mirror.loadCalls > bootLoads, "mount schedules a silent mirror poll (no refresh click)");
}

// ── B.0b: attempt cap settles the boot poll (regression) ────────────────
// Without an advancing discoveryRevision (e.g. the docker CLI is missing and
// the host never bumps the revision), the poll must stop at the attempt cap
// instead of re-arming forever.
{
    const loadsBefore = mirror.loadCalls;
    for (let i = 0; i < 8; i++) runPendingTimers();
    // ticks 2..4 load; tick 5 hits the cap and finishes without loading.
    assert.equal(mirror.loadCalls - loadsBefore, 3, "boot poll stops at the attempt cap");
    await Promise.resolve();
    assert.equal(sandboxTimers.size, 0, "no timers left armed once the cap settles the wait");
    // Exhausted attempts without ever connecting stage a one-shot notice —
    // the card surfaces it as a Toast.
    assert.ok(storeState.notice !== null && storeState.notice !== void 0, "exhausted wait stages a failure notice");
    assert.equal(storeState.notice.kind, "stall", "no revision advance at all reads as unreachable");
    assert.equal(storeState.notice.seq, 1, "the first notice gets seq 1");
    Object.assign(storeState, { notice: null });
}

// The toast host mounts on its own React root from apply(); re-invoking its
// component with the current store snapshot stands in for a live re-render.
function hostTree() {
    const root = toastRoots[0];
    return materialize(root.element.type, root.element.props, null, "jsx");
}

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
        useDockerMcpCard: (sel) => sel(state),
        selectProfile: (v) => scope.set("profile", v),
        refreshProfiles: () => scope.set("refreshNonce", 123)
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

// ── render helpers ────────────────────────────────────────────────────────
function findDot(t) {
    return walk(t).find((n) => n.type === "span" && String(n.props?.className ?? "").startsWith("dshdmc_dot "));
}
function dotState(dot) {
    return dot.props.className.includes("dshdmc_dotError") ? "error" : "none";
}

// ── render 1: unavailable ────────────────────────────────────────────────
Object.assign(storeState, { available: false });
let tree = render(storeState);
assert.equal(tree, null, "renders nothing while namespace is unavailable");

// ── render 2: available, collapsed by default ─────────────────────────────
Object.assign(storeState, {
    available: true,
    writable: true,
    profile: "default",
    profiles: ["alpha", "beta"],
    lastRefreshError: "",
    actionError: ""
});
tree = render(storeState);
assert.ok(tree && tree.type === "li", "card root is an li");
assert.equal(
    tree.props.className,
    "dshdmc_card",
    "no cardOpen class while collapsed"
);
const header = walk(tree).find(isNode("button", "dshdmc_header"));
assert.ok(header, "header disclosure button rendered");
assert.equal(header.props["aria-expanded"], false, "card collapsed by default");
assert.equal(header.props["aria-label"], "expand: title", "header aria-label names the action and card");
assert.ok(header.props["aria-controls"], "header has aria-controls");
assert.equal(walk(tree).find(isNode("button", "dshdmc_selector")), undefined, "body hidden while collapsed");
assert.equal(walk(tree).find(isNode("div", "dshdmc_body")), undefined, "body div absent while collapsed");
const closedChevron = walk(tree).find(isNode("svg", "dshdmc_chevron"));
assert.ok(closedChevron, "chevron rendered while closed");
// collapsed-state dot + body-absence assertions (B.2)
let dot = findDot(tree);
assert.ok(dot, "status dot always rendered in the card header");
assert.equal(dot.props.role, "img");
assert.equal(dotState(dot), "error", "red dot while the active profile is undiscovered");
assert.equal(dot.props["aria-label"], "statusMissing");
assert.equal(dot.props.title, "statusMissing");

// ── expand via the header button ──────────────────────────────────────────
header.props.onClick();
tree = render(storeState);
assert.ok(String(tree.props.className).includes("dshdmc_cardOpen"), "cardOpen class while expanded");
assert.equal(
    walk(tree).find(isNode("button", "dshdmc_header")).props["aria-expanded"],
    true,
    "aria-expanded flips open"
);
assert.ok(
    walk(tree).find(isNode("svg", "dshdmc_chevron dshdmc_chevronOpen")),
    "chevron gains the open class while expanded"
);
const nodes = walk(tree);
const menu = nodes.find((n) => n.type === "Menu");
assert.ok(menu, "Menu rendered once expanded");
assert.equal(menu.props.open, false, "menu closed by default");
assert.equal(JSON.stringify(menu.props.items), JSON.stringify([{ id: "alpha", label: "alpha" }, { id: "beta", label: "beta" }, { id: "default", label: "default" }]), "current profile appended when not discovered");
assert.equal(menu.props.selectedId, "default");
assert.equal(menu.props.align, "end");
assert.equal(menu.props.portal, true);
let selector = nodes.find(isNode("button", "dshdmc_selector"));
assert.ok(selector, "pill selector rendered once expanded");
assert.equal(selector.props["aria-haspopup"], "menu");
assert.equal(selector.props["aria-expanded"], false);
assert.equal(selector.props.disabled, false);
const selectorWrap = nodes.find(isNode("span", "dshdmc_selectorWrap"));
assert.ok(selectorWrap, "selector wrapper rendered");
assert.ok(walk(selectorWrap).some((x) => x.type === "Menu"), "Menu root sits inside the wrapper span");
const refresh = nodes.find(isNode("button", "dshdmc_button"));
assert.ok(refresh, "refresh button rendered");

// ── collapse-back test (B.3) ─────────────────────────────────────────────
// Use the header from the expanded tree so the onClick closure captures open=true
const expandedHeader = walk(tree).find(isNode("button", "dshdmc_header"));
expandedHeader.props.onClick();
tree = render(storeState);
assert.equal(walk(tree).find(isNode("button", "dshdmc_header")).props["aria-expanded"], false, "card collapses back (aria-expanded false)");
assert.ok(!String(tree.props.className).includes("dshdmc_cardOpen"), "cardOpen class removed on collapse");
assert.equal(walk(tree).find(isNode("div", "dshdmc_body")), undefined, "body div absent after collapse");
assert.equal(walk(tree).find(isNode("button", "dshdmc_selector")), undefined, "selector absent after collapse");
// re-expand for rest of the suite
const collapsedHeader2 = walk(tree).find(isNode("button", "dshdmc_header"));
collapsedHeader2.props.onClick();
tree = render(storeState);
assert.ok(String(tree.props.className).includes("dshdmc_cardOpen"), "card re-expanded");

// ── menu selection writes profile ───────────────────
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
selector.props.onClick();
tree = render(storeState);
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props["aria-expanded"], true, "menu opens");
const menuOpenNode = walk(tree).find((n) => n.type === "Menu");
assert.equal(menuOpenNode.props.open, true, "menu open state propagated");
const menuItemAlpha = walk(tree).find((n) => n.type === "button" && n.props["data-menu-item"] === "alpha");
assert.ok(menuItemAlpha, "menu items rendered while open");
menuItemAlpha.props.onClick();
assert.ok(writes.some(([f, v]) => f === "profile" && v === "alpha"), "menu selection writes profile");
tree = render(storeState);
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props["aria-expanded"], false, "menu closed after selection");

// ── refreshing lifecycle (B.4) ───────────────────────
// Re-find selector and refresh from current tree (stale after collapse-back)
let refreshBtn = walk(tree).find(isNode("button", "dshdmc_button"));
refreshBtn.props.onClick();
assert.ok(writes.some(([f, v]) => f === "refreshNonce" && v === 123), "refresh writes refreshNonce");
tree = render(storeState);
refreshBtn = walk(tree).find(isNode("button", "dshdmc_button"));
assert.equal(refreshBtn.props.children, "refreshing", "refresh button shows refreshing");
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props.disabled, true, "selector disabled while refreshing");
await Promise.resolve();
tree = render(storeState);
refreshBtn = walk(tree).find(isNode("button", "dshdmc_button"));
assert.equal(refreshBtn.props.children, "refresh", "refresh button back to refresh after flush");
selector = walk(tree).find(isNode("button", "dshdmc_selector"));
assert.equal(selector.props.disabled, false, "selector re-enabled after flush");

// ── controller write path test (B.5) ─────────────────────────────────────
const face = options.inject();
assert.equal(JSON.stringify(face.hooks.dockerMcpCard.getSnapshot()), JSON.stringify(storeState),
    "controller inject returns same snapshot store");
rejectNextProfileWrite = true;
await face.selectProfile("gamma");
tree = render(storeState);
dot = findDot(tree);
assert.equal(dot.props["aria-label"], "statusError", "dot aria-label short on action error");
assert.equal(dot.props.title, "write rejected by host", "dot title shows full error detail");
let errorP = walk(tree).find(isNode("p", "dshdmc_error"));
assert.ok(errorP, "error paragraph rendered after rejected write");
assert.equal(errorP.props.children, "write rejected by host", "error paragraph has rejection message");
// restore: one normal successful emit clears actionError → healthy → dot hidden
await face.selectProfile("alpha");
tree = render(storeState);
assert.equal(findDot(tree), undefined, "dot hidden again after successful emit (healthy)");
assert.ok(!walk(tree).find(isNode("p", "dshdmc_error")), "error paragraph gone after successful emit");

// ── controller refresh path (B.6) ─────────────────────────────────────────
// refreshProfiles writes a numeric refreshNonce, then polls the shared
// describe mirror until the host advances the served discoveryRevision
// (the host keeps the discovery state in its in-memory base layer and has
// no push channel, so the client owns the freshness).
const refreshLoadCallsBefore = mirror.loadCalls;
const refreshPromise = face.refreshProfiles();
assert.ok(
    writes.some(([f, v]) => f === "refreshNonce" && typeof v === "number"),
    "refresh writes a numeric refreshNonce"
);
assert.equal(mirror.loadCalls, refreshLoadCallsBefore, "no mirror re-read before the first poll tick");
// first poll tick fires (flushed from the sandbox queue, not real waiting)
runPendingTimers();
assert.ok(mirror.loadCalls >= refreshLoadCallsBefore + 1, "poll re-reads the settings mirror while the discovery runs");
scopeSnapshot.value = { ...scopeSnapshot.value, discoveryRevision: scopeSnapshot.value.discoveryRevision + 1 };
listeners.forEach((fn) => fn());
// next tick observes the advanced revision and finishes the wait
runPendingTimers();
await refreshPromise;
assert.equal(storeState.discoveryRevision, 1, "card store picked up the advanced discovery revision");

// ── options dedup (B.7) ───────────────────────────
// healthy state: profile "alpha" is in profiles ["alpha", "beta"]
tree = render(storeState);
const menuDedup = walk(tree).find((n) => n.type === "Menu");
assert.equal(JSON.stringify(menuDedup.props.items),
    JSON.stringify([{ id: "alpha", label: "alpha" }, { id: "beta", label: "beta" }]), "items deduped when profile among discovered ids");

// ── field label ──────────────────────────────────
const fieldTitle = walk(tree).find(isNode("div", "dshdmc_fieldTitle"));
assert.ok(fieldTitle, "profile field title rendered");
assert.equal(fieldTitle.props.children, "profileLabel");
assert.ok(walk(tree).find(isNode("div", "dshdmc_fieldDesc")), "profile field description rendered");

// ── status dot (credentialDot pattern) ───────────────────────────────────
// a discovery error takes the dot's aria-label + title
Object.assign(storeState, { lastRefreshError: "docker mcp profile list failed" });
dot = findDot(render(storeState));
assert.equal(dotState(dot), "error");
assert.equal(dot.props["aria-label"], "statusError");
assert.equal(dot.props.title, "docker mcp profile list failed");

// healthy: active profile discovered, no errors → dot hidden
Object.assign(storeState, { lastRefreshError: "", actionError: "" });
assert.equal(findDot(render(storeState)), undefined, "no dot while healthy");

// ── global failure toast (B.9) ─────────────────────────────────────────
// A discovery wait that ends without connecting stages a one-shot notice.
// It is announced by a body-mounted toast host (react-dom/client createRoot
// from apply), NOT by the settings card — the settings slot only lives while
// the user has Settings open, and a boot failure must be visible from
// anywhere. The card itself must never render a toast (one toast per notice).
{
    assert.equal(toastRoots.length, 1, "apply() mounts exactly one toast host root");
    assert.equal(mountedContainers.length >= 1, true, "the host root is appended to document.body");
    assert.equal(toastRoots[0].renderCount, 1, "the host renders once on mount");

    // with no notice staged, the host renders nothing (and without any card)
    let tree = hostTree();
    assert.equal(
        walk(tree).find((n) => n.props && n.props["data-toast-text"] !== undefined),
        undefined,
        "the idle host shows no toast"
    );

    // stall: notice staged, toast appears without touching the settings view
    Object.assign(storeState, { notice: { seq: 1, kind: "stall", text: "" } });
    tree = hostTree();
    let toast = walk(tree).find((n) => n.props && n.props["data-toast-text"] !== undefined);
    assert.ok(toast, "the host surfaces a toast without the settings card rendering");
    assert.equal(toast.props["data-toast-text"], "statusUnreachable", "stall text resolves through locale");

    // error kind: the host's discovery error surfaces verbatim
    Object.assign(storeState, { notice: { seq: 2, kind: "error", text: "Cannot connect to the Docker daemon" } });
    tree = hostTree();
    toast = walk(tree).find((n) => n.props && n.props["data-toast-text"] !== undefined);
    assert.equal(toast.props["data-toast-text"], "Cannot connect to the Docker daemon", "error notice surfaces the host message");

    // the toast's own onDone clears the notice through the controller
    toast.props.onDone();
    assert.equal(storeState.notice, null, "the toast's onDone clears the notice through the controller");
    tree = hostTree();
    assert.equal(
        walk(tree).find((n) => n.props && n.props["data-toast-text"] !== undefined),
        undefined,
        "a cleared notice drops the toast"
    );

    // clearNotice of an already-replaced notice (stale seq) is ignored
    Object.assign(storeState, { notice: { seq: 5, kind: "stall", text: "" } });
    face.clearNotice(1);
    assert.ok(storeState.notice !== null, "clearNotice with a stale seq leaves the current notice alone");
    face.clearNotice(5);
    assert.equal(storeState.notice, null, "clearNotice with the live seq clears");

    // regression: the settings card must not also render the toast (one per notice)
    Object.assign(storeState, { notice: { seq: 9, kind: "error", text: "dup" } });
    tree = render(storeState);
    assert.equal(
        walk(tree).find((n) => n.props && n.props["data-toast-text"] !== undefined),
        undefined,
        "the card never renders the toast — only the global host does"
    );
    Object.assign(storeState, { notice: null, lastRefreshError: "", actionError: "" });
}

console.log("client.test.mjs: all assertions passed");
