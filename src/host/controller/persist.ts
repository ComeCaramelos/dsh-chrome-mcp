/**
 * Controller — persisting what the Host itself writes.
 *
 * Four writes may land back in the profile patch: the seeded executable, the
 * saved rows a merged scan folded in, the ids of dropped rows, and the dismissed
 * translation flag (./../migration.ts D4). Since dsh 0.2.0 the store is the
 * profile's **own patch layer** (there is no `settings.yaml` any more) and the
 * write goes through the `settings` service keyed by the row's profile **entry
 * id** — the same key the card addresses by.
 *
 * What gets written is only ever a user-authored field — one field per write, so
 * an unrelated edit the user made in the same layer keeps standing — and it goes
 * through `settings.mutate(entryId, ops)` with the write's own `set` op first and
 * then one `unset` op for **every live-mirror field** (see ../values.ts
 * `liveMirrorKeys`). Why the unset ops belong to the write itself: a persisted
 * write re-persists the volatile fields it answers, and whatever the live publish
 * stands in the running references is answered through them, so a live answer can
 * ride a save back into the patch file (measured live 2026-10-12: booting the
 * plugin with no user write filled the profile's own `cordis.patch.yml` row with
 * every live key). An `unset` returns the field to whatever the **row config**
 * answers — the row's own patch layer is excluded underneath it — so what stands
 * is the row's answer and a live-only answer drops out: the live boundary holds
 * from the write channel, not from a check. And it heals: the first write to a
 * row that already carries leaked live keys clears them.
 *
 * Every write still lands on the same follow-up rule (see ./commits.ts for the
 * card's copy of it): a stored-layer write resets the live-only volatile fields
 * back to their row-config answers, so the mirror goes straight back out with it.
 *
 * All three follow the same rules: the write is answered from the run's neutral
 * async context (see ./runs.ts — a write still sitting inside the write
 * transaction its own form commit opened is a *nested* transaction, which the
 * platform refuses instead of queueing), and it never throws out of the run. The
 * mirror is what the card reads, and a failed write must not break an otherwise
 * successful run.
 */
import { createPersister, type PersistUser } from "@comecaramelos/dsh-ancesters/host";

import { liveMirrorKeys } from "../values.js";
import { MIGRATION_DISMISSED_FIELD } from "../constants.js";
import type { ChromeExecutableEntry, SettingsForms } from "../types/index.js";

import { publishLive } from "./publish.js";
import type { Controller } from "./state.js";

/** One persister per controller (ancestros' `createPersister`): the write's own
 * field first, then one `unset` per live-mirror field, no revision fence (the
 * Host putting its own answer into the row, not an editor saving a view — a
 * stale view must not lose the seed / the merged rows / the connect flag the
 * run just produced), and the mirror re-asserted after the write **and** after
 * a refused one (measured live 2026-10-13: a refused rows merge on a read-only
 * row otherwise left the references answering no `lastError` ever again). */
const persisters = new WeakMap<Controller, PersistUser>();

function persisterOf(controller: Controller): PersistUser {
    let persister = persisters.get(controller);
    if (persister === void 0) {
        persister = createPersister(controller.ctx as never, {
            form: {
                current: () => {
                    const form = controller.state.form;
                    if (form === void 0) return void 0;
                    const settings = form.settings ?? (controller.ctx.get("settings") as SettingsForms | undefined);
                    return { entryId: form.entryId, settings: settings as never };
                },
                liveKeys: () => liveMirrorKeys(),
                attached: () => controller.state.form !== void 0
            },
            liveKeys: liveMirrorKeys(),
            publishLive: () => publishLive(controller),
            name: `dsh-chrome-mcp(${controller.config.serverName})`
        });
        persisters.set(controller, persister);
    }
    return persister;
}

/** Write one user-authored field into the row's own patch layer, clearing every
 * live-mirror field back to its row-config answer (see the module header). */
function persist(controller: Controller, field: string, value: unknown, note: string): Promise<void> {
    return persisterOf(controller)({ [field]: value }, `dsh-chrome-mcp(${controller.config.serverName}): ${note}`);
}

/** Persist one seeded/executable selection — the row-config fallback disappears
 * the moment a path is picked, so a run that seeded one writes it exactly once. */
export function persistChromePath(controller: Controller, path: string): Promise<void> {
    return persist(controller, "chromePath", path, "failed to persist the seeded chromePath");
}

/** Persist the saved-executables rows a run merged into. */
export function persistExecutables(controller: Controller, entries: ChromeExecutableEntry[]): Promise<void> {
    return persist(controller, "executables", entries, "failed to persist the executable rows");
}

/** Persist the ids of rows the user dropped, so no later merge step folds them
 * back in (see ../schema.ts `droppedExecutables`). */
export function persistDroppedExecutables(controller: Controller, ids: readonly string[]): Promise<void> {
    return persist(controller, "droppedExecutables", [...ids], "failed to persist the dropped executable ids");
}

/** Remember that this row's standalone-config translation was turned down
 * (./../migration.ts D4). This is the only Host write the proposal path makes:
 * the config itself is read, never rewritten, and nothing lands in the manager's
 * `servers` without a click. */
export function dismissMigration(controller: Controller): void {
    void persist(controller, MIGRATION_DISMISSED_FIELD, true, "failed to persist the dismissed translation");
}
