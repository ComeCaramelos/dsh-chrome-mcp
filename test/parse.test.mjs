// Host-half pure-function tests for @comecaramelos/dsh-chrome-mcp.
// Run: node test/parse.test.mjs (needs `npm install` first).
import assert from "node:assert/strict";
import {
	buildServerArgs,
	chromeExecutableCandidates,
	checkChrome,
	DEFAULT_CHROME_PATHS,
	DEFAULT_EXTRA_FLAGS,
	defaultChromePaths,
	discoverChrome,
	entryIds,
	entryLabel,
	extractExecutablePathFlag,
	isChromeMissing,
	isValidEntryId,
	isWindowsExecutablePath,
	isWindowsExecutableUnderWsl,
	isWindowsSubsystemForLinux,
	mergeEntries,
	normalizeCustomPaths,
	normalizeEntries,
	readPersistedChromePath,
	readPersistedCustomPaths,
	readPersistedFlags,
	resolveEffectiveChromePath,
	resolveEnvFlags,
	sameFlags,
	scanChromeExecutables,
	stripExecutablePathFlags,
	toolResultNote,
	validateExtraFlags,
	WSL_EXTRA_FLAGS
} from "../lib/index.js";

// ── validateExtraFlags ─────────────────────────────────────────────────────
// Flags are execve'd as argv entries (no shell), so only control characters
// are rejected — except executable-path flags, which belong to the picker.
assert.equal(validateExtraFlags(["--no-usage-statistics", "--no-performance-crux"]), true, "accepts the default flags");
assert.equal(validateExtraFlags([]), true, "accepts an empty list");
assert.equal(
	validateExtraFlags(["--headless=/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"]),
	true,
	"accepts a flag whose value contains spaces (argv is exec'd without a shell)"
);
assert.throws(() => validateExtraFlags("--no-usage-statistics\n--no-performance-crux"), /must be an array/, "rejects a bare string");
assert.throws(() => validateExtraFlags(["--ok", ""]), /non-empty/, "rejects empty entries");
assert.throws(() => validateExtraFlags(["--headless\n--isolated"]), /control characters/, "rejects embedded newlines");
assert.throws(() => validateExtraFlags(["--x\u0000y"]), /control characters/, "rejects NUL");
// The executable is selected in the picker, never smuggled in through flags.
assert.throws(
	() => validateExtraFlags(["--executablePath=/usr/bin/google-chrome"]),
	/executable picker/u,
	"rejects --executablePath"
);
assert.throws(
	() => validateExtraFlags(["--executable-path", "/usr/bin/google-chrome"]),
	/executable picker/u,
	"rejects the kebab spelling"
);
assert.throws(() => validateExtraFlags(["-e", "/usr/bin/google-chrome"]), /executable picker/u, "rejects the short spelling");
assert.equal(validateExtraFlags(["--executablePathology"]), true, "a flag merely starting with the name is not the pin");

// ── the shipped defaults ───────────────────────────────────────────────────
// Every launch carries this unless the user overrides it (the card's Restore
// defaults control appends exactly this list to what the editor holds).
assert.deepEqual(DEFAULT_EXTRA_FLAGS, ["--no-usage-statistics", "--no-performance-crux"], "the shipped defaults are the telemetry-off pair");
assert.equal(validateExtraFlags(DEFAULT_EXTRA_FLAGS), true, "the defaults pass their own validation");

// ── the recommended WSL flags ───────────────────────────────────────────────
// The one list the card's **Flags WSL** control appends, host-side so the card
// carries no copy. The entry must actually take effect once it reaches argv:
// the debug port travels as `--chromeArg` because the bridge's strict parser
// reports a bare `--remote-debugging-port` as Unknown arguments and drops it
// (a bare flag would read as a valid extra flag yet do nothing). No
// `--user-data-dir` entry is recommended alongside it: a Windows `chrome.exe`
// profile directory cannot live in the project (neither the WSL checkout nor
// the `\\wsl.localhost` mount carries its locks), so the Windows run owns a
// Windows-native profile under `%LOCALAPPDATA%` instead.
assert.deepEqual(
	WSL_EXTRA_FLAGS,
	["--chromeArg=--remote-debugging-port=9222"],
	"the recommended WSL flag is the debug-port chromeArg"
);
assert.equal(validateExtraFlags(WSL_EXTRA_FLAGS), true, "the recommended flags pass their own validation");

