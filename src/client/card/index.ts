/**
 * Browser half — the settings/status card.
 *
 * Registers one card into the shared `settings.plugin.item` slot (Settings →
 * Plugins → Plugin configuration), keyed by the `chrome-mcp` settings namespace
 * the host half serves. Collapsible like the stock plugin cards — closed by
 * default, the header as its disclosure button — with the header carrying the
 * status dot.
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
import type { ChromeExecutableStatus } from "../controller/index.js";
import STYLES from "../styles/ChromeMcpCard.module.css";
import { ExtraFlagsEditor } from "./flags.js";
import { CHEVRON_PATH } from "./icons.js";
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
    /** Write the selected executable id (persisted; bridge restart). */
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
    /** One mirror re-read (used when the card opens). */
    refresh: () => Promise<void>;
}

/**
 * Render the DSH Chrome MCP settings/status card.
 * @param props - locale copy, the card snapshot hook, and its actions.
 * @returns the card, or nothing until the namespace is served.
 */
export function ChromeMcpCard(props: ChromeMcpCardProps) {
    const t = props.t;
    const state = props.useChromeMcpCard((snapshot) => snapshot);
    const openState = react.useState(false);
    const open = openState[0];
    const setOpen = openState[1];
    const menuState = react.useState(false);
    const menuOpen = menuState[0];
    const setMenuOpen = menuState[1];
    const bodyId = react.useId();
    // The imperative half — the two host runs and the busy/dialog/clock state
    // they own — lives in ./run-actions.ts so this body stays composition.
    const runs = useRunActions({
        refreshExecutables: props.refreshExecutables,
        openWindowsChrome: props.openWindowsChrome,
        addExecutables: props.addExecutables
    });
    if (!state.available) return null;

    const view = describeCard(state);
    const rows = view.executableEntries;
    const savedIds = rows.map((entry: CatalogEntry) => entry.id);
    const options = view.executableOptions.map((option: { id: string }) => ({ id: option.id, label: optionLabel(view, option.id, t) }));
    // The error dot: red while an error line is present (a captured bridge/tool
    // failure or a rejected action), or the known "executable not found" state;
    // the tooltip always holds what the dot stands for.
    const dotLabel = view.error !== "" ? view.error : t("chromeMissing");
    const dotAria = view.dotIsError || view.missing ? t("statusError") : t("statusOk");

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

    return jsx("li", {
        className: STYLES.card + (open ? " " + STYLES.cardOpen : ""),
        children: [
            jsxs("button", {
                type: "button",
                className: STYLES.header,
                "aria-expanded": open,
                "aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
                "aria-controls": bodyId,
                onClick: () => {
                    setOpen(!open);
                    if (!open && typeof props.refresh === "function") void props.refresh();
                },
                children: [
                    jsxs("span", {
                        className: STYLES.headText,
                        children: [
                            jsxs("div", {
                                className: STYLES.nameRow,
                                children: [
                                    jsx("span", { className: STYLES.name, children: t("title") }),
                                    // A card holding a staged edit announces it
                                    // beside the title, the way the reference
                                    // cards mark a pending save.
                                    state.dirty
                                        ? jsx("span", { className: STYLES.badge, children: t("unsaved") })
                                        : null,
                                    view.dotIsError || view.missing
                                        ? jsx("span", {
                                            className: STYLES.dot + " " + STYLES.dotError,
                                            role: "img",
                                            "aria-label": dotAria,
                                            title: dotLabel
                                        })
                                        : null
                                ]
                            }),
                            jsx("span", { className: STYLES.desc, children: t("description") })
                        ]
                    }),
                    jsx("svg", {
                        width: 14,
                        height: 14,
                        className: STYLES.chevron + (open ? " " + STYLES.chevronOpen : ""),
                        viewBox: "0 0 14 14",
                        fill: "none",
                        xmlns: "http://www.w3.org/2000/svg",
                        children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                    })
                ]
            }),
            open
                ? jsxs("div", {
                    id: bodyId,
                    className: STYLES.body,
                    children: [
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
                        // The one state no control of this card can express: the
                        // host runs under WSL and what is selected is a Windows
                        // executable — which the bridge cannot launch, however
                        // healthy its `--version` answer looks. Nothing has failed
                        // yet, so this is a notice (static copy, shown only while
                        // the host reports the state), not a third error surface:
                        // the required configuration differs.
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
                        state.lastError
                            ? jsx("p", { className: STYLES.error, role: "status", children: state.lastError })
                            : null,
                        state.actionError
                            ? jsx("p", { className: STYLES.error, role: "status", children: state.actionError })
                            : null,
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
                        // The form writes nothing as it is edited: every staged
                        // edit is persisted only when **Apply** lands them, and
                        // **Discard** drops the whole draft — reverting every
                        // staged value to what the host already serves — before
                        // collapsing the body.
                        jsxs("div", {
                            className: STYLES.footer,
                            children: [
                                state.failed
                                    ? jsx("p", { className: STYLES.footerError, role: "status", children: t("saveFailed") })
                                    : null,
                                jsx("button", {
                                    type: "button",
                                    className: STYLES.footerButton,
                                    onClick: () => {
                                        if (typeof props.discard === "function") props.discard();
                                        setOpen(false);
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
                })
                : null
        ]
    });
}
