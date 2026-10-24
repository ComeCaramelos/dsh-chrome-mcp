// Host-half tests for the **Prelaunch Windows Chrome** run (./host/windows.ts + the
// controller's Windows wiring): pure helpers, the orchestrated run against fake
// reachability/launch seams (the exact `start` argv, the port pool, every error
// path), and the controller's nonce trigger. Run: node test/windows.test.mjs.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import {
	browserUrlFlagPort,
	findWindowsChromeExecutable,
	findWindowsChromeExecutables,
	linkWindowsChromeProfile,
	runWindowsChromeConnect,
	windowsChromeLandingHtml,
	windowsChromeLandingPath,
	windowsChromeLandingUrl,
	windowsChromeProfileDir,
	windowsChromeUrl,
	windowsChromeProjectDir,
	windowsFileUrl,
	windowsPathToMount,
	withBrowserUrlFlag
} from "../lib/index.js";
import { liveMirrorKeys } from "../lib/host/values.js";

/** What every Host write-back clears out of the row: the live mirror fields,
 * read off the Host module itself. */
const LIVE_MIRROR_FIELDS = liveMirrorKeys();

/**
 * The HMR write transaction a config edit opens, pinned the way the live Host
 * carries it: while a write runs, the transaction's async-local store stays
 * attached to everything scheduled from it, and a follow-up config write that
 * still carries the store is refused outright ("HMR transactions cannot be
 * nested") — the refusal a run scheduled from a form commit used to answer for
 * every write-back it tried to persist.
 */
const writeTransaction = new AsyncLocalStorage();

const WSL_ENV = { WSL_DISTRO_NAME: "Ubuntu-22.04" };
const CHROME_WIN = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CHROME_MOUNT = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

// ── pure helpers ───────────────────────────────────────────────────────────
assert.equal(
	windowsPathToMount(CHROME_WIN),
	"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
	"a drive-letter path maps to its interop mount path"
);
assert.equal(windowsPathToMount("C:\\WINDOWS"), "/mnt/c/WINDOWS", "the drive mapping keeps the rest of the path verbatim");
assert.equal(windowsPathToMount("/home/u/chrome"), "", "a Linux path is not a Windows mount path");
assert.equal(windowsPathToMount(""), "", "nothing is not a mount path");
// A path may be stored shell-style, with the space escaped. The escape folds
// back into the space it stands for — folding it into a slash instead produced
// `Program/ Files` and answered `not-found` for a Chrome that was located
// (measured live 2026-10-12: a saved mount-spelled selection killed the
// **Prelaunch Windows Chrome** run).
assert.equal(
	windowsPathToMount("/mnt/c/Program\\ Files/Google/Chrome/Application/chrome.exe"),
	"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
	"an escaped space in a mount path folds back to the space it stands for"
);
assert.equal(
	windowsPathToMount("C:\\Program\\ Files\\Google\\Chrome\\Application\\chrome.exe"),
	"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
	"and a drive path spelled the same way maps to the same mount path"
);
assert.equal(
	windowsPathToMount("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"),
	"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"a separator before a parenthesized folder still maps"
);
assert.equal(windowsChromeUrl(9223), "http://127.0.0.1:9223", "the connect address carries the port it opened");

