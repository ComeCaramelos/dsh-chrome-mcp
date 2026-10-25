/**
 * Types — the saved-executable rows and where the effective selection came from.
 *
 * The picker's catalog shape (the rows the card edits and a merged run extends)
 * plus the per-path probe answer and the source tag, split out of the single
 * `types.ts`.
 */

/**
 * One saved-executable catalog row: `id` is the path the bridge launches with,
 * `name` the label the user chose for the UI ("" = render the path). Persisted —
 * the reference plugin's executables catalog, same split.
 */
export type ChromeExecutableEntry = { id: string; name: string };

/**
 * What one saved row answered with, keyed by its id: the `--version` line
 * (`""` when the probe answered nothing), the failure that makes the row not
 * runnable (`""` when it runs), and the **note** that explains an executable
 * this host offers without probing it. A note is not a failure: the path is
 * there and usable, only not launchable *as a local executable* from here — the
 * one case is a Windows `chrome.exe` on a WSL host, which the **Prelaunch
 * Windows Chrome** run drives in connect mode. Base-layer status, never
 * persisted — the rows themselves live in the user layer.
 */
export type ChromeExecutableStatus = {
    path: string;
    version: string;
    error: string;
    note: string;
};

/** Where the effective executable came from (`effectiveSource`). */
export type EffectiveChromeSource = "selected" | "row-config" | "";
