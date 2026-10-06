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
import { carriesConnectionMode } from "../flags.js";
import { BROWSER_URL_FLAG_PREFIX } from "../constants.js";

/** The connect address one debugging port answers for. */
export function windowsChromeUrl(port: number): string {
    return `http://127.0.0.1:${Math.trunc(port)}`;
}

/** The debugging port the live connect entry carries, 0 when the list carries
 * none. The entry's **spelling** is irrelevant: the port is read through the
 * very predicate that decides connect mode (`carriesConnectionMode` in
 * `./flags.ts`), so `--browserUrl=<url>`, `--browserUrl <url>` (the two-entry
 * form the whitespace-split env source produces), one string carrying its
 * value after whitespace, and `--wsEndpoint=<url>` all answer with the live
 * port instead of reading as "no live session". */
export function browserUrlFlagPort(flags: unknown): number {
    const list = Array.isArray(flags) ? flags : [];
    for (let index = 0; index < list.length; index += 1) {
        const flag = list[index];
        if (typeof flag !== "string" || !carriesConnectionMode(flag)) continue;
        const eq = flag.indexOf("=");
        if (eq !== -1) {
            const match = flag.slice(eq + 1).trim().match(/:(\d+)/u);
            return match === null ? 0 : Number.parseInt(match[1], 10);
        }
        const whitespace = flag.slice(2).match(/\s/u);
        if (whitespace?.index !== void 0) {
            const match = flag.slice(whitespace.index + 3).trim().match(/:(\d+)/u);
            return match === null ? 0 : Number.parseInt(match[1], 10);
        }
        const value = list[index + 1];
        const match = typeof value === "string" ? value.trim().match(/:(\d+)/u) : null;
        return match === null ? 0 : Number.parseInt(match[1], 10);
    }
    return 0;
}

/** The local-profile row the connect entry makes mutually exclusive with it
 * upstream: a saved `--user-data-dir` next to a `--browserUrl` kills the spawn
 * (`Arguments userDataDir and browserUrl are mutually exclusive`, measured
 * live with chrome-devtools-mcp), so the run drops it when it pins connect. */
const CONNECT_EXCLUDED_FLAG = "--user-data-dir";

/**
 * Collapse every connect entry the list carries into the run's own address, so
 * the saved list keeps exactly **one** connect source whatever spelling it was
 * stored in — the same idempotency rule the saved-executable merge follows for
 * a repeated id, keyed now on the whole connect-mode predicate rather than one
 * flag spelling. An entry that carries its value as the *following* entry (the
 * `--browserUrl <url>` form the whitespace-split env source produces) consumes
 * that value with it, so no bare URL survives as a stray argv item.
 *
 * The one thing that does not survive is a `--user-data-dir` row: connect
 * carries no local profile to hand the browser, upstream refuses both at once,
 * so keeping a saved Flags-WSL row would leave the bridge unspawnable
 * (`Arguments userDataDir and browserUrl are mutually exclusive`, measured live
 * with chrome-devtools-mcp).
 */
export function withBrowserUrlFlag(flags: unknown, url: string): string[] {
    const entry = `${BROWSER_URL_FLAG_PREFIX}${url}`;
    const list = Array.isArray(flags) ? flags : [];
    const next: string[] = [];
    let replaced = false;
    let awaitingValue = false;
    for (const flag of list) {
        if (typeof flag !== "string") continue;
        if (flag.startsWith(CONNECT_EXCLUDED_FLAG)) continue;
        if (carriesConnectionMode(flag)) {
            if (!replaced) {
                next.push(entry);
                replaced = true;
            }
            // No inline value (no `=`, no whitespace) means the value is the
            // entry that follows — drop it with the flag, exactly the way
            // `stripExecutablePathFlags` consumes a `--flag <path>` spelling.
            awaitingValue = !flag.includes("=") && !/\s/u.test(flag);
            continue;
        }
        if (awaitingValue && !flag.startsWith("-")) continue;
        awaitingValue = false;
        next.push(flag);
    }
    if (!replaced) next.push(entry);
    return next;
}
