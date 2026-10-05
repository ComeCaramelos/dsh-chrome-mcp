/**
 * Controller — settings persistence.
 *
 * The three writes a run may need to make back into the persisted settings
 * section: the seeded executable, the saved rows a merged scan folded in, and
 * the connect-mode flag a Windows run composed. All three follow the same rule —
 * never throw out of a run, because the base layer is what the card reads and a
 * failed write must not break an otherwise successful run.
 */
import { SETTINGS_NAMESPACE } from "../constants.js";
import type { ChromeExecutableEntry } from "../types/index.js";

import type { Controller } from "./state.js";

/** Read the `settings` service surface as consumed here (`mutate` only). */
function settingsService(controller: Controller): { mutate?: (ns: string, ops: unknown[]) => unknown } | undefined {
    return controller.ctx.get("settings") as { mutate?: (ns: string, ops: unknown[]) => unknown } | undefined;
}

/** Persist one seeded/executable write through the settings service. */
export async function persistChromePath(controller: Controller, path: string): Promise<void> {
    try {
        const settings = settingsService(controller);
        if (!settings || typeof settings.mutate !== "function") return;
        await Promise.resolve(settings.mutate(SETTINGS_NAMESPACE, [{ op: "set", path: ["chromePath"], value: path }]));
    } catch (error) {
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): failed to persist the seeded chromePath: ${String(error)}`);
    }
}

/** Persist the saved-executables rows a run merged into. */
export async function persistExecutables(controller: Controller, entries: ChromeExecutableEntry[]): Promise<void> {
    try {
        const settings = settingsService(controller);
        if (!settings || typeof settings.mutate !== "function") return;
        await Promise.resolve(settings.mutate(SETTINGS_NAMESPACE, [{ op: "set", path: ["executables"], value: entries }]));
    } catch (error) {
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): failed to persist the executable rows: ${String(error)}`);
    }
}

/** Persist the saved flags list a Windows connect run composed. */
export async function persistExtraFlags(controller: Controller, flags: string[]): Promise<void> {
    try {
        const settings = settingsService(controller);
        if (!settings || typeof settings.mutate !== "function") return;
        await Promise.resolve(settings.mutate(SETTINGS_NAMESPACE, [{ op: "set", path: ["extraFlags"], value: flags }]));
    } catch (error) {
        controller.ctx.logger.warn(`chrome-devtools-mcp(${controller.config.serverName}): failed to persist the connect-mode flag: ${String(error)}`);
    }
}
