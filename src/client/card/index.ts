/**
 * Browser half — the settings/status configuration.
 *
 * What the Plugins page renders for this bundle's own row: it registers into
 * the shared `plugins.row.config` slot, keyed by the package and row id, and
 * renders only what the page asks the body for (`view: "page"`). Since dsh
 * 0.2.0 the page owns the container and its identity line — the crumb, the
 * icon, the row title and description, and the section the body sits in — so
 * what is rendered here is the configuration itself: nothing collapsed behind a
 * header, no card shell, and no status line duplicating what the page already
 * states.
 *
 * The body is three catalog blocks, the same shape and in the same order the
 * sibling card (`dsh-docker-desktop-mcp`) carries: the named executable picker
 * (the pill the bridge actually launches with, over the saved-executable rows,
 * which the fetch action refreshes through the choose-to-add dialog), the extra
 * flags rows, and the "Reduce log output" toggle. Both row lists are the same
 * widget read through different fields, and they live in ./rows.ts. Two blocks
 * sit alongside them as this plugin's extensions — the WSL + Windows-executable
 * notice, and the probe result line under the picker's rows.
 *
 * There is no "auto" mode anywhere: the rows are what is available, what gets
 * picked stays picked, and a picked path that later stops running is reported
 * broken rather than silently re-resolved.
 *
 * This file is only the body's composition. The imperative run logic — the
 * fetch and Windows actions with their busy/dialog/clock state — lives in
 * ./run-actions.ts, what one served snapshot means lives in ./view.ts, and the
 * blocks it assembles live alongside:
 *
 *   ./view.ts          what one served snapshot means (options, notes, the dot)
 *   ./run-actions.ts   the imperative runs + their state (busy, dialog, clock)
 *   ./picker.ts        the executable picker: pill + saved-row catalog
 *   ./flags.ts         the extra-flags rows (the one-field reading of ./rows.ts)
 *   ./rows.ts          the one row list both catalogs render
 *   ./toggle.ts        the "Reduce log output" catalog block
 *   ./dialog.ts        the choose-to-add modal a fetch opens
 *   ./icons.ts         the icon paths the shell primitives do not carry
 */

/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { CatalogEntry } from "../catalog.js";
import type { ChromeExecutableStatus } from "../types.js";
import STYLES from "../styles/ChromeMcpCard.module.css";
import { ExtraFlagsEditor } from "./flags.js";
import { CatalogPicker } from "./picker.js";
import { CandidateDialog } from "./dialog.js";
import { useRunActions } from "./run-actions.js";
import { LogOutputToggle } from "./toggle.js";
import { describeCard, executableLabel, isBroken, probeAge, windowsChromeButton } from "./view.js";

/** One option's label: the row's name, plus the tag the run gave a broken one. */
function optionLabel(view: ReturnType<typeof describeCard>, id: string, t: (key: string) => string): string {
    const label = executableLabel(view, id);
    return isBroken(view, id) ? label + " (" + t("unavailableSuffix") + ")" : label;
}

/**
 * Hook result for the card component: locale copy, the snapshot selector, and
 * the controller-backed actions (all injected by the slot registration).
 */
export interface ChromeMcpCardProps {
    t: (key: string) => string;
    useChromeMcpCard: <T>(selector: (snapshot: any) => T) => T;
    saveFlags: (flags: string[]) => Promise<void>;
    toggleStderr: () => Promise<void>;
    /** Write the selected executable id (persisted; the default answers shift with it). */
    selectExecutable: (id: string) => Promise<void>;
    /** Save the whole saved-executables rows list (host re-runs the run). */
    saveExecutables: (entries: CatalogEntry[]) => Promise<void>;
    /** Ask the host to run the executable discovery, answering with every
     * candidate it looked at and what it said about each. */
    refreshExecutables: () => Promise<ChromeExecutableStatus[]>;
    /** Merge ids picked in the dialog into the saved rows. */
    addExecutables: (ids: string[]) => Promise<void>;
    /** Ask the host to drive a Windows-side Chrome in connect mode (locate,
     * prereq, launch, connect — all host-side; the answer lands in
     * `windowsChromeStatus`). */
    openWindowsChrome: () => Promise<void>;
    /** Persist every staged edit in one pass; nothing was applied until now. */
    apply: () => Promise<void>;
    /** Drop every staged edit, reverting the card to what the host serves. */
    discard: () => void;
    /** The shape the page asks for: `summary` is the one-liner, `page` the body.
     * (The page's own form handle is adopted by the shared body before any
     * block renders.) */
    view?: "summary" | "page";
}

