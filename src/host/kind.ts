/**
 * The two connection kinds this component registers with the manager — the live
 * half, seen from this component.
 *
 * The manager's pool starts, switches and stops the connections; what this
 * module answers is what the pool needs: what each `select` offers (the saved
 * rows plus whatever discovery reported plus what a live connection runs with),
 * how one entry turns into the fixed `<node> <pinned chrome-devtools-mcp cli> …`
 * stdio, and — for the Windows kind — the whole prelaunch run.
 *
 * What the kinds decide about the card:
 *
 * - `transport: "none"` — each kind owns everything through its `fields`, so the
 *   core's stdio/http fields stay hidden and what the entry's editor shows is
 *   exactly what `resolve` reads back.
 * - No `maxEntries`, no composer pill (unlike docker): any number of connections
 *   of either kind may stand, and none of them claims the conversation input.
 * - `resolve()` of the Windows kind is **async**: preparing it IS the prelaunch
 *   (locate → free port → interop launch → wait for the bind). The pool caches
 *   the preparation per entry, so a browser is never launched twice for one
 *   state.
 *
 * The choices a `select` offers are **Host-served**: read off the live state when
 * the manager asks for them. `notifyKindsChanged` (installed by ./manager.ts) is
 * what says "what they would answer moved" — that is how a discovery run shows
 * up in a picker.
 */
import { KIND_FIELDS, KIND_ID_CHROME, KIND_CHROME_LABEL, KIND_CHROME_SUMMARY, KIND_ID_WINDOWS, KIND_WINDOWS_LABEL, KIND_WINDOWS_SUMMARY, FLAG_LINE_SEPARATOR, NOT_WSL_ERROR } from "./constants.js";
import { buildBridgeSpawn, buildServerArgs, serverCommand } from "./bridge.js";
import { flagsSkipCheck } from "./flags.js";
import { firstLine } from "./status.js";
import { resolveLaunchFlags, resolveSelection, resolveStderrModeFromLayers, readSavedExecutables } from "./values.js";
import { windowsChromeUrl, withBrowserUrlFlag } from "./windows/index.js";
import type { KindOption, McpKind, ResolvedConnection, ServerEntry } from "@comecaramelos/dsh-mcp-manager/api";
import type { Controller } from "./controller/index.js";

/** Split one `lines` field's value into its flags. Missing/blank answers nothing
 * — the entry carries no own answer, so the caller falls through to the row. */
export function parseFlagLines(value: unknown): string[] | undefined {
    if (typeof value !== "string") return void 0;
    const flags = value.split(/\r?\n/u).map((flag) => flag.trim()).filter((flag) => flag !== "");
    return flags.length === 0 ? void 0 : flags;
}

/** Join one flags list back into a `lines` field value (round-trips with
 * {@link parseFlagLines}). */
export function joinFlagLines(flags: readonly string[]): string {
    return flags.join(FLAG_LINE_SEPARATOR);
}

/**
 * What the executable field offers: the saved rows first, then every path the
 * last scan reported, then the Windows-side executables a WSL host carries, then
 * the path a live connection actually launches with — the running path is the
 * answer the Host knows best, and it may not be a saved row yet. A stored pick
 * the choices stop carrying stays offered by the card itself, so it never
 * silently becomes another one.
 */
export function executableChoices(controller: Controller): readonly KindOption[] {
    const { state } = controller;
    const seen = new Map<string, KindOption>();
    for (const row of readSavedExecutables(state.source())) {
        if (row.id === "") continue;
        seen.set(row.id, { value: row.id, label: row.name === "" ? row.id : row.name });
    }
    for (const status of state.live.executableStatus) {
        if (!seen.has(status.path)) seen.set(status.path, { value: status.path, label: status.path });
    }
    for (const path of controller.windowsExecutables()) {
        if (!seen.has(path)) seen.set(path, { value: path, label: path });
    }
    if (state.runningChromePath !== "" && !seen.has(state.runningChromePath)) seen.set(state.runningChromePath, { value: state.runningChromePath, label: state.runningChromePath });
    return [...seen.values()];
}

