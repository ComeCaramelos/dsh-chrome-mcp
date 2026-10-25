/**
 * Browser half — the card's own data shapes.
 *
 * The store, the write door and the settle are ancestros' (`CardController`);
 * what is this plugin's is what one served snapshot *means* for the card —
 * these shapes, projected by ./project.ts.
 */
import type { CatalogEntry } from "./catalog.js";

/** One saved row's probe answer, keyed by the row's id. `note` is what an
 * executable this host offers without probing it reads with — the Windows
 * executable a WSL host drives through the **Prelaunch Windows Chrome** run. It
 * is never a failure, so it never turns the row's dot red. */
export interface ChromeExecutableStatus {
    path: string;
    version: string;
    error: string;
    note: string;
}

/** What the host's Windows Chrome run is doing. `state` is the whole answer —
 * the button never re-derives reachability or paths on the client. */
export interface WindowsChromeStatus {
    state: "off" | "launching" | "connected" | "unreachable" | "not-found" | "launch-failed" | "not-applicable";
    port: number;
    error: string;
}

/** The state the card renders, projected off ancestros' snapshot. */
export interface ChromeMcpCardSnapshot {
    available: boolean;
    writable: boolean;
    extraFlags: string[];
    lastError: string;
    chromeMissing: boolean;
    /** Run counter: the signal every executable action waits on. */
    executableDiscoveryRevision: number;
    /** What the selected executable answered with ("" = nothing answered). */
    chromeVersion: string;
    /** The saved executable rows — the dropdown's options. */
    executables: CatalogEntry[];
    /** Per-row probe answers, served by the host (never persisted). */
    executableStatus: ChromeExecutableStatus[];
    /** Persisted selection ("" = nothing picked or seeded yet). */
    chromePath: string;
    /** The path the bridge launches with — what the pill shows. */
    effectiveChromePath: string;
    /** Where that path came from (`"selected"`, `"row-config"` or ""). */
    effectiveSource: "" | "selected" | "row-config";
    /** "Reduce log output" as the card holds it (the draft over what is
     * served): "" follows the row config. */
    stderrMode: "" | "log" | "console";
    /** What the Host resolves the console-output mode to. */
    rowStderr: "log" | "console";
    /** The canonical default extra-flags list (**Restore defaults**). */
    defaultExtraFlags: string[];
    /** The recommended WSL ↔ Windows extra-flags list (**Flags WSL**). */
    wslExtraFlags: string[];
    /** True when the host runs under WSL and the selection is a Windows
     * executable — the state the card's static notice speaks to. */
    wslWindowsExecutable: boolean;
    /** What the host's Windows Chrome run is doing. */
    windowsChromeStatus: WindowsChromeStatus;
    /** True while the bridge launches with a connect-mode flag. */
    carriesConnectionMode: boolean;
    /** The last action-side failure (a refused write), never a Host answer. */
    actionError: string;
    /** True when a staged edit has not been applied yet. */
    dirty: boolean;
    /** True while an apply is crossing the wire. */
    saving: boolean;
    /** True after a save the Host did not accept. */
    failed: boolean;
}
