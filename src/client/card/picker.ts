/**
 * The named picker — one Menu pill over the saved rows plus a catalog list you
 * can refresh, extend by hand and prune. It mirrors the reference card's picker
 * byte for byte in structure (field row → disclosure → rows) so the two cards
 * read as one component set; `statusLine` is the only extra slot, and the card
 * uses it for the probe result line the reference has no equivalent for.
 *
 * The row list itself is ./rows.ts — the same half the extra-flags block
 * renders, read here through two fields (the path and the display name) and
 * folded behind a collapsed `<details>` disclosure (the reference card's
 * "Customized settings" idiom), so only the field row and the dropdown are
 * visible until the user opens the row list.
 */

/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import type { CatalogEntry } from "../catalog.js";
import STYLES from "../styles/ChromeMcpCard.module.css";
import { CHEVRON_PATH } from "./icons.js";
import { RowList } from "./rows.js";

export function CatalogPicker(props: any): any {
    var entries: CatalogEntry[] = props.entries;
    var options = props.options;
    var selectedId = props.selectedId;
    var writable = props.writable;
    var busy = props.busy === true;
    // The saved rows are what the list renders: `id` is the path that goes on
    // the wire, `name` the label the card shows ("" → render the path).
    var rows: string[][] = entries.map((entry: CatalogEntry) => [entry.id, entry.name]);

    /**
     * A whole-list write: the list owns the draft, the controller normalizes on
     * the way in and re-runs the scan the new ids imply.
     */
    var saveEntries = (next: string[][]) => {
        if (typeof props.saveEntries !== "function") return Promise.resolve();
        return Promise.resolve(props.saveEntries(next.map((row) => ({ id: row[0] ?? "", name: row[1] ?? "" }))));
    };

    // The fetch action belongs to this catalog's rows, so it lives inside the
    // body's head, not the field row. The Windows Chrome button rides the same
    // line (the two actions of the executable block, like the flags block
    // carries its two append actions).
    var fetchAction = () =>
        jsx("button", {
            type: "button",
            className: STYLES.linkButton,
            disabled: !writable || busy,
            onClick: () => {
                props.refresh();
            },
            children: busy ? props.busyLabel : props.refreshLabel
        });
    var windowsAction = () =>
        jsx("button", {
            type: "button",
            className: STYLES.linkButton,
            disabled: props.windowsDisabled === true,
            title: props.windowsTitle,
            onClick: () => {
                if (typeof props.windowsOnOpen === "function") props.windowsOnOpen();
            },
            children: props.windowsLabel
        });
    var renderActions = () =>
        jsxs("div", {
            className: STYLES.linkButtonRow,
            children: [fetchAction(), windowsAction()]
        });

    return jsxs("div", {
        className: STYLES.catalog,
        children: [
            jsxs("div", {
                className: STYLES.field,
                children: [
                    jsxs("div", {
                        className: STYLES.fieldRow,
                        children: [
                            jsx("span", { className: STYLES.fieldTitle, children: props.selectorLabel }),
                            jsx("span", {
                                className: STYLES.selectorWrap,
                                children: jsx(Menu, {
                                    open: props.menuOpen,
                                    onClose: () => {
                                        props.setMenuOpen(false);
                                    },
                                    items: options,
                                    selectedId: options.some((option: { id: string }) => option.id === selectedId) ? selectedId : "",
                                    onSelect: (id: string) => {
                                        props.setMenuOpen(false);
                                        props.select(id);
                                    },
                                    align: "end",
                                    portal: true,
                                    anchor: jsxs("button", {
                                        type: "button",
                                        className: STYLES.selector,
                                        "aria-haspopup": "menu",
                                        "aria-expanded": props.menuOpen,
                                        disabled: !writable || busy,
                                        title: props.selectedTitle,
                                        onClick: () => {
                                            props.setMenuOpen(!props.menuOpen);
                                        },
                                        children: [
                                            // The reference card hands the pill a bare label;
                                            // the path needs its own truncating span.
                                            jsx("span", { className: STYLES.selectorLabel, children: props.selectedLabel }),
                                            jsx("svg", {
                                                width: 14,
                                                height: 14,
                                                className: STYLES.pillChevron,
                                                viewBox: "0 0 14 14",
                                                fill: "none",
                                                xmlns: "http://www.w3.org/2000/svg",
                                                children: jsx("path", { d: CHEVRON_PATH, fill: "currentColor" })
                                            })
                                        ]
                                    })
                                })
                            })
                        ]
                    }),
                    jsx("div", { className: STYLES.fieldDesc, children: props.hint })
                ]
            }),
            // The saved rows: two fields per row, folded behind the disclosure,
            // with the fetch action sitting inside the body.
            jsx(RowList, {
                values: rows,
                labels: [props.idLabel, props.nameLabel],
                placeholders: [props.idPlaceholder, props.namePlaceholder],
                writable: writable,
                busy: busy,
                save: saveEntries,
                renderAction: renderActions,
                emptyText: props.emptyText,
                rowsLabel: props.rowsLabel,
                addLabel: props.addLabel,
                removeLabel: props.removeLabel,
                disclosure: true
            }),
            props.statusLine === undefined || props.statusLine === null ? null : props.statusLine
        ]
    });
}
