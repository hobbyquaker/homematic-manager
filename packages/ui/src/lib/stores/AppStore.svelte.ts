import type {
    AppConfig,
    ConnectionConfig,
    Language,
    LanguageChoice,
    SessionInfo,
    Transport,
} from '@homematic-manager/core';

import {resolveLanguage} from '../i18n/i18n.svelte.js';
import type {NoticesStore} from './NoticesStore.svelte.js';
import {DEFAULT_TAB, formatHash, parseHash, type TabId} from './routing.js';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

export const THEME_STORAGE_KEY = 'hmm.theme';
export const LANGUAGE_STORAGE_KEY = 'hmm.language';

/** The two `localStorage` methods this store uses; a test passes a `Map`-backed stub. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** The two `location` fields the route uses. */
export interface HashLocation {
    hash: string;
}

export interface AppStoreOptions {
    readonly location?: HashLocation | undefined;
    /** Subscribes to external hash changes (back button); returns the unsubscribe function. */
    readonly onHashChange?: ((handler: () => void) => () => void) | undefined;
    readonly storage?: StorageLike | undefined;
    /**
     * The browser's preferred languages, in its own order. Defaults to `navigator.languages`; a
     * test passes a list so that the resolution order of D-36 can be asserted without pretending
     * to be a differently configured browser.
     */
    readonly languages?: readonly string[] | undefined;
}

function defaultLocation(): HashLocation {
    return typeof window === 'undefined' ? {hash: ''} : window.location;
}

function defaultHashSubscribe(handler: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }
    window.addEventListener('hashchange', handler);
    return () => {
        window.removeEventListener('hashchange', handler);
    };
}

export function defaultStorage(): StorageLike | undefined {
    try {
        return typeof localStorage === 'undefined' ? undefined : localStorage;
    } catch {
        // A browser configured to block site data throws on the accessor itself.
        return undefined;
    }
}

/** `localStorage`, or `undefined` where the browser refuses it. */

/**
 * The shell's own state: configuration, the selected interface, the active tab, language and
 * theme - plus the `#/<interface>/<tab>` route that keeps 2.x links working.
 *
 * The connection state here is the one to the *backend* (Electron IPC or WebSocket); whether the
 * CCU's interface processes answer is `InterfacesStore`. 2.x conflated the two and showed
 * "Disconnected" for both.
 */
export class AppStore {
    config = $state<AppConfig | undefined>(undefined);
    /** True until the first `config.get` answered - what the 2.x `#loader` overlay covered. */
    loading = $state(true);
    connected = $state(false);
    selectedInterface = $state('');
    tab = $state<TabId>(DEFAULT_TAB);
    /**
     * Issue #25: what the Links tab should filter on when it is opened from somewhere else. Set by
     * the Devices tab's "show links", consumed and cleared by the Links tab on the next render, so
     * it is a hand-over and not a persistent filter the user cannot get rid of.
     */
    linksFilter = $state('');
    /**
     * The language the UI is actually in - always a real one, never `auto` (D-36).
     *
     * `languageChoice` is what the user asked for and what is stored; this is what that resolves
     * to once the browser has had its say. Everything that renders reads this one.
     */
    language = $state<Language>('en');
    /** What the settings dialog shows: a language, or `auto` for "the browser decides". */
    languageChoice = $state<LanguageChoice>('auto');
    theme = $state<ThemeChoice>('system');
    /**
     * D-32: who is logged in, where the host has a login at all.
     *
     * `null` everywhere else - Electron, the npm install, Docker, the demo and the CCU addon in
     * its default token mode - and the header then shows neither a user nor a logout link. Read
     * once at start-up: a session cannot change while the page is open, only end, and the socket
     * closing is what shows that.
     */
    session = $state<SessionInfo | null>(null);
    /** Open state of the settings dialog; opened automatically when no host is configured. */
    configDialogOpen = $state(false);
    /** Open state of the RPC log drawer that replaces the modal `dialog-rpc` of 2.x. */
    rpcLogOpen = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #location: HashLocation;
    readonly #storage: StorageLike | undefined;
    readonly #languages: readonly string[] | undefined;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, notices: NoticesStore, options: AppStoreOptions = {}) {
        this.#transport = transport;
        this.#notices = notices;
        this.#location = options.location ?? defaultLocation();
        this.#storage = options.storage === undefined ? defaultStorage() : options.storage;
        this.#languages = options.languages;

