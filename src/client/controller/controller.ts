/**
 * Browser half — the card's data controller (the class).
 *
 * Projects the bound `chrome-mcp` settings scope onto a snapshot store the card
 * reads through its `useChromeMcpCard` hook, and owns the write actions the
 * card's controls call: save flags, pick a saved executable, save the rows, run
 * the search, flip the stderr-mode toggle. `mirror` is the shared settings
 * describe mirror (`settingsScope.describe()`) every waiting action re-reads
 * while the host's in-memory status is still en route — module plugins have no
 * client→host push channel beyond persisted writes.
 *
 * One counter carries the host's answer: `executableDiscoveryRevision`, what
 * every executable run advances (the merged scan, and the probe of what is
 * selected that follows it). A selection change, a rows change and **Search
 * executables** all wait on it, so the two never settle each other; `publish`
 * starts a catch-up poll for it when the first read still finds zero.
 *
 * The types it projects ride in ./snapshot.ts, the read helpers in ./read.ts and
 * the poll budgets in ./budget.ts — this file is only the store + the actions.
 */
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";

import { normalizeEntries, type CatalogEntry } from "../catalog.js";
import { CHECK_POLL_TICK_MS, CHECK_POLL_TIMEOUT_MS } from "./budget.js";
import { readNumber, readStatus, readString, readWindowsChromeStatus } from "./read.js";
import type { ChromeExecutableStatus, ChromeMcpCardSnapshot, DescribeMirror, SettingsScope } from "./snapshot.js";

/**
 * The card's data half: store, publish-on-notify, and the write actions the
 * card's slot registration injects as props.
 */
export class ChromeMcpCardController {
    private readonly scope: SettingsScope;
    private readonly mirror: DescribeMirror;
    private disposed = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private pollGeneration = 0;
    private waitStarted = false;
    readonly store: ReturnType<typeof createSnapshotStore<ChromeMcpCardSnapshot>>;
    private readonly unsubscribe: () => void;

    constructor(scope: SettingsScope, mirror: DescribeMirror) {
        this.scope = scope;
        this.mirror = mirror;
        this.store = createSnapshotStore<ChromeMcpCardSnapshot>({
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
        });
        this.unsubscribe = scope.subscribe(() => this.publish());
        this.publish();
    }

