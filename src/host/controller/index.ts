/**
 * Host half — the controller's live state + behavior.
 *
 * One controller per apply(): the live mirror the Host publishes, the serialized
 * executable runs, the Windows run half, and the tool-call capture path. The
 * public surface is `createChromeMcpController` (the controller object itself);
 * everything behind it is split into concern modules:
 *
 *   ./controller.ts   the assembly: resolve config, seed the live mirror, wire
 *                     the public methods
 *   ./state.ts        the live state + context every helper shares (internal)
 *   ./notes.ts        live-mirror announcements (selection, stderr)
 *   ./connections.ts  the manager seam: what answers reach the live state, and
 *                     how a default answer change reaches live connections
 *   ./runs.ts         the executable run + serialization + the Windows trigger
 *   ./windows-run.ts  the one **Prelaunch Windows Chrome** run
 *   ./persist.ts      the form writes a run makes (seed, rows, dismissal)
 *   ./captures.ts     tool-call-result capture
 *   ./commits.ts      configuration-form commit routing (`onFormCommit`)
 *
 * The two rules that must survive the split: read the layers through
 * `state.source()` at commit time, never capture them, and route every live answer
 * out through `publishLive` (./publish.ts) — configuration-form commits route in,
 * never out, and the live mirror is never written by a commit path.
 */
export { createChromeMcpController } from "./controller.js";
export type { ChromeMcpController, ChromeMcpControllerDeps } from "./controller.js";
export type { Controller, ControllerState } from "./state.js";
export type { RunningAnswers } from "./connections.js";