// ── extractExecutablePathFlag / stripExecutablePathFlags ────────────────────
// A legacy row config that pinned the executable via a flag: the path is read
// out of the flag list (its source there becomes "row-config"), then the flag
// is removed from the argv the bridge launches with.
assert.equal(extractExecutablePathFlag(["--no-usage-statistics", "--executablePath=/opt/chrome"]), "/opt/chrome");
assert.equal(extractExecutablePathFlag(["--executable-path=/opt/chrome beta", "--headless"]), "/opt/chrome beta", "space in value");
assert.equal(extractExecutablePathFlag(["--executable-path", "/opt/chrome"]), "/opt/chrome", "separate argv entry");
assert.equal(extractExecutablePathFlag(["-e", "/opt/chrome"]), "/opt/chrome", "short spelling");
assert.equal(extractExecutablePathFlag(["--executablePath="]), "", "empty value is no path");
assert.equal(extractExecutablePathFlag(["--headless", "--isolated"]), "", "no executable-path flag");
assert.deepEqual(
	stripExecutablePathFlags(["--no-usage-statistics", "--executablePath=/opt/chrome", "--headless"]),
	["--no-usage-statistics", "--headless"],
	"the pin is removed from the argv tail"
);
assert.deepEqual(stripExecutablePathFlags(["--headless"]), ["--headless"], "nothing to strip leaves the list alone");

// ── buildServerArgs ────────────────────────────────────────────────────────
// Bridge argv tail: `-y <package> [extraFlags]` (+ --executablePath=<path>
// when config.chromePath is set and no executable-path flag is present).
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "" }, ["--no-usage-statistics", "--no-performance-crux"]),
	["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics", "--no-performance-crux"],
	"npx -y <package> plus flags"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "" }, ["--headless", "--isolated"]),
	["-y", "chrome-devtools-mcp@latest", "--headless", "--isolated"],
	"flags keep their order"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "" }, undefined),
	["-y", "chrome-devtools-mcp@latest"],
	"missing flags degrade to the bare launch"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@1.2.3", chromePath: "" }, []),
	["-y", "chrome-devtools-mcp@1.2.3"],
	"pinned package honored"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "/usr/bin/google-chrome" }, []),
	["-y", "chrome-devtools-mcp@latest", "--executablePath=/usr/bin/google-chrome"],
	"chromePath appends the upstream executable-path flag"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "/usr/bin/google-chrome" }, ["--channel=beta"]),
	["-y", "chrome-devtools-mcp@latest", "--channel=beta", "--executablePath=/usr/bin/google-chrome"],
	"chromePath appended after user flags"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "/usr/bin/google-chrome" }, ["--executablePath=/opt/chrome"]),
	["-y", "chrome-devtools-mcp@latest", "--executablePath=/opt/chrome"],
	"never a double pin (defensive: validate rejects such flags before they reach the bridge)"
);
assert.deepEqual(
	buildServerArgs({ package: "chrome-devtools-mcp@latest", chromePath: "   " }, []),
	["-y", "chrome-devtools-mcp@latest"],
	"whitespace-only chromePath is no executable path"
);

// ── sameFlags ──────────────────────────────────────────────────────────────
assert.equal(sameFlags(["a"], ["a"]), true);
assert.equal(sameFlags(["a", "b"], ["a", "b"]), true);
assert.equal(sameFlags(["a"], ["a", "b"]), false, "length difference");
assert.equal(sameFlags(["a", "b"], ["b", "a"]), false, "order matters");
assert.equal(sameFlags(["a"], "a"), false, "non-array never equal");