// Locate: first existing candidate wins, the Windows spelling is what returns.
assert.equal(
	findWindowsChromeExecutable((path) => path === CHROME_MOUNT),
	CHROME_WIN,
	"the found executable answers with its Windows spelling"
);
assert.equal(
	findWindowsChromeExecutable(
		(path) => path === "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
		[CHROME_WIN, "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
	),
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"Edge is the alternative answer"
);
assert.equal(findWindowsChromeExecutable(() => false), "", "no candidate exists → no executable");

// Every executable this host carries, not only the first — this is what the
// executable run folds into its candidate list, so the picker offers the Windows
// browser the run can be pointed at instead of hiding it. Answered in the list's
// own preference order, in the **Windows** spelling, deduplicated.
const EDGE_WIN = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EDGE_MOUNT = "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
assert.deepEqual(
	findWindowsChromeExecutables((path) => path === CHROME_MOUNT || path === EDGE_MOUNT),
	[CHROME_WIN, EDGE_WIN],
	"the whole located set, in the list's own preference order and its Windows spelling"
);
assert.deepEqual(
	findWindowsChromeExecutables((path) => path === EDGE_MOUNT, [EDGE_WIN, EDGE_WIN]),
	[EDGE_WIN],
	"a location carried twice answers once"
);
assert.deepEqual(findWindowsChromeExecutables(() => false), [], "a machine carrying nothing locates nothing");

// Windows-side profile directory: `…\dsh-chrome-mcp\.chrome[-<port>]` under
// the resolved LOCALAPPDATA (a profile rooted in the WSL checkout cannot
// carry Chrome's SQLite/singleton locks — every table lands zero bytes and
// the profile error dialog rides every launch, measured live 2026-10-04).
assert.equal(
	windowsChromeProfileDir("C:\\Users\\u\\AppData\\Local"),
	"C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome",
	"the preferred-port profile sits under LOCALAPPDATA"
);
assert.equal(
	windowsChromeProfileDir("C:\\Users\\u\\AppData\\Local\\", ".chrome-9223"),
	"C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome-9223",
	"the per-port leaf never shares another instance's directory"
);
assert.equal(
	windowsChromeProfileDir("", ".chrome"),
	"",
	"no LOCALAPPDATA answer means no profile directory (never a default-profile fallback)"
);

// The landing page the launched window opens — one packaged page, rendered with
// the run's own answers. The launch carries it as a positional URL because a
// window that opens on a blank new-tab page reads as a malfunction, and the
// usual placeholder is out: example.com carries an explicit notice against
// being used for automation and tests.
const PROFILE_WIN = "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome";
assert.equal(
	windowsChromeLandingPath(PROFILE_WIN, 9222),
	"C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\prelaunch-9222.html",
	"the page is a sibling of the profile directory, never a file inside it"
);
assert.equal(
	windowsChromeLandingPath("C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome-9223", 9223),
	"C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\prelaunch-9223.html",
	"one landing file per port, exactly like one profile per port"
);
assert.equal(windowsChromeLandingPath("", 9222), "", "no profile directory is no page to write");
assert.equal(windowsChromeLandingPath(PROFILE_WIN, 0), "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\prelaunch-0.html", "an unset port still answers a real path (the page explains nothing, but the launch is never malformed)");

// A Windows path as a file URL, which is the only form chrome.exe reads (the
// interop mount path is Linux-side): percent-encoding keeps a profile directory
// carrying spaces intact, and nothing maps to no URL rather than a half one.
assert.equal(
	windowsFileUrl(PROFILE_WIN.replace(".chrome", "prelaunch-9222.html")),
	"file:///C:/Users/u/AppData/Local/dsh-chrome-mcp/prelaunch-9222.html",
	"a Windows spelling becomes its file URL"
);
assert.equal(
	windowsFileUrl("C:\\Users\\John Doe\\AppData\\Local\\dsh-chrome-mcp\\prelaunch-9222.html"),
	"file:///C:/Users/John%20Doe/AppData/Local/dsh-chrome-mcp/prelaunch-9222.html",
	"a profile directory carrying a space survives as one URL"
);
assert.equal(windowsFileUrl("/home/u/dev/dsh-chrome-mcp/lib/x.html"), "", "a Linux path is not a Windows file URL");
assert.equal(windowsFileUrl("C:\\"), "", "no path under the drive answers no URL");

// The packaged page: every token answered, nothing left unrendered, nothing
// fetched from the network (the window is opened precisely so an agent can
// drive it, so the page must not be the thing that calls out on its own).
{
	const html = windowsChromeLandingHtml({ url: "http://127.0.0.1:9223", port: 9223, profile: PROFILE_WIN });
	assert.notEqual(html, "", "the packaged page renders");
	assert.equal(html.includes("http://127.0.0.1:9223"), true, "the page names the debugging port the window answers for");
	assert.equal(html.includes(PROFILE_WIN), true, "the page names the profile directory the window profiles");
	assert.equal(html.includes("{{"), false, "no token is left unrendered");
	assert.equal(/src\s*=\s*["']https?:/u.test(html), false, "the page fetches nothing from the network");
	assert.equal(html.includes("example.com"), false, "example.com is never the explanation — it carries an explicit notice against being used for automation and tests");
	assert.equal(/lang\s*=\s*"es"/u.test(html), false, "the page reads in one language: it carries no Spanish copy (English is the plugin's language)");
	assert.equal(html.includes("This Chrome window was opened by the"), true, "the page says up front what the window is, in English");
}
{
	// A profile root that is not a Windows path is no page to write: the launch
	// goes ahead exactly as it did before, and "" is the whole answer.
	assert.equal(windowsChromeLandingUrl("/home/u/.config/google-chrome/Default", "http://127.0.0.1:9222", 9222), "", "no Windows-side file is written and no URL is answered for a Linux-rooted profile");
}
{
	// The write half, injected: what is placed is the rendered page at the
	// mount path, and the answer is the Windows file URL Chrome can read.
	let written = null;
	const url = windowsChromeLandingUrl(PROFILE_WIN, "http://127.0.0.1:9222", 9222, (mountPath, html) => {
		written = [mountPath, html.includes("http://127.0.0.1:9222"), html.includes(PROFILE_WIN)];
		return true;
	});
	assert.equal(
		url,
		"file:///C:/Users/u/AppData/Local/dsh-chrome-mcp/prelaunch-9222.html",
		"a written page answers the Windows file URL it sits at"
	);
	assert.equal(
		written[0],
		"/mnt/c/Users/u/AppData/Local/dsh-chrome-mcp/prelaunch-9222.html",
		"the page is placed through the interop mount (the Windows spelling is not something WSL can write)"
	);
	assert.equal(written[1], true, "the page carries the connect address before it is written");
	assert.equal(written[2], true, "the page carries the profile directory before it is written");
}
{
	// A failing write is not a failure of the run: no URL, and the launch goes
	// ahead without a page.
	assert.equal(windowsChromeLandingUrl(PROFILE_WIN, "http://127.0.0.1:9222", 9222, () => false), "", "nothing is written → no URL");
}

// The profile's project root: row-config `cwd` wins, else the live session's
// workspace (the run answers the GUI the user is driving — rooting in `~`
// silently profiles ~/.chrome instead of the workspace, measured live
// 2026-10-04), else the host's own cwd.
const sessionsOf = (entries) => ({ list: () => entries });
assert.equal(
	windowsChromeProjectDir("/home/u/dev/proj", sessionsOf([{ header: { cwd: "/home/u/other", createdAt: 9 } }]), "/host/cwd"),
	"/home/u/dev/proj",
	"the explicit row config beats every session workspace"
);
assert.equal(
	windowsChromeProjectDir("", sessionsOf([]), "/host/cwd"),
	"/host/cwd",
	"no live workspace falls back to the host cwd"
);
assert.equal(
	windowsChromeProjectDir("", undefined, "/host/cwd"),
	"/host/cwd",
	"a host without the sessions service falls back to the host cwd"
);
assert.equal(
	windowsChromeProjectDir("", sessionsOf([{ header: { cwd: "/home/u/new", createdAt: 5 } }, { header: { cwd: "/home/u/old", createdAt: 2 } }]), "/host/cwd"),
	"/home/u/new",
	"the most recently created live session workspace wins (deterministic across sessions)"
);
assert.equal(
	windowsChromeProjectDir("", sessionsOf([{ header: { createdAt: 5 } }]), "/host/cwd"),
	"/host/cwd",
	"a session without a workspace cwd is not a source"
);

// The workspace-view link (linkWindowsChromeProfile): a pure filesystem move,
// driven against a temp directory. The Windows-side spelling maps to its
// mount for the link's Linux-side target.
// WSL-side only: the view is a Linux symlink a WSL host refreshes, and a
// native Windows host never runs the chrome-windows kind that makes it (nor may
// an unprivileged Windows process create a symlink).
if (process.platform !== "win32") {
	const os = await import("node:os");
	const fs = await import("node:fs");
	const path = await import("node:path");
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-chrome-link-"));
	const linkPath = path.join(base, ".chrome");
	const profileWin = "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome";
	const target = "/mnt/c/Users/u/AppData/Local/dsh-chrome-mcp/.chrome";

	assert.equal(linkWindowsChromeProfile(linkPath, profileWin), "linked", "no view yet → the link is created");
	assert.equal(fs.readlinkSync(linkPath), target, "the link reads as the Windows profile's mount path");
	assert.equal(linkWindowsChromeProfile(linkPath, profileWin), "updated", "the already-correct link stays refreshed");

	fs.mkdirSync(path.join(base, "held"));
	assert.equal(linkWindowsChromeProfile(path.join(base, "held"), profileWin), "kept", "a real directory at the view's spot is never clobbered");
	assert.equal(linkWindowsChromeProfile("", profileWin), "failed", "no link path is nothing to refresh");
	assert.equal(linkWindowsChromeProfile(linkPath, "/home/u/not-windows"), "failed", "no Windows spelling maps to no target");
	fs.rmSync(base, { recursive: true, force: true });
}

// The connect flag: replace by key, keep everything else (the §6.5 idempotency
// rule — one connect entry, never two), except the local-profile row connect
// makes mutually exclusive with it upstream: userDataDir and browserUrl in the
// same argv kill the spawn ("Arguments userDataDir and browserUrl are mutually
// exclusive" — measured live 2026-10-04 against chrome-devtools-mcp).
assert.deepEqual(
	withBrowserUrlFlag(["--no-usage-statistics", "--user-data-dir=.chrome"], "http://127.0.0.1:9222"),
	["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9222"],
	"a list without a connect entry gains one at the tail, and the now-dead --user-data-dir row goes with it"
);
assert.deepEqual(
	withBrowserUrlFlag(["--browserUrl=http://127.0.0.1:9222", "--headless"], "http://127.0.0.1:9223"),
	["--browserUrl=http://127.0.0.1:9223", "--headless"],
	"the existing connect entry is rewritten in place, never duplicated"
);
assert.deepEqual(
	withBrowserUrlFlag(["--browserUrl=http://127.0.0.1:9222", "--browserUrl=http://127.0.0.1:9224"], "http://127.0.0.1:9223"),
	["--browserUrl=http://127.0.0.1:9223"],
	"even two stale entries fold into the one connect source"
);
// The live port is read through `carriesConnectionMode`, so **every** connect
// spelling the plugin itself accepts answers the live session's port. A
// spelling the live-port read could not see is what let a second browser slip
// in beside a live one (audit run-1 C-2) — read them all here so the run has no
// blind spot left to fall into.
assert.equal(browserUrlFlagPort(["--browserUrl=http://127.0.0.1:9223", "--headless"]), 9223, "the live port reads back out of the = spelling");
assert.equal(browserUrlFlagPort(["--browserUrl", "http://127.0.0.1:9223", "--headless"]), 9223, "the whitespace-separated two-entry spelling answers it too");
assert.equal(browserUrlFlagPort(["--browserUrl http://127.0.0.1:9223"]), 9223, "and so does one row carrying its value after whitespace");
assert.equal(browserUrlFlagPort(["--wsEndpoint=ws://127.0.0.1:9222/devtools"]), 9222, "a live wsEndpoint is a connect source like any other");
assert.equal(browserUrlFlagPort(["--chromeArg=--remote-debugging-port=9222"]), 0, "Flags WSL is not a connect source");
assert.equal(browserUrlFlagPort([]), 0, "no entry answers port 0");

// Every accepted spelling collapses into the single connect source the run
// writes, its value consumed with the flag so no bare URL survives as a stray
// argv entry.
assert.deepEqual(
	withBrowserUrlFlag(["--no-usage-statistics", "--browserUrl", "http://127.0.0.1:9222"], "http://127.0.0.1:9222"),
	["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9222"],
	"the two-entry spelling folds into one entry, its value consumed with it"
);
assert.deepEqual(
	withBrowserUrlFlag(["--no-usage-statistics", "--browserUrl http://127.0.0.1:9222"], "http://127.0.0.1:9223"),
	["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9223"],
	"one row carrying its own value is rewritten in place"
);
assert.deepEqual(
	withBrowserUrlFlag(["--no-usage-statistics", "--wsEndpoint=ws://127.0.0.1:9222/devtools", "--headless"], "http://127.0.0.1:9222"),
	["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9222", "--headless"],
	"a live wsEndpoint is replaced by the run's own address, never kept beside it"
);

// ── the run, against fake TCP + launch seams ───────────────────────────────
// Every machine half is injected here — the TCP samples, the launch, the
// workspace link, and the landing page. Left to its default the landing half
// would render the packaged page and write it through the interop mount, i.e.
// into a real Windows directory, so no run test may omit it.
const baseOptions = () => ({
	cwd: "/home/u/dev/proj",
	localAppData: "C:\\Users\\u\\AppData\\Local",
	linkProfile: () => "linked",
	landing: () => "",
	exists: (path) => path === CHROME_MOUNT || path === "/mnt/c/Windows",
	candidates: [CHROME_WIN],
	prereqPorts: [135],
	startCwd: "/mnt/c/Windows",
	waitMs: 60,
	pollMs: 5
});

// 1. Prereq unmet: nothing launches. A prereq port no one answers is not a
// connectable host — launching would only leave a Windows window nothing
// could drive.
{
	let started = 0;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		reachable: async () => false,
		start: async () => {
			started += 1;
		}
	});
	assert.equal(result.state, "unreachable", "no prereq port reachable → unreachable");
	assert.equal(result.url, "", "nothing connects");
	assert.equal(result.error.includes("networkingMode=mirrored"), true, "the answer carries the one manual step");
	assert.equal(started, 0, "an unreachable host launches nothing");
}

// 2. No Windows binary at all: no TCP question is even asked.
{
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		exists: () => false,
		reachable: async () => {
			throw new Error("must not probe the prereq without an executable");
		}
	});
	assert.equal(result.state, "not-found", "nothing located");
}

