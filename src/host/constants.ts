/**
 * Host-half fixed identifiers, budgets and validation patterns.
 *
 * The strings are a public contract — the profile entry id is both the
 * persistence key and the Web card's configuration-form key — and the budgets
 * are what the README and the tests quote, so they live here once and every
 * module imports rather than repeats them.
 */

/**
 * The profile entry id the bundle patch inserts (`cordis.patch.yml`), and the
 * key every read and write of the configuration form goes through. Since dsh
 * 0.2.0 the card addresses the Host through the **entry id**, not a namespace of
 * its own, and `serverName` is not part of that identity. The Host reads the
 * live id off its own fiber (`chromeMcpEntryId`) so a renamed row keeps
 * working; this constant is what the loud failure and the log lines name.
 */
export const ENTRY_ID = "mcp-chrome";

/** Environment variable that seeds the launch flags for one dsh run. */
export const FLAGS_ENV_VAR = "DSH_CHROME_MCP_FLAGS";

/**
 * Flag entries are appended verbatim to the bridge argv and reach Chrome via
 * a direct execve (no shell), so shell metacharacters cannot execute here.
 * What must never reach argv is control characters (newlines, NULs) — they
 * corrupt the argument framing, so entries may not contain any. This is the
 * `extraFlags` field's own pattern: a form write naming a control character is
 * refused Host-side, by the schema rather than by a `validate` hook.
 */
export const CONTROL_PATTERN = /[\x00-\x1f\x7f]/u;

/**
 * One `extraFlags` entry as a form write may land it: non-empty, and no control
 * character. This is the field's own pattern, so the gate that refuses them is
 * the **schema**, not a `validate` hook — the write path runs it Host-side, on
 * every layer (a row config carrying a newline fails to resolve rather than
 * reaching argv as a corrupt entry). Spaces inside a value stay allowed: a
 * Windows-style path in a flag value is one argv item, never a shell word (see
 * ./flags.ts `validateExtraFlags` for what the paths the form never edits —
 * `DSH_CHROME_MCP_FLAGS`, the row config — still check).
 */
export const EXTRA_FLAG_PATTERN = /^(?:[^\x00-\x1f\x7f]+)$/u;

/** Flags every launch carries unless the user overrides them. */
export const DEFAULT_EXTRA_FLAGS = ["--no-usage-statistics", "--no-performance-crux"];

/**
 * The flags the card's **Flags WSL** control appends for a WSL ↔ Windows
 * debugging setup — a fixed recommendation, not a setting and never persisted.
 * The shape is what makes it actually reach the browser:
 *
 * - the debug port travels as `--chromeArg=--remote-debugging-port=9222`:
 *   the bridge's strict parser knows only its own option names, so a bare
 *   `--remote-debugging-port` is reported as `Unknown arguments` and dropped
 *   before any browser is launched; as a `chromeArg` it lands in Chrome's own
 *   argv and the debugging port opens (see the "Browser switches" hard
 *   constraint).
 *
 * A `--user-data-dir` entry is deliberately **not** recommended alongside it.
 * The idea of carrying the profile as a project-rooted `.chrome` was measured
 * to be impossible for the Windows executable: a Windows `chrome.exe` profile
 * directory has to live on a Windows-local path — neither the WSL checkout
 * nor the `\\wsl.localhost` mount can carry its locks (9P) — so the
 * **Prelaunch Windows Chrome** run launches with its own Windows-native
 * profile under `%LOCALAPPDATA%`, and the one entry this list recommends is
 * the debug port the run answers on.
 */
export const WSL_EXTRA_FLAGS = ["--chromeArg=--remote-debugging-port=9222"];

/** Upstream configuration docs surfaced by the client card link. */
export const CONFIGURATION_DOCS_URL =
    "https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md";

/** Timeout for one check subprocess (chrome executable probe). */
export const CHECK_TIMEOUT_MS = 15000;

/**
 * What a Windows executable answers when no version folder sits beside it. On
 * Windows a Chromium browser does not answer `--version`: it opens a window
 * (or hands one to the instance already running), so it is never spawned to
 * ask — the version is read off the install's own `<major>.<minor>.<build>.<patch>`
 * folder instead, and an install without one answers this.
 */
export const WINDOWS_VERSION_UNKNOWN = "version unknown";

/**
 * How long a failed executable run waits before its one bounded retry. The
 * failure this answers is not "nothing is installed here" — it is a host that
 * is not ready yet at the moment the run fires (a WSL boot whose interop
 * mount has not been served yet, a drive not yet mounted). Without the retry
 * that answer would stand until someone fired the run again by hand.
 */
