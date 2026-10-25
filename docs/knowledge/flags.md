# Flags and the executable check

## The server

Connections run the `chrome-devtools-mcp` version this package depends on, started with
dsh's own Node. That is the same on Linux, WSL and Windows, needs no network on start,
and the argv is `node <pinned cli> [flags…]`.

This changed in 2.0: 1.x ran `npx -y chrome-devtools-mcp@latest`. A row that sets its own
`command` or `package` still runs `<command> -y <package>`.

## Default flags

Every connection starts with `--no-usage-statistics` and `--no-performance-crux`. Add
your own as extra flags, one per row, on the component's page (applies to every
connection) or on a single connection.

## Several connections on one machine

By default every server uses the same Chrome profile
(`~/.cache/chrome-devtools-mcp/chrome-profile`), and two of them collide there. Give each
one its own profile with `--isolated` (a throwaway profile per run) or a distinct
`--userDataDir`.

## Flags that turn off the executable check

Some flags decide which browser is used, so with them the card stops checking a local
executable and shows the one the server *runs with* instead — never a "not found" badge:

- attaching to a running browser: `--browserUrl` / `--browser-url` / `-u`,
  `--wsEndpoint` / `--ws-endpoint` / `-w`, `--autoConnect` / `--auto-connect` (Chrome
  144+);
- `--config <file>` (the file can name the executable);
- `--channel` other than `stable` (the server looks in that channel).

See the upstream [configuration guide](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)
and [troubleshooting guide](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md).
