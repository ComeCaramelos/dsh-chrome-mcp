/**
 * Chrome discovery — the scan and the check run that tie it together.
 *
 * What one executable run does: probe every candidate it has (the row-config
 * list, the saved rows' ids, the selection), publish the per-path answer, and
 * report the first runnable one. The candidate ordering lives in
 * ./candidates.ts; the `--version` probe + presence + identity helpers in
 * ./probe.ts.
 *
 * Upstream (`chrome-devtools-mcp`, via puppeteer) starts the browser only
 * LAZILY, on the first tool call — so without a probe of our own, a
 * Chrome-less host would show nothing until somebody called a tool. The scan
 * therefore probes eagerly: there is no "auto" mode, the scan lists what exists,
 * the card picks one of them, and what is picked stays picked.
 *
 * WSL NOTE: the executable the bridge *launches* has to be a Linux binary.
 * Launching the Windows chrome.exe through the WSL interop layer fails:
 * chrome-devtools-mcp connects with `pipe: true` (inherited fd 3/4), and
 * Windows-side processes cannot receive those pipes from WSL; the WebSocket
 * fallback hard-codes 127.0.0.1 in the DevToolsActivePort file, unreachable
 * across the WSL2 NAT bridge. Verified empirically 2025-09-19 (.probe/). What
 * the Windows side *is* good for is connect mode, so on a WSL host the Windows
 * executables join the candidate list as `blockedForPlatform` answers it —
 * visible, selectable, never spawned — and the run that drives them is the
 * **Prelaunch Windows Chrome** one. Never spawn a blocked candidate.
 */
import { flagsSkipProbe } from "../flags.js";
import { firstLine } from "../status.js";
import { readConfigField } from "../values.js";
import { windowsPathToMount } from "../windows/paths.js";
import type { ChromeExecutableStatus, ChromeMcpConfig } from "../types/index.js";

import { defaultChromePaths } from "./candidates.js";
import { identity, presentOnDisk, probeExecutable } from "./probe.js";

/**
 * What one run probes: every candidate it has — the row-config candidate list,
 * the paths the saved rows carry, and the current selection (see
 * {@link chromeExecutableCandidates}) — probed in that order.
 *
 * A candidate that runs answers with its `--version` line; one that is present
 * but not runnable (bad binary, a probe that timed out) keeps its place in the
 * list carrying the failure, so a broken pin stays visible instead of vanishing
 * into a red dot.
 *
 * - absent / not executable → dropped without a spawn,
 * - `blockedForPlatform` answers non-empty → **no spawn**: the candidate keeps
 *   its place carrying that reason as a `note`, never as a failure (the one case
 *   is a Windows `chrome.exe` on a WSL host, whose probe would start a browser
 *   instance it can never drive — see {@link WSL_WINDOWS_LAUNCH_ERROR}),
 * - two spellings of the same binary collapse into the first one seen.
 *
 * An empty candidate list resolves `[]` (nothing probed: unknown platform, or a
 * host patched down to nothing).
 *
 * @param candidates - candidate executable paths.
 * @param blockedForPlatform - answers a reason for a candidate this host must
 * never exec, `""` for one it may probe.
 */
