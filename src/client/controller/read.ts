/**
 * Browser card controller — the safe reads that project a served value onto the
 * snapshot.
 *
 * The host serves base-layer status through the describe clone, and describe()
 * may carry no base layer at all; the controller's `publish` folds what is there
 * into the snapshot through these small, total readers so no field ever reads
 * `undefined`. They are pure, so the class keeps to just the store + actions.
 */
import type { ChromeExecutableStatus, WindowsChromeStatus } from "./snapshot.js";

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
            error: readString((item as { error?: unknown }).error, "")
        });
    }
    return statuses;
}