// 3. The launch: prereq answered, the preferred port is free — the exact
// `start` invocation the plan prescribes, and the port binds right after.
{
	let launch = null;
	let launchCwd = null;
	let linked = null;
	let bound = false;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		linkProfile: (linkPath, profileWin) => {
			linked = [linkPath, profileWin];
			return "linked";
		},
		reachable: async (_host, port) => port === 135 || (bound === true && port === 9222),
		start: async (command, args, cwd) => {
			launch = [command, args];
			launchCwd = cwd;
			bound = true;
		}
	});
	assert.deepEqual(launch, [
		CHROME_MOUNT,
		[
			"--remote-debugging-port=9222",
			"--user-data-dir=C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome",
			"--no-first-run",
			"--no-default-browser-check"
		]
	], "the located executable is exec'd through the interop mount — no `cmd.exe /c start` wrapper (under interop it waits on the browser and never returns) — carrying the debugging port, the Windows-side profile (a WSL-rooted profile cannot carry the locks, measured live 2026-10-04), and the first-run page silenced (the welcome tab + search-engine chooser is what a brand-new profile opens on)");
	assert.deepEqual(linked, ["/home/u/dev/proj/.chrome", "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome"], "the workspace view is refreshed against the profile the run launched with");
	assert.equal(launchCwd, "/mnt/c/Windows", "the launch runs with a Windows-side working directory (never a UNC cwd)");
	assert.equal(result.state, "connected", "the port answered — connect mode is live");
	assert.equal(result.port, 9222, "the preferred port when nothing holds it");
	assert.equal(result.url, "http://127.0.0.1:9222", "the connect address matches the opened port");
	assert.equal(result.profileDir, "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome", "the run answers the profile directory it launched with");
	assert.equal(result.profileLink, "linked", "the link answer rides the run result");
}

