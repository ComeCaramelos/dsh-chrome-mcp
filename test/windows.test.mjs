// Host-half tests for the **Prelaunch Windows Chrome** run (./host/windows.ts + the
// controller's Windows wiring): pure helpers, the orchestrated run against fake
// reachability/launch seams (the exact `start` argv, the port pool, every error
// path), and the controller's nonce trigger. Run: node test/windows.test.mjs.
import assert from "node:assert/strict";
import {
	browserUrlFlagPort,
	findWindowsChromeExecutable,
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
{
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
assert.equal(browserUrlFlagPort(["--browserUrl=http://127.0.0.1:9223", "--headless"]), 9223, "the live port reads back out of the entry");
assert.equal(browserUrlFlagPort(["--wsEndpoint=ws://x:1"]), 0, "a wsEndpoint carries no local port to re-check");
assert.equal(browserUrlFlagPort([]), 0, "no entry answers port 0");

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
{
	let started = 0;
	const result = await runWindowsChromeConnect({
		...baseOptions(),
		landing: () => {
			throw new Error("no window was launched, so there is no page to write");
		},
		currentFlags: ["--no-usage-statistics", "--browserUrl=http://127.0.0.1:9223"],
		reachable: async (_host, port) => port === 135 || port === 9223,
		start: async () => {
			started += 1;
		}
	});
	assert.equal(result.state, "connected", "the already-live address settles the run");
	assert.equal(result.port, 9223, "the live port is re-adopted, not re-opened");
	assert.equal(started, 0, "an already-connecting host launches nothing");
	assert.equal(result.profileDir, "C:\\Users\\u\\AppData\\Local\\dsh-chrome-mcp\\.chrome-9223", "the settled profile is the one a launch would have picked for that port");
	assert.equal(result.profileLink, "linked", "the view is refreshed against the settled profile, not only a launch");
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

// ── the controller wiring: one trigger write, one run ──────────────────────
const config = {
	serverName: "chrome",
	command: "npx",
	package: "chrome-devtools-mcp@latest",
	extraFlags: ["--no-usage-statistics", "--no-performance-crux"],
	chromePath: "",
	chromePaths: [],
	env: {},
	cwd: "",
	toolCallTimeoutMs: 60000,
	failOnStartupError: false,
	bridgeStderr: "console",
	bridgeStderrLog: "",
	reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
};

/**
 * The host ctx surface the controller reads when no settings section is
 * installed (source then defaults to the controller's own base layer, which is
 * what a wiring test drives). The launch-environment slot is how a test pins
 * "under WSL?" without depending on the machine running the suite.
 */
function hostCtx(options) {
	const state = { logs: [], bridges: [], updates: [] };
	const log = (...args) => {
		state.logs.push(args);
	};
	state.ctx = {
		logger: { trace() {}, debug() {}, info: log, warn: log, error: log, fatal() {} },
		get(key) {
			if (key === "settings" && options.settings) return options.settings;
			if (key === "launchEnvironment" && options.env !== void 0) {
				const values = options.env;
				return { get: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? { value: values[name] } : void 0) };
			}
			if (key === "sessions" && options.sessions) return options.sessions;
			return void 0;
		},
		on() {},
		extend() {
			return {
				plugin(_ctor, bridgeCfg) {
					state.bridges.push(bridgeCfg);
					return {
						update: (cfg) => {
							state.updates.push(cfg);
						}
					};
				}
			};
		}
	};
	return state;
}

const { createChromeMcpController } = await import("../lib/host/controller/index.js");
const { installPrelaunchWindowsChromeTool } = await import("../lib/host/tool.js");

// Off WSL the answer is read off the host before anyone can ask it: no run
// starts, and no trigger value can make one start.
{
	const state = hostCtx({ env: {} });
	const controller = createChromeMcpController(state.ctx, { ...config });
	assert.equal(controller.entry.windowsChromeStatus.state, "not-applicable", "off WSL the whole Windows path reads not-applicable");
	controller.entry.openWindowsChromeNonce = 77;
	controller.onSettingsChange();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(controller.entry.windowsChromeStatus.state, "not-applicable", "a trigger write on a plain host answers not-applicable");
	assert.equal(controller.entry.lastError, "", "and nothing is said about it");
}

// On a WSL host the trigger drives exactly one run, and success writes the
// connect entry into the saved flags — the bridge updates in place carrying it.
{
	const writes = [];
	const settings = {
		document: {},
		mutate: (_ns, ops) => {
			writes.push(...ops);
			return Promise.resolve();
		}
	};
	const state = hostCtx({ env: WSL_ENV, settings, sessions: { list: () => [{ header: { cwd: "/home/u/dev/proj", createdAt: 1 } }] } });
	let gotFlags = null;
	let gotCwd = "";
	const controller = createChromeMcpController(state.ctx, { ...config }, {
		runWindowsChrome: async (options) => {
			gotFlags = options.currentFlags;
			gotCwd = String(options.cwd);
			return { state: "connected", port: 9222, url: "http://127.0.0.1:9222", error: "" };
		}
	});
	controller.onSettingsChange(); // first commit: the persisted trigger folds, no run
	controller.entry.openWindowsChromeNonce = 1717;
	controller.onSettingsChange();
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(controller.entry.windowsChromeStatus.state, "connected", "the trigger drives the connected answer");
	assert.deepEqual(gotFlags, ["--no-usage-statistics", "--no-performance-crux"], "the run reads what the bridge launches with");
	assert.equal(gotCwd, "/home/u/dev/proj", "the view the run refreshes rides the live session's workspace, not the host's launch directory");
	const flagWrites = writes.filter((op) => String(op.path) === "extraFlags");
	assert.equal(flagWrites.length, 1, "the connect entry was persisted once");
	assert.deepEqual(
		flagWrites[0].value,
		["--no-usage-statistics", "--no-performance-crux", "--browserUrl=http://127.0.0.1:9222"],
		"the saved flags gain the connect entry and keep everything else"
	);
	assert.deepEqual(
		state.updates.at(-1).args,
		["-y", "chrome-devtools-mcp@latest", "--no-usage-statistics", "--no-performance-crux", "--browserUrl=http://127.0.0.1:9222"],
		"the bridge updates in place carrying the connect entry"
	);
	assert.equal(controller.entry.carriesConnectionMode, true, "connect mode rides the base layer for the pill muting");
	assert.equal(controller.entry.lastError, "", "a connected run clears the error line");
}

// A run that fails mirrors its answer onto the error line and leaves the saved
// flags exactly where they were.
{
	const writes = [];
	const settings = {
		document: {},
		mutate: (_ns, ops) => {
			writes.push(...ops);
			return Promise.resolve();
		}
	};
	const state = hostCtx({ env: WSL_ENV, settings });
	const controller = createChromeMcpController(state.ctx, { ...config }, {
		runWindowsChrome: async () => ({
			state: "unreachable",
			port: 0,
			url: "",
			error: "Windows Chrome needs networkingMode=mirrored in %USERPROFILE%\\.wslconfig, then wsl --shutdown"
		})
	});
	controller.onSettingsChange(); // first commit folds; only a later diff drives the run
	controller.entry.openWindowsChromeNonce = 1818;
	controller.onSettingsChange();
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(controller.entry.windowsChromeStatus.state, "unreachable", "the failure state is what the card reads");
	assert.match(controller.entry.lastError, /networkingMode=mirrored/u, "the prereq answer reaches the error line");
	assert.equal(writes.filter((op) => String(op.path) === "extraFlags").length, 0, "a failed run writes nothing back");
	assert.equal(controller.entry.carriesConnectionMode, false, "and connect mode is not claimed");
}

// ── the MCP-tool surface ───────────────────────────────────────────────────
// The controller method drives the same queued run without any trigger value:
// the call itself is the request, so nothing persisted can ever drive a launch.
{
	const state = hostCtx({ env: WSL_ENV });
	let runs = 0;
	const controller = createChromeMcpController(state.ctx, { ...config }, {
		runWindowsChrome: async () => {
			runs += 1;
			return { state: "connected", port: 9224, url: "http://127.0.0.1:9224", error: "" };
		}
	});
	const text = await controller.prelaunchWindowsChrome();
	assert.equal(runs, 1, "the tool call is the trigger — no nonce was written");
	assert.equal(
		text,
		"Windows Chrome connected at http://127.0.0.1:9224 — the bridge connects to it instead of launching one.",
		"a connected run answers through the same mirror the button reads"
	);
	const second = await controller.prelaunchWindowsChrome();
	assert.equal(second, text, "and it answers again the same way — no state was consumed");
}

// Off WSL the tool answers the same disabled state the button carries.
{
	const state = hostCtx({ env: {} });
	const controller = createChromeMcpController(state.ctx, { ...config });
	assert.equal(
		(await controller.prelaunchWindowsChrome()).includes("not a WSL instance"),
		true,
		"the tool answers not-applicable on a plain host"
	);
}

// A failing run quotes exactly what it answered — state and reason, nothing invented.
{
	const state = hostCtx({ env: WSL_ENV });
	const controller = createChromeMcpController(state.ctx, { ...config }, {
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
