/**
 * Host half — the **prelaunch_windows_chrome** tool.
 *
 * The second trigger of the same Windows Chrome run the card button drives:
 * the run itself lives in ./windows/, the queueing + state mirror in the
 * controller, and registering the tool is plain wiring — the definition adds
 * no logic of its own, it just hands the model the button's action (the run
 * answers through `windowsChromeStatus`, exactly like a click does).
 *
 * The two registration rules this module keeps:
 *
 * - The tools service is injected **at mount time**, not statically: our own
 *   nested mcp-client row is what publishes the bridge's tools, so a static
 *   `inject: ["tools"]` on this plugin would risk the same load-order cycle
 *   the tool-result listener bullet warns about. `ctx.inject` resolves the
 *   service lazily, which is what the listener idiom already relies on.
 * - The registration lives on one fiber effect. An HMR reload disposes the
 *   old instance's effect first, so the tool re-registers cleanly instead of
 *   colliding with a still-held global registration; the effect body guards
 *   against the tools service resolving twice for one instance.
 */
import type { ChromeMcpController } from "./controller/index.js";
import type { PluginContext } from "./types/index.js";

/** Model-facing name, registered globally by this host half. */
export const PRELAUNCH_WINDOWS_CHROME_NAME = "prelaunch_windows_chrome";

/** One `{type:"text"}` content block — the only block the render projects. */
type ToolContent = { type: "text"; text: string };

/**
 * Structural surface of the harness tools service, typed here the way the
 * shell-module stubs are: the service lives in the loader's module table, and
 * this module only needs to hand it a definition.
 */
interface ToolDefinitionLike {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: unknown;
        render(args: unknown, value: unknown): ToolContent[];
    };
    execute(): Promise<{ text: string }>;
}
interface ToolsServiceLike {
    register(definition: ToolDefinitionLike): () => void;
}

/** The one-argument-free definition: all decisions are the host's. */
export function prelaunchWindowsChromeDefinition(controller: ChromeMcpController): ToolDefinitionLike {
    return {
        name: PRELAUNCH_WINDOWS_CHROME_NAME,
        description:
            "Open the Windows-side Chrome on WSL and switch the Chrome bridge to connect mode — the same run the card's Prelaunch Windows Chrome button drives. " +
            "Takes no arguments: the host locates the Windows browser, checks that the Windows loopback is reachable from this WSL host " +
            "(networkingMode=mirrored is a manual Windows-side setting it only reads), picks the first free debugging port, launches with a " +
            "Windows-side profile under LOCALAPPDATA linked into the workspace as .chrome, opens a packaged page in that window explaining " +
            "that it was opened by the plugin so the agent can drive it from WSL, and connects on the port's address. On a non-WSL host it answers \"not applicable\". " +
            "The browser it started is never closed by the plugin.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        output: {
            schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
            render(_args: unknown, value: unknown): ToolContent[] {
                const text = value === null || typeof value !== "object" ? "" : (value as { text?: unknown }).text;
                return [{ type: "text", text: typeof text === "string" ? text : "" }];
            }
        },
        execute: async () => ({ text: await controller.prelaunchWindowsChrome() })
    };
}

/**
 * Register the tool on one fiber effect, resolving the tools service lazily. A
 * host without one (no model assembled) simply gets no registration — the card
 * button stays the only trigger.
 * @param ctx - plugin context.
 * @param controller - the live state whose run this tool drives.
 */
export function installPrelaunchWindowsChromeTool(ctx: PluginContext, controller: ChromeMcpController): void {
    ctx.effect(() => {
        let registered = false;
        let unregister: (() => void) | undefined;
        ctx.inject(["tools"], (inner: PluginContext) => {
            if (registered) return;
            const tools = (inner as { tools?: ToolsServiceLike }).tools;
            if (!tools) return;
            registered = true;
            unregister = tools.register(prelaunchWindowsChromeDefinition(controller));
        });
        return () => {
            if (unregister) unregister();
            registered = false;
        };
    }, "chrome-mcp: prelaunch_windows_chrome tool");
}
