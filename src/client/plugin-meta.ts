/**
 * Browser half — identity and the services the shell must resolve.
 *
 * The identifiers are contracts with the host half: the profile entry id is the
 * key every read and write goes through (both the configuration form's entry and
 * the row the bundle's own patch declares), the locale namespace is the lookup
 * root for every string the card renders, and the npm id tags the DOM this half
 * owns. The browser half is emitted on its own, so it cannot import
 * ./host/constants.ts and they are mirrored here — `test/client.test.mjs` pins
 * the mirror against the host half's export so a drift fails loudly.
 */

/** Profile entry id the host half serves; the configuration form's key. */
export const ENTRY_ID = "mcp-chrome";

/** npm id of this package; tags the injected `style` element. */
export const PLUGIN_ID = "@comecaramelos/dsh-chrome-mcp";

/**
 * npm id of the bundle the row's patch layer lives in. A component is not its
 * own bundle — the row arrives through the manager bundle's patch, so the page
 * this card registers into is keyed by that id, not by this package.
 */
export const BUNDLE_ID = "@comecaramelos/dsh-mcp-manager-bundle";

/**
 * Key this card registers the row-configuration slot under. The Plugins page
 * composes it as `<bundle>#<row id>` — the bundle a person installs, not the
 * package the row runs — so it is a *derived* key rather than a separate
 * identity: `ENTRY_ID` is what every read and write actually goes through, and
 * the bundle id only scopes it. Two components in one bundle therefore cannot
 * alias, and the card never claims a row that is not its own.
 */
export const ROW_CONFIG_KEY = `${BUNDLE_ID}#${ENTRY_ID}`;

/** Locale dictionary namespace this half registers and renders from. */
export const LOCALE_NAMESPACE = "chromeMcp";

/** Upstream configuration docs link (must match host CONFIGURATION_DOCS_URL). */
export const CONFIGURATION_URL =
    "https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md";

/**
 * The wall-clock backstop for every Host run the card waits on (a fetch, a
 * pick, Prelaunch Windows Chrome): the run's own counter settles the wait, this
 * only answers a Host that never does. Generous, because a Windows Chrome
 * launch through the interop mount takes its time.
 */
export const RUN_SETTLE_TIMEOUT_MS = 90000;

/**
 * The Host's live-mirror keys, which every card write clears so a save never
 * persists them. Mirrored from `liveMirrorKeys()` in host/values.ts (the
 * browser half cannot import the host) — `test/client.test.mjs` pins the two.
 */
export const LIVE_KEYS: readonly string[] = [
    "lastError",
    "chromeMissing",
    "executableDiscoveryRevision",
    "chromeVersion",
    "executableStatus",
    "effectiveChromePath",
    "effectiveSource",
    "stderrEffective",
    "defaultExtraFlags",
    "wslExtraFlags",
    "wslWindowsExecutable",
    "windowsChromeStatus",
    "carriesConnectionMode",
    "runningFlags",
    "runningNote"
];
