/**
 * @comecaramelos/dsh-chrome-mcp — browser half, public surface.
 *
 * The one module the bundler walks, so the emitted `client.js` exports exactly
 * what the shell consumes: `apply` (mount the card) and `inject` (the services
 * this half needs). The two poll budgets ride on the surface for the same
 * test-facing reason — the loader ignores them. Everything behind these
 * re-exports stays an implementation detail, so tests import the bundle,
 * never a module inside it.
 *
 * Re-export only: nothing here decides anything.
 */
export { apply } from "./apply.js";
export { inject } from "./plugin-meta.js";
export { CHECK_POLL_TICK_MS, CHECK_POLL_TIMEOUT_MS } from "./controller/index.js";
