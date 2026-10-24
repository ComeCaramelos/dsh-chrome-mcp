// Host-half form-surface tests for @comecaramelos/dsh-chrome-mcp.
// Run: node test/schema.test.mjs (needs `npm run build` first).
//
// Since dsh 0.2.0 a field the GUI edits is *only* reachable through the profile
// configuration form when it is declared `.volatile()` on the row `Config`: an
// entry whose Config declares none answers no form at all
// (`Plugin entry "<id>" has no volatile fields`), and a write naming a
// non-volatile field is refused Host-side
// (`Config field "<path>" is not volatile`). Both failures look like a dead card
// and neither is caught by reading the plugin's own `Config` fields.
//
// So this file pins the *served* form surface, derived exactly the way the
// settings service derives it (the field types carrying `meta.volatile`), and
// then pins the client write surface against it: a field that stops being
// volatile fails here instead of failing on the GUI.
import assert from "node:assert/strict";
import { Config, liveMirrorKeys } from "../lib/index.js";

/** Field name → field type, read back out of the served form's compiled shape. */
function fieldTypes(config) {
	const compiled = config.toJSON();
	const refs = compiled.refs ?? {};
	// The root `dict` maps every field name to its compiled type.
	const root = Object.values(refs).find((entry) => entry && typeof entry.dict === "object" && entry.dict !== null && Object.keys(entry.dict).length > 5);
	assert.ok(root, "Config did not compile to a keyed shape");
	const out = new Map();
	for (const [name, ref] of Object.entries(root.dict)) out.set(name, refs[ref] ?? {});
	return out;
}

const fields = fieldTypes(Config);
const names = [...fields.keys()].sort();
const volatile = names.filter((name) => fields.get(name)?.meta?.volatile === true);

// The whole surface: 36 fields, of which 24 are volatile (the six user-authored
// ones plus the mirrors the Host publishes, the Host-authored drop record and
// the dismissed-translation marker) and 12 stay plain because they only ever
// arrive through the row config or the resolved connection config.
assert.equal(names.length, 36, `expected 36 fields, got ${names.length}`);
assert.deepEqual(
	volatile,
	[
		"carriesConnectionMode",
		"chromeCustomPaths",
		"chromeMissing",
		"chromePath",
		"chromeVersion",
		"defaultExtraFlags",
		"droppedExecutables",
		"effectiveChromePath",
		"effectiveSource",
		"executableDiscoveryRevision",
		"executableStatus",
		"executables",
		"extraFlags",
		"lastError",
		"migrationDismissed",
		"openWindowsChromeNonce",
		"refreshExecutablesNonce",
		"runningFlags",
		"runningNote",
		"stderrEffective",
		"stderrMode",
		"windowsChromeStatus",
		"wslExtraFlags",
		"wslWindowsExecutable"
	].sort(),
	"a field the GUI does not edit (or an ordinary field) went volatile"
);
assert.deepEqual(
	names.filter((name) => !volatile.includes(name)),
	["bridgeStderr", "bridgeStderrLog", "chromePaths", "command", "cwd", "env", "failOnStartupError", "maxInstructionBytes", "package", "reconnect", "serverName", "toolCallTimeoutMs"].sort(),
	"every field the bridge reads verbatim must stay non-volatile"
);

// The write surface the browser half owns: exactly these fields reach the Host
// through the configuration form (see `src/client/controller/controller.ts`).
// Nothing here is derived from the client bundle, so a client that starts
// writing a field the Host never declared volatile is caught by this list plus
// the assertion below it.
const CLIENT_WRITES = [
	"chromePath",
	"executables",
	"extraFlags",
	"openWindowsChromeNonce",
	"refreshExecutablesNonce",
	"stderrMode"
];
for (const field of CLIENT_WRITES) {
	assert.ok(volatile.includes(field), `the card writes "${field}", which is not volatile — the write would be refused`);
}

// The read side of the same contract: every field the card projects onto its
// snapshot must be a served field too — the Host answers live state only through
// the volatile layer, so a field that drops out of it reads as a blank card. The
// four served-but-unread fields are exactly the two host-run triggers (the card
// fires them through the *staged* write path, not by reading them), the legacy
// hand-typed path list the Host only folds in, and the Host's own record of the
// saved rows the user dropped (no half reads it back — the merge step consults
// it Host-side).
const CLIENT_READS = [
	"carriesConnectionMode",
	"chromeMissing",
	"chromePath",
	"chromeVersion",
	"defaultExtraFlags",
	"effectiveChromePath",
	"effectiveSource",
	"executableDiscoveryRevision",
	"executableStatus",
	"executables",
	"extraFlags",
	"lastError",
	"stderrEffective",
	"stderrMode",
	"wslExtraFlags",
	"wslWindowsExecutable",
	"windowsChromeStatus"
].sort();
for (const field of CLIENT_READS) {
	assert.ok(volatile.includes(field), `the card reads "${field}", which the Host no longer serves as volatile config`);
}
assert.deepEqual(
	volatile.filter((name) => !CLIENT_READS.includes(name)),
	["chromeCustomPaths", "droppedExecutables", "migrationDismissed", "openWindowsChromeNonce", "refreshExecutablesNonce", "runningFlags", "runningNote"],
	"a served volatile field went unread by the card, or a trigger became a readable field"
);

// A field the card edits is always volatile, so the two lists differ by exactly
// the six write fields plus the twelve fields the Host publishes without the
// card reading them back (the four triggers it fires, the three Host-side
// records, and the three live answers no card surface renders).
assert.ok(volatile.length === CLIENT_WRITES.length + 18, `expected the volatile surface to be the six card writes plus 18 Host-published fields, got ${volatile.length}`);

// ── live mirror ↔ declared Config (M8) ──────────────────────────────────────
// Every key the Host *publishes* as live state must also be a *declared*
// `.volatile()` field of the same `Config`: the publish commits it through the
// entry options, and what the row cannot hold can never reach a card. A key
// invented inside `createLiveMirror()` without a declaration is the migration's
// silent regression — it never reads, never errors, and every pin above stays
// green because all of them inventory from the `Config` side.
for (const key of liveMirrorKeys()) {
	assert.ok(fields.has(key), `the live mirror answers "${key}", which the Config never declares`);
	assert.ok(volatile.includes(key), `the live mirror answers "${key}", which the Config does not declare volatile`);
}

// The read closes in the other direction: a declared volatile field that is not
// live-published must be one the *card* writes (or the Host-side records the
// merge and the translation consult) — otherwise no commit would ever answer it
// and the pin above would stay blind. The closed list is exactly the six fields
// the card stages (`CLIENT_WRITES`) plus the legacy hand-typed path list, the
// drop record and the dismissed-translation marker — fields that are persisted
// *state*, not answers.
const NON_MIRROR_VOLATILE = [...liveMirrorKeys()];
const declaredNonMirror = volatile.filter((name) => !NON_MIRROR_VOLATILE.includes(name)).sort();
assert.deepEqual(
	declaredNonMirror,
	[...CLIENT_WRITES, "chromeCustomPaths", "droppedExecutables", "migrationDismissed"].sort(),
	"a volatile field fell out of the live mirror without becoming a card write — or a new persisted record went unaccounted for"
);

console.log("schema.test.mjs: all assertions passed");