// 4. The preferred port is taken: the pool's first free port, and the profile
// leaf carries it (Chrome refuses to share one profile across instances).
{
	let launch = null;
	let bound = false;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		reachable: async (_host, port) => port === 135 || port === 9222 || (bound === true && port === 9223),
		start: async (command, args) => {
			launch = args;
			bound = true;
		}
	});
	assert.equal(launch.includes("--remote-debugging-port=9223"), true, "the pool moved one port up");
	assert.equal(
		launch.includes("--user-data-dir=C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome-9223"),
		true,
		"the per-port profile never shares another instance's directory"
	);
	assert.equal(launch.includes("--no-first-run"), true, "the first-run page rides the launch whatever port the pool picked");
	assert.equal(launch.includes("--no-default-browser-check"), true, "and the default-browser check goes with it");
	assert.equal(result.port, 9223, "the run settles on the port it opened");
}

// 4b. The landing page: the run hands the launch its own answers (the profile it
// profiles, the address it connects on, the port it opened) and the URL that
// answers comes last in argv — a positional URL, opened once in that window. A
// "" answer means no page, and the argv stays exactly what it was.
{
	let launch = null;
	let landingArgs = null;
	let bound = false;
	const landingUrl = "file:///C:/Users/u/AppData/Local/dsh-chrome-mcp/prelaunch-9223.html";
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		landing: (profileDir, url, port) => {
			landingArgs = [profileDir, url, port];
			return landingUrl;
		},
		reachable: async (_host, port) => port === 135 || port === 9222 || (bound === true && port === 9223),
		start: async (_command, args) => {
			launch = args;
			bound = true;
		}
	});
	assert.deepEqual(
		landingArgs,
		["C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome-9223", "http://127.0.0.1:9223", 9223],
		"the page is rendered with this run's own answers, not a saved copy"
	);
	assert.equal(launch[launch.length - 1], landingUrl, "the page URL rides the launch argv, last (Chrome opens every positional URL it is given)");
	assert.equal(result.state, "connected", "the page is the window's explanation, never a precondition of the connection");
}

// 4c. A launch that fails is answered the same whether or not a page was
// written: a page is prose, and prose never carries the run's state.
{
	let started = 0;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		landing: () => "file:///C:/Users/u/AppData/Local/dsh-chrome-mcp/prelaunch-9222.html",
		reachable: async (_host, port) => port === 135,
		start: async () => {
			started += 1;
			throw new Error("could not run chrome.exe: EACCES");
		}
	});
	assert.equal(result.state, "launch-failed", "the launch failure is the whole answer");
	assert.equal(started, 1, "one launch");
}

// 5. A live connect entry re-checks instead of opening a second window (§6.5).
// One live session, every spelling the plugin accepts: 0 launches, the live
// port settled on, exactly one connect source surviving the merge.
{
	for (const currentFlags of [
		["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9223"],
		["--no-usage-statistics", "--browserUrl", "http://127.0.0.1:9223"],
		["--no-usage-statistics", "--browserUrl http://127.0.0.1:9223"],
		["--no-usage-statistics", "--wsEndpoint=ws://127.0.0.1:9223/devtools"]
	]) {
		let started = 0;
		const result = await runWindowsChromeConnect({
			...baseOptions(),
			landing: () => {
				throw new Error("no window was launched, so there is no page to write");
			},
			currentFlags,
			reachable: async (_host, port) => port === 135 || port === 9223,
			start: async () => {
				started += 1;
			}
		});
		const spelling = currentFlags.join(" ");
		assert.equal(result.state, "connected", `the already-live address settles the run (${spelling})`);
		assert.equal(result.port, 9223, `the live port is re-adopted, not re-opened (${spelling})`);
		assert.equal(started, 0, `an already-connecting host launches nothing (${spelling})`);
		assert.equal(result.profileDir, "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome-9223", `the settled profile is the one a launch would have picked for that port (${spelling})`);
		assert.equal(result.profileLink, "linked", `the view is refreshed against the settled profile, not only a launch (${spelling})`);
		assert.equal(
			withBrowserUrlFlag(currentFlags, result.url).filter((flag) => /^--(?:browserUrl|wsEndpoint)(?:=|(?=\s)|$)/iu.test(flag)).length,
			1,
			`the merged list keeps exactly one connect source (${spelling})`
		);
	}
}