// ── resolveEnvFlags ────────────────────────────────────────────────────────
assert.deepEqual(resolveEnvFlags(["--a"], ""), ["--a"], "empty env falls back to row config");
assert.deepEqual(resolveEnvFlags(["--a"], "   "), ["--a"], "whitespace-only env falls back");
assert.deepEqual(resolveEnvFlags(["--a"], "--headless  --isolated"), ["--headless", "--isolated"], "whitespace split");
assert.deepEqual(resolveEnvFlags(["--a"], "headless"), ["headless"], "entries need not start with dashes — validation only rejects control chars");
assert.deepEqual(resolveEnvFlags(["--a"], "--headless\u0001x"), ["--a"], "invalid env list falls back to row config");

// ── readPersistedFlags ─────────────────────────────────────────────────────
// Returns the stored user-layer extraFlags only when the settings service is
// up and every entry is a non-empty string; otherwise undefined.
const ctxWith = (settings) => ({ get: (name) => (name === "settings" ? settings : void 0) });
assert.deepEqual(
	readPersistedFlags(ctxWith({ document: { "chrome-mcp": { extraFlags: ["--headless"] } } })),
	["--headless"],
	"valid stored flags are returned"
);
assert.deepEqual(
	readPersistedFlags(ctxWith({ document: { "chrome-mcp": { extraFlags: [] } } })),
	[],
	"an explicit empty list is honored"
);
assert.equal(
	readPersistedFlags(ctxWith({ document: { "chrome-mcp": { extraFlags: ["ok", 42] } } })),
	void 0,
	"non-string entry invalidates the whole list"
);
assert.equal(
	readPersistedFlags(ctxWith({ document: { "chrome-mcp": { extraFlags: "x" } } })),
	void 0,
	"non-array value is ignored"
);
assert.equal(readPersistedFlags(ctxWith({ document: {} })), void 0, "absent namespace is ignored");
assert.equal(
	readPersistedFlags(ctxWith({ document: { "chrome-mcp": "junk" } })),
	void 0,
	"non-object section is ignored"
);
assert.equal(readPersistedFlags(ctxWith(void 0)), void 0, "absent settings service is ignored");
assert.equal(
	readPersistedFlags({ get: () => { throw new Error("boom"); } }),
	void 0,
	"settings lookup failure is swallowed"
);
// returned list is a copy, not an alias of the document section
const mutable = { document: { "chrome-mcp": { extraFlags: ["--headless"] } } };
const got = readPersistedFlags(ctxWith(mutable));
got.push("--isolated");
assert.equal(mutable.document["chrome-mcp"].extraFlags.length, 1, "result is a defensive copy");

// ── checkChrome ────────────────────────────────────────────────────────────
// Empty chromePath probes the candidate list: a missing executable is the known
// "Chrome executable not found" error the card reports — surfaced without any
// tool call (upstream launches the browser lazily).
await assert.rejects(
	checkChrome({ chromePath: "", chromePaths: ["/nonexistent-dir/chrome-should-not-exist"] }),
	/Chrome executable not found: no executable detected \(checked: \S+\)/u,
	"discovery finds nothing → known executable-missing error"
);
// An empty candidate list probes nothing (keeps host runs deterministic when
// patched to a pinning/connect flag list too).
assert.equal(await checkChrome({ chromePath: "", chromePaths: [] }), "", "no candidates → nothing probed");
// Only a connect-mode flag leaves the executable question to the bridge. A
// pin flag is no longer an exemption — it is rejected by validateExtraFlags and
// folded into the selection instead.
assert.equal(
	await checkChrome({ chromePath: "", chromePaths: ["/nonexistent-dir/x"] }, ["--browserUrl=http://127.0.0.1:9222"]),
	"",
	"connect mode → no executable check"
);
await assert.rejects(
	checkChrome({ chromePath: "", chromePaths: ["/nonexistent-dir/x"] }, ["--executablePath=/opt/custom/chrome"]),
	/Chrome executable not found: no executable detected/u,
	"a pin flag no longer suppresses the probe"
);
// A missing executable reports the human-readable not-found error.
await assert.rejects(
	checkChrome({ chromePath: "/nonexistent-dir/chrome-should-not-exist" }),
	/Chrome executable not found: \S+/u,
	"ENOENT reports the path"
);
// A runnable executable resolves its --version first line.
const version = await checkChrome({ chromePath: process.execPath });
assert.match(version, /^v\d+\./u, "a working executable returns the version line");

