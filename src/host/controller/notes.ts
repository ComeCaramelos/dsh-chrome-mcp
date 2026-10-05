/**
 * Controller — base-layer announcements.
 *
 * The two notes the base layer carries that a client can only learn from here:
 * the resolved selection (with the static WSL + Windows-executable state, keyed
 * on the *selection*, not a probe), and where the bridge console output goes.
 */
import type { BridgeStderrNotice } from "../types/index.js";

import { flagsSkipCheck } from "../flags.js";
import { isWindowsExecutablePath } from "../platform.js";

import type { Controller } from "./state.js";

/**
 * Publish the resolved selection into the base layer — with the one state the
 * client can only learn from here, and with the static notice that goes with it.
 * The Windows-executable state is keyed on the *selection*, not on any probe: a
 * Windows binary answers `--version` just fine across the interop boundary, so a
 * healthy-looking pill is exactly what a broken Windows selection looks like
 * until the first tool call fails.
 */
export function noteSelection(controller: Controller): void {
    const { state } = controller;
    state.entry.effectiveChromePath = state.runningChromePath;
    state.entry.effectiveSource = state.runningChromeSource;
    const windowsUnderWsl = !flagsSkipCheck(state.runningFlags) && controller.wslHost && isWindowsExecutablePath(state.runningChromePath);
    state.entry.wslWindowsExecutable = windowsUnderWsl;
    // The card has the full recipe; the log only needs the pointer, since a
    // headless host never sees the notice.
    if (windowsUnderWsl && !state.wslNoticeShown) {
        state.wslNoticeShown = true;
        controller.ctx.logger.warn(
            `chrome-devtools-mcp(${controller.config.serverName}): running under WSL with a Windows executable selected ("${state.runningChromePath}") — that binary cannot be launched from here; drive the Windows browser in connect mode instead (see the card's Windows executable notice)`
        );
    }
}

/**
 * Announce where the bridge's console output goes — one line per change of
 * state, keyed on what actually happened, so neither the "log" capture nor
 * a switch to console echo is silent. An unavailable redirect (no POSIX shell)
 * warns with the reason so the fallback is not mysterious.
 */
export function noteStderr(controller: Controller, built: BridgeStderrNotice): void {
    const { state } = controller;
    const key = built.redirect !== "" ? `file:${built.redirect}` : built.fallback !== "" ? `fallback:${built.fallback}` : "console";
    if (state.stderrNotice === key) return;
    state.stderrNotice = key;
    if (built.fallback === "platform") {
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): bridgeStderr="log" is unavailable on this platform (no POSIX shell wrapper) — bridge logs keep going to the console`);
    } else if (built.fallback === "shell") {
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): bridgeStderr="log" is unavailable (no /bin/sh was found) — bridge logs keep going to the console`);
    } else if (built.redirect !== "") {
        controller.ctx.logger.info(`chrome-devtools-mcp(${controller.config.serverName}): bridge stderr → ${built.redirect}`);
    } else {
        controller.ctx.logger.info(`chrome-devtools-mcp(${controller.config.serverName}): bridge stderr → console (echo)`);
    }
}
