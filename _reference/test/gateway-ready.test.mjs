// Tests for the gateway cold-start readiness gate (lib/index.js waitForGatewayReady
// and friends). These probe real sockets, so they exercise connect(2) directly.
// Run: node test/gateway-ready.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    backendApiSocketPaths,
    probeBackendApiSocket,
    waitForGatewayReady
} from "../lib/index.js";

function assertEqual(actual, expected, message) {
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

// backendApiSocketPaths: known platforms map, unknown platform is empty (no wait).
assertEqual(backendApiSocketPaths("darwin"), [], "unknown platform never waits");
assertEqual(backendApiSocketPaths("freebsd"), [], "unknown platform never waits");
assertEqual(backendApiSocketPaths("win32"), ["\\\\.\\pipe\\dockerBackendApiServer"], "win32 named pipe path");
assertEqual(
    backendApiSocketPaths("linux", "/home/u"),
    ["/run/host-services/backend.sock", "/home/u/.docker/desktop/backend.sock"],
    "linux socket paths"
);

// probeBackendApiSocket: ENOENT path reads as "absent".
const dir = await mkdtemp(join(tmpdir(), "dsh-ready-"));
try {
    assert.equal(await probeBackendApiSocket(join(dir, "nope.sock")), "absent", "missing socket is absent");

    // A listening socket on a real path reads as "connected".
    const live = createServer();
    const livePath = join(dir, "live.sock");
    await new Promise((resolve, reject) => {
        live.once("error", reject);
        live.listen(livePath, resolve);
    });
    assert.equal(await probeBackendApiSocket(livePath), "connected", "live socket connects");

    // A second connect attempt on the same live socket still succeeds.
    assert.equal(await probeBackendApiSocket(livePath), "connected", "connect stays connected");

    // A listening socket short-circuits waitForGatewayReady to "ready" before
    // the server closes.
    assert.equal(await waitForGatewayReady("docker", { paths: [livePath], timeoutMs: 300, pollMs: 50 }), "ready", "live socket is ready");
    await new Promise((resolve) => live.close(resolve));

    // Absent sockets + an answering daemon = nothing to wait for (plain CE): "no-backend-api".
    assert.equal(await waitForGatewayReady("/bin/true", { paths: [join(dir, "nope.sock")], timeoutMs: 300, pollMs: 50 }), "no-backend-api", "daemon up without a backend API settles without waiting");

    // No known platform paths short-circuits to "ready" without probing.
    assert.equal(await waitForGatewayReady("docker", { paths: [], timeoutMs: 300, pollMs: 50 }), "ready", "empty path list is ready");

    // shouldStop ends the wait as "ready" (the caller disposes the host half).
    assert.equal(await waitForGatewayReady("docker", { paths: [join(dir, "nope.sock")], shouldStop: () => true, timeoutMs: 300, pollMs: 50 }), "ready", "disposed host never waits");

    // Absent sockets and an unreachable daemon: the bounded wait settles as
    // "timed-out" rather than stalling.
    assert.equal(await waitForGatewayReady("/bin/false", { paths: [join(dir, "nope.sock")], timeoutMs: 150, pollMs: 30 }), "timed-out", "no answer settles as timed-out");
} finally {
    await rm(dir, { recursive: true, force: true });
}

console.log("gateway-ready.test.mjs: all assertions passed");
