# AGENTS.md

DSH Chrome MCP plugin for DeepSeek Harness (DSH). Bridges the
[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
MCP server (`npx -y chrome-devtools-mcp@latest [extraFlags]`) with a Web GUI
card: the extra-flags rows list, the Chrome executable picker, Chrome-executable /
connection error reporting, and the upstream configuration-guide message.

## Layout

Two planes, each one entry file stating its surface with the behavior behind it
in dedicated modules — the same shape as the sibling plugin
`dsh-docker-desktop-mcp`.

- `src/index.ts` — host half **public surface** (TS, `tsconfig.json`,
  `module: NodeNext`). `npm run build` emits `lib/index.js` (ESM, `main`, plus
  `.d.ts`/maps): identity (`name`, `inject`), the zod `Config`/`SettingsSchema`,
  `apply(ctx, config)`, and the diagnostics/test-facing helpers re-exported
  from `src/host/*`.
- `src/host/*` — host behavior: `apply.ts` (wiring: controller + settings
  section), `controller/` (live state: base layer, bridge fiber, stderr-mode
  switching + announce, the serialized **executable run** (probe the saved rows
  + the row config + the selection, merge what exists into the rows, seed a
  first selection), bridge-log + tool-result captures — split by concern into
  `controller.ts` (the assembly + the public `createChromeMcpController`/
  `ChromeMcpController`/`ChromeMcpControllerDeps`) + `notes.ts`,
  `bridge-run.ts`, `runs.ts`, `windows-run.ts`, `persist.ts`, `captures.ts`,
  `commits.ts`, all sharing the internal `state.ts` (state + context) and
  re-exported by `index.ts`),
  `settings.ts` (namespace install, flags/stderr/executable validation, commit
  routing), `bridge.ts` (stdio argv + the stderr-capture spawn wrapper + bridge
  config + logger capture), `catalog.ts` (the saved-executable **rows**: id/name
  rules, normalize, merge-by-id, label), `discovery/` (the candidate list —
  rows → row config → selection, deduped in that order — and the `--version`
  probe that answers for every candidate — split into `candidates.ts`, `probe.ts`,
   `scan.ts`, re-exported by `index.ts`), `flags.ts` (extra-flags validation,
  the executable-path flags folded out of the argv + connect-mode predicates),
  `platform.ts` (the two pure predicates the Windows-executable notice keys on:
  is this host WSL, is the selection a Windows binary), `windows.ts` (the
  **Prelaunch Windows Chrome** run: locate the Windows-side binary, TCP-sample the
  prereq ports, pick the first free debugging port, launch through the interop
  mount with a Windows-native profile (`windowsChromeProfileDir`), refresh the
  workspace `.chrome` view link on success (`linkWindowsChromeProfile`), wait
  for the port to bind, and answer with
  the connect address — every half injectable so tests never need the real
  machine), `tool.ts` (the plugin-registered `prelaunch_windows_chrome` tool —
  the MCP-side trigger of the same run, no arguments, driving the controller's
  `prelaunchWindowsChrome`; registration rides `ctx.effect` + lazy
  `ctx.inject(["tools"])`, so an HMR reload always disposes the prior
  registration and the tools plane is never touched at load order), `values.ts`
  (precedence
  resolution + persisted reads, including the one-time read of the **legacy**
  hand-typed path list), `status.ts` (error classification + tool-result notes),
  `schema.ts`, `constants.ts`, `types/` (split into `stderr.ts`/`config.ts`/
   `executable.ts`/`windows.ts`/`settings.ts`/`plugin.ts`, re-exported by
   `index.ts`), `plugin-meta.ts`.
- `src/client/*` — browser half **source** (TS, ordinary ESM modules; built by
  `scripts/build-client.mjs`, which typechecks with `src/client/tsconfig.json`
  (`noEmit`) and bundles `src/client/index.ts` with esbuild into the single
  CJS-shaped **factory bundle** `lib/client.js` (the `./client` export). The
  loader contract is preserved through esbuild's `banner`/`footer`, so the emit
  stays `window.__ModuleLoader__.load({ id, factory: (require) => … })`; the
  four shell-seeded modules stay external (`react`, `react/jsx-runtime`,
   `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-primitives`).
   Their types come from two places: `react` +
   its `@types/*` is a devDependency (so `import … from "react"` resolves
   normally through `node_modules`), while `@deepseek-ai/dsh-client-store` and
   `@deepseek-ai/dsh-client-ui-primitives`
   exist only in the loader's module table and are typed structurally in
   `src/client/shell-modules.d.ts`. Modules: `index.ts` (surface: `apply`,
   `inject`, the poll budgets), `apply.ts` (mount: injects the
   stylesheet via `styles/index.js`, registers locales, controller, card
   slot), `controller/` (card
   snapshot store + write actions + the executable-run revision poll — split into
   `controller.ts` (the class) + `snapshot.ts`/`read.ts`/`budget.ts`, re-exported by
   `index.ts`),
   `catalog.ts` (the client mirror of the saved executable rows: id/name rules,
   normalize, label — pinned against the host module's rules by the same
   fixtures `test/parse.test.mjs` uses), `card/` (the widget, split the way the
   reference splits its card: `index.ts` assembles the body in the reference's
   order — the read-only line, the picker (its disclosure body carries the two
   executable-block actions on one `linkButtonRow` line: **Fetch executables**
   and **Prelaunch Windows Chrome**, the button enabled/disabled/busy answered
   entirely by the served `windowsChromeStatus` — a local run-in-flight overlay
   keeps it busy until the revision counter settles), the interop notice, the flags rows,
   the stderr toggle, the error paragraphs, the candidate dialog — over the
   header carrying the status dot; `view.ts` derives what renders from the served
   snapshot; `run-actions.ts` holds the imperative fetch + Windows run logic and their
    busy/dialog/clock state (`useRunActions`), so `index.ts` stays body composition;
    `picker.ts` the executable block (the pill's `Menu`, the saved-rows
   disclosure, the fetch action); `rows.ts` the one row list both catalogs
   render — a bordered box carrying its field(s) and the delete control, the
   empty line and the add control, with the reference card's `editing` map read
   as a local draft overlay: typing does not persist, a blur/Enter commits the
   whole list, a delete persists on the spot, an added blank row stays local
   until it carries a value, and a host push replaces an idle draft;
   `dialog.ts` the dialog the fetch action opens; `flags.ts` the extra-flags
   block — the very same rows read through the single field a flag carries
   (`props.saveFlags`), with **Restore defaults** and **Flags WSL** riding as
   the list's own append actions (one restore list, one recommended-flags list,
   both host-served); `toggle.ts` the stderr switch; `icons.ts` the inline SVG
   paths), `styles/` (`ChromeMcpCard.module.css` + `index.ts` injector +
   `css-modules.d.ts` ambient types), `locales/*`, `plugin-meta.ts`. The
   executable picker and the stderr toggle are the two shell primitives used:
   a `Menu` anchored on a pill (the same idiom as the reference's profile
   picker) and the reference's `Switch` for the "Reduce log output"
   control (`props.toggleStderr`). Both catalogs' rows are plain
   `<input type="text">` fields and icon buttons, not shell fields — the two
   blocks are one widget shape, differing only in how many fields a row carries.
   The stylesheet follows the same split: every
   rule the two cards share (card, header, body, `field`/`fieldRow`, `selector`,
   `catalog`/`catalogEntry`/`catalogRow`, the dialog block, the buttons) is the
   reference's rule verbatim, and everything plugin-specific rides as an
   extension (the docs link, the flags rows' single-field column and its
   monospace field, the probe result line, the interop
   notice, the pill's ellipsis label) — there is no shared CSS package, the two
   stylesheets simply stay identical where they overlap.
- `tsconfig.json` / `src/client/tsconfig.json` — host emit / client typecheck.
  `npm run build` runs both halves (`npm run build:client` is the browser half
  alone); `npm test` builds first, so the emitted `lib/*.js` are always what
  the tests load (`main`/`./client` point at `lib/`, never `src/`).
- `test/*.test.mjs` — plain `node:assert` scripts, one file per concern, run by
  the built-in runner (`npm test` → `npm run build && node --test
  "test/*.test.mjs"`). They are scripts, not `node:test` cases: no `test()`
  wrappers, no assertions library.
- `cordis.patch.yml` — package-root **bundle patch layer**: inserts the
  `mcp-chrome` row (with the plugin `name`) so `dsh plugin … add` activates
  the bridge without a manual profile patch. Declared as
  `dsh.bundle.patch` in `package.json` and listed in `files` (must stay in
  the tarball). Row `id` / `name` / `serverName` are a public contract:
  a profile row with the same `id` fully replaces this config, so renaming
  them is breaking.
- `assets/prelaunch-windows-chrome.html` — the one **static asset** the plugin
  ships: the page a Windows Chrome launch opens in the window it just started
  (see the landing-page clause of the Prelaunch bullet below). It is read
  host-side and written out through the interop mount, so it is a **file**, not
  a module: nothing imports it, it is never part of `lib`, and `files` lists the
  whole `assets` directory so it stays in the tarball. It carries no external
  reference (no script, no stylesheet, no font, no remote image) so the opened
  window is a description of the session and never something that calls out on
  its own — the `icon.svg` artwork rides inside it twice, as pure inline SVG:
  the `span.mark` in the page header, and the tab favicon as an encoded
  `data:image/svg+xml` link.
- `.smoke/` — manual end-to-end fixtures: the `fake-npx` + `fake-chrome`
  shims and their `--patch` overlays. The `fake-npx` shim records every
  bridge spawn it sees, so the argv a run actually used stays recoverable
  from the fixtures themselves; every log a run leaves behind is throwaway
  local state, never checkout content.

## Hard constraints (do not break)

- **One settings namespace per host**: `chrome-mcp` is fixed, not derived
  from `serverName`. A second instance must fail loud, not alias.
- **Bridge argv shape is fixed**: `npx -y <package> [extraFlags]`
  (`command: npx`, `package: chrome-devtools-mcp@latest`,
  `extraFlags: ["--no-usage-statistics", "--no-performance-crux"]` defaults — see
  `buildServerArgs`), plus `--executablePath=<path>` appended whenever the
  **effective selection** is non-empty (the only source of that flag — see
  the executable-selection bullet). This is the **logical** invocation the
  child always runs. In the default `"log"` stderr mode it is
  **not** spawned raw: `buildBridgeSpawn` wraps it in a `sh -c` script that
  `exec`s the argv positionally (the child never sees the wrapper) and sends
  only stderr to a per-spawn log file, stdout staying the MCP protocol stream.
  In `"console"` mode (the card's toggle off, or a platform with no POSIX
  shell) the logical argv is spawned raw. The argv tail itself is unchanged.
- **Config passthroughs**: the config row keys `env`, `cwd`,
  `toolCallTimeoutMs`, `failOnStartupError`, `reconnect` pass through to the
  nested `dsh-mcp-client` bridge config verbatim; `chromePath` /
  `chromePaths` are ours (`chromePath` is the row-config **fallback source** of
  the executable for a host whose card never picked one, `chromePaths` the
  candidate list a run folds in after the saved rows),
  and `bridgeStderr` / `bridgeStderrLog` steer the stderr wrapper (mode + log
  path) rather than any nested-bridge field.
- **Flag validation**: entries are execve'd argv items (no shell), so only
  control characters are rejected (`CONTROL_PATTERN = /[\x00-\x1f\x7f]/u`).
  Spaces inside a flag value (Windows-style paths) are therefore allowed.
  Executable-path flags (`--executablePath`, `--executable-path`, `-e`, matched
  by `EXECUTABLE_PATH_FLAG`) are rejected outright: the picker owns that flag,
  so a **legacy** row config that pinned it that way is folded into the
  row-config source of the selection (`extractExecutablePathFlag`) and stripped
  out of the argv (`stripExecutablePathFlags`) — it never reaches the bridge as
  a second source of truth. All of it runs through `validateExtraFlags` inside
  the settings `validate` hook; UI write failures surface on the card via
  `noteError`.
- **Browser switches travel as `--chromeArg`, not as bare flags.** The bridge's
  argv is parsed by a strict yargs parser that knows only its own option names,
  so a bare `--no-first-run` / `--no-default-browser-check` entry is reported on
  stderr as `Unknown arguments: --firstRun,--defaultBrowserCheck` and **dropped**
  — it never reaches the launched browser (measured against
  chrome-devtools-mcp 1.10.1). Upstream's `chromeArg` option (an `array`)
  forwards extra switches to Chrome, so a user who wants the first-run UI or the
  default-browser check suppressed must write `--chromeArg=--no-first-run` /
  `--chromeArg=--no-default-browser-check`: `parseArguments` turns that argv into
  `chromeArg: ["--no-first-run", "--no-default-browser-check"]` and
  `BrowserManager.#launch` pushes them into the browser args (`--no-first-run`
  is also already in the upstream default launch args). The shipped
  `DEFAULT_EXTRA_FLAGS` deliberately does **not** carry these entries — a bare
  flag would read as an ordinary valid extra flag yet silently do nothing, and
  adding the `--chromeArg=` spellings would be a behavior change beyond the
  plugin's remit; they belong to the user (or the card's Restore defaults
  control) explicitly. The same rule keys the other card control, **Flags WSL**:
  its recommended list is the single entry
  `--chromeArg=--remote-debugging-port=9222` (never the bare
  `--remote-debugging-port`, which the parser drops), served from the host
  through the static `wslExtraFlags` base-layer mirror exactly the way
  `defaultExtraFlags` serves the defaults, so the card carries no copy of the
  recommended list either. The second entry the list once recommended —
  `--user-data-dir=.chrome` — was **measured out**: it was meant to keep the
  debug profile inside every Workspace, but a Windows `chrome.exe` profile
  directory cannot live there (neither the WSL checkout nor the
  `\\wsl.localhost` mount carries the profile locks — 9P), so the
  **Prelaunch Windows Chrome** run launches with its own Windows-native
  profile under `%LOCALAPPDATA%` and the entry is no longer recommended.
  **Flags WSL is the manual path** since the Windows button exists: it hands
  the debug-port flag to the bridge for what you launch yourself, while the
  run keeps owning the Windows-native profile and the saved connect entry.
- **WSL interop: Windows `chrome.exe` is NOT supported.** Setting
  `chromePath`/`--executablePath` to a `/mnt/c/...` executable was tested
  end-to-end (2025-09-19) and fails:
  `chrome-devtools-mcp` connects with `pipe: true` (inherited fds 3/4), which
  the Windows-side process cannot receive across the WSL interop boundary
  (`Target.setDiscoverTargets: Target closed`); the WebSocket fallback reads
  `DevToolsActivePort` against `127.0.0.1`, unreachable across the WSL2 NAT
  bridge (`netstat` shows the port bound to the Windows loopback only). Keep
  the error surfaces generic — do **not** re-add Windows-path discovery.
  Re-confirmed 2025-09-21 (bridge 1.9.0, WSL2 NAT): the binary **does** execve across interop — `chrome.exe --version`
  exits 0 — but every tool call fails `Target.setDiscoverTargets: Target
  closed`. The "seems to work" trap: with a live Windows browser the check
  probe (`--version`) prints "Opening in existing browser session" and
  exits 0, so the executable probe reports it healthy;
  `--remote-debugging-address=0.0.0.0` is ignored (still loopback-bound,
  `netstat` confirms), killing the `--browserUrl=<host-ip>` idea too.
  Adding a debug port does **not** rescue launch mode: upstream always
  spawns with `--remote-debugging-pipe=3,4`, which Windows `chrome.exe`
  cannot open across interop ("Remote debugging pipe file descriptors are
  not open", exit 13; bridge reports `Code: 21`) — `--chromeArg`
  debug-port flags never get a live browser to talk to. The only working
  Windows path is **connect mode** (`--browserUrl`/`--wsEndpoint` against
  a manually launched Windows Chrome carrying `--remote-debugging-port`)
  **and** Windows loopback reachable from WSL — false under NAT, true
  with `networkingMode=mirrored` in `~/.wslconfig` (supported: WSL 2.6.3
  / Win 11 26200) but `wsl --shutdown` is required. Keep launch-mode
  Windows paths unsupported in the card.
- **The WSL + Windows-executable notice.** The two probes that answer it are
  pure and injected — `isWindowsSubsystemForLinux` (Linux platform plus the WSL
  markers; inside a host the **launch environment** is authoritative, resolved
  through `launchEnvironmentOf(ctx)` exactly like `FLAGS_ENV_VAR`, and the
  `/proc/sys/fs/binfmt_misc/WSLInterop` marker is only the fallback for a bare
  call) and `isWindowsExecutablePath` (a `/mnt/<drive>/…` mount, a Windows
  spelling, or the PE suffix). Both have to be true at once, so the state is
  keyed on the **selection** in `noteSelection`, never on a probe: a Windows
  binary answers `--version` correctly, so the pill and a healthy probe are
  exactly what a broken Windows selection looks like. The base layer carries it
  as `wslWindowsExecutable`; the card renders the **static** copy
  (`wslWindowsTitle` / `wslWindowsNote`, inside `STYLES.notice`, `role="note"`)
  while the flag is true and nothing else about the body changes. It is a
  notice, not an error: the dot stays the only error surface, and the flag is
  never folded into `lastError`/`chromeMissing` (this is missing configuration,
  not a failure). The host also logs the pointer once (`warn`) when the state
  turns on, so a headless host learns it too; `wslNoticeShown` keeps it to one
  line however often the selection churns.
- **The Prelaunch Windows Chrome run.** Connect mode is the only working Windows
  path (see the bullet above), so the card turns the manual recipe into one
  host-driven run: the **Prelaunch Windows Chrome** button (the executable block,
  next to **Fetch executables**) triggers `runWindowsChrome`, queued on the same
  one-run-at-a-time promise chain as the executable run. The run's **other**
  trigger is MCP-side: `./tool.ts` registers `prelaunch_windows_chrome` — no
  arguments, the same run through `controller.prelaunchWindowsChrome`, the same
  answers, but returned as the tool's text result instead of only the card
  state. Unlike the button it persists **nothing** (the tool call is the
  trigger itself, so there is no nonce that a later boot could fire), and it
  registers lazily (`ctx.effect` wrapping `ctx.inject(["tools"])`) for the same
  load-order reason the `tools/post-execute` listener avoids a static
  injection. `./windows/` owns the whole sequence — locate the Windows-side binary (`WINDOWS_CHROME_CANDIDATES`,
  Chrome first, Edge as the alternative; **located host-side only**, never
  offered as a picker candidate), sample the prereq ports (`135`/`3389` —
  Windows-side answers are the reachability answer; a local listener answering
  is *port taken*, never host reachability), pick the first free port of
  `WINDOWS_CHROME_PORT_POOL`, launch by **exec'ing the located executable
  through the interop mount** — argv `<exe> --remote-debugging-port=<P>
  --user-data-dir=%LOCALAPPDATA%\dsh-chrome-mcp\.chrome[-<P>]
  --no-first-run --no-default-browser-check [landing-file-url]`, working
  directory `C:\Windows` (`WINDOWS_CHROME_START_CWD`, never a UNC cwd) — and wait
  for the port to bind (~10 s). The trailing positional URL is the **landing
  page** (`./landing.ts`, `WINDOWS_CHROME_LANDING_*`): the packaged
  `assets/prelaunch-windows-chrome.html` rendered with the run's own answers (the
  port, the connect address, the profile directory), written through the interop
  mount beside the profile directory as `prelaunch-<P>.html` and handed to the
  browser as a `file:///C:/…` URL — the **Windows** spelling, because the mount
  path is Linux-side and `chrome.exe` reads no such path. It exists so a window
  that opens for no visible reason states what it is for: opened by this plugin
  from DSH so the bridge can drive it across the boundary, with the profile it
  profiles and the port it answers on. No placeholder stands in for it —
  `example.com` is exactly the page that must **not** be used (its own notice
  forbids using it for automation and tests). It is *prose*, never a
  precondition: every landing failure (no packaged page, no LOCALAPPDATA answer,
  a failing write) answers `""`, which drops the entry out of argv and leaves the
  launch exactly as it was; it is never opened on the re-attach branch (nothing
  was launched, so no window was added), and the run's state never turns on it.
  Like every other machine half it is injectable (`landing`), so the unit run
  writes nothing.
   The profile is **Windows-native**, rooted at `%LOCALAPPDATA%`
  (`windowsChromeLocalAppData`, through the Known Folder API because the
  interop hand-off drops `%LOCALAPPDATA%` from the inherited environment)
  under `dsh-chrome-mcp\`, with the per-port leaf — the WSL checkout cannot
  host it (9P cannot carry the SQLite/singleton locks, so every table lands
  zero bytes and Chrome shows "an error occurred while opening your profile"
  every launch — measured live 2026-10-04 against Chrome 154). A successful
  run refreshes the workspace **view** link `windowsChromeProjectDir`/.chrome
  pointing at that Windows directory (`linkWindowsChromeProfile`: a WSL-side
  symlink, so Windows never sees the link, but the checkout reads the profile
  back through it; a real directory already sitting at the view spot is kept,
  the link never clobbers it, and the kept case logs once);
  `windowsChromeProjectDir` resolves the row-config `cwd`, else the **live
  session's workspace** (`ctx.get("sessions")` → a live session's `header.cwd`,
  most recently created wins), else `process.cwd()`. Two measured
  field notes behind the shape, both measured live 2026-10-06: the `cmd.exe /c start`
  wrapper is **not** used — under interop that wrapper's process does not exit
  while the GUI browser lives, so the launch step could never answer and the
  card sat in "launching" until the spawn timed out (a silent 30 s) while the
  window was already open; the direct `execve` accepts in ~3 ms and binds the
  port in ~1 s. And the last two argv entries are not optional: a brand-new
  profile directory **is** a first run, so without them Chrome opens the
  welcome tab (`chrome://intro`) and the default-search-engine chooser — user
  steps connect mode never clicks past (`WINDOWS_CHROME_FIRST_RUN_FLAGS`,
  carried on Chrome's own argv — the bridge-argv rule above is about the
  `npx` parser and does not apply to a launch the bridge is not in). Success
  writes `--browserUrl=http://127.0.0.1:<P>`
  into the **saved** flags through `withBrowserUrlFlag` — replace-by-key, the
  one connect entry never duplicated, **and the local
  `--user-data-dir` rows dropped**: upstream refuses `userDataDir` and
  `browserUrl` in the same argv (`Arguments userDataDir and browserUrl are
  mutually exclusive`, measured live 2026-10-04 — a saved Flags-WSL row kept
  next to the run's connect entry leaves the bridge unspawnable). The connect
  entry is *user* state and persists, and the bridge takes it through the
  ordinary `fiber.update()` flag path. The run answers the whole state union through the
  base layer (`windowsChromeStatus`), and each half is injectable
  (`WindowsChromeRunOptions`: `exists`/`reachable`/`start`/`currentFlags`…)
  because the real half opens sockets and spawns through interop — the same
  injection rule `platform.ts` follows. The answer lands in the base layer, not
  in the click's promise: like every executable action it bumps the revision
  counter the client polls. Three things it never does: launch Windows Chrome
  into **launch mode** (`--executablePath` stays out of argv entirely while a
  connect flag is present — `buildServerArgs` drops it), edit `~/.wslconfig`
  (prereq checks *read*, never write), or close a Windows browser it started —
  the browser stays user-owned and a connect-mode bridge survives it
  restarting.
- **Persistence boundary**: only the user-authored fields may land in
  `$DSH_HOME/settings.yaml`: `extraFlags` (last UI edit),
  `refreshExecutablesNonce` (the card's **Fetch executables** trigger),
  `openWindowsChromeNonce` (the card's **Prelaunch Windows Chrome** trigger — the
  same nonce idiom, and a *persisted* value must never drive a launch: the
  first commit folds the stored nonce without queueing the run, only a later
  diff fires it),
  `stderrMode` (the "Reduce log output" toggle: `"log"` /
  `"console"` / `""` = follow the row config), `chromePath` (the executable the
  picker selected — or the host seeded once) and `executables` (the saved
  executable **rows**, `{ id: path, name: label }`, capped at
  `CATALOG_MAX_LENGTH`). The rows are the one user field the host *also* writes:
  a run merges every candidate path it found into the stored list (new ids only,
  nameless, so a user-given name survives — `mergeEntries`), which is what makes
  the picker's list grow out of the host's own discovery. `chromeCustomPaths`
  stays in the schema as the **legacy** hand-typed MRU: a first run folds it into
  the rows once and never consults it again (the host reads it through
  `readPersistedCustomPaths`, the client never writes it).
  Status (`lastError`, `chromeMissing`, `executableDiscoveryRevision`,
  `chromeVersion`, `executableStatus`, `effectiveChromePath`,
  `effectiveSource`, the `wslWindowsExecutable` mirror of the WSL +
  Windows-executable state), the static `rowStderr` mirror of the row config,
  the static `defaultExtraFlags` mirror (the canonical defaults list the card's
  **Restore defaults** control appends), the static `wslExtraFlags` mirror
  (the recommended WSL ↔ Windows flags the card's **Flags WSL** control appends),
  the `windowsChromeStatus` mirror of the Windows run (`{ state, port, error }`,
  states `off`/`launching`/`connected`/`unreachable`/`not-found`/`launch-failed`
  /`not-applicable` — the last one read off the host at registration, not after
  any action) and the `carriesConnectionMode` mirror of whether the bridge
  launches with a connect flag (the same `flagsSkipCheck` answer the probe skip
  keys on, now served so the card can relabel the pill without a probe)
  live
  in the composition **base layer** — the `entry` object handed to
  `installSection` — held in memory, never persisted. Status reaches the
  client through the **base clone** that `describe()` attaches to every read
  (the frozen resolved `value` only folds the base in at commits, so
  base-only mutations are invisible there); the controller reads status from
  `snapshot.base`, falling back to `snapshot.value` only when a read carries
  no base layer. The user-authored fields keep reading `value` (the persisted
  user layer wins), `rowStderr` keeps reading `base`. The registration run
  fires off the first commit's nonce diff (`lastRunSeen` starts
  `undefined`) — no separate registration-time call.
- **Flag change = `fiber.update()`** on the nested mcp-client bridge
  (re-validates + restarts the bridge in place; a successful update clears
  the captured `lastError`). Never recreate the plugin row; never throw out
  of the settings `onChange` callback. The call is always chained on the
  bridge fiber's readiness — `Promise.resolve(bridge).then(() => bridge.update(…))`
  — because cordis restarts a fiber **only from `ACTIVE`**: an `update` issued
  while the bridge's first connection is still loading (`state = LOADING`) is
  stored and then dropped by the load in flight, and it still settles `OK`,
  so the bridge silently keeps the argv it first spawned with. This is what
  makes the **boot-time** switch to connect mode (the first commit's saved
  `--browserUrl` flag) actually land instead of losing the connect flags until
  the next real change. It is the `restartBridge` helper, used by every
  flags/executable/stderr switch.
- **No host→client push for module plugins**: same constraint as the
  reference (`harness.handle` reserved; `settings/document-updated` fires
  only on raw user-section changes). An action therefore re-reads the shared
  describe mirror (`settingsScope.describe().load()`) every 700 ms until
  `executableDiscoveryRevision` advances (20 s budget) — one counter for every
  executable action, because one **run** (probe the saved rows + the row config +
  the selection, merge what exists into the rows, seed when silent) sits behind
  all of them: Fetch executables and a selection change both wait on the same
  counter their run bumps. The same mechanism covers dsh-start: the controller's
  first *ready* publish with the revision still 0 arms a one-shot catch-up poll
  with the same budget (the registration run lands in the base layer after that
  first read), so a Chrome-less host lights the error dot without any user
  action. Each new `waitFor` supersedes the pending one by generation (a manual
  action settles the catch-up poll, never two loops).
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
- **Bridge stderr capture ("Reduce log output")**: the MCP stdio transport
  spawns `npx` with inherited stderr, so every startup/progress line lands on
  the dsh console. The default mode `"log"` wraps the spawn in a `sh -c`
  (`buildBridgeSpawn`) that `exec`s the logical argv positionally and redirects
  **only stderr** to a per-spawn log file (`bridgeStderrLogPath`: one private
  directory per host process, created with `mkdtemp` in mode `0700` and holding
  `<serverName>-bridge.log` — never a name predictable from `serverName` +
  `pid`, which a second local account could plant; or a
  non-empty `bridgeStderrLog` override); stdout keeps flowing as the MCP
  protocol stream.
  The wrapper is transparent to the child (`exec "$GATEWAY" "$@"`). It must
  `exit 127` with a message ON stderr when the executable is absent (otherwise
  the transport reports a bare code and the reason is buried in the log). On a
  non-POSIX platform (or with no `sh`) the redirect is impossible: spawn the
  raw argv and set `fallback` ("platform"/"shell") so `noteStderr` warns once.
  Effective mode = UI `stderrMode` → row config `bridgeStderr`; the card's
  toggle persists it and, like a flag change, switches **in place** with
  `fiber.update()` (the wrapper is fixed at spawn). It is the shell `Switch`
  primitive, checked only when the host resolves
  "log" — never a phantom state.
- **Executable selection — there is no "auto" mode**: the picker owns the
  executable, and the client never sees a mode setting. The **effective
  selection** resolves `chromePath` (the persisted user layer — UI-written, or
  seeded once by the host) → row-config `chromePath` (or, from a legacy row
  config, a `--executablePath` found in its `extraFlags`: folded into this
  source, stripped from argv, announced once) → nothing. No auto source, no
  auto state, no per-boot resolution: the *only* automatic step is the first
  run on a host whose both layers are silent **seeding** one discovered
  executable into the persisted `chromePath`, written once (`persistChromePath`
  → settings `mutate`). A fixed path that later disappears stays fixed and
  reads broken (the fetch dialog carries the failure line for it, the dot goes
  red) — it is never silently re-resolved, so what the pill claims keeps being what the
  bridge runs.
  One **executable run** does the work (`runExecutableDiscovery`, queued through
  one promise chain and followed by the probe of the selection): it probes every
  candidate of `chromeExecutableCandidates` (the saved rows → row `chromePaths` →
  the selection, deduped in that order), publishes the whole answer list as
  `executableStatus` (`{ path, version, error }`, keyed by path) so the picker
  always says what exists — a runnable candidate answers with its `--version`
  line, a broken one keeps its place carrying the failure line instead of
  vanishing into the dot, and one that is simply absent spawns nothing and answers
  nothing (`presentOnDisk`, no candidate spawns a directory or a `realpath`
  duplicate) — then merges every path it *found* into the saved rows and bumps
  `executableDiscoveryRevision` once. Every executable action goes through that
  run: the **Fetch executables** button triggers it (`refreshExecutablesNonce`),
  and a selection change re-runs it behind the write, so the pill's own answer
  lands with the rest.
  Connect-mode flags (`--browserUrl` / `--wsEndpoint`, mirrored out as the base
  layer's `carriesConnectionMode`) skip the probe — there is no local executable
  to check. The card reads the same mirror to **relabel the pill**: while a connect
  flag carries the bridge, the pill reads `connectModeLabel` (the `connectMode`
  address the run answered with when it has one), the picker's hint says the
  bridge connects instead of launching, and the pill stays openable —
  because it does not claim a local selection the bridge is not running (its
  label is the connect address), while the saved rows stay reachable and
  editable so the selection the bridge resumes with is one click away. A path the host must
  **never exec** skips it too, answered by the `blockedForPlatform` callback
  threaded through `scanChromeExecutables` / `discoverChrome`
  (the controller supplies it: WSL host **and** a Windows-executable path →
  `WSL_WINDOWS_LAUNCH_ERROR`). That second skip is not a nicety:
  `chrome.exe --version` answers by *attaching to the Windows browser session*,
  and attaching **starts a browser instance** (measured 2026-09-30 on WSL2 +
  Google Chrome 153 — the probe spawns the browser process plus its crashpad
  handler, while no tool call could ever drive what it started). A blocked
  candidate therefore keeps its place in the answer list carrying that reason —
  it is not `presentOnDisk`-filtered, because what it *would* do is what gets
  reported, not whether it is there — and it answers no version, so it never
  seeds as a runnable executable and the picker shows it tagged unavailable. A
  blocked *selection* resolves `""`, which clears nothing: the card's
  `wslWindowsExecutable` notice stays the whole report, and the probe result line
  goes blank instead of quoting a version the run did not answer with. Off WSL
  the very same path is probed like any other (the skip is platform-keyed, not a
  rule about how Windows paths look); pin flags no longer exempt anything.
  Upstream starts the browser **lazily**, on the first tool call (see
  `ensureBrowserLaunched` in the npx-cached `chrome-devtools-mcp`), which is why
  the host probes eagerly instead of waiting for a tool call. Never add
  WSL-side `/mnt/c` candidates — the picker must never offer what cannot run.

## Client-bundle gotchas (imported from the reference, still true)

- React children must go in `props.children` (3rd `jsx()` arg is the `key`
  slot).
- Card renders only when its slot `key` matches a served settings namespace
  (`chrome-mcp`) — registration is unconditional, rendering is keyed.
- Stylesheets are authored as **CSS Modules** (
  `src/client/styles/ChromeMcpCard.module.css`): the build's `dsh-css-modules`
  esbuild plugin validates with postcss, minifies with esbuild's CSS pipeline,
  scopes every class name to `<hash>_<local>` (hash derived from the
  repo-relative path), and inlines the minified text plus the class map into
  the bundle. The card imports the map (default export); `styles/index.ts`
  injects the `cssText` once as a tagged `<style>` element, called from
  `apply()` — never from a module body, so importing a module for its class
  names never has DOM side effects. No literal class names in the sources.
- Snapshot-store hook name is derived: `hooks.chromeMcpCard` →
  `useChromeMcpCard` prop.
- The poll loop owns a controller `pollTimer`: `dispose()` must clear
  it, and every `mirror.load().then` must re-check `disposed` before
  arming the next tick (a load can resolve after dispose). One loop runs at
  a time: every wait takes the same generation counter, so the action the
  user clicks settles the catch-up poll instead of starting a second one.
- The flags block renders the same rows list as the executable block (`./rows.ts`),
  read through the single field a flag is: the served list is `state.extraFlags`
  mapped one field per row, a blur/Enter commits the whole list through
  `controller.saveFlags(flags)` → `scope.set`, a delete persists on the spot, and
  **Add flag** appends a local blank row. The write side drops a row left blank
  (the host rejects an empty entry) and folds a repeated flag to its first row —
  exactly what the saved executable rows do with a repeated id. **Restore
  defaults** is one list action: it keeps every flag the rows carry and
  appends only the defaults the host serves through `state.defaultExtraFlags`
  (the base-layer mirror) that are not already present — the card carries no copy
  of the defaults list, and the control never drops a flag. Disabled when the host
  serves no defaults list. **Flags WSL** is the other list action and follows the
  same append-only merge rule against the other host-served list
  (`state.wslExtraFlags`, the recommended WSL ↔ Windows flags served by the host's
  `wslExtraFlags` base-layer mirror): it keeps what the rows carry and appends
  only the recommended ones still missing, disabled when the host serves no
  recommended list. The two controls ride one `linkButtonRow` line so the block
  keeps a single-action rhythm. Neither list holds a `useRef`: both read their draft
  from `useState`, so the hook count has to stay stable across renders either way.
- Locale keys (`en`, tested in `client.test.mjs`): `title`, `description`,
  `executableLabel`, `executableHint`, `executableNone`, `executableRows`,
  `executableIdLabel`, `executableIdPlaceholder`, `executableNameLabel`,
  `namePlaceholder`, `addExecutable`, `removeExecutable`, `fetchExecutables`,
  `fetching`, `executableEmpty`, `dialogExecutablesTitle`,
  `dialogExecutablesDescription`, `dialogEmpty`, `searchExecutables`,
  `selectAll`, `addSelected`, `candidateSaved`, `close`, `cancel`,
  `unavailableSuffix`, `wslWindowsTitle`, `wslWindowsNote`, `probing`,
  `versionLabel`, `probeJustNow`, `probeSecondsAgo`, `probeMinutesAgo`,
  `probeHoursAgo`, `flagsTitle`, `flagsHint`, `flagsEmpty`, `flagsRows`, `flagsValueLabel`,
  `flagsValuePlaceholder`, `addFlag`, `removeFlag`, `flagsRestore`,
  `flagsRestoreTitle`, `flagsWsl`, `flagsWslTitle`,
  `openWindowsChrome`, `openWindowsChromeTitle`, `openWindowsChromeBusy`,
  `windowsChromeNotWsl`, `windowsChromeNotFound`, `windowsChromeUnreachable`,
  `connectModeLabel`, `connectModeHint`,
  `reduceLabel`, `reduceTitle`, `reduceHint`, `docsMessage`, `docsLinkLabel`,
  `statusError`, `statusOk`, `chromeMissing`, `readOnly`, `expand`, `collapse`.
  No key names an automatic mode — there is none, and no key names a source tag:
  what the pill and the rows show is the saved **name**, falling back to the
  path. The picker's copy is the `executableLabel`/`executableHint` pair, the
  `executableRows` disclosure head with its row count, the row field labels +
  placeholders, and the `addExecutable` / `removeExecutable` /
  `fetchExecutables` (busy: `fetching`) actions; an empty list reads
  `executableEmpty`. The fetch action opens the reference's **candidate dialog**
  (`dialogExecutablesTitle` + `dialogExecutablesDescription`, a
  `searchExecutables` field, one `candidate` row per path the run answered for
  carrying its note — a version line, a failure line, or `candidateSaved` for
  what the rows already carry — plus `selectAll`, `addSelected` and `cancel`):
  this is where a run's per-path answer reads, so a row carries no status line of
  its own. The probe result line (`role="status"`, under the rows) is what makes
  a run visible on a healthy host: a host that answers with the version already
  on screen leaves nothing else to look at, so the line reads `probing` while the
  run is in flight and ages it (`probeJustNow` / `probeSecondsAgo` / … from the
  card's local clock, ticked by `PROBED_AGE_TICK_MS`) once it settles. It renders
  only when the version is non-empty, and a failed probe clears the version
  host-side, so the line never claims what the last run did not answer with. The
  flags block renders `flagsTitle` + `flagsHint` with the upstream
  configuration-guide link beside the title (`docsLinkLabel`, not the whole
  `docsMessage`, which reads as the body hint), then its rows: `flagsValueLabel`
  per field (indexed) with `flagsValuePlaceholder`, `flagsEmpty` when there are
  none, and the `addFlag` / `removeFlag` controls around the **Restore defaults**
  and **Flags WSL** list actions (each localizable by `flagsRestore`/`flagsWsl`,
  with their tooltips via `flagsRestoreTitle`/`flagsWslTitle`). Error reporting mirrors the
  reference: the header dot (`role="img"`, `aria-label` `statusError`/`statusOk`,
  `title` the full message or the short `chromeMissing` label when only the known
  flag is set) plus the body paragraph `p.error` (`role="status"`) for the
  captured `lastError` and for a rejected write — no badge. The "Reduce log
  output" control is the shell `Switch` primitive (`checked`, `label`,
  `disabled`, `onChange`) drawn in the `fieldRow` beside `fieldTitle`, inside
  `STYLES.toggleLabel` carrying `reduceTitle` as its tooltip, above the
  `reduceHint` `fieldDesc` — the reference's idiom. `onChange` calls
  `props.toggleStderr()` — checked exactly when the host resolves "log" (never a
  phantom state).

## Testing conventions

- Cross-realm values (vm-materialized bundles): compare with
  `JSON.stringify`, not `deepEqual` (prototype mismatches).
- Client test materializes `lib/client.js` in a `node:vm` context with
  stubbed `window.__ModuleLoader__`, `document`, `react` (incl. `useRef`),
  `react/jsx-runtime`, `@deepseek-ai/dsh-client-store` and
  `@deepseek-ai/dsh-client-ui-primitives` (its `Menu` stub records the props
  each render hands it), plus a stub settings scope — assert registration,
  exports, rendered tree (docs message/link, the extra-flags rows, the dropdown's
  items + the anchored pill, the saved executable rows with their answers + the
  delete/add/search controls, error dot), and that the editor and each executable
  action writes the right settings field (`extraFlags`, `chromePath`,
  `executables`, `refreshExecutablesNonce`) and then waits on
  `executableDiscoveryRevision`. A function component must be expanded **exactly
  once** per render: re-calling it from a later traversal hands it fresh hook
  slots and it reads its state from the wrong slot, which is why the test expands
  the tree inside `render()` and keeps `walk` purely structural.
- Host behavior: boot the plugin from source with `.smoke/overlay.yml` under
  a throwaway `DSH_HOME` (a scratch home, never the live one) —
  `DSH_HOME=<scratch-home> dsh web --patch .smoke/overlay.yml --port 8765
  --no-open` (repo root). For failure paths, `.smoke/overlay-fake.yml` +
  `fake-npx`/`fake-chrome` booted with `dsh web --patch
  .smoke/overlay-fake.yml --port N --no-open`; the `fake-npx` shim records the
  argv of every bridge spawn it serves, so watch that shim's argv log and the
  host logs for the captured bridge errors.
- Client test's vm sandbox needs `setTimeout`/`clearTimeout` (the action
  polls schedule against the browser globals).
- **Windows Chrome run tests** (`test/windows.test.mjs`): the run is driven
  against injected fakes (the exact `start` argv, the port pool, every error
  state) and the controller wiring against `createChromeMcpController(ctx,
  config, { runWindowsChrome })`, plus the MCP-tool surface against an `ctx`
  stub carrying lazy `inject`/`effect` (registration disposes with the effect;
  the definition's `output.render` projects the one text block) — the real
  interop half (sockets, spawns, the `\\wsl.localhost` UNC) is never exercised
  by a test, per the injection rule; field evidence comes from the manual
  field runs below instead.
- **A test selection must never resolve to an executable that exists.** A probe
  runs `chromePath --version` as written, so any candidate list or selection
  that *is* present execs the real browser — under WSL that includes
  `/mnt/c/.../chrome.exe`, whose `--version` answer *starts a browser instance on
  the Windows side* (that is how it answers), several times per run. Use
  `/nonexistent-dir/...` for the Linux cases and a drive-letter spelling
  (`C:\dsh-chrome-mcp-test\chrome.exe`) for the Windows ones: absent everywhere,
  yet still read as Windows-side by the picker. `process.execPath` (node) is the
  accepted stand-in when a probe must *answer*. Assert what the probe did by
  what it reports:
  - a probeable path that is not there → the base layer reports
    `executable not found: <that path>`;
  - a Windows path on a WSL host → nothing was exec'd by definition, so the base
    layer answers **no** version and no error (see the probe-skip rule under
    *Executable selection*); asserting `executable not found` there would be
    wrong — it would mean a probe ran.
- **Windows Chrome field test** (manual): the run's host halves are
  faked in the unit suite by design, so a real launch is a manual step, never
  an automated one. Requirements: `networkingMode=mirrored` in
  `~/.wslconfig` followed by `wsl --shutdown` (check with
  `wslinfo --networking-mode` — the plugin only *reads* this answer, never
  writes it), a Windows-side Chrome the run can locate
  (any install `WINDOWS_CHROME_CANDIDATES` answers for). Boot the
  plugin against a throwaway `DSH_HOME`, open the card, click
  **Prelaunch Windows Chrome** — or call the `prelaunch_windows_chrome` tool from
  the agent — and watch the answers the run states: the Windows browser opens a
  window carrying `--remote-debugging-port=9222` with its profile at
  `%LOCALAPPDATA%\dsh-chrome-mcp\.chrome` (the checkout's `.chrome` is the
  **view** link the run refreshes, never the profile itself) and opening on the
  **landing page** — `…\dsh-chrome-mcp\prelaunch-9222.html`, the packaged page
  rendered with that run's port, connect address and profile directory — and on
  exactly **one** tab: no `chrome://newtab` riding along (the launch silences the
  first-run welcome page and the search-engine chooser, and the positional URL is
  what replaces the startup tab), the pill flips to `connect mode`, and the tool
  roundtrip (`new_page` → `list_pages`) drives it. The page is the part a unit run
  cannot answer (it injects `landing`), so the CDP tab list is the evidence:
  once the run settles, read the debugging endpoint's page list — print every
  page's URL and require exactly one tab carrying `prelaunch-<port>.html`
  (drive the check on a non-default port, so a live 9222 session stays
  untouched). Run it **outside** the agent's file sandbox: the page
  lands under `%LOCALAPPDATA%`, which a sandboxed host denies and the run then
  answers "" for — no page, same launch. Measured live 2026-10-04 (port 9240):
  the run connects, the single page the debugging endpoint lists is the run's
  own `prelaunch-9240.html`, read back with the Windows `file:///…` spelling,
  and **no** second tab rides along — so both the 9P read and the positional-URL
  startup shape hold. The port-in-use path is real too: an
  answering 9222 (local *or* Windows — indistinguishable under mirrored) moves
  the run to the next free port of the pool. A failed click must leave the
  *previous* connect entry untouched — launch-failed never rewrites the saved
  flags.
- **Native-Chrome field test** (WSL, 2025-09): drive the real bridge over stdio
  MCP (`npx -y chrome-devtools-mcp@latest
  … --executablePath=<the system Chrome>`). On a live `dsh web` host
  nothing extra is needed — a tool-call roundtrip passed with default flags
  (upstream discovery picked `/opt/google/chrome/chrome`). Inside the agent's
  **file sandbox** Chrome cannot launch with the same command
  (`Target.setDiscoverTargets: Target closed`: the sandbox denies
  `/dev/shm` shared-memory + `~/.config` writes, and core-dumps on the
  crashpad failure) — this is an environment artifact, **never** "fix" it by
  demanding permission escalation. Run it sandbox-clean instead: redirect
  `HOME`/`npm_config_cache` into a scratch home and `TMPDIR`/
  `XDG_RUNTIME_DIR` into a scratch user-data dir, and add the bridge
  pass-through args `--allow-unrestricted-paths` (1.9.0 otherwise sandboxes
  file-write tools to the OS temp dir) `--chromeArg=--disable-dev-shm-usage`
  `--chromeArg=--no-sandbox`. `--chromeArg=<flag>` is the only way to reach
  Chrome's argv: bare `--disable-dev-shm-usage`/`--no-sandbox` hit the
  yargs parser first (`Unknown arguments`, dropped).

## Install / dev notes

- On WSL with Windows-side pnpm, `dsh plugin add link:...` fails
  (`ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED` — Windows pnpm cannot symlink
  WSL dirs). Link the checkout only in the `plugin-dev` profile (the live
  `web` profile consumes npm packages only), by hand:
  1. `ln -s <this-checkout> ~/.dsh/profiles/plugin-dev/node_modules/@comecaramelos/dsh-chrome-mcp`
     (make the scope dir first);
  2. add `"@comecaramelos/dsh-chrome-mcp": "link:<this-checkout>"` to the
     `dependencies` of `~/.dsh/profiles/plugin-dev/package.json` — without a
     dependency the entry has no installed-state counterpart;
  3. ensure the name sits in `dsh.profile.bundles` (`dsh plugin --profile
     plugin-dev list` reconciles it in).
  The checkout wins over any published copy only if global install locations
  stay free of `@comecaramelos/*` — global copies resolve ahead of the
  profile `link:` (see `~/.dsh/profiles/plugin-dev/AGENTS.md`).
- Live-reload caveat: `patchReload: live` re-applies **patch config**; it
  does **not** re-import changed plugin JS. JS changes need a `dsh web`
  restart.
- `DSH_HOME=<dir>` is honored (dsh-home-paths): boot against an isolated
  home when the real settings must not be touched.
- **Shared-file hazard**: a second instance shares `~/.dsh/settings.yaml`
  with the live GUI (the `chrome-mcp` section) — a test flags write
  hot-relaunches the *live* instance's bridge. Restore immediately after.
