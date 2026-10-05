/**
 * Chrome discovery — the candidate list.
 *
 * Where discovery looks before anything is picked: the platform's stable-channel
 * Chrome locations (mirroring upstream puppeteer's, WSL Windows-side `/mnt/c/…`
 * deliberately absent) and the ordered candidate list one run folds together —
 * row-config `chromePaths`, then the saved rows' ids, then the selection. The
 * probes over that list live in ./scan.ts; the `--version` probe itself in
 * ./probe.ts.
 */
import type { ChromeMcpConfig } from "../types/index.js";


/**
 * Google Chrome stable-channel locations probed by discovery when
 * `chromePath` is empty — mirrors the upstream (puppeteer) system-channel
 * resolution. WSL Windows-side locations (`/mnt/c/...`) are deliberately
 * absent: the interop launch cannot work (see .probe), and reporting a found
 * Windows binary as healthy would be a false negative for the known
 * executable-missing error. Unknown platforms probe nothing.
 */
export const DEFAULT_CHROME_PATHS = {
    linux: [
        "/opt/google/chrome/chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/local/bin/google-chrome",
        "google-chrome"
    ],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
    ]
};

/** The default discovery candidate list for one platform; [] probes nothing. */
export function defaultChromePaths(platform: NodeJS.Platform = process.platform): string[] {
    const candidates = DEFAULT_CHROME_PATHS[platform as keyof typeof DEFAULT_CHROME_PATHS];
    return Array.isArray(candidates) ? [...candidates] : [];
}

/**
 * Every path one executable run probes: the row-config candidate list (default
 * the platform list), then the ids the saved rows carry, then the current
 * selection — deduplicated, in this order, so the list reads "what the profile
 * configures, then what the card saved, then what runs".
 * @param entry - validated row config (`chromePaths` is the candidate list).
 * @param savedIds - the saved rows' ids, in row order (see ./catalog.ts).
 * @param effectivePath - the currently selected path, always kept in the list.
 */
export function chromeExecutableCandidates(
    entry: Pick<ChromeMcpConfig, "chromePaths">,
    savedIds: readonly string[] = [],
    effectivePath = ""
): string[] {
    const rowPaths = Array.isArray(entry?.chromePaths) ? entry.chromePaths : [];
    const saved = Array.isArray(savedIds) ? savedIds : [];
    const seen = new Set<string>();
    const candidates: string[] = [];
    const push = (value: unknown): void => {
        const path = String(value ?? "").trim();
        if (path === "" || seen.has(path)) return;
        seen.add(path);
        candidates.push(path);
    };
    for (const path of rowPaths) push(path);
    for (const path of saved) push(path);
    push(effectivePath);
    return candidates;
}
