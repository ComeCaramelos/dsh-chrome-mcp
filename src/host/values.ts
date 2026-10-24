/**
 * Precedence resolution + the configuration form's answers.
 *
 * Two levers resolve upward. The launch flags come from one of four sources
 * (highest first): the user layer (the card's last edit), the launch environment
 * (`DSH_CHROME_MCP_FLAGS`, read through `launchEnvironmentOf`), the row-config
 * `extraFlags`, and the schema default. The executable comes from three (highest
 * first): the `chromePath` the card picked or the host seeded once, the row
 * config (a legacy row-level `--executablePath` folded in — see ./flags.ts), and
 * nothing. There is no auto resolution: nothing is inferred on every start, and
 * nothing is re-inferred when the chosen path breaks.
 *
 * The reads are one `readConfigLayers` wide: since dsh 0.2.0 the *references*
 * apply() handed answer the effective value (they resolve the user layer over the
 * row config), while the two layers the distinction needs ride the described settings row (`readFormRow`)
 * — `user` is what the profile patch carries (presence is the answer), `base` what
 * the row config carries under it. Before the form attaches only the references
 * answer, so the first commit settles the distinction.
 */
import { readFormRow } from "@comecaramelos/dsh-ancesters/host";

import { CUSTOM_PATHS_CAP, DEFAULT_EXTRA_FLAGS, WSL_EXTRA_FLAGS } from "./constants.js";
import { extractExecutablePathFlag, stripExecutablePathFlags, validateExtraFlags } from "./flags.js";
import { normalizeEntries } from "./catalog.js";
import type {
    BridgeStderrMode,
    ChromeExecutableEntry,
    ChromeMcpConfig,
    ConfigField,
    ConfigLayers,
    ConfigLayerFields,
    ConfigLiveFields,
    ConfigUserFields,
    SettingsFormRow,
    SettingsForms
} from "./types/index.js";

/**
 * Environment variable that seeds the launch flags for one dsh run: a
 * whitespace-separated extraFlags list, e.g.
 * `DSH_CHROME_MCP_FLAGS="--headless --isolated"`.
 */
export { FLAGS_ENV_VAR } from "./constants.js";

/**
 * Read one config field. A `.volatile()` field arrives as a reference the fiber
 * resolves live (dsh 0.2.0: `apply` hands references, ordinary fields plain
 * values), so reading the field's type is not enough — this is the one way every
 * volatile read answers, whether what it holds is a reference or, on the cold
 * path of a hand-built config, the plain value itself.
 *
 * A reference hands a snapshot, so arrays come back copied: the running state
 * holds values, never the reference's own object.
 * @param field - what the config carries for that field.
 * @param fallback - what to answer when it holds nothing.
 */
export function readConfigField<T>(field: ConfigField<T> | undefined, fallback: T): T {
    const holder = field as unknown as { get?: () => T | undefined } | undefined;
    if (typeof holder?.get === "function") {
        const value = holder.get();
        if (value === void 0) return fallback;
        return Array.isArray(value) ? (value as unknown[]).slice() as T : value;
    }
    if (field === void 0 || field === null) return fallback;
    return Array.isArray(field) ? (field as unknown[]).slice() as T : (field as T);
}

/**
 * The canonical default extra-flags list — the live mirror's answer for the
 * card's **Restore defaults** control (the card carries no copy of it).
 */
export function readDefaultExtraFlags(): string[] {
    return [...DEFAULT_EXTRA_FLAGS];
}

/**
 * The recommended WSL ↔ Windows extra-flags list — the live mirror's answer for
 * the card's **Flags WSL** control (a fixed recommendation, never persisted).
 */
export function readWslExtraFlags(): string[] {
    return [...WSL_EXTRA_FLAGS];
}

/**
 * Parse a whitespace-separated flags list from the environment.
 * @param configured - what the row config answers.
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

/** Normalize one layer's `extraFlags` answer (undefined = the layer is silent). */
function readLayerFlags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return void 0;
    if (!value.every((flag) => typeof flag === "string" && flag !== "")) return void 0;
    return value as string[];
}

