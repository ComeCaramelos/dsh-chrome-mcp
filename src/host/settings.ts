/**
 * Host half — the configuration form.
 *
 * Since dsh 0.2.0 the card edits the **row configuration** through the profile's
 * configuration form: one `Config` (./schema.ts), keyed by the row's profile
 * entry id. So this module no longer installs a namespace — it attaches the row
 * to the form and routes what the form answers into the controller. Three things
 * it owns:
 *
 * - **Identity.** Everything reads and writes by the profile **entry id** read
 *   off this fiber's own loader entry (`chromeMcpEntryId`). It is not a namespace
 *   and never derived from `serverName`: two instances would collide on the same
 *   row, so an instance that is not a profile entry says so loudly rather than
 *   inventing a key of its own.
 * - **The auto page stays off.** `settings.configure({ auto: false }, fiber)`
 *   keeps the Host from standing up a generated page while the card owns the
 *   row's page — and it is a *disposable* call that throws the second time for
 *   one fiber, so it rides one fiber effect and disposes with it (verified live,
 *   .probe/MIGRATION-CONTRACT.md §2e: `auto` only decides the generated page, and
 *   the entry stays fully described either way).
 * - **Commit routing.** A form commit lands as a volatile commit on this fiber,
 *   which the loader reports as `loader/volatile-update` carrying the paths it
 *   touched. Only the *user-authored* paths mean anything to the running bridge,
 *   so those are what route — and that same filter is what keeps a live publish
 *   (which only ever commits live fields) from re-entering the router.
 */
import { attachSettingsForm } from "@comecaramelos/dsh-ancesters/host";

import { ENTRY_ID } from "./constants.js";
import type { ChromeMcpController } from "./controller/index.js";
import type { ChromeMcpForm, PluginContext } from "./types/index.js";
import { liveMirrorKeys } from "./values.js";

/** The fields the card edits. A commit that touches nothing here changes nothing
 * the running bridge does, which is what keeps a live publish out of the router. */
const USER_FIELDS = new Set<string>([
    "extraFlags",
    "chromePath",
    "executables",
    "chromeCustomPaths",
    "stderrMode",
    "refreshExecutablesNonce",
    "openWindowsChromeNonce"
]);

/** Narrowed loader-entry view: only the one property the id rule reads. */
interface EntryIdLike {
    options?: { id?: unknown };
}

/**
 * The profile entry id this instance is keyed by, read off its own loader entry.
 * Throws when the plugin was not started as a profile entry: the id is the key
 * every read and write goes through, so inventing one would alias (or silently
 * address nothing) instead of failing loud.
 * @param ctx - plugin context.
 */
export function chromeMcpEntryId(ctx: PluginContext): string {
    const fiber = ctx.fiber as unknown as { entry?: EntryIdLike } | undefined;
    const id = fiber?.entry?.options?.id;
    if (typeof id !== "string" || id === "") {
        throw new Error(
            `dsh-chrome-mcp: this instance is not a profile entry, so the configuration form has no entry id to address it by ` +
                `(the bundle patch inserts \`id: "${ENTRY_ID}"\` — a bare ctx.plugin() mount has no form)`
        );
    }
    return id;
}

/**
 * Attach the row's configuration form to one controller: resolve the entry id,
 * keep the auto page off, and route the commits the form produces.
 *
 * Registration rides one fiber effect for the same reason `tool.ts` registers
 * lazily: the disposer has to leave with the instance, and an HMR reload must not
 * leave a prior instance still configuring (the second `configure` for one fiber
 * throws). A host that is not a profile entry gets a loud error and no form; its
 * row config keeps driving the bridge exactly as a row-only config always did.
 * @param ctx - plugin context.
 * @param controller - the live state the form drives.
 */
export function installChromeMcpForm(ctx: PluginContext, controller: ChromeMcpController): void {
    // The mechanics — the entry id read off this fiber (loud when it is not a
    // profile entry), the generated page kept off once per fiber and disposed
    // with it, and the commit filter on `loader/volatile-update` — are
    // ancestros' `attachSettingsForm`. A commit naming a **user** field routes
    // (flags, the executable, the saved rows, the toggle, the two triggers); a
    // commit naming only **live** fields routes nothing. The mirror's own
    // re-assert after a reset is the live mirror's business (./controller/
    // publish.ts), not this router's.
    attachSettingsForm(ctx as never, {
        name: `dsh-chrome-mcp(${controller.config.serverName})`,
        userFields: [...USER_FIELDS],
        liveKeys: liveMirrorKeys(),
        onAttach: (form) => controller.attachForm(form as unknown as ChromeMcpForm),
        onDetach: () => controller.detachForm(),
        onCommit: () => controller.onFormCommit()
    });
}

/** Every live-only key a Host write-back clears from the stored row (exported
 * here for the tests and for the write paths that carry the `unset` ops — the
 * same shape the reference's `settings.ts` keeps). */
export const LIVE_MIRROR_KEYS = liveMirrorKeys();
