# @comecaramelos/dsh-docker-desktop-mcp

DSH plugin that connects the **Docker Desktop MCP Toolkit** gateway
(`docker mcp gateway run --profile <name>`) as an MCP server, with a **profile
picker in the Web GUI** — instead of hardcoding `--profile` in the config row.

## Install

From npm (recommended):

```sh
dsh plugin --profile web add @comecaramelos/dsh-docker-desktop-mcp
```

The plugin inserts a `mcp-docker` row (id: `mcp-docker`, profile: `default`)
into the Cordis bundle layer. If you already have a `mcp-docker` row in your
profile's `cordis.patch.yml`, the bundle layer's insert is superseded by your
row (later patches win by `id`).

Manual install (WSL + Windows pnpm, where symlinks fail):

```sh
mkdir -p ~/.dsh/profiles/web/node_modules/@comecaramelos
ln -s /path/to/dsh-docker-desktop-mcp ~/.dsh/profiles/web/node_modules/@comecaramelos/dsh-docker-desktop-mcp
# Add to ~/.dsh/profiles/web/package.json dependencies:
#   "@comecaramelos/dsh-docker-desktop-mcp": "file:/path/to/dsh-docker-desktop-mcp"
```

Then replace (or create) your `dsh-mcp-client` row in
`$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
# before
- id: mcp-docker
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: docker
    transport: stdio
    command: docker
    args: ['mcp', 'gateway', 'run', '--profile', 'default']

# after
- id: mcp-docker
  name: '@comecaramelos/dsh-docker-desktop-mcp'
  config:
    serverName: docker
    profile: default
```

### WSL + Docker Desktop (Windows)

Docker Desktop keeps its MCP profiles in the Windows store
(`C:\Users\<you>\.docker\mcp`), while the Linux CLI inside the distro reads the
(usually empty) `~/.docker/mcp`. When `/Docker/host/bin/docker.exe` is
executable on linux, discovery and the gateway spawn use it.
Set `command` to an explicit path to opt out.

## Why this over the default config

- **Profile picker in Settings** — switch Docker MCP profiles without editing
  `cordis.patch.yml`. Selection persists in `$DSH_HOME/settings.yaml`.
- **Refresh profiles button** — runs `docker mcp profile list --format json`
  and repopulates the select from the host.
- **Hot reconnect** — picking a profile re-applies the gateway with the new
  `--profile` in place; no restart needed.
- **Profile precedence**: UI selection > `DSH_DOCKER_MCP_PROFILE` env var >
  row config > `"default"`. Seed a machine default via env, switch per-run from UI.

---

[`CONTRIBUTING`](CONTRIBUTING.md) | [`LICENSE`](LICENSE.md)
