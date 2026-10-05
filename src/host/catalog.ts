/**
 * Host half — the named rows behind the executable picker.
 *
 * One row is `{ id, name }`: the `id` is what goes on the wire (the path the
 * bridge launches with, appended as `--executablePath=<id>`), while `name` is
 * purely the label the user chose for the UI — the same id-is-path / name-is-
 * label split the reference plugin (`dsh-docker-desktop-mcp`) carries for its
 * executables catalog, so the card is one widget shape instead of a bespoke
 * dropdown-plus-text-box.
 *
 * Everything here is pure and total: nothing throws on odd input, so the
 * settings `validate` hook can never stall the settings gate on a malformed
 * row. The browser half mirrors these rules in `src/client/catalog.ts`
 * (separate bundle, one source of truth per rule in each half).
 *
 * Merge rule (the reference's "Fetch executables" behaviour): keep every stored
 * row in order with its custom name, append the ids the scan found that are not
 * represented yet with an empty name. A row the user deleted only comes back if
 * a later source still reports its id, which is why the legacy `chromeCustomPaths`
 * MRU folds in exactly once, before the rows are written by anything else.
 */
import { CATALOG_MAX_LENGTH, CATALOG_NAME_MAX_LENGTH, CHROME_PATH_PATTERN } from "./constants.js";

/** One catalog row: the path on the wire + the custom UI label. */
export type ChromeExecutableEntry = { id: string; name: string };

/** Whether one id is usable as an executable row (a path with no control
 * characters, capped like the `chromePath` it stands for). */
export function isValidEntryId(id: unknown): boolean {
    if (typeof id !== "string") return false;
    const path = id.trim();
    if (path === "" || path.length > 1024) return false;
    return CHROME_PATH_PATTERN.test(path);
}

/** One row label: the custom name when it has one, else the path. */
export function entryLabel(entry: ChromeExecutableEntry): string {
    const name = entry.name.trim();
    return name === "" ? entry.id : name;
}

/**
 * Coerce anything into well-formed rows: trim both fields, drop ids that cannot
 * go on the wire, keep the first row per id, cap the name, cap the list (the
 * tail drops off). A served array is already normalized; one read straight from
 * a settings document is not, so the row writer is the place that makes it safe.
 */
export function normalizeEntries(value: unknown): ChromeExecutableEntry[] {
    if (!Array.isArray(value)) return [];
    const out: ChromeExecutableEntry[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (out.length === CATALOG_MAX_LENGTH) break;
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const raw = item as { id?: unknown; name?: unknown };
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!isValidEntryId(id) || seen.has(id)) continue;
        seen.add(id);
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        out.push({ id, name: name.slice(0, CATALOG_NAME_MAX_LENGTH) });
    }
    return out;
}

/**
 * Merge the ids a scan found into the stored rows: rows keep their order and
 * their custom names, ids that are not represented land last, nameless.
 * @returns the merged rows, plus `changed` so a caller can skip a no-op write.
 */
export function mergeEntries(
    stored: unknown,
    ids: readonly string[]
): { entries: ChromeExecutableEntry[]; changed: boolean } {
    const entries = normalizeEntries(stored);
    const present = new Set(entries.map((entry) => entry.id));
    const merged = entries.slice();
    for (const id of ids) {
        if (merged.length >= CATALOG_MAX_LENGTH) break;
        const path = typeof id === "string" ? id.trim() : "";
        if (!isValidEntryId(path) || present.has(path)) continue;
        present.add(path);
        merged.push({ id: path, name: "" });
    }
    return { entries: merged, changed: JSON.stringify(merged) !== JSON.stringify(entries) };
}

/** The ids a catalog currently carries, in row order. */
export function entryIds(entries: readonly ChromeExecutableEntry[] | undefined): string[] {
    return (entries === void 0 ? [] : entries).map((entry) => entry.id);
}

/** One row lookup by id (`undefined` when absent). */
export function findEntry(
    entries: readonly ChromeExecutableEntry[],
    id: string
): ChromeExecutableEntry | undefined {
    return entries.find((entry) => entry.id === id);
}