// 6. The launch itself fails: the run answers launch-failed, nothing connects.
{
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		reachable: async (_host, port) => port === 135,
		start: async () => {
			throw new Error("could not run cmd.exe: EACCES");
		}
	});
	assert.equal(result.state, "launch-failed", "a failing start is its own answer");
	assert.equal(result.error.includes("EACCES"), true, "the launch failure carries the cause");
}

// 7. A launched browser that never binds its port is not reachable: the run
// settles unreachable with the prereq pointer rather than a phantom connection.
{
	let started = 0;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		waitMs: 40,
		reachable: async (_host, port) => port === 135,
		start: async () => {
			started += 1;
		}
	});
	assert.equal(started, 1, "the browser was launched once");
	assert.equal(result.state, "unreachable", "a browser that never binds its port does not connect");
	assert.equal(result.url, "", "nothing to connect to");
	assert.equal(result.error.includes("127.0.0.1:9222"), true, "the answer names the port that never opened");
}

// 8. No LOCALAPPDATA answer: the Windows-side profile directory cannot be
// derived, and the default profile is never a fallback (an in-use default
// profile ignores the port).
{
	let started = 0;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		localAppData: "",
		reachable: async (_host, port) => port === 135,
		start: async () => {
			started += 1;
		}
	});
	assert.equal(result.state, "launch-failed", "no profile directory without LOCALAPPDATA");
	assert.equal(result.error.includes("LOCALAPPDATA"), true, "the answer names the missing answer");
	assert.equal(started, 0, "an undeterminable profile directory never launches");
}

// 9. The list the caller hands in is what gets launched. Every earlier run case
// passes the *default* first candidate, so a run that ignored `candidates` and
// always located the standard install would still pass them all — this is the
// case that pins the other half: a named executable off the standard path
// launches itself, or answers `not-found` when it is not there. No standard
// location stands in for a selection the card named.
{
	let launch = null;
	let bound = false;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		exists: (path) => path === EDGE_MOUNT || path === "/mnt/c/Windows",
		candidates: [EDGE_WIN],
		reachable: async (_host, port) => port === 135 || (bound === true && port === 9222),
		start: async (command) => {
			launch = command;
			bound = true;
		}
	});
	assert.equal(result.state, "connected", "an off-standard executable connects");
	assert.equal(launch, EDGE_MOUNT, "the launched executable is the one named, not the standard install");
}
{
	let started = 0;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		exists: (path) => path === "/mnt/c/Windows",
		candidates: [EDGE_WIN],
		start: async () => {
			started += 1;
		}
	});
	assert.equal(result.state, "not-found", "an absent executable the caller named answers by naming it");
	assert.equal(started, 0, "and never launches on its own");
}

// A path named in the *mount* spelling is a Windows executable the run can reach:
// it is the spelling the WSL side can stat, and the only one a hand-written row or
// the row config may carry. The drive-letter mapping is one way, not the only way.
{
	let launch = null;
	let bound = false;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		exists: (path) => path === CHROME_MOUNT || path === "/mnt/c/Windows",
		candidates: [CHROME_MOUNT],
		reachable: async (_host, port) => port === 135 || (bound === true && port === 9222),
		start: async (command) => {
			launch = command;
			bound = true;
		}
	});
	assert.equal(result.state, "connected", "a mount-spelled executable locates and connects");
	assert.equal(launch, CHROME_MOUNT, "and launches as itself");
}

// A selection saved with the space shell-escaped is still the executable the
// run should launch: the escape folds back to the space it stands for, and the
// launch command carries the unescaped mount path. Folding the escape into a
// slash instead answered `not-found` for a Chrome that had been located (the
// **Prelaunch Windows Chrome** button read dead on every click).
{
	let launch = null;
	let bound = false;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		exists: (path) => path === CHROME_MOUNT || path === "/mnt/c/Windows",
		candidates: ["/mnt/c/Program\\ Files/Google/Chrome/Application/chrome.exe"],
		reachable: async (_host, port) => port === 135 || (bound === true && port === 9222),
		start: async (command) => {
			launch = command;
			bound = true;
		}
	});
	assert.equal(result.state, "connected", "an escaped selection still locates what it names");
	assert.equal(launch, CHROME_MOUNT, "the launch command carries the unescaped mount path");
}

// ── the controller wiring: one trigger write, one run ──────────────────────
// Since dsh 0.2.0 there is no base layer on the controller: the live answers
// ride the row's **volatile config references** — they reach the card as one
// commit on the fiber's own loader entry, and every user field (the two
// trigger nonces included) is read off the form's layers, not off a controller-
// owned document. The host half below is the loader shape the controller
// talks to: its own profile entry (`mcp-chrome`) publishing live state with
// `entry.update({ config }, false, false)`, a described form row answering the
// two layers, persistence through `settings.update(entryId, { field })`, and a
// reference for every `.volatile()` field.
const VOLATILE_FIELDS = new Set([
	"extraFlags",
	"chromePath",
	"executables",
	"chromeCustomPaths",
	"stderrMode",
	"refreshExecutablesNonce",
	"openWindowsChromeNonce",
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
]);

/**
 * The host ctx surface a controller-driven test boots against. The launch-
 * environment slot is how a test pins "under WSL?" without depending on the
 * machine running the suite; an empty map answers plain Linux.
 */
