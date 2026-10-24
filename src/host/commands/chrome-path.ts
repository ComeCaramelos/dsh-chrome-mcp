/**
 * `/chrome-path` — the headless mirror of the card's executable picker.
 *
 * It answers what the pill states and changes what it changes, reading the saved
 * rows and the live mirror exactly the way the card reads them, and writing the
 * one same persisted `chromePath` field through the controller's write-back
 * channel (`selectChromePath` — `persistChromePath`, i.e. one `settings.mutate`
 * on the row's entry id, the live clear riding along) — never a route of its
 * own. `none` clears the user layer back to what the row config carries under
 * it, which is the same answer a cleared picker reads with. And a path write
 * answers against the same validation gate a GUI write runs through: the
 * field's own schema pattern, so control characters are refused here exactly as
 * they are refused on the card door.
 */
import { entryLabel } from "../catalog.js";
import { CHROME_PATH_PATTERN } from "../constants.js";
import { readSavedExecutables } from "../values.js";
import type { ChromeMcpController } from "../controller/index.js";
import type { CommandDefinition } from "../types/index.js";

const USAGE = "Usage: /chrome-path <path> — select the Chrome executable the row launches by default. Use /chrome-path none to clear the selection back to the row config.";

export function createChromePathCommand(controller: ChromeMcpController): CommandDefinition {
    return {
        name: "chrome-path",
        description: "Show or change the Chrome executable the row launches by default",
        input: { hint: "[<path>|none]" },
        async handler(invocation) {
            const input = invocation.rawInput.trim();

            // No argument answers the question the pill states, with the saved
            // rows the picker would offer beneath it.
            if (input === "") {
                const live = controller.live;
                const saved = readSavedExecutables(controller.source());
                const lines = [
                    `Current executable: ${live.effectiveChromePath === "" ? "(nothing)" : live.effectiveChromePath}`,
                    `Source: ${live.effectiveSource === "" ? "nothing selected" : live.effectiveSource}.`
                ];
                lines.push(saved.length === 0 ? "Saved executables: (none — /chrome-refresh discovers them)." : `Saved executables:\n${saved.map((entry) => `  - ${entryLabel(entry)}`).join("\n")}`);
                lines.push(USAGE);
                return { kind: "success", text: lines.join("\n") };
            }

            // The one cleared write: the user layer answers empty again and the
            // row config's own path stands underneath it.
            if (input === "none") {
                if (controller.live.effectiveChromePath === "" && controller.live.effectiveSource === "") {
                    return { kind: "success", text: "No executable is selected — there is nothing to clear." };
                }
                await controller.selectChromePath("");
                return { kind: "success", text: "Executable selection cleared — the row launches by default with whatever the row config carries." };
            }

            // Same gate the field's write runs through (../schema.ts).
            if (!CHROME_PATH_PATTERN.test(input)) {
                return { kind: "error", text: "Invalid executable path: control characters (or a length over the path limit) are never valid." };
            }
            // Already what the bridge runs with: same write the picker makes on
            // a no-change pick — nothing lands anywhere new.
            if (controller.live.effectiveChromePath === input && controller.live.effectiveSource === "selected") {
                return { kind: "success", text: `The row default already stands at ${input}.` };
            }
            await controller.selectChromePath(input);
            return {
                kind: "success",
                text: `Chrome executable selected: ${input} — a default shifts with it: live connections without their own pick re-answer, and the executable run re-runs behind the write.`
            };
        }
    };
}
