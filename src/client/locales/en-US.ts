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
    title: "DSH Chrome MCP",
    description: "DSH Chrome MCP server (chrome-devtools-mcp) settings and status",
    executableLabel: "Chrome executable",
    executableHint: "The saved executable the bridge launches with. Selecting one restarts the connection.",
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
        "This host runs inside Windows Subsystem for Linux and the selected executable is the Windows Chrome, which the bridge cannot launch: the debug pipes it opens do not survive the WSL interop boundary, and its debugging port stays bound to the Windows loopback, unreachable over the WSL2 NAT bridge. It answers --version correctly, so the pill looks healthy until the first tool call fails. To drive the Windows browser, start Chrome yourself with --remote-debugging-port=9222 --user-data-dir=C:\\chrome-debug, add --browserUrl=http://127.0.0.1:9222 to the extra flags, and make Windows loopback reachable from WSL by setting networkingMode=mirrored in %USERPROFILE%\\.wslconfig followed by wsl --shutdown. Chrome installed inside the Linux distro needs none of this.",
    probing: "Checking the executables…",
    versionLabel: "Probed version:",
    probeJustNow: "just now",
    probeSecondsAgo: "seconds ago",
    probeMinutesAgo: "minutes ago",
    probeHoursAgo: "hours ago",
    flagsTitle: "Extra flags",
    flagsHint: "The extra flags the bridge launches with. One flag per row — saving restarts the connection.",
    flagsEmpty: "No extra flags saved. Add one by hand, or use “Restore defaults”.",
    flagsRows: "Saved flags",
    flagsValueLabel: "Extra flag",
    flagsValuePlaceholder: "e.g. --headless",
    addFlag: "Add flag",
    removeFlag: "Delete flag",
    flagsRestore: "Restore defaults",
    flagsRestoreTitle: "Keep every flag the rows carry and append the defaults that are still missing",
    flagsWsl: "Flags WSL",
    flagsWslTitle: "Añadir flags recomendados para WSL<->Windows",
    openWindowsChrome: "Prelaunch Windows Chrome",
    openWindowsChromeTitle: "Lanza el Chrome del lado Windows con --remote-debugging-port y deja el bridge en modo conexión",
    openWindowsChromeBusy: "Iniciando Chrome de Windows…",
    windowsChromeNotWsl: "Windows Chrome no aplica fuera de WSL.",
    windowsChromeNotFound: "No se encontró Chrome en el lado Windows (Program Files / Program Files (x86)).",
    windowsChromeUnreachable:
        "Requiere networkingMode=mirrored en %USERPROFILE%\\.wslconfig, con wsl --shutdown: hoy el loopback de Windows no es alcanzable desde este host WSL.",
    connectModeLabel: "Connect mode",
    connectModeHint: "Modo conexión: el bridge no lanza un Chrome local (conecta con --browserUrl / --wsEndpoint); la selección local queda a la espera.",
    reduceLabel: "Reduce log output",
    reduceTitle: "Capture the bridge's stderr into the plugin's log file",
    reduceHint: "Captures stderr into the plugin's log file. Turn it off to debug the raw bridge output; switching restarts the bridge connection.",
    docsMessage: "Find the complete list of server parameters (e.g., --headless, --isolated, --slim) and how to configure WebSocket connections in the Configuration Guide.",
    docsLinkLabel: "Configuration Guide",
    statusError: "Error",
    statusOk: "OK",
    chromeMissing: "Chrome executable not found",
    readOnly: "Settings are read-only in this deployment.",
    expand: "Expand",
    collapse: "Collapse"
};
