/**
 * Precedence resolution + persisted reads.
 *
 * Two levers resolve from the persisted layer upward. The launch flags come
 * from one of four sources (highest first): the settings user layer (last UI
 * edit, read via `readPersistedFlags` when the service is already up), the
 * launch environment (`DSH_CHROME_MCP_FLAGS`, resolved by the controller
 * through `resolveEnvFlags`), the row config `extraFlags`, and the schema
 * default. The executable comes from three (highest first): the persisted
 * `chromePath` the card wrote or the host seeded once, the row config
 * `chromePath` (a legacy row-level `--executablePath` folded in — see
 * `src/host/flags.ts`), and nothing. There is no auto resolution: nothing is
 * inferred on every start, and nothing is re-inferred when the chosen path
 * breaks.
 *
 * Everything here is pure — the controller composes the precedence; reading
 * the persisted selection never throws when the service is not up yet.
 */
import { CUSTOM_PATHS_CAP, SETTINGS_NAMESPACE } from "./constants.js";
import { validateExtraFlags } from "./flags.js";
import type { BridgeStderrMode, PluginContext } from "./types/index.js";

/**
 * Parse a whitespace-separated flags list from the environment.
 * @param configured - the row config `extraFlags` value.
 * @param envValue - `DSH_CHROME_MCP_FLAGS` as seen in the launch env.
 * @returns the env flags when the value is a non-empty string whose every
 * entry is valid, else `configured` (the caller decides on warnings).
 */
export function resolveEnvFlags(configured: string[], envValue: unknown): string[] {
    if (typeof envValue !== "string" || envValue.trim() === "") return configured;
    const flags = envValue.split(/\s+/u).filter((flag) => flag !== "");
    try {
        validateExtraFlags(flags);
    } catch {
        return configured;
    }
    return flags;
}

/**
 * Read the last UI-selected extraFlags list from the persisted user layer
 * when the settings service is already up and the stored value is valid.
 * The host consults this before the first bridge spawn so the very first
 * connection launches with the persisted flags — and every in-process
 * reconnect, which reuses the bridge config, comes back on them as well.
 * @param ctx - plugin context.
 * @returns the persisted flags array, or undefined when absent, invalid, or
 * the settings service is not available yet (the installSection initial
 * onChange then applies the persisted selection in place).
 */
export function readPersistedFlags(ctx: PluginContext): string[] | undefined {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || typeof section !== "object" || Array.isArray(section)) return void 0;
        const value = section.extraFlags;
        if (Array.isArray(value) && value.every((flag) => typeof flag === "string" && flag !== "")) {
            return [...value];
        }
    } catch {
        // settings service not available yet: row config defaults apply.
    }
    return void 0;
}

/**
 * Environment variable that seeds the launch flags for one dsh run: a
 * whitespace-separated extraFlags list, e.g.
 * `DSH_CHROME_MCP_FLAGS="--headless --isolated"`.
 */
export { FLAGS_ENV_VAR } from "./constants.js";

/**
 * Resolve the effective bridge stderr mode. The persisted UI toggle
 * (`stderrMode`) wins when set; otherwise the row-config `bridgeStderr`
 * (mirrored into the base layer as `rowStderr`). An invalid/empty override
 * falls back to the row config.
 * @param override - persisted `stderrMode` value, or "".
 * @param rowDefault - the validated row-config `bridgeStderr` ("log"/"console").
 * @returns "log" | "console".
 */
export function resolveStderrMode(override: unknown, rowDefault: unknown): BridgeStderrMode {
    if (override === "log" || override === "console") return override;
    return rowDefault === "console" ? "console" : "log";
}

