/**
 * Extra-flags helpers shared by the bridge argv builder, the executable scan
 * and the settings validation hook.
 *
 * Flags are execve'd as argv entries — never through a shell — so validation
 * rejects control characters only, and the executable pin / connect-mode
 * options are matched against their upstream spellings (`--executablePath`,
 * `--executable-path`, `-e`; the connect group `--browserUrl`/`--browser-url`/
 * `-u`, `--wsEndpoint`/`--ws-endpoint`/`-w`, `--autoConnect`/`--auto-connect`;
 * plus the probe-skipping `--config` and `--channel`).
 *
 * One rule has since hardened: pinning the executable by flag is a second
 * source of truth for the same lever the executable picker owns, so a
 * user-authored list may not carry it (`validateExtraFlags` rejects it), and
 * the row config's copy gets folded into `chromePath` instead of reaching argv
 * as a second opinion.
 */
import { CONTROL_PATTERN } from "./constants.js";

/** One executable-path flag, upstream spellings, with or without `=`. */
const EXECUTABLE_PATH_FLAG = /^(?:--executablePath|--executable-path|-e)(?:=|(?=\s)|$)/iu;

/**
 * Validate a user-authored extraFlags list: a plain array of flag strings
 * carrying no control characters (argv is execve'd without a shell), and no
 * executable-path flag — the executable is picked in the card's selector, so
 * letting a flag pin one would put a second source of truth over the bridge
 * argv. Throws with the offending entry so the settings layer can surface it.
 * @param value - candidate flags array.
 * @returns true when valid.
 */
export function validateExtraFlags(value: unknown): true {
    if (!Array.isArray(value)) {
        throw new Error("extraFlags must be an array of strings");
    }
    for (const flag of value) {
        if (typeof flag !== "string" || flag === "") {
            throw new Error("extraFlags entries must be non-empty strings");
        }
        if (CONTROL_PATTERN.test(flag)) {
            throw new Error(`extraFlags entry "${flag}" contains control characters`);
        }
        if (carriesExecutablePath(flag)) {
            throw new Error(
                `extraFlags entry "${flag}" selects the Chrome executable — pick it in the Chrome executable picker instead`
            );
        }
    }
    return true;
}

/** True when a flag selects the Chrome executable (upstream flags:
 * `--executablePath` / `--executable-path` / `-e`, with or without `=`).
 * No longer an accepted user flag (see {@link validateExtraFlags}): it stays
 * here for the row-config fold ({@link extractExecutablePathFlag}) and the
 * argv guard. */
export function carriesExecutablePath(flag: string): boolean {
    return typeof flag === "string" && EXECUTABLE_PATH_FLAG.test(flag);
}

/**
 * Read the path a legacy `--executablePath` carries in the **row-config** flags
 * list: the `=` spelling and the separated spelling both count, first entry
 * wins, "" when nothing pins a path.
 *
 * The card's picker owns the executable now, so a row-config pin is not
 * honored as a flag: it becomes the row-config source of the selection and gets
 * stripped out of argv (see {@link stripExecutablePathFlags}).
 */
export function extractExecutablePathFlag(flags: unknown): string {
    if (!Array.isArray(flags)) return "";
    for (let index = 0; index < flags.length; index++) {
        const flag = flags[index];
        if (typeof flag !== "string" || !carriesExecutablePath(flag)) continue;
        const eq = flag.indexOf("=");
        if (eq !== -1) return flag.slice(eq + 1).trim();
        const next = flags[index + 1];
        return typeof next === "string" && next.trim() !== "" ? next.trim() : "";
    }
    return "";
}

/** Drop every entry that pins an executable from a flags list — paired with
 * {@link extractExecutablePathFlag} so a legacy profile keeps its path as a
 * selection source instead of reaching argv as a second source of truth.
 * A `--flag <path>` spelling consumes the following entry; a flag-looking next
 * entry keeps it (nothing was meant as the value). */
export function stripExecutablePathFlags(flags: unknown): string[] {
    if (!Array.isArray(flags)) return [];
    const stripped: string[] = [];
    let awaitingValue = false;
    for (const flag of flags) {
        if (typeof flag !== "string") continue;
        if (carriesExecutablePath(flag)) {
            awaitingValue = !flag.includes("=");
            continue;
        }
        if (awaitingValue && !flag.startsWith("-")) continue;
        awaitingValue = false;
        stripped.push(flag);
    }
    return stripped;
}

