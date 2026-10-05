/**
 * The "Reduce log output" toggle — a catalog block in its own right.
 *
 * It renders as a `.catalog` carrying the two-row field (title + switch inline,
 * hint below), so the section reads exactly like the picker block (and inherits
 * the same seam rule: only the block-to-block seam draws a hairline). The switch
 * mirrors what the host actually resolves — the explicit user-layer `stderrMode`
 * when set, else the row-config `rowStderr` fallback — never a phantom state.
 *
 * The Switch primitive renders only the control and names it through `label`,
 * which becomes the control's aria-label; the tooltip therefore lives on the
 * wrapper span the switch is rendered inside.
 */

/// <reference path="../shell-modules.d.ts" />
import { jsx, jsxs } from "react/jsx-runtime";
import { Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import STYLES from "../styles/ChromeMcpCard.module.css";

/** The one catalog block that is a switch rather than a picker. */
export function LogOutputToggle(props: any): any {
    var t = props.t;
    return jsxs("div", {
        className: STYLES.catalog,
        children: [
            jsxs("div", {
                className: STYLES.field,
                children: [
                    jsxs("div", {
                        className: STYLES.fieldRow,
                        children: [
                            jsx("span", { className: STYLES.fieldTitle, children: t("reduceLabel") }),
                            jsx("span", {
                                className: STYLES.toggleLabel,
                                title: t("reduceTitle"),
                                children: jsx(Switch, {
                                    checked: props.checked,
                                    label: t("reduceLabel"),
                                    disabled: props.disabled,
                                    onChange: () => {
                                        if (typeof props.onToggle === "function") props.onToggle();
                                    }
                                })
                            })
                        ]
                    }),
                    jsx("div", { className: STYLES.fieldDesc, children: t("reduceHint") })
                ]
            })
        ]
    });
}