// ── discoverChrome ─────────────────────────────────────────────────────────
// Candidate order: ENOENT candidates are skipped, the first runnable one wins.
const discovered = await discoverChrome(["/nonexistent-dir/absent-one", "/nonexistent-dir/absent-two", process.execPath]);
assert.match(discovered, /^v\d+\./u, "discovery resolves the first runnable candidate's version line");
// All absent → the known error listing the checked paths.
let discoveryError;
await discoverChrome(["/nonexistent-dir/absent-one", "/nonexistent-dir/absent-two"]).catch((error) => (discoveryError = error));
assert.match(discoveryError.message, /^Chrome executable not found: no executable detected \(checked: [^)]+\)$/u, "all absent → known error");
assert.equal(discoveryError.code, undefined, "the not-detected error carries no ENOENT code (it lists paths)");
assert.equal(isChromeMissing(discoveryError.message), true, "discovery miss is itself the known error");
// Empty list → nothing probed.
assert.equal(await discoverChrome([]), "", "empty candidate list resolves nothing");

// ── chromeExecutableCandidates: the picker's candidate list ─────────────────
// Row-config paths first (the list `discoverChrome` would have used), then the
// ids the saved rows carry, then whatever the current selection points at —
// deduped, in the order the card lists them.
assert.deepEqual(
	chromeExecutableCandidates({ chromePaths: ["/usr/bin/chrome", "/opt/chrome"] }, ["/home/u/chrome", "/opt/chrome"], "/usr/bin/chrome"),
	["/usr/bin/chrome", "/opt/chrome", "/home/u/chrome"],
	"row paths first, then saved rows, then the selection"
);
assert.deepEqual(chromeExecutableCandidates({}, [], ""), [], "nothing configured → no candidates");
assert.deepEqual(
	chromeExecutableCandidates({ chromePaths: ["  "] }, ["  ", "/x"], ""),
	["/x"],
	"whitespace entries are dropped"
);

// ── scanChromeExecutables: every candidate probed, none short-circuited ─────
const fs = await import("node:fs");
const run = process.execPath;
const scan = await scanChromeExecutables([run, "/nonexistent-dir/absent", run]);
assert.equal(scan.length, 1, "the runnable path appears once, absent candidates never listed");
assert.equal(scan[0].path, run, "the status carries the path it stands for");
assert.equal(scan[0].error, "", "a runnable entry carries no error");
assert.match(scan[0].version, /^v\d+\./u, "a runnable entry carries its version line");
// Present but not runnable stays visible with the failure. A binary that exits
// non-zero on `--version` is the shape upstream itself reports.
const broken = ["/usr/bin/false", "/bin/false"].find((p) => fs.existsSync(p));
if (broken !== void 0) {
	const unavailable = await scanChromeExecutables([broken]);
	assert.equal(unavailable.length, 1, "a present, non-runnable file stays visible");
	assert.equal(unavailable[0].version, "", "an unavailable entry carries no version");
	assert.ok(unavailable[0].error !== "", "an unavailable entry carries the failure line");
}
// A directory or a plain non-executable file never reaches the list.
assert.equal((await scanChromeExecutables([process.cwd(), "/etc/hostname"])).length, 0, "non-executables are dropped without a spawn");

