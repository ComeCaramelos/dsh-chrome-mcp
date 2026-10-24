/**
 * @comecaramelos/dsh-chrome-mcp — browser half, public surface.
 *
 * The card is built from `@comecaramelos/dsh-ancesters`' `mountSettingsCard`:
 * the dictionaries, the controller over this row's configuration form (staged,
 * immediate and trigger writes, the fenced write door, the settle), the
 * page-wide failure toasts and the `plugins.row.config` registration keyed by
 * `<bundle>#<row id>` all come from the shared half. What is declared here is
 * the descriptor and the one block this row owns (./block.ts).
 *
 * The one module the bundler walks, so the emitted `client.js` exports exactly
 * what the shell consumes — `apply` and `inject` — plus the settle deadline and
 * the live keys, on the surface for the tests (the loader ignores them).
 */
import { mountSettingsCard } from "@comecaramelos/dsh-ancesters/client";

import { ChromeCardBlock } from "./block.js";
import { DICTIONARIES } from "./locales/index.js";
import { BUNDLE_ID, ENTRY_ID, LIVE_KEYS, LOCALE_NAMESPACE, PLUGIN_ID, RUN_SETTLE_TIMEOUT_MS } from "./plugin-meta.js";
import { injectCardStyles } from "./styles/index.js";

/** The descriptor that makes this component's card. */
export const card = mountSettingsCard({
    entryId: ENTRY_ID,
    pluginId: PLUGIN_ID,
    bundleId: BUNDLE_ID,
    localeNamespace: LOCALE_NAMESPACE,
    locale: DICTIONARIES,
    fields: {
        // The flags and the "Reduce log output" mode are edited as a draft:
        // nothing reaches the Host until Apply.
        staged: ["extraFlags", "stderrMode"],
        // The saved rows and the selection drive a Host run, so they land on
        // the click that asked for them.
        immediate: ["executables", "chromePath"],
        triggers: ["refreshExecutablesNonce", "openWindowsChromeNonce"],
        liveKeys: [...LIVE_KEYS]
    },
    blocks: [{ block: ChromeCardBlock as never, bind: (_snapshot: unknown, controller: unknown) => ({ controller }) }],
    // The body states the error itself (the dot and the line under the
    // toggle), so the shared second line stays off.
    errorLine: false,
    // A failure that lands while the person is elsewhere in the app is still
    // announced: the row page is closed most of the time a run is happening.
    // An error carries the Host's own line; a stall has no text of its own and
    // reads from the mirror — the known missing-executable answer when it
    // stands, the "the host did not answer" line otherwise.
    toasts: {
        text: (notice: { kind: "error" | "stall"; text: string }, snapshot: { values?: Record<string, unknown> }, t: (key: string) => string) =>
            notice.kind === "error"
                ? (notice.text !== "" ? notice.text : t("toastError"))
                : (snapshot.values?.chromeMissing === true ? t("chromeMissing") : t("toastStall"))
    },
    settleField: "executableDiscoveryRevision",
    settleDeadlineMs: RUN_SETTLE_TIMEOUT_MS
});

/** Services the shell must resolve before `apply` runs. */
export const inject = card.inject;

/** The loader entry: the card's own stylesheet first (the shared machinery
 * injects only its own sheet), then the mounted card. */
export function apply(ctx: Parameters<typeof card.apply>[0]): void {
    injectCardStyles();
    card.apply(ctx);
}

export { LIVE_KEYS, RUN_SETTLE_TIMEOUT_MS };
/** The seam between the shared controller and the card (test surface). */
export { cardActions, cardState } from "./block.js";