        const stored = this.#storage?.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
            this.theme = stored;
        }
        // A local choice - the one made in the settings dialog of this browser - before the profile
        // has even been asked for, so the loading screen is already in the right language.
        const storedLanguage = this.#storage?.getItem(LANGUAGE_STORAGE_KEY);
        if (storedLanguage === 'de' || storedLanguage === 'en' || storedLanguage === 'auto') {
            this.languageChoice = storedLanguage;
        }
        this.#applyLanguage();

        this.readRoute();
        this.connected = transport.connected;
        this.#unsubscribe.push(
            transport.onConnectionChange((connected) => {
                this.connected = connected;
            }),
            transport.on('config.changed', (config) => {
                this.config = config;
            }),
            (options.onHashChange ?? defaultHashSubscribe)(() => {
                this.readRoute();
            }),
        );
    }

    /** Takes interface and tab from the current hash. */
    readRoute(): void {
        const route = parseHash(this.#location.hash);
        if (route.interfaceName !== '') {
            this.selectedInterface = route.interfaceName;
        }
        this.tab = route.tab;
    }

    /** Writes interface and tab back into the hash, in the 2.x format. */
    writeRoute(): void {
        const hash = formatHash(this.selectedInterface, this.tab);
        if (this.#location.hash !== hash) {
            this.#location.hash = hash;
        }
    }

    setTab(tab: TabId): void {
        this.tab = tab;
        this.writeRoute();
    }

    setInterface(interfaceName: string): void {
        this.selectedInterface = interfaceName;
        this.writeRoute();
    }

    /**
     * What the settings dialog does: store the choice - `auto` included - and resolve it.
     *
     * The choice is kept in `localStorage` as well as in the profile, so a browser that has been
     * told once starts in that language before `config.get` has answered. `auto` is stored as
     * itself rather than by clearing the key: "the user asked for the browser" and "the user never
     * touched this" behave the same but are not the same thing, and only the first one should
     * survive somebody else's profile saying German.
     */
    setLanguage(choice: LanguageChoice): void {
        this.languageChoice = choice;
        this.#applyLanguage();
        this.#storage?.setItem(LANGUAGE_STORAGE_KEY, choice);
    }

    #applyLanguage(): void {
        this.language = resolveLanguage(this.languageChoice, this.#languages);
    }

    setTheme(theme: ThemeChoice): void {
        this.theme = theme;
        this.#storage?.setItem(THEME_STORAGE_KEY, theme);
    }

    /** `system` -> `light` -> `dark` -> `system`, the order the header button cycles through. */
    cycleTheme(): void {
        const index = THEME_CHOICES.indexOf(this.theme);
        this.setTheme(THEME_CHOICES[(index + 1) % THEME_CHOICES.length] ?? 'system');
    }

    /** The interfaces the configuration asks for, user-defined ones included. */
    get configuredInterfaces(): string[] {
        return this.config?.connection.interfaces ?? [];
    }

    /** The host the header shows next to the connection marks. */
    get host(): string {
        return this.config?.connection.host ?? '';
    }

    /** Loads the configuration. Opens the settings dialog when no host is configured yet. */
    async load(): Promise<void> {
        try {
            const config = await this.#transport.request('config.get');
            this.applyConfig(config);
        } catch (error) {
            this.#notices.fromError(error, 'config.get');
        } finally {
            this.loading = false;
        }
        await this.loadSession();
    }

    /**
     * D-32: asks the transport who is logged in.
     *
     * Its own try/catch and no notice: a host that does not know the method is simply one without
     * a login, and an error toast about a feature the user has not switched on would be noise.
     */
    async loadSession(): Promise<void> {
        try {
            this.session = await this.#transport.request('session.info');
        } catch {
            this.session = null;
        }
    }

    /** Persists a changed connection and applies what the backend answered. */
    async save(connection: ConnectionConfig): Promise<boolean> {
        try {
            this.applyConfig(await this.#transport.request('config.set', connection));
            this.configDialogOpen = false;
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'config.set');
            return false;
        }
    }

    async discover(): Promise<void> {
        try {
            const discovered = await this.#transport.request('config.discover');
            if (this.config) {
                this.config = {...this.config, discovered};
            }
        } catch (error) {
            this.#notices.fromError(error, 'config.discover');
        }
    }

    async clearCaches(): Promise<void> {
        try {
            await this.#transport.request('config.clearCaches');
        } catch (error) {
            this.#notices.fromError(error, 'config.clearCaches');
        }
    }

    /**
     * Takes over a configuration: the language when the user has not chosen one locally, and the
     * first configured interface when the route did not name one.
     *
     * D-36's order, from strong to weak: what was chosen in *this* browser, then what the profile
     * stores, then what the browser asks for. A profile without a language is `auto` - the backend
     * writes none into a fresh profile any more - and resolves to the browser.
     */
    applyConfig(config: AppConfig): void {
        this.config = config;
        if (this.#storage?.getItem(LANGUAGE_STORAGE_KEY) == null) {
            this.languageChoice = config.connection.language ?? 'auto';
            this.#applyLanguage();
        }
        if (this.selectedInterface === '' || !config.connection.interfaces.includes(this.selectedInterface)) {
            this.selectedInterface = config.connection.interfaces[0] ?? '';
        }
        this.writeRoute();
        if (config.connection.host === '') {
            this.configDialogOpen = true;
        }
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
