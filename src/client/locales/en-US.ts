/**
 * English copy — the dictionary every other tag falls back to.
 *
 * Every string the card renders lives here; the widget itself stays
 * copy-free. Add a locale by dropping a sibling file and registering it in
 * ./index.ts.
 *
 * No key describes an "automatic" state, because there is no auto mode: what
 * the saved-executable rows list is what can be picked, and the only automatic
 * step is the host seeding a never-configured host once.
 */
export const en = {
    executableLabel: "Chrome executable",
    executableHint: "The executable every connection launched from this row launches with, unless the connection picked its own. Changing it answers the live connections again.",
    executableNone: "No Chrome executable detected",
    executableRows: "Saved executables",
    executableIdLabel: "Executable path",
    executableIdPlaceholder: "Path to a Chrome executable",
    executableNameLabel: "Display name",
    namePlaceholder: "Display name",
    addExecutable: "Add executable",
    removeExecutable: "Delete executable",
    fetchExecutables: "Fetch executables",
    fetching: "Fetching…",
    executableEmpty: "No executables saved. Use “Fetch executables”, or add the Chrome path by hand.",
    dialogExecutablesTitle: "Choose executables to add",
    dialogExecutablesDescription: "These are the Chrome executables this host's last run answered for. Choose the ones to add.",
    dialogEmpty: "Nothing matches your search.",
    searchExecutables: "Search executables",
    selectAll: "Select all",
    addSelected: "Add selected",
    candidateSaved: "Saved",
    close: "Close",
    cancel: "Cancel",
    unavailableSuffix: "not runnable",
    wslWindowsTitle: "Windows executable under WSL",
    wslWindowsNote:
        "This host runs inside Windows Subsystem for Linux and the selected executable is the Windows Chrome, which no connection here can launch: the debug pipes it opens do not survive the WSL interop boundary, and its debugging port stays bound to the Windows loopback. It answers --version correctly, so the pill looks healthy until the first tool call fails. Drive it instead with the “Windows Chrome (WSL debug port)” connection, or with its run — Prelaunch Windows Chrome, the action the executable block carries next to Fetch executables, or the prelaunch_windows_chrome tool — which starts the Windows browser on a free debugging port. The run only reads whether Windows loopback reaches this WSL host (networkingMode=mirrored in %USERPROFILE%\\.wslconfig, then wsl --shutdown — a manual Windows-side setting it never edits). Chrome installed inside the Linux distro needs none of this.",
    probing: "Checking the executables…",
    versionLabel: "Probed version:",
    probeJustNow: "just now",
    probeSecondsAgo: "seconds ago",
    probeMinutesAgo: "minutes ago",
    probeHoursAgo: "hours ago",
    flagsTitle: "Extra flags",
    flagsHint: "The extra flags every connection launched from this row launches with, unless the connection carries its own. One flag per row — applying them answers the live connections again.",
    flagsEmpty: "No extra flags saved. Add one by hand, or use “Restore defaults”.",
    flagsRows: "Saved flags",
    flagsValueLabel: "Extra flag",
    flagsValuePlaceholder: "e.g. --headless",
    addFlag: "Add flag",
    removeFlag: "Delete flag",
    flagsRestore: "Restore defaults",
    flagsRestoreTitle: "Keep every flag the rows carry and append the defaults that are still missing",
    flagsWsl: "Flags WSL",
    flagsWslTitle: "Append the recommended WSL<->Windows flags",
    openWindowsChrome: "Prelaunch Windows Chrome",
    openWindowsChromeTitle: "Start the Windows-side Chrome with --remote-debugging-port and refresh whatever Windows Chrome connections stand live",
    openWindowsChromeBusy: "Starting Windows Chrome…",
    windowsChromeNotWsl: "Windows Chrome does not apply outside WSL.",
    windowsChromeNotFound: "No Windows Chrome was found (Program Files / Program Files (x86)) — run it again once one is installed.",
    windowsChromeUnreachable:
        "Needs networkingMode=mirrored in %USERPROFILE%\\.wslconfig, with wsl --shutdown: right now this WSL host cannot reach the Windows loopback.",
    connectModeLabel: "Connect mode",
    connectModeHint: "Connect mode: the connection launches no local Chrome (it connects with --browserUrl / --wsEndpoint); the local selection stays put.",
    reduceLabel: "Reduce log output",
    reduceTitle: "Capture the connection's stderr into the plugin's log file",
    reduceHint: "Captures stderr into the plugin's log file. Turn it off to debug the raw output; switching answers the live connections again.",
    // The staged form's own copy: nothing is written until **Apply** lands every
    // staged edit, so the card announces what a save would store and what it
    // could not land.
    apply: "Apply",
    discard: "Discard",
    saving: "Applying…",
    unsaved: "Unsaved",
    saveFailed: "The last save was not accepted.",
    docsMessage: "Find the complete list of server parameters (e.g., --headless, --isolated, --slim) and how to configure WebSocket connections in the Configuration Guide.",
    docsLinkLabel: "Configuration Guide",
    statusError: "Error",
    statusOk: "OK",
    chromeMissing: "Chrome executable not found",
    // The body-mounted toast host's copy: it announces what the card's own error
    // line can only show while the row page is open. An error notice carries the
    // Host's captured line, so `toastError` only stands behind an empty one.
    toastStall: "The Chrome host did not answer the action — try it again.",
    toastError: "The Chrome host reported a failure.",
    readOnly: "Settings are read-only in this deployment."
};