    /** Republish the latest scope snapshot into the card store. */
    private publish(): void {
        if (this.disposed) return;
        const previous = this.store.getSnapshot();
        const snapshot = this.scope.getSnapshot();
        if (snapshot.status !== "ready" || snapshot.value === void 0) {
            this.store.set({
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
                actionError: previous.actionError
            });
            return;
        }
        const value = snapshot.value;
        // The status fields (lastError / chromeMissing /
        // executableDiscoveryRevision / chromeVersion / executableStatus /
        // effectiveChromePath / effectiveSource) ride the composition **base**
        // layer: describe() clones that entry object fresh on every read, while
        // the frozen resolved `value` folds the base in only at commits.
        // Base-only host changes — the registration run, bridge-log and
        // tool-call captures — are therefore invisible to `value`, so status is
        // read from `base`, falling back to `value` only when the read carries
        // no base layer. The user-authored fields keep reading `value`: the
        // persisted layer wins there, not the host-seeded entry field.
        const base = snapshot.base ?? {};
        const servedRevision = readNumber(base.executableDiscoveryRevision, readNumber(value.executableDiscoveryRevision, 0));
        const servedVersion = readString(base.chromeVersion, readString(value.chromeVersion, ""));
        // The rows are user-authored, so the persisted layer is what the card
        // edits; the per-row answers are host state, and only the base layer
        // carries them.
        const servedExecutables = normalizeEntries(value.executables);
        const servedStatus = readStatus(base.executableStatus);
        // The pill shows what the bridge launches with, so the path/source come
        // from the base layer (the host resolves them); the persisted
        // `chromePath` is what the store echoes back for the picker's selection.
        const servedEffectivePath = readString(
            base.effectiveChromePath,
            readString(value.effectiveChromePath, readString(value.chromePath, ""))
        );
        const servedSource: "" | "selected" | "row-config" =
            base.effectiveSource === "selected" || base.effectiveSource === "row-config"
                ? base.effectiveSource
                : value.effectiveSource === "selected" || value.effectiveSource === "row-config"
                    ? value.effectiveSource
                    : "";
        // `stderrMode` is the persisted user layer (like extraFlags) — read it
        // from `value`; `rowStderr` is a static base-layer mirror — read it from
        // the base clone, falling back to `value` only when the read carries no
        // base layer.
        const servedStderrMode = typeof value.stderrMode === "string" ? value.stderrMode : "";
        const servedRowStderr =
            typeof base.rowStderr === "string" ? base.rowStderr : (typeof value.rowStderr === "string" ? value.rowStderr : "log");
        // The default-flags list is a host static — served by the base clone,
        // like `rowStderr`, falling back to the resolved value only when the
        // read carries no base layer.
        const servedDefaults: string[] = Array.isArray(base.defaultExtraFlags)
            ? base.defaultExtraFlags.filter((flag) => typeof flag === "string" && flag !== "")
            : Array.isArray(value.defaultExtraFlags)
                ? value.defaultExtraFlags.filter((flag) => typeof flag === "string" && flag !== "")
                : [];
        // The recommended WSL-flags list is a host static too, served the same
        // way — the card carries no copy of it either.
        const servedWslFlags: string[] = Array.isArray(base.wslExtraFlags)
            ? base.wslExtraFlags.filter((flag) => typeof flag === "string" && flag !== "")
            : Array.isArray(value.wslExtraFlags)
                ? value.wslExtraFlags.filter((flag) => typeof flag === "string" && flag !== "")
                : [];
        // The Windows-executable-under-WSL mirror is host state — only the host
        // knows where it is running — so it rides the base layer with the rest
        // of the status fields.
        const servedWslWindows = base.wslWindowsExecutable === undefined ? value.wslWindowsExecutable === true : base.wslWindowsExecutable === true;
        // The Windows Chrome run answer and the connect-mode flag mirror are
        // host state too: served by the base clone, like the rest.
        const servedWindowsChrome = readWindowsChromeStatus(base.windowsChromeStatus !== undefined ? base.windowsChromeStatus : value.windowsChromeStatus);
        const servedConnectMode = base.carriesConnectionMode === undefined ? value.carriesConnectionMode === true : base.carriesConnectionMode === true;
        this.store.set({
            available: true,
            writable: snapshot.writable === true,
            extraFlags: Array.isArray(value.extraFlags) ? value.extraFlags : [],
            lastError: typeof base.lastError === "string" ? base.lastError : ((value.lastError as string) ?? ""),
            chromeMissing: base.chromeMissing === undefined ? value.chromeMissing === true : base.chromeMissing === true,
            executableDiscoveryRevision: servedRevision,
            chromeVersion: servedVersion,
            executables: servedExecutables,
            executableStatus: servedStatus,
            chromePath: readString(value.chromePath, ""),
            effectiveChromePath: servedEffectivePath,
            effectiveSource: servedSource,
            stderrMode: servedStderrMode === "log" || servedStderrMode === "console" ? servedStderrMode : "",
            rowStderr: servedRowStderr === "console" ? "console" : "log",
            defaultExtraFlags: servedDefaults,
            wslExtraFlags: servedWslFlags,
            wslWindowsExecutable: servedWslWindows,
            windowsChromeStatus: servedWindowsChrome,
            carriesConnectionMode: servedConnectMode,
            actionError: ""
        });
        // Startup catch-up: the registration run lands in the base layer
        // *after* this first describe read, and a module plugin has no push
        // channel — poll the shared describe mirror until the served revision
        // advances (the same budget the executable actions wait with). A card
        // attaching after the run already settled sees a nonzero revision and
        // does not poll.
        if (!this.waitStarted) {
            this.waitStarted = true;
            if (servedRevision === 0) void this.waitFor("executableDiscoveryRevision", 0, Date.now() + CHECK_POLL_TIMEOUT_MS);
        }
    }

