/**
 * Controller — the executable run, its serialization, and the Windows trigger.
 *
 * Every executable action goes through one **run**: probe the candidate list the
 * saved rows + row config + selection carry, publish the per-path answers, and
 * merge what was found back into the saved rows (keeping the names the user
 * gave them). When nothing is configured at all, the first runnable entry is
 * seeded. A `probe` is the follow-up probe of the selection that answers the
 * version line the card shows; the Windows Chrome run shares this same
 * one-run-at-a-time chain.
 *
 * Since the component model there is no bridge of this row's own to restart:
 * an executable or flag change changes what a future `resolve` would answer,
 * and what is running today keeps running until the manager's pool says
 * otherwise — so the drift paths re-mirror the default and hand the live
 * connections that follow it back to the pool (./connections.ts).
 */
import { AsyncResource } from "node:async_hooks";
import type { AsyncResourceOptions } from "node:async_hooks";
import { entryIds, mergeEntries } from "../catalog.js";
import { DISCOVERY_RETRY_DELAY_MS, DISCOVERY_RETRY_MAX, ERROR_CAP, KIND_FIELDS, KIND_ID_WINDOWS } from "../constants.js";
import { checkChrome, chromeExecutableCandidates, scanChromeExecutables } from "../discovery/index.js";
import { flagsSkipCheck, flagsSkipProbe } from "../flags.js";
import { firstLine, isChromeMissing } from "../status.js";
import { windowsChromeUrl } from "../windows/index.js";
import type { ChromeExecutableEntry, ChromeExecutableStatus, EffectiveChromeSource } from "../types/index.js";
import { readDroppedExecutables, readPersistedCustomPaths, readSavedExecutables, resolveSelection } from "../values.js";

import { invalidateOwnedForField } from "./connections.js";
import { noteSelection } from "./notes.js";
import { persistChromePath, persistDroppedExecutables, persistExecutables } from "./persist.js";
import { publishLive } from "./publish.js";
import { prelaunchWindowsForConnection, runWindowsChrome } from "./windows-run.js";
import type { Controller } from "./state.js";

/** The serialized units one controller may queue. */
export type RunKind = "refresh" | "probe" | "windows";

/**
 * The runs answer from a neutral async context, never from the one that
 * scheduled them. A form commit is a config **write** — and the commit handler
 * runs synchronously inside the HMR write transaction it opened. A run
 * scheduled from that handler inherits the transaction's async-local store
 * through the promise continuation, so every follow-up config write the run
 * answers — the seeded `chromePath`, the merged executable rows, the
 * connect-mode flag — reads as a *nested* transaction, which HMR refuses
 * outright ("HMR transactions cannot be nested", measured live 2026-10-12):
 * the run settles, the mirror says `connected`, and the write-back silently
 * never lands. This resource carries no async context of its own, so binding
 * the run body to it starts the whole chain clean; the same write queues
 * normally behind the transaction that is no longer open. (The option that drops
 * the context predates the typed surface of `AsyncResourceOptions`.)
 */
const contextlessOptions: AsyncResourceOptions & { keepAsyncContext?: boolean } = { keepAsyncContext: false };
const runContext = new AsyncResource("dsh-chrome-mcp run", contextlessOptions);

/** Element-wise equality of two saved-row lists (order is the dropdown order). */
export function sameEntries(a: readonly ChromeExecutableEntry[], b: readonly ChromeExecutableEntry[]): boolean {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => entry.id === b[index].id && entry.name === b[index].name);
}

/**
 * Fold the legacy hand-typed MRU into the rows, exactly once. It is the same list
 * the older card used to write, so reading it never duplicates a row the card
 * already saved: the merge keeps stored rows and only appends ids that are
 * missing, and the result lands in the persisted rows instead of staying
 * readable forever as a second source.
 */
