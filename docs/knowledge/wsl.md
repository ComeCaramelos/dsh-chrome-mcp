# Windows Chrome from WSL

A server running in WSL cannot launch the Windows `chrome.exe` itself: the debug pipes
it opens don't survive the WSL interop boundary. Instead, the Windows browser is started
with a debugging port and the server attaches to that port.

## One-time setup

Add this to `%USERPROFILE%\.wslconfig` and run `wsl --shutdown`:

```
[wsl2]
networkingMode=mirrored
```

That lets WSL reach ports on the Windows loopback. The plugin only checks it; it never
edits your Windows settings. If it is missing, the card says so.

## Each session

1. In the executable picker, select the Windows browser. The picker lists the Windows
   browsers it found (Chrome, or Edge when there is no Chrome); the one you select is the
   one that starts.
2. Press **Prelaunch Windows Chrome** (next to *Fetch executables*), or ask the agent to
   use the `prelaunch_windows_chrome` tool. It starts that browser on the first free
   debugging port, with its own profile (`.chrome-<port>`), and points the connection at
   it.
3. The **Flags WSL** button fills in the Chrome flags this mode needs.

The card shows `connect mode` for a Windows executable instead of a version: asking a
Windows `chrome.exe` for `--version` opens a browser window, so it is never run just to
check.

Chrome installed inside the Linux distro needs none of this — it works like on any
Linux machine.