    /**
     * Immediate write of the user's extra flags (persisted; the host's
     * validate hook rejects invalid lists here, and the next bridge
     * launch starts with them).
     */
    saveFlags(flags: string[]): Promise<void> {
        return this.scope.set("extraFlags", flags).catch((error) => this.noteError(error));
    }

    /**
     * Pick one saved executable. Writes the persisted `chromePath` (the host
     * restarts the bridge connection carrying it and re-runs the discovery), then
     * waits until the served revision advances past the click-time value.
     */
    selectExecutable(id: string): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const target = typeof id === "string" ? id.trim() : "";
        if (target === "") return Promise.resolve();
        const baseline = this.store.getSnapshot().executableDiscoveryRevision;
        const wait = this.waitFor("executableDiscoveryRevision", baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
        return this.scope
            .set("chromePath", target)
            .catch((error) => this.noteError(error))
            .then(() => wait);
    }

    /**
     * Save the whole rows list: the card owns the draft, the host re-normalizes
     * on the way in and re-runs the scan the new ids imply.
     */
    saveExecutables(entries: CatalogEntry[]): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const rows = normalizeEntries(entries);
        const snapshot = this.store.getSnapshot();
        const unchanged = JSON.stringify(rows) === JSON.stringify(snapshot.executables);
        if (unchanged) return Promise.resolve();
        const baseline = snapshot.executableDiscoveryRevision;
        const wait = this.waitFor("executableDiscoveryRevision", baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
        return this.scope
            .set("executables", rows)
            .catch((error) => this.noteError(error))
            .then(() => wait);
    }

    /**
     * Ask the host to re-probe the saved rows and fold what it finds into them,
     * then wait for the served revision to advance: write the trigger, then poll
     * the shared describe mirror until it moves — or the budget elapses. Resolves
     * with every candidate the run answered for and what it said about each, so
     * the dialog opens over the run's own answer list.
     */
    refreshExecutables(): Promise<ChromeExecutableStatus[]> {
        if (this.disposed) return Promise.resolve([]);
        const baseline = this.store.getSnapshot().executableDiscoveryRevision;
        const wait = this.waitFor("executableDiscoveryRevision", baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
        return this.scope
            .set("refreshExecutablesNonce", Date.now())
            .catch((error) => this.noteError(error))
            .then(() => wait)
            .then(() => {
                const served = this.store.getSnapshot();
                return Array.isArray(served.executableStatus) ? served.executableStatus : [];
            });
    }

    /**
     * Merge the ids picked in the dialog into the saved rows: every id already
     * there keeps its place (and its name), the missing ones append nameless.
     * The host re-normalizes on the way in and re-runs the scan the new ids
     * imply, so the same revision counter carries the wait.
     */
    addExecutables(ids: string[]): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const served = this.store.getSnapshot();
        const rows = normalizeEntries(served.executables);
        const merged = rows.concat(
            (Array.isArray(ids) ? ids : [])
                .filter((id) => typeof id === "string" && id.trim() !== "")
                .map((id) => ({ id: id.trim(), name: "" }))
        );
        const next = normalizeEntries(merged);
        if (JSON.stringify(next) === JSON.stringify(rows)) return Promise.resolve();
        const baseline = served.executableDiscoveryRevision;
        const wait = this.waitFor("executableDiscoveryRevision", baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
        return this.scope
            .set("executables", next)
            .catch((error) => this.noteError(error))
            .then(() => wait);
    }

    /**
     * Ask the host to drive a Windows-side Chrome in connect mode: write the
     * trigger, then wait for the run to settle (same revision counter every
     * executable run advances). What the button ends up reporting — launched,
     * already connected, prereq missing — is served through
     * `windowsChromeStatus`, not through the promise.
     */
    openWindowsChrome(): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const baseline = this.store.getSnapshot().executableDiscoveryRevision;
        const wait = this.waitFor("executableDiscoveryRevision", baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
        return this.scope
            .set("openWindowsChromeNonce", Date.now())
            .catch((error) => this.noteError(error))
            .then(() => wait);
    }

    /**
     * Flip the "Reduce log output" toggle: persists `stderrMode` as "log"
     * (capture stderr into the bridge log file) or "console" (echo it for
     * debugging), starting from what the host currently resolves — the served
     * `stderrMode` when set, else the row-config `rowStderr` fallback. The host
     * restarts the bridge connection on the change.
     */
    toggleStderr(): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const snapshot = this.store.getSnapshot();
        const effective =
            snapshot.stderrMode === "log" || snapshot.stderrMode === "console"
                ? snapshot.stderrMode
                : snapshot.rowStderr === "console"
                    ? "console"
                    : "log";
        const next = effective === "log" ? "console" : "log";
        return this.scope.set("stderrMode", next).catch((error) => this.noteError(error));
    }

