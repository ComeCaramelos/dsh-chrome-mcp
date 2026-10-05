/**
 * Types — bridge console-output routing and the per-spawn stderr wrapper.
 *
 * These types describe where the spawned bridge's console output goes and the
 * shapes the wrapper is built from; the runtime lives in ./bridge.ts. Split out
 * of the single `types.ts` so the stderr plumbing reads as one section.
 */

/**
 * Where the spawned bridge's console output goes. "log" (default) captures the
 * child's inherited stderr into a per-spawn log file so the dsh console stays
 * clean while stdout keeps flowing as the MCP protocol stream; "console"
 * inherits it (debug). Mirrors the reference plugin's gateway stderr modes.
 */
export type BridgeStderrMode = "log" | "console";

/** The spawn-diagnostics subset {@link noteStderr} reads. */
export type BridgeStderrNotice = { redirect: string; fallback: string };

/** Spawn target consumed by {@link buildBridgeSpawn}. */
export type BridgeSpawnTarget = {
    /** Executable the bridge runs (default `npx`). */
    command: string;
    /** Argv tail: `-y <package> [extraFlags]`, plus any appended path pin. */
    args: string[];
    /** Effective stderr routing; defaults to "log" when omitted. */
    stderr?: BridgeStderrMode;
    /** Explicit log path (""/undefined → the per-spawn default). */
    logPath?: string;
    /** Bridge server namespace (sanitized into the default log name). */
    serverName?: string;
};

/** Options for {@link buildBridgeSpawn}. */
export type BridgeSpawnOptions = {
    platform?: NodeJS.Platform;
    exists?: (candidate: string) => boolean;
    tmpdir?: string;
    pid?: number;
};

/** One built bridge spawn: the (possibly wrapped) command/args plus where the
 * stderr lands (`redirect`, "" when echoed) and why not (`fallback`). */
export type BridgeSpawnResult = { command: string; args: string[]; redirect: string; fallback: string };

/** Options for {@link bridgeStderrLogPath}. */
export type BridgeStderrLogPathOptions = { tmpdir?: string; pid?: number };
