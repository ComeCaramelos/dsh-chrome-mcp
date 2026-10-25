/**
 * Browser half — the safe reads that project a served value onto the
 * snapshot.
 *
 * The configuration form answers the resolved section as a bag of unknowns, and
 * a field the Host has not answered for yet is simply absent; the controller's
 * `publish` folds what is there into the snapshot through these small, total
 * readers so no field ever reads `undefined`. They are pure, so the class keeps
 * to just the store + actions.
 *
 * The `Served` projection and the two list comparisons ride here for the same
 * reason: they are pure foldings of what the Host answers, shared by the class
 * (`publish` recomputes the served projection on every push) and by the write
 * actions (every staged edit and every immediate trigger diffs against it).
 */
import type { CatalogEntry } from "./catalog.js";
import type { ChromeExecutableStatus, WindowsChromeStatus } from "./types.js";

/** The served projection every write diffs against — staged fields overlay it,
 * immediate triggers are compared against it. */
export type Served = {
    extraFlags: string[];
    executables: CatalogEntry[];
    chromePath: string;
    effectiveChromePath: string;
    effectiveSource: string;
    /** The persisted "Reduce log output" mode ("" = follow the row config). */
    stderrMode: string;
    /** What the Host resolves that mode to — what the toggle reads as on. */
    stderrEffective: string;
};

/** An answer-less form leaves the card with: nothing editable, nothing running. */
export function nothingServed(): Served {
    return {
        extraFlags: [], executables: [], chromePath: "", effectiveChromePath: "", effectiveSource: "", stderrMode: "", stderrEffective: "log"
    };
}

/** Whether two flag lists carry the same strings in the same order. */
export function sameStrings(a: readonly string[], b: readonly string[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/** Whether two saved-row lists carry the same ids and labels. */
export function sameEntries(a: readonly CatalogEntry[], b: readonly CatalogEntry[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || a[i].name !== b[i].name) return false;
    return true;
}

/** A list of flags read from any value; a non-list answers as nothing. */
export function readFlags(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((flag) => typeof flag === "string" && flag !== "") as string[];
}

/** Number read from any value, `fallback` when absent or not a number. */
export function readNumber(value: unknown, fallback: number): number {
    return typeof value === "number" ? value : fallback;
}

/** String read from any value, `fallback` when absent or not a string. */
export function readString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

/** Coerce the served Windows-Chrome status into the shape the card renders. */
export function readWindowsChromeStatus(value: unknown): WindowsChromeStatus {
    const fallback: WindowsChromeStatus = { state: "off", port: 0, error: "" };
    if (value === null || typeof value !== "object" || Array.isArray(value)) return fallback;
    const status = (value as Record<string, unknown>).state;
    const states = ["off", "launching", "connected", "unreachable", "not-found", "launch-failed", "not-applicable"];
    const port = (value as Record<string, unknown>).port;
    const error = (value as Record<string, unknown>).error;
    return {
        state: typeof status === "string" && states.indexOf(status) !== -1 ? status as WindowsChromeStatus["state"] : "off",
        port: typeof port === "number" && Number.isFinite(port) ? Math.trunc(port) : 0,
        error: typeof error === "string" ? error : ""
    };
}

/** Coerce the served per-row answers into the shape the card renders. */
export function readStatus(value: unknown): ChromeExecutableStatus[] {
    if (!Array.isArray(value)) return [];
    const statuses: ChromeExecutableStatus[] = [];
    for (const item of value) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const path = readString((item as { path?: unknown }).path, "");
        if (path === "") continue;
        statuses.push({
            path,
            version: readString((item as { version?: unknown }).version, ""),
            error: readString((item as { error?: unknown }).error, ""),
            note: readString((item as { note?: unknown }).note, "")
        });
    }
    return statuses;
}
