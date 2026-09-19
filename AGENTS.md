# AGENTS.md

Chrome DevTools MCP plugin for DeepSeek Harness (DSH). Bridges the
[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
MCP server (`npx -y chrome-devtools-mcp@latest [extraFlags]`) with a Web GUI
card: extra-flags editor, Chrome-executable / connection error reporting, the
discovered Chrome version, and the upstream configuration-guide message.

## Layout

- `lib/index.js` — host half (ESM, `main`). Exports `name`, `inject`,
  `Config` (schemastery/zod schema), `SettingsSchema`, `apply(ctx, config)`,
  plus the pure helpers `validateExtraFlags`, `buildServerArgs`, `sameFlags`,
  `readPersistedFlags`, `resolveEnvFlags`, `checkChrome`, `discoverChrome`,
  `defaultChromePaths`, `captureLogger`, `toolResultNote`, `isChromeMissing`.
  Spawns the bridge via a nested `@deepseek-ai/dsh-mcp-client` plugin and
  registers the `chrome-mcp` settings namespace.
- `lib/client.js` — browser half (CJS **factory bundle**, `./client` export).
  Hand-written, not built: registers through
  `window.__ModuleLoader__.load({ id, factory: (require) => … })`, requiring
  `react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-store` via the
  whitelisted loader. No UI primitives — the flags editor is a plain textarea
  (`props.saveFlags`), unlike the reference's Menu profile picker. No
  bundler step — keep it self-contained.
- `cordis.patch.yml` — package-root **bundle patch layer**: inserts the
  `mcp-chrome` row (with the plugin `name`) so `dsh plugin … add` activates
  the bridge without a manual profile patch. Declared as
  `dsh.bundle.patch` in `package.json` and listed in `files` (must stay in
  the tarball). Row `id` / `name` / `serverName` are a public contract:
  a profile row with the same `id` fully replaces this config, so renaming
  them is breaking.
- `test/parse.test.mjs`, `test/client.test.mjs` — plain `node:assert` scripts
  (run via `npm test`), not a test framework.
- `.smoke/` — manual end-to-end fixtures (`fake-npx` + `fake-chrome` shims +
  `--patch` overlays); `args.log` is the fake-npx invocation log (gitignored).
- `.probe/` — throwaway probes and field-test evidence (gitignored): the WSL
  `--executablePath` viability probe and `.probe/field-test.mjs`, a stdio
  driver of the real `npx` bridge against native Linux Chrome (see Testing
  conventions).

## Hard constraints (do not break)

- **One settings namespace per host**: `chrome-mcp` is fixed, not derived
  from `serverName`. A second instance must fail loud, not alias.
- **Bridge argv shape is fixed**: `npx -y <package> [extraFlags]`
  (`command: npx`, `package: chrome-devtools-mcp@latest`,
  `extraFlags: ["--no-usage-statistics", "--no-performance-crux"]` defaults — see
  `buildServerArgs`), plus `--executablePath=<chromePath>` appended only when
  `config.chromePath` is non-empty **and** the flags list does not already
  carry `--executablePath`/`--executable-path`/`-e`.
- **Config passthroughs**: the config row keys `env`, `cwd`,
  `toolCallTimeoutMs`, `failOnStartupError`, `reconnect` pass through to the
  nested `dsh-mcp-client` bridge config verbatim; `chromePath` /
  `chromePaths` are ours (executable pin + `discoverChrome` candidate list).
- **Flag validation**: entries are execve'd argv items (no shell), so only
  control characters are rejected (`CONTROL_PATTERN = /[\x00-\x1f\x7f]/u`).
  Spaces inside a flag value (Windows-style paths) are therefore allowed.
  Rejected by `validateExtraFlags` through the settings `validate` hook; UI
  write failures surface on the card via `noteError`.
- **WSL interop: Windows `chrome.exe` is NOT supported.** Setting
  `chromePath`/`--executablePath` to a `/mnt/c/...` executable was tested
  end-to-end (`.probe/probe.mjs`, 2025-09-19) and fails:
  `chrome-devtools-mcp` connects with `pipe: true` (inherited fds 3/4), which
  the Windows-side process cannot receive across the WSL interop boundary
  (`Target.setDiscoverTargets: Target closed`); the WebSocket fallback reads
  `DevToolsActivePort` against `127.0.0.1`, unreachable across the WSL2 NAT
  bridge (`netstat` shows the port bound to the Windows loopback only). Keep
  the error surfaces generic — do **not** re-add Windows-path discovery.
- **Persistence boundary**: only `extraFlags` (last UI edit) and
  `recheckNonce` (re-check trigger) may land in `$DSH_HOME/settings.yaml`.
  Status (`lastError`, `chromeMissing`, `checkRevision`, `chromeVersion`) lives
  in the composition **base layer** — the `entry` object handed to
  `installSection` — held in memory, never persisted. Status reaches the
  client through the **base clone** that `describe()` attaches to every read
  (the frozen resolved `value` only folds the base in at commits, so
  base-only mutations are invisible there); the controller reads status from
  `snapshot.base`, falling back to `snapshot.value` only when a read carries
  no base layer. `extraFlags` keeps reading `value` (the persisted user layer
  wins). Checks run at registration via the nonce diff itself (`lastNonce`
  starts `undefined`) — no separate registration-time call.
- **Flag change = `fiber.update()`** on the nested mcp-client bridge
  (re-validates + restarts the bridge in place; a successful update clears
  the captured `lastError`). Never recreate the plugin row; never throw out
  of the settings `onChange` callback.
- **No host→client push for module plugins**: same constraint as the
  reference (`harness.handle` reserved; `settings/document-updated` fires
  only on raw user-section changes). The client's re-check action re-reads
  the shared describe mirror (`settingsScope.describe().load()`) every
  700 ms until the served `checkRevision` advances (20 s budget). The same
  mechanism covers dsh-start: the controller's first *ready* publish with
  `checkRevision === 0` arms a one-shot catch-up poll with the same budget
  (the registration-time check lands in the base layer after that first
  read), so a Chrome-less host lights the error dot without any user
  action. Each new `waitForCheck` supersedes the pending one by generation
  (a manual re-check settles the catch-up poll, never two loops).
- **Connection-error capture**: the bridge reports failures only through its
  own `ctx.logger` (reconnect warn lines, give-up errors, spawn failures).
  The plugin therefore creates its scope child with
  `ctx.extend({ logger: captureLogger(ctx.logger, noteBridgeLog) })` and
  mounts the bridge on that scope: bridge `warn`/`error` lines land in the
  base-layer `lastError` (first line, capped); the
  `reconnected and re-synced tools` info line clears it. Each captured line is
  also classified by `isChromeMissing` into the base-layer `chromeMissing`
  flag (see the known-error bullet). Our own logs stay
  on the unwrapped logger.
- **Tool-call error capture**: browser-level failures surface only as the
  calling agent's tool result, never on the bridge logger. The plugin
  additionally registers a plain `ctx.on("tools/post-execute", …)` listener
  (untagged listeners pass the tools-scoped waterfall filter globally, for
  every agent — production precedent: `dsh-hooks-codex`,
  `dsh-tool-fs-search`; no `tools` injection is needed, and a static
  `inject: ["tools"]` would risk a load-order cycle because our own nested
  bridge is what provides the tools); any settled result whose registered
  name is prefixed `mcp__<serverName>__` and carries `isError` writes
  `toolResultNote` into the base-layer `lastError` (`<tool> failed: <first
  text line>`), classified by `isChromeMissing` into `chromeMissing`; a
  successful chrome-tool call clears both, so the card reports
  current health. The listener body is wrapped in try/catch (warn only — a
  capture fault must never break a tool call) and returns `next()` unchanged.
  This complements, not replaces, the bridge-log capture above.
- **Known "executable missing" error**: the not-detected state is a
  distinguishable known error, held in the base layer as `chromeMissing`.
  It carries no dedicated UI: the card reports it exactly like any other
  failure — through the single red header status dot, whose `title` holds
  the full message. The flag alone also keeps the dot red after a
  bridge-update-success clear of `lastError` (`applyFlags` clears the
  captured error but deliberately not the flag); the tooltip then falls
  back to the short `chromeMissing` label. `isChromeMissing` owns the
  classification (ENOENT probe line, upstream "Could not find Chrome",
  "Failed to launch the browser process") and is applied on check failures,
  bridge-log captures and tool notes. A check that ran **no** probe (empty
  `chromePath` resolves `""`) must **not** clear `lastError` or
  `chromeMissing` — upstream discovery failed, silence is not health. Only
  a probed success or the bridge-reconnect line clears the flag.
- **Persisted flags seed the connection**: `readPersistedFlags(ctx)` reads
  the user layer (all-non-empty-string check only) before the first bridge
  spawn when the settings service is already up, so the initial connection
  — and every in-process reconnect, which reuses the bridge config — starts
  on the last saved flags.
- **Flags precedence** (highest first): UI selection (settings user layer) →
  `DSH_CHROME_MCP_FLAGS` (`FLAGS_ENV_VAR`, whitespace-separated list resolved
  through `launchEnvironmentOf(ctx)`, never raw `process.env`; invalid values
  fall back to the row config with a warning) → row config `extraFlags` →
  schema default.
- **Executable probe & discovery**: when `chromePath` is non-empty, the check
  spawns `chromePath --version` (scrubbed env, 15 s budget). ENOENT → "Chrome
  executable not found: <path>"; non-zero → first stderr/stdout line;
  success → the version line, served (never persisted) as `chromeVersion`.
  Empty `chromePath` runs `discoverChrome(candidatePaths)` — every candidate
  (row config `chromePaths`, default `defaultChromePaths()` mirroring
  upstream's stable-channel system locations) spawned `--version` until one
  runs: first success serves its version line, all-ENOENT rejects with the
  known not-found error "Chrome executable not found: no executable detected
  (checked: …)". Upstream only starts the browser **lazily**, on the first
  tool call (see browser.js `ensureBrowserLaunched` in the npx-cached
  `chrome-devtools-mcp`), so without the probe a Chrome-less host would show
  nothing until somebody calls a tool. Extra flags that already pin
  `--executablePath` or declare a connect mode (`--browserUrl` /
  `--wsEndpoint`) skip the probe. Never add WSL-side `/mnt/c` candidates.

## Client-bundle gotchas (imported from the reference, still true)

- React children must go in `props.children` (3rd `jsx()` arg is the `key`
  slot).
- Card renders only when its slot `key` matches a served settings namespace
  (`chrome-mcp`) — registration is unconditional, rendering is keyed.
- CSS is injected as a `<style>` tag from a const; no CSS modules at runtime.
- Snapshot-store hook name is derived: `hooks.chromeMcpCard` →
  `useChromeMcpCard` prop.
- The re-check poll owns a controller `pollTimer`: `dispose()` must clear
  it, and every `mirror.load().then` must re-check `disposed` before
  arming the next tick (a load can resolve after dispose).
- The flags editor is an uncontrolled textarea (`defaultValue`, `key` = the
  joined flags so an external change re-mounts it); writes split by lines →
  `controller.saveFlags(flags)` → `scope.set`. The `useRef` hook must keep
  the same identity across renders.
- Locale keys (`en`, tested in `client.test.mjs`): `title`,
  `description`, `flagsTitle`, `flagsHint`, `flagsPlaceholder`, `flagsSave`,
  `versionTitle`, `check`, `checking`, `docsMessage`, `statusError`,
  `statusOk`, `chromeMissing`, `readOnly`, `expand`, `collapse`. The docs
  paragraph renders
  `docsMessage` + a plain `<a>` whose label is the configuration URL. The
  header's single error surface is the status dot (`role="img"`, `aria-label`
  `statusError`/`statusOk`): `title` is the full error message, or the short
  `chromeMissing` label when only the known flag is set; no badge, no body
  error paragraph (see the known-error bullet).

## Testing conventions

- Cross-realm values (vm-materialized bundles): compare with
  `JSON.stringify`, not `deepEqual` (prototype mismatches).
- Client test materializes `lib/client.js` in a `node:vm` context with
  stubbed `window.__ModuleLoader__`, `document`, `react` (incl. `useRef`),
  `react/jsx-runtime`, and a stub settings scope — assert registration,
  exports, rendered tree (docs message/link, textarea editor, version row,
  error dot), and that editor/re-check writes hit the right settings fields.
- Host behavior: boot the plugin from source with `.smoke/overlay.yml` under
  an isolated `DSH_HOME` — `DSH_HOME=.smoke/home dsh web --patch
  .smoke/overlay.yml --port 8765 --no-open` (repo root). For failure paths,
  `.smoke/overlay-fake.yml` + `fake-npx`/`fake-chrome` booted with
  `dsh web --patch .smoke/overlay-fake.yml --port N --no-open`;
  watch `.smoke/args.log` for argv and the logs for captured bridge errors.
- Client test's vm sandbox needs `setTimeout`/`clearTimeout` (the re-check
  poll schedules against the browser globals).
