/**
 * Windows Chrome run — the orchestrator behind the card's **Open Windows
 * Chrome** button (and the `prelaunch_windows_chrome` tool).
 *
 * Driving the Windows browser in connect mode is the only Windows path ever
 * measured to work: launch it with `--remote-debugging-port=<P>` and a dedicated
 * profile, then let the bridge connect to `http://127.0.0.1:<P>` instead of
 * launching anything locally. This module sequences the whole run — locate,
 * prove the prereq (the mirrored-loopback reachability), pick the port, launch,
 * wait for the port to bind — and answers through one state union. The pieces it
 * drives live alongside it: ./paths.ts (map + locate + profile directory),
 * ./link.ts (the workspace `.chrome` view), ./connect-flags.ts (the address +
 * the connect-mode flag), ./spawn.ts (the raw reachability sample + interop
 * launch). Every half is injectable so tests never depend on the machine.
 *
 * Launching the Windows `chrome.exe` in *launch* mode stays out entirely (hard
 * constraint — the debug pipes do not survive the interop boundary), as does
 * the default profile (an in-use one silently ignores the port) and the
 * `cmd.exe /c start` wrapper (it never returns while the browser lives). The run
 * never kills what it started: closing the browser belongs to the user, and a
 * connect-mode bridge survives a browser restart. The field evidence behind each
 * choice is `.probe/windows-chrome-connect-probe.log`.
 *
 * A launched window also carries its own explanation: the launch hands the
 * browser a packaged landing page (./landing.ts) rendered with the run's port,
 * connect address and profile directory. It is not a precondition — every
 * landing failure is "" and the launch goes ahead exactly as it did before — but
 * a window that opens with nothing on screen reads as a malfunction, which is
 * what the page is for.
 */
import { existsSync } from "node:fs";

import {
    WINDOWS_CHROME_CANDIDATES,
    WINDOWS_CHROME_FIRST_RUN_FLAGS,
    WINDOWS_CHROME_POLL_MS,
    WINDOWS_CHROME_PORT,
    WINDOWS_CHROME_PORT_POOL,
    WINDOWS_CHROME_PREREQ_ERROR,
    WINDOWS_CHROME_PREREQ_PORTS,
    WINDOWS_CHROME_SAMPLE_MS,
    WINDOWS_CHROME_START_CWD,
    WINDOWS_CHROME_WAIT_MS
} from "../constants.js";
import { firstLine } from "../status.js";
import type { WindowsChromeLinkAnswer, WindowsChromeRun } from "../types/index.js";

import { browserUrlFlagPort, windowsChromeUrl } from "./connect-flags.js";
import { windowsChromeLandingUrl } from "./landing.js";
import { linkWindowsChromeProfile } from "./link.js";
import { findWindowsChromeExecutable, windowsChromeLocalAppData, windowsChromeProfileDir, windowsPathToMount } from "./paths.js";
import { defaultReachable, defaultStart } from "./spawn.js";

/** Everything {@link runWindowsChromeConnect} consults; every field defaults
 * to what the running host actually is. */
export type WindowsChromeRunOptions = {
    /** Locates the Windows executable through the interop mount. Defaults to
     * `existsSync`. */
    exists?: (path: string) => boolean;
    /** The Windows-side profile root (%LOCALAPPDATA%). Defaults to the Known
     * Folder API answer, cached per host. */
    localAppData?: string;
    /** The workspace `.chrome` view refresh; defaults to `linkWindowsChromeProfile`.
     * Injected so tests never touch the real filesystem. */
    linkProfile?: (linkPath: string, profileWin: string) => WindowsChromeLinkAnswer;
    /** The project directory the Windows-side profile directory hangs under.
     * Defaults to `process.cwd()`. */
    cwd?: string;
    /** The Windows executables to look for, in preference order. */
    candidates?: readonly string[];
    /** The extra-flags list the bridge currently launches with. A live
     * `--browserUrl` entry inside it is re-checked instead of re-launched
     * (idempotency: a second click never opens a second window or duplicates
     * the flag). */
    currentFlags?: readonly string[];
    /** The debugging-port pool: first entry is the preferred port, later
     * entries only used when an earlier one already answers reachable. */
    ports?: readonly number[];
    /** Ports only Windows listens on — the prereq reachability probe. */
    prereqPorts?: readonly number[];
    /** The Windows-side working directory the launch runs with. Omit/skip when
     * it is not there. */
    startCwd?: string;
    /** Answers whether `host:port` accepts a connection right now. */
    reachable?: (host: string, port: number) => Promise<boolean>;
    /** Launches the executable and resolves the moment the OS accepted the
     * process; rejects with the reason when the launch itself failed. */
    start?: (executable: string, args: string[], cwd: string | undefined) => Promise<void>;
    /** Writes the landing page beside the profile directory and answers the
     * `file:///…` URL to open in the launched window ("" = launch with no
     * page). Defaults to the packaged page rendered with this run's answers;
     * injected so a unit run never writes through the interop mount. */
    landing?: (profileDir: string, url: string, port: number) => string;
    /** How long to wait for the launched browser to bind its port. */
    waitMs?: number;
    /** Poll cadence while waiting. */
    pollMs?: number;
    /** One reachability sample's timeout. */
    sampleMs?: number;
};

