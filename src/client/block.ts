/**
 * Browser half — the one block this card declares.
 *
 * The card's body is still this plugin's own (`./card/`): the executable
 * picker, the flags rows, the "Reduce log output" toggle, the WSL notice, the
 * Apply/Discard footer. What it renders from, and every write it makes, now ride
 * ancestros' `CardController` — the store over the row's configuration form,
 * the staged/immediate/trigger writes, the fenced write door (with its unfenced
 * last pass and live-key clears) and the settle. This module is the seam: it
 * projects the controller's snapshot onto the card state (./project.ts) and
 * hands the card its actions, each one a controller call.
 */
import { normalizeEntries, type CatalogEntry } from "./catalog.js";
import { ChromeMcpCard } from "./card/index.js";
import { projectCard, type ServedSnapshot } from "./project.js";
import { readStatus, sameEntries } from "./read.js";
import type { ChromeExecutableStatus, ChromeMcpCardSnapshot } from "./types.js";

/** The field every executable action settles on: the Host run's own counter. */
const RUN_COUNTER = "executableDiscoveryRevision";

/** The slice of ancestros' `CardController` this seam calls. */
export interface CardControllerLike {
    getSnapshot(): ServedSnapshot;
    value(field: string): unknown;
    servedValue(field: string): unknown;
    stage(field: string, value: unknown): void;
    discard(): void;
    applyStaged(): Promise<boolean>;
    settleTrigger(triggerField: string, watchField?: string): Promise<void>;
    settleAndWrite(settled: (snapshot: ServedSnapshot) => boolean, field: string, value: unknown): Promise<void>;
}

/** The WSL notice's last answer, per controller (see ./project.ts: it holds
 * across the recomposition window). */
const heldWslNotice = new WeakMap<object, boolean>();

/** What the run counter answers on one snapshot. */
function runCounter(snapshot: ServedSnapshot): number {
    const value = snapshot.values?.[RUN_COUNTER];
    return typeof value === "number" ? value : 0;
}

/** Project the controller's snapshot onto the card state, keeping the notice's
 * hold per controller. */
export function cardState(controller: CardControllerLike): ChromeMcpCardSnapshot {
    const state = projectCard(controller.getSnapshot(), heldWslNotice.get(controller) === true);
    heldWslNotice.set(controller, state.wslWindowsExecutable);
    return state;
}

/** Every action the card calls, each one a controller call. */
export function cardActions(controller: CardControllerLike) {
    const current = () => cardState(controller);
    const saveExecutables = (entries: CatalogEntry[]): Promise<void> => {
        const next = normalizeEntries(entries);
        // The rows are what the Host's next run reads; a list equal to what is
        // served writes nothing.
        if (sameEntries(next, current().executables)) return Promise.resolve();
        const baseline = runCounter(controller.getSnapshot());
        return controller.settleAndWrite((snapshot) => runCounter(snapshot) > baseline, "executables", next);
    };
    return {
        /** Stage the extra-flags list; a list equal to what is served is not
         * dirty (the controller drops that draft). */
        saveFlags: (flags: string[]): Promise<void> => {
            controller.stage("extraFlags", Array.isArray(flags) ? flags : []);
            return Promise.resolve();
        },
        /** Stage the flipped "Reduce log output" mode. A flip that lands back on
         * what is already effective drops the draft instead of staging a no-op:
         * it stages the served value itself, which the controller reads as clean. */
        toggleStderr: (): Promise<void> => {
            const state = current();
            const held = state.stderrMode;
            const effective = held === "" ? state.rowStderr : held;
            const next = effective === "log" ? "console" : "log";
            const servedRaw = controller.servedValue("stderrMode");
            const served = servedRaw === "log" || servedRaw === "console" ? servedRaw : "";
            const servedEffective = served === "" ? state.rowStderr : served;
            controller.stage("stderrMode", next === servedEffective ? served : next);
            return Promise.resolve();
        },
        /** Select the executable the bridge launches with: written on the spot,
         * settled by the Host's own re-run. Picking what already runs writes
         * nothing. */
        selectExecutable: (id: string): Promise<void> => {
            const target = typeof id === "string" ? id.trim() : "";
            if (target === "" || target === current().effectiveChromePath) return Promise.resolve();
            const baseline = runCounter(controller.getSnapshot());
            return controller.settleAndWrite((snapshot) => runCounter(snapshot) > baseline, "chromePath", target);
        },
        saveExecutables,
        /** Merge the ids picked in the dialog into the saved rows. */
        addExecutables: (ids: string[]): Promise<void> =>
            saveExecutables(current().executables.concat(
                (Array.isArray(ids) ? ids : [])
                    .filter((id) => typeof id === "string" && id.trim() !== "")
                    .map((id) => ({ id: id.trim(), name: "" }))
            )),
        /** Ask the Host to re-probe the saved rows; answers every path the run
         * answered for, read off the served mirror once it settles. */
        refreshExecutables: (): Promise<ChromeExecutableStatus[]> =>
            controller.settleTrigger("refreshExecutablesNonce", RUN_COUNTER).then(() => readStatus(controller.value("executableStatus"))),
        /** Ask the Host to drive a Windows-side Chrome in connect mode; what the
         * button reports is served through `windowsChromeStatus`. */
        openWindowsChrome: (): Promise<void> => controller.settleTrigger("openWindowsChromeNonce", RUN_COUNTER),
        /** Persist every staged edit in one pass. */
        apply: async (): Promise<void> => {
            await controller.applyStaged();
        },
        /** Drop every staged edit. */
        discard: (): void => controller.discard()
    };
}

/**
 * The block: the plugin's own card body, over the shared controller.
 * @param props - what ancestros' body hands a block (`controller`, `t`).
 */
export function ChromeCardBlock(props: { controller: CardControllerLike; t: (key: string) => string }): unknown {
    const state = cardState(props.controller);
    return ChromeMcpCard({
        t: props.t,
        view: "page",
        useChromeMcpCard: <T>(selector: (snapshot: ChromeMcpCardSnapshot) => T): T => selector(state),
        ...cardActions(props.controller)
    });
}