    /** The face the card's slot registration injects. */
    inject(): Record<string, unknown> {
        return {
            hooks: { chromeMcpCard: this.store },
            saveFlags: (flags: string[]) => this.saveFlags(flags),
            toggleStderr: () => this.toggleStderr(),
            selectExecutable: (id: string) => this.selectExecutable(id),
            saveExecutables: (entries: CatalogEntry[]) => this.saveExecutables(entries),
            refreshExecutables: () => this.refreshExecutables(),
            addExecutables: (ids: string[]) => this.addExecutables(ids),
            openWindowsChrome: () => this.openWindowsChrome(),
            /** One mirror re-read (used when the card opens). */
            refresh: () => this.refresh()
        };
    }

    /**
     * Re-read the shared describe mirror once so base-layer status
     * captured asynchronously by the host (bridge connection errors)
     * reaches an opened card without waiting for a write or a run.
     */
    refresh(): Promise<unknown> {
        if (this.disposed) return Promise.resolve();
        let load: unknown;
        try {
            load = this.mirror.load();
        } catch {
            load = void 0;
        }
        return Promise.resolve(load).catch(() => { });
    }

    dispose(): void {
        this.disposed = true;
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        this.unsubscribe();
    }

    /**
     * Re-describe the settings mirror every tick until the given revision field
     * advances past `baseline`, or the deadline passes.
     */
    private waitFor(field: "executableDiscoveryRevision", baseline: number, deadline: number): Promise<void> {
        // A new wait supersedes any pending one (the startup catch-up poll
        // yielding to a manual action), so exactly one poll loop runs and the
        // superseded wait settles instead of dangling.
        const generation = ++this.pollGeneration;
        const controller = this;
        return new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let settled = false;
            const arm = (delay: number) => {
                timer = setTimeout(tick, delay);
                controller.pollTimer = timer ?? null;
            };
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (controller.pollTimer === (timer ?? null)) controller.pollTimer = null;
                resolve();
            };
            const satisfied = () => readNumber(controller.store.getSnapshot()[field], baseline) > baseline || Date.now() >= deadline;
            const stale = () => controller.disposed || generation !== controller.pollGeneration;
            const tick = () => {
                if (stale() || satisfied()) {
                    finish();
                    return;
                }
                let loaded: unknown;
                try {
                    loaded = controller.mirror.load();
                } catch {
                    loaded = void 0; // mirror read failure: the next tick retries
                }
                Promise.resolve(loaded)
                    .catch(() => ({}))
                    .then(() => {
                        if (stale() || satisfied()) {
                            finish();
                            return;
                        }
                        arm(CHECK_POLL_TICK_MS);
                    });
            };
            arm(CHECK_POLL_TICK_MS);
        });
    }

    /** Surface a rejected action on the card (store-only; never host state). */
    private noteError(error: unknown): void {
        if (this.disposed) return;
        const previous = this.store.getSnapshot();
        this.store.set({
            ...previous,
            actionError: error != null && typeof (error as any).message === "string" ? (error as any).message : String(error)
        });
    }
}
