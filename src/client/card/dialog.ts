/**
 * The fetch dialog — the "choose which executables to keep" modal the fetch
 * action opens once the host's executable run settled.
 *
 * One checkbox row per detected candidate — each carrying the answer the run
 * gave for it (its version line, or why it is not runnable), the reference
 * card's note slot. Already-saved paths are carried pre-checked and disabled
 * (removal is the row list's delete button, never a dialog side effect), a
 * search field sifts long path lists, and the footer's "Add selected" merges
 * the checked paths into the saved rows. Nothing here persists on its own:
 * closing with Cancel or the header X leaves the catalog untouched.
 */
import * as react from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import STYLES from "../styles/ChromeMcpCard.module.css";
import { CLOSE_PATHS } from "./icons.js";

/**
 * Candidate rows arrive from the run that opened the dialog (the controller's
 * candidate list); the dialog itself keeps only its filter/selection draft, so
 * a re-render of the card cannot disturb the draft.
 */
export function CandidateDialog(props: any): any {
    var t = props.t;
    var candidates: { id: string; note: string; broken: boolean }[] = props.candidates;
    var savedIds: string[] = props.savedIds;
    var savedSet = new Set(savedIds);
    var initialChecked = candidates.filter((candidate) => savedSet.has(candidate.id)).map((candidate) => candidate.id);
    // The dialog mounts over a run that just landed; one keyed draft object
    // holds the filter + selection so a new candidate list resets the whole
    // draft (the row list's served-sync idiom, for a whole dialog session —
    // nothing may bleed from a previous run).
    var servedKey = JSON.stringify(candidates) + "|" + JSON.stringify(savedIds);
    var draftState = react.useState({ key: "", query: "", checked: [] as string[] });
    var draft = draftState[0];
    var setDraft = draftState[1];
    var dirty = draft.key !== servedKey;
    var query = dirty ? "" : draft.query;
    var checked = dirty ? initialChecked : draft.checked;
    var checkedSet = new Set(checked);
    var setQuery = (value: string) => {
        setDraft({ key: servedKey, query: value, checked: Array.from(checkedSet) });
    };
    var setChecked = (make: (current: string[]) => string[]) => {
        setDraft({ key: servedKey, query: query, checked: make(checked) });
    };
    var needle = query.trim().toLowerCase();
    var shown = needle === "" ? candidates : candidates.filter((candidate) => candidate.id.toLowerCase().indexOf(needle) !== -1);
    var addable = shown.filter((candidate) => !savedSet.has(candidate.id)).map((candidate) => candidate.id);
    var allChecked = addable.length > 0 && addable.every((id: string) => checkedSet.has(id));

    var toggle = (id: string, value: boolean) => {
        setChecked((current: string[]) => (value ? current.concat([id]) : current.filter((entry: string) => entry !== id)));
    };

    return jsxs("div", {
        className: STYLES.fetchDialog,
        role: "dialog",
        "aria-modal": "true",
        "aria-label": props.title,
        children: [
            jsxs("div", {
                className: STYLES.dialogContent,
                children: [
                    jsxs("div", {
                        className: STYLES.dialogHeader,
                        children: [
                            jsx("h2", { className: STYLES.dialogTitle, children: props.title }),
                            jsx("button", {
                                type: "button",
                                className: STYLES.dialogClose,
                                "aria-label": t("close"),
                                onClick: () => props.onClose(),
                                children: jsx("svg", {
                                    width: 14,
                                    height: 14,
                                    viewBox: "0 0 16 16",
                                    fill: "none",
                                    xmlns: "http://www.w3.org/2000/svg",
                                    "aria-hidden": "true",
                                    children: CLOSE_PATHS.map((d: string, at: number) => jsx("path", { d: d, fill: "currentColor" }, at))
                                })
                            })
                        ]
                    }),
                    jsx("p", { className: STYLES.dialogDescription, children: props.description }),
                    jsxs("div", {
                        className: STYLES.dialogBody,
                        children: [
                            jsxs("div", {
                                className: STYLES.candidateToolbar,
                                children: [
                                    jsx("input", {
                                        className: STYLES.candidateSearch,
                                        type: "search",
                                        placeholder: props.searchPlaceholder,
                                        "aria-label": props.searchPlaceholder,
                                        value: query,
                                        onChange: (event: any) => {
                                            setQuery(event && event.target ? String(event.target.value ?? "") : "");
                                        }
                                    }),
                                    jsx("button", {
                                        type: "button",
                                        className: STYLES.linkButton,
                                        onClick: () => {
                                            if (allChecked) setChecked(() => []);
                                            else setChecked((current: string[]) => Array.from(new Set(current.concat(addable))));
                                        },
                                        children: t("selectAll")
                                    })
                                ]
                            }),
                            shown.length === 0
                                ? jsx("p", { className: STYLES.empty, children: t("dialogEmpty") })
                                : jsx("ul", {
                                    className: STYLES.candidateList,
                                    children: shown.map((candidate) => {
                                        var isSaved = savedSet.has(candidate.id);
                                        // A row already saved carries the tag that
                                        // says so; anything else carries the run's
                                        // own answer.
                                        // Whatever the run answered leads the row;
                                        // a saved path with nothing to report says
                                        // it is already saved.
                                        var note = candidate.note !== "" ? candidate.note : (isSaved ? t("candidateSaved") : "");
                                        return jsx("li", {
                                            className: STYLES.candidate,
                                            children: jsxs("label", {
                                                className: STYLES.candidateLabel,
                                                children: [
                                                    jsx("input", {
                                                        type: "checkbox",
                                                        checked: isSaved ? true : checkedSet.has(candidate.id),
                                                        disabled: isSaved,
                                                        onChange: (event: any) => {
                                                            toggle(candidate.id, !!(event && event.target && event.target.checked));
                                                        }
                                                    }),
                                                    jsx("span", { className: STYLES.candidateId, children: candidate.id }),
                                                    note === "" ? null : jsx("span", { className: STYLES.candidateNote, children: note })
                                                ]
                                            })
                                        }, candidate.id);
                                    })
                                })
                        ]
                    }),
                    jsxs("div", {
                        className: STYLES.dialogFooter,
                        children: [
                            jsx("button", {
                                type: "button",
                                className: STYLES.dialogButton,
                                onClick: () => props.onClose(),
                                children: t("cancel")
                            }),
                            jsx("button", {
                                type: "button",
                                className: STYLES.dialogButton + " " + STYLES.dialogButtonPrimary,
                                onClick: () => props.onAdd(Array.from(checkedSet)),
                                children: t("addSelected")
                            })
                        ]
                    })
                ]
            })
        ]
    });
}