export async function scanChromeExecutables(
    candidates: string[],
    blockedForPlatform: (candidate: string) => string = () => ""
): Promise<ChromeExecutableStatus[]> {
    const list = Array.isArray(candidates) ? candidates : [];
    const statuses: ChromeExecutableStatus[] = [];
    const seen = new Set<string>();
    for (const candidate of list) {
        const path = String(candidate ?? "").trim();
        if (path === "") continue;
        const blocked = blockedForPlatform(path);
        if (blocked !== "") {
            // Never spawned: what a blocked candidate would do is start a
            // browser this host could not drive. It keeps its place on the list
            // carrying that reason as a **note** — what gets reported is what
            // this host could not do with the path, not whether it is there, and
            // reporting it as a failure would read as a broken executable.
            //
            // The seen key folds through the interop mount, because the same
            // executable reaches this list in either spelling: the Windows one
            // the locate answers, and the mount one a saved row or the row config
            // can carry (the only spelling the WSL side can stat). One executable
            // answers once, under the first spelling seen.
            const mounted = windowsPathToMount(path);
            const key = `blocked\u0000${identity(mounted !== "" ? mounted : path)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            statuses.push({ path, version: "", error: "", note: blocked });
            continue;
        }
        if (!presentOnDisk(path)) continue;
        try {
            const version = await probeExecutable(path);
            const key = `${identity(path)}\u0000${version}`;
            if (seen.has(key)) continue;
            seen.add(key);
            statuses.push({ path, version, error: "", note: "" });
        } catch (error) {
            const code = (error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string")
                ? (error as NodeJS.ErrnoException).code
                : "";
            if (code === "ENOENT") continue;
            const key = identity(path);
            if (seen.has(key)) continue;
            seen.add(key);
            statuses.push({
                path,
                version: "",
                error: firstLine(error instanceof Error ? error.message : String(error)),
                note: ""
            });
        }
    }
    return statuses;
}

/**
 * Discover usable Google Chrome executables when nothing is fixed: probe every
 * candidate and report the first runnable one. Kept for its `Promise<string>`
 * contract (`src/index.ts` re-export, tests, diagnostics).
 * @param candidatePaths - candidate executable paths (default: platform list).
 * @param blockedForPlatform - answers a reason for a candidate this host must
 * never exec, `""` for one it may probe.
 * @returns the discovered executable version line.
 */
export async function discoverChrome(
    candidatePaths: string[],
    blockedForPlatform: (candidate: string) => string = () => ""
): Promise<string> {
    const candidates = (Array.isArray(candidatePaths) ? candidatePaths : defaultChromePaths())
        .map((candidate) => String(candidate ?? "").trim())
        .filter((candidate) => candidate !== "");
    if (candidates.length === 0) return "";
    const found = await scanChromeExecutables(candidates, blockedForPlatform);
    for (const status of found) {
        if (status.version !== "" && status.error === "") return status.version;
    }
    const broken = found.find((status) => status.error !== "");
    if (broken !== void 0) throw new Error(broken.error);
    // A note is the other half of "nothing answered": the candidate is there, it
    // is simply not launchable as a local executable from this host (the one
    // case is a Windows executable under WSL), and the note names the run that
    // drives it.
    const noted = found.find((status) => status.note !== "");
    if (noted !== void 0) {
        throw new Error(`Chrome executable not found: no executable detected for this host (checked: ${candidates.join(", ")}); ${noted.note}`);
    }
    throw new Error(`Chrome executable not found: no executable detected (checked: ${candidates.join(", ")})`);
}

/**
 * One check run — the public "did we find a runnable Chrome?" question:
 *
 * - `chromePath` non-empty → probe that executable (ENOENT → "Chrome
 *   executable not found: <path>"; non-zero → first stderr/stdout line;
 *   success → the version line).
 * - `chromePath` empty → run the scan over the candidate list (row config
 *   `chromePaths`, default {@link defaultChromePaths}) and report the first
 *   runnable entry. Nothing usable → the known executable-missing error;
 *   only-present-but-broken entries → that entry's failure.
 *   - the extra flags leave the check mute: they declare a connect mode
 *     (`--browserUrl` / `--browser-url` / `-u`, `--wsEndpoint` /
 *     `--ws-endpoint` / `-w`, `--autoConnect` / `--auto-connect`), name a
 *     config file (`--config`), or fix another `--channel` than the `stable`
 *     the candidate list models → resolve "": there is no local executable
 *     this check could honestly answer for.
 * - `blockedForPlatform` answers non-empty for what is selected → resolve "" with
 *   **no spawn**. A Windows `chrome.exe` on a WSL host is the case: its
 *   `--version` probe answers (which is why the selection looks healthy) but
 *   answering means attaching to the Windows browser session, and that *starts*
 *   a browser instance no tool call could drive
 *   ({@link WSL_WINDOWS_LAUNCH_ERROR}).
 *
 * A run that probes **nothing** (no candidates, a connect mode, a config file
 * or another channel standing in for the local executable, or a blocked path)
 * resolves "" — callers must treat that as "no evidence", never as health.
 *
 * @param entry - validated {@link ChromeMcpConfig}.
 * @param extraFlags - the flags list the bridge currently launches with;
 *   inspected for the entries that leave the check mute.
 * @param blockedForPlatform - answers a reason for a path this host must never
 *   exec, `""` for one it may probe.
 * @returns the executable version line, or "" when nothing is probed.
 */
export function checkChrome(
    entry: ChromeMcpConfig,
    extraFlags?: string[],
    blockedForPlatform: (candidate: string) => string = () => ""
): Promise<string> {
    // The two config fields read here are volatile, so what they carry is either a
    // reference or the value a caller handed in explicitly.
    const target = readConfigField(entry.chromePath, "").trim();
    if (target !== "") return blockedForPlatform(target) !== "" ? Promise.resolve("") : probeExecutable(target);
    const flags = extraFlags === void 0 ? readConfigField(entry.extraFlags, []) : extraFlags;
    if (flagsSkipProbe(flags)) {
        return Promise.resolve("");
    }
    return discoverChrome(entry.chromePaths, blockedForPlatform);
}