/** The executable one entry launches with: its own pick, else what the row's
 * layers resolve (the user layer, then the row config with a legacy
 * `--executablePath` folded in) — never a scan answer and never a re-resolve. */
export function entryExecutable(entry: ServerEntry, controller: Controller): string {
    const picked = typeof entry.extra[KIND_FIELDS.executable] === "string" ? String(entry.extra[KIND_FIELDS.executable]).trim() : "";
    if (picked !== "") return picked;
    return resolveSelection(controller.state.source()).path;
}

/** The flags one entry launches with: its own `lines` field, else the row's
 * resolved precedence (user layer > `DSH_CHROME_MCP_FLAGS` > row config > the
 * schema default). */
export function entryExtraFlags(entry: ServerEntry, controller: Controller): string[] {
    const own = parseFlagLines(entry.extra[KIND_FIELDS.extraFlags]);
    if (own !== void 0) return own;
    return resolveLaunchFlags(controller.state.source(), controller.launchFlags);
}

/** The console-output mode one entry runs with: its own pick, else the row's
 * answer. Never a third state. The field is a toggle (`"true"` = reduce = log
 * file); the `log`/`console` it stored while it was a choice still read. */
export function entryStderrMode(entry: ServerEntry, controller: Controller): "log" | "console" {
    const picked = entry.extra[KIND_FIELDS.stderrMode];
    if (picked === "true") return "log";
    if (picked === "false") return "console";
    if (picked === "console" || picked === "log") return picked;
    return resolveStderrModeFromLayers(controller.state.source(), controller.config.bridgeStderr);
}

/** One reason an entry cannot run: a Windows binary under WSL can be *found* but
 * never *driven* from a launch — the debug pipes do not cross the interop
 * boundary. */
const WINDOWS_EXECUTABLE_UNDER_WSL =
    "launching Windows Chrome from WSL is not supported — use the Windows Chrome (WSL debug port) kind to drive the Windows-side browser";

/** One entry's local stdio config: the fixed pinned-server argv through the
 * stderr wrapper, `serverName` is the entry's id (the tool namespace rides
 * `entry.id` now, not the row's old `serverName`). */
function localConfig(entry: ServerEntry, controller: Controller, flags: readonly string[], executable: string, stderrMode: "log" | "console") {
    const composed = { ...controller.config, extraFlags: [...flags], chromePath: executable, serverName: entry.id };
    const spawned = buildBridgeSpawn(
        {
            command: serverCommand(controller.config),
            args: buildServerArgs(composed as never, [...flags]),
            stderr: stderrMode,
            logPath: controller.config.bridgeStderrLog,
            serverName: entry.id
        },
        {}
    );
    return {
        config: {
            serverName: entry.id,
            transport: "stdio" as const,
            command: spawned.command,
            args: spawned.args,
            env: controller.config.env,
            cwd: controller.config.cwd,
            toolCallTimeoutMs: controller.config.toolCallTimeoutMs,
            maxInstructionBytes: controller.config.maxInstructionBytes,
            failOnStartupError: controller.config.failOnStartupError,
            reconnect: controller.config.reconnect
        },
        redirect: spawned.redirect
    };
}

/** The `chrome` kind: the local `chrome-devtools-mcp` bridge — what the row used
 * to start for itself, now as one of the manager's connections. */
