/**
 * The manager seam — what this component says to `mcpConnections`, and when.
 *
 * The component is a *companion* of the manager bundle: it injects the
 * `mcpConnections` service the manager provides, so this module only runs while
 * the manager runs, and whatever it registers is withdrawn when the injector's
 * effect does (no global state, nothing left behind when the component is off).
 *
 * Three things happen here, in the only order that works:
 *
 * 1. **The kinds come first.** A `chrome` or `chrome-windows` entry cannot be
 *    saved, nor `resolve`d, until a kind answers for it — so the kinds register
 *    before anything may be proposed, and their fields are what the entry editor
 *    renders.
 * 2. **Every publish re-notifies.** The `select` choices are read off this
 *    component's live state (the executable catalog, the scan answers, what a
 *    live connection runs with), so what a picker shows is only as fresh as the
 *    last `notifyKindsChanged`.
 * 3. **The translation is offered last, never earlier.** A standalone row config
 *    is proposed only once the kinds exist, because a proposal names a kind and
 *    the row is useless without it; a dismissal then remembers itself in this
 *    row's config (./migration.ts).
 */
import { KIND_FIELDS, KIND_ID_CHROME, KIND_ID_WINDOWS, MIGRATION_DISMISSED_FIELD } from "./constants.js";
import { createChromeKinds } from "./kind.js";
import { migrationDismissed, standaloneProposal } from "./migration.js";
import type { McpConnectionsService, McpProposal } from "@comecaramelos/dsh-mcp-manager/api";
import type { Controller } from "./controller/index.js";
import type { PluginContext } from "./types/index.js";

/** Whether one entry is owned by a kind this component registered. */
export function isOwnedKind(kind: unknown): boolean {
    return kind === KIND_ID_CHROME || kind === KIND_ID_WINDOWS;
}

/**
 * Attach one live component to the manager's `mcpConnections` service: register
 * the kinds this host answers, keep their fields' choices fresh, and offer what
 * a standalone config means now.
 *
 * @param ctx - plugin context (the injection is this component's own effect).
 * @param controller - the live state every answer is read from.
 */
export function attachToManager(ctx: PluginContext, controller: Controller): void {
    ctx.inject(["mcpConnections"], (inner) => {
        const service = (inner as unknown as { mcpConnections?: McpConnectionsService }).mcpConnections;
        if (service === void 0) return;
        const state = controller.state;
        state.connections = service;
        // What a picker would answer just moved — every live publish says so.
        state.notifyKindsChanged = () => {
            try {
                service.notifyKindsChanged();
            } catch {
                // A manager that has already gone away answers nothing; the next
                // publish says it again.
            }
        };

        for (const kind of createChromeKinds(controller)) {
            ctx.effect(() => {
                const unregister = service.registerKind(kind);
                return () => {
                    unregister();
                };
            }, `dsh-chrome-mcp(${controller.config.serverName}): manager kind ${kind.id}`);
        }
        ctx.effect(() => () => {
            state.connections = void 0;
            state.notifyKindsChanged = () => void 0;
        }, "dsh-chrome-mcp(${controller.config.serverName}): manager state");

        // Entries already standing under these kinds were answered "kind nobody
        // registered" by the manager's first reconcile; registering is enough —
        // the manager reconciles again when a kind arrives (or leaves), and that
        // answer was never kept.

        // The standalone translation, offered once per apply: what it offers is
        // fixed by the row config, which does not change underneath. A dismissal
        // withdraws it (the manager drops a dismissed proposal itself); the
        // reason it is not offered again is the row's own `migrationDismissed`.
        ctx.effect(() => {
            const proposal = standingProposal(controller);
            if (proposal === void 0) return () => void 0;
            let withdraw: (() => void) | undefined;
            try {
                withdraw = service.propose(proposal);
            } catch (error) {
                controller.ctx.logger.warn(`dsh-chrome-mcp(${controller.config.serverName}): the standalone configuration could not be offered: ${String(error)}`);
                return () => void 0;
            }
            return () => {
                withdraw?.();
            };
        }, "dsh-chrome-mcp(${controller.config.serverName}): standalone translation");
    });
}

/** Every live entry of our own kinds, whatever its line currently says. */
export function ownedEntries(service: McpConnectionsService) {
    return service.entries().filter((entry) => isOwnedKind(entry.kind));
}

/** The entry's own answer for one kind field, or "" when it stated none. */
export function entryField(entry: { extra: Record<string, string> }, key: string): string {
    const value = entry.extra[key];
    return typeof value === "string" ? value : "";
}

/** The translation currently worth offering, or `undefined` — when it has been
 * turned down, or when there is nothing to say. The manager filters standing
 * proposals by the kind they would create anyway (an accepted offer disappears
 * without this module noticing), so what is left here to decide is dismissal
 * alone. */
function standingProposal(controller: Controller): McpProposal | undefined {
    if (migrationDismissed(controller)) return void 0;
    return standaloneProposal(controller);
}
