/**
 * Controller — publishing the live mirror.
 *
 * Every answer the card reads (`lastError`, the per-path probe list, the resolved
 * selection, the Windows run state, …) is a `.volatile()` field of the same
 * `Config` the card edits, so publishing is one **volatile commit** — and that
 * channel is `createLiveMirror` from `@comecaramelos/dsh-ancesters/host`: the
 * coalescing, the wait for the fiber to settle, the loader-entry merge that
 * persists nothing and never remounts, the `describe()` that turns the new
 * revision into the event the card settles on, and the re-assert when a settings
 * write anywhere in the profile resets the live keys (dsh 0.2.1).
 *
 * What stays here is what the mirror *means* for this row: the connect-mode
 * answer, derived on every publish, and telling the manager that what a picker
 * would answer just moved.
 */
import { createLiveMirror } from "@comecaramelos/dsh-ancesters/host";

import { flagsSkipCheck } from "../flags.js";
import type { SettingsForms } from "../types/index.js";

import type { Controller } from "./state.js";

/** Queue one coalesced publish. */
export function publishLive(controller: Controller): void {
    const { state } = controller;
    // The connect-mode answer is re-derived here, off what answers connect
    // mode right now: a connection whose running flags carry the debug URL, or
    // a live **Prelaunch Windows Chrome** run that stands connected against its
    // port. Connect mode is a property of the running argv, not of a flags
    // *change* — answering only where a flags list was applied left a row that
    // already runs in connect mode serving the pill as the local selection
    // (measured live 2026-10-13: a host booted with
    // `--browserUrl=http://127.0.0.1:9223` in its row config never read Connect
    // mode; the pill read the executable name and only turned over when the
    // run applied the flags itself). Deriving on every publish means the answer
    // can never be quieter than what is running.
    state.live.carriesConnectionMode = flagsSkipCheck(state.runningFlags) || (state.live.windowsChromeStatus.state === "connected" && state.live.windowsChromeStatus.port > 0);
    if (state.mirror === void 0) {
        state.mirror = createLiveMirror(controller.ctx as never, {
            name: `dsh-chrome-mcp(${controller.config.serverName})`,
            read: () => ({ ...state.live }) as Record<string, unknown>,
            settings: () => (controller.state.form?.settings ?? (controller.ctx.get("settings") as SettingsForms | undefined)) as never
        });
    }
    state.mirror.publish();
    // The connection fields' `select` choices are Host-served answers read off
    // this very state (the catalog, the scan answers, what a live connection
    // runs with), so every publish says "what a picker would answer just
    // moved" — once per turn, like the publish itself (see ../manager.ts:
    // "every publish re-notifies").
    if (state.kindsNotifyQueued) return;
    state.kindsNotifyQueued = true;
    queueMicrotask(() => {
        state.kindsNotifyQueued = false;
        if (!state.disposed) state.notifyKindsChanged();
    });
}
