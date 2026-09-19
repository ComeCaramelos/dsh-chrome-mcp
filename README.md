# @comecaramelos/dsh-chrome-mcp

DSH plugin that connects the **Chrome DevTools MCP server**
([`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp),
launched as `npx -y chrome-devtools-mcp@latest [extraFlags]`) as an MCP
server, with an **extra-flags editor in the Web GUI** — instead of hardcoding
`extraFlags` in the config row.

Architecture notes, hard constraints and internals: see `AGENTS.md`.

## Prerequisite: Google Chrome must be installed

The upstream server does **not** download Chrome — it drives the Google Chrome
already installed on the machine (<https://www.google.com/chrome/?platform=linux>).
The standard system locations are auto-discovered; pin a non-standard install
with `chromePath` (one executable) or `chromePaths` (candidate list). When
nothing is found, the card's status dot turns red with "Chrome executable not
found".

**WSL users:** install the Chrome for **Linux inside the distro** — the
Windows-side `chrome.exe` cannot be driven across the WSL boundary (see
"Running under WSL").

## Install

From npm:

```sh
dsh plugin --profile web add @comecaramelos/dsh-chrome-mcp
```

That installs the package and activates its bundle patch layer, which inserts
the bridge row for you (bundle layers apply before the profile's own
`cordis.patch.yml`, and a later row with the same `id` wins):

```yaml
- insert:
    - id: mcp-chrome
      name: '@comecaramelos/dsh-chrome-mcp'
      config:
        serverName: chrome
```

The row ships with the defaults (`serverName: chrome`, `extraFlags` =
`--no-usage-statistics`, `--no-performance-crux`). Set `chromePath` /
`chromePaths` on the row only if the automatic discovery is not enough — the
Settings card edits `extraFlags` live.

Overriding the bundle row: keep your own row in
`$DSH_HOME/profiles/web/cordis.patch.yml` with `id: mcp-chrome`. It replaces
the bundle row completely (full-config replacement, no deep merge) — e.g.
switching a machine-wide bridge to connect mode:

```yaml
- id: mcp-chrome
  name: '@comecaramelos/dsh-chrome-mcp'
  config:
    serverName: chrome
    extraFlags: ['--browserUrl=http://127.0.0.1:9222']
```

Fallback (WSL + Windows pnpm, where `dsh plugin add` fails to symlink the
package into the profile's `node_modules`):

```sh
mkdir -p ~/.dsh/profiles/web/node_modules/@comecaramelos
ln -s /path/to/dsh-chrome-mcp ~/.dsh/profiles/web/node_modules/@comecaramelos/dsh-chrome-mcp
```

Then list the package in the profile manifest
(`~/.dsh/profiles/web/package.json`) alongside the other bundles — this is
exactly what `dsh plugin add` records:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@comecaramelos/dsh-chrome-mcp"
      ]
    }
  }
}
```

Do **not** add a `dependencies` entry for the checkout here: a `file:` spec
makes the Windows-side pnpm re-link the package and fail with `
ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED`. With only the bundle entry, the
`mcp-chrome` row above applies unchanged.

## Why this over the default config

- **Extra-flags editor in Settings** — one flag per line, saved per user;
  invalid entries are rejected by the host and shown on the card. Defaults:
  `--no-usage-statistics`, `--no-performance-crux`.
- **Hot reconnect** — saving flags re-launches the bridge in place; no
  restart needed.
- **Status dot** — the card's single error surface: a red dot whose tooltip
  holds the full last error (missing executable, bridge connection failure,
  failed browser tool call). It clears itself once the bridge is healthy
  again, and lights up on a Chrome-less machine at startup without any user
  action.
- **Chrome version + Re-check** — the last discovered version line, plus a
  button to re-run the executable probe / discovery.
- **Configuration guide** — the upstream docs message with its link:
  [configuration](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md).
- **Flags precedence**: UI selection > `DSH_CHROME_MCP_FLAGS` env var >
  row config `extraFlags` > defaults. Seed a machine default via env,
  switch per-run from the UI.

---

[`CONTRIBUTING`](CONTRIBUTING.md) | [`LICENSE`](LICENSE.md)
