/**
 * Controller — the manager-connection seam.
 *
 * The row starts no bridge of its own any more: every live bridge is one of the
 * manager's connections, answered through ./kind.ts (`resolve`). What this module
 * keeps is the mirror half — when a connection answers with what it runs with,
 * the live state says so (the running executable, the running flags, the stderr
 * destination, the running note) — plus the write paths that change what the
 * **default** answers would be: a row-level flags/executable/stderr edit has to
 * reach the live connections that carry no own answer for that field, which the
 * pool only learns about on the next `invalidate`.
 *
 * The old file this replaces drove the fiber directly (`bridgeConfig` rebuild,
 * `fiber.update()` chained on readiness). The pool does that now, against the
 * config a kind's `resolve` hands it.
 */
import { KIND_FIELDS } from "../constants.js";
import { ownedEntries } from "../manager.js";
import { noteStderr } from "./notes.js";
import { publishLive } from "./publish.js";
import type { Controller } from "./state.js";

/** Everything one `resolve` answered with that the live state should carry. */
export interface RunningAnswers {
    /** The executable the connection launches ("" in connect mode). */
    executable: string;
    /** Where it came from (`"selected"` / `"row-config"` / ""). */
    source: string;
    /** The flags list it launched with. */
    flags: string[];
    /** The console-output mode it spawned with. */
    stderrMode: "log" | "console";
    /** Where the stderr lands when the wrapper redirects ("" otherwise). */
    redirect: string;
    /** The note the answer carries ("" = silent). */
    note: string;
}

/**
 * Mirror what a live connection runs with into the live state and say it out
 * loud: publish, then notify that the pickers' answers moved (their Host-served
 * choices read this state off). One log line per resolve names the connection
 * being answered for.
 */
export function noteRunning(controller: Controller, entryId: string, answers: RunningAnswers): void {
    const { state } = controller;
    state.runningFlags = [...answers.flags];
    state.runningChromePath = answers.executable;
    state.runningChromeSource = answers.source === "row-config" || answers.source === "selected" ? answers.source : "";
    state.runningStderrMode = answers.stderrMode;
    state.live.runningFlags = [...answers.flags];
    state.live.runningNote = answers.note;
    if (answers.redirect !== "") noteStderr(controller, { redirect: answers.redirect });
    controller.ctx.logger.info(`dsh-chrome-mcp(${entryId}): connection answers with executable "${answers.executable || "(connect mode)"}", flags [${answers.flags.join(" ")}], stderr → ${answers.stderrMode}${answers.note === "" ? "" : `, ${answers.note}`}`);
    // The publish inside `publishLive` re-notifies the pickers: the answers that
    // just moved are exactly what a `select` offers.
    publishLive(controller);
}

/**
 * Tell the pool to re-answer every live connection whose answer depends on the
 * field the row just changed. A connection carrying its own `extra` answer for
 * the field does not follow the row's default, so it is left standing; every
 * other owned entry is handed back for a re-resolve, live ones included — the
 * diff that decides what the pool actually does with the re-resolve is decided
 * on the **resolved config**, so a connection that would answer with exactly
 * what it runs with is not restarted anyway, and one that would answer with
 * something else switches in place.
 */
export function invalidateOwnedForField(controller: Controller, fieldKey: string): void {
    const { state } = controller;
    if (state.connections === void 0) return;
    try {
        for (const entry of ownedEntries(state.connections)) {
            if (Object.prototype.hasOwnProperty.call(entry.extra, fieldKey)) continue;
            state.connections.invalidate(entry.id);
        }
    } catch {
        // A manager that has already gone away answers nothing; there is nothing
        // to invalidate.
    }
}

/** The invalidation key matching one kind-field, shared by the three drift paths
 * in ./commits.ts. */
export const DEFAULT_ANSWER_FIELDS = [KIND_FIELDS.executable, KIND_FIELDS.extraFlags, KIND_FIELDS.stderrMode] as const;
