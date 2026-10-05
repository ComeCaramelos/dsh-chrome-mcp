/**
 * Host half — the `chrome-mcp` settings section.
 *
 * Installs the namespace the Web GUI card edits and routes every commit into
 * the controller. Two contract details decide the shape of this module:
 *
 * - `installSection` runs `hooks.onChange()` synchronously at registration,
 *   which is how a persisted `extraFlags` selection lands on the FIRST
 *   connection when the settings service is already up (the cold path is
 *   `readPersistedFlags` in ./values.ts).
 * - The `validate` hook is the UI write gate: an invalid flags list throws
 *   inside `installSection` (surfaced on the card), it never reaches the
 *   running bridge. The executable fields are gated the same way — a path
 *   carrying control characters can never become a selection nor a saved-row
 *   id — and `--executablePath` in the flags list is rejected outright,
 *   because the picker owns that one flag (see ./flags.ts).
 */
import { CHROME_PATH_PATTERN, CUSTOM_PATHS_CAP, SETTINGS_NAMESPACE } from "./constants.js";
import { isValidEntryId } from "./catalog.js";
import { SettingsSchema } from "./schema.js";
import { validateExtraFlags } from "./flags.js";
import { normalizeCustomPaths } from "./values.js";
import type { ChromeMcpController } from "./controller/index.js";
import type { PluginContext, SettingsResolved, SettingsService } from "./types/index.js";

/**
 * Install the settings namespace and wire its hooks into the controller.
 * @param ctx - plugin context.
 * @param controller - the live state created by `apply`.
 */
export function installChromeMcpSection(ctx: PluginContext, controller: ChromeMcpController): void {
    ctx.inject(["settings"], (inner: PluginContext) => {
        const settings = (inner as { settings?: SettingsService }).settings;
        if (!settings) return;
        settings.installSection(inner, SETTINGS_NAMESPACE, SettingsSchema, controller.entry, {
            setSource: (next: () => SettingsResolved) => {
                controller.setSource(next);
            },
            validate: (value: SettingsResolved) => {
                try {
                    validateExtraFlags(value.extraFlags);
                } catch (error) {
                    const msg = error instanceof Error ? String(error.message ?? error) : String(error);
                    throw new Error(`settings "${SETTINGS_NAMESPACE}": ${msg}`);
                }
                if (value.stderrMode !== "" && value.stderrMode !== "log" && value.stderrMode !== "console") {
                    throw new Error(`settings "${SETTINGS_NAMESPACE}": stderrMode must be "log", "console" or empty (row-config default)`);
                }
                for (const path of [value.chromePath, ...normalizeCustomPaths(value.chromeCustomPaths, CUSTOM_PATHS_CAP)]) {
                    if (typeof path !== "string" || path === "" || CHROME_PATH_PATTERN.test(path)) continue;
                    throw new Error(`settings "${SETTINGS_NAMESPACE}": chromePath "${path}" must be a path without control characters`);
                }
                // The saved rows go on the wire the same way the selection does,
                // so the gate that rejects a control-character path rejects a
                // control-character row id — a bad row never reaches a scan, and
                // never reaches argv as `--executablePath=<id>`.
                for (const row of Array.isArray(value.executables) ? value.executables : []) {
                    const id = row === null || typeof row !== "object" ? "" : (row as { id?: unknown }).id;
                    if (isValidEntryId(id)) continue;
                    throw new Error(
                        `settings "${SETTINGS_NAMESPACE}": executable row "${String(id ?? "")}" must carry a path without control characters`
                    );
                }
            },
            onChange: () => {
                controller.onSettingsChange();
            }
        });
    });
}
