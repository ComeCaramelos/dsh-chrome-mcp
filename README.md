# @comecaramelos/dsh-chrome-mcp

Connects DSH to [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), including Windows Chrome from WSL.

## Install

[Google Chrome](https://www.google.com/chrome/) must be installed: the MCP server does not download it.

```sh
dsh plugin --profile web add @comecaramelos/dsh-chrome-mcp
```

The plugin includes `--no-usage-statistics` and `--no-performance-crux` by default. Use the executable picker to select a browser found on your host.

## Windows Chrome from WSL

Requirements:

The user only needs to add the following line to `.wslconfig`:
```
networkingMode=mirrored
```
The required Chrome flags are managed by the **Flags WSL** button.

A windows executable activates the connect-mode bridge. The executable selector displays `connect mode` instead of probing a local executable.

The bridge uses the first available port and gets a dedicated profile (`.chrome-<port>`).

## Manual installation

Replace `/path/to/dsh-chrome-mcp` with your local checkout:

```sh
mkdir -p ~/.dsh/profiles/web/node_modules/@comecaramelos
ln -s /path/to/dsh-chrome-mcp ~/.dsh/profiles/web/node_modules/@comecaramelos/dsh-chrome-mcp
```

Add the dependency and bundle to `~/.dsh/profiles/web/package.json`, preserving existing entries:

```json
{
  "dependencies": {
    "@comecaramelos/dsh-chrome-mcp": "link:/path/to/dsh-chrome-mcp"
  },
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

---

[Contributing](CONTRIBUTING.md) · [License](LICENSE.md)
