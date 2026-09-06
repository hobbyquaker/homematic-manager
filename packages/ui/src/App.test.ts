import {fireEvent, render, screen, waitFor} from '@testing-library/svelte';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import App from './App.svelte';
import type {StorageLike} from './lib/stores/AppStore.svelte.js';
import {createStores, type Stores} from './lib/stores/Stores.svelte.js';
import {DEMO_CONFIG, DEMO_INTERFACE_STATES} from './lib/transport/demoData.js';
import {MockTransport} from './lib/transport/MockTransport.js';

class MemoryStorage implements StorageLike {
    readonly map = new Map<string, string>();
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

function fakeRouter(initial = '') {
    const handlers = new Set<() => void>();
    const location = {
        _hash: initial,
        get hash(): string {
            return this._hash;
        },
        set hash(value: string) {
            this._hash = value;
        },
    };
    return {
        location,
        onHashChange: (handler: () => void) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
    };
}

async function mountApp(transport = new MockTransport({demo: true}), hash = ''): Promise<{stores: Stores}> {
    const router = fakeRouter(hash);
    const stores = createStores(transport, {
        location: router.location,
        onHashChange: router.onHashChange,
        storage: new MemoryStorage(),
    });
    render(App, {props: {stores}});
    await stores.start();
    await waitFor(() => expect(stores.app.loading).toBe(false));
    return {stores};
}

describe('App shell', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        document.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows the six 2.7 tabs in their order, in German', async () => {
        await mountApp(transport);
        const labels = screen.getAllByRole('tab').map((tab) => tab.textContent.replace(/\s+/g, ' ').trim());
        expect(labels).toEqual([
            'Geräte',
            'Verknüpfungen',
            'Funk',
            'RPC Konsole',
            'Servicemeldungen (2)',
            'Ereignisse',
        ]);
    });

    /**
     * Task 21: the header carries the selected interface and one mark; the CCU, the backend state
     * and the per-interface marks are in the popup, with what the UI knows under every name.
     */
    it('shows the selected interface with one summary mark, and the CCU inside the popup', async () => {
        await mountApp(transport);
        const trigger = screen.getByTestId('interface-select-trigger');
        expect(trigger.textContent).toContain('BidCos-RF');
        // the demo has an interface that does not answer, so the summary is the red one
        expect(screen.getByTestId('interface-select-summary').getAttribute('data-mark')).toBe('bad');

        await fireEvent.click(trigger);
        expect(screen.getByTestId('interface-host').textContent).toBe('demo.local');
        expect(screen.getByTestId('interface-backend').textContent).toBe('Verbunden');
        const options = [...screen.getByTestId('interface-select').querySelectorAll('[role="option"]')];
        expect(options.map((option) => option.getAttribute('data-testid'))).toEqual([
            'interface-item-BidCos-RF',
            'interface-item-HmIP-RF',
            'interface-item-BidCos-Wired',
            'interface-item-CUxD',
            'interface-item-VirtualDevices',
        ]);

        // the devices of the selected interface are loaded, so its line has the count as well
        const line = screen
            .getByTestId('interface-item-BidCos-RF')
            .querySelector('.hmm-interface-item-line')!.textContent;
        expect(line).toBe('xmlrpc · Port 2001 · 8 Geräte');
        expect(screen.getByTestId('interface-item-CUxD').querySelector('.hmm-interface-item-line')!.textContent).toBe(
            'binrpc · Port 8701',
        );
    });

    it('switches the interface from the popup and writes the 2.x hash', async () => {
        const {stores} = await mountApp(transport);
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        await fireEvent.click(screen.getByTestId('interface-item-HmIP-RF'));

        await waitFor(() => expect(stores.app.selectedInterface).toBe('HmIP-RF'));
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.getByRole('columnheader', {name: 'SUBTYPE'})).toBeTruthy();
    });

    it('lists the devices of the selected interface with the 2.7 columns', async () => {
        await mountApp(transport);
        expect(screen.getByTestId('devices-table')).toBeTruthy();
        for (const label of ['ADDRESS', 'Msgs', 'TYPE', 'FIRMWARE', 'PARAMSETS', 'FLAGS', 'RX_MODE']) {
            expect(screen.getByRole('columnheader', {name: new RegExp(label)})).toBeTruthy();
        }
        expect(screen.getByText('Licht Küche')).toBeTruthy();
        expect(screen.getByText('HM-LC-Sw1-Pl-CT-R1')).toBeTruthy();
        // SUBTYPE is a HmIP column; BidCos-RF hides it, as `initDaemon` did.
        expect(screen.queryByRole('columnheader', {name: 'SUBTYPE'})).toBeNull();
    });

    it('expands a device into its channels', async () => {
        await mountApp(transport);
        const expanders = screen.getAllByRole('button', {name: 'Expand row'});
        await fireEvent.click(expanders[0]!);
        // The channel has no friendly name, so its address shows in the Name column too.
        expect(screen.getAllByText('BidCoS-RF:0').length).toBeGreaterThan(0);
    });

    it('switches the tab, writes the 2.x hash and draws the other pages', async () => {
        const {stores} = await mountApp(transport, '#/BidCos-RF/devices');

        await fireEvent.click(screen.getByRole('tab', {name: 'Verknüpfungen'}));
        expect(stores.app.tab).toBe('links');
        expect(screen.getByTestId('links-table')).toBeTruthy();
        expect(screen.getByText('Taster Flur - Licht Küche')).toBeTruthy();

        await fireEvent.click(screen.getByRole('tab', {name: 'Funk'}));
        expect(screen.getByTestId('radio-table')).toBeTruthy();

        await fireEvent.click(screen.getByRole('tab', {name: 'RPC Konsole'}));
        expect(screen.getByLabelText('Antwort')).toBeTruthy();

        await fireEvent.click(screen.getByRole('tab', {name: /Servicemeldungen/}));
        expect(screen.getByTestId('messages-table')).toBeTruthy();
        expect(screen.getByText('STICKY_UNREACH')).toBeTruthy();

        await fireEvent.click(screen.getByRole('tab', {name: 'Ereignisse'}));
        expect(screen.getByTestId('events-table')).toBeTruthy();
    });

    it('restores interface and tab from the hash a 2.x bookmark carries', async () => {
        const {stores} = await mountApp(transport, '#/HmIP-RF/events');
        expect(stores.app.selectedInterface).toBe('HmIP-RF');
        expect(screen.getByTestId('events-table')).toBeTruthy();
    });

    it('shows the HmIP SUBTYPE column after switching the interface', async () => {
        const {stores} = await mountApp(transport, '#/HmIP-RF/devices');
        expect(stores.app.selectedInterface).toBe('HmIP-RF');
        expect(screen.getByRole('columnheader', {name: 'SUBTYPE'})).toBeTruthy();
        // HmIP has no RSSI matrix, so 2.x's "Funk" tab is not offered.
        expect(screen.queryByRole('tab', {name: 'Funk'})).toBeNull();
    });

    it('appends live events to the events tab', async () => {
        await mountApp(transport, '#/BidCos-RF/events');
        transport.emit('rpc.event', {
            timestamp: Date.parse('2026-09-05T10:00:00Z'),
            interfaceName: 'BidCos-RF',
            method: 'event',
            address: 'MEQ0123456:1',
            datapoint: 'BOOM',
            value: true,
        });
        await waitFor(() => expect(screen.getByText('BOOM')).toBeTruthy());
    });

    it('switches the language and updates <html lang>', async () => {
        await mountApp(transport);
        expect(document.documentElement.lang).toBe('de');

        await fireEvent.change(screen.getByLabelText('Sprache'), {target: {value: 'en'}});
        await waitFor(() => expect(screen.getByRole('tab', {name: 'Devices'})).toBeTruthy());
        expect(document.documentElement.lang).toBe('en');
    });

    it('cycles the theme and stamps it on the root element', async () => {
        const {stores} = await mountApp(transport);
        expect(document.documentElement.getAttribute('data-theme')).toBeNull();

        await fireEvent.click(screen.getByTestId('theme-switch'));
        expect(stores.app.theme).toBe('light');
        await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));

        await fireEvent.click(screen.getByTestId('theme-switch'));
        await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));

        await fireEvent.click(screen.getByTestId('theme-switch'));
        await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBeNull());
    });

    it('opens the RPC log drawer and lists the write log', async () => {
        await mountApp(transport);
        await fireEvent.click(screen.getByTestId('rpclog-toggle'));
        expect(screen.getByText('Unknown parameter PROFILE_MODE')).toBeTruthy();

        transport.emit('writeLog.appended', {
            id: 3,
            timestamp: Date.parse('2026-09-05T10:01:00Z'),
            interfaceName: 'BidCos-RF',
            method: 'setValue',
            params: ['MEQ0123456:1', 'STATE', true],
            ok: true,
            durationMs: 42,
        });
        await waitFor(() => expect(screen.getByText('42 ms')).toBeTruthy());
    });

    it('opens and closes the settings dialog with the CCU address filled in', async () => {
        await mountApp(transport);
        await fireEvent.click(screen.getByTestId('settings-button'));

        const host = screen.getByTestId<HTMLInputElement>('config-host');
        expect(host.value).toBe('demo.local');

        await fireEvent.input(host, {target: {value: 'ccu3'}});
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => expect(transport.lastCall('config.set')?.[0]?.host).toBe('ccu3'));
    });

    it('opens the about dialog', async () => {
        await mountApp(transport);
        await fireEvent.click(screen.getByTestId('about-button'));
        expect(screen.getByText(/Homematic Manager 3\.0\.0-dev\.0/)).toBeTruthy();
    });

    it('shows a notice the backend pushed and lets it be dismissed', async () => {
        await mountApp(transport);
        transport.emit('notice', {level: 'warn', message: 'ReGa antwortet nicht', interfaceName: 'ReGa'});
        await waitFor(() => expect(screen.getByText(/ReGa antwortet nicht/)).toBeTruthy());

        await fireEvent.click(screen.getByLabelText('Ausblenden'));
        await waitFor(() => expect(screen.queryByText(/ReGa antwortet nicht/)).toBeNull());
    });

    it('greys the summary mark out when the backend goes away', async () => {
        await mountApp(transport);
        transport.setConnected(false);
        await waitFor(() =>
            expect(screen.getByTestId('interface-select-summary').classList.contains('hmm-connection-offline')).toBe(
                true,
            ),
        );
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        expect(screen.getByTestId('interface-backend').textContent).toBe('Nicht verbunden');
    });

    it('opens the settings dialog by itself when no CCU is configured', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {...DEMO_CONFIG.connection, host: '', interfaces: []},
        });
        const {stores} = await mountApp(transport);
        expect(stores.app.configDialogOpen).toBe(true);
        expect(screen.getByTestId('config-dialog')).toBeTruthy();
        // No interface, no grid - the shell says so instead of drawing an empty one.
        expect(screen.getByText('Schnittstelle auswählen')).toBeTruthy();
    });

    /**
     * 2.7 hid its picker when there was nothing to pick, and so did this shell until task 21. The
     * popup stays: it is not only the picker any more but the one place that says what the CCU and
     * its interfaces are doing, and a Homegear with a single interface needs that as much as a CCU.
     */
    it('keeps the interface popup when there is only one interface', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {...DEMO_CONFIG.connection, interfaces: ['BidCos-RF']},
        });
        await mountApp(transport);
        expect(screen.getByTestId('interface-select-trigger').textContent).toContain('BidCos-RF');
    });

    it('refreshes the devices from the toolbar', async () => {
        await mountApp(transport);
        transport.reset();
        await fireEvent.click(screen.getByTestId('devices-refresh'));
        await waitFor(() => expect(transport.lastCall('devices.list')).toEqual(['BidCos-RF', {refresh: true}]));
    });

    it('shows neither a user nor a logout link where the host has no login (D-32)', async () => {
        const {stores} = await mountApp(transport);
        expect(stores.app.session).toBeNull();
        expect(screen.queryByTestId('session-user')).toBeNull();
        expect(screen.queryByTestId('session-logout')).toBeNull();
    });

    it('shows the user and a logout link when there is a session (D-32)', async () => {
        transport.result('session.info', {user: 'Admin', level: 8});
        const {stores} = await mountApp(transport);
        expect(stores.app.session).toEqual({user: 'Admin', level: 8});
        expect(screen.getByTestId('session-user').textContent).toBe('Admin');
        const logout = screen.getByTestId('session-logout');
        expect(logout.textContent).toBe('Abmelden');
        // relative to the page's own directory, like the api socket - so it is right at `/` and
        // under `/addons/hmm/` alike
        expect(logout.getAttribute('href')).toBe('logout');
    });

    it('degrades to no session when the host does not know the method at all', async () => {
        transport.fail('session.info', {message: 'unknown API method', kind: 'config'});
        const {stores} = await mountApp(transport);
        expect(stores.app.session).toBeNull();
        expect(stores.notices.items).toHaveLength(0);
    });
});

