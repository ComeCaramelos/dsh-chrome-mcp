/**
 * Controller — the one Windows Chrome run.
 *
 * The whole Windows path the card's **Prelaunch Windows Chrome** button drives,
 * sequenced here against the injected run half (./run.ts in ../windows). Success
 * ends with the connect entry written into the *saved* flags (replace-by-key, so
 * what the bridge launches with afterwards is exactly what the card claims), and
 * the run never kills what it started. Everything it answers lands in the base
 * layer's `windowsChromeStatus`; the answer is read back off that mirror, never
 * off the promise.
 */
import { sameFlags } from "../flags.js";
import { firstLine } from "../status.js";
import { windowsChromeProjectDir, withBrowserUrlFlag } from "../windows/index.js";
import type { WindowsChromeRun } from "../types/index.js";

import { applyFlags } from "./bridge-run.js";
import { persistExtraFlags } from "./persist.js";
import type { Controller } from "./state.js";

/**
 * One **Prelaunch Windows Chrome** run. When the host is not WSL there is simply
 * nothing to drive and the answer is `not-applicable`; otherwise the state moves
 * through `launching` while the run (locate, prereq, launch, port) settles, and
 * a connect that lands writes the flag through the ordinary bridge path.
 */
export async function runWindowsChrome(controller: Controller): Promise<void> {
    const { state } = controller;
    if (!controller.wslHost) {
        state.entry.windowsChromeStatus = { state: "not-applicable", port: 0, error: "" };
        return;
    }
    state.entry.windowsChromeStatus = { state: "launching", port: state.entry.windowsChromeStatus.port, error: "" };
    const live = state.source();
    const currentFlags = Array.isArray(live.extraFlags) ? live.extraFlags : state.runningFlags;
    let result: WindowsChromeRun;
    // The workspace that carries the run's `.chrome` view: the row-config `cwd`,
    // else the live session's workspace — the run answers the GUI the user is
    // driving, not the directory `dsh web` happened to be launched from (a view
    // rooted at `~` links `~/.chrome`) — else the host's own cwd.
    const projectDir = windowsChromeProjectDir(
        controller.config.cwd,
        controller.ctx.get("sessions") as { list?: () => unknown } | undefined,
        process.cwd()
    );
    try {
        result = await controller.windowsChrome({
            cwd: projectDir,
            currentFlags
        });
    } catch (error) {
        result = { state: "launch-failed", port: 0, url: "", profileDir: "", error: firstLine(error instanceof Error ? error.message : String(error)) };
    }
    state.entry.windowsChromeStatus = { state: result.state, port: result.port, error: firstLine(result.error) };
    if (result.state === "connected" && result.url !== "") {
        if (result.profileDir !== "") {
            if (result.profileLink === "kept") {
                // A real `.chrome` directory already sits at the view's spot:
                // kept untouched, the link never clobbers what is already there
                // — say it once, not on every run.
                if (!state.profileLinkKeptShown) {
                    state.profileLinkKeptShown = true;
                    controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): ${projectDir}/.chrome is an existing directory — the Windows profile stays at ${result.profileDir}, not linked into the checkout`);
                }
            } else {
                controller.ctx.logger.info(`chrome-devtools-mcp(${controller.config.serverName}): Windows Chrome profile ${result.profileDir}, workspace view ${projectDir}/.chrome`);
            }
        }
        const next = withBrowserUrlFlag(currentFlags, result.url);
        state.entry.lastError = "";
        if (!sameFlags(next, state.runningFlags)) {
            // The bridge now connects instead of launching — the same flag path
            // the extra-flags editor writes through. Persisting is what keeps
            // connect mode across a reconnect and the next dsh start.
            controller.ctx.logger.info(`chrome-devtools-mcp(${controller.config.serverName}): Windows Chrome connected at ${result.url} — switching the bridge to connect mode`);
            applyFlags(controller, next);
            void persistExtraFlags(controller, next);
        }
        return;
    }
    state.entry.lastError = firstLine(result.error);
    controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): Windows Chrome run did not connect: ${state.entry.lastError}`);
}