function hostCtx(options = {}) {
	const row = {
		serverName: "chrome",
		command: "npx",
		package: "chrome-devtools-mcp@latest",
		extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
		chromePath: "",
		executables: [],
		chromeCustomPaths: [],
		stderrMode: "",
		refreshExecutablesNonce: 0,
		openWindowsChromeNonce: 0,
		chromePaths: [],
		env: {},
		cwd: "",
		toolCallTimeoutMs: 60000,
		maxInstructionBytes: 32768,
		failOnStartupError: false,
		bridgeStderr: "console",
		bridgeStderrLog: "",
		reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
		...(options.row ?? {})
	};
	const state = { logs: [], bridges: [], updates: [], writes: [], commits: [], entry: void 0, user: {}, config: {} };
	const log = (...args) => {
		state.logs.push(args);
	};
	const settings = {
		describe: () => [{ ns: "mcp-chrome", user: { ...state.user }, base: { ...(options.row ?? {}) }, value: {} }],
		mutate: async (ns, ops) => {
			// A Host-originated write that still carries an open HMR write
			// transaction is refused before it queues — the live answer of
			// `hmr.runExclusive` guarding a config edit.
			if (writeTransaction.getStore()) throw new Error("HMR transactions cannot be nested");
			// What lands in the row: the named fields, plus any live-only field
			// the live layer is answering without being cleared — which is exactly
			// what every Host write-back prevents by carrying an `unset` for each
			// (the write channel answers volatile fields off the live layer, so
			// the clear has to ride the write; see ./persist.ts in the source).
			const patch = {};
			for (const op of ops) {
				if (op.op === "set") patch[op.path.join(".")] = op.value;
				continue;
			}
			for (const key of LIVE_MIRROR_FIELDS) {
				if (!Object.prototype.hasOwnProperty.call(state.entry.options.config, key)) continue;
				if (ops.some((op) => op.op === "unset" && op.path[0] === key)) continue;
				patch[key] = state.entry.options.config[key];
			}
			state.writes.push({ ns, ops, patch });
			// The write lands in the row's own patch layer — the user layer the
			// references resolve over the row config from then on. A cleared live
			// field drops out of the row.
			Object.assign(state.user, patch);
			for (const op of ops) {
				if (op.op === "unset") delete state.user[op.path[0]];
			}
		},
		configure: (_presentation, _owner) => {
			state.configured = (state.configured ?? 0) + 1;
			return () => {
				state.configured -= 1;
			};
		}
	};
	state.entry = {
		options: { id: "mcp-chrome", config: { ...row } },
		update: (next, create, force) => {
			state.entry.options.config = { ...state.entry.options.config, ...next.config };
			state.commits.push({ create, force });
		}
	};
	for (const [key, value] of Object.entries(row)) {
		state.config[key] = VOLATILE_FIELDS.has(key)
			? { get: () => (Object.prototype.hasOwnProperty.call(state.user, key) ? state.user[key] : value) }
			: value;
	}
	state.ctx = {
		logger: { trace() {}, debug() {}, info: log, warn: log, error: log, fatal() {} },
		fiber: { state: 2, entry: state.entry, await: async () => undefined },
		get(key) {
			if (key === "settings" && options.settings !== false) return settings;
			if (key === "launchEnvironment") {
				const values = options.env ?? {};
				return { get: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? { value: values[name] } : void 0) };
			}
			if (key === "sessions" && options.sessions) return options.sessions;
			return void 0;
		},
		on(event, handler) {
			if (event === "tools/post-execute") state.toolHandler = handler;
		},
		extend() {
			return {
				plugin(_ctor, bridgeCfg) {
					state.bridges.push(bridgeCfg);
					return {
						update: (cfg) => {
							state.updates.push(cfg);
							return Promise.resolve();
						}
					};
				}
			};
		},
		inject(deps, callback) {
			if (deps.includes("settings")) callback({ settings });
		}
	};
	// A simulated WSL host is a Linux host: the WSL probe reads the platform too.
	state.platform = options.env !== undefined && typeof options.env.WSL_DISTRO_NAME === "string" ? "linux" : undefined;
	return state;
}

/** Attach the configuration form: the first commit folds every persisted
 * trigger without queueing its run — that is what booting a host does. */
function attachForm(state) {
	const form = { entryId: "mcp-chrome", settings: state.ctx.get("settings") };
	return form;
}

/** Route one user write through the form commit — the same routing the loader
 * reports as `loader/volatile-update` paths in a live host. */
function commitUser(state, controller, field, value) {
	state.user[field] = value;
	controller.onFormCommit();
}

/** The same commit arriving **inside the write transaction it opened** — the
 * live shape, where the volatile-update emit that routes the commit fires
 * within the config edit. A run queued from here inherits that transaction's
 * async-local store, and the run's follow-up persistence must answer from a
 * neutral context or it is refused as a nested transaction. */
function commitUserInTransaction(state, controller, field, value) {
	writeTransaction.run(true, () => {
		state.user[field] = value;
		controller.onFormCommit();
	});
}

/** The live mirror as published onto the entry config. */
const published = (state) => state.entry.options.config;

const { createChromeMcpController } = await import("../lib/host/controller/index.js");
const { installPrelaunchWindowsChromeTool } = await import("../lib/host/tool.js");

// Off WSL the answer is read off the host before anyone can ask it: no run
// starts, and no trigger value can make one start.
{
	const state = hostCtx({ env: {} });
	const controller = createChromeMcpController(state.ctx, state.config, { platform: state.platform });
	controller.attachForm(attachForm(state));
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(published(state).windowsChromeStatus.state, "not-applicable", "off WSL the whole Windows path reads not-applicable");
	commitUser(state, controller, "openWindowsChromeNonce", 77);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(published(state).windowsChromeStatus.state, "not-applicable", "a trigger write on a plain host answers not-applicable");
	assert.equal(published(state).lastError, "", "and nothing is said about it");
}

