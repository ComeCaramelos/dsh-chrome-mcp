/**
 * Browser half — the card's data controller.
 *
 * One class (`ChromeMcpCardController`) plus the surfaces it reads and projects:
 * the bound settings scope + describe mirror it is built from, the snapshot it
 * holds, the safe reads, and the poll budgets. Split out of the single
 * `controller.ts` so the class reads as just the store + write actions:
 *
 *   ./controller.ts  the store + publish + every write action (the class)
 *   ./snapshot.ts    the snapshot shape + the scope/mirror surfaces (types)
 *   ./read.ts        the total reads that fold a served value onto the store
 *   ./budget.ts      the two poll timings
 *
 * Nothing decides on its own: the class projects the host's served snapshot and
 * forwards each control to a persisted write, waiting on the one revision
 * counter the host's run advances.
 */
export { CHECK_POLL_TICK_MS, CHECK_POLL_TIMEOUT_MS } from "./budget.js";
export type { ChromeExecutableStatus, ChromeMcpCardSnapshot, DescribeMirror, SettingsScope, SettingsScopeSnapshot, WindowsChromeStatus } from "./snapshot.js";
export { ChromeMcpCardController } from "./controller.js";