/** Normalize one layer's `chromePath` answer ("" when absent or unusable). */
function readLayerChromePath(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * One read of the configuration form's layers. `value` answers what runs now —
 * the references resolve the user layer over the row config, which is exactly
 * what the bridge launches with. `user` answers "did the user edit this?" (the
 * selection source, and where the launch environment sits in the flags
 * precedence), `base` "what does the row config say?", and both stay undefined
 * until the form answers.
 *
 * The live-only volatile fields are not consulted here: they are Host answers,
 * held in the controller's mirror and published, not read.
 * @param config - the config `apply` received (references included).
 * @param row - the described form row, when the service is already up.
 */
export function readConfigLayers(config: ChromeMcpConfig, row?: SettingsFormRow): ConfigLayers {
    const described = (row === null || typeof row !== "object" ? {} : row) as { user?: unknown; base?: unknown };
    const describedLayer = (layer: unknown): ConfigLayerFields => {
        const source = layer === null || typeof layer !== "object" || Array.isArray(layer) ? {} : layer as Record<string, unknown>;
        const flags = readLayerFlags(source.extraFlags);
        const executables = Array.isArray(source.executables) ? normalizeEntries(source.executables) : void 0;
        const paths = Array.isArray(source.chromeCustomPaths) ? normalizeCustomPaths(source.chromeCustomPaths) : void 0;
        const stderrMode = source.stderrMode === "log" || source.stderrMode === "console" ? source.stderrMode : void 0;
        const chromePath = typeof source.chromePath === "string" ? source.chromePath.trim() : void 0;
        const dropped = Array.isArray(source.droppedExecutables)
            ? source.droppedExecutables.filter((item): item is string => typeof item === "string")
            : void 0;
        return {
            ...(flags === void 0 ? {} : { extraFlags: flags }),
            ...(chromePath === void 0 || chromePath === "" ? {} : { chromePath }),
            ...(executables === void 0 ? {} : { executables }),
            ...(dropped === void 0 ? {} : { droppedExecutables: dropped }),
            ...(paths === void 0 ? {} : { chromeCustomPaths: paths }),
            ...(stderrMode === void 0 ? {} : { stderrMode }),
            ...(typeof source.refreshExecutablesNonce === "number" ? { refreshExecutablesNonce: source.refreshExecutablesNonce } : {}),
            ...(typeof source.openWindowsChromeNonce === "number" ? { openWindowsChromeNonce: source.openWindowsChromeNonce } : {})
        };
    };
    const value: ConfigUserFields = {
        extraFlags: readConfigField(config.extraFlags, [...DEFAULT_EXTRA_FLAGS]),
        chromePath: readConfigField(config.chromePath, "").trim(),
        executables: normalizeEntries(readConfigField(config.executables, [])),
        droppedExecutables: readConfigField(config.droppedExecutables, []).filter((item): item is string => typeof item === "string"),
        chromeCustomPaths: normalizeCustomPaths(readConfigField(config.chromeCustomPaths, [])),
        stderrMode: readConfigField(config.stderrMode, "") as "" | BridgeStderrMode,
        refreshExecutablesNonce: readConfigField(config.refreshExecutablesNonce, 0),
        openWindowsChromeNonce: readConfigField(config.openWindowsChromeNonce, 0)
    };
    const base = describedLayer(described.base);
    const hasLayers = described.user !== void 0 || described.base !== void 0;
    return {
        value,
        // Before the form attaches nothing distinguishes the layers, so the
        // references answer for the row config as well; the first commit reads the
        // real layers and settles the distinction.
        user: hasLayers ? describedLayer(described.user) : {},
        base: hasLayers ? base : { ...value }
    };
}

/**
 * The effective launch flags for one read of the layers (highest first: the
 * user layer, `DSH_CHROME_MCP_FLAGS`, the row config, the schema default).
 * Before the layers answer the references stand in, exactly the way the old cold
 * path did. The executable-pinning flag never reaches argv — the picker owns
 * that flag, so a layer that still carries one is answered as the selection
 * source instead (see ./flags.ts), never as a second source of truth.
 * @param layers - the last read of the form's layers.
 * @param envValue - the launch environment's `DSH_CHROME_MCP_FLAGS` value.
 */
export function resolveLaunchFlags(layers: ConfigLayers, envValue: unknown): string[] {
    const user = readLayerFlags(layers.user.extraFlags);
    if (user !== void 0) return stripExecutablePathFlags(user);
    const row = readLayerFlags(layers.base.extraFlags) ?? layers.value.extraFlags;
    const fromEnv = resolveEnvFlags(row, envValue);
    return stripExecutablePathFlags(fromEnv);
}

/**
 * The effective executable selection for one read of the layers: the user layer
 * (the card's pick, or the host's one seed) wins, then the row config — its
 * legacy `--executablePath` folded in — and, before either answers, nothing.
 * There is no auto source and nothing is re-resolved here: a path that breaks
 * keeps breaking so what the pill claims keeps being what the bridge runs.
 */
export function resolveSelection(layers: ConfigLayers): { path: string; source: "" | "selected" | "row-config"; pinned: boolean } {
    const userPath = readLayerChromePath(layers.user.chromePath);
    if (userPath !== "") return { path: userPath, source: "selected", pinned: false };
    const baseChromePath = readLayerChromePath(layers.base.chromePath);
    if (baseChromePath !== "") return { path: baseChromePath, source: "row-config", pinned: false };
    const pinned = extractExecutablePathFlag(readLayerFlags(layers.base.extraFlags) ?? []);
    if (pinned !== "") return { path: pinned, source: "row-config", pinned: true };
    return { path: "", source: "", pinned: false };
}

/**
 * Resolve the effective bridge stderr mode. The user layer's toggle
 * (`stderrMode`) wins when it states one; otherwise the row config's
 * `bridgeStderr`. An invalid/empty override falls back to the row config.
 * @param override - the persisted `stderrMode` value, or "".
 * @param rowDefault - the validated row-config `bridgeStderr` ("log"/"console").
 * @returns "log" | "console".
 */
export function resolveStderrMode(override: unknown, rowDefault: unknown): BridgeStderrMode {
    if (override === "log" || override === "console") return override;
    return rowDefault === "console" ? "console" : "log";
}

/**
 * The effective bridge stderr mode from one read of the form's layers, in the
 * precedence every other layer-resolved field follows: what the user layer says
 * wins, the **row config** answers under it, and what the references resolved at
 * boot sits under that again (the references answer both layers before the form
 * attaches, so the cold path keeps answering).
 *
 * The `base` step is what keeps the answer single. The references can resolve an
 * empty `stderrMode` for a row that states one — no user layer ever wrote it —
 * while the described row still serves it, and then the card states one mode
 * while the bridge runs the other. A control that diffs its own flip against
 * what is *effective* drops every flip as "already served" against a stale
 * mirror, which is exactly the dead toggle: the profile that configures the
 * switch in its own row is the profile that can never switch it. Reading the
 * row-config layer here makes the Host state the same mode the card states, and
 * the mirror it publishes then stays honest on its own.
 * @param layers - the last read of the form's layers.
 * @param rowDefault - the validated row-config `bridgeStderr` ("log"/"console").
 * @returns "log" | "console".
 */
export function resolveStderrModeFromLayers(layers: ConfigLayers, rowDefault: unknown): BridgeStderrMode {
    return resolveStderrMode(layers.user.stderrMode ?? layers.base.stderrMode ?? layers.value.stderrMode, rowDefault);
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
 * @param userLayer - the persisted `chromePath` value ("" when unset).
 * @param rowConfig - validated row-config `chromePath` value.
 * @returns the trimmed effective path, possibly "".
 */
export function resolveEffectiveChromePath(userLayer: unknown, rowConfig: unknown): string {
    const user = typeof userLayer === "string" ? userLayer.trim() : "";
    if (user !== "") return user;
    return typeof rowConfig === "string" ? rowConfig.trim() : "";
}

/**
 * The persisted user-layer `extraFlags` list (undefined = the user never said
 * anything, so the launch environment answers instead).
 * @param layers - the last read of the form's layers.
 */
export function readPersistedFlags(layers: ConfigLayers): string[] | undefined {
    return readLayerFlags(layers.user.extraFlags);
}

/**
 * The last UI-seeded (or host-seeded) `chromePath` from the user layer ("" means
 * "nothing picked yet" → fall back to the row config).
 * @param layers - the last read of the form's layers.
 */
export function readPersistedChromePath(layers: ConfigLayers): string {
    return readLayerChromePath(layers.user.chromePath);
}

/**
 * The last persisted "Reduce log output" mode from the user layer.
 * Empty/absent/invalid means "follow the row config".
 * @param layers - the last read of the form's layers.
 * @returns "log" | "console" when explicitly set, "" otherwise.
 */
export function readPersistedStderrMode(layers: ConfigLayers): "" | BridgeStderrMode {
    const mode = layers.user.stderrMode;
    return mode === "log" || mode === "console" ? mode : "";
}

/**
 * The persisted custom-executable MRU from the user layer — a **legacy** field
 * nothing writes any more, read once to fold the older hand-typed paths into
 * the rows. Invalid entries (non-string, empty, control characters) are dropped
 * rather than poisoning the candidate list.
 * @param layers - the last read of the form's layers.
 * @returns the stored paths, trimmed and deduplicated ("" list when absent).
 */
export function readPersistedCustomPaths(layers: ConfigLayers): string[] {
    const paths = layers.user.chromeCustomPaths;
    if (paths === void 0) return normalizeCustomPaths(layers.value.chromeCustomPaths);
    return normalizeCustomPaths(paths);
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

/**
 * The saved executable rows the picker shows: re-normalized on every read, since
 * what a form write hands may carry any shape.
 * @param layers - the last read of the form's layers.
 */
export function readSavedExecutables(layers: ConfigLayers): ChromeExecutableEntry[] {
    return normalizeEntries(layers.user.executables ?? layers.value.executables);
}

/**
 * The ids of rows the user has dropped — the ids every merge step must skip so a
 * deletion outlives the run behind the write that made it (see ./schema.ts
 * `droppedExecutables`). Deduped; a malformed entry drops out exactly like a
 * malformed row id.
 * @param layers - the last read of the form's layers.
 */
export function readDroppedExecutables(layers: ConfigLayers): string[] {
    const raw = (layers.user.droppedExecutables ?? layers.value.droppedExecutables) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (typeof item !== "string") continue;
        const id = item.trim();
        if (id === "" || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * The live mirror's field names — the fields the Host answers through the
 * volatile references and never authors by hand. Every write that lands in the
 * stored row carries this list as **unset** ops: each unset returns the field to
 * the answer beneath its own patch layer — what the row config says — so what
 * only the live references stand drops out of what the write lands instead of
 * riding the write into the file. This is what keeps the persistence boundary
 * from the inside: a live commit answers, a persisted write clears (measured
 * live 2026-10-12: booting the plugin with no user write at all filled the row
 * with the whole live mirror; with the clear riding the write the row stays
 * clean, and a row that already carries leaked live keys is healed by its first
 * write).
 */
export function liveMirrorKeys(): readonly string[] {
    return Object.keys(createLiveMirror());
}

/**
 * The mirror the Host publishes: what every live field answers when nothing has
 * run yet. The whole point of starting from the defaults is that a card reads
 * exactly what a Host with no answers would serve, never a hole.
 */
export function createLiveMirror(): ConfigLiveFields {
    return {
        lastError: "",
        chromeMissing: false,
        executableDiscoveryRevision: 0,
        chromeVersion: "",
        executableStatus: [],
        effectiveChromePath: "",
        effectiveSource: "",
        stderrEffective: "log",
        defaultExtraFlags: readDefaultExtraFlags(),
        wslExtraFlags: readWslExtraFlags(),
        wslWindowsExecutable: false,
        windowsChromeStatus: { state: "off", port: 0, error: "" },
        carriesConnectionMode: false,
        runningFlags: [],
        runningNote: ""
    };
}

/**
 * Read the row's two layers through the settings service. Undefined when the
 * service (or this entry) is not described yet — the cold path, where only the
 * references answer.
 * @param settings - the settings service (`SettingsForms`), when resolved.
 * @param entryId - the profile entry id this row is keyed by.
 */
export function readConfigForm(settings: SettingsForms | undefined, entryId: string): SettingsFormRow | undefined {
    // A service that cannot answer is the same cold path as no service.
    return readFormRow<SettingsFormRow>(settings as never, entryId);
}