export function mergeLegacyPaths(controller: Controller, skip?: ReadonlySet<string>): ChromeExecutableEntry[] {
    const { state } = controller;
    if (state.legacyPathsMerged) return state.runningExecutables;
    state.legacyPathsMerged = true;
    const legacy = readPersistedCustomPaths(state.source());
    if (legacy.length === 0) return state.runningExecutables;
    const merged = mergeEntries(state.runningExecutables, skip === void 0 ? legacy : legacy.filter((id) => !skip.has(id)));
    if (merged.changed) {
        state.runningExecutables = merged.entries;
        void persistExecutables(controller, merged.entries);
        controller.ctx.logger.info(
            `dsh-chrome-mcp(${controller.config.serverName}): folded ${String(legacy.length)} saved path(s) from the legacy chromeCustomPaths list into the executable rows`
        );
    }
    return state.runningExecutables;
}

/**
 * One executable run. Probe every candidate the row config and the saved rows
 * carry (plus the selection — the same path may appear as a row), publish what
 * answered as per-path status, and merge what was found into the saved rows,
 * keeping the names their user gave them. When nothing is configured at all
 * (neither layer carries a path) the first runnable entry is **seeded**: written
 * into the persisted `chromePath` once, so what the picker shows is what the
 * bridge runs. A selection that is already fixed is never re-resolved, however
 * broken.
 * @returns the per-path statuses the run answered with.
 */
export async function runExecutableDiscovery(controller: Controller): Promise<ChromeExecutableStatus[]> {
    const { state } = controller;
    const layers = state.source();
    // Rows are user-authored; re-normalize on every read (the client writes them
    // in one shot, so the shape it hands may be anything).
    const stored = readSavedExecutables(layers);
    // An id the stored list has lost since the last run rode the run that is
    // reading it now — and a found path re-folds into the rows on every merge
    // step, so a deleted row would stand straight back up behind its own
    // deletion (measured live 2026-10-12: the (x86) Windows-executable row read
    // as a delete that never landed). What stands dropped lives in
    // `droppedExecutables` and no merge step folds it back; an id the list
    // carries again clears its record.
    const storedIds = new Set(entryIds(stored));
    const deleted = readDroppedExecutables(layers);
    const skipIds = new Set(deleted);
    for (const id of entryIds(state.runningExecutables)) {
        if (!storedIds.has(id)) skipIds.add(id);
    }
    for (const id of deleted) {
        if (storedIds.has(id)) skipIds.delete(id);
    }
    if (skipIds.size !== deleted.length || !deleted.every((id) => skipIds.has(id))) {
        void persistDroppedExecutables(controller, [...skipIds]);
    }
    const storedChanged = !sameEntries(stored, state.runningExecutables);
    state.runningExecutables = storedChanged ? stored : mergeLegacyPaths(controller, skipIds);
    const savedIds = entryIds(state.runningExecutables);
    // What the profile configures, what this host carries (the Windows-side
    // executables a WSL host reaches through the interop mount — offered, never
    // probed), what the rows saved, and what the bridge runs.
    const candidates = chromeExecutableCandidates(controller.config, savedIds, state.runningChromePath, controller.windowsExecutables());
    let statuses: ChromeExecutableStatus[] = [];
    try {
        statuses = await scanChromeExecutables(candidates, controller.blockedForPlatform);
    } catch (error) {
        controller.ctx.logger.warn(`dsh-chrome-mcp(${controller.config.serverName}): executable run failed: ${String(error)}`);
    }
    state.live.executableStatus = statuses;

    // A found path that is not a row yet becomes one, nameless; a row the user
    // named keeps that name. A path that vanished is dropped by the scan and so
    // stops being offered — the reference's "Fetch executables" rule. A path the
    // user dropped answers too (a located Windows executable keeps answering
    // forever) and must not be folded back.
    const merged = mergeEntries(state.runningExecutables, statuses.map((status) => status.path).filter((path) => !skipIds.has(path)));
    if (merged.changed) {
        state.runningExecutables = merged.entries;
        void persistExecutables(controller, merged.entries);
    }

    if (state.runningChromePath === "") {
        const seeded = statuses.find((status) => status.version !== "" && status.error === "");
        if (seeded !== void 0 && !flagsSkipProbe(state.runningFlags)) {
            // Seeding is a selection change like any other: it follows the same
            // drift path a pick takes, otherwise the card would claim a path no
            // answer launches with.
            controller.ctx.logger.info(
                `dsh-chrome-mcp(${controller.config.serverName}): no executable configured — seeding chromePath = ${seeded.path} (found by scan)`
            );
            state.seededPath = seeded.path;
            void persistChromePath(controller, seeded.path);
            // Already inside this run: the status list above already carries the
            // seeded path's own answer, so no follow-up run.
            applyChromePath(controller, seeded.path, "selected", false);
        } else if (candidates.length > 0 && !flagsSkipProbe(state.runningFlags) && statuses.every((status) => status.error !== "" || status.version === "")) {
            // Nothing runnable at all: the known executable-missing state. A
            // candidate that answered a note instead of a version says why —
            // the one case is the Windows executable a WSL host cannot launch
            // but drives through the **Prelaunch Windows Chrome** run — so the
            // line names what to run instead of leaving a bare "not found".
            const noted = statuses.find((status) => status.note !== "");
            const detail = noted === void 0
                ? `no executable detected (checked: ${candidates.join(", ")})`
                : `no executable detected for this host (checked: ${candidates.join(", ")}); ${firstLine(noted.note)}`;
            // The official troubleshooting advice for this state on a Linux
            // host (docs/troubleshooting.md): nothing local answered, and the
            // candidate list only knows where a `stable` install of this kernel
            // lives — the line says what to do about it instead of leaving a
            // bare "not found". On a WSL host the Windows side joins the answer
            // as the **run**, never a launch: a Windows `chrome.exe` cannot be
            // launched from WSL (see AGENTS.md, which is why the run exists).
            const advice = noted === void 0 && controller.linuxHost
                ? controller.wslHost
                    ? "; install Google Chrome inside the Linux environment, or run Prelaunch Windows Chrome to drive the Windows side (connect mode)"
                    : "; install Google Chrome inside the Linux environment (chrome-devtools-mcp never downloads one)"
                : "";
            state.live.lastError = firstLine(`Chrome executable not found: ${detail}${advice}`, ERROR_CAP + advice.length);
            state.live.chromeMissing = isChromeMissing(state.live.lastError);
        }
    }
    noteSelection(controller);
    return statuses;
}

