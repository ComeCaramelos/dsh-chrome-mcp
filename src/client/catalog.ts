/**
 * Browser half — the saved-executable rows the picker lists.
 *
 * This is the client-side mirror of `src/host/catalog.ts` (the two halves
 * compile into separate bundles and cannot share a module). Both halves follow
 * the same rules — trim the id, ignore ids that cannot go on the wire, keep the
 * first row per id, label a row by its custom name when it has one — and
 * `test/client.test.mjs` pins the mirror against the same fixtures the host
 * tests use, so a drift between the halves fails loudly.
 */
/** One saved row: the path on the wire (`--executablePath=<id>`) + the label. */
export type CatalogEntry = { id: string; name: string };

/** A saved row's id is a path: no control character may reach it (the same rule
 * the host's `CHROME_PATH_PATTERN` enforces), capped like the reference's
 * `COMMAND_MAX_LENGTH`. */
const ID_MAX_LENGTH = 1024;
const PATH_PATTERN = /^[^\x00-\x1f\x7f]{1,1024}$/u;

/** Cap of one row's display name (must match host `CATALOG_NAME_MAX_LENGTH`). */
export const NAME_MAX_LENGTH = 200;

/** Cap of the saved rows (must match host `CATALOG_MAX_LENGTH`); the tail drops
 * off, so a merged run can never grow the persisted list without limit. */
export const ENTRY_CAP = 50;

/** Whether one id is usable as a saved-row id. */
export function isValidEntryId(id: string): boolean {
    if (id === "" || id.length > ID_MAX_LENGTH) return false;
    return PATH_PATTERN.test(id);
}

/** One row label: the custom name when set, else the path itself. */
export function entryLabel(entry: CatalogEntry): string {
    const name = entry.name.trim();
    return name === "" ? entry.id : name;
}

/**
 * Coerce a served value into well-formed rows. Host-served arrays are already
 * normalized; a value read straight from the settings document may not be, so
 * the card can be handed anything.
 */
export function normalizeEntries(value: unknown): CatalogEntry[] {
    if (!Array.isArray(value)) return [];
    const out: CatalogEntry[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (out.length === ENTRY_CAP) break;
        if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
        const raw = item as { id?: unknown; name?: unknown };
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!isValidEntryId(id) || seen.has(id)) continue;
        seen.add(id);
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        out.push({ id, name: name.slice(0, NAME_MAX_LENGTH) });
    }
    return out;
}
