/**
 * Browser card controller — the polling budgets.
 *
 * The two timings every action that waits for the host's run re-reads the shared
 * describe mirror uses. They live here so the card and the tests quote one source
 * rather than the loader (which ignores them) or the controller class.
 */

/** Re-describe cadence (ms) while waiting for the host's executable run. */
export const CHECK_POLL_TICK_MS = 700;
/** Give up waiting for the waited-on revision to advance after this (ms). The
 * host's probe subprocess times out at 15s, its scan is bounded by the same. */
export const CHECK_POLL_TIMEOUT_MS = 20000;
