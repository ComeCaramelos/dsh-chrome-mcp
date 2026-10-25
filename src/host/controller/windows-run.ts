/**
 * Controller — the one Windows Chrome run.
 *
 * The whole Windows path the **Prelaunch Windows Chrome** surface drives (the
 * card button, the `prelaunch_windows_chrome` tool, and the async `resolve` of a
 * live `chrome-windows` connection), sequenced here against the injected run
 * half (./run.ts in ../windows). The run never kills what it started; everything
 * it answers lands in the live mirror's `windowsChromeStatus`, and the run
 * result is handed back to the caller — in the component model the browser is
 * driven by a connection, not by a bridge this row owns, so a successful run
 * writes no flag anywhere: the debugging URL belongs to the connection's own
 * answer, not to this row's configuration.
 *
 * Re-entry is cheap by construction: when a previous run already left the live
 * mirror connected, the URL it stated rides into `currentFlags`, and the
 * underlying run reuses that port when the browser behind it still answers —
 * so re-running is idempotent, never a second browser.
 */
import { firstLine } from "../status.js";
import { isWindowsExecutablePath } from "../platform.js";
import { windowsChromeProjectDir, withBrowserUrlFlag } from "../windows/index.js";
import type { WindowsChromeRun, WindowsChromeState } from "../types/index.js";
import { resolveLaunchFlags, resolveSelection } from "../values.js";

import { publishLive } from "./publish.js";
import type { Controller } from "./state.js";

/**
 * One **Prelaunch Windows Chrome** run. When the host is not WSL there is simply
 * nothing to drive and the answer is `not-applicable`; otherwise the state moves
 * through `launching` while the run (locate, prereq, launch, port) settles, and
 * the settled state is mirrored before the run is returned.
 */
export async function runWindowsChrome(controller: Controller): Promise<WindowsChromeRun> {
    const { state } = controller;
    if (!controller.wslHost) {
        state.live.windowsChromeStatus = { state: "not-applicable", port: 0, error: "" };
        publishLive(controller);
        return { state: "not-applicable", port: 0, url: "", profileDir: "", error: "" };
    }
    state.live.windowsChromeStatus = { state: "launching", port: state.live.windowsChromeStatus.port, error: "" };
    publishLive(controller);
    let currentFlags = resolveLaunchFlags(state.source(), controller.launchFlags);
    // A run answering from a mirror that stands connected carries its own URL in
    // — that is what makes re-entry (tool re-run, pool re-prepare) idempotent:
    // the underlying run reuses the live port instead of launching again.
    if (state.live.windowsChromeStatus.state === "connected" && state.live.windowsChromeStatus.port > 0) {
        currentFlags = withBrowserUrlFlag(currentFlags, `http://127.0.0.1:${state.live.windowsChromeStatus.port}`);
    }
    // The workspace that carries the run's `.chrome` view: the row-config `cwd`,
    // else the live session's workspace — the run answers the GUI the user is
    // driving, not the directory `dsh web` happened to be launched from (a view
    // rooted at `~` links `~/.chrome`) — else the host's own cwd.
    const projectDir = windowsChromeProjectDir(
        controller.config.cwd,
        controller.ctx.get("sessions") as { list?: () => unknown } | undefined,
        process.cwd()
    );
    // The executable the picker selected, when that selection is a Windows one:
    // what the run launches is then exactly what the card named, not the first
    // location the run happens to find. Nothing else stands in — a selection
    // that is not there answers by naming it — while a selection naming no
    // Windows executable (nothing picked, or a local one) leaves the run's own
    // locate in charge, exactly as it was.
    const selected = resolveSelection(state.source()).path;
    const candidates = isWindowsExecutablePath(selected) ? [selected] : void 0;
    let result: WindowsChromeRun;
    try {
        result = await controller.windowsChrome({
            cwd: projectDir,
            currentFlags,
            ...(candidates === void 0 ? {} : { candidates })
        });
    } catch (error) {
        result = { state: "launch-failed", port: 0, url: "", profileDir: "", error: firstLine(error instanceof Error ? error.message : String(error)) };
    }
    state.live.windowsChromeStatus = { state: result.state, port: result.port, error: firstLine(result.error) };
    if (result.state === "connected") {
        if (result.profileDir !== "") {
            if (result.profileLink === "kept") {
                // A real `.chrome` directory already sits at the view's spot:
                // kept untouched, the link never clobbers what is already there
                // — say it once, not on every run.
                if (!state.profileLinkKeptShown) {
                    state.profileLinkKeptShown = true;
                    controller.ctx.logger.warn(`dsh-chrome-mcp(${controller.config.serverName}): ${projectDir}/.chrome is an existing directory — the Windows profile stays at ${result.profileDir}, not linked into the checkout`);
                }
            } else {
                controller.ctx.logger.info(`dsh-chrome-mcp(${controller.config.serverName}): Windows Chrome profile ${result.profileDir}, workspace view ${projectDir}/.chrome`);
            }
        }
        state.live.lastError = "";
        publishLive(controller);
        return { state: result.state, port: result.port, url: result.url, profileDir: result.profileDir, error: "" };
    }
    state.live.lastError = firstLine(result.error);
    publishLive(controller);
    controller.ctx.logger.warn(`dsh-chrome-mcp(${controller.config.serverName}): Windows Chrome run did not connect: ${state.live.lastError}`);
    return { state: result.state, port: result.port, url: result.url, profileDir: result.profileDir, error: state.live.lastError };
}

/**
 * The kind-side half of the run: a live `chrome-windows` connection's async
 * `resolve` drives the launch through the same one-run-at-a-time chain the
 * button uses, and gets the run result back to turn into the connect-mode
 * stdio config.
 */
export async function prelaunchWindowsForConnection(controller: Controller): Promise<WindowsChromeRun> {
    const { state } = controller;
    const off: WindowsChromeState = "off";
    const failed: WindowsChromeState = "launch-failed";
    return state.runs
        .then(async () => (state.disposed ? { state: off, port: 0, url: "", profileDir: "", error: "the component was disposed" } : runWindowsChrome(controller)))
        .catch((error) => ({ state: failed, port: 0, url: "", profileDir: "", error: firstLine(error instanceof Error ? error.message : String(error)) }));
}