/**
 * Task 19's rule for the one bar the user looks at all day, extended in task 21: the header held a
 * connection block that grew a line per interface and shrank again, and it stood between the tabs
 * and the actions. What is there now is a trigger of a fixed width with a mark in a fixed box, so
 * an interface that reconnects, one that is re-subscribing and a switch to a longer interface name
 * all leave the header exactly where it was.
 */
describe.skipIf(document.body.getBoundingClientRect().width === 0)('the header stands still', () => {
    const tabLefts = (): number[] =>
        screen.getAllByRole('tab').map((tab) => Math.round(tab.getBoundingClientRect().left));

    const frame = (selector: string): string => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height].map((value) => Math.round(value)).join('/');
    };

    it('does not move when the interface states change', async () => {
        const transport = new MockTransport({demo: true});
        await mountApp(transport);
        const tabs = tabLefts();
        const trigger = frame('.hmm-interface-trigger');
        const tablist = frame('[role="tablist"]');
        expect(tabs).toHaveLength(6);

        for (const change of [
            DEMO_INTERFACE_STATES.map((state) => ({...state, connected: true, absent: false, subscribing: false})),
            DEMO_INTERFACE_STATES.map((state) => ({...state, connected: false, absent: false, subscribing: true})),
            DEMO_INTERFACE_STATES.map((state) => ({...state, connected: false, absent: false, subscribing: false})),
        ]) {
            transport.emit('interfaces.changed', change);
            await waitFor(() => expect(screen.getByTestId('interface-select-summary')).toBeTruthy());
            expect(frame('.hmm-interface-trigger'), 'the trigger changed size').toBe(trigger);
            expect(frame('[role="tablist"]'), 'the tab bar moved').toBe(tablist);
            expect(tabLefts(), 'a tab moved').toEqual(tabs);
        }

        // and a backend that has lost every interface leaves the trigger where it was as well; the
        // tab bar itself is shorter then, because the tabs follow the interface type (`initDaemon`)
        transport.emit('interfaces.changed', []);
        await waitFor(() =>
            expect(screen.getByTestId('interface-select-summary').getAttribute('data-mark')).toBe('absent'),
        );
        expect(frame('.hmm-interface-trigger')).toBe(trigger);
        expect(frame('[role="tablist"]').split('/').slice(0, 2)).toEqual(tablist.split('/').slice(0, 2));
    });

    it('does not move when a longer interface name is selected', async () => {
        const transport = new MockTransport({demo: true});
        const {stores} = await mountApp(transport);
        const trigger = frame('.hmm-interface-trigger');
        const tabsLeft = frame('[role="tablist"]').split('/').slice(0, 2).join('/');

        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        await fireEvent.click(screen.getByTestId('interface-item-VirtualDevices'));
        await waitFor(() => expect(stores.app.selectedInterface).toBe('VirtualDevices'));

        expect(frame('.hmm-interface-trigger'), 'a longer name made the trigger wider').toBe(trigger);
        // The bar itself is narrower - VirtualDevices offers fewer tabs than BidCos-RF - but it
        // still starts where it started, which is what the trigger is responsible for.
        expect(frame('[role="tablist"]').split('/').slice(0, 2).join('/')).toBe(tabsLeft);
    });
});
