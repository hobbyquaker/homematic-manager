import {fireEvent, render, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import App from '../App.svelte';
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

        expect((screen.getByTestId('config-host') as HTMLInputElement).value).toBe('demo.local');
        expect(screen.getByLabelText('Schnittstellen')).toBeTruthy();
        expect(screen.getByText('Gefundene CCUs')).toBeTruthy();
        expect(screen.getByText('ReGa verwenden')).toBeTruthy();
        expect(screen.getByText('RPC-Pause (ms)')).toBeTruthy();
        expect(screen.getByText('RPC-Log-Verzeichnis')).toBeTruthy();
    });

    it('takes the host from the discovered list', async () => {
        await open(transport);
        const host = screen.getByTestId('config-host') as HTMLInputElement;

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

    it('applies a language change to the whole shell', async () => {
        const stores = await open(transport);
        const select = screen.getByText('Sprache').parentElement!.querySelector('select') as HTMLSelectElement;
        await fireEvent.change(select, {target: {value: 'en'}});
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() => expect(stores.i18n.language).toBe('en'));
        expect(screen.getByRole('tab', {name: 'Devices'})).toBeTruthy();
    });

    it('keeps the backend untouched when it is cancelled', async () => {
        await open(transport);
        await fireEvent.input(screen.getByTestId('config-host'), {target: {value: 'somewhere-else'}});
        await fireEvent.click(screen.getByText('Abbrechen'));

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

        expect((screen.getByTestId('config-host') as HTMLInputElement).value).toBe('');
        expect(screen.queryByText('Gefundene CCUs')).toBeNull();
    });
});