// ── mergeEntries: the "Search executables" merge ────────────────────────────
// Stored rows keep their order and their custom names; ids the run found that
// are not represented land last, nameless. This is what a refresh does to the
// list the user saved: nothing it discovered rewrites a name, nothing it
// discovered lands twice.
assert.deepEqual(
	mergeEntries(
		[
			{ id: "/usr/bin/chrome", name: "system" },
			{ id: "/home/u/chrome", name: "" }
		],
		["/home/u/chrome", "/opt/chrome"]
	).entries,
	[
		{ id: "/usr/bin/chrome", name: "system" },
		{ id: "/home/u/chrome", name: "" },
		{ id: "/opt/chrome", name: "" }
	],
	"stored rows first and unchanged, new ids appended nameless"
);
assert.equal(mergeEntries([], ["/a", "/a", "  "]).entries.length, 1, "a merged id that cannot go on the wire drops");
assert.equal(mergeEntries([{ id: "/a", name: "" }], ["/a"]).changed, false, "nothing new to merge is not a change");
assert.equal(mergeEntries([{ id: "/a", name: "x" }], ["/b"]).changed, true, "one new row is a change");
assert.deepEqual(normalizeEntries([{ id: " /a ", name: "  lab  " }, { id: "/a", name: "dupe" }, null, 7]), [{ id: "/a", name: "lab" }], "rows normalized: trimmed, first per id, junk dropped");
assert.equal(normalizeEntries("junk").length, 0, "a non-array is no rows");
assert.equal(entryLabel({ id: "/a", name: "lab" }), "lab", "the label is the saved name");
assert.equal(entryLabel({ id: "/a", name: "  " }), "/a", "no name means the path itself");
assert.deepEqual(entryIds([{ id: "/a", name: "" }, { id: "/b", name: "b" }]), ["/a", "/b"], "row order is the list order");
assert.equal(isValidEntryId(""), false, "an empty id cannot go on the wire");
assert.equal(isValidEntryId("/usr/bin/chrome"), true, "an ordinary path is valid");
assert.equal(isValidEntryId("/a\u0000b"), false, "a control character fails a row id");
assert.equal(isValidEntryId("/a".repeat(600)), false, "an absurd path fails the 1024 cap");


// ── blocked candidates: what no host may exec ──────────────────────────────
// The one blocked path is a Windows `chrome.exe` on a WSL host. Its `--version`
// probe answers — that is what makes the selection look runnable — but
// answering means attaching to the Windows browser session, and that **starts a
// browser instance** no tool call could ever drive. The hook is how the host
// says "never exec this" without the suite depending on a Windows install being
// present: a blocked candidate keeps its place in the list and never spawns.
const BLOCKED = "blocked by platform";
// A Windows-side spelling that resolves to nothing on a Linux host, so a probe
// that *did* try to exec it would surface as an executable-missing error rather
// than silently answering. The blocked hook is what keeps it unexecuted here.
const WINDOWS_BIN = "C:\\dsh-chrome-mcp-test\\chrome.exe";
const blockedHook = (candidate) => (candidate === WINDOWS_BIN ? BLOCKED : "");
const blockedScan = await scanChromeExecutables([WINDOWS_BIN, run], blockedHook);
assert.equal(blockedScan.length, 2, "a blocked candidate stays visible instead of vanishing into a red dot");
assert.equal(blockedScan[0].version, "", "a blocked candidate answers no version because it was never exec'd");
assert.equal(blockedScan[0].error, BLOCKED, "the entry carries the reason it was blocked");
assert.equal(blockedScan[1].error, "", "a probeable candidate in the same list still probes");
assert.match(blockedScan[1].version, /^v\d+\./u, "and answers with its version");

// A blocked **selection** probes nothing: no version, no error line — the
// card's WSL notice is what explains the state, not a probe result.
assert.equal(
	await checkChrome({ chromePath: WINDOWS_BIN }, void 0, blockedHook),
	"",
	"a blocked selection resolves '' (no evidence), never a version"
);
assert.equal(
	await checkChrome({ chromePath: run }, void 0, () => BLOCKED),
	"",
	"the hook wins even over a path that would have answered"
);
let blockedDiscovery;
await discoverChrome([WINDOWS_BIN], blockedHook).catch((error) => (blockedDiscovery = error));
assert.match(blockedDiscovery.message, /blocked by platform/u, "a blocked-only candidate list reports the reason, not a missing executable");

