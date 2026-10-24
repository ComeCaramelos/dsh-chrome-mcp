/**
 * Controller — live-mirror announcements.
 *
 * The two answers the card can only learn from here: the resolved selection
 * (with the WSL + Windows-executable state, keyed on the *selection*, not a
 * probe), and where the bridge console output goes. Both land in the live mirror
 * and reach the card through one volatile commit (see ./publish.ts).
 */
import type { BridgeStderrNotice } from "../types/index.js";

import { flagsSkipCheck } from "../flags.js";
import { isWindowsExecutablePath } from "../platform.js";

import { publishLive } from "./publish.js";
import type { Controller } from "./state.js";

/**
 * Publish the resolved selection into the mirror — with the one state the card
 * can only learn from here, and with the static notice that goes with it. The
 * Windows-executable state is keyed on the *selection*, not on any probe: a
 * Windows binary answers `--version` just fine across the interop boundary, so a
 * healthy-looking pill is exactly what a broken Windows selection looks like
 * until the first tool call fails.
 */
export function noteSelection(controller: Controller): void {
    const { state } = controller;
    state.live.effectiveChromePath = state.runningChromePath;
    state.live.effectiveSource = state.runningChromeSource;
    const windowsUnderWsl = !flagsSkipCheck(state.runningFlags) && controller.wslHost && isWindowsExecutablePath(state.runningChromePath);
    state.live.wslWindowsExecutable = windowsUnderWsl;
    // The log's pointer is the run, named: a headless host sees no notice, and
    // "connect mode" on its own is not an action.
    if (windowsUnderWsl && !state.wslNoticeShown) {
        state.wslNoticeShown = true;
        controller.ctx.logger.warn(
            `dsh-chrome-mcp(${controller.config.serverName}): running under WSL with a Windows executable selected ("${state.runningChromePath}") — that binary cannot be launched from here; run Prelaunch Windows Chrome (the card's action, or the prelaunch_windows_chrome tool) to drive it in connect mode`
        );
    }
    publishLive(controller);
}

/**
 * Announce where the bridge's console output goes — one line per change of
 * state, keyed on what actually happened, so neither the "log" capture nor
 * a switch to console echo is silent.
 */
export function noteStderr(controller: Controller, built: BridgeStderrNotice): void {
    const { state } = controller;
    const key = built.redirect !== "" ? `file:${built.redirect}` : "console";
    if (state.stderrNotice === key) return;
    state.stderrNotice = key;
    if (built.redirect !== "") {
        controller.ctx.logger.info(`dsh-chrome-mcp(${controller.config.serverName}): bridge stderr → ${built.redirect}`);
    } else {
        controller.ctx.logger.info(`dsh-chrome-mcp(${controller.config.serverName}): bridge stderr → console (echo)`);
    }
}