export const DISCOVERY_RETRY_DELAY_MS = 15000;

/** How many retries one run chain may arm. Bounded so a machine with nothing
 * installed is never probed forever — four passes span a boot window, and the
 * manual trigger stays the answer beyond it. */
export const DISCOVERY_RETRY_MAX = 4;

/**
 * Why a Windows `chrome.exe` on a WSL host is **never probed** — and, since the
 * Windows executables this host carries *are* offered as candidates, what such a
 * candidate reads as instead of a failure. The exec answers successfully — which
 * is what makes the selection look healthy — but answering means *attaching to
 * the Windows browser session*, and that brings a browser instance up (measured
 * on WSL2 + Google Chrome 153: `chrome.exe --version` spawns the browser process
 * plus its crashpad handler). No tool call could ever drive what it started (the
 * debug pipes do not cross the interop boundary), so the probe buys nothing and
 * costs a running browser: the check answers nothing, and the scan keeps the
 * entry visible carrying this reason — as its **note**, never as a failure,
 * because the **Prelaunch Windows Chrome** run drives it in connect mode.
 */
export const WSL_WINDOWS_LAUNCH_ERROR =
    "Windows chrome.exe cannot be launched from WSL — run Prelaunch Windows Chrome to drive it in connect mode";

/** Max length of a reported error line. */
export const ERROR_CAP = 240;

/**
 * Log lines the bridge emits after a lost connection recovered — clear
 * the captured connection error when one shows up.
 */
export const BRIDGE_RECONNECTED = /reconnected and re-synced tools/u;

/** One bridge log level: the levels the captured wrapper shadows. */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

/**
 * Bridge console-output routing modes (mirrors the reference plugin's gateway
 * stderr modes). "log" redirects the spawned child's stderr into a log file;
 * "console" inherits it onto the dsh console.
 */
export const BRIDGE_STDERR_MODES: ReadonlyArray<"log" | "console"> = ["log", "console"];

/** Modes accepted by the `stderrMode` user layer: also the empty string
 * ("" → follow the row config `bridgeStderr`). */
export const STDERR_MODE_FIELD_PATTERN = /^(?:log|console)?$/u;

/** Row-config `bridgeStderrLog` accepts "" (the per-spawn default) or a
 * POSIX absolute path; nothing else. */
export const OPTIONAL_PATH_PATTERN = /^(?:\/[^\x00-\x1f\x7f]*|)$/u;

/**
 * The connection kinds this component registers with the manager's
 * `mcpConnections` service. They are the
 * component: the row stands up no bridge of its own any more, every live bridge
 * is one of these connections.
 *
 * `chrome` — the local `chrome-devtools-mcp` bridge, what the row used to start
 * for itself. `chrome-windows` — the Windows browser driven through the WSL
 * interop mount (the run the **Prelaunch Windows Chrome** button answers with),
 * async to launch. The ids are the contract with `servers` entries; the labels
 * are what the picker lists. Neither kind caps its entries and neither carries
 * a composer pill.
 */
export const KIND_ID_CHROME = "chrome";
export const KIND_ID_WINDOWS = "chrome-windows";
export const KIND_CHROME_LABEL = "Chrome MCP";
export const KIND_CHROME_SUMMARY = "Runs `chrome-devtools-mcp` and launches a local Chrome. The executable and the flags are picked on the connection.";
export const KIND_WINDOWS_LABEL = "Windows Chrome (WSL debug port)";
export const KIND_WINDOWS_SUMMARY = "Opens the Windows Chrome through the WSL interop mount and connects to its debugging port. WSL only.";

/**
 * The keys one entry's `extra` carries for these kinds. They are a contract with
 * the manager's entry editor: what the fields write is exactly what `resolve`
 * reads back. `extraFlags` is a `lines` field, so its value is one flag per
 * line joined by newlines (see ./kind.ts `parseFlagLines`).
 */
export const KIND_FIELDS = {
    executable: "executable",
    extraFlags: "extraFlags",
    stderrMode: "stderrMode"
} as const;

/**
 * Whether the translation of a **standalone** row config has been offered and
 * turned down. It is a volatile field of this
 * row — what was refused is this row's configuration, so the dismissal lives
 * here and nowhere else.
 */
export const MIGRATION_DISMISSED_FIELD = "migrationDismissed";

/** One entry's extra flag lines joined the way a `lines` field stores them. */
export const FLAG_LINE_SEPARATOR = "\n";

/** Why the `chrome-windows` kind refuses an entry off WSL (spec §2: not-applicable). */
export const NOT_WSL_ERROR =
    "This host is not a WSL instance: there is no Windows-side browser to drive — use the Chrome MCP kind instead";

