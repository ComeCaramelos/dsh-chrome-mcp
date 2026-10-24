# @comecaramelos/dsh-chrome-mcp

Connects DeepSeek Harness to [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
so the agent can drive a Chrome browser — a local one, or the Windows Chrome when dsh runs
in WSL.

It is a **component** of the MCP connections bundle: it adds the `chrome` connection type
(and `chrome-windows` on WSL) to `@comecaramelos/dsh-mcp-manager`, which owns the
connection list, the on/off switch and the live status.

## Requirements

- dsh `^0.2.0` (0.2.0 and 0.2.1), on Linux, WSL or Windows.
- [Google Chrome](https://www.google.com/chrome/) installed — the MCP server does not
  download it.

## Install

```sh
dsh plugin --profile web add @comecaramelos/dsh-mcp-manager-bundle
```

Coming from the standalone 1.x bundle (dsh 0.1)? Remove it first: it inserts the same
`mcp-chrome` row and does not load on dsh 0.2. Your old settings are kept — the
connections card offers to create the matching connection.

## Use it

1. Plugins → MCP connections → **MCP connections** → *Add connection*, kind
   **Chrome MCP**.
2. Pick the Chrome executable (the picker lists the browsers found on this machine) and
   add extra flags if you need them.
3. Turn it on. Chrome itself only opens on the first tool call that needs a page.

The component's own page (Plugins → MCP connections → **Chrome MCP**) keeps the
executables and default flags every connection starts from, and a *Reduce log output*
switch that keeps the server's stderr out of the dsh console.

The MCP server is the `chrome-devtools-mcp` version this package pins, run by dsh's own
Node — no `npx` and no download on every start. Flags, isolated profiles and when the
card stops checking the executable: [docs/knowledge/flags.md](docs/knowledge/flags.md).

### Native Windows

Nothing extra: the server starts `chrome.exe` itself, as on Linux. The card never runs
`chrome.exe --version` (on Windows that opens a browser window); it reads the version
from the install folder.

### Windows Chrome from WSL

Add `networkingMode=mirrored` to `%USERPROFILE%\.wslconfig` and run `wsl --shutdown`.
Then pick the Windows Chrome in the executable picker and press **Prelaunch Windows
Chrome**: it starts the Windows browser on a free debugging port and the connection
attaches to it. Details: [docs/knowledge/wsl.md](docs/knowledge/wsl.md).

## From a checkout

Use the manager's `node scripts/link-profile.mjs [profile]` with this checkout next to
`dsh-mcp-manager`: it links the manager, the bundle and this component into the profile.
To build and test this package: `npm install`, `npm run build`, `npm test`.

---

[Contributing](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) (for coding agents) · [License](LICENSE.md)