/**
 * Render the DSH Chrome MCP settings/status configuration.
 * @param props - locale copy, the card snapshot hook, its actions, and the page
 * shape the slot renders this entry for.
 * @returns the configuration body, or nothing the page did not ask the body for.
 */
export function ChromeMcpCard(props: ChromeMcpCardProps) {
    const t = props.t;
    const state = props.useChromeMcpCard((snapshot) => snapshot);
    const menuState = react.useState(false);
    const menuOpen = menuState[0];
    const setMenuOpen = menuState[1];
    // The imperative half — the two host runs and the busy/dialog/clock state
    // they own — lives in ./run-actions.ts so this body stays composition.
    const runs = useRunActions({
        refreshExecutables: props.refreshExecutables,
        openWindowsChrome: props.openWindowsChrome,
        addExecutables: props.addExecutables
    });
    // The Plugins page asks for two shapes of the same slot: a one-line summary
    // and the body. Only the body is ours to render — the summary is the page's
    // own one-liner, and rendering the whole form inside one line would be
    // nonsense.
    if (props.view !== "page") return null;
    if (!state.available) return null;

    const view = describeCard(state);
    const rows = view.executableEntries;
    const savedIds = rows.map((entry: CatalogEntry) => entry.id);
    const options = view.executableOptions.map((option: { id: string }) => ({ id: option.id, label: optionLabel(view, option.id, t) }));
    // The error dot: red while an error line is present (a captured bridge/tool
    // failure or a rejected action), or the known "executable not found" state;
    // the tooltip always holds what the dot stands for. It used to ride the
    // card's own header; with no header of ours any more it rides the body's
    // error line instead, the one place the failure is stated.
    const dotLabel = view.error !== "" ? view.error : t("chromeMissing");
    const dotAria = view.dotIsError || view.missing ? t("statusError") : t("statusOk");
    const statusDot = jsx("span", {
        className: STYLES.dot + " " + STYLES.dotError,
        role: "img",
        "aria-label": dotAria,
        title: dotLabel
    });

    const windowsButton = windowsChromeButton(view);
    const windowsDisabled = windowsButton.disabled || runs.windowsRunning || !state.writable;
    const windowsBusy = windowsButton.busy || runs.windowsRunning;

    // Connect mode: the bridge connects instead of launching — so what the pill
    // claims is the connect address, not a local executable the host no longer
    // launches, probes or may not even have.
    const connectLabel =
        view.windowsChrome.port > 0
            ? t("connectModeLabel") + " (http://127.0.0.1:" + String(view.windowsChrome.port) + ")"
            : t("connectModeLabel");
    const selectedLabel = view.connectMode
        ? connectLabel
        : view.effectivePath === ""
            ? t("executableNone")
            : executableLabel(view, view.effectivePath);

    // What the last run answered for the **selected** executable — the line
    // beneath the rows that produced it. While a run is in flight the line says
    // so: a healthy host leaves the version unchanged, so without this the
    // action would only be a label flip. A failed run clears the version
    // host-side, so the line never claims what it did not answer with.
    const statusLine = runs.running
        ? jsx("p", { className: STYLES.result, role: "status", children: t("probing") })
        : view.version === ""
            ? null
            : jsxs("p", {
                className: STYLES.result,
                role: "status",
                children: [
                    t("versionLabel"),
                    jsx("span", { className: STYLES.resultValue, children: view.version }),
                    runs.lastProbedAt === 0 ? null : jsx("span", { className: STYLES.resultAge, children: probeAge(runs.lastProbedAt, runs.clock, t) })
                ]
            });

    // The body's one error line: what the bridge or a tool call reported (or a
    // rejected write), else the known "executable not found" state — the dot
    // leading the same line so the failure and its marker read as one report.
    const errorLine = view.error !== ""
        ? jsxs("p", { className: STYLES.error, role: "status", children: [statusDot, view.error] })
        : view.missing
            ? jsxs("p", { className: STYLES.error, role: "status", children: [statusDot, t("chromeMissing")] })
            : null;

    // The page renders its own section around what is returned, so the body is
    // the stack of blocks itself — no card shell and no collapsed header.
    return jsxs("div", {
        className: STYLES.body,
        children: [
            // Nothing the page can write from here is writable: the row's
            // configuration is owned elsewhere (a home patch or the page's own
            // read-only state).
            !state.writable
                ? jsx("p", { className: STYLES.readOnly, role: "status", children: t("readOnly") })
                : null,
            jsx(CatalogPicker, {
                t: t,
                entries: rows,
                options: options,
                idPlaceholder: t("executableIdPlaceholder"),
                namePlaceholder: t("namePlaceholder"),
                selectedId: view.effectivePath,
                selectedLabel: selectedLabel,
                selectedTitle: view.connectMode ? connectLabel : view.effectivePath !== "" ? view.effectivePath : selectedLabel,
                writable: state.writable,
                busy: runs.running,
                menuOpen: menuOpen,
                setMenuOpen: setMenuOpen,
                connectMode: view.connectMode,
                selectorLabel: t("executableLabel"),
                hint: view.connectMode ? t("connectModeHint") : t("executableHint"),
                windowsLabel: windowsBusy ? t("openWindowsChromeBusy") : t(windowsButton.labelKey),
                windowsTitle: t(windowsButton.titleKey),
                windowsDisabled: windowsDisabled,
                windowsOnOpen: runs.runWindowsChrome,
                rowsLabel: t("executableRows"),
                emptyText: t("executableEmpty"),
                idLabel: t("executableIdLabel"),
                nameLabel: t("executableNameLabel"),
                removeLabel: t("removeExecutable"),
                addLabel: t("addExecutable"),
                refreshLabel: t("fetchExecutables"),
                busyLabel: t("fetching"),
                select: (id: string) => {
                    if (typeof props.selectExecutable === "function") void props.selectExecutable(id);
                },
                saveEntries: (entries: CatalogEntry[]) => props.saveExecutables(entries),
                refresh: runs.runFetch,
                statusLine: statusLine
            }),
            // The one state no control of this form can express: the host runs
            // under WSL and what is selected is a Windows executable — which the
            // bridge cannot launch, however healthy its `--version` answer looks.
            // Nothing has failed yet, so this is a notice (static copy, shown only
            // while the host reports the state), not a third error surface: the
            // required configuration differs.
            view.wslWindowsExecutable
                ? jsxs("div", {
                    className: STYLES.notice,
                    role: "note",
                    children: [
                        jsx("div", { className: STYLES.noticeTitle, children: t("wslWindowsTitle") }),
                        jsx("div", { className: STYLES.noticeBody, children: t("wslWindowsNote") })
                    ]
                })
                : null,
            jsx(ExtraFlagsEditor, {
                t: t,
                flags: Array.isArray(state.extraFlags) ? state.extraFlags : [],
                defaultFlags: Array.isArray(state.defaultExtraFlags) ? state.defaultExtraFlags : [],
                wslFlags: Array.isArray(state.wslExtraFlags) ? state.wslExtraFlags : [],
                writable: state.writable,
                saveFlags: props.saveFlags
            }),
            jsx(LogOutputToggle, {
                t: t,
                checked: view.reduceChecked,
                disabled: !state.writable,
                onToggle: props.toggleStderr
            }),
            errorLine,
            runs.dialog !== null
                ? jsx(CandidateDialog, {
                    t: t,
                    candidates: runs.dialog.candidates,
                    savedIds: savedIds,
                    title: t("dialogExecutablesTitle"),
                    description: t("dialogExecutablesDescription"),
                    searchPlaceholder: t("searchExecutables"),
                    onAdd: runs.addFromDialog,
                    onClose: runs.closeDialog
                })
                : null,
            // The form writes nothing as it is edited: every staged edit is
            // persisted only when **Apply** lands them, and **Discard** drops the
            // whole draft — reverting every staged value to what the host already
            // serves.
            jsxs("div", {
                className: STYLES.footer,
                children: [
                    // A staged edit announces itself on the save line, since the
                    // identity line the page draws says nothing about it.
                    state.dirty
                        ? jsx("span", { className: STYLES.badge, children: t("unsaved") })
                        : null,
                    state.failed
                        ? jsx("p", { className: STYLES.footerError, role: "status", children: t("saveFailed") })
                        : null,
                    jsx("button", {
                        type: "button",
                        className: STYLES.footerButton,
                        onClick: () => {
                            if (typeof props.discard === "function") props.discard();
                        },
                        children: t("discard")
                    }),
                    jsx("button", {
                        type: "button",
                        className: STYLES.footerButton + " " + STYLES.footerButtonPrimary,
                        disabled: !state.dirty || state.saving || !state.writable,
                        onClick: () => {
                            if (typeof props.apply === "function") void props.apply();
                        },
                        children: state.saving ? t("saving") : t("apply")
                    })
                ]
            })
        ]
    });
}