// On a WSL host the trigger drives exactly one run, and success writes the
// connect entry into the saved flags through the configuration form's own
// persistence path — the bridge updates in place carrying it.
{
	const state = hostCtx({ env: WSL_ENV, sessions: { list: () => [{ header: { cwd: "/home/u/dev/proj", createdAt: 1 } }] } });
	let gotFlags = null;
	let gotCwd = "";
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [],
		runWindowsChrome: async (options) => {
			gotFlags = options.currentFlags;
			gotCwd = String(options.cwd);
			return { state: "connected", port: 9222, url: "http://127.0.0.1:9222", error: "" };
		}
	});
	controller.attachForm(attachForm(state)); // first commit: the persisted trigger folds, no run
	commitUser(state, controller, "openWindowsChromeNonce", 1717);
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(published(state).windowsChromeStatus.state, "connected", "the trigger drives the connected answer");
	assert.deepEqual(gotFlags, ["--no-usage-statistics", "--no-performance-crux"], "the run reads what the row default launches with");
	assert.equal(gotCwd, "/home/u/dev/proj", "the view the run refreshes rides the live session's workspace, not the host's launch directory");
	// Since the component model the run **writes nothing back**: the debugging
	// URL is answered by the connections that drive it (their `resolve` composes
	// it), and re-entry carries it from the live mirror — not from the row's
	// saved flags.
	assert.equal(state.writes.length, 0, "a connected run persists nothing");
	assert.equal(published(state).carriesConnectionMode, true, "connect mode rides the live mirror for the pill muting");
	assert.equal(published(state).windowsChromeStatus.port, 9222, "the mirror states the run's own port — that, not the row's flags, is what the pill keys on");
	assert.equal(published(state).lastError, "", "a connected run clears the error line");
}

// The trigger arriving inside its own write transaction (the live shape: the
// volatile-update emit that routes a form commit fires inside the config edit)
// must not cost the run its persistence. An executable run scheduled from that
// context used to answer every follow-up config write as a *nested* HMR
// transaction — refused before it queued — so the connect entry never reached
// the saved flags (measured live 2026-10-12). The run now answers from a neutral
// async context, and the write lands like it does for a commit read off the
// reference.
{
	const state = hostCtx({ env: WSL_ENV });
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [],
		runWindowsChrome: async () => ({ state: "connected", port: 9250, url: "http://127.0.0.1:9250", error: "" })
	});
	controller.attachForm(attachForm(state));
	commitUserInTransaction(state, controller, "openWindowsChromeNonce", 1919);
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(published(state).windowsChromeStatus.state, "connected", "a transaction-scoped commit still drives the run");
	assert.equal(state.writes.length, 0, "and the run persists nothing — the whole nested-transaction question left with the write-back it used to do");
	assert.equal(
		state.logs.some((entry) => entry.some((part) => String(part).includes("HMR transactions cannot be nested"))),
		false,
		"and the refusal never appears in the host log"
	);
}

// What the run launches is what the picker named. A selected Windows executable
// is handed to the run as its candidate list, so the launched browser is the
// path the card states — not the first location the run happens to find. Nothing
// picked leaves the run's own locate in charge, exactly as it was, and a local
// selection is not the run's business at all. Both triggers — the button's nonce
// and the MCP tool call — drive the same half, so the tool answers for exactly
// what the picker states the bridge will drive.
for (const [name, selectedPath, expected] of [
	["the Windows executable the picker selected", CHROME_WIN, [CHROME_WIN]],
	["the same executable spelled through the interop mount", CHROME_MOUNT, [CHROME_MOUNT]],
	["no selection", "", void 0],
	["a local selection", "/nonexistent-dir/chrome", void 0]
]) {
	const state = hostCtx({ env: WSL_ENV, row: { chromePath: selectedPath } });
	let seen = "unset";
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [CHROME_WIN],
		runWindowsChrome: async (options) => {
			seen = options.candidates;
			return { state: "connected", port: 9222, url: "http://127.0.0.1:9222", error: "" };
		}
	});
	controller.attachForm(attachForm(state));
	commitUser(state, controller, "openWindowsChromeNonce", 30 + name.length);
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.deepEqual(seen, expected, `the card's button drives ${name}`);
}

// The agent's trigger is the same half: one call, the same queued run, so what
// the card states the picker selected is what the tool launch drives — nothing
// already running stands in for it, because this controller has never run.
for (const [name, selectedPath, expected] of [
	["the Windows executable the picker selected", CHROME_WIN, [CHROME_WIN]],
	["the same executable spelled through the interop mount", CHROME_MOUNT, [CHROME_MOUNT]],
	["no selection", "", void 0],
	["a local selection", "/nonexistent-dir/chrome", void 0]
]) {
	const state = hostCtx({ env: WSL_ENV, row: { chromePath: selectedPath } });
	let seen = "unset";
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [CHROME_WIN],
		runWindowsChrome: async (options) => {
			seen = options.candidates;
			return { state: "connected", port: 9222, url: "http://127.0.0.1:9222", error: "" };
		}
	});
	assert.equal(
		(await controller.prelaunchWindowsChrome()).startsWith("Windows Chrome connected"),
		true,
		`the tool answers for ${name}`
	);
	assert.deepEqual(seen, expected, `the prelaunch_windows_chrome tool drives ${name}`);
}

// A run that fails mirrors its answer onto the error line and leaves the saved
// flags exactly where they were.
{
	const state = hostCtx({ env: WSL_ENV });
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [],
		runWindowsChrome: async () => ({
			state: "unreachable",
			port: 0,
			url: "",
			error: "Windows Chrome needs networkingMode=mirrored in %USERPROFILE%\\.wslconfig, then wsl --shutdown"
		})
	});
	controller.attachForm(attachForm(state)); // first commit folds; only a later diff drives the run
	commitUser(state, controller, "openWindowsChromeNonce", 1818);
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(published(state).windowsChromeStatus.state, "unreachable", "the failure state is what the card reads");
	assert.match(published(state).lastError, /networkingMode=mirrored/u, "the prereq answer reaches the error line");
	assert.equal(state.writes.length, 0, "a failed run writes nothing back");
	assert.equal(published(state).carriesConnectionMode, false, "and connect mode is not claimed — nothing answered connect mode for the live state");
}

