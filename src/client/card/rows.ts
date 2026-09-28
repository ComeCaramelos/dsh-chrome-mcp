/**
 * The rows list both catalogs render — the reference card's catalog rows, held
 * in one module so the saved executables and the extra flags read as one widget
 * instead of two lookalikes.
 *
 * A row is a bordered box of text fields in column order, every box ending on
 * the row's delete control; the list opens on the empty line and closes on the
 * add control. The executable block hands it two fields (the path and the
 * display name) folded behind the reference card's "Customized settings"
 * disclosure, the flags block a single field (the flag itself). Both now fold
 * behind the same collapsed `<details>` disclosure — the two blocks read as one
 * widget shape, differing only in how many fields a row carries.
 *
 * Like the reference card's `editing` map, rows come from the served snapshot
 * with a local draft overlaying them only while an edit is pending: typing does
 * not persist, a blur/Enter commits the whole list, a delete persists
 * immediately, and "add" appends a local blank row that only becomes a saved row
 * once it is typed in. Once the field is idle, the next host push (a discovery
 * merge that added rows, or a defaults restore) becomes the view again.
 *
 * The list action belongs to the caller (`renderAction`) and is handed the rows
 * exactly as they are visible plus the write that persists them: the picker's
 * **Fetch executables** asks the host to re-scan the machine's list, and the
 * flags block lines its two append controls up in the one slot — **Restore
 * defaults** appends what the defaults list is missing to precisely what the
 * rows already carry, **Flags WSL** the missing recommended WSL ↔ Windows
 * flags the same way.
 */

/// <reference path="../shell-modules.d.ts" />
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import STYLES from "../styles/ChromeMcpCard.module.css";
import { TRASH_PATH } from "./icons.js";

/** One row's field values, in column order (the path + the name, or the flag). */
export type RowValues = string[];

/** Persist one whole row list; the write side re-normalizes what lands. */
export type SaveRows = (rows: RowValues[]) => unknown;

/**
 * Render one catalog's row list — the empty line, the rows and the add control.
 * @param props - the served rows (`values`), the per-column copy (`labels`,
 * `placeholders`), the write (`save`) and the shape knobs: `disclosure` folds
 * the rows behind a `<details>` (the two-field executable list, which sits
 * under the pill), `rowClassName` / `inputClassName` carry the single-field
 * column variant a block needs when the two-column grid would not fit.
 */
