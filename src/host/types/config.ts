/**
 * Types — the config `apply` receives, and the plugin context.
 *
 * One `Config` (./../schema.ts) carries everything: the ordinary row-config
 * fields the card only reads, the user-authored fields the card edits, and the
 * live answers the Host publishes. What matters to every consumer here is the
 * *shape at runtime*: dsh 0.2.0 hands `apply` a reference for every
 * `.volatile()` field and a plain value for every ordinary one, so reading a
 * volatile field's type is not reading what it holds (see ./values.ts
 * `readConfigField`). The two halves are typed apart for exactly that reason.
 */
import type { Context } from "@deepseek-ai/cordis";

import type { BridgeStderrMode } from "./stderr.js";
import type { ChromeExecutableEntry, ChromeExecutableStatus, EffectiveChromeSource } from "./executable.js";
import type { WindowsChromeStatus } from "./windows.js";

/** A `.volatile()` field as `apply` hands it: a stable reference the fiber
 * resolves live, or — the shape a hand-built config (or a test) hands — the plain
 * value itself. Read it through `readConfigField` (./values.ts). */
export type ConfigField<T> = T | { get(): T };

/**
 * The validated row config as `apply` sees it: every ordinary field resolved to
 * its final shape (the card reads them, it never edits them), every `.volatile()`
 * field as a reference. This is the one config type the host half passes around —
 * `buildServerArgs`, `checkChrome` and the bridge config all read ordinary
 * fields directly and take the volatile ones through `readConfigField` or an
 * explicit argument.
 */
export type ChromeMcpConfig = {
    // ---- composition-only: read-only for the form ----
    serverName: string;
    command: string;
    package: string;
    chromePaths: string[];
    env: Record<string, string>;
    cwd: string;
    toolCallTimeoutMs: number;
    /** Ceiling for the bridge's server instructions, in UTF-8 bytes (attribution
     * included). A verbatim passthrough to the nested `dsh-mcp-client` row; a
     * server whose instructions exceed it never connects. */
    maxInstructionBytes: number;
    failOnStartupError: boolean;
    reconnect: ReconnectConfig;
    /** Bridge console-output routing: "log" (default) redirects the child's
     * stderr into a log file; "console" echoes it. The card's "Reduce log
     * output" toggle (`stderrMode`) overrides this. */
    bridgeStderr: BridgeStderrMode;
    /** Optional absolute path for the stderr log ("" → the private per-process
     * directory created by `mkdtemp`, holding `<serverName>-bridge.log`). */
    bridgeStderrLog: string;

    // ---- form-editable (user layer) + Host-published (live mirror) ----
    extraFlags: ConfigField<string[]>;
    /** The executable the bridge launches with: a saved row's path the picker
     * wrote, or one the Host seeded once. "" = nothing resolved yet. */
    chromePath: ConfigField<string>;
    /** The picker's saved rows, `{ id: path, name: label }`. */
    executables: ConfigField<ChromeExecutableEntry[]>;
    /** The ids of saved rows the user dropped — Host-authored, consulted by
     * every merge step so a deleted row never comes back. */
    droppedExecutables: ConfigField<string[]>;
    /** **Legacy** MRU of hand-typed executables — read once, never written. */
    chromeCustomPaths: ConfigField<string[]>;
    /** The card's stderr toggle: "log"/"console"/"" (follow `bridgeStderr`). */
    stderrMode: ConfigField<"" | BridgeStderrMode>;
    /** The card's **Fetch executables** trigger. */
    refreshExecutablesNonce: ConfigField<number>;
    /** The card's **Prelaunch Windows Chrome** trigger. */
    openWindowsChromeNonce: ConfigField<number>;
    lastError: ConfigField<string>;
    chromeMissing: ConfigField<boolean>;
    executableDiscoveryRevision: ConfigField<number>;
    chromeVersion: ConfigField<string>;
    executableStatus: ConfigField<ChromeExecutableStatus[]>;
    effectiveChromePath: ConfigField<string>;
    effectiveSource: ConfigField<EffectiveChromeSource>;
    stderrEffective: ConfigField<BridgeStderrMode>;
    defaultExtraFlags: ConfigField<string[]>;
    wslExtraFlags: ConfigField<string[]>;
    wslWindowsExecutable: ConfigField<boolean>;
    windowsChromeStatus: ConfigField<WindowsChromeStatus>;
    carriesConnectionMode: ConfigField<boolean>;
    /** The flags the live connection actually launches with (mirrored from the
     * last resolve). */
    runningFlags: ConfigField<string[]>;
    /** The note the live connection answered with. */
    runningNote: ConfigField<string>;
    /** Whether the standalone-config translation was turned down (D4). */
    migrationDismissed: ConfigField<boolean>;
};

/** Reconnect policy, mirroring the `dsh-mcp-client` bridge config. */
export type ReconnectConfig = {
    enabled: boolean;
    initialDelayMs: number;
    maxDelayMs: number;
    maxAttempts: number;
};

/**
 * Plugin context as consumed by this host half. `ctx.effect`, `ctx.inject`,
 * `ctx.plugin`, and `ctx.get` all come from cordis `Context` itself.
 */
export type PluginContext = Context;