/**
 * True when one extraFlag declares a connect mode (the bridge will not launch a
 * local executable). Upstream spellings (docs/configuration.md): the two URL
 * options — `--browserUrl`/`--browser-url`/`-u` and
 * `--wsEndpoint`/`--ws-endpoint`/`-w` — plus `--autoConnect`/`--auto-connect`,
 * which attaches to an already-running Chrome (Chrome 144+) instead of starting
 * one. Each form counts with its value inline (`=`), carried as the following
 * entry (the whitespace-split env source's spelling), or bare.
 */
export function carriesConnectionMode(flag: string): boolean {
    return /^(?:--(?:auto[-]?connect|browser[-]?url|ws[-]?endpoint)(?:=|(?=\s)|$)|-[uw]\b)/iu.test(flag);
}

/** One config-file flag, `--config <file>` (also matched for the
 * `--config-path` spelling). A JSON config can fix the executable and the
 * connect mode itself, so the bridge argv no longer states locally what will
 * run — the check would only guess. */
const CONFIG_FILE_FLAG = /^--config(?:-path)?(?:=|(?=\s)|$)/iu;

/** True when one extraFlag names a config file. */
export function carriesConfigFile(flag: unknown): boolean {
    return typeof flag === "string" && CONFIG_FILE_FLAG.test(flag);
}

/** One `--channel` flag. Its value picks where upstream looks for a browser
 * (`canary`/`dev`/`beta`/`stable`); the check's own candidate list models only
 * `stable`, so any other value makes it answer "not found" about a browser
 * living in another channel. */
const CHANNEL_FLAG = /^--channel(?:=|(?=\s)|$)/iu;

/** True when one extraFlag fixes the update channel to something other than
 * `stable` (the default the candidate list models). `next` is the entry that
 * follows a bare `--channel`; a value equal to the default is not a skip. */
export function carriesOtherChannel(flag: unknown, next?: unknown): boolean {
    if (typeof flag !== "string" || !CHANNEL_FLAG.test(flag)) return false;
    const eq = flag.indexOf("=");
    let value: string;
    if (eq !== -1) {
        value = flag.slice(eq + 1).trim();
    } else {
        const whitespace = /\s/u.exec(flag);
        if (whitespace !== null) value = flag.slice(whitespace.index + 1).trim();
        else if (typeof next === "string" && !next.startsWith("-")) value = next.trim();
        else return false;
    }
    return value !== "" && value.toLowerCase() !== "stable";
}

/** True when an executable probe could not answer here, whatever the host
 * carries: the bridge connects instead of launching (connect mode), the
 * executable it runs came from a config file, or the channel it looks in is
 * not the `stable` one the candidate list models. A check that ran **no**
 * probe answers `""` — *no evidence*, never health: it must not clear
 * `lastError` nor the known `chromeMissing` state. */
export function flagsSkipProbe(flags: unknown): boolean {
    if (!Array.isArray(flags)) return false;
    for (let index = 0; index < flags.length; index += 1) {
        const flag = flags[index];
        if (typeof flag !== "string") continue;
        if (carriesConnectionMode(flag) || carriesConfigFile(flag)) return true;
        if (CHANNEL_FLAG.test(flag) && carriesOtherChannel(flag, flags[index + 1])) return true;
    }
    return false;
}

/** True when any entry of a flags list declares connect mode — the connect
 * half that answers the live `carriesConnectionMode` mirror, keys the pill
 * relabel on, and drops `--executablePath` from the argv. For what spares the
 * *executable check* there is the wider {@link flagsSkipProbe}: a config file
 * and a non-`stable` channel also leave the probe mute, while the bridge still
 * launches a local executable. */
export function flagsSkipCheck(flags: unknown): boolean {
    return Array.isArray(flags) && flags.some((flag) => typeof flag === "string" && carriesConnectionMode(flag));
}

/** True when two flags lists are element-wise equal (flags are arrays). */
export function sameFlags(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((flag, index) => flag === (b as string[])[index]);
}
