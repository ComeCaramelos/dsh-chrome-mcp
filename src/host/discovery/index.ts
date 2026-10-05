/**
 * Host half — the Chrome executable: candidate locations, the `--version`
 * probes, the executable **scan** that produces the card's dropdown options, and
 * the check run that ties them together.
 *
 *   ./candidates.ts  the platform Chrome locations + the ordered candidate list
 *   ./probe.ts       the `--version` probe + presence + identity helpers
 *   ./scan.ts        the scan, the discover-the-first-runnable run, the check
 *
 * Upstream starts the browser LAZILY, on the first tool call, so the check runs
 * probes eagerly instead of waiting for a tool call. There is no "auto" mode:
 * the scan lists what exists, the card picks one, and what is picked stays
 * picked — a path that later disappears is reported broken, never silently
 * substituted. See ./scan.ts for the full behaviour and the WSL interop note.
 */
export { chromeExecutableCandidates, DEFAULT_CHROME_PATHS, defaultChromePaths } from "./candidates.js";
export { checkChrome, discoverChrome, scanChromeExecutables } from "./scan.js";