/**
 * `chromePath` user layer: a filesystem path or a PATH-resolved name. Nothing
 * travels through a shell here either, so the only hard constraint is that no
 * control character reaches it; the length cap keeps one absurd value out of
 * argv and out of the row's own patch layer.
 */
export const CHROME_PATH_PATTERN = /^[^\x00-\x1f\x7f]{0,4096}$/u;

/** Upper bound of the **legacy** UI-authored custom-executable MRU (oldest
 * drops off). The MRU is the older shape of the saved-executables list: a host
 * whose settings still carry it folds its paths into the `executables` rows the
 * first time the picker scans (see ./catalog.ts `mergeEntries`), after which the
 * rows are the only source of saved executables. */
export const CUSTOM_PATHS_CAP = 10;

/** Longest display name a saved-executable row may carry — the `name` half is
 * UI-only (what the pill and the dropdown render), the `id` half is what goes on
 * the wire. */
export const CATALOG_NAME_MAX_LENGTH = 200;

/** Upper bound of the saved-executable rows, merged-list side: the tail drops
 * off, so a scan that keeps discovering new ids cannot grow the persisted
 * catalog without limit. */
export const CATALOG_MAX_LENGTH = 50;

/**
 * The Windows-side Chrome/Edge executables this host carries. The
 * **Prelaunch Windows Chrome** button locates through them, and — on a WSL host
 * only — the executable run folds the ones this machine actually carries into its
 * candidate list, so the picker can name the executable the run drives. They are
 * never *probed* from here (`WSL_WINDOWS_LAUNCH_ERROR`): the run drives them in
 * *connect* mode, which is the only Windows path ever measured to work. The list
 * is host-served logic: the card carries no copy of it.
 */
export const WINDOWS_CHROME_CANDIDATES = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
] as const;

/** The debugging port every Windows Chrome launch carries first — kept
 * coherent with the port the **Flags WSL** control recommends. */
export const WINDOWS_CHROME_PORT = 9222;

/** The debugging-port pool the run falls through when the first port is already
 * carrying a listener: [first, first+1, …]. A listener answers "reachable",
 * which is what makes the port's own reachability sample its in-use signal. */
export const WINDOWS_CHROME_PORT_POOL = [9222, 9223, 9224] as const;

/**
 * Ports that **only Windows ever listens on** (RPC endpoint mapper, RDP). The
 * prereq check connects one of them: on a `mirrored` networkingMode host the
 * connect succeeds, on a NAT host it gives up — the sample must discriminate,
 * which is exactly what makes it the prereq (measured: 135/3389 CONNECTED
 * under mirrored, closed ports TIME OUT, never refuse). A port that WSL might
 * hold locally (445 via Samba) must never be used: it would answer reachable
 * even when the Windows loopback is unreachable.
 */
export const WINDOWS_CHROME_PREREQ_PORTS = [135, 3389] as const;

/** How long to wait for the launched Windows Chrome to open its port. */
export const WINDOWS_CHROME_WAIT_MS = 10000;

/** How long one TCP reachability sample waits before calling the port
 * unreachable (a NAT host's closed port times out; it never refuses). */
export const WINDOWS_CHROME_SAMPLE_MS = 1000;

/** Poll cadence while waiting for a launched Windows Chrome to bind its port. */
export const WINDOWS_CHROME_POLL_MS = 500;

/**
 * The Windows-side working directory the launch runs with. Nothing depends on
 * it (every argument is absolute), it only keeps relative path resolution off
 * any UNC (WSL-side) path — the shape the old `cmd.exe /c start` form needed
 * too (measured 2026-10-04, see .probe/windows-chrome-connect-probe.log).
 */
export const WINDOWS_CHROME_START_CWD = "/mnt/c/Windows";

/** The UNC root modern WSL exports to Windows-side processes. */
export const WSL_UNC_ROOT = "\\\\wsl.localhost\\";

/**
 * The Windows-side directory name the run profiles under
 * (`%LOCALAPPDATA%\dsh-chrome-mcp\<.chrome|\.chrome-<port>>`). The profile
 * must live on the Windows filesystem: the WSL-side directories, served to
 * Windows through 9P, cannot carry the locks Chrome's SQLite tables and its
 * singleton socket take — a profile rooted there opens every table as a
 * zero-byte file and shows "an error occurred while opening your profile" on
 * every launch (measured live 2026-10-04 against Chrome 154). The workspace
 * keeps a `.chrome` view of this directory through the link the run refreshes
 * (see `linkWindowsChromeProfile`).
 */
export const WINDOWS_CHROME_PROFILE_DIRNAME = "dsh-chrome-mcp";

