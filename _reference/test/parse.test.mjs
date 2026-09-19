// Parse + discovery tests for @comecaramelos/dsh-docker-desktop-mcp host half.
// Run: node test/parse.test.mjs (needs `npm install` first).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractProfileIds, listProfiles, readPersistedProfile, resolveBaseProfile, resolveDockerCommand, WSL_DOCKER_HOST_COMMAND } from "../lib/index.js";

const cases = [
    // bare array of objects with id
    [JSON.stringify([{ id: "dev", name: "Dev" }, { id: "prod", name: "Prod" }]), ["dev", "prod"]],
    // wrapper object under profiles key
    [JSON.stringify({ profiles: [{ profileID: "a", name: "A" }, { profileId: "b", name: "B" }] }), ["a", "b"]],
    // bare array of strings
    [JSON.stringify(["x", "y", "x"]), ["x", "y"]],
    // object wrapping first array value
    [JSON.stringify({ data: [{ name: "n1" }, { name: "n2" }] }), ["n1", "n2"]],
    // empty list
    [JSON.stringify([]), []],
    // empty wrapper
    [JSON.stringify({ profiles: [] }), []],
    // mixed junk entries are skipped
    [JSON.stringify([null, 42, { other: true }, "keep", { id: "id2" }]), ["keep", "id2"]]
];

for (const [input, expected] of cases) {
    assert.deepEqual(extractProfileIds(input), expected, `extractProfileIds(${input})`);
}

// resolveBaseProfile: env var wins when valid, else fall back to configured
assert.equal(resolveBaseProfile("default", "my_profile"), "my_profile", "valid env wins");
assert.equal(resolveBaseProfile("default", undefined), "default", "no env keeps config");
assert.equal(resolveBaseProfile("default", ""), "default", "empty env keeps config");
assert.equal(resolveBaseProfile("default", "BAD PROFILE!"), "default", "invalid env keeps config");
assert.equal(resolveBaseProfile("cfg", 42), "cfg", "non-string env keeps config");

// resolveDockerCommand: only the literal default "docker" is rewritten, only
// on linux, only when the WSL host CLI path exists.
assert.equal(resolveDockerCommand("docker", { platform: "linux", exists: () => true }), WSL_DOCKER_HOST_COMMAND, "linux + wsl cli present rewrites default docker");
assert.equal(resolveDockerCommand("docker", { platform: "linux", exists: () => false }), "docker", "no wsl cli path keeps default");
assert.equal(resolveDockerCommand("docker", { platform: "darwin", exists: () => true }), "docker", "non-linux never rewrites");
assert.equal(resolveDockerCommand("win32-docker", { platform: "linux", exists: () => true }), "win32-docker", "explicit command always wins");
assert.equal(resolveDockerCommand("/Docker/host/bin/docker.exe", { platform: "linux", exists: () => true }), "/Docker/host/bin/docker.exe", "explicit host path stays put");

// readPersistedProfile: returns the stored user-layer profile only when the
// settings service is up and the value is a valid profile id; otherwise undefined.
const ctxWith = (settings) => ({ get: (name) => (name === "settings" ? settings : void 0) });
assert.equal(readPersistedProfile(ctxWith({ document: { "docker-desktop-mcp": { profile: "saved" } } })), "saved", "valid stored profile is returned");
assert.equal(readPersistedProfile(ctxWith({ document: { "docker-desktop-mcp": { profile: "BAD PROFILE" } } })), undefined, "invalid stored profile is ignored");
assert.equal(readPersistedProfile(ctxWith({ document: { "docker-desktop-mcp": { profile: 42 } } })), undefined, "non-string stored profile is ignored");
assert.equal(readPersistedProfile(ctxWith({ document: {} })), undefined, "absent namespace is ignored");
assert.equal(readPersistedProfile(ctxWith({ document: { "docker-desktop-mcp": "junk" } })), undefined, "non-object section is ignored");
assert.equal(readPersistedProfile(ctxWith(void 0)), undefined, "absent settings service is ignored");
assert.equal(readPersistedProfile({ get: () => { throw new Error("boom"); } }), undefined, "settings lookup failure is swallowed");

// blank stdout → no profiles
assert.deepEqual(extractProfileIds("   \n"), []);
// non-JSON stdout throws (caller stores the reason)
assert.throws(() => extractProfileIds("not json"));

// listProfiles through a fake docker shim
const dir = mkdtempSync(join(tmpdir(), "dshdmc-"));
try {
    const shim = join(dir, "docker");
    writeFileSync(
        shim,
        `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") === "mcp profile list --format json") {
    process.stdout.write(${JSON.stringify(JSON.stringify([{ id: "shim-profile", name: "Shim" }]))});
    process.exit(0);
}
process.stderr.write("unexpected args: " + process.argv.slice(2).join(" ") + "\\n");
process.exit(3);
`
    );
    chmodSync(shim, 0o755);
    const ids = await listProfiles(shim);
    assert.deepEqual(ids, ["shim-profile"], "shim discovery");

    const failShim = join(dir, "docker-fail");
    writeFileSync(
        failShim,
        `#!/usr/bin/env node
process.stderr.write("unknown flag: --profile\\n");
process.exit(1);
`
    );
    chmodSync(failShim, 0o755);
    await assert.rejects(
        listProfiles(failShim),
        /failed: unknown flag: --profile — enable the profiles feature first/,
        "failure reason surfaces with feature hint"
    );
} finally {
    rmSync(dir, { recursive: true, force: true });
}

console.log("parse.test.mjs: all assertions passed");