/**
 * The probe of the *selection* — the one run that answers the version line the
 * card shows under the pill. Nothing probed (no selection, or a connect-mode
 * flag) must not clear anything: upstream starts the browser lazily, so silence
 * is not health.
 */
export async function probeSelection(controller: Controller): Promise<string> {
    const { state } = controller;
    // Connect mode launches nothing locally, so there is no local executable to
    // answer for: the card mutes the pill and shows no version line for a probe
    // the host cannot run.
    if (flagsSkipCheck(state.runningFlags)) {
        state.live.chromeVersion = "";
        publishLive(controller);
        return "";
    }
    if (state.runningChromePath === "") {
        state.live.chromeVersion = "";
        publishLive(controller);
        return "";
    }
    try {
        const version = await checkChrome(
            { ...controller.config, extraFlags: state.runningFlags, chromePath: state.runningChromePath },
            state.runningFlags,
            controller.blockedForPlatform
        );
        state.live.chromeVersion = version;
        if (version !== "") {
            state.live.lastError = "";
            state.live.chromeMissing = false;
        }
        publishLive(controller);
        return version;
    } catch (error) {
        state.live.lastError = firstLine(error instanceof Error ? error.message : String(error));
        // A failed probe says nothing about the version: keep no stale answer
        // behind the error.
        state.live.chromeVersion = "";
        state.live.chromeMissing = isChromeMissing(state.live.lastError);
        publishLive(controller);
        controller.ctx.logger.warn(`dsh-chrome-mcp(${controller.config.serverName}): executable probe failed: ${state.live.lastError}`);
        return "";
    }
}

