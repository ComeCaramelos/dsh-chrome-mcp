/**
 * Windows Chrome run — the **landing page** the launched window opens.
 *
 * A window that appears for no visible reason looks like a malfunction, and the
 * honest answer to "why did a Chrome window just open?" is a paragraph of
 * explanation the bridge's argv cannot carry. So the run ships one: a packaged,
 * self-contained HTML page (`assets/prelaunch-windows-chrome.html`, the only
 * asset the plugin carries) rendered with the run's own answers and written next
 * to the Windows-side profile directory, so the window that opens *states* what
 * it is for — opened by the plugin from DSH so the bridge can drive it over the
 * debugging port, never a browsing session the user started.
 *
 * The file has to live on the **Windows** filesystem and be handed to the browser
 * as a `file:///…` URL, exactly like the profile directory it sits beside: the
 * WSL-side path is invisible to a Windows-side process. Nothing depends on it:
 * every answer is "" when the asset cannot be read, the write fails or LOCALAPPDATA
 * never answered, and a run without a landing page launches the same browser it
 * launched before — the page is a description of the window, not a precondition
 * of it. It is never opened on the re-attach branch (nothing was launched, so no
 * window was added), and it is opened exactly once per launch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { WINDOWS_CHROME_LANDING_ASSET, WINDOWS_CHROME_LANDING_BASENAME } from "../constants.js";

import { windowsPathToMount } from "./paths.js";

/** The run's own tokens in the packaged page, in the shape each one answers. */
type LandingTokens = { url: string; port: number; profile: string };

/** The packaged page, resolved once per process (see {@link packageRoot} for why
 * the lookup walks directories instead of trusting a depth). */
let cachedAsset: string | undefined;

/**
 * The package root, walked up from this module until a `package.json` shows up:
 * the emit sits under `lib/host/windows/`, so the asset's package-root-relative
 * path is the same whether the plugin was installed or linked from a checkout,
 * and a hard-coded `../../` would break the day the layout moves. "" answers when
 * the lookup runs out of directories (an exotic packaging), which is simply no
 * landing page.
 */
function packageRoot(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let hops = 0; hops < 8; hops += 1) {
        const manifest = `${dir}/package.json`;
        if (existsSync(manifest)) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return "";
}

/** The packaged page's path on this host, "" when the package carries none. */
export function windowsChromeLandingAsset(): string {
    if (typeof cachedAsset === "string") return cachedAsset;
    const root = packageRoot();
    const asset = root === "" ? "" : `${root}/${WINDOWS_CHROME_LANDING_ASSET}`;
    cachedAsset = asset !== "" && existsSync(asset) ? asset : "";
    return cachedAsset;
}

/** The one HTML entity escape the page needs: the profile path is the only
 * value that can carry markup characters (a user name with `&`, say). */
function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

/**
 * The packaged page, with the run's answers folded into its `{{TOKEN}}`s —
 * "" when the asset is not there. Values are escaped, tokens the page does not
 * carry are simply left alone, and a page whose write fails downstream is not
 * this function's problem: it answers the *rendered* text, nothing else.
 */
export function windowsChromeLandingHtml(tokens: Partial<LandingTokens> = {}): string {
    const asset = windowsChromeLandingAsset();
    if (asset === "") return "";
    let html: string;
    try {
        html = readFileSync(asset, "utf8");
    } catch {
        return "";
    }
    const port = Number.isFinite(tokens.port) ? String(Math.trunc(Number(tokens.port))) : "";
    const values: Record<string, string> = {
        URL: escapeHtml(typeof tokens.url === "string" ? tokens.url : ""),
        PORT: port,
        PROFILE: escapeHtml(typeof tokens.profile === "string" ? tokens.profile : "")
    };
    for (const [token, value] of Object.entries(values)) {
        html = html.split(`{{${token}}}`).join(value);
    }
    return html;
}

/**
 * The landing file's Windows path beside a profile directory:
 * `…\dsh-chrome-mcp\prelaunch-<port>.html`, a **sibling** of the profile rather
 * than a file inside it — Chrome owns everything inside its own profile
 * directory, and this page is not part of one.
 */
export function windowsChromeLandingPath(profileDir: unknown, port: number): string {
    const profile = typeof profileDir === "string" ? profileDir.trim().replace(/[\\/]+$/u, "") : "";
    if (profile === "") return "";
    const cut = Math.max(profile.lastIndexOf("\\"), profile.lastIndexOf("/"));
    if (cut <= 0) return "";
    const leaf = `${WINDOWS_CHROME_LANDING_BASENAME}-${String(Math.trunc(port))}.html`;
    return `${profile.slice(0, cut)}\\${leaf}`;
}

/**
 * A Windows path as a `file://` URL — the only form the launched browser reads
 * (the interop mount path is Linux-side, invisible to `chrome.exe`). No drive
 * letter answers "" (never a half-formed URL), and every path segment is
 * percent-encoded, since a user profile directory routinely carries spaces.
 */
export function windowsFileUrl(path: unknown): string {
    if (typeof path !== "string") return "";
    const candidate = path.trim().replace(/[\\/]+$/u, "");
    const match = candidate.match(/^([a-zA-Z]):[\\/](.*)$/u);
    if (match === null) return "";
    const segments = match[2]
        .split(/[\\/]+/u)
        .filter((segment) => segment !== "")
        .map((segment) => encodeURIComponent(segment));
    if (segments.length === 0) return "";
    return `file:///${match[1]}:/${segments.join("/")}`;
}

/**
 * The whole landing-page half of a launch: render the packaged page with this
 * run's answers, write it beside the profile directory through the interop
 * mount, and answer the `file:///…` URL to hand the browser ("" = launch with
 * no page). Every failure is silent on purpose — the page explains the window,
 * it never gates it.
 * @param profileDir - the Windows-side profile directory the launch carries.
 * @param url - the connect address the window answers for.
 * @param port - the debugging port that launch picked.
 * @param write - the filesystem half: place `html` at the **mount** path and
 * answer whether it actually landed. Defaults to creating the directory and
 * writing the file through the interop mount; injected so a test never depends
 * on the machine it runs on (the mount is never inside the checkout, and the
 * agent's own file sandbox denies it outright).
 */
export function windowsChromeLandingUrl(
    profileDir: unknown,
    url: unknown,
    port: unknown,
    write?: (mountPath: string, html: string) => boolean
): string {
    const number = Number.isFinite(port) ? Math.trunc(Number(port)) : 0;
    const path = windowsChromeLandingPath(profileDir, number);
    if (path === "") return "";
    const html = windowsChromeLandingHtml({
        url: typeof url === "string" ? url : "",
        port: number,
        profile: typeof profileDir === "string" ? profileDir : ""
    });
    if (html === "") return "";
    const mount = windowsPathToMount(path);
    if (mount === "") return "";
    const place = (mountPath: string, content: string): boolean => {
        try {
            mkdirSync(dirname(mountPath), { recursive: true });
            writeFileSync(mountPath, content, "utf8");
        } catch {
            return false;
        }
        return true;
    };
    if (!(typeof write === "function" ? write(mount, html) : place(mount, html))) return "";
    return windowsFileUrl(path);
}
