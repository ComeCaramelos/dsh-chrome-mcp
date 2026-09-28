/**
 * Windows Chrome run — the connect-mode address and flag it writes.
 *
 * The connect half of the run: the `http://127.0.0.1:<P>` address a debugging
 * port answers for, the port one saved `--browserUrl=` entry carries, and the
 * replace-by-key merge that keeps the saved flags at exactly one connect entry
 * (never two, with the local `--user-data-dir` row dropped — upstream refuses
 * `userDataDir` and `browserUrl` in the same argv). The run calls these to
 * answer and to persist its outcome; ./run.ts drives them.
 */
import { BROWSER_URL_FLAG_PREFIX } from "../constants.js";

/** The connect address one debugging port answers for. */
export function windowsChromeUrl(port: number): string {
    return `http://127.0.0.1:${Math.trunc(port)}`;
}

/** The debugging port one `--browserUrl=` entry carries, 0 when the list
 * carries none (or one this helper cannot read). */
export function browserUrlFlagPort(flags: unknown): number {
    for (const flag of Array.isArray(flags) ? flags : []) {
        if (typeof flag !== "string" || !flag.startsWith(BROWSER_URL_FLAG_PREFIX)) continue;
        const url = flag.slice(BROWSER_URL_FLAG_PREFIX.length);
        const match = url.match(/:(\d+)\/?$/u);
        if (match === null) return 0;
        return Number.parseInt(match[1], 10);
    }
    return 0;
}

/** The local-profile row the connect entry makes mutually exclusive with it
 * upstream: a saved `--user-data-dir` next to a `--browserUrl` kills the spawn
 * (`Arguments userDataDir and browserUrl are mutually exclusive`, measured
 * live with chrome-devtools-mcp), so the run drops it when it pins connect. */
const CONNECT_EXCLUDED_FLAG = "--user-data-dir";

/**
 * Replace this plugin's own connect entry and keep everything else: an entry
 * already pinned to `--browserUrl=` is rewritten in place (one connect source,
 * never two), and a list without one gets the entry appended. That is the
 * idempotency rule the saved-executable merge follows for a repeated id.
 * The one thing that does not survive is a `--user-data-dir` row: connect
 * carries no local profile to hand the browser, upstream refuses both at
 * once, so keeping a saved Flags-WSL row would leave the bridge unspawnable.
 */
export function withBrowserUrlFlag(flags: unknown, url: string): string[] {
    const entry = `${BROWSER_URL_FLAG_PREFIX}${url}`;
    const list = Array.isArray(flags) ? flags : [];
    const next: string[] = [];
    let replaced = false;
    for (const flag of list) {
        if (typeof flag !== "string") continue;
        if (flag.startsWith(CONNECT_EXCLUDED_FLAG)) continue;
        if (flag.startsWith(BROWSER_URL_FLAG_PREFIX)) {
            if (replaced) continue;
            next.push(entry);
            replaced = true;
            continue;
        }
        next.push(flag);
    }
    if (!replaced) next.push(entry);
    return next;
}