/**
 * Write one executable selection through the Host write-back channel — the same
 * persisted `chromePath` field every other surface reads — and re-fire the run
 * behind it, the way the card's own selection commit does: a changed selection
 * shifts the default answers (connections follow, the run re-runs), an
 * unchanged write just re-probes. This is the command-side mirror of the
 * picker — pill, command and catalog read and write one field — so a headless
 * selection lands exactly where a GUI pick would.
 */
export function selectChromePath(controller: Controller, path: string): Promise<void> {
    return persistChromePath(controller, path).then(() => {
        const { state } = controller;
        // Layers read *after* the write: what the user layer answers is the
        // written path — or, on a cleared write ("" = fall back to the row
        // config), whatever the row config carries under it.
        const selection = resolveSelection(state.source());
        const nextChromePath = selection.path;
        const nextSource: EffectiveChromeSource = nextChromePath === "" ? "" : selection.source !== "" ? selection.source : "selected";
        if (nextChromePath !== state.runningChromePath || nextSource !== state.runningChromeSource) applyChromePath(controller, nextChromePath, nextSource);
        else queue(controller, "probe");
    });
}

/**
 * Carry a different executable into the live answers — the argv tail carries
 * `--executablePath=<path>`, so unlike a flags edit this one is what the card's
 * pill claims is running. What lives stands on is not restarted here: a
 * connection that follows the row's default is handed back to the pool for a
 * re-resolve, and one that picked its own executable was never following it.
 * `rerun` schedules the scan+probe that follows a selection change; a caller
 * that is already inside that run (the seeding branch above) passes `false`.
 */
export function applyChromePath(controller: Controller, path: string, nextSource: EffectiveChromeSource, rerun = true): void {
    const { state } = controller;
    state.runningChromePath = path;
    state.runningChromeSource = nextSource;
    state.live.runningNote = "";
    noteSelection(controller);
    controller.ctx.logger.info(`dsh-chrome-mcp(${controller.config.serverName}): executable → "${path || "(none)"}" (the default answers shift with it)`);
    invalidateOwnedForField(controller, KIND_FIELDS.executable);
    // A different executable reads a different machine: refresh the list and
    // probe what is now selected, so the pill's version is the new one's.
    if (rerun) queue(controller, "probe");
}

/**
 * The bounded retry of one FAILED executable run.
 *
 * The failure this answers is not "Chrome is not installed" — that answer is a
 * settled result and re-probing it forever would just be churn. It is the
 * host that is not ready *yet*: on a WSL boot the Windows executables arrive
 * through the interop mount, and the first run can fire seconds before that
 * mount answers, so what the run states — `chromeMissing`, the known
 * executable-missing state — reads "no found" for a machine that is about to
 * answer. Today nothing re-fires: the card states that answer until someone
 * presses **Fetch** again. So a run that settles standing failed arms exactly
 * one retry behind the delay, capped (`DISCOVERY_RETRY_MAX` retries per run
 * chain, reset the moment a run stops failing), and cancelled with the
 * instance.
 *
 * The rule that decides where the retry sits is the persistence of the known
 * error: the retry never touches `lastError`/`chromeMissing` — it *re-runs the
 * same run*, whose own answers already follow the evidence rule (the run clears
 * those fields only through a probe that answered a version). So the retry
 * cannot clobber what the user is already being told: either the later run finds
 * the executable (its probe answers a version, which is exactly the evidence
 * that clears the state), or it does not (the same answer re-states, still
 * standing). Nothing else distinguishes them — which is why arming the retry is
 * safe and why it arms only while the state stands.
 */
