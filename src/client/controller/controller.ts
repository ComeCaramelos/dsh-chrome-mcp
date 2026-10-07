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

/** A staged field key — the four editable fields the card stages. */
type DraftKey = "extraFlags" | "executables" | "effectiveChromePath" | "stderrMode";

/** Whether two flag lists carry the same strings in the same order. */
function sameStrings(a: readonly string[], b: readonly string[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

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
    /**
     * Staged edits that have not been applied yet. A field is staged only while
     * it differs from what the Host serves; a draft that equals the served value
     * is not dirty and persists nothing. The editable surface staged here is the
     * whole form: the extra-flags list, the saved-executable rows, the selected
     * executable (its effective path), and the "Reduce log output" mode. What is
     * *persisted* is read below and echoed back only once a save lands it.
     */
    private readonly draft: {
        extraFlags?: string[];
        executables?: CatalogEntry[];
        effectiveChromePath?: string;
        stderrMode?: "" | "log" | "console";
    } = {};
    /** The last persisted (undrafted) projection, recomputed on every publish. */
    private saved: {
        extraFlags: string[];
        executables: CatalogEntry[];
        effectiveChromePath: string;
        effectiveSource: string;
        stderrMode: string;
        stderrEffective: string;
    } = {
            extraFlags: [],
            executables: [],
            effectiveChromePath: "",
            effectiveSource: "",
            stderrMode: "",
            stderrEffective: "log"
        };
    private saving = false;
    private failed = false;

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
            actionError: "",
            dirty: false,
            saving: false,
            failed: false
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
            this.saved = {
                extraFlags: [], executables: [], effectiveChromePath: "", effectiveSource: "",
                stderrMode: "", stderrEffective: "log"
            };
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
                actionError: previous.actionError,
                dirty: false,
                saving: false,
                failed: false
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
        // The extra-flags list is the user layer (like the rows), read from
        // `value`. It is one of the four editable fields this card stages.
        const servedExtraFlags: string[] = Array.isArray(value.extraFlags)
            ? value.extraFlags.filter((flag: unknown) => typeof flag === "string" && flag !== "")
            : [];
        // The effective "Reduce log output" mode: the persisted `stderrMode`
        // when set, else the row-config `rowStderr`. The draft is dirty against
        // this, so a toggle that lands back on what is already effective writes
        // nothing.
        const servedStderrEffective = servedStderrMode === "log" || servedStderrMode === "console"
            ? servedStderrMode
            : servedRowStderr === "console" ? "console" : "log";
        // The draft overlays the four persisted fields — everything else the card
        // renders is host state, served straight from what the Host answers. The
        // draft wins while it is set, so the pill, the rows and the flags read
        // what is *about to* be saved, not what is still running.
        const extraFlagsDraft = this.draft.extraFlags !== undefined ? this.draft.extraFlags : servedExtraFlags;
        const executablesDraft = this.draft.executables !== undefined ? this.draft.executables : servedExecutables;
        const effectiveChromePathDraft = this.draft.effectiveChromePath !== undefined ? this.draft.effectiveChromePath : servedEffectivePath;
        const effectiveSourceDraft = this.draft.effectiveChromePath !== undefined ? "selected" : servedSource;
        const stderrModeDraft = this.draft.stderrMode !== undefined ? this.draft.stderrMode : servedStderrMode;
        // Dirty is what a save would change: a staged field that differs from
        // what is served. A draft equal to the effective value writes nothing.
        const dirtyExtraFlags = this.draft.extraFlags !== undefined && !sameStrings(this.draft.extraFlags, servedExtraFlags);
        const dirtyExecutables = this.draft.executables !== undefined &&
            JSON.stringify(this.draft.executables) !== JSON.stringify(servedExecutables);
        const dirtyPath = this.draft.effectiveChromePath !== undefined && this.draft.effectiveChromePath !== servedEffectivePath;
        const dirtyStderr = this.draft.stderrMode !== undefined && this.draft.stderrMode !== servedStderrEffective;
        // Keep the undrafted projection so `apply` can tell, field by field, what
        // actually changed since the last publish.
        this.saved = {
            extraFlags: servedExtraFlags,
            executables: servedExecutables,
            effectiveChromePath: servedEffectivePath,
            effectiveSource: servedSource,
            stderrMode: servedStderrMode,
            stderrEffective: servedStderrEffective
        };
        this.store.set({
            available: true,
            writable: snapshot.writable === true,
            extraFlags: extraFlagsDraft,
            lastError: typeof base.lastError === "string" ? base.lastError : ((value.lastError as string) ?? ""),
            chromeMissing: base.chromeMissing === undefined ? value.chromeMissing === true : base.chromeMissing === true,
            executableDiscoveryRevision: servedRevision,
            chromeVersion: servedVersion,
            executables: executablesDraft,
            executableStatus: servedStatus,
            chromePath: readString(value.chromePath, ""),
            effectiveChromePath: effectiveChromePathDraft,
            effectiveSource: effectiveSourceDraft,
            stderrMode: stderrModeDraft === "log" || stderrModeDraft === "console" ? stderrModeDraft : "",
            rowStderr: servedRowStderr === "console" ? "console" : "log",
            defaultExtraFlags: servedDefaults,
            wslExtraFlags: servedWslFlags,
            wslWindowsExecutable: servedWslWindows,
            windowsChromeStatus: servedWindowsChrome,
            carriesConnectionMode: servedConnectMode,
            actionError: "",
            dirty: dirtyExtraFlags || dirtyExecutables || dirtyPath || dirtyStderr,
            saving: this.saving,
            failed: this.failed
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
     * Stage the extra-flags list. Nothing is persisted until `apply`; the saved
     * list stays what it was until a save lands it, while the card already
     * renders the staged list so what is on screen is exactly what applying
     * would store. A list equal to what is served is not dirty and writes
     * nothing.
     */
    saveFlags(flags: string[]): Promise<void> {
        if (this.disposed) return Promise.resolve();
        this.draft.extraFlags = Array.isArray(flags) ? flags : [];
        this.clearDraft("extraFlags");
        this.publish();
        return Promise.resolve();
    }

    /**
     * Stage the picked executable as the effective selection. Nothing restarts
     * the bridge until `apply`; the pill already shows the staged path so the
     * draft reads as what the bridge *would* launch with.
     */
    selectExecutable(id: string): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const target = typeof id === "string" ? id.trim() : "";
        if (target === "") return Promise.resolve();
        this.draft.effectiveChromePath = target;
        this.clearDraft("effectiveChromePath");
        this.publish();
        return Promise.resolve();
    }

    /**
     * Stage the whole saved-rows list. A row typed here shows up in the dropdown
     * options at once, but the rows on the wire stay as they were until a save.
     */
    saveExecutables(entries: CatalogEntry[]): Promise<void> {
        if (this.disposed) return Promise.resolve();
        this.draft.executables = normalizeEntries(entries);
        this.clearDraft("executables");
        this.publish();
        return Promise.resolve();
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
     * Merge the ids picked in the dialog into the saved rows. The same staged
     * whole-list write the picker's own row editor uses, so a newly picked
     * executable appears in the dropdown without touching the persisted rows.
     */
    addExecutables(ids: string[]): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const current = this.store.getSnapshot().executables;
        const merged = normalizeEntries(
            current.concat(
                (Array.isArray(ids) ? ids : [])
                    .filter((id) => typeof id === "string" && id.trim() !== "")
                    .map((id) => ({ id: id.trim(), name: "" }))
            )
        );
        this.draft.executables = merged;
        this.clearDraft("executables");
        this.publish();
        return Promise.resolve();
    }

    /**
     * Ask the host to drive a Windows-side Chrome in connect mode: write the
     * trigger, then wait for the run to settle (same revision counter every
     * executable run advances). What the button ends up reporting — launched,
     * already connected, prereq missing — is served through
     * `windowsChromeStatus`, not through the promise. This is an immediate host
     * run, not a staged edit.
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
     * Stage the "Reduce log output" flip. The draft holds the flipped effective
     * mode; a save restarts the bridge connection with / without the wrapper.
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
        this.draft.stderrMode = next;
        this.clearDraft("stderrMode");
        this.publish();
        return Promise.resolve();
    }

    /**
     * Write every staged edit in one pass: for each staged field that actually
     * differs from what the Host serves, persist it, then clear that field's
     * draft. The fields that advance the executable run (a new selection or new
     * rows) carry the one wait the executable actions used to do. A field whose
     * draft equals what is served is skipped; it would change nothing. A
     * rejection is surfaced through `noteError` and the field's draft is kept, so
     * the edit is not silently dropped — the user can retry.
     */
    async apply(): Promise<void> {
        if (this.disposed || this.saving) return;
        const saved = this.saved;
        const writes: { key: DraftKey; field: "extraFlags" | "executables" | "chromePath" | "stderrMode"; value: unknown; needsRevision: boolean }[] = [];

        if (this.draft.extraFlags !== undefined && !sameStrings(this.draft.extraFlags, saved.extraFlags)) {
            writes.push({ key: "extraFlags", field: "extraFlags", value: this.draft.extraFlags, needsRevision: false });
        }
        if (this.draft.executables !== undefined && JSON.stringify(this.draft.executables) !== JSON.stringify(saved.executables)) {
            writes.push({ key: "executables", field: "executables", value: this.draft.executables, needsRevision: true });
        }
        if (this.draft.effectiveChromePath !== undefined && this.draft.effectiveChromePath !== saved.effectiveChromePath) {
            writes.push({ key: "effectiveChromePath", field: "chromePath", value: this.draft.effectiveChromePath, needsRevision: true });
        }
        if (this.draft.stderrMode !== undefined && this.draft.stderrMode !== saved.stderrEffective) {
            writes.push({ key: "stderrMode", field: "stderrMode", value: this.draft.stderrMode, needsRevision: false });
        }
        if (writes.length === 0) return;

        const baseline = this.store.getSnapshot().executableDiscoveryRevision;
        let needsRevision = false;
        let landed = true;
        let failure: string = "";
        this.saving = true;
        this.failed = false;
        this.publish();

        for (const write of writes) {
            try {
                await this.scope.set(write.field, write.value);
                needsRevision = needsRevision || write.needsRevision;
            } catch (error) {
                failure = error != null && typeof (error as any).message === "string" ? (error as any).message : String(error);
                landed = false;
                break;
            }
        }

        this.saving = false;
        if (landed) {
            // Clear exactly the drafts that landed; a rejected one stays so the
            // card keeps showing the failed edit for correction.
            for (const write of writes) this.clearDraft(write.key, true);
            this.failed = false;
        } else {
            this.failed = true;
        }
        this.publish();
        // A rejected write surfaces its message through the store's own
        // actionError line. `publish` clears that line, so re-attach what the
        // rejection answered with — the same surface a live write used to have.
        if (!landed && failure !== "") {
            const current = this.store.getSnapshot();
            this.store.set({ ...current, actionError: failure });
        }

        if (landed && needsRevision) {
            await this.waitFor("executableDiscoveryRevision", baseline, Date.now() + CHECK_POLL_TIMEOUT_MS);
        }
    }

    /** Drop every staged edit, re-seeding every field from what the Host serves. */
    discard(): void {
        if (this.disposed) return;
        delete this.draft.extraFlags;
        delete this.draft.executables;
        delete this.draft.effectiveChromePath;
        delete this.draft.stderrMode;
        this.failed = false;
        this.publish();
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
            /** Persist every staged edit in one pass; see `apply`. */
            apply: () => this.apply(),
            /** Drop every staged edit; see `discard`. */
            discard: () => this.discard(),
            /** One mirror re-read (used when the card opens). */
            refresh: () => this.refresh()
        };
    }

    /** Clear a staged field once it equals the served value, so it stops being
     * dirty. When a save landed a field the draft must clear regardless. */
    private clearDraft(field: DraftKey, force = false): void {
        if (force) {
            delete this.draft[field];
            return;
        }
        const value = this.draft[field] as unknown;
        if (value === undefined) return;
        if (field === "extraFlags" && sameStrings(value as string[], this.saved.extraFlags)) delete this.draft.extraFlags;
        else if (field === "executables" && JSON.stringify(value) === JSON.stringify(this.saved.executables)) delete this.draft.executables;
        else if (field === "effectiveChromePath" && value === this.saved.effectiveChromePath) delete this.draft.effectiveChromePath;
        else if (field === "stderrMode" && value === this.saved.stderrEffective) delete this.draft.stderrMode;
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