// ── isWindowsExecutablePath / isWindowsSubsystemForLinux ────────────────────
// The two halves of the WSL interop notice, kept pure so the assertions never
// depend on the machine running the suite. A Windows binary is one that only
// Windows can execve: mounted drive, Windows spelling, or the PE suffix.
assert.equal(
	isWindowsExecutablePath("/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"),
	true,
	"a /mnt/<drive> path is Windows-side"
);
assert.equal(isWindowsExecutablePath("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), true, "a drive-letter path");
assert.equal(isWindowsExecutablePath("\\\\BOX\\share\\chrome.exe"), true, "a UNC path");
assert.equal(isWindowsExecutablePath("/home/user/chrome.exe"), true, "the PE suffix marks it even under a Linux path");
assert.equal(isWindowsExecutablePath("/usr/bin/google-chrome"), false, "a Linux executable is never Windows-side");
assert.equal(isWindowsExecutablePath("/opt/google/chrome/chrome"), false, "the default discovery list never matches");
assert.equal(isWindowsExecutablePath(""), false, "no selection is no warning");
assert.equal(isWindowsExecutablePath(undefined), false, "absent value is no warning");

// WSL: a Linux kernel plus WSL's own markers. The environment the host resolves
// is the answer (an empty one is a real answer, so the suite stays
// machine-independent), and a non-Linux platform never qualifies.
const wslEnv = (name) => (name === "WSL_DISTRO_NAME" ? "Ubuntu-24.04" : void 0);
assert.equal(isWindowsSubsystemForLinux({ platform: "linux", env: wslEnv }), true, "a WSL distro names itself in the environment");
assert.equal(
	isWindowsSubsystemForLinux({ platform: "linux", env: (name) => (name === "WSL_INTEROP" ? "/run/WSL/42" : void 0) }),
	true,
	"the interop variable counts on its own"
);
assert.equal(isWindowsSubsystemForLinux({ platform: "linux", env: () => void 0 }), false, "an empty environment says plain Linux");
assert.equal(isWindowsSubsystemForLinux({ platform: "win32", env: wslEnv }), false, "a Windows host is not running under WSL");
assert.equal(isWindowsSubsystemForLinux({ platform: "darwin", env: () => void 0 }), false, "macOS is not WSL");
// With nothing to resolve against (a bare call), the interop marker decides.
assert.equal(isWindowsSubsystemForLinux({ platform: "linux", exists: () => true }), true, "the binfmt marker marks a WSL kernel");
assert.equal(isWindowsSubsystemForLinux({ platform: "linux", exists: () => false }), false, "no marker, no WSL");

// The notice needs both halves at once: the platform and the selection.
const WSL = { platform: "linux", env: wslEnv };
assert.equal(isWindowsExecutableUnderWsl("/mnt/c/Google/Chrome/chrome.exe", WSL), true, "Windows executable under WSL");
assert.equal(isWindowsExecutableUnderWsl("/usr/bin/google-chrome", WSL), false, "a Linux executable under WSL says nothing");
assert.equal(
	isWindowsExecutableUnderWsl("/mnt/c/Google/Chrome/chrome.exe", { platform: "win32", env: wslEnv }),
	false,
	"a Windows executable on a Windows host is normal, nothing to report"
);

// ── the executable-path precedence + persisted reads ────────────────────────
// Selection wins over row config; row config over nothing; there is no
// auto state — an empty selection resolves to the empty string.
assert.equal(resolveEffectiveChromePath("/home/u/chrome", "/usr/bin/chrome"), "/home/u/chrome", "selection wins");
assert.equal(resolveEffectiveChromePath("", "/usr/bin/chrome"), "/usr/bin/chrome", "row config is the fallback");
assert.equal(resolveEffectiveChromePath("", ""), "", "nothing selected resolves nothing");
assert.equal(resolveEffectiveChromePath("   ", "/usr/bin/chrome"), "/usr/bin/chrome", "a blank selection is no selection");
const pathCtx = (section) => ({ get: (name) => (name === "settings" ? { document: { "chrome-mcp": section } } : void 0) });
assert.equal(readPersistedChromePath(pathCtx({ chromePath: "/home/u/chrome" })), "/home/u/chrome", "persisted selection read");
assert.equal(readPersistedChromePath(pathCtx({})), "", "absent section field is no selection");
assert.equal(readPersistedChromePath(pathCtx({ chromePath: 42 })), "", "non-string is ignored");
assert.equal(readPersistedChromePath(void 0), "", "absent settings service is ignored");
// ── the saved-executable rows (+ the legacy MRU read) ───────────────────────
// Nothing writes `chromeCustomPaths` any more — the rows replace it — so the
// read stays normalization-only: blanks/control characters dropped, duplicates
// folded, the newest spellings kept up to the cap. A host that still carries the
// older field folds it into its rows the first time it runs; see apply.test.mjs.
assert.deepEqual(readPersistedCustomPaths(pathCtx({ chromeCustomPaths: ["/a/chrome", "  ", "/b/chrome"] })), ["/a/chrome", "/b/chrome"], "legacy MRU read, blanks dropped");
assert.deepEqual(normalizeCustomPaths(["/a/chrome", "/a/chrome", "  "], 10), ["/a/chrome"], "legacy MRU normalized: trimmed, deduped");
assert.equal(normalizeCustomPaths("x", 10).length, 0, "non-array legacy MRU is empty");
assert.deepEqual(normalizeCustomPaths(["/a", "/b", "/c", "/d", "/e", "/f", "/g"], 5), ["/a", "/b", "/c", "/d", "/e"], "the newest entries keep the cap");




// ── isChromeMissing: known-error classification ────────────────────────────
// "No Chrome executable detected" is the known, header-labeled state; every
// other failure stays a generic check/connection error.
assert.equal(isChromeMissing("Chrome executable not found: /nope/chrome"), true);
assert.equal(isChromeMissing("Could not find Chrome (ver. 139.0.7258.0)"), true);
// Upstream's actual no-executable message (default channel `stable`): the
// "Google" word between "find" and "Chrome executable" still flags the state.
assert.equal(
	isChromeMissing("Could not find Google Chrome executable for channel 'stable' at: - /opt/google/chrome/chrome."),
	true,
	"upstream discovery-failure text flags the known error"
);
assert.equal(isChromeMissing("Browser was not found at the configured executablePath (/nope/chrome)"), true);
assert.equal(isChromeMissing("Failed to launch the browser process"), true);
assert.equal(isChromeMissing("Failed to Launch The Browser Process: no such file"), true);
assert.equal(isChromeMissing("Protocol error (Target.setDiscoverTargets): Target closed"), false);
assert.equal(isChromeMissing("Connection failed; retrying in 500ms"), false);
assert.equal(isChromeMissing(""), false);
assert.equal(isChromeMissing(undefined), false);
// The ENOENT probe failure checkChrome reports is itself the known not-found error.
let probeMissingError;
await checkChrome({ chromePath: "/nonexistent-dir/chrome-should-not-exist" }).catch((error) => (probeMissingError = error));
assert.equal(isChromeMissing(probeMissingError.message), true, "probe ENOENT classifies as executable missing");

// ── toolResultNote ─────────────────────────────────────────────────────────
// Successful chrome-tool calls report no note; the listener clears on those.
assert.equal(toolResultNote("mcp__chrome__new_page", { content: [{ type: "text", text: "ok" }] }), null, "success has no note");
assert.equal(toolResultNote("mcp__chrome__list_pages", {}), null, "absent isError is not a failure");
assert.equal(
	toolResultNote("mcp__chrome__new_page", {
		isError: true,
		content: [{ type: "text", text: "Protocol error (Target.setDiscoverTargets): Target closed\nCause: " }]
	}),
	"new_page failed: Protocol error (Target.setDiscoverTargets): Target closed",
	"failed call summarizes the first text line"
);
assert.equal(
	toolResultNote("mcp__chrome__take_screenshot", { isError: true, error: { message: "boom line1\nline2" } }),
	"take_screenshot failed: boom line1",
	"error.message fallback, first line only"
);
assert.equal(toolResultNote("mcp__chrome__x", { isError: true, content: [] }), "x failed: unknown error", "no detail reports unknown error");

console.log("parse.test.mjs: all assertions passed");