/**
 * The effective Chrome executable path (highest first):
 *
 * 1. the `chromePath` the user picked in the card — or that the host seeded
 *    once during the first scan, which is written into the same field,
 * 2. the row-config `chromePath` (a legacy row-level `--executablePath` flag
 *    folded into it before this call),
 * 3. `""` — nothing resolved yet, which is not a runnable executable and is
 *    reported as such.
 *
 * Nothing here consults the scan list: a fixed path stays fixed even when it
 * breaks, because re-resolving would be an auto mode in disguise.
 *
 * @param userLayer - persisted `chromePath` value ("" or absent when unset).
 * @param rowConfig - validated row-config `chromePath` value.
 * @returns the trimmed effective path, possibly "".
 */
export function resolveEffectiveChromePath(userLayer: unknown, rowConfig: unknown): string {
    const user = typeof userLayer === "string" ? userLayer.trim() : "";
    if (user !== "") return user;
    const config = typeof rowConfig === "string" ? rowConfig.trim() : "";
    return config;
}

/**
 * Read the last UI-seeded (or host-seeded) `chromePath` from the persisted user
 * layer when the settings service is already up. ""/absent/invalid means
 * "nothing picked yet".
 * @param ctx - plugin context.
 */
export function readPersistedChromePath(ctx: PluginContext): string {
    return readPersistedStringField(ctx, "chromePath");
}

/**
 * Read the last persisted "Reduce log output" mode from the persisted user
 * layer when the settings service is already up. Empty/absent/invalid means
 * "follow the row config".
 * @param ctx - plugin context.
 * @returns "log" | "console" when explicitly set, "" otherwise.
 */
export function readPersistedStderrMode(ctx: PluginContext): "" | BridgeStderrMode {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || section === void 0 || typeof section !== "object" || Array.isArray(section)) return "";
        const value = (section as Record<string, unknown>).stderrMode;
        if (value === "log" || value === "console") return value;
    } catch {
        // settings service not available yet: row config default applies.
    }
    return "";
}

/**
 * Read the persisted custom-executable MRU from the user layer when the
 * settings service is already up. Invalid entries (non-string, empty, control
 * characters) are dropped rather than poisoning the candidate list.
 * @param ctx - plugin context.
 * @returns the stored paths, trimmed and deduplicated ("" list when absent).
 */
export function readPersistedCustomPaths(ctx: PluginContext): string[] {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || section === void 0 || typeof section !== "object" || Array.isArray(section)) return [];
        const value = (section as Record<string, unknown>).chromeCustomPaths;
        if (!Array.isArray(value)) return [];
        return normalizeCustomPaths(value);
    } catch {
        // settings service not available yet: no custom candidates.
        return [];
    }
}

/**
 * Normalized form of a **legacy** custom-path list: trimmed, empty entries
 * dropped, control characters dropped, duplicates folded (first spelling wins),
 * capped most-recent-first so the list stays bounded. Nothing writes this list
 * any more (the saved executable rows replace it) — it is only ever read, once,
 * to fold the older hand-typed paths into the rows.
 * @param value - candidate list (any shape).
 * @param cap - entry cap (default `CUSTOM_PATHS_CAP`).
 */
export function normalizeCustomPaths(value: unknown, cap: number = CUSTOM_PATHS_CAP): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const entry of value) {
        if (typeof entry !== "string") continue;
        const path = entry.trim();
        if (path === "" || /[\x00-\x1f\x7f]/u.test(path)) continue;
        if (seen.has(path)) continue;
        seen.add(path);
        paths.push(path);
    }
    if (paths.length <= cap) return paths;
    return paths.slice(0, cap);
}

/** Read one persisted string field of the `chrome-mcp` section ("" when
 * absent, invalid or the service is not up yet). */
function readPersistedStringField(ctx: PluginContext, field: string): string {
    try {
        const settings = ctx.get("settings");
        const section = settings?.document?.[SETTINGS_NAMESPACE];
        if (section === null || section === void 0 || typeof section !== "object" || Array.isArray(section)) return "";
        const value = (section as Record<string, unknown>)[field];
        if (typeof value !== "string") return "";
        const trimmed = value.trim();
        return /[\x00-\x1f\x7f]/u.test(trimmed) ? "" : trimmed;
    } catch {
        return "";
    }
}