- **Native-Chrome field test** (WSL, 2025-09): drive the real bridge with
  `.probe/field-test.mjs` (stdio MCP over `npx -y chrome-devtools-mcp@latest
  … --executablePath=/usr/bin/google-chrome`). On a live `dsh web` host
  nothing extra is needed — a tool-call roundtrip passed with default flags
  (upstream discovery picked `/opt/google/chrome/chrome`). Inside the agent's
  **file sandbox** Chrome cannot launch with the same command
  (`Target.setDiscoverTargets: Target closed`: the sandbox denies
  `/dev/shm` shared-memory + `~/.config` writes, and core-dumps on the
  crashpad failure) — this is an environment artifact, **never** "fix" it by
  demanding permission escalation. Run it sandbox-clean instead:
  `FIELD_SANDBOX_CLEAN=1 node .probe/field-test.mjs`, which redirects
  `HOME`/`npm_config_cache` into `.probe/home/` and `TMPDIR`/
  `XDG_RUNTIME_DIR` into `.probe/user-data/`, and adds the bridge pass-through
  args `--allow-unrestricted-paths` (1.9.0 otherwise sandboxes file-write
  tools to the OS temp dir) `--chromeArg=--disable-dev-shm-usage`
  `--chromeArg=--no-sandbox`. `--chromeArg=<flag>` is the only way to reach
  Chrome's argv: bare `--disable-dev-shm-usage`/`--no-sandbox` hit the
  yargs parser first (`Unknown arguments`, dropped).

## Install / dev notes

- On WSL with Windows-side pnpm, `dsh plugin add` fails
  (`ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED` — Windows pnpm cannot symlink
  WSL dirs). Manual install: symlink the package into
  `~/.dsh/profiles/web/node_modules/@comecaramelos/` **and** append its name
  to the profile manifest's `dsh.profile.bundles` (see README). Do not add a
  `dependencies` entry: the `file:` spec makes pnpm re-link and fail, and the
  bundle layer only needs the bundles entry (`resolveBundleDir` resolves
  through the profile's `node_modules`).
- Live-reload caveat: `patchReload: live` re-applies **patch config**; it
  does **not** re-import changed plugin JS. JS changes need a `dsh web`
  restart.
- `DSH_HOME=<dir>` is honored (dsh-home-paths): boot against an isolated
  home when the real settings must not be touched.
- **Shared-file hazard**: a second instance shares `~/.dsh/settings.yaml`
  with the live GUI (the `chrome-mcp` section) — a test flags write
  hot-relaunches the *live* instance's bridge. Restore immediately after.
