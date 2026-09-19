// Host-half pure-function tests for @comecaramelos/dsh-chrome-mcp.
// Run: node test/parse.test.mjs (needs `npm install` first).
import assert from "node:assert/strict";
import {
	buildServerArgs,
	checkChrome,
	DEFAULT_CHROME_PATHS,
	defaultChromePaths,
	discoverChrome,
	isChromeMissing,
	readPersistedFlags,
	resolveEnvFlags,
	sameFlags,
	toolResultNote,
	validateExtraFlags
} from "../lib/index.js";

// ── validateExtraFlags ─────────────────────────────────────────────────────
// Flags are execve'd as argv entries (no shell), so only control characters
// are rejected.
assert.equal(validateExtraFlags(["--no-usage-statistics", "--no-performance-crux"]), true, "accepts the default flags");
assert.equal(validateExtraFlags([]), true, "accepts an empty list");
assert.equal(
	validateExtraFlags(["--executablePath=/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"]),
	true,
	"accepts a flag whose value contains spaces (argv is exec'd without a shell)"
);
assert.throws(() => validateExtraFlags("--no-usage-statistics\n--no-performance-crux"), /must be an array/, "rejects a bare string");
assert.throws(() => validateExtraFlags(["--ok", ""]), /non-empty/, "rejects empty entries");
assert.throws(() => validateExtraFlags(["--headless\n--isolated"]), /control characters/, "rejects embedded newlines");
assert.throws(() => validateExtraFlags(["--x\u0000y"]), /control characters/, "rejects NUL");

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
	"an explicit executable-path flag wins over chromePath"
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
// Empty chromePath runs the upstream-stable discovery probe: a missing
// executable is the known "Chrome executable not found" error the card
// reports — surfaced without any tool call (upstream launches the browser
// lazily).
await assert.rejects(
	checkChrome({ chromePath: "", chromePaths: ["/nonexistent-dir/chrome-should-not-exist"] }),
	/Chrome executable not found: no executable detected \(checked: \S+\)/u,
	"discovery finds nothing → known executable-missing error"
);
// An empty candidate list probes nothing (keeps host runs deterministic when
// patched to a pinning/connect flag list too).
assert.equal(await checkChrome({ chromePath: "", chromePaths: [] }), "", "no candidates → nothing probed");
// A flag that already pins an executable or declares a connect mode leaves
// the executable question to the bridge: no probe.
assert.equal(
	await checkChrome({ chromePath: "", chromePaths: ["/nonexistent-dir/x"] }, ["--executablePath=/opt/custom/chrome"]),
	"",
	"executable pinned by a flag → no probe"
);
assert.equal(
	await checkChrome({ chromePath: "", chromePaths: ["/nonexistent-dir/x"] }, ["--browserUrl=http://127.0.0.1:9222"]),
	"",
	"connect mode → no executable check"
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
