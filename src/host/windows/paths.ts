/**
 * Windows Chrome run — path mapping, locate, and profile/profile-root helpers.
 *
 * The pure half of the run: the drive-letter spelling mapped onto the WSL
 * interop mount, the located executable, the Windows-native profile directory
 * (never one rooted in the WSL checkout — 9P cannot carry Chrome's SQLite/
 * singleton locks), the LOCALAPPDATA root the profile hangs under, and the
 * project directory that roots the workspace `.chrome` view. Every one is
 * injectable or takes its own answer so a test never depends on the machine it
 * runs on. The orchestrator lives in ./run.ts; the workspace-view link in
 * ./link.ts; the raw net/spawn seams in ./spawn.ts; the connect address and
 * connect-mode flag in ./connect-flags.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { WINDOWS_CHROME_CANDIDATES, WINDOWS_CHROME_PROFILE_DIRNAME } from "../constants.js";

/**
 * The Windows spelling mapped onto the interop mount (`C:\Program Files\…` →
 * `/mnt/c/Program Files/…`), which is the form WSL can stat. A path already
 * spelled as the mount maps to itself — the mount spelling is what the WSL side
 * can stat and therefore what a saved row or the row config may carry — and a
 * path that is neither maps nowhere and yields "".
 *
 * A path may have been written or copied shell-style, where a space is escaped
 * (`Program\ Files`). Such a backslash escapes the space that follows it and is
 * not a separator, so it folds away to the plain space first; every other
 * backslash is a Windows separator and folds to a slash. Turning one space
 * escape blindly into a slash produced `Program/ Files` — a path that exists
 * nowhere and answers `not-found` for a Chrome the run had actually located
 * (measured live 2026-10-12 against a saved mount-spelled selection).
 */
export function windowsPathToMount(path: unknown): string {
    if (typeof path !== "string") return "";
    const candidate = path.trim().replace(/\\ /gu, " ").replace(/\\/gu, "/");
    const windows = candidate.match(/^([a-z]):\/(.*)$/iu);
    if (windows !== null) return `/mnt/${windows[1].toLowerCase()}/${windows[2]}`;
    const mounted = candidate.match(/^\/mnt\/([a-z])\/(.*)$/iu);
    if (mounted === null) return "";
    return `/mnt/${mounted[1].toLowerCase()}/${mounted[2]}`;
}

/**
 * Locate the Windows-side Chrome through the interop mount: the first candidate
 * whose mount path exists, "" when this machine carries none of them. The
 * returned path keeps its **Windows** spelling — it is what the `start`
 * invocation takes and what the card names.
 */
export function findWindowsChromeExecutable(
    exists: (path: string) => boolean = (path: string) => existsSync(path),
    candidates: readonly string[] = WINDOWS_CHROME_CANDIDATES
): string {
    return findWindowsChromeExecutables(exists, candidates)[0] ?? "";
}

/**
 * Every Windows-side executable this host carries, in the list's own preference
 * order and in its **Windows** spelling — the whole located set, not only the
 * first. This is what the executable run folds into its candidate list, so the
 * picker offers the Windows browser instead of hiding it. A machine that carries
 * none of them answers nothing, so the list is what is installed here, never a
 * fixed set of install locations. Nothing on the list is ever spawned from WSL
 * (see `blockedForPlatform`); it is offered so that the **Prelaunch Windows
 * Chrome** run can be pointed at the one the picker selected.
 */
export function findWindowsChromeExecutables(
    exists: (path: string) => boolean = (path: string) => existsSync(path),
    candidates: readonly string[] = WINDOWS_CHROME_CANDIDATES
): string[] {
    const found: string[] = [];
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const path = typeof candidate === "string" ? candidate.trim() : "";
        if (path === "" || found.includes(path)) continue;
        if (exists(windowsPathToMount(path))) found.push(path);
    }
    return found;
}

/** Cached answer of the Windows-side profile root (`windowsChromeLocalAppData`). */
let cachedLocalAppData: string | undefined;

/**
 * The Windows-side profile directory: `<localAppData>\<dir>\.chrome[-<port>]`.
 * The profile has to live on the Windows filesystem — Chrome takes real locks
 * for its SQLite tables and its singleton socket, and the WSL-side directories
 * Windows sees through the interop mount (9P) cannot carry them: a profile
 * rooted there creates every table as a zero-byte file, never answers the
 * singleton lock, and shows "an error occurred while opening your profile" on
 * every launch (measured live 2026-10-04 against Chrome 154). "" answers when
 * LOCALAPPDATA is not there.
 */
export function windowsChromeProfileDir(localAppData: unknown, leaf = ".chrome"): string {
    const root = typeof localAppData === "string" ? localAppData.trim().replace(/[\\/]+$/u, "") : "";
    if (root === "") return "";
    const profile = String(leaf ?? "").replace(/[\\/]+/gu, "");
    if (profile === "") return "";
    return `${root}\\${WINDOWS_CHROME_PROFILE_DIRNAME}\\${profile}`;
}

/**
 * Resolves `%LOCALAPPDATA%` on the Windows side through the Known Folder API
 * (never the inherited environment — the interop hand-off drops it, so
 * `echo %LOCALAPPDATA%` comes back empty), cached across the process:
 * powershell answers it exactly once per host.
 */
export function windowsChromeLocalAppData(): string {
    if (typeof cachedLocalAppData === "string") return cachedLocalAppData;
    try {
        const out = execFileSync(
            "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('LocalApplicationData')"],
            { encoding: "utf8", timeout: 5000 }
        );
        const value = String(out).trim();
        cachedLocalAppData = value;
        return value;
    } catch {
        cachedLocalAppData = "";
        return "";
    }
}

/**
 * The directory the Windows run roots its profile view under — the project
 * whose checkout the run answers: the row-config `cwd`, else the **live
 * session workspace** (the run answers to the GUI the user is driving, not to
 * whatever directory `dsh web` happened to be launched from — a run rooted at
 * `~` links `~/.chrome` instead of the workspace), else the host's own cwd.
 * @param configCwd - the row-config `cwd`, "" when unset.
 * @param sessions - the sessions service, resolved optionally.
 * @param hostCwd - the host process' cwd.
 */
export function windowsChromeProjectDir(configCwd: unknown, sessions: unknown, hostCwd: string): string {
    if (typeof configCwd === "string" && configCwd.trim() !== "") return configCwd.trim();
    if (sessions === null || typeof sessions !== "object") return hostCwd;
    const list = (sessions as { list?: () => unknown }).list;
    if (typeof list !== "function") return hostCwd;
    let live = "";
    let best = -1;
    for (const session of (list.call(sessions) ?? []) as unknown[]) {
        const header = (session as { header?: unknown } | undefined)?.header as
            { cwd?: unknown; createdAt?: unknown } | undefined;
        const cwd = typeof header?.cwd === "string" ? header.cwd.trim() : "";
        if (cwd === "") continue;
        const createdAt = Number.isFinite(header?.createdAt) ? Number(header?.createdAt) : 0;
        if (createdAt >= best) {
            best = createdAt;
            live = cwd;
        }
    }
    return live !== "" ? live : hostCwd;
}

