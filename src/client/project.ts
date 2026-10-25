/**
 * Browser half — what one served snapshot means for the card.
 *
 * ancestros' `CardController` answers the row as a bag of values (the served
 * document, the two staged fields overlaid by their drafts) plus the write
 * state. This module folds that into the state the card renders, through the
 * small total readers in ./read.ts, so no field ever reads `undefined`. Two
 * readings are this plugin's own and stay here: the effective executable while
 * the Host has not re-answered it, and the WSL notice that holds its last
 * answer across that same window.
 */
import { normalizeEntries } from "./catalog.js";
import { readFlags, readNumber, readStatus, readString, readWindowsChromeStatus } from "./read.js";
import type { ChromeMcpCardSnapshot } from "./types.js";

/** The slice of ancestros' snapshot the projection reads. */
export interface ServedSnapshot {
    available: boolean;
    writable: boolean;
    values: Record<string, unknown>;
    dirty: boolean;
    saving: boolean;
    failed: boolean;
    actionError: string;
}

/** The card with nothing served: the form is still loading, or the Host does
 * not expose the entry. The card renders nothing. */
export function nothingProjected(): ChromeMcpCardSnapshot {
    return {
        available: false,
        writable: false,
        extraFlags: [],
        lastError: "",
        chromeMissing: false,
        executableDiscoveryRevision: 0,
        chromeVersion: "",
        executables: [],
        executableStatus: [],
        chromePath: "",
        effectiveChromePath: "",
        effectiveSource: "",
        stderrMode: "",
        rowStderr: "log",
        defaultExtraFlags: [],
        wslExtraFlags: [],
        wslWindowsExecutable: false,
        windowsChromeStatus: { state: "off", port: 0, error: "" },
        carriesConnectionMode: false,
        actionError: "",
        dirty: false,
        saving: false,
        failed: false
    };
}

/**
 * Project one snapshot onto the card state.
 * @param snapshot - what ancestros' controller answers.
 * @param heldWslNotice - the WSL notice's previous answer (see below).
 */
export function projectCard(snapshot: ServedSnapshot, heldWslNotice: boolean): ChromeMcpCardSnapshot {
    if (snapshot.available !== true) return nothingProjected();
    const value = snapshot.values ?? {};
    const chromePath = readString(value.chromePath, "");
    // What the bridge launches with: the Host's own answer. **Empty is "has not
    // answered", not "nothing is selected"** — a config write recomposes the live
    // answers back to their defaults (nothing in the row persists them), and a
    // card that read that as no executable would say a pick had reverted. The
    // one host answer that *is* an empty path is a selection the host must never
    // exec (WSL host + Windows executable), whose own mirror flag keeps that
    // reading.
    const answeredEffective = readString(value.effectiveChromePath, "");
    // A `false` read of the WSL notice is ambiguous the same way: it is either
    // "no Windows executable stands selected" or the moment the recomposition
    // resets the live answers. While the Host has not answered the selection
    // (its effective path reads empty with a saved path standing), the notice
    // holds its last answer instead of flickering off and back; a `true` read is
    // an answer, so only the ambiguous false is held.
    const wslNotice = value.wslWindowsExecutable === true
        ? true
        : answeredEffective === "" && chromePath !== ""
            ? heldWslNotice
            : false;
    // The hold stands the NOTICE up, never the path: an unanswered effective path
    // says nothing about what is selected, and a pill that blanks during the
    // write's own reset window is a selection the user never dropped (measured
    // live 2026-10-12).
    const effectiveChromePath = answeredEffective !== ""
        ? answeredEffective
        : (value.wslWindowsExecutable === true ? "" : chromePath);
    const effectiveSource: "" | "selected" | "row-config" =
        value.effectiveSource === "selected" || value.effectiveSource === "row-config" ? value.effectiveSource : "";
    const stderrMode = value.stderrMode === "log" || value.stderrMode === "console" ? value.stderrMode : "";
    return {
        available: true,
        writable: snapshot.writable === true,
        extraFlags: readFlags(value.extraFlags),
        lastError: readString(value.lastError, ""),
        chromeMissing: value.chromeMissing === true,
        executableDiscoveryRevision: readNumber(value.executableDiscoveryRevision, 0),
        chromeVersion: readString(value.chromeVersion, ""),
        executables: normalizeEntries(value.executables),
        executableStatus: readStatus(value.executableStatus),
        chromePath,
        effectiveChromePath,
        effectiveSource,
        stderrMode,
        // The mode the bridge actually routes console output through, as the
        // Host resolves it — what the field states wins, the live answer fills
        // the gap.
        rowStderr: value.stderrEffective === "console" ? "console" : "log",
        defaultExtraFlags: readFlags(value.defaultExtraFlags),
        wslExtraFlags: readFlags(value.wslExtraFlags),
        wslWindowsExecutable: wslNotice,
        windowsChromeStatus: readWindowsChromeStatus(value.windowsChromeStatus),
        carriesConnectionMode: value.carriesConnectionMode === true,
        actionError: snapshot.actionError ?? "",
        dirty: snapshot.dirty === true,
        saving: snapshot.saving === true,
        failed: snapshot.failed === true
    };
}
