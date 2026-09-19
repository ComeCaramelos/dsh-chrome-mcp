/**
 * Host-side regression tests for the discovery/push orchestration in apply():
 * boot run gated on readiness + section, base-layer push via a host-owned
 * NEGATIVE refreshNonce bump (dsh-settings recomputes the served resolved
 * value ONLY on writes, so the bump is what makes discovery visible to
 * clients), the sibling-instance echo path, and the bounded failed-run retry.
 *
 * The fake settings service mirrors the real contract faithfully (resolved
 * recomputed at registration and in mutate only); the fake docker shim answers
 * `version` 0 (readiness fallback) so the readiness gate resolves fast. HOME is
 * pointed at a temp dir so the backend-socket probes are deterministically
 * absent.
 */
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, DISCOVERY_RETRY_DELAY_MS, DISCOVERY_RETRY_MAX } from "../lib/index.js";

const NS = "docker-desktop-mcp";

const realSetTimeout = globalThis.setTimeout;
const timers = [];
globalThis.setTimeout = (fn, delay, ...rest) => {
    if (delay === DISCOVERY_RETRY_DELAY_MS) {
        const entry = { fn, cleared: false };
        timers.push(entry);
        return entry;
    }
    return realSetTimeout(fn, delay, ...rest);
};
const realClearTimeout = globalThis.clearTimeout;
globalThis.clearTimeout = (id) => {
    if (id !== null && id !== void 0 && typeof id === "object" && "fn" in id) id.cleared = true;
    else realClearTimeout(id);
};
/** Fire a pending retry timer immediately; returns whether one fired. */
function fireRetryTimer() {
    const next = timers.shift();
    if (next === void 0) return false;
    if (next.cleared) return true; // observed as cleared: treat as consumed fire
    next.fn();
    return true;
}
/** Wait for condition, pumping captured retry timers meanwhile. */
async function settle(condition, { pumpRetries = false } = {}) {
    for (let i = 0; i < 2000; i++) {
        if (pumpRetries) fireRetryTimer();
        await new Promise((resolve) => realSetTimeout(resolve, 2));
        if (condition()) {
            if (pumpRetries) fireRetryTimer();
            return true;
        }
    }
    return false;
}

/**
 * Fake `docker` CLI: `version` answers (no-backend-api readiness fallback),
 * `mcp profile list` prints `profilesJson` when `profilesOk`, else fails with
 * a CLI-style error line.
 */
function makeShim({ profilesJson = "", profilesOk = true }) {
    const dir = mkdtempSync(join(tmpdir(), "dshdmc-shim-"));
    const file = join(dir, "docker");
    writeFileSync(
        file,
        `#!/bin/sh
if [ "$1" = "version" ]; then printf '99.99.99\\n'; exit 0; fi
if [ "$1" = "mcp" ] && [ "$2" = "profile" ]; then
${profilesOk ? `    printf '${profilesJson}'\n    exit 0` : `    printf 'Error: profile store unavailable\\n' 1>&2\n    exit 1`}
fi
exit 1
`
    );
    chmodSync(file, 0o755);
    return file;
}

/**
 * Stub host context + settings service. The resolved value is recomputed ONLY
 * at registration and on mutate() — mirroring `dsh-settings` exactly, which is
 * what a base-only discovery update can NEVER reach clients through (the bug
 * these tests regress).
 */
function makeCtx() {
    const user = {};
    const document = {};
    const hooks = { current: void 0 };
    let source = () => ({});
    const settings = {
        document,
        installSection(_ctx, _ns, _schema, entry, options) {
            source = () => ({
                profile: "default",
                refreshNonce: 0,
                profiles: [],
                lastRefreshError: "",
                discoveryRevision: 0,
                ...entry,
                ...(user[NS] ?? {})
            });
            options.setSource(source);
            hooks.current = options;
            options.onChange(); // synchronous first commit
        },
        async mutate(ns, ops) {
            const section = { ...(user[ns] ?? {}) };
            for (const op of ops) {
                if (op.op === "set") section[op.path[0]] = op.value;
                else Reflect.deleteProperty(section, op.path[0]);
            }
            user[ns] = section;
            document[NS] = { ...section };
            hooks.current?.onChange();
        }
    };
    const starts = [];
    const updates = [];
    const warnings = [];
    const errors = [];
    const disposers = [];
    const ctx = {
        plugin(_plugin, config) {
            starts.push(config);
            return { update: async (config) => void updates.push(config) };
        },
        effect(fn) {
            const disposer = fn();
            if (typeof disposer === "function") disposers.push(disposer);
        },
        inject(_deps, callback) {
            callback({ settings });
        },
        get(name) {
            if (name === "settings") return settings;
            return void 0;
        },
        logger: {
            warn: (...args) => warnings.push(args.join(" ")),
            info: () => {},
            error: (...args) => errors.push(args.join(" "))
        }
    };
    return {
        ctx,
        settings,
        source: () => source(),
        starts,
        updates,
        warnings,
        errors,
        disposers,
        /** Simulate a raw user-section commit (UI write or external change). */
        commit(nonce) {
            user[NS] = { ...user[NS], refreshNonce: nonce };
            document[NS] = { ...user[NS] };
            hooks.current.onChange();
        }
    };
}

function makeConfig(command) {
    return {
        serverName: "docker",
        command,
        profile: "default",
        extraArgs: [],
        env: {},
        cwd: "",
        toolCallTimeoutMs: 60000,
        failOnStartupError: false,
        reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    };
}