// Connect mode is answered from what the bridge launches with, and re-derived on
// every publish rather from the event of a flags list being applied. Pinning it
// here: a host whose own saved flags carry the connect entry states connect mode
// without any run driving it, and a commit that touches nothing but a saved row's
// name neither drops the answer nor claims it. (What the same question looked like
// before was measured live 2026-10-13: a host booted with
// `--browserUrl=http://127.0.0.1:9223` carried in its saved flags answered nothing
// — the pill read the local executable — and a later unrelated save turned connect
// mode on by itself.)
{
	const state = hostCtx({ row: { extraFlags: ["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9222"] } });
	const controller = createChromeMcpController(state.ctx, state.config, { platform: state.platform });
	controller.attachForm(attachForm(state));
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(published(state).carriesConnectionMode, true, "a host that launches with a connect flag states it without any run");
}

// The mirror's answer never leads or lags what runs: it is re-derived on every
// publish, so the one thing that can silence it is the connect flag leaving the
// argv — never a commit that never touched the flags. (The same question asked of
// one commit that only renames a saved row: here it answers false, exactly because
// nothing about what is launched has changed.)
{
	const state = hostCtx({ env: WSL_ENV });
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [],
		runWindowsChrome: async () => ({ state: "connected", port: 9222, url: "http://127.0.0.1:9222", error: "" })
	});
	controller.attachForm(attachForm(state));
	commitUser(state, controller, "openWindowsChromeNonce", 1717);
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(published(state).carriesConnectionMode, true, "the run's own answer stands first");
	state.user.executables = [{ id: "/usr/bin/node", name: "renamed" }];
	controller.onFormCommit();
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(published(state).carriesConnectionMode, true, "a rename-only commit neither drops nor claims connect mode");
}

// ── the MCP-tool surface ───────────────────────────────────────────────────
// The controller method drives the same queued run without any trigger value:
// the call itself is the request, so nothing persisted can ever drive a launch.
{
	const state = hostCtx({ env: WSL_ENV });
	let runs = 0;
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [],
		runWindowsChrome: async () => {
			runs += 1;
			return { state: "connected", port: 9224, url: "http://127.0.0.1:9224", error: "" };
		}
	});
	const text = await controller.prelaunchWindowsChrome();
	assert.equal(runs, 1, "the tool call is the trigger — no nonce was written");
	assert.match(
		text,
		/^Windows Chrome connected at http:\/\/127\.0\.0\.1:9224/u,
		"a connected run answers through the same mirror the button reads"
	);
	const second = await controller.prelaunchWindowsChrome();
	assert.equal(second, text, "and it answers again the same way — no state was consumed");
}

// Off WSL the tool answers the same disabled state the button carries.
{
	const state = hostCtx({ env: {} });
	const controller = createChromeMcpController(state.ctx, state.config, { platform: state.platform });
	assert.equal(
		(await controller.prelaunchWindowsChrome()).includes("not a WSL instance"),
		true,
		"the tool answers not-applicable on a plain host"
	);
}

// A failing run quotes exactly what it answered — state and reason, nothing invented.
{
	const state = hostCtx({ env: WSL_ENV });
	const controller = createChromeMcpController(state.ctx, state.config, {
		platform: state.platform,
		windowsExecutables: () => [],
		runWindowsChrome: async () => ({
			state: "unreachable",
			port: 0,
			url: "",
			error: "Windows Chrome needs networkingMode=mirrored in %USERPROFILE%\\.wslconfig, then wsl --shutdown"
		})
	});
	const text = await controller.prelaunchWindowsChrome();
	assert.equal(text.startsWith("Windows Chrome did not connect (unreachable):"), true, "the failure names its state");
	assert.equal(text.includes("networkingMode=mirrored"), true, "and quotes the reason verbatim");
}

// The registration half: one global definition, one text block, the body being
// the controller method. The mount registers through one fiber effect, so the
// tools service resolving twice never registers twice, and disposing the
// effect releases the global registration instead of leaving it behind.
{
	const registrations = [];
	const unregistered = [];
	const injections = [];
	let disposeEffect;
	const inner = {
		tools: {
			register: (definition) => {
				registrations.push(definition);
				return () => unregistered.push(definition);
			}
		}
	};
	const ctx = {
		inject: (deps, callback) => {
			injections.push(callback);
			callback(inner);
		},
		effect: (execute) => {
			disposeEffect = execute();
			return { dispose: Promise.resolve() };
		}
	};
	const controller = { prelaunchWindowsChrome: async () => "Windows Chrome connected at http://127.0.0.1:9222" };
	installPrelaunchWindowsChromeTool(ctx, controller);
	injections[0](inner);
	assert.equal(registrations.length, 1, "the service resolving twice registers exactly once");
	const definition = registrations[0];
	assert.equal(definition.name, "prelaunch_windows_chrome", "the public name");
	assert.deepEqual(definition.parameters, { type: "object", properties: {}, additionalProperties: false }, "no arguments — every decision is the host's");
	const canonical = await definition.execute();
	assert.deepEqual(canonical, { text: "Windows Chrome connected at http://127.0.0.1:9222" }, "the body is exactly the controller's answer");
	assert.deepEqual(definition.output.render({}, canonical), [{ type: "text", text: canonical.text }], "the canonical value renders as one text block");
	const failed = { text: "Windows Chrome did not connect (not-found): no Windows Chrome found" };
	assert.deepEqual(definition.output.render({}, failed), [{ type: "text", text: failed.text }], "a failure renders as text too — it is an answer, not an error");
	disposeEffect();
	assert.equal(unregistered.length, 1, "disposing the effect releases the global registration");
	injections[0](inner);
	assert.equal(registrations.length, 2, "the next mount registers again — cleanly, because the old effect is gone");
}

console.log("windows.test.mjs: all assertions passed");
