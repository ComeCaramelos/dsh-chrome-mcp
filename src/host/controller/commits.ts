/**
 * Controller — settings-commit routing.
 *
 * One settings commit may carry any of five changes; this routes them in the
 * reference's order: a flags drift restarts the bridge, an executable change
 * picked by the card restarts it and re-runs the discovery, a rows change is
 * folded into the same run (never a second one), the stderr toggle restarts the
 * connection with/without the stderr wrapper, and the two trigger nonces (the
 * fetch button, the Windows button) fire their runs. The first commit is the
 * registration run — a persisted Windows trigger folds in silently so booting a
 * host never launches a Windows browser by itself.
 */
import { normalizeEntries } from "../catalog.js";
import { sameFlags } from "../flags.js";
import { resolveEffectiveChromePath, resolveStderrMode } from "../values.js";
import type { EffectiveChromeSource } from "../types/index.js";

import { applyFlags, applyStderrMode } from "./bridge-run.js";
import { applyChromePath, queue, sameEntries } from "./runs.js";
import type { Controller } from "./state.js";

/** Route one settings commit. */
export function onSettingsChange(controller: Controller): void {
    const { state } = controller;
    try {
        const current = state.source();
        if (!sameFlags(current.extraFlags, state.runningFlags)) applyFlags(controller, current.extraFlags);

        // Executable changes come from the persisted `chromePath` the card wrote
        // (a row's `id`). They restart the bridge connection and re-run the
        // discovery, because a different executable reads a different machine. A
        // path the host seeded itself keeps standing until the user picks one:
        // the seed is written into the persisted layer, and until that write is
        // visible a commit must not resolve back to "nothing selected".
        const userLayer = typeof current.chromePath === "string" ? current.chromePath.trim() : "";
        if (userLayer !== "") state.seenUserSelection = true;
        const seededCarry = state.seededPath !== "" && !state.seenUserSelection ? state.seededPath : "";
        const nextChromePath = resolveEffectiveChromePath(userLayer !== "" ? userLayer : seededCarry, controller.rowChromePath);
        const nextSource: EffectiveChromeSource =
            userLayer !== "" ? "selected" : seededCarry !== "" ? "selected" : controller.rowChromePath !== "" ? "row-config" : "";
        if (nextChromePath !== state.runningChromePath) applyChromePath(controller, nextChromePath, nextSource);

        // Rows changes touch the list, never the connection.
        const nextExecutables = normalizeEntries(current.executables);
        const rowsChanged = !sameEntries(nextExecutables, state.runningExecutables);

        // The "Reduce log output" toggle lives here too: a change of the
        // effective stderr mode restarts the bridge connection with / without
        // the stderr-capturing wrapper.
        const nextStderrMode = resolveStderrMode(current.stderrMode, controller.config.bridgeStderr);
        if (nextStderrMode !== state.runningStderrMode) applyStderrMode(controller, nextStderrMode);

        const firstCommit = state.lastRefreshNonce === void 0;
        const refreshChanged = !firstCommit && current.refreshExecutablesNonce !== state.lastRefreshNonce;
        const windowsChanged = !firstCommit && current.openWindowsChromeNonce !== state.lastWindowsNonce;
        state.lastRefreshNonce = current.refreshExecutablesNonce;
        state.lastWindowsNonce = current.openWindowsChromeNonce;
        if (firstCommit) {
            // The registration run: discovery + probe, no separate call. A
            // persisted Windows trigger folds in silently — booting a host must
            // never launch a Windows browser by itself.
            queue(controller, "probe");
        } else {
            // The card's **Search executables** button. A rows change is folded
            // into the same run rather than a second one, so the client waits on
            // exactly one revision bump.
            if (refreshChanged || rowsChanged) queue(controller, "probe");
            // The card's **Prelaunch Windows Chrome** button: one Windows run,
            // sharing this chain (one run at a time).
            if (windowsChanged) queue(controller, "windows");
        }
    } catch (error) {
        controller.ctx.logger.error(`chrome-devtools-mcp(${controller.config.serverName}): ${String(error)}`);
    }
}