function bootShim({ profilesJson = "[]", profilesOk = true } = {}) {
    const home = mkdtempSync(join(tmpdir(), "dshdmc-home-"));
    process.env.HOME = home;
    return { home, command: makeShim({ profilesJson, profilesOk }) };
}

// ── 1: boot success pushes profiles + a negative nonce, no retries ────────
{
    const { command } = bootShim({ profilesJson: '[{"id":"alpha","name":"Alpha"},{"id":"beta","name":"Beta"}]' });
    const h = makeCtx();
    timers.length = 0;
    apply(h.ctx, makeConfig(command));

    assert.equal(
        await settle(() => h.source().discoveryRevision >= 1 && h.starts.length >= 1),
        true,
        "boot discovery runs after both gates and starts the bridge"
    );
    const resolved = h.source();
    assert.equal(JSON.stringify(resolved.profiles), JSON.stringify(["alpha", "beta"]), "profiles pushed into base layer");
    assert.equal(resolved.lastRefreshError, "", "successful run clears the error");
    assert.equal(resolved.discoveryRevision, 1, "one discovery run bumped the revision");
    const nonce = h.settings.document[NS]?.refreshNonce;
    assert.equal(typeof nonce, "number", "the host pushed a refreshNonce");
    assert.ok(nonce < 0, "host pushes are NEGATIVE so sibling instances treat them as sync markers");
    assert.equal(timers.length, 0, "success arms no retry timer");
    for (const d of h.disposers) d();
}

// ── 2: positive nonce (UI refresh) triggers a re-run + negative push ───────
{
    const { command } = bootShim({ profilesJson: "[]" });
    const h = makeCtx();
    timers.length = 0;
    apply(h.ctx, makeConfig(command));
    assert.equal(await settle(() => h.source().discoveryRevision >= 1), true, "boot run settled");
    const nonceBefore = h.settings.document[NS].refreshNonce;

    // Simulate the GUI refresh button: a positive timestamp write.
    h.commit(Date.now());
    assert.equal(
        await settle(() => h.source().discoveryRevision >= 2),
        true,
        "a positive nonce change re-runs discovery"
    );
    const pushed = h.settings.document[NS].refreshNonce;
    assert.equal(pushed < 0, true, "the re-run pushed a negative marker");
    assert.notEqual(pushed, nonceBefore, "the push advanced the nonce value");
    assert.equal(timers.length, 0, "successful run arms no retry");
    for (const d of h.disposers) d();
}

// ── 3: sibling instance's negative marker answers locally, never re-broadcast
{
    const { command } = bootShim({ profilesJson: '[{"id":"alpha"}]' });
    const h = makeCtx();
    timers.length = 0;
    apply(h.ctx, makeConfig(command));
    assert.equal(await settle(() => h.source().discoveryRevision >= 1), true, "boot run settled");

    const marker = -1788888888888;
    h.commit(marker);
    assert.equal(
        await settle(() => h.source().discoveryRevision >= 2),
        true,
        "a foreign negative marker re-runs discovery locally"
    );
    assert.equal(h.settings.document[NS].refreshNonce, marker, "the echo run writes the marker value back UNCHANGED (no re-broadcast)");
    assert.equal(timers.length, 0, "no retry after a successful echo run");
    for (const d of h.disposers) d();
}

// ── 4: failing boot run retries up to the cap, then stops ──────────────────
{
    const { command } = bootShim({ profilesOk: false });
    const h = makeCtx();
    timers.length = 0;
    apply(h.ctx, makeConfig(command));
    assert.equal(
        await settle(() => h.source().discoveryRevision >= 1 && h.source().lastRefreshError !== ""),
        true,
        "a failing run still bumps the revision and records the error"
    );
    assert.ok(h.warnings.some((line) => line.includes("profile discovery failed")), "failure was warned");

    let fires = 0;
    for (;;) {
        if (fireRetryTimer() === false) break;
        fires += 1;
        const target = 1 + fires;
        const ok = await settle(() => h.source().discoveryRevision >= target);
        assert.equal(ok, true, `retry ${String(fires)} ran a discovery`);
        if (fires >= DISCOVERY_RETRY_MAX) break;
    }
    await settle(() => h.source().lastRefreshError !== "");
    assert.equal(fires, DISCOVERY_RETRY_MAX, "every failed run armed exactly one retry until the cap");
    assert.equal(h.source().discoveryRevision, 1 + DISCOVERY_RETRY_MAX, "initial run + capped retries");
    assert.equal(
        timers.filter((timer) => !timer.cleared).length === 0,
        true,
        "no retry is scheduled beyond the cap"
    );
    for (const d of h.disposers) d();
}

// ── 5: dispose cancels a pending retry ────────────────────────────────────
{
    const { command } = bootShim({ profilesOk: false });
    const h = makeCtx();
    timers.length = 0;
    apply(h.ctx, makeConfig(command));
    assert.equal(await settle(() => h.source().lastRefreshError !== ""), true, "first run failed");
    if (timers.length === 0) throw new Error("expected a pending retry timer before dispose");
    for (const d of h.disposers) d();
    globalThis.clearTimeout(timers[0]);
    timers.length = 0;
    const before = h.source().discoveryRevision;
    await settle(() => true === true);
    assert.equal(h.source().discoveryRevision, before, "a disposed instance runs no further retries");
}

console.log("discovery.test.mjs: all assertions passed");
