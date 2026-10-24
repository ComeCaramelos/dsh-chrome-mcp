/**
 * Structural views of the modules the shell seeds into its module table.
 *
 * The two `@deepseek-ai/dsh-client-*` ids need describing: they resolve inside
 * the running GUI's module table and appear in no local `node_modules` tree (no
 * `@types/*` for them exist), so they are described here — the same
 * structural-view idiom the host half uses for services it does not depend on —
 * rather than imported. `react`, `react/jsx-runtime` and `react-dom/client`
 * are baseline modules that DO have local types (`@types/react` and
 * `@types/react-dom` are devDependencies, kept external by
 * `scripts/build-client.mjs`), so those imports resolve normally through
 * `node_modules/@types/*`.
 *
 * Keep the shapes as narrow as what this half actually calls; widening them to
 * match upstream's real surface is a drift risk the tests cannot catch.
 */
declare module "@deepseek-ai/dsh-client-store" {
    /** A subscriber store: `getSnapshot` is stable identity, `set` notifies. */
    export interface SnapshotStore<T> {
        subscribe(listener: () => void): () => void;
        getSnapshot(): T;
        set(next: T): void;
    }

    /** Create a snapshot store seeded with `initial`. */
    export function createSnapshotStore<T>(initial: T): SnapshotStore<T>;
}

declare module "@deepseek-ai/dsh-client-ui-primitives" {
    /**
     * A closed-choice dropdown: the list, the portal and the keyboard handling
     * belong to the primitive; the plugin only draws the `anchor`. The card of
     * this plugin uses exactly the subset below — no `selection`, `dense`,
     * `footer` or multi-select — so widening this shape is a drift risk the
     * tests cannot catch.
     */
    export const Menu: (props: {
        open: boolean;
        onClose: () => void;
        items: { id: string; label: string }[];
        selectedId: string;
        onSelect: (id: string) => void;
        align?: string;
        portal?: boolean;
        anchor: any;
    }) => any;

    /**
     * Renders only the control — `label` names it for assistive tech; the
     * card of this plugin uses the control plus its own `label`, so widening
     * this shape is a drift risk the tests cannot catch.
     */
    export const Switch: (props: {
        checked: boolean;
        label?: string;
        disabled?: boolean;
        onChange?: () => void;
    }) => any;

    /**
     * A transient notice: it portals itself to `document.body` and dismisses on
     * its own timer. Only `text`/`icon`/`onDone` are used here — widening this
     * shape is a drift risk the tests cannot catch.
     */
    export const Toast: (props: { text: string; icon?: any; onDone?: () => void }) => any;

    /** 16px warning glyph carried inside a toast. */
    export const IconWarningOutline16: (props?: any) => any;
}
