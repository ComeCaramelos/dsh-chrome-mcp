/**
 * Chrome discovery — the candidate list.
 *
 * Where discovery looks before anything is picked: the platform's stable-channel
 * Chrome locations (mirroring upstream puppeteer's) and the ordered candidate
 * list one run folds together — row-config `chromePaths`, then whatever else this
 * host carries (on a WSL host: the Windows-side executables answering through the
 * interop mount, never spawned from here), then the saved rows' ids, then the
 * selection. The probes over that list live in ./scan.ts; the `--version` probe
 * itself in ./probe.ts.
 */
import type { ChromeMcpConfig } from "../types/index.js";


/**
 * Google Chrome stable-channel locations probed by discovery when
 * `chromePath` is empty — mirrors the upstream (puppeteer) system-channel
 * resolution. The Windows-side locations a WSL host reaches through the interop
 * mount are deliberately not mixed into the *platform* list (their spelling
 * belongs to the other side of the boundary); a WSL host's run folds them in
 * separately, as the candidates it offers without probing (see
 * `chromeExecutableCandidates`' `extraCandidates` and the never-spawn rule in
 * ./scan.ts). Unknown platforms probe nothing.
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
 * the platform list), then whatever else this host carries, then the ids the
 * saved rows carry, then the current selection — deduplicated, in this order,
 * so the list reads "what the profile configures, then what the machine carries,
 * then what the card saved, then what runs".
 * @param entry - validated row config (`chromePaths` is the candidate list).
 * @param savedIds - the saved rows' ids, in row order (see ./catalog.ts).
 * @param effectivePath - the currently selected path, always kept in the list.
 * @param extraCandidates - what this host carries beyond the configured list:
 * the Windows-side executables a WSL host reaches through the interop mount.
 * They join the list so the **Prelaunch Windows Chrome** run drives what the
 * picker picked rather than what it happens to locate first — and, offered
 * without being probed, they answer a note and never a version (see the
 * `blockedForPlatform` answer threaded through ./scan.ts).
 */
export function chromeExecutableCandidates(
    entry: Pick<ChromeMcpConfig, "chromePaths">,
    savedIds: readonly string[] = [],
    effectivePath = "",
    extraCandidates: readonly string[] = []
): string[] {
    const rowPaths = Array.isArray(entry?.chromePaths) ? entry.chromePaths : [];
    const saved = Array.isArray(savedIds) ? savedIds : [];
    const extra = Array.isArray(extraCandidates) ? extraCandidates : [];
    const seen = new Set<string>();
    const candidates: string[] = [];
    const push = (value: unknown): void => {
        const path = String(value ?? "").trim();
        if (path === "" || seen.has(path)) return;
        seen.add(path);
        candidates.push(path);
    };
    for (const path of rowPaths) push(path);
    for (const path of extra) push(path);
    for (const path of saved) push(path);
    push(effectivePath);
    return candidates;
}
