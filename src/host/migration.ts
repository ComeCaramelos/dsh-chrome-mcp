/**
 * Migration — translating a **standalone** row config into a connection (D4).
 *
 * Before this component existed, the row *was* the connection: the row config
 * steered a bridge this plugin started itself — the flags it launched with, the
 * executable it picked, where its console output went, and every passthrough
 * that reached the client. That bridge is gone, so an installed row would
 * quietly stop running anything unless it is said what its configuration means
 * now — exactly one `chrome` connection, or one `chrome-windows` connection for
 * what the Prelaunch run already left running.
 *
 * Two rules keep the step honest:
 *
 * - **Nothing lands in `servers` without a click.** The proposal is the offer;
 *   writing is the person's. Detection only *proposes*, and the row's config is
 *   read, never rewritten.
 * - **A dismissal is this row's own state.** `migrationDismissed` is a field of
 *   the row's `Config`, not a hidden marker and not something the connection
 *   carries — because what was turned down is *this row's* configuration, and
 *   another component's entry has no business remembering it.
 *
 * A row that already carries a `chrome`/`chrome-windows` connection is not
 * offered anything: the manager filters standing proposals by the kind they
 * would create anyway, so an accepted offer disappears without this module
 * noticing.
 */
import { BROWSER_URL_FLAG_PREFIX, DEFAULT_EXTRA_FLAGS, ENTRY_ID, KIND_FIELDS, KIND_ID_CHROME, KIND_ID_WINDOWS, MIGRATION_DISMISSED_FIELD } from "./constants.js";
import { joinFlagLines } from "./kind.js";
import { carriesConnectionMode, sameFlags } from "./flags.js";
import { readConfigField } from "./values.js";
import type { McpProposal } from "@comecaramelos/dsh-mcp-manager/api";
import type { Controller } from "./controller/index.js";
import type { ChromeMcpConfig } from "./types/index.js";

/** Whether one row config still says what a standalone install steered a bridge
 * with — anything that differs from the shipped defaults. A row that stands
 * entirely on the defaults says nothing to translate: its connection answer is
 * exactly the defaults' answer, and offering it would be noise. */
export function carriesStandaloneConfig(config: ChromeMcpConfig): boolean {
    if (!sameFlags(readConfigField(config.extraFlags, [...DEFAULT_EXTRA_FLAGS]), [...DEFAULT_EXTRA_FLAGS])) return true;
    if (readConfigField(config.chromePath, "").trim() !== "") return true;
    const stderrMode = readConfigField(config.stderrMode, "");
    if (stderrMode === "log" || stderrMode === "console") return true;
    if (config.serverName !== "" && config.serverName !== "chrome") return true;
    if (config.command.trim() !== "" && config.command.trim() !== "npx") return true;
    if (config.package.trim() !== "" && config.package.trim() !== "chrome-devtools-mcp@latest") return true;
    if (Object.keys(config.env).length > 0) return true;
    if (config.cwd.trim() !== "") return true;
    if (config.toolCallTimeoutMs !== 60000 || config.maxInstructionBytes !== 32768 || config.failOnStartupError) return true;
    if (config.bridgeStderr === "console" || config.bridgeStderrLog.trim() !== "") return true;
    const reconnect = config.reconnect;
    if (!reconnect.enabled || reconnect.initialDelayMs !== 500 || reconnect.maxDelayMs !== 30000 || reconnect.maxAttempts !== 10) return true;
    return false;
}

/** Whether this row has already been offered a translation and turned it down. */
export function migrationDismissed(controller: Controller): boolean {
    return readConfigField(controller.config[MIGRATION_DISMISSED_FIELD], false) === true;
}

/**
 * The connection one standalone row config translates into — or `undefined`,
 * when there is nothing to translate or it has already been refused.
 *
 * The identity carries the namespace across: `id` is what every tool is named
 * under, so reusing the old `serverName` (default `"chrome"`) keeps the tool
 * names exactly what they were. The flags decide the kind: a `--browserUrl`
 * riding the saved flags is the residue of a **Prelaunch Windows Chrome** run —
 * translated to `chrome-windows`, which drives that browser through its port.
 * The machine half (the executable catalog) is deliberately *not* translated:
 * it stays in this row and feeds the pickers.
 *
 * @param controller - the live state the row config is read through.
 */
export function standaloneProposal(controller: Controller): McpProposal | undefined {
    const config = controller.config;
    if (migrationDismissed(controller)) return void 0;
    if (!carriesStandaloneConfig(config)) return void 0;
    const flags = readConfigField(config.extraFlags, [...DEFAULT_EXTRA_FLAGS]);
    const carriesUrl = flags.some((flag) => typeof flag === "string" && carriesConnectionMode(flag) && flag.startsWith(BROWSER_URL_FLAG_PREFIX));
    const kind = carriesUrl && controller.wslHost ? KIND_ID_WINDOWS : KIND_ID_CHROME;
    const id = config.serverName.trim() === "" ? "chrome" : config.serverName.trim();
    const extra: Record<string, string> = {};
    const executable = readConfigField(config.chromePath, "").trim();
    if (executable !== "" && kind === KIND_ID_CHROME) extra[KIND_FIELDS.executable] = executable;
    if (!sameFlags(flags, [...DEFAULT_EXTRA_FLAGS])) extra[KIND_FIELDS.extraFlags] = joinFlagLines(flags);
    const stderrMode = readConfigField(config.stderrMode, "");
    if (stderrMode === "log" || stderrMode === "console") extra[KIND_FIELDS.stderrMode] = stderrMode;
    const why = describeStandalone(config, kind === KIND_ID_WINDOWS);
    return {
        id: `${ENTRY_ID}-standalone`,
        title: `Turn this row's configuration into a ${kind === KIND_ID_WINDOWS ? "Windows Chrome" : "Chrome MCP"} connection (${why})`,
        entry: {
            id,
            kind,
            enabled: true,
            label: kind === KIND_ID_WINDOWS ? "Windows Chrome" : "Chrome",
            extra
        },
        /** The person said no: remembered here, in this row, and nowhere else.
         * Nothing is removed from the config, because the config is what the row
         * still says. */
        onDismiss: () => controller.dismissMigration()
    };
}

/** One line naming what the translation runs against — for the title. */
function describeStandalone(config: ChromeMcpConfig, windows: boolean): string {
    const executable = readConfigField(config.chromePath, "").trim();
    if (windows) return "connect mode through the Windows-side browser";
    if (executable !== "") return `"${executable}"`;
    if (config.command.trim() !== "" && config.command.trim() !== "npx") return config.command.trim();
    return "local Chrome";
}
