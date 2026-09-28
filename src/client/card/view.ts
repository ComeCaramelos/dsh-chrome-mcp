/**
 * The card's derived view — what one served snapshot actually means.
 *
 * Everything the widget renders but does not own: the saved executable rows
 * (run through the same id rules the rows follow), the dropdown options the pill
 * lists, the ids the last run could not launch, the effective stderr mode
 * behind the toggle, and the header status dot. Pure derivation, no hooks — the
 * widget owns its state, this section reads it.
 *
 * The reference card (`dsh-docker-desktop-mcp`) carries the same shape here; the
 * difference is `brokenIds`, which the host's per-path probe answer feeds.
 */
import { entryLabel, normalizeEntries, type CatalogEntry } from "../catalog.js";
import type { ChromeExecutableStatus, WindowsChromeStatus } from "../controller/index.js";

/** What the card renders, derived from the served snapshot. */
export type CardView = {
    /** The error line the header dot and the body paragraph report. */
    error: string;
    /** Whether the "Reduce log output" switch reads as on. */
    reduceChecked: boolean;
    /** Saved executable rows, normalized — the rows list and the dropdown. */
    executableEntries: CatalogEntry[];
    /** The pill's options: the saved rows, plus the executable in use. */
    executableOptions: { id: string; label: string }[];
    /** Ids the last run could not launch — the pill tags those. */
    brokenIds: string[];
    /** What the bridge launches with ("" = nothing resolved yet). */
    effectivePath: string;
    /** What the selected executable answered with ("" = nothing answered). */
    version: string;
    /** Whether the known "executable not found" state is set. */
    missing: boolean;
    /** Whether the status dot reports an error (true) or a missing executable. */
    dotIsError: boolean;
    /** The host runs under WSL and the selection is a Windows executable. */
    wslWindowsExecutable: boolean;
    /** What the **Prelaunch Windows Chrome** run is doing — served by the host. */
    windowsChrome: WindowsChromeStatus;
    /** True while the bridge launches with a connect-mode flag; the pill then
     * reads "connect mode" and the local selection is muted. */
    connectMode: boolean;
};

function labelOf(entries: readonly CatalogEntry[], id: string): string {
    const row = entries.find((entry: CatalogEntry) => entry.id === id);
    return row === void 0 ? id : entryLabel(row);
}

/** Project one served snapshot onto everything the widget renders. */
export function describeCard(state: any): CardView {
    const error = state.lastError || state.actionError || "";
    // The "Reduce log output" switch mirrors what the host actually resolves:
    // the explicit `stderrMode` when set, else the row-config fallback
    // (`rowStderr`). Never a phantom state.
    const servedMode = typeof state.stderrMode === "string" ? state.stderrMode : "";
    const stderrEffective = servedMode !== "" ? servedMode : state.rowStderr === "console" ? "console" : "log";
    const executableEntries = normalizeEntries(state.executables);
    const statusList: ChromeExecutableStatus[] = Array.isArray(state.executableStatus) ? state.executableStatus : [];

    // The pill's options: the saved rows, plus what is actually running so a
    // picked path never disappears from the list.
    const optionIds = executableEntries.map((entry: CatalogEntry) => entry.id);
    const effectivePath = typeof state.effectiveChromePath === "string" ? state.effectiveChromePath : "";
    if (effectivePath !== "" && optionIds.indexOf(effectivePath) === -1) optionIds.push(effectivePath);
    const executableOptions = optionIds.map((id: string) => ({ id, label: labelOf(executableEntries, id) }));
    // Which ids the last run could not launch: the option list tags those, the
    // same way the reference card tags a broken row.
    const brokenIds = statusList.filter((status) => status.version === "" && status.error !== "").map((status) => status.path);

    return {
        error,
        reduceChecked: stderrEffective === "log",
        executableEntries,
        executableOptions,
        brokenIds,
        effectivePath,
        version: typeof state.chromeVersion === "string" ? state.chromeVersion : "",
        missing: state.chromeMissing === true && error === "",
        dotIsError: error !== "",
        wslWindowsExecutable: state.wslWindowsExecutable === true,
        windowsChrome: readWindowsChrome(state.windowsChromeStatus),
        connectMode: state.carriesConnectionMode === true
    };
}

/** One row's menu label: its display name — the tag a broken row carries is
 * added by the picker, which owns the copy. */
export function executableLabel(view: CardView, id: string): string {
    return labelOf(view.executableEntries, id);
}

/** The served Windows-Chrome status, coerced to the shape this file renders. */
function readWindowsChrome(value: unknown): WindowsChromeStatus {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { state: "off", port: 0, error: "" };
    const record = value as Record<string, unknown>;
    const known = ["off", "launching", "connected", "unreachable", "not-found", "launch-failed", "not-applicable"];
    const state = typeof record.state === "string" && known.indexOf(record.state) !== -1 ? record.state as WindowsChromeStatus["state"] : "off";
    const port = typeof record.port === "number" && Number.isFinite(record.port) ? Math.trunc(record.port) : 0;
    const error = typeof record.error === "string" ? record.error : "";
    return { state, port, error };
}

/** What the **Prelaunch Windows Chrome** button renders right now. The copy keys
 * carry the whole disabled reason (mirrored prereq, no Windows binary, off
 * WSL), so the button itself never re-derives what the host already answered. */
export type WindowsButton = {
    /** The action's copy key. */
    labelKey: string;
    /** The tooltip's copy key. */
    titleKey: string;
    /** Whether the click does nothing (disabled reason lives in `titleKey`). */
    disabled: boolean;
    /** Whether the run is in flight — the button reads as busy, not disabled. */
    busy: boolean;
};

export function windowsChromeButton(view: CardView): WindowsButton {
    const status = view.windowsChrome;
    if (status.state === "launching") return { labelKey: "openWindowsChromeBusy", titleKey: "openWindowsChromeTitle", disabled: true, busy: true };
    if (status.state === "not-applicable") return { labelKey: "openWindowsChrome", titleKey: "windowsChromeNotWsl", disabled: true, busy: false };
    if (status.state === "not-found") return { labelKey: "openWindowsChrome", titleKey: "windowsChromeNotFound", disabled: true, busy: false };
    if (status.state === "unreachable") return { labelKey: "openWindowsChrome", titleKey: "windowsChromeUnreachable", disabled: true, busy: false };
    // `off`, `connected` and `launch-failed` are all idle answers: the button
    // stays available so the run can be re-tried or re-adjusted.
    return { labelKey: "openWindowsChrome", titleKey: "openWindowsChromeTitle", disabled: false, busy: false };
}

/** Whether the run could not launch this id (the pill tags it, the dialog
 * renders its note as a failure). */
export function isBroken(view: CardView, id: string): boolean {
    return view.brokenIds.indexOf(id) !== -1;
}

/**
 * The result line's age suffix. A run whose answer equals what the line already
 * says is otherwise a no-op on screen, so the line states when the card last ran
 * one.
 */
export function probeAge(since: number, now: number, t: (key: string) => string): string {
    const seconds = Math.max(0, Math.floor((now - since) / 1000));
    if (seconds < 10) return t("probeJustNow");
    if (seconds < 60) return String(seconds) + " " + t("probeSecondsAgo");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return String(minutes) + " " + t("probeMinutesAgo");
    return String(Math.floor(minutes / 60)) + " " + t("probeHoursAgo");
}
