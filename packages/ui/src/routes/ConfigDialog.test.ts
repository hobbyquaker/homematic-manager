import {INTERFACE_NAMES} from '@homematic-manager/core';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import App from '../App.svelte';
import {browserLanguage} from '../lib/i18n/i18n.svelte.js';
import type {StorageLike} from '../lib/stores/AppStore.svelte.js';
import {createStores, type Stores} from '../lib/stores/Stores.svelte.js';
import {DEMO_CONFIG, demoCallbackAddresses} from '../lib/transport/demoData.js';
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

    /** Task 31: the two-line entries are the link dialog's; the interface list keeps one line each. */
    it('keeps its interface list at one plain line per entry', async () => {
        await open(transport);
        const trigger = screen.getByLabelText('Schnittstellen');
        await fireEvent.click(trigger);
        const root = trigger.closest<HTMLElement>('.hmm-multiselect')!;
        const options = await waitFor(() => {
            const found = within(root).getAllByRole('option');
            expect(found.length).toBeGreaterThan(0);
            return found;
        });
        for (const option of options) {
            expect(option.classList.contains('hmm-multiselect-two-lines')).toBe(false);
            expect(option.querySelector('.hmm-multiselect-lines')).toBeNull();
            expect(getComputedStyle(option).paddingTop).toBe('2px');
            expect(getComputedStyle(option).paddingLeft).toBe('6px');
        }
        const menu = root.querySelector<HTMLElement>('.hmm-multiselect-menu')!;
        expect(getComputedStyle(menu).maxWidth).toBe('360px');
        expect(getComputedStyle(root.querySelector<HTMLElement>('.hmm-multiselect-list')!).maxHeight).toBe('260px');
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
    it('groups the settings into the six titled sections', async () => {
        await open(transport);
        const dialog = screen.getByTestId('config-dialog');
        const titles = [...dialog.querySelectorAll('h3')].map((title) => title.textContent);
        expect(titles).toEqual(['Verbindung', 'Rückruf', 'Namen und Räume', 'Schnittstellen', 'ReGa', 'Verhalten']);
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

    /**
     * Task 32 (#149): the notice during the reconnect is a status, not a footnote - a live region
     * with a turning ring in front of the text, for as long as `config.set` has not answered.
     */
    it('announces the reconnect as a status with a spinner while config.set runs', async () => {
        await open(transport);
        let answer: (() => void) | undefined;
        transport.respond(
            'config.set',
            (connection) =>
                new Promise((resolve) => {
                    answer = () => resolve({...DEMO_CONFIG, connection});
                }),
        );
        await fireEvent.click(screen.getByTestId('config-clear-cache'));
        await fireEvent.click(screen.getByTestId('config-save'));

        const notice = await waitFor(() => screen.getByTestId('config-saving'));
        expect(notice.getAttribute('role')).toBe('status');
        expect(notice.getAttribute('aria-live')).toBe('polite');
        expect(within(notice).getByTestId('config-saving-spinner').getAttribute('aria-hidden')).toBe('true');
        expect(notice.textContent).toContain('Wird gespeichert');
        expect(screen.queryByTestId('config-error')).toBeNull();

        answer?.();
        await waitFor(() => expect(screen.queryByTestId('config-saving')).toBeNull());
    });

    it('shows only the error, not the notice, when the save fails', async () => {
        await open(transport);
        transport.fail('config.set', 'callback port already in use');
        await fireEvent.click(screen.getByTestId('config-clear-cache'));
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() => expect(screen.getByTestId('config-error').textContent).toContain('already in use'));
        expect(screen.queryByTestId('config-saving')).toBeNull();
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

    it('says why ReGa is off on a system without ReGaHSS, and does not offer the inbox (B-62)', async () => {
        transport.result('rega.state', {enabled: false, reachable: false, names: 0, reason: 'openccu-lite'});
        await open(transport);

        // greyed out with the reason, not hidden (D-2's pattern); the profile's own value is not touched
        const rega = screen.getByTestId<HTMLInputElement>('config-rega');
        expect(rega.disabled).toBe(true);
        expect(rega.checked).toBe(false);
        expect(screen.getByText('Abgeschaltet: das System hat kein ReGaHSS')).toBeTruthy();
        expect(screen.queryByTestId('config-auto-confirm-inbox')).toBeNull();

        // another address is another system: the switch is a switch again
        await fireEvent.input(screen.getByTestId('config-host'), {target: {value: 'other.lan'}});
        await waitFor(() => {
            expect(screen.getByTestId<HTMLInputElement>('config-rega').disabled).toBe(false);
        });
        expect(screen.getByTestId('config-auto-confirm-inbox')).toBeTruthy();
    });

    /** The demo list minus its one STICKY_UNREACH, so nothing is there to ask about. */
    function withoutSticky(): void {
        transport.result('serviceMessages.list', [
            {interfaceName: 'BidCos-RF', address: 'LEQ0456789:0', datapoint: 'LOWBAT', value: true, since: 0},
            // HmIP is not asked about: nothing is acknowledged there (D-42)
            {interfaceName: 'HmIP-RF', address: '0001D3C99ABCDE:0', datapoint: 'STICKY_UNREACH', value: true, since: 0},
        ]);
    }

    it('offers the STICKY_UNREACH auto-acknowledge, off, and saves it when it is ticked (#26)', async () => {
        withoutSticky();
        await open(transport);
        const box = screen.getByTestId<HTMLInputElement>('config-auto-ack-unreach');
        expect(box.checked).toBe(false);

        await fireEvent.click(box);
        // no STICKY_UNREACH outside HmIP in the list: it switches on without a question
        expect(screen.queryByTestId('auto-ack-question')?.hasAttribute('open') ?? false).toBe(false);
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => {
            expect(transport.lastCall('config.set')?.[0]?.autoAckStickyUnreach).toBe(true);
        });
        // a plain save, no second argument
        expect(transport.lastCall('config.set')).toHaveLength(1);
    });

    /** Task 34 (#147): the label says when it acts, and the help names the one-time question. */
    it('labels the switch with when it acts, in German and in English', async () => {
        const stores = await open(transport);
        const dialog = screen.getByTestId('config-dialog');
        expect(dialog.textContent).toContain('STICKY_UNREACH automatisch bestätigen, sobald sie auftreten');
        expect(dialog.textContent).toContain('Beim Einschalten wird einmal gefragt');

        stores.i18n.language = 'en';
        await waitFor(() => {
            expect(dialog.textContent).toContain('Acknowledge STICKY_UNREACH automatically as they occur');
        });
        expect(dialog.textContent).toContain('Switching this on asks once about the messages already in the list.');
    });

    describe('the one-time question when it is switched on (task 34)', () => {
        async function tick(): Promise<HTMLElement> {
            await fireEvent.click(screen.getByTestId('config-auto-ack-unreach'));
            return waitFor(() => {
                const question = screen.getByTestId('auto-ack-question');
                expect(question.hasAttribute('open')).toBe(true);
                return question;
            });
        }

        it('asks when a STICKY_UNREACH is in the list, and counts only those', async () => {
            await open(transport);
            await tick();
            // the demo list holds a LOWBAT and one STICKY_UNREACH: the question is about one message
            expect(screen.getByTestId('auto-ack-question-text').textContent).toContain(
                'In der Liste steht schon 1 STICKY_UNREACH-Meldung. Neue werden ab jetzt automatisch bestätigt.',
            );
            expect(screen.getByTestId('auto-ack-question').textContent).toContain('Ausfallzähler im Reiter Funk');
            // #147: the buttons say which messages they mean
            expect(screen.getByTestId('auto-ack-existing').textContent).toBe('Vorhandene bestätigen');
            expect(screen.getByTestId('auto-ack-only-new').textContent).toBe('Nur neue');
        });

        it('sends acknowledgeExisting with the save after "acknowledge existing"', async () => {
            await open(transport);
            await tick();
            await fireEvent.click(screen.getByTestId('auto-ack-existing'));

            await waitFor(() => {
                expect(screen.getByTestId('auto-ack-question').hasAttribute('open')).toBe(false);
            });
            expect(screen.getByTestId<HTMLInputElement>('config-auto-ack-unreach').checked).toBe(true);
            expect(screen.getByTestId('config-auto-ack-existing-note').textContent).toContain(
                'Die Meldung in der Liste wird beim Speichern bestätigt',
            );
            // nothing is written before the save - the question only records the answer
            expect(transport.countOf('serviceMessages.ack')).toBe(0);
            expect(transport.countOf('config.set')).toBe(0);

            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => {
                expect(transport.lastCall('config.set')?.[1]).toEqual({acknowledgeExisting: true});
            });
            expect(transport.lastCall('config.set')?.[0]?.autoAckStickyUnreach).toBe(true);
            expect(transport.countOf('serviceMessages.ack')).toBe(0);
        });

        it('saves without it after "only new ones"', async () => {
            await open(transport);
            await tick();
            await fireEvent.click(screen.getByTestId('auto-ack-only-new'));

            expect(screen.getByTestId<HTMLInputElement>('config-auto-ack-unreach').checked).toBe(true);
            expect(screen.queryByTestId('config-auto-ack-existing-note')).toBeNull();
            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => {
                expect(transport.lastCall('config.set')?.[0]?.autoAckStickyUnreach).toBe(true);
            });
            expect(transport.lastCall('config.set')).toHaveLength(1);
        });

        it('leaves the switch off when the question is closed without an answer', async () => {
            await open(transport);
            const question = await tick();
            await fireEvent.click(within(question).getByLabelText('Close'));

            await waitFor(() => {
                expect(screen.getByTestId<HTMLInputElement>('config-auto-ack-unreach').checked).toBe(false);
            });
            // nothing changed, so there is nothing to save
            expect(screen.getByTestId<HTMLButtonElement>('config-save').disabled).toBe(true);
        });

        it('forgets the answer when the switch goes off again, and asks nothing for that', async () => {
            await open(transport);
            await tick();
            await fireEvent.click(screen.getByTestId('auto-ack-existing'));
            await fireEvent.click(screen.getByTestId('config-auto-ack-unreach'));

            expect(screen.getByTestId('auto-ack-question').hasAttribute('open')).toBe(false);
            expect(screen.queryByTestId('config-auto-ack-existing-note')).toBeNull();
            await fireEvent.click(screen.getByTestId('config-clear-cache'));
            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => expect(transport.countOf('config.set')).toBe(1));
            expect(transport.lastCall('config.set')).toHaveLength(1);
            expect(transport.lastCall('config.set')?.[0]?.autoAckStickyUnreach).toBe(false);
        });

        it('does not ask when the option is already on', async () => {
            transport.result('config.get', {
                ...DEMO_CONFIG,
                connection: {...DEMO_CONFIG.connection, autoAckStickyUnreach: true},
            });
            await open(transport);
            // off, and on again within the same dialog: the backend never saw it off
            await fireEvent.click(screen.getByTestId('config-auto-ack-unreach'));
            await fireEvent.click(screen.getByTestId('config-auto-ack-unreach'));
            expect(screen.queryByTestId('auto-ack-question')?.hasAttribute('open') ?? false).toBe(false);
            expect(screen.getByTestId<HTMLInputElement>('config-auto-ack-unreach').checked).toBe(true);
        });
    });

    /**
     * Task 35: in the CCU addon a 0 stands for the addon's fixed callback port. The dialog says so,
     * and saves the 0 it shows rather than the port it names.
     */
    it('says what a 0 callback port means where the host has default ports (task 35)', async () => {
        transport.result('config.get', {...DEMO_CONFIG, callbackDefaultPorts: {xmlrpc: 2031, binrpc: 2032}});
        await open(transport);
        expect(screen.getByText('0 verwendet Port 2031 oder, wenn er belegt ist, einen freien')).toBeTruthy();
        expect(screen.getByText('0 verwendet Port 2032 oder, wenn er belegt ist, einen freien')).toBeTruthy();
        expect(screen.queryByText('0 wählt einen freien Port')).toBeNull();

        await fireEvent.click(screen.getByTestId('config-auto-ack-unreach'));
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => {
            expect(transport.lastCall('config.set')?.[0]?.callback).toMatchObject({xmlrpcPort: 0, binrpcPort: 0});
        });
    });

    it('keeps "0 picks a free port" where the host has none', async () => {
        await open(transport);
        expect(screen.getAllByText('0 wählt einen freien Port')).toHaveLength(2);
    });

    /**
     * Task 38: a callback field the host was started with (`HMM_CALLBACK_*`, `--callback-*`) wins
     * over the profile, so the dialog shows it read-only with the option that set it, and a save
     * sends back the value it shows.
     */
    it('shows the callback fields the host pinned read-only, with the option that set them (task 38)', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {...DEMO_CONFIG.connection, callback: {ip: '192.168.1.10', xmlrpcPort: 2126, binrpcPort: 0}},
            callbackPinned: {ip: true, xmlrpcPort: true},
        });
        await open(transport);
        const ip = screen.getByTestId<HTMLSelectElement>('config-callback-ip');
        const xmlrpc = screen.getByTestId<HTMLInputElement>('config-callback-xmlrpc-port');
        const binrpc = screen.getByTestId<HTMLInputElement>('config-callback-binrpc-port');
        expect(ip.disabled).toBe(true);
        // the Docker host's address is none of this machine's and is shown all the same
        expect(ip.value).toBe('192.168.1.10');
        expect(xmlrpc.disabled).toBe(true);
        expect(xmlrpc.value).toBe('2126');
        expect(binrpc.disabled).toBe(false);
        expect(screen.getByTestId('config-callback-ip-hint').textContent).toBe(
            'Beim Start festgelegt (HMM_CALLBACK_IP / --callback-ip)',
        );
        expect(screen.getByTestId('config-callback-xmlrpc-port-hint').textContent).toBe(
            'Beim Start festgelegt (HMM_CALLBACK_XMLRPC_PORT / --callback-xmlrpc-port)',
        );
        expect(screen.getByTestId('config-callback-binrpc-port-hint').textContent).toBe('0 wählt einen freien Port');

        await fireEvent.input(binrpc, {target: {value: '5000'}});
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => {
            expect(transport.lastCall('config.set')?.[0]?.callback).toEqual({
                ip: '192.168.1.10',
                xmlrpcPort: 2126,
                binrpcPort: 5000,
            });
        });
    });

    it('words the read-only hint in English as well (task 38)', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {
                ...DEMO_CONFIG.connection,
                language: 'en',
                callback: {ip: '', xmlrpcPort: 0, binrpcPort: 2127},
            },
            callbackPinned: {binrpcPort: true},
        });
        await open(transport);
        expect(screen.getByTestId<HTMLInputElement>('config-callback-binrpc-port').disabled).toBe(true);
        expect(screen.getByTestId<HTMLSelectElement>('config-callback-ip').disabled).toBe(false);
        expect(screen.getByTestId('config-callback-binrpc-port-hint').textContent).toBe(
            'Set at start (HMM_CALLBACK_BINRPC_PORT / --callback-binrpc-port)',
        );
        expect(screen.getByTestId('config-callback-ip-hint').textContent).toBe(
            'The address the interface processes call back to',
        );
    });

    /**
     * B-53 (#162, #165): "Select" meant "the first address", which on a Mac with a VPN or a bridge
     * listed first was not the one the CCU reaches. The dialog now says what the automatic address
     * is and why, marks the addresses outside the CCU's network, and warns about a set one that does
     * not fit.
     */
    describe('the callback address (B-53)', () => {
        function optionTexts(): string[] {
            return [...screen.getByTestId<HTMLSelectElement>('config-callback-ip').options].map((option) =>
                option.textContent.trim(),
            );
        }

        function withCallbackIp(ip: string, extra: Record<string, unknown> = {}): void {
            transport.result('config.get', {
                ...DEMO_CONFIG,
                connection: {...DEMO_CONFIG.connection, callback: {ip, xmlrpcPort: 0, binrpcPort: 0}},
                ...extra,
            });
        }

        it('offers the automatic address first, with why, and marks the others', async () => {
            withCallbackIp('');
            await open(transport);
            await waitFor(() => {
                expect(optionTexts()).toEqual([
                    'Automatisch (192.168.1.20, im Netz der CCU)',
                    '192.168.1.20',
                    '10.0.0.5 (nicht im Netz der CCU)',
                    '127.0.0.1 (nicht im Netz der CCU)',
                ]);
            });
            expect(transport.lastCall('config.callbackAddresses')).toEqual(['demo.local']);
            expect(screen.getByTestId<HTMLSelectElement>('config-callback-ip').value).toBe('');
            expect(screen.getByTestId('config-callback-ip').getAttribute('title')).toBe(
                'Automatisch nimmt die Adresse dieses Rechners im Netz der CCU, sonst die auf dem Weg zur CCU',
            );
            expect(screen.queryByTestId('config-callback-ip-warning')).toBeNull();
        });

        it('asks again for a host being typed, and names the route', async () => {
            withCallbackIp('');
            await open(transport);
            await waitFor(() => expect(transport.countOf('config.callbackAddresses')).toBe(1));
            const host = screen.getByTestId<HTMLInputElement>('config-host');
            await fireEvent.input(host, {target: {value: 'ccu-elsewhere'}});
            // while the answer is about another host, the choice is named without a reason
            expect(screen.getByTestId('config-callback-ip-auto').textContent.trim()).toBe('Automatisch');
            await waitFor(() => {
                expect(screen.getByTestId('config-callback-ip-auto').textContent.trim()).toBe(
                    'Automatisch (192.168.1.20, auf dem Weg zur CCU)',
                );
            });
            expect(transport.lastCall('config.callbackAddresses')).toEqual(['ccu-elsewhere']);
            expect(optionTexts()[1]).toBe('192.168.1.20 (nicht im Netz der CCU)');
        });

        it('names every reason', async () => {
            const answers = [
                {
                    address: '127.0.0.1',
                    reason: 'loopback',
                    text: 'Automatisch (127.0.0.1, die CCU ist auf diesem Rechner)',
                },
                {address: '10.0.0.5', reason: 'first', text: 'Automatisch (10.0.0.5, keine bessere Wahl)'},
            ] as const;
            withCallbackIp('');
            for (const answer of answers) {
                transport.result('config.callbackAddresses', {
                    host: 'demo.local',
                    auto: {address: answer.address, reason: answer.reason},
                    addresses: [
                        {address: '169.254.1.1', inSubnet: false, linkLocal: true},
                        {address: '10.0.0.5', inSubnet: false},
                        {address: '127.0.0.1', inSubnet: false},
                    ],
                });
                const {location, onHashChange} = router();
                const stores = createStores(transport, {location, onHashChange, storage: new MemoryStorage()});
                const view = render(App, {props: {stores}});
                await stores.start();
                await fireEvent.click(view.getByTestId('settings-button'));
                await waitFor(() => {
                    expect(view.getByTestId('config-callback-ip-auto').textContent.trim()).toBe(answer.text);
                });
                // without the CCU's address nothing is said about its network, only about link-local
                const options = [...screen.getByTestId<HTMLSelectElement>('config-callback-ip').options].map((option) =>
                    option.textContent.trim(),
                );
                expect(options.slice(1)).toEqual(['169.254.1.1 (link-lokal)', '10.0.0.5', '127.0.0.1']);
                view.unmount();
            }
        });

        it('warns about a set address that is not on this machine, and switches to automatic in one click', async () => {
            withCallbackIp('192.168.0.99');
            await open(transport);
            const warning = await waitFor(() => screen.getByTestId('config-callback-ip-warning'));
            expect(warning.textContent).toContain(
                'Die Callback-Adresse 192.168.0.99 ist keine Adresse dieses Rechners; stattdessen wird 192.168.1.20 verwendet',
            );
            // the set address is still what the select shows
            expect(screen.getByTestId<HTMLSelectElement>('config-callback-ip').value).toBe('192.168.0.99');
            await fireEvent.click(screen.getByTestId('config-callback-ip-use-auto'));
            expect(screen.getByTestId<HTMLSelectElement>('config-callback-ip').value).toBe('');
            expect(screen.queryByTestId('config-callback-ip-warning')).toBeNull();
            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => {
                expect(transport.lastCall('config.set')?.[0]?.callback.ip).toBe('');
            });
        });

        it('warns about a set address outside the CCU network', async () => {
            withCallbackIp('10.0.0.5');
            await open(transport);
            const warning = await waitFor(() => screen.getByTestId('config-callback-ip-warning'));
            expect(warning.textContent).toContain(
                'Die Callback-Adresse 10.0.0.5 liegt nicht im Netz der CCU; die CCU erreicht sie womöglich nicht und sendet keine Ereignisse',
            );
            expect(warning.textContent).toContain('Automatisch verwenden');
        });

        it('warns in English as well', async () => {
            transport.result('config.get', {
                ...DEMO_CONFIG,
                connection: {
                    ...DEMO_CONFIG.connection,
                    language: 'en',
                    callback: {ip: '192.168.0.99', xmlrpcPort: 0, binrpcPort: 0},
                },
            });
            await open(transport);
            const warning = await waitFor(() => screen.getByTestId('config-callback-ip-warning'));
            expect(warning.textContent).toContain(
                'The callback address 192.168.0.99 is not an address of this machine; 192.168.1.20 is used instead',
            );
            expect(screen.getByTestId('config-callback-ip-use-auto').textContent).toBe('Use automatic');
            expect(screen.getByTestId('config-callback-ip-auto').textContent.trim()).toBe(
                "Automatic (192.168.1.20, in the CCU's network)",
            );
        });

        it('says nothing where a set address fits, the host keeps it, it is the loopback, or on the CCU itself', async () => {
            const cases: Array<[string, Record<string, unknown>, Record<string, unknown>?]> = [
                ['192.168.1.20', {}],
                ['127.0.0.1', {}],
                ['192.168.0.99', {}, {keepsConfigured: true}],
                ['192.168.0.99', {local: true}],
            ];
            for (const [ip, connection, answer] of cases) {
                transport.result('config.get', {
                    ...DEMO_CONFIG,
                    connection: {
                        ...DEMO_CONFIG.connection,
                        ...connection,
                        callback: {ip, xmlrpcPort: 0, binrpcPort: 0},
                    },
                });
                transport.respond('config.callbackAddresses', (host) => ({
                    ...demoCallbackAddresses(host),
                    ...answer,
                }));
                const {location, onHashChange} = router();
                const stores = createStores(transport, {location, onHashChange, storage: new MemoryStorage()});
                const view = render(App, {props: {stores}});
                await stores.start();
                await fireEvent.click(view.getByTestId('settings-button'));
                await waitFor(() => expect(stores.app.callbackAddresses).toBeDefined());
                expect(view.queryByTestId('config-callback-ip-warning')).toBeNull();
                view.unmount();
            }
        });

        it('keeps the plain address list on a host that does not know the question', async () => {
            transport.fail('config.callbackAddresses', 'no mock handler');
            withCallbackIp('');
            await open(transport);
            await waitFor(() => expect(transport.countOf('config.callbackAddresses')).toBe(1));
            expect(optionTexts()).toEqual(['Automatisch', '192.168.1.20', '10.0.0.5']);
        });
    });

    /**
     * B-27 (#135): the backend connects only the interfaces ticked in the list, and the list offered
     * the built-in ones and whatever was ticked already - so a CCU-Jack added here could not be
     * switched on at all.
     */
    describe('the extra interfaces in the interface list (B-27, #135)', () => {
        const jack = {name: 'CCU-Jack', host: '127.0.0.1', port: 2121, protocol: 'xmlrpc' as const, path: '/RPC3'};

        function withExtras(interfaces: string[], extraInterfaces: (typeof jack)[]): void {
            transport.result('config.get', {
                ...DEMO_CONFIG,
                connection: {...DEMO_CONFIG.connection, interfaces, extraInterfaces},
            });
        }

        function picker(): HTMLElement {
            return within(screen.getByTestId('config-dialog')).getByLabelText('Schnittstellen', {selector: 'button'});
        }

        /** Opens the interface list, hands its entries to `inspect`, and closes it again. */
        async function inList<T>(inspect: (entries: HTMLElement[]) => Promise<T> | T): Promise<T> {
            const trigger = picker();
            await fireEvent.click(trigger);
            const root = trigger.closest<HTMLElement>('.hmm-multiselect')!;
            const entries = await waitFor(() => {
                const found = within(root).getAllByRole('option');
                expect(found.length).toBeGreaterThan(0);
                return found;
            });
            const result = await inspect(entries);
            if (trigger.getAttribute('aria-expanded') === 'true') {
                await fireEvent.click(trigger);
            }
            return result;
        }

        const nameOf = (entry: HTMLElement): string =>
            entry.querySelector('span:not([aria-hidden])')?.textContent ?? '';

        /** The interface list as `[name, ticked]` pairs. */
        function listed(): Promise<[string, boolean][]> {
            return inList((entries) =>
                entries.map((entry): [string, boolean] => [
                    nameOf(entry),
                    entry.getAttribute('aria-selected') === 'true',
                ]),
            );
        }

        function toggle(name: string): Promise<void> {
            return inList(async (entries) => {
                await fireEvent.click(entries.find((entry) => nameOf(entry) === name)!);
            });
        }

        async function typeName(index: number, ...values: string[]): Promise<void> {
            const row = screen.getByTestId(`config-extra-${String(index)}`);
            for (const value of values) {
                await fireEvent.input(within(row).getByLabelText(`Name ${String(index)}`), {target: {value}});
            }
        }

        const builtIn = (...ticked: string[]): [string, boolean][] =>
            INTERFACE_NAMES.map((name): [string, boolean] => [name, ticked.includes(name)]);

        it('offers a saved extra interface after the built-in ones, and leaves it unticked', async () => {
            withExtras(['BidCos-RF', 'HmIP-RF'], [jack]);
            await open(transport);

            expect(await listed()).toEqual([...builtIn('BidCos-RF', 'HmIP-RF'), ['CCU-Jack', false]]);
            // the profile did not tick it and the dialog did not either: there is nothing to save
            expect(screen.getByTestId<HTMLButtonElement>('config-save').disabled).toBe(true);

            // ticked once, by hand, it is saved and so connected
            await toggle('CCU-Jack');
            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => {
                expect(transport.lastCall('config.set')?.[0]?.interfaces).toEqual(['BidCos-RF', 'HmIP-RF', 'CCU-Jack']);
            });
        });

        it('ticks a newly added interface as it gets its name, and saves it', async () => {
            withExtras(['BidCos-RF', 'HmIP-RF'], []);
            await open(transport);
            await fireEvent.click(screen.getByTestId('config-extra-add'));
            const row = await waitFor(() => screen.getByTestId('config-extra-0'));
            // a row without a name has nothing to tick yet
            expect(await listed()).toEqual(builtIn('BidCos-RF', 'HmIP-RF'));

            await typeName(0, 'C', 'CCU', 'CCU-Jack');
            await fireEvent.input(within(row).getByLabelText('Host 0'), {target: {value: '127.0.0.1'}});
            await fireEvent.input(within(row).getByLabelText('Port 0'), {target: {value: '2121'}});
            await fireEvent.input(within(row).getByLabelText('Pfad 0'), {target: {value: '/RPC3'}});

            // one entry for the name as it ended up, not one per keystroke
            expect(await listed()).toEqual([...builtIn('BidCos-RF', 'HmIP-RF'), ['CCU-Jack', true]]);
            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => {
                expect(transport.lastCall('config.set')?.[0]?.interfaces).toEqual(['BidCos-RF', 'HmIP-RF', 'CCU-Jack']);
            });
            expect(transport.lastCall('config.set')?.[0]?.extraInterfaces).toEqual([jack]);
        });

        it('keeps a tick in its place when the interface is renamed', async () => {
            withExtras(['BidCos-RF', 'Jack', 'HmIP-RF'], [{...jack, name: 'Jack'}]);
            await open(transport);

            await typeName(0, 'Jack-', 'CCU-Jack');
            expect(await listed()).toEqual([...builtIn('BidCos-RF', 'HmIP-RF'), ['CCU-Jack', true]]);
            await fireEvent.click(screen.getByTestId('config-save'));
            await waitFor(() => {
                expect(transport.lastCall('config.set')?.[0]?.interfaces).toEqual(['BidCos-RF', 'CCU-Jack', 'HmIP-RF']);
            });
        });

        it('keeps a tick while the name is cleared and typed again, and no tick where there was none', async () => {
            withExtras(
                ['BidCos-RF', 'Jack'],
                [
                    {...jack, name: 'Jack'},
                    {...jack, name: 'Other', port: 2122},
                ],
            );
            await open(transport);

            await typeName(0, '', 'CCU-Jack');
            await typeName(1, '', 'Other-2');
            expect(await listed()).toEqual([...builtIn('BidCos-RF'), ['CCU-Jack', true], ['Other-2', false]]);
        });

        it('takes the tick away with the row, and leaves a built-in tick the name passed through', async () => {
            withExtras(['HmIP-RF'], []);
            await open(transport);
            await fireEvent.click(screen.getByTestId('config-extra-add'));
            await waitFor(() => screen.getByTestId('config-extra-0'));

            // on its way to "BidCos-RF-2" the name is a built-in one for a moment
            await typeName(0, 'BidCos-RF', 'BidCos-RF-2');
            expect(await listed()).toEqual([...builtIn('HmIP-RF'), ['BidCos-RF-2', true]]);

            await fireEvent.click(within(screen.getByTestId('config-extra-0')).getByLabelText('Entfernen 0'));
            expect(await listed()).toEqual(builtIn('HmIP-RF'));
            // added and removed again: the dialog is back where it started
            expect(screen.getByTestId<HTMLButtonElement>('config-save').disabled).toBe(true);
        });

        it('says under the list that an extra interface has to be ticked, in German and in English', async () => {
            const stores = await open(transport);
            const dialog = screen.getByTestId('config-dialog');
            expect(dialog.textContent).toContain(
                'Eine zusätzliche Schnittstelle wird verbunden, sobald sie hier angehakt ist',
            );

            stores.i18n.language = 'en';
            await waitFor(() => {
                expect(dialog.textContent).toContain('An extra interface is connected once it is ticked here');
            });
        });
    });
});
