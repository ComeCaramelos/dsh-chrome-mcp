/**
 * Browser half — the plugin body.
 *
 * The entry the loader calls: inject the stylesheet, hand the shell the
 * card's locales, bind the namespace scope behind the controller, and mount
 * the card into the Settings → Plugins → Plugin configuration slot keyed by
 * the `chrome-mcp` namespace the host half serves. Every other module here is
 * a dependency of this one, never the other way round.
 */
import { ChromeMcpCard } from "./card/index.js";
import { ChromeMcpCardController } from "./controller/index.js";
import { DICTIONARIES } from "./locales/index.js";
import { LOCALE_NAMESPACE, SETTINGS_NAMESPACE } from "./plugin-meta.js";
import { injectCardStyles } from "./styles/index.js";

/** Browser plugin context as provided by the DSH shell. */
export interface BrowserPluginContext {
    effect(fn: () => (() => void) | void, label?: string): void;
    locale: {
        register(namespace: string, dicts: Record<string, Record<string, string>>): void;
    };
    settingsScope: {
        bind(spec: { namespace: string }): {
            getSnapshot(): { status: string; value?: Record<string, unknown> };
            subscribe(fn: () => void): () => void;
            set(field: string, value: unknown): Promise<void>;
        };
        describe(): { load(): Promise<unknown> };
    };
    slots: {
        inject(slot: string, register: () => void): void;
        register(
            spec: { name: string; key: string; locale: string; inject: () => Record<string, unknown> },
            Component: (props: any) => unknown
        ): void;
    };
}

/**
 * Mount the settings/status card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: BrowserPluginContext): void {
    injectCardStyles();
    ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES), `${SETTINGS_NAMESPACE}: dictionaries`);
    const binder = ctx.settingsScope;
    const scope = binder.bind({ namespace: SETTINGS_NAMESPACE });
    // The shared describe mirror: an executable action re-reads it while the
    // host's in-memory check status is en route.
    const controller = new ChromeMcpCardController(scope as any, binder.describe());
    ctx.effect(
        () => () => controller.dispose(),
        `${SETTINGS_NAMESPACE}: card controller`
    );
    ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
            {
                name: "settings.plugin.item",
                key: SETTINGS_NAMESPACE,
                locale: LOCALE_NAMESPACE,
                inject: () => controller.inject()
            },
            ChromeMcpCard as any
        ));
}
