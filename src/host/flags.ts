/**
 * Extra-flags helpers shared by the bridge argv builder, the executable scan
 * and the settings validation hook.
 *
 * Flags are execve'd as argv entries — never through a shell — so validation
 * rejects control characters only, and the executable pin / connect-mode
 * options are matched against their upstream spellings (`--executablePath`,
 * `--executable-path`, `-e`, `--browserUrl`, `--wsEndpoint`).
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

/** True when one extraFlag declares a connect mode (no local executable). */
export function carriesConnectionMode(flag: string): boolean {
    return /^--(?:browserUrl|wsEndpoint)(?:=|(?=\s)|$)/iu.test(flag);
}

/** True when any entry of a flags list declares connect mode — the only thing
 * that now spares the bridge from an executable probe. A flag that pins an
 * executable is rejected on the way in instead (see
 * {@link validateExtraFlags}). */
export function flagsSkipCheck(flags: unknown): boolean {
    return Array.isArray(flags) && flags.some((flag) => typeof flag === "string" && carriesConnectionMode(flag));
}

/** True when two flags lists are element-wise equal (flags are arrays). */
export function sameFlags(a: unknown, b: unknown): boolean {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((flag, index) => flag === (b as string[])[index]);
}
