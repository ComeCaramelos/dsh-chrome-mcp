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
 */
import { bridgeConfig } from "../bridge.js";
import { entryIds, mergeEntries, normalizeEntries } from "../catalog.js";
import { checkChrome, chromeExecutableCandidates, scanChromeExecutables } from "../discovery/index.js";
import { flagsSkipCheck } from "../flags.js";
import { firstLine, isChromeMissing } from "../status.js";
import { windowsChromeUrl } from "../windows/index.js";
import type { ChromeExecutableEntry, ChromeExecutableStatus, EffectiveChromeSource } from "../types/index.js";
import { readPersistedCustomPaths } from "../values.js";

import { configForBridge, restartBridge } from "./bridge-run.js";
import { noteSelection, noteStderr } from "./notes.js";
import { persistChromePath, persistExecutables } from "./persist.js";
import { runWindowsChrome } from "./windows-run.js";
import type { Controller } from "./state.js";

/** The serialized units one controller may queue. */
export type RunKind = "refresh" | "probe" | "windows";

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
export function mergeLegacyPaths(controller: Controller): ChromeExecutableEntry[] {
    const { state } = controller;
    if (state.legacyPathsMerged) return state.runningExecutables;
    state.legacyPathsMerged = true;
    const legacy = readPersistedCustomPaths(controller.ctx);
    if (legacy.length === 0) return state.runningExecutables;
    const merged = mergeEntries(state.runningExecutables, legacy);
    if (merged.changed) {
        state.runningExecutables = merged.entries;
        void persistExecutables(controller, merged.entries);
        controller.ctx.logger.info(
            `chrome-devtools-mcp(${controller.config.serverName}): folded ${String(legacy.length)} saved path(s) from the legacy chromeCustomPaths list into the executable rows`
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
    const live = state.source();
    // Rows are user-authored; re-normalize on every read (the client writes them
    // in one shot, so the shape it hands may be anything).
    const stored = normalizeEntries(live.executables);
    const storedChanged = !sameEntries(stored, state.runningExecutables);
    state.runningExecutables = storedChanged ? stored : mergeLegacyPaths(controller);
    const savedIds = entryIds(state.runningExecutables);
    const candidates = chromeExecutableCandidates(controller.config, savedIds, state.runningChromePath);
    let statuses: ChromeExecutableStatus[] = [];
    try {
        statuses = await scanChromeExecutables(candidates, controller.blockedForPlatform);
    } catch (error) {
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): executable run failed: ${String(error)}`);
    }
    state.entry.executableStatus = statuses;

    // A found path that is not a row yet becomes one, nameless; a row the user
    // named keeps that name. A path that vanished is dropped by the scan and so
    // stops being offered — the reference's "Fetch executables" rule.
    const merged = mergeEntries(state.runningExecutables, statuses.map((status) => status.path));
    if (merged.changed) {
        state.runningExecutables = merged.entries;
        void persistExecutables(controller, merged.entries);
    }

    if (state.runningChromePath === "") {
        const seeded = statuses.find((status) => status.version !== "" && status.error === "");
        if (seeded !== void 0 && !flagsSkipCheck(state.runningFlags)) {
            // Seeding is a selection change like any other: the bridge has to
            // restart carrying it, otherwise the card would claim a path the
            // running argv does not carry.
            controller.ctx.logger.info(
                `chrome-devtools-mcp(${controller.config.serverName}): no executable configured — seeding chromePath = ${seeded.path} (found by scan)`
            );
            state.seededPath = seeded.path;
            void persistChromePath(controller, seeded.path);
            // Already inside this run: the status list above already carries the
            // seeded path's own answer, so no follow-up run.
            applyChromePath(controller, seeded.path, "selected", false);
        } else if (candidates.length > 0 && !flagsSkipCheck(state.runningFlags) && statuses.every((status) => status.error !== "" || status.version === "")) {
            // Nothing present at all: the known executable-missing state.
            state.entry.lastError = firstLine(
                `Chrome executable not found: no executable detected (checked: ${candidates.join(", ")})`
            );
            state.entry.chromeMissing = isChromeMissing(state.entry.lastError);
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
        state.entry.chromeVersion = "";
        return "";
    }
    if (state.runningChromePath === "") {
        state.entry.chromeVersion = "";
        return "";
    }
    try {
        const version = await checkChrome(
            { ...controller.config, extraFlags: state.runningFlags, chromePath: state.runningChromePath },
            state.runningFlags,
            controller.blockedForPlatform
        );
        state.entry.chromeVersion = version;
        if (version !== "") {
            state.entry.lastError = "";
            state.entry.chromeMissing = false;
        }
        return version;
    } catch (error) {
        state.entry.lastError = firstLine(error instanceof Error ? error.message : String(error));
        // A failed probe says nothing about the version: keep no stale answer
        // behind the error.
        state.entry.chromeVersion = "";
        state.entry.chromeMissing = isChromeMissing(state.entry.lastError);
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): executable probe failed: ${state.entry.lastError}`);
        return "";
    }
}

/**
 * Restart the bridge connection with a different executable selected — the argv
 * tail carries `--executablePath=<path>`, so unlike a flag change this one is
 * what the card's pill claims is running. `rerun` schedules the scan+probe that
 * follows a selection change; a caller that is already inside that run (the
 * seeding branch above) passes `false`.
 */
export function applyChromePath(controller: Controller, path: string, nextSource: EffectiveChromeSource, rerun = true): void {
    const { state } = controller;
    state.runningChromePath = path;
    state.runningChromeSource = nextSource;
    noteSelection(controller);
    controller.ctx.logger.info(`chrome-devtools-mcp(${controller.config.serverName}): executable → "${path || "(none)"}" (restarting the bridge connection)`);
    const built = bridgeConfig(configForBridge(controller, state.runningFlags), state.runningFlags, state.runningStderrMode);
    noteStderr(controller, built);
    restartBridge(controller, built, "executable update failed");
    // A different executable reads a different machine: refresh the list and
    // probe what is now selected, so the pill's version is the new one's.
    if (rerun) queue(controller, "probe");
}

/**
 * Serialize one unit of work: a rows-only refresh, a run that also re-probes
 * what is selected, or the Windows Chrome launch. Windows runs share this chain
 * because the invariant is "one run at a time" — nothing about it interacts with
 * the local probe.
 */
export function queue(controller: Controller, kind: RunKind): Promise<unknown> {
    const { state } = controller;
    state.runs = state.runs
        .then(async () => {
            if (kind === "windows") {
                await runWindowsChrome(controller);
            } else {
                await runExecutableDiscovery(controller);
                if (kind === "probe") await probeSelection(controller);
            }
            state.entry.executableDiscoveryRevision += 1;
        })
        .catch(() => { });
    return state.runs;
}

/**
 * One Windows Chrome run on demand: queued on the same chain as the button (one
 * run at a time), resolved once it settled. The answer is the base-layer mirror
 * read after the run — the tool surface says what `windowsChromeStatus` says,
 * never more than the run answered.
 */
export async function prelaunchWindowsChrome(controller: Controller): Promise<string> {
    const { state } = controller;
    await queue(controller, "windows");
    const status = state.entry.windowsChromeStatus;
    if (status.state === "connected" && status.port > 0) {
        return `Windows Chrome connected at ${windowsChromeUrl(status.port)} — the bridge connects to it instead of launching one.`;
    }
    if (status.state === "not-applicable") {
        return "This host is not a WSL instance: there is no Windows-side browser here to drive.";
    }
    return `Windows Chrome did not connect (${status.state}): ${status.error}`;
}
