/**
 * Types — the **Prelaunch Windows Chrome** run's state machine and outcome.
 *
 * Everything the card derives the Windows button's state from: the single
 * `windowsChromeStatus` base-layer field plus the run's own richer answer. Split
 * out of the single `types.ts`; the run itself lives in ../windows/.
 */

/**
 * What the **Prelaunch Windows Chrome** run is currently doing — the single field
 * the card derives the button's enabled state, its disabled reason and the
 * pill's connect-mode muting from. Base-layer mirror (host state, never
 * persisted).
 *
 * `not-applicable` is the non-WSL answer (nothing to drive off this host);
 * `not-found`, `unreachable` and `launch-failed` are the run's failure states;
 * `launching` covers both the launch and the wait for the port to bind.
 */
export type WindowsChromeState =
    | "off"
    | "launching"
    | "connected"
    | "unreachable"
    | "not-found"
    | "launch-failed"
    | "not-applicable";

/** The served Windows-Chrome status: the state machine, the debugging port it
 * settled on (0 = none), and the failure line when the last answer failed. */
export type WindowsChromeStatus = { state: WindowsChromeState; port: number; error: string };

/** One workspace-view link answer: created, moved, left alone (a real
 * directory is already there), or unusable. */
export type WindowsChromeLinkAnswer = "linked" | "updated" | "kept" | "failed";

/** The outcome of one {@link runWindowsChromeConnect}: the same shape the base
 * layer carries, plus the connect address the bridge has to run with for the
 * state to be true ("" when there is nothing to connect to), and the
 * Windows-side profile directory a successful run settled on ("" when the run
 * never got that far) with the workspace-view link it refreshed. */
export type WindowsChromeRun = WindowsChromeStatus & {
    url: string;
    profileDir: string;
    profileLink?: WindowsChromeLinkAnswer;
};