/**
 * The whole **Prelaunch Windows Chrome** run, in order:
 *
 * 1. locate a Windows Chrome/Edge — none answers `not-found`;
 * 2. prove the prereq — one Windows-only port must answer reachable, or
 *    nothing is launched and the answer is `unreachable` carrying the one
 *    manual step (mirrored networking);
 * 3. pick the port — the preferred one when it is free, else the first free
 *    entry of the pool (`WINDOWS_CHROME_PORT_POOL`); a listener already
 *    carrying connect mode means the address is live and nothing is launched;
 * 4. launch by exec'ing the located executable through the interop mount,
 *    with `--remote-debugging-port=<P>`, a dedicated profile directory under
 *    the project (never the default profile: an in-use default profile
 *    silently ignores the port), the first-run-page flags and the landing page
 *    that states what the window is for ("" = no page, never a reason for the
 *    launch not to happen);
 * 5. wait for the port to come up — `connected` when it does, `unreachable`
 *    (with its own error) when it never binds.
 *
 * The run never kills what it started: closing the browser belongs to the
 * user, and a bridge in connect mode survives a browser restart.
 *
 * @param options - what to consult (every half injectable).
 */
export async function runWindowsChromeConnect(options: WindowsChromeRunOptions = {}): Promise<WindowsChromeRun> {
    const exists = typeof options.exists === "function" ? options.exists : (path: string) => existsSync(path);
    const cwd = typeof options.cwd === "string" ? options.cwd : process.cwd();
    const candidates = Array.isArray(options.candidates) ? options.candidates : WINDOWS_CHROME_CANDIDATES;
    const ports = (Array.isArray(options.ports) ? options.ports : [...WINDOWS_CHROME_PORT_POOL]).map((port) => Math.trunc(port));
    const prereqPorts = Array.isArray(options.prereqPorts) ? options.prereqPorts : [...WINDOWS_CHROME_PREREQ_PORTS];
    const startCwd = typeof options.startCwd === "string" ? options.startCwd : WINDOWS_CHROME_START_CWD;
    const waitMs = Number.isFinite(options.waitMs) ? Number(options.waitMs) : WINDOWS_CHROME_WAIT_MS;
    const pollMs = Number.isFinite(options.pollMs) ? Number(options.pollMs) : WINDOWS_CHROME_POLL_MS;
    const sampleMs = Number.isFinite(options.sampleMs) ? Number(options.sampleMs) : WINDOWS_CHROME_SAMPLE_MS;
    const reachable = (host: string, port: number): Promise<boolean> =>
        typeof options.reachable === "function"
            ? Promise.resolve(options.reachable(host, port)).then((value) => value === true)
            : defaultReachable(host, port, sampleMs);
    const start = (command: string, args: string[], cwdValue: string | undefined): Promise<void> =>
        typeof options.start === "function" ? Promise.resolve(options.start(command, args, cwdValue)) : defaultStart(command, args, cwdValue);
    // The profile root (the Windows-side LOCALAPPDATA) is only needed on the
    // branches that connect, so it resolves lazily and stays cached.
    const localAppData = (): string =>
        typeof options.localAppData === "string" ? options.localAppData : windowsChromeLocalAppData();
    const linkProfile = (linkPath: string, profileWin: string): WindowsChromeLinkAnswer =>
        typeof options.linkProfile === "function" ? options.linkProfile(linkPath, profileWin) : linkWindowsChromeProfile(linkPath, profileWin);
    const landing = (profileWin: string, connectUrl: string, portValue: number): string =>
        typeof options.landing === "function" ? options.landing(profileWin, connectUrl, portValue) : windowsChromeLandingUrl(profileWin, connectUrl, portValue);
    // The workspace view the successful run keeps pointing at its profile —
    // the same `<project>/.chrome` the **Flags WSL** recommended flag names.
    const profileLinkPath = `${cwd.replace(/[\\/]+$/gu, "")}/.chrome`;

    if (ports.length === 0) ports.push(WINDOWS_CHROME_PORT);

    // 1. locate.
    const executable = findWindowsChromeExecutable(exists, candidates);
    if (executable === "") {
        return {
            state: "not-found",
            port: 0,
            url: "",
            error: `no Windows Chrome found (checked: ${Array.isArray(candidates) ? candidates.join(", ") : ""})`,
            profileDir: ""
        };
    }

    // 2. prereq: the Windows loopback has to be reachable before anything is
    // launched. Nothing reachable means no launch — the window would be dead
    // weight, and the run would have paid for a browser it cannot drive.
    let prereqOk = false;
    for (const port of prereqPorts) {
        if (await reachable("127.0.0.1", port)) {
            prereqOk = true;
            break;
        }
    }
    if (!prereqOk) return { state: "unreachable", port: 0, url: "", profileDir: "", error: WINDOWS_CHROME_PREREQ_ERROR };

    // 3. port. A live `--browserUrl` entry already answers: re-check it and
    // settle on it without a second launch when it still holds.
    const livePort = browserUrlFlagPort(options.currentFlags);
    if (livePort > 0 && (await reachable("127.0.0.1", livePort))) {
        // The already-live session is profiled in the same per-port directory a
        // launch would have chosen, so the workspace view keeps pointing at
        // whatever is actually running.
        const liveLeaf = livePort === WINDOWS_CHROME_PORT ? ".chrome" : `.chrome-${String(livePort)}`;
        const liveProfileDir = windowsChromeProfileDir(localAppData(), liveLeaf);
        return {
            state: "connected",
            port: livePort,
            url: windowsChromeUrl(livePort),
            error: "",
            profileDir: liveProfileDir,
            profileLink: linkProfile(profileLinkPath, liveProfileDir)
        };
    }
    const pool = livePort > 0 ? [livePort, ...ports.filter((port) => port !== livePort)] : ports;
    let port = 0;
    for (const candidate of pool) {
        if (!(await reachable("127.0.0.1", candidate))) {
            port = candidate;
            break;
        }
    }
    if (port === 0) port = pool[pool.length - 1];

    // 4. profile + launch. The profile directory is Windows-side (a profile
    // rooted in the WSL checkout cannot carry Chrome's locks, and a profile
    // that cannot lock answers "an error occurred while opening your profile");
    // it is never the default profile (an in-use one silently ignores the
    // port); and it never goes through the `cmd.exe /c start` wrapper (see
    // ./spawn.ts: under interop that wrapper never returns while the browser
    // lives, and the whole run silently stalls). The locate answer is a Windows
    // spelling (what the card may quote); interop execs through the mount, so
    // the launch maps it back first.
    const leaf = port === WINDOWS_CHROME_PORT ? ".chrome" : `.chrome-${String(port)}`;
    const profileDir = windowsChromeProfileDir(localAppData(), leaf);
    if (profileDir === "") {
        return {
            state: "launch-failed",
            port,
            url: "",
            profileDir: "",
            error: "cannot derive the Windows-side profile directory: LOCALAPPDATA did not answer"
        };
    }
    // The launch's argv: the port, the profile, the first-run flags, and — last
    // — one positional URL, the landing page that says what this window is for.
    // A page that could not be rendered or written answers "" and simply drops
    // out of argv: the run's answer never depends on prose.
    const url = windowsChromeUrl(port);
    const landingUrl = landing(profileDir, url, port);
    try {
        await start(
            windowsPathToMount(executable) || executable,
            [
                `--remote-debugging-port=${String(port)}`,
                `--user-data-dir=${profileDir}`,
                // A brand-new profile is a first run: without these, Windows
                // Chrome opens the welcome tab and the search-engine chooser
                // and connect mode never clicks past them.
                ...WINDOWS_CHROME_FIRST_RUN_FLAGS,
                ...(landingUrl === "" ? [] : [landingUrl])
            ],
            exists(startCwd) ? startCwd : undefined
        );
    } catch (error) {
        return {
            state: "launch-failed",
            port,
            url: "",
            profileDir: "",
            error: `could not start Windows Chrome: ${firstLine(error instanceof Error ? error.message : String(error))}`
        };
    }

    // 5. wait for the browser to bind its port. A browser that never binds it
    // is not reachable, so the answer is the prereq's failure to be useful.
    const deadline = Date.now() + waitMs;
    for (;;) {
        if (await reachable("127.0.0.1", port)) {
            return {
                state: "connected",
                port,
                url,
                error: "",
                profileDir,
                profileLink: linkProfile(profileLinkPath, profileDir)
            };
        }
        if (Date.now() >= deadline) {
            return {
                state: "unreachable",
                port,
                url: "",
                profileDir: "",
                error: `Windows Chrome started but did not open a debugging port on 127.0.0.1:${String(port)} — ${WINDOWS_CHROME_PREREQ_ERROR}`
            };
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
}