export function RowList(props: any): any {
    var served: RowValues[] = Array.isArray(props.values) ? props.values : [];
    var writable = props.writable === true;
    var busy = props.busy === true;
    var labels: string[] = Array.isArray(props.labels) ? props.labels : [];
    var placeholders: string[] = Array.isArray(props.placeholders) ? props.placeholders : [];
    var columns = Math.max(1, labels.length);
    var blankRow: RowValues = [];
    for (var blank = 0; blank < columns; blank++) blankRow.push("");
    var draftState = react.useState<RowValues[] | null>(null);
    var draft = draftState[0];
    var setDraft = draftState[1];
    var focusedState = react.useState(false);
    var focused = focusedState[0];
    var setFocused = focusedState[1];
    var servedKey = JSON.stringify(served);
    var syncState = react.useState("");
    var servedSync = syncState[0];
    var setServedSync = syncState[1];
    // A host push replaces an idle draft — that is how a discovery merge that
    // added rows (or a defaults restore) becomes visible again.
    if (servedKey !== servedSync) {
        setServedSync(servedKey);
        if (!focused) setDraft(null);
    }
    var rows: RowValues[] = draft === null ? served : draft;

    /**
     * Persist one whole list, and hold the local view to exactly what was
     * written: every structural change (delete, the caller's own action) lands
     * this way, so the draft never disagrees with the write. Deciding whether a
     * write is worth doing belongs to the write side, which normalizes and
     * compares — the list only hands it rows.
     */
    var save = (next: RowValues[]) => {
        if (typeof props.save !== "function") return Promise.resolve();
        setDraft(next);
        return Promise.resolve(props.save(next)).catch(() => { });
    };

    var withDraft = (make: (current: RowValues[]) => RowValues[]) => make(draft === null ? served : draft);

    var patchRow = (index: number, column: number, value: string) => {
        setFocused(true);
        setDraft(
            withDraft((current: RowValues[]) =>
                current.map((row: RowValues, at: number) =>
                    at === index ? row.map((cell: string, field: number) => (field === column ? value : cell)) : row
                )
            )
        );
    };

    var removeRow = (index: number) => {
        if (!writable || rows[index] === void 0) return;
        save(rows.filter((_row: RowValues, at: number) => at !== index));
    };

    var addRow = () => {
        if (!writable) return;
        // A blank row is local until it carries a value: a write that strips the
        // empty row is what turns it into a saved row — the draft keeps it
        // visible either way.
        setDraft(withDraft((current: RowValues[]) => current.concat([blankRow])));
    };

    /** Idle rows are the truth; only a pending edit has to be written. */
    var commit = () => {
        if (draft === null) return;
        save(rows);
    };

    var fieldNode = (row: RowValues, index: number, column: number) =>
        jsx("input", {
            className: props.inputClassName ? STYLES.catalogInput + " " + props.inputClassName : STYLES.catalogInput,
            type: "text",
            value: row[column] === undefined ? "" : row[column],
            placeholder: placeholders[column],
            "aria-label": labels[column] + " " + (index + 1),
            title: column === 0 ? row[column] : void 0,
            disabled: !writable,
            spellCheck: false,
            autoComplete: "off",
            autocapitalize: "off",
            onChange: (event: any) => {
                patchRow(index, column, event && event.target ? String(event.target.value ?? "") : "");
            },
            onFocus: () => setFocused(true),
            onBlur: () => {
                setFocused(false);
                commit();
            },
            onKeyDown: (event: any) => {
                if (event && event.key === "Enter") {
                    setFocused(false);
                    commit();
                }
            }
        }, column);

    var entryNode = (row: RowValues, index: number) => {
        var cells: any[] = [];
        var width = row.length === 0 ? columns : row.length;
        for (var column = 0; column < width; column++) cells.push(fieldNode(row, index, column));
        cells.push(
            jsx("button", {
                type: "button",
                className: STYLES.iconButton + " " + STYLES.iconButtonDanger,
                "aria-label": props.removeLabel + " " + (index + 1),
                title: props.removeLabel,
                disabled: !writable,
                onClick: () => {
                    removeRow(index);
                },
                children: jsx("svg", {
                    width: 14,
                    height: 14,
                    viewBox: "0 0 16 16",
                    fill: "none",
                    "aria-hidden": "true",
                    children: jsx("path", {
                        d: TRASH_PATH,
                        stroke: "currentColor",
                        strokeWidth: 1.3,
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                    })
                })
            })
        );
        return jsx("div", {
            className: STYLES.catalogEntry,
            children: jsxs("div", {
                className: props.rowClassName ? STYLES.catalogRow + " " + props.rowClassName : STYLES.catalogRow,
                children: cells
            })
        }, index);
    };

    // The body, in render order: the caller's action (the reference card's body
    // opens on its fetch link, the flags block opens on Restore defaults), one
    // box per row, then the add control.
    var body: any[] = [];
    if (typeof props.renderAction === "function") body.push(props.renderAction(rows, save));
    var visible: any[] = [];
    for (var index = 0; index < rows.length; index++) visible.push(entryNode(rows[index], index));
    body = body.concat(visible);
    body.push(
        jsx("button", {
            type: "button",
            className: STYLES.addButton,
            disabled: !writable || busy,
            onClick: addRow,
            children: props.addLabel
        })
    );
    var emptyLine = rows.length === 0 ? jsx("p", { className: STYLES.empty, children: props.emptyText }) : null;

    if (props.disclosure !== true) {
        // No disclosure to fold behind: the single-field list reads straight
        // into the block, the same boxes at the same rhythm.
        return [emptyLine].concat(body);
    }
    return [
        emptyLine,
        jsxs("details", {
            className: STYLES.disclosure,
            children: [
                jsxs("summary", {
                    className: STYLES.disclosureSummary,
                    children: [
                        jsx("span", { className: STYLES.disclosureLabel, children: props.rowsLabel }),
                        jsx("span", { className: STYLES.disclosureCount, children: String(rows.length) })
                    ]
                }),
                jsx("div", { className: STYLES.disclosureBody, children: body })
            ]
        })
    ];
}
