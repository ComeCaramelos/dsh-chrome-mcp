/**
 * `/chrome-refresh` — the headless mirror of the card's **Fetch executables**.
 *
 * One executable run on demand: probe every candidate the row config, what this
 * host carries, the saved rows and the selection carry, and merge what exists
 * into the saved rows. The merge already stands inside the run (see
 * ../controller/runs.ts — `runExecutableDiscovery` merges as its own step), so
 * the headless path needs no merge step of its own: it fires the run and reads
 * the answers off the live mirror the run publishes, never more than the run
 * answered. The bump of `executableDiscoveryRevision` around the awaited run is
 * what tells a reportable run from one that never completed — the statuses on
 * the mirror could otherwise be from the last run.
 */
import type { ChromeMcpController } from "../controller/index.js";
import type { CommandDefinition } from "../types/index.js";

export function createChromeRefreshCommand(controller: ChromeMcpController): CommandDefinition {
    return {
        name: "chrome-refresh",
        description: "Re-run Chrome executable discovery and merge what exists into the saved rows",
        input: { hint: "(no arguments)" },
        async handler() {
            const live = controller.live;
            const before = live.executableDiscoveryRevision;
            try {
                await controller.run();
            } catch (error) {
                return { kind: "error", text: `The executable run failed: ${String(error instanceof Error ? error.message : error)}` };
            }
            if (live.executableDiscoveryRevision === before) {
                return { kind: "error", text: "The executable run did not complete." };
            }
            const statuses = live.executableStatus;
            const found = statuses.filter((status) => status.version !== "");
            const failed = statuses.filter((status) => status.error !== "");
            const blocked = statuses.filter((status) => status.note !== "" && status.version === "" && status.error === "");
            const lines = [`Executable run: ${found.length} runnable, ${failed.length} failed, ${blocked.length} offered-but-never-probed. Found paths merge into the saved rows.`];
            for (const status of statuses) {
                const answer = status.version !== "" ? status.version : status.error !== "" ? `failed: ${status.error}` : status.note;
                lines.push(`  - ${status.path}: ${answer}`);
            }
            // A discovery that found nothing runnable is a failed run reported
            // the way the card reports it — through the error line it carries.
            if (found.length === 0 && live.lastError !== "") return { kind: "error", text: `${lines.join("\n")}\n${live.lastError}` };
            if (live.lastError !== "") lines.push(`Note: ${live.lastError}`);
            return { kind: "success", text: lines.join("\n") };
        }
    };
}
