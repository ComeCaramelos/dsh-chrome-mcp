/**
 * Host half — where the plugin is running: is this Linux host a Windows
 * Subsystem for Linux instance, and does one executable path name a Windows
 * binary rather than a Linux one.
 *
 * The two answers only ever combine into one warning. Launching a Windows
 * `chrome.exe` from WSL cannot work (`.probe/`, AGENTS.md): the debug pipes
 * `chrome-devtools-mcp` opens do not survive the interop boundary, and the
 * debugging port it reads from `DevToolsActivePort` stays bound to the Windows
 * loopback, unreachable across the WSL2 NAT bridge. It even *seems* to work: the
 * `--version` probe answers successfully, so a broken selection hides behind a
 * healthy pill until the first tool call. That is why the pair is surfaced on
 * the card as its own notice rather than through the error dot: nothing is
 * failing yet, the required configuration is simply different.
 *
 * Both probes stay pure and injectable (`platform`, `env`, `exists`) so the
 * tests never depend on the machine they run on.
 */
import { existsSync } from "node:fs";

import { WINDOWS_EXE_PATTERN, WINDOWS_PATH_PATTERN, WSL_ENV_VARS, WSL_INTEROP_MARKER } from "./constants.js";

/** Everything {@link isWindowsSubsystemForLinux} consults; each field defaults
 * to what the running process actually is. */
export type PlatformProbe = {
    /** Defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Variable lookup; defaults to `process.env`. When a source is supplied its
     * silence is the answer — the marker file is then not consulted, so a host
     * that resolves its launch environment gets one deterministic answer
     * instead of one that depends on the machine it booted on. */
    env?: (name: string) => unknown;
    /** File-presence lookup used only when `env` is not supplied (a bare call
     * with no host to resolve against); defaults to the interop marker. */
    exists?: (path: string) => boolean;
};

/**
 * True when `path` names a Windows binary — one that lives on the interop mount
 * (`/mnt/<drive>/…`), in a Windows spelling (`\\host\…`, `C:\…`), or simply
 * carries the PE suffix. A Linux path is never Windows-side, and a candidate
 * list built from {@link DEFAULT_CHROME_PATHS} never matches.
 * @param path - one executable path as selected.
 */
export function isWindowsExecutablePath(path: unknown): boolean {
    if (typeof path !== "string") return false;
    const candidate = path.trim();
    if (candidate === "") return false;
    return WINDOWS_PATH_PATTERN.test(candidate) || WINDOWS_EXE_PATTERN.test(candidate);
}

/**
 * True when the current process runs inside Windows Subsystem for Linux: a
 * Linux kernel plus the WSL markers. A non-Linux platform (a plain Windows
 * host) is never "under WSL", whatever its environment says.
 * @param probe - what to consult (defaults to this process).
 */
export function isWindowsSubsystemForLinux(probe: PlatformProbe = {}): boolean {
    const platform = probe.platform ?? process.platform;
    if (platform !== "linux") return false;
    if (probe.env !== void 0) {
        return WSL_ENV_VARS.some((name) => {
            const value = probe.env!(name);
            return typeof value === "string" && value.trim() !== "";
        });
    }
    return (probe.exists ?? ((candidate: string) => existsSync(candidate)))(WSL_INTEROP_MARKER);
}

/**
 * The interop trap the card warns about: we are under WSL **and** what is
 * selected is a Windows executable. Both halves are required — a Linux binary
 * selected on a Windows host is simply nothing to say.
 * @param path - the effective executable path.
 * @param probe - what to consult for the environment (defaults to this process).
 */
export function isWindowsExecutableUnderWsl(path: unknown, probe: PlatformProbe = {}): boolean {
    return isWindowsSubsystemForLinux(probe) && isWindowsExecutablePath(path);
}