function noteRunFailure(controller: Controller, statuses: readonly ChromeExecutableStatus[]): void {
    const { state } = controller;
    // Only a run that settled standing in the known executable-missing state is
    // failed. And of those, the candidates that answered a platform *note* say
    // why no run on this host will ever launch them (the one case is the Windows
    // executable a WSL host drives through **Prelaunch Windows Chrome**) — that
    // is a settled answer, not a host not ready yet, so a retry would answer the
    // same note forever and is not armed.
    const noteOnly = statuses.length > 0 && statuses.every((status) => status.note !== "");
    if (state.live.chromeMissing !== true || noteOnly) {
        state.retriesPending = 0;
        return;
    }
    if (state.disposed) return;
    if (state.retryTimer !== void 0) return;
    if (state.retriesPending >= DISCOVERY_RETRY_MAX) return;
    state.retriesPending += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = void 0;
        // Only while the failure still stands: an instance whose later run found
        // the executable has nothing left to retry.
        if (state.disposed || state.live.chromeMissing !== true) return;
        void queue(controller, "probe");
    }, DISCOVERY_RETRY_DELAY_MS);
}

/** Cancel the pending bounded retry — what the instance's dispose calls. */
export function cancelDiscoveryRetry(controller: Controller): void {
    const { state } = controller;
    if (state.retryTimer !== void 0) {
        clearTimeout(state.retryTimer);
        state.retryTimer = void 0;
    }
}

/**
 * Serialize one unit of work: a rows-only refresh, a run that also re-probes
 * what is selected, or the Windows Chrome launch. Windows runs share this chain
 * because the invariant is "one run at a time" — nothing about it interacts with
 * the local probe. The body answers from a neutral async context (see
 * `runContext`): a run scheduled from a form commit must not carry that
 * commit's write transaction, or every write the run answers would be refused
 * as a nested transaction.
 */
export function queue(controller: Controller, kind: RunKind): Promise<unknown> {
    const { state } = controller;
    state.runs = state.runs
        .then(runContext.bind(async () => {
            if (kind === "windows") {
                await runWindowsChrome(controller);
            } else {
                const statuses = await runExecutableDiscovery(controller);
                if (kind === "probe") await probeSelection(controller);
                // A run that settled standing failed arms one bounded retry; a
                // run that no longer stands failed resets the retry counter.
                noteRunFailure(controller, statuses);
            }
            state.live.executableDiscoveryRevision += 1;
            publishLive(controller);
        }))
        .catch(() => { });
    return state.runs;
}

/**
 * One Windows Chrome run on demand: queued on the same chain as the button (one
 * run at a time), resolved once it settled. The answer is the live mirror read
 * after the run — the tool surface says what `windowsChromeStatus` says, never
 * more than the run answered.
 *
 * With the manager mounted this is also the surface that keeps the live
 * `chrome-windows` connections honest: a run that connected while such a
 * connection stands is a reason to answer that connection again (the run is
 * idempotent — the live port rides into `currentFlags` — so re-answering is not
 * a second browser), and a run that connected without one is said to be worth
 * one.
 */
export async function prelaunchWindowsChrome(controller: Controller): Promise<string> {
    const { state } = controller;
    await prelaunchWindowsForConnection(controller);
    const status = state.live.windowsChromeStatus;
    if (status.state === "connected" && status.port > 0) {
        const url = windowsChromeUrl(status.port);
        if (state.connections !== void 0) {
            const windowsEntries = state.connections.entries().filter((entry) => entry.kind === KIND_ID_WINDOWS);
            if (windowsEntries.length > 0) return `Windows Chrome connected at ${url} — the manager's Windows Chrome connections stand live against it.`;
            return `Windows Chrome connected at ${url}. No Windows Chrome connection exists yet — add one under the "Windows Chrome (WSL debug port)" kind, or use the Chrome connection kind with a "--browserUrl=${url}" flag.`;
        }
        return `Windows Chrome connected at ${url}. Without the MCP manager there is no connection to drive it — install the MCP manager bundle.`;
    }
    if (status.state === "not-applicable") {
        return "This host is not a WSL instance: there is no Windows-side browser here to drive.";
    }
    return `Windows Chrome did not connect (${status.state}): ${status.error}`;
}