/** The connect-mode flag the button writes; its value is the debugging URL. */
export const BROWSER_URL_FLAG_PREFIX = "--browserUrl=";

/**
 * The flags a brand-new Windows profile is launched with, beside the port and
 * the profile directory. A fresh `--user-data-dir` IS a first run for the
 * browser: Windows Chrome opens the welcome tab and the default-search-engine
 * chooser on it, and in connect mode nothing clicks through it — the debugging
 * session is left sitting on the FRE page. Both flags suppress that
 * experience, exactly like the manual recipe the button replaces. They travel
 * on the **browser's own** argv (the `start` line), never as `--chromeArg=`:
 * here it is Chrome being told at launch what not to show, not the bridge
 * parser (see the browser-switches bullet under Hard constraints).
 */
export const WINDOWS_CHROME_FIRST_RUN_FLAGS = ["--no-first-run", "--no-default-browser-check"] as const;

/**
 * The page the Windows launch opens, package-root-relative. It is the one asset
 * this plugin ships outside `lib`, and it is **read host-side**: the run renders
 * it with its own answers, writes it through the interop mount next to the
 * profile directory (so the Windows-side browser can actually read it), and hands
 * the browser the `file:///…` URL. It exists because the honest answer to "why
 * did a window just open?" is prose the argv cannot carry — and the usual
 * placeholder is not an option: `example.com` carries an explicit notice against
 * being used for automation and tests.
 */
export const WINDOWS_CHROME_LANDING_ASSET = "assets/prelaunch-windows-chrome.html";

/** The base name of the landing file written beside each profile directory
 * (`…\dsh-chrome-mcp\prelaunch-<port>.html`) — a sibling of the profile, never a
 * file inside it, so it never reads as profile churn. */
export const WINDOWS_CHROME_LANDING_BASENAME = "prelaunch";

/** What one Windows Chrome run may currently be doing (the card derives its
 * button state, pill muting and disabled reason from this single field).
 * `"not-applicable"` is the non-WSL answer the plan asks the button to read as
 * disabled-off; `"launch-failed"` and the rest are the §4 failure states. */
export const WINDOWS_CHROME_STATES = [
    "off",
    "launching",
    "connected",
    "unreachable",
    "not-found",
    "launch-failed",
    "not-applicable"
] as const;

/** Schema pattern for `windowsChromeStatus.state`. */
export const WINDOWS_CHROME_STATE_PATTERN = /^(?:off|launching|connected|unreachable|not-found|launch-failed|not-applicable)$/u;

/**
 * The prereq answer — the one manual step that is not the button's job
 * (configuring `~/.wslconfig` is out of scope, reading/reaching it is not).
 */
export const WINDOWS_CHROME_PREREQ_ERROR =
    "Windows Chrome needs networkingMode=mirrored in %USERPROFILE%\\.wslconfig, then wsl --shutdown: today the Windows loopback is not reachable from this WSL host";

/** Where the effective selection came from (`effectiveSource`): a `chromePath`
 * written by the card (or seeded once by the host) or the row config. Nothing
 * resolves on its own, so there is no "auto". */
export const EFFECTIVE_SOURCES = ["selected", "row-config"] as const;

/**
 * Environment variables WSL exports into every distro session. Their presence
 * answers "are we running inside WSL?" — the first one carries the distro name,
 * `WSL_INTEROP` the interop-path directory (`/run/WSL/<pid>`).
 */
export const WSL_ENV_VARS = ["WSL_DISTRO_NAME", "WSL_DISTRO_LABEL", "WSL_INTEROP"] as const;

/**
 * The `binfmt_misc` registration WSL installs for PE binaries: its presence
 * marks a WSL kernel. It is only the **fallback** signal — inside a host the
 * launch environment is authoritative, and an empty one is an answer (see
 * ./platform.ts).
 */
export const WSL_INTEROP_MARKER = "/proc/sys/fs/binfmt_misc/WSLInterop";

/** Windows executables reachable through the interop mount (`/mnt/c/...`) or by
 * their Windows spelling (UNC, drive letter). */
export const WINDOWS_PATH_PATTERN = /^(?:\/mnt\/[a-z]\/|\\\\[\w.-]+\\|[a-z]:[\\/])/iu;

/** The PE suffix. WSL execve's a `.exe` from any path (the Windows loader reads
 * the Linux filesystem over UNC), so the suffix alone marks a Windows binary. */
export const WINDOWS_EXE_PATTERN = /\.exe$/iu;

/** Schema pattern for `effectiveSource` ("" = nothing resolved yet). */
export const EFFECTIVE_SOURCE_PATTERN = /^(?:selected|row-config)?$/u;