export function createChromeKind(controller: Controller): McpKind {
    const { state } = controller;
    return {
        id: KIND_ID_CHROME,
        label: KIND_CHROME_LABEL,
        summary: KIND_CHROME_SUMMARY,
        builtIn: false,
        transport: "none",
        fields: [
            {
                key: KIND_FIELDS.executable,
                label: "Chrome executable",
                type: "select",
                placeholder: "row default",
                help: "Which Chrome this connection launches. Choices come from the saved executables, the last scan, and what a live connection runs with; leave it empty to follow this row's default.",
                options: () => executableChoices(controller)
            },
            {
                key: KIND_FIELDS.extraFlags,
                label: "Extra flags",
                type: "lines",
                placeholder: "--no-usage-statistics",
                help: "One flag per line, passed to chrome-devtools-mcp. Empty leaves every connection to the row's resolved flags."
            },
            {
                key: KIND_FIELDS.stderrMode,
                label: "Reduce bridge log output",
                type: "boolean",
                // What an entry that never set it shows: the schema's `log`.
                placeholder: "true",
                help: "On keeps the bridge's progress lines off the console in a log file; off prints them."
            }
        ],
        async resolve(entry: ServerEntry): Promise<ResolvedConnection> {
            const flags = entryExtraFlags(entry, controller);
            const stderrMode = entryStderrMode(entry, controller);
            const executable = flagsSkipCheck(flags) ? "" : entryExecutable(entry, controller);
            const blocked = controller.blockedForPlatform(executable);
            if (blocked !== "") return { error: `${executable} cannot be driven from this host — ${blocked}` };
            const built = localConfig(entry, controller, flags, executable, stderrMode);
            const note = built.redirect === "" ? "" : `bridge stderr → ${built.redirect}`;
            controller.noteRunning(entry, { executable, source: entry.extra[KIND_FIELDS.executable] !== undefined ? "selected" : resolveSelection(state.source()).source, flags, stderrMode, redirect: built.redirect, note });
            return {
                config: built.config as never,
                note
            };
        }
    };
}

/** The `chrome-windows` kind: the Windows browser driven through the WSL interop
 * mount. `resolve` runs the prelaunch itself — locate, prereq, free port,
 * launch, wait for the bind — and answers the local `chrome-devtools-mcp` in
 * connect mode against that port. The port speaks no MCP; the MCP stays the
 * local process. Off WSL the entry is refused, with the answer the card shows. */
export function createChromeWindowsKind(controller: Controller): McpKind {
    return {
        id: KIND_ID_WINDOWS,
        label: KIND_WINDOWS_LABEL,
        summary: KIND_WINDOWS_SUMMARY,
        builtIn: false,
        transport: "none",
        fields: [
            {
                key: KIND_FIELDS.extraFlags,
                label: "Extra flags",
                type: "lines",
                placeholder: "--no-usage-statistics",
                help: "One flag per line on the local chrome-devtools-mcp that connects to the Windows browser. The debug URL is added by the run."
            },
            {
                key: KIND_FIELDS.stderrMode,
                label: "Reduce bridge log output",
                type: "boolean",
                // What an entry that never set it shows: the schema's `log`.
                placeholder: "true",
                help: "On keeps the local bridge's progress lines off the console in a log file; off prints them."
            }
        ],
        async resolve(entry: ServerEntry): Promise<ResolvedConnection> {
            if (!controller.wslHost) return { error: NOT_WSL_ERROR };
            const run = await controller.prelaunchForConnection();
            if (run.state !== "connected" || run.port <= 0) {
                return { error: `Windows Chrome did not connect (${run.state}): ${firstLine(run.error)}` };
            }
            const url = run.url !== "" ? run.url : windowsChromeUrl(run.port);
            const flags = entryExtraFlags(entry, controller);
            const stderrMode = entryStderrMode(entry, controller);
            // The run's own port is the answer: a connect flag the row or the
            // entry still carries (an older run's port) is **replaced**, never kept
            // next to it, and a local `--user-data-dir` goes — upstream refuses it
            // beside `--browserUrl`.
            const withUrl = withBrowserUrlFlag(flags, url);
            const built = localConfig(entry, controller, withUrl, "", stderrMode);
            controller.noteRunning(entry, { executable: "", source: "selected", flags: withUrl, stderrMode, redirect: built.redirect, note: `Windows Chrome connected at ${url}` });
            return {
                config: built.config as never,
                note: `Windows Chrome connected at ${url}${built.redirect === "" ? "" : `; bridge stderr → ${built.redirect}`}`
            };
        }
    };
}

/** The kinds this host can answer, in registration order — `chrome` first,
 * because it is the answer a standalone config translates into by default
 * (./migration.ts). `chrome-windows` is offered on WSL only: anywhere else its
 * `resolve` could only refuse, so the picker never lists it there (a native
 * Windows host drives its own Chrome through `chrome`). */
export function createChromeKinds(controller: Controller): McpKind[] {
    return controller.wslHost ? [createChromeKind(controller), createChromeWindowsKind(controller)] : [createChromeKind(controller)];
}
