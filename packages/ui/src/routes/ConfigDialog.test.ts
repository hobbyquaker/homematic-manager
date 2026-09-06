import {fireEvent, render, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import App from '../App.svelte';
import {browserLanguage} from '../lib/i18n/i18n.svelte.js';
import type {StorageLike} from '../lib/stores/AppStore.svelte.js';
import {createStores, type Stores} from '../lib/stores/Stores.svelte.js';
import {DEMO_CONFIG} from '../lib/transport/demoData.js';
import {MockTransport} from '../lib/transport/MockTransport.js';

class MemoryStorage implements StorageLike {
    readonly map = new Map<string, string>();
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

function router(initial = '') {
    const location = {
        _hash: initial,
        get hash(): string {
            return this._hash;
        },
        set hash(value: string) {
            this._hash = value;
        },
    };
    return {location, onHashChange: () => () => {}};
}

async function open(transport: MockTransport): Promise<Stores> {
    const {location, onHashChange} = router();
    const stores = createStores(transport, {location, onHashChange, storage: new MemoryStorage()});
    render(App, {props: {stores}});
    await stores.start();
    await fireEvent.click(screen.getByTestId('settings-button'));
    await waitFor(() => expect(screen.getByTestId('config-dialog')).toBeTruthy());
    return stores;
}

describe('ConfigDialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('shows the whole ConnectionConfig of the backend', async () => {
        await open(transport);

        expect(screen.getByTestId<HTMLInputElement>('config-host').value).toBe('demo.local');
        expect(screen.getByLabelText('Schnittstellen')).toBeTruthy();
        expect(screen.getByText('Gefundene CCUs')).toBeTruthy();
        expect(screen.getByText('ReGa verwenden')).toBeTruthy();
        expect(screen.getByText('RPC-Pause (ms)')).toBeTruthy();
        expect(screen.getByText('RPC-Log-Verzeichnis')).toBeTruthy();
    });

    /**
     * Task 23. The maintainer's complaint was that the dialog reads badly: eighteen rows in one
     * list, with no way to see which of them belong together. The five sections of the roadmap are
     * the structure, and every setting of `ConnectionConfig` is in exactly one of them.
     */
    it('groups the settings into the five titled sections', async () => {
        await open(transport);
        const dialog = screen.getByTestId('config-dialog');
        const titles = [...dialog.querySelectorAll('h3')].map((title) => title.textContent);
        expect(titles).toEqual(['Verbindung', 'Rückruf', 'Schnittstellen', 'ReGa', 'Verhalten']);
    });

    it('takes the host from the discovered list', async () => {
        await open(transport);
        const host = screen.getByTestId<HTMLInputElement>('config-host');

        await fireEvent.change(screen.getByText('Gefundene CCUs').parentElement!.querySelector('select')!, {
            target: {value: 'demo.local'},
        });
        expect(host.value).toBe('demo.local');
    });

    it('enables the auth fields only when auth is switched on, and sends them', async () => {
        await open(transport);
        const user = screen.getByText('Benutzer').parentElement!.querySelector('input') as HTMLInputElement;
        const pass = screen.getByText('Passwort').parentElement!.querySelector('input') as HTMLInputElement;
        expect(user.disabled).toBe(true);

        const authToggle = screen
            .getByText('Authentifizierung verwenden')
            .parentElement!.querySelector('input[type=checkbox]') as HTMLInputElement;
        await fireEvent.click(authToggle);
        expect(user.disabled).toBe(false);

        await fireEvent.input(user, {target: {value: 'Admin'}});
        await fireEvent.input(pass, {target: {value: 'secret'}});
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() =>
            expect(transport.lastCall('config.set')?.[0]?.auth).toEqual({user: 'Admin', password: 'secret'}),
        );
    });

    it('drops the credentials again when auth is switched off', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {...DEMO_CONFIG.connection, auth: {user: 'Admin', password: 'secret'}},
        });
        await open(transport);

        const authToggle = screen
            .getByText('Authentifizierung verwenden')
            .parentElement!.querySelector('input[type=checkbox]') as HTMLInputElement;
        expect(authToggle.checked).toBe(true);

        await fireEvent.click(authToggle);
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => expect(transport.lastCall('config.set')?.[0]).toBeDefined());
        expect(transport.lastCall('config.set')?.[0]?.auth).toBeUndefined();
    });

    it('clears the caches when the box is ticked, after the configuration was accepted', async () => {
        await open(transport);
        const clear = screen
            .getByText('Cache leeren')
            .parentElement!.querySelector('input[type=checkbox]') as HTMLInputElement;
        await fireEvent.click(clear);
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() => expect(transport.countOf('config.clearCaches')).toBe(1));
    });

    /**
     * D-36, task 22: the switch lives here now, not in the header. Its first entry is the browser
     * default; a language chosen here is stored in the profile and applied to the whole shell.
     */
    it('applies a language change to the whole shell and stores it in the profile', async () => {
        const stores = await open(transport);
        const select = screen.getByTestId<HTMLSelectElement>('config-language');
        expect([...select.options].map((option) => option.value)).toEqual(['auto', 'de', 'en']);
        expect(select.value).toBe('de');

        await fireEvent.change(select, {target: {value: 'en'}});
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() => expect(stores.i18n.language).toBe('en'));
        expect(transport.lastCall('config.set')?.[0]?.language).toBe('en');
        expect(screen.getByRole('tab', {name: 'Devices'})).toBeTruthy();
    });

    it('hands the profile back to the browser when the first entry is chosen', async () => {
        const stores = await open(transport);
        await fireEvent.change(screen.getByTestId('config-language'), {target: {value: 'auto'}});
        await fireEvent.click(screen.getByTestId('config-save'));

        // `auto` is written down rather than left out: "I want the browser" is a choice, and it
        // has to survive the next `config.get` (D-36).
        await waitFor(() => expect(transport.lastCall('config.set')?.[0]?.language).toBe('auto'));
        expect(stores.app.languageChoice).toBe('auto');
        // and the shell is in whatever the browser running this test asks for
        expect(stores.i18n.language).toBe(browserLanguage());
    });

    it('keeps the backend untouched when it is cancelled', async () => {
        await open(transport);
        await fireEvent.input(screen.getByTestId('config-host'), {target: {value: 'somewhere-else'}});
        // RpcProgress carries a cancel button of its own, so the query is scoped to the dialog.
        await fireEvent.click(within(screen.getByTestId('config-dialog')).getByText('Abbrechen'));

        await waitFor(() => expect(screen.queryByTestId('config-dialog')?.getAttribute('open')).toBeNull());
        expect(transport.countOf('config.set')).toBe(0);
    });

    it('reports a rejected config.set and stays open', async () => {
        const stores = await open(transport);
        transport.fail('config.set', 'callback port already in use');
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() => expect(stores.notices.items).toHaveLength(1));
        expect(stores.notices.items[0]?.message).toContain('callback port already in use');
        expect(stores.app.configDialogOpen).toBe(true);
    });

    it('starts from a blank connection when the backend has none', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {...DEMO_CONFIG.connection, host: '', interfaces: []},
            discovered: [],
        });
        await open(transport);

        expect(screen.getByTestId<HTMLInputElement>('config-host').value).toBe('');
        // The discovery row is always there now, with the select disabled until something answers:
        // 2.x ran the UDP search once at start-up, so a CCU that booted later never showed up.
        expect(screen.getByTestId<HTMLSelectElement>('config-discovered').disabled).toBe(true);
        expect(screen.getByTestId<HTMLButtonElement>('config-discover').disabled).toBe(false);
    });

    it('offers the ReGa inbox auto-confirm, and greys it out without ReGa (#54, D-2)', async () => {
        await open(transport);
        const box = screen.getByTestId<HTMLInputElement>('config-auto-confirm-inbox');
        expect(box.checked).toBe(false);
        expect(box.disabled).toBe(false);

        // it only means anything while ReGa is on, and the dialog says so rather than hiding it
        const rega = screen
            .getByText('ReGa verwenden')
            .parentElement!.querySelector('input[type=checkbox]') as HTMLInputElement;
        await fireEvent.click(rega);
        await waitFor(() => {
            expect(screen.getByTestId<HTMLInputElement>('config-auto-confirm-inbox').disabled).toBe(true);
        });

        await fireEvent.click(rega);
        await fireEvent.click(screen.getByTestId('config-auto-confirm-inbox'));
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => {
            expect(transport.lastCall('config.set')?.[0]?.autoConfirmRegaInbox).toBe(true);
        });
    });

    it('offers the STICKY_UNREACH auto-acknowledge, off, and saves it when it is ticked (#26)', async () => {
        await open(transport);
        const box = screen.getByTestId<HTMLInputElement>('config-auto-ack-unreach');
        expect(box.checked).toBe(false);

        await fireEvent.click(box);
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => {
            expect(transport.lastCall('config.set')?.[0]?.autoAckStickyUnreach).toBe(true);
        });
    });
});
