/**
 * Controller — configuration-form commit routing.
 *
 * One commit may carry any of five changes; this routes them in the reference's
 * order: a flags drift shifts what a connection with no own answer would run
 * with (and hands such live connections back to the pool), an executable change
 * picked by the card does the same plus a re-run of the discovery, a rows change
 * is folded into the same run (never a second one), the stderr toggle shifts the
 * spawn wrapper the next answer builds with, and the two trigger nonces (the
 * fetch button, the Windows button) fire their runs. The first commit read is
 * the registration run — a persisted Windows trigger folds in silently so
 * booting a host never launches a Windows browser by itself.
 *
 * Two things make this routing safe under the config-form model:
 *
 * - It runs only for **user-authored** paths (see ../settings.ts
 *   `routesUserCommit`), so the live publish it itself triggers — a volatile
 *   commit carrying live fields — never re-enters it.
 * - It re-publishes the live mirror when it finishes. A user write clears the
 *   live-only fields out of the running references (the write merge), so without
 *   the re-publish the card would read defaults back until the next run.
 *
 * Nothing here restarts anything: what runs lives in the manager's pool, and
 * that pool decides a restart against the config the kind's `resolve` answers
 * with — this side only says what the default answers would be.
 */
import { normalizeEntries } from "../catalog.js";
import { KIND_FIELDS } from "../constants.js";
import { flagsSkipCheck, sameFlags } from "../flags.js";
import { readPersistedChromePath, resolveLaunchFlags, resolveSelection, resolveStderrModeFromLayers } from "../values.js";
import type { EffectiveChromeSource } from "../types/index.js";

import { invalidateOwnedForField } from "./connections.js";
import { applyChromePath, queue, sameEntries } from "./runs.js";
import { publishLive } from "./publish.js";
import type { Controller } from "./state.js";

/** Route one configuration-form commit. */
export function onFormCommit(controller: Controller): void {
    const { state } = controller;
    try {
        const layers = state.source();

        // Flags: the user layer, then the launch environment, then the row config,
        // then the schema default. Whatever answers is what a connection following
        // the row would run with; the ones carrying their own list are untouched.
        const nextFlags = resolveLaunchFlags(layers, controller.launchFlags);
        if (!sameFlags(nextFlags, state.runningFlags)) {
            state.runningFlags = nextFlags;
            // Connect mode launches no local executable, so the known "executable
            // missing" state simply does not apply while it is set.
            if (flagsSkipCheck(nextFlags)) state.live.chromeMissing = false;
            publishLive(controller);
            controller.ctx.logger.info(`dsh-chrome-mcp(${controller.config.serverName}): default flags → [${nextFlags.join(" ")}] (connections without own flags re-answer on the next prepare)`);
            invalidateOwnedForField(controller, KIND_FIELDS.extraFlags);
        }

        // Executable changes come from the user layer `chromePath` the card wrote
        // (a row's `id`) or the host seeded. A different executable reads a
        // different machine: mirror the new default and re-run the discovery. A
        // path the host seeded itself keeps standing until the user picks one:
        // the seed is written into the user layer, and until that write is
        // visible a commit must not resolve back to "nothing selected".
        const userLayer = readPersistedChromePath(layers);
        if (userLayer !== "") state.seenUserSelection = true;
        const seededCarry = state.seededPath !== "" && !state.seenUserSelection ? state.seededPath : "";
        const selection = resolveSelection(layers);
        const nextChromePath = selection.path !== "" ? selection.path : seededCarry;
        const nextSource: EffectiveChromeSource = nextChromePath === "" ? "" : selection.source !== "" ? selection.source : "selected";
        // A row config that pinned the executable with a flag answers as the
        // row-config source; say it once, since the fold is invisible to argv and
        // a silent switch would read as the picker having changed.
        if (selection.source === "row-config" && selection.pinned === true && !state.legacyPinAnnounced) {
            state.legacyPinAnnounced = true;
            controller.ctx.logger.warn(
                `dsh-chrome-mcp(${controller.config.serverName}): an extraFlags "--executablePath" in the row config is now the \`chromePath\` source ("${selection.path}"); the flag itself is dropped from the launched argv`
            );
        }
        if (nextChromePath !== state.runningChromePath || nextSource !== state.runningChromeSource) applyChromePath(controller, nextChromePath, nextSource);

        // Rows changes touch the list, never a connection.
        const nextExecutables = normalizeEntries(layers.user.executables ?? layers.value.executables);
        const rowsChanged = !sameEntries(nextExecutables, state.runningExecutables);

        // The "Reduce log output" toggle lives here too: the effective stderr mode
        // is stated from every commit, not only from a switch — a commit that
        // changes nothing the spawn does must still answer what the spawn *does*
        // do, or the card's own diff against the effective mode would drop every
        // flip it stages. A switch shifts the default and hands the connections
        // that follow it back to the pool (the wrapper is fixed at spawn).
        const nextStderrMode = resolveStderrModeFromLayers(layers, controller.config.bridgeStderr);
        state.live.stderrEffective = nextStderrMode;
        if (nextStderrMode !== state.runningStderrMode) {
            state.runningStderrMode = nextStderrMode;
            publishLive(controller);
            controller.ctx.logger.info(`dsh-chrome-mcp(${controller.config.serverName}): bridge stderr mode → "${nextStderrMode}" (connections re-spawn with the new wrapper)`);
            invalidateOwnedForField(controller, KIND_FIELDS.stderrMode);
        }

        // A persisted trigger must never fire a run just because the Host read
        // it back: the reference pins this with `!== 0` (a stored nonce folds in
        // silently, only a later diff fires). The guard here is the same rule,
        // stated the stronger way: the first commit *is* the fold (booting never
        // launches — see the branch below), and every later diff is real because
        // the card writes `Date.now()` as the trigger value (the client's
        // fetch/openWindowsChrome), so no stored value ever equals a new write.
        const firstCommit = state.lastRefreshNonce === void 0;
        const refreshChanged = !firstCommit && layers.value.refreshExecutablesNonce !== state.lastRefreshNonce;
        const windowsChanged = !firstCommit && layers.value.openWindowsChromeNonce !== state.lastWindowsNonce;
        state.lastRefreshNonce = layers.value.refreshExecutablesNonce;
        state.lastWindowsNonce = layers.value.openWindowsChromeNonce;
        if (firstCommit) {
            // The registration run: discovery + probe, no separate call. A
            // persisted Windows trigger folds in silently — booting a host must
            // never launch a Windows browser by itself.
            queue(controller, "probe");
        } else {
            // The card's **Fetch executables** button. A rows change is folded into
            // the same run rather than a second one, so the client waits on exactly
            // one revision bump.
            if (refreshChanged || rowsChanged) queue(controller, "probe");
            // The card's **Prelaunch Windows Chrome** button: one Windows run,
            // sharing this chain (one run at a time).
            if (windowsChanged) queue(controller, "windows");
        }
    } catch (error) {
        controller.ctx.logger.error(`dsh-chrome-mcp(${controller.config.serverName}): ${String(error)}`);
    } finally {
        // Every user commit clears the live-only fields, so the mirror goes back
        // out with the answers it carries.
        publishLive(controller);
    }
}
