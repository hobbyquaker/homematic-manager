import type {InterfaceState} from '@homematic-manager/core';
import {fireEvent, render, screen} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import InterfacePopup from './InterfacePopup.svelte';
import {callbackLine, callbackWarningOf, detailParts, markOf, summaryMark} from './interfacePopup.js';

function state(name: string, extra: Partial<InterfaceState> = {}): InterfaceState {
    return {name, type: name, protocol: 'xmlrpc', host: 'ccu', port: 2001, connected: true, ...extra};
}

/** One interface in every state the popup knows, which is what the demo fixture carries too. */
const INTERFACES: InterfaceState[] = [
    state('BidCos-RF'),
    state('HmIP-RF', {port: 2010}),
    state('BidCos-Wired', {port: 2000, connected: false, absent: true, error: 'connect ECONNREFUSED'}),
    state('CUxD', {protocol: 'binrpc', port: 8701, subscribing: true}),
    state('VirtualDevices', {port: 9292, connected: false, error: 'init timed out'}),
];

const LABELS = {
    connectedText: 'Verbunden',
    notConnectedText: 'Nicht verbunden',
    notPresentText: 'Nicht vorhanden',
    subscribingText: 'Anmeldung läuft',
    allConnectedText: 'Alle verbunden',
    someNotConnectedText: 'Nicht alle verbunden',
    portLabel: 'Port',
    devicesLabel: (count: number) => `${String(count)} Geräte`,
    dutyCycleLabel: (value: number) => `Duty Cycle ${String(value)} %`,
};

function mount(props: Record<string, unknown> = {}): {onselect: ReturnType<typeof vi.fn>} {
    const onselect = vi.fn();
    render(InterfacePopup, {
        props: {
            interfaces: INTERFACES,
            selected: 'BidCos-RF',
            host: 'ccu.lan',
            testId: 'interface-select',
            onselect,
            ...LABELS,
            ...props,
        },
    });
    return {onselect};
}

function trigger(): HTMLButtonElement {
    return screen.getByTestId<HTMLButtonElement>('interface-select-trigger');
}

async function openPopup(): Promise<void> {
    await fireEvent.click(trigger());
}

describe('the mark of an interface', () => {
    it('is busy while it re-subscribes, whatever `connected` says (D-31)', () => {
        expect(markOf(state('HmIP-RF', {subscribing: true}))).toBe('busy');
        expect(markOf(state('HmIP-RF', {connected: false, subscribing: true}))).toBe('busy');
    });

    it('is busy while it waits for its process at the start (task 56)', () => {
        expect(markOf(state('HmIP-RF', {connected: false, waiting: true, error: 'connect ECONNREFUSED'}))).toBe('busy');
    });

    it('is busy while it is subscribed again after a lost PONG (B-56)', () => {
        expect(markOf(state('HmIP-RF', {connected: false, reconnecting: true}))).toBe('busy');
        expect(markOf(state('HmIP-RF', {connected: false, reconnecting: true, error: 'connect ECONNREFUSED'}))).toBe(
            'busy',
        );
    });

    it('separates "not there" from "broken" (task 13)', () => {
        expect(markOf(state('BidCos-Wired', {connected: false, absent: true}))).toBe('absent');
        expect(markOf(state('VirtualDevices', {connected: false}))).toBe('bad');
        expect(markOf(state('BidCos-RF'))).toBe('ok');
    });
});

describe('the summary mark of the header', () => {
    it('is green only when everything that exists answers', () => {
        expect(summaryMark([state('a'), state('b')])).toBe('ok');
        expect(summaryMark([state('a'), state('b', {connected: false, absent: true})])).toBe('ok');
    });

    it('lets a fault win over everything else', () => {
        expect(summaryMark([state('a'), state('b', {subscribing: true}), state('c', {connected: false})])).toBe('bad');
    });

    it('is busy when something is subscribing and nothing is broken', () => {
        expect(summaryMark([state('a'), state('b', {subscribing: true})])).toBe('busy');
    });

    it('is a grey dash for a CCU with nothing but absent interfaces, and for no interface at all', () => {
        expect(summaryMark([state('a', {connected: false, absent: true})])).toBe('absent');
        expect(summaryMark([])).toBe('absent');
    });
});

describe('the second line of an item', () => {
    const labels = {
        port: 'Port',
        tls: 'TLS',
        devices: (count: number) => `${String(count)} Geräte`,
        dutyCycle: (value: number) => `Duty Cycle ${String(value)} %`,
    };

    it('always has protocol and port', () => {
        expect(detailParts(state('BidCos-RF'), undefined, labels)).toEqual(['xmlrpc', 'Port 2001']);
        expect(detailParts(state('CUxD', {protocol: 'binrpc', port: 8701}), undefined, labels)).toEqual([
            'binrpc',
            'Port 8701',
        ]);
    });

    it('names the encryption when the connection is encrypted', () => {
        expect(detailParts(state('BidCos-RF', {port: 42_001, tls: true}), undefined, labels)).toEqual([
            'xmlrpc',
            'Port 42001',
            'TLS',
        ]);
    });

    it('adds what the UI knows and leaves out what it does not', () => {
        expect(detailParts(state('BidCos-RF'), {devices: 12}, labels)).toEqual(['xmlrpc', 'Port 2001', '12 Geräte']);
        expect(detailParts(state('BidCos-RF'), {dutyCycle: 3}, labels)).toEqual([
            'xmlrpc',
            'Port 2001',
            'Duty Cycle 3 %',
        ]);
        // zero is a number and is shown; unknown is not shown as zero
        expect(detailParts(state('BidCos-RF'), {devices: 0, dutyCycle: 0}, labels)).toEqual([
            'xmlrpc',
            'Port 2001',
            '0 Geräte',
            'Duty Cycle 0 %',
        ]);
    });
});

/** Task 38: the URL an interface was told to call back on, or why it was told none. */
describe('the callback line of an item', () => {
    const labels = {
        portInUse: (port: number) => `Callback-Port ${String(port)} ist belegt`,
        portFailed: (port: number) => `Callback-Port ${String(port)} lässt sich nicht öffnen`,
        publish: 'Diesen Port unverändert veröffentlichen',
    };

    it('names the URL, and nothing where the interface was given none', () => {
        expect(callbackLine(state('HmIP-RF', {callbackUrl: 'http://192.168.1.10:2126'}), false, labels)).toEqual({
            text: 'http://192.168.1.10:2126',
            bad: false,
        });
        expect(callbackLine(state('CUxD', {protocol: 'binrpc'}), false, labels)).toBeUndefined();
    });

    it('asks for the port to be published unchanged where the host says so', () => {
        expect(callbackLine(state('CUxD', {callbackUrl: 'xmlrpc_bin://192.168.1.10:2127'}), true, labels)).toEqual({
            text: 'xmlrpc_bin://192.168.1.10:2127 · Diesen Port unverändert veröffentlichen',
            bad: false,
        });
    });

    it('says why there is no callback, whatever else the state says', () => {
        const taken = state('HmIP-RF', {connected: false, callbackFailure: {port: 2126, inUse: true}});
        expect(callbackLine(taken, true, labels)).toEqual({text: 'Callback-Port 2126 ist belegt', bad: true});
        const refused = state('HmIP-RF', {connected: false, callbackFailure: {port: 80, inUse: false}});
        expect(callbackLine(refused, false, labels)?.text).toBe('Callback-Port 80 lässt sich nicht öffnen');
    });
});

describe('the callback warning (B-53)', () => {
    it('is the first one any interface carries', () => {
        const warning = {address: '10.0.0.9', reason: 'notLocal', auto: '192.168.1.5'} as const;
        expect(callbackWarningOf(INTERFACES)).toBeUndefined();
        expect(callbackWarningOf([state('A'), state('B', {callbackWarning: warning}), state('C')])).toEqual(warning);
    });
});

describe('InterfacePopup', () => {
    /** Task 38: the third line, drawn only where there is something to say. */
    it('draws the callback URL, the publish reminder and a taken port under the items', async () => {
        mount({
            interfaces: [
                state('HmIP-RF', {callbackUrl: 'http://192.168.1.10:2126'}),
                state('CUxD', {
                    protocol: 'binrpc',
                    port: 8701,
                    connected: false,
                    callbackFailure: {port: 2127, inUse: true},
                }),
                state('VirtualDevices', {port: 9292}),
            ],
            selected: 'HmIP-RF',
            publishCallbackPorts: true,
            publishPortText: 'Diesen Port unverändert veröffentlichen',
            callbackPortInUseLabel: (port: number) => `Callback-Port ${String(port)} ist belegt`,
        });
        await openPopup();
        const callback = screen.getByTestId('interface-callback-HmIP-RF');
        expect(callback.textContent).toBe('http://192.168.1.10:2126 · Diesen Port unverändert veröffentlichen');
        expect(callback.classList.contains('hmm-interface-item-callback-bad')).toBe(false);
        const taken = screen.getByTestId('interface-callback-CUxD');
        expect(taken.textContent).toBe('Callback-Port 2127 ist belegt');
        expect(taken.classList.contains('hmm-interface-item-callback-bad')).toBe(true);
        expect(screen.queryByTestId('interface-callback-VirtualDevices')).toBeNull();
    });

    it('draws the URL alone outside a container, in English by default', async () => {
        render(InterfacePopup, {
            props: {
                interfaces: [state('HmIP-RF', {callbackUrl: 'http://10.0.0.2:40123'})],
                selected: 'HmIP-RF',
                testId: 'interface-select',
            },
        });
        await openPopup();
        expect(screen.getByTestId('interface-callback-HmIP-RF').textContent).toBe('http://10.0.0.2:40123');
    });

    it('shows the selected interface and the summary mark, and nothing else, while it is closed', () => {
        mount();
        expect(trigger().textContent).toContain('BidCos-RF');
        // one interface does not answer, so the header is red
        expect(screen.getByTestId('interface-select-summary').getAttribute('data-mark')).toBe('bad');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    });

    it('opens on a click, with the CCU and the backend state on top', async () => {
        mount();
        await openPopup();

        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('interface-host').textContent).toBe('ccu.lan');
        expect(screen.getByTestId('interface-backend').textContent).toBe('Verbunden');
        expect(screen.getAllByRole('option')).toHaveLength(5);
    });

    it('says that the backend is gone, which is not the same as an interface that is', async () => {
        mount({backendConnected: false});
        await openPopup();
        expect(screen.getByTestId('interface-backend').textContent).toBe('Nicht verbunden');
    });

    /** The popup has no filter box (maintainer, 2026-09-06): a CCU has a handful of interfaces. */
    it('has no input of any kind', async () => {
        const {container} = render(InterfacePopup, {
            props: {interfaces: INTERFACES, selected: 'BidCos-RF', testId: 'interface-select', ...LABELS},
        });
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0);
    });

    it('gives every interface its mark, its words and its second line', async () => {
        mount({details: {'BidCos-RF': {devices: 12, dutyCycle: 3}}});
        await openPopup();

        const item = (name: string): HTMLElement => screen.getByTestId(`interface-item-${name}`);
        const mark = (name: string): string =>
            item(name).querySelector('.hmm-interface-mark')!.getAttribute('data-mark')!;

        expect(mark('BidCos-RF')).toBe('ok');
        expect(mark('BidCos-Wired')).toBe('absent');
        expect(mark('CUxD')).toBe('busy');
        expect(mark('VirtualDevices')).toBe('bad');

        expect(item('BidCos-Wired').textContent).toContain('Nicht vorhanden');
        expect(item('CUxD').textContent).toContain('Anmeldung läuft');
        expect(item('VirtualDevices').textContent).toContain('Nicht verbunden');

        // the error text is the title of the one item that is really broken, and only of that one
        expect(item('VirtualDevices').getAttribute('title')).toBe('init timed out');
        expect(item('BidCos-Wired').getAttribute('title')).toBeNull();

        const line = (name: string): string => item(name).querySelector('.hmm-interface-item-line')!.textContent!;
        expect(line('BidCos-RF')).toBe('xmlrpc · Port 2001 · 12 Geräte · Duty Cycle 3 %');
        expect(line('CUxD')).toBe('binrpc · Port 8701');
    });

    it('says "waiting" for an interface waiting for its process at the start, and offers no retry (task 56)', async () => {
        const interfaces = [
            state('BidCos-RF'),
            state('HmIP-RF', {port: 2010, connected: false, waiting: true, error: 'connect ECONNREFUSED'}),
        ];
        const onretry = vi.fn();
        mount({interfaces, waitingText: 'Wartet', retryText: 'Erneut', onretry});
        await openPopup();
        const item = screen.getByTestId('interface-item-HmIP-RF');
        expect(item.querySelector('.hmm-interface-mark')!.getAttribute('data-mark')).toBe('busy');
        expect(item.textContent).toContain('Wartet');
        expect(screen.queryByText('Erneut')).toBeNull();
    });

    it('says "reconnecting" for an interface subscribed again after a lost PONG, and offers no retry (B-56)', async () => {
        const interfaces = [
            state('BidCos-RF'),
            state('HmIP-RF', {port: 2010, connected: false, reconnecting: true, error: 'connect ECONNREFUSED'}),
        ];
        const onretry = vi.fn();
        mount({interfaces, waitingText: 'Wartet', reconnectingText: 'Verbindet neu', retryText: 'Erneut', onretry});
        await openPopup();
        const item = screen.getByTestId('interface-item-HmIP-RF');
        expect(item.querySelector('.hmm-interface-mark')!.getAttribute('data-mark')).toBe('busy');
        expect(item.textContent).toContain('Verbindet neu');
        expect(item.textContent).not.toContain('Wartet');
        expect(screen.queryByText('Erneut')).toBeNull();
        expect(screen.getByTestId('interface-select-summary').getAttribute('title')).toBe('Verbindet neu');
    });

    it('B-28: tells an interface that answers, one that refuses and one that times out apart, and retries the last', async () => {
        const interfaces = [
            state('Answers', {type: 'custom', port: 2121}),
            state('Refuses', {
                type: 'custom',
                port: 2122,
                connected: false,
                absent: true,
                error: 'connect ECONNREFUSED',
            }),
            state('Silent', {
                type: 'custom',
                port: 2123,
                connected: false,
                unreachable: true,
                error: 'Silent (ccu:2123, xmlrpc): init timed out after 10000 ms',
            }),
        ];
        const onretry = vi.fn();
        mount({interfaces, selected: 'Answers', notAnsweringText: 'Antwortet nicht', retryText: 'Erneut', onretry});
        await openPopup();

        const item = (name: string): HTMLElement => screen.getByTestId(`interface-item-${name}`);
        const mark = (name: string): string =>
            item(name).querySelector('.hmm-interface-mark')!.getAttribute('data-mark')!;
        expect([mark('Answers'), mark('Refuses'), mark('Silent')]).toEqual(['ok', 'absent', 'bad']);
        expect(item('Answers').textContent).toContain('Verbunden');
        expect(item('Refuses').textContent).toContain('Nicht vorhanden');
        expect(item('Silent').textContent).toContain('Antwortet nicht');
        expect(item('Silent').textContent).not.toContain('Nicht verbunden');
        expect(item('Silent').getAttribute('title')).toContain('timed out');

        // the retry is for the one that does not answer, not for the one that is not there
        const retry = screen.getByTestId('interface-select-retry');
        expect(retry.textContent).toBe('Erneut');
        await fireEvent.click(retry);
        expect(onretry).toHaveBeenCalledExactlyOnceWith(['Silent']);
        // and it leaves the popup open, so the marks can be seen to change
        expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('B-28: has no retry button without an interface that is not answering, or without a handler', async () => {
        mount({onretry: vi.fn()});
        await openPopup();
        // VirtualDevices in the fixture failed without the flag, BidCos-Wired is absent
        expect(screen.queryByTestId('interface-select-retry')).toBeNull();
    });

    it('B-28: reaches the retry button with Tab and comes back with Shift+Tab', async () => {
        const interfaces = [state('BidCos-RF'), state('Silent', {connected: false, unreachable: true})];
        mount({interfaces, onretry: vi.fn()});
        await openPopup();
        const first = screen.getByTestId('interface-item-BidCos-RF');
        expect(document.activeElement).toBe(first);
        await fireEvent.keyDown(first, {key: 'Tab'});
        const retry = screen.getByTestId('interface-select-retry');
        expect(document.activeElement).toBe(retry);
        await fireEvent.keyDown(retry, {key: 'Tab', shiftKey: true});
        expect(document.activeElement).toBe(first);
        await fireEvent.keyDown(first, {key: 'Tab'});
        await fireEvent.keyDown(retry, {key: 'Escape'});
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    describe('a callback address that does not fit (B-53)', () => {
        const NOT_LOCAL = {address: '10.0.0.9', reason: 'notLocal', auto: '192.168.1.5'} as const;
        const OTHER = {address: '10.211.55.2', reason: 'otherNetwork', auto: '192.168.1.5'} as const;

        it('shows a mark on the trigger and the warning with a way out in the popup', async () => {
            const onuseautomatic = vi.fn();
            const interfaces = [state('BidCos-RF', {callbackWarning: NOT_LOCAL}), state('HmIP-RF')];
            mount({
                interfaces,
                onuseautomatic,
                useAutomaticText: 'Automatisch verwenden',
                callbackWarningLabel: (warning: {address: string}) => `passt nicht: ${warning.address}`,
            });
            const mark = screen.getByTestId('interface-select-callback-warning');
            expect(mark.getAttribute('title')).toBe('passt nicht: 10.0.0.9');
            await openPopup();
            expect(screen.getByTestId('interface-callback-warning').textContent).toContain('passt nicht: 10.0.0.9');
            const button = screen.getByTestId('interface-callback-use-auto');
            expect(button.textContent).toBe('Automatisch verwenden');
            await fireEvent.click(button);
            expect(onuseautomatic).toHaveBeenCalledOnce();
            expect(screen.queryByRole('listbox')).toBeNull();
        });

        it('words both reasons in English by default, and has no button without a handler', async () => {
            mount({interfaces: [state('BidCos-RF', {callbackWarning: OTHER})]});
            expect(screen.getByTestId('interface-select-callback-warning').getAttribute('title')).toBe(
                "The callback address 10.211.55.2 is not in the CCU's network; the CCU may not reach it and send no events",
            );
            await openPopup();
            expect(screen.queryByTestId('interface-callback-use-auto')).toBeNull();
        });

        it('says what the automatic address is when the set one is gone', () => {
            mount({interfaces: [state('BidCos-RF', {callbackWarning: NOT_LOCAL})]});
            expect(screen.getByTestId('interface-select-callback-warning').getAttribute('title')).toBe(
                'The callback address 10.0.0.9 is not an address of this machine; 192.168.1.5 is used instead',
            );
        });

        it('shows nothing when every address fits', async () => {
            mount({onuseautomatic: vi.fn()});
            expect(screen.queryByTestId('interface-select-callback-warning')).toBeNull();
            await openPopup();
            expect(screen.queryByTestId('interface-callback-warning')).toBeNull();
        });

        it('puts "use automatic" before "retry now" in the Tab order', async () => {
            const interfaces = [
                state('BidCos-RF', {callbackWarning: NOT_LOCAL}),
                state('Silent', {connected: false, unreachable: true}),
            ];
            mount({interfaces, onretry: vi.fn(), onuseautomatic: vi.fn()});
            await openPopup();
            const first = screen.getByTestId('interface-item-BidCos-RF');
            const auto = screen.getByTestId('interface-callback-use-auto');
            const retry = screen.getByTestId('interface-select-retry');
            await fireEvent.keyDown(first, {key: 'Tab'});
            expect(document.activeElement).toBe(auto);
            await fireEvent.keyDown(auto, {key: 'Tab'});
            expect(document.activeElement).toBe(retry);
            await fireEvent.keyDown(retry, {key: 'Tab', shiftKey: true});
            expect(document.activeElement).toBe(auto);
            await fireEvent.keyDown(auto, {key: 'Tab', shiftKey: true});
            expect(document.activeElement).toBe(first);
            // the last stop lets Tab leave, and the popup closes behind it
            await fireEvent.keyDown(first, {key: 'Tab'});
            await fireEvent.keyDown(auto, {key: 'Tab'});
            await fireEvent.keyDown(retry, {key: 'Tab'});
            expect(screen.queryByRole('listbox')).toBeNull();
        });

        it('closes on Escape from the button', async () => {
            mount({interfaces: [state('BidCos-RF', {callbackWarning: NOT_LOCAL})], onuseautomatic: vi.fn()});
            await openPopup();
            await fireEvent.keyDown(screen.getByTestId('interface-callback-use-auto'), {key: 'Escape'});
            expect(screen.queryByRole('listbox')).toBeNull();
            expect(document.activeElement).toBe(trigger());
        });
    });

    it('marks the current selection and nothing else', async () => {
        mount({selected: 'HmIP-RF'});
        await openPopup();
        const selected = screen
            .getAllByRole('option')
            .filter((option) => option.getAttribute('aria-selected') === 'true');
        expect(selected.map((option) => option.textContent)).toHaveLength(1);
        expect(selected[0]?.getAttribute('data-testid')).toBe('interface-item-HmIP-RF');
        expect(selected[0]?.classList.contains('hmm-interface-item-current')).toBe(true);
    });

    it('selects with the mouse, closes and gives the focus back', async () => {
        const {onselect} = mount();
        await openPopup();
        await fireEvent.click(screen.getByTestId('interface-item-HmIP-RF'));

        expect(onselect).toHaveBeenCalledExactlyOnceWith('HmIP-RF');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('does not report the interface that is already selected', async () => {
        const {onselect} = mount();
        await openPopup();
        await fireEvent.click(screen.getByTestId('interface-item-BidCos-RF'));
        expect(onselect).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes on Escape and on a click outside, and the trigger closes it again', async () => {
        mount();
        await openPopup();
        await fireEvent.keyDown(screen.getByTestId('interface-item-BidCos-RF'), {key: 'Escape'});
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger());

        await openPopup();
        await fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();

        await openPopup();
        await openPopup();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('opens with the arrow key on the current selection, moves and wraps around', async () => {
        mount({selected: 'HmIP-RF'});
        await fireEvent.keyDown(trigger(), {key: 'ArrowDown'});

        // it opens on the selected item, so the first arrow moves from there and not from the top
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-HmIP-RF'));

        await fireEvent.keyDown(document.activeElement!, {key: 'ArrowDown'});
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-BidCos-Wired'));

        await fireEvent.keyDown(document.activeElement!, {key: 'ArrowUp'});
        await fireEvent.keyDown(document.activeElement!, {key: 'ArrowUp'});
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-BidCos-RF'));

        await fireEvent.keyDown(document.activeElement!, {key: 'ArrowUp'});
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-VirtualDevices'));

        await fireEvent.keyDown(document.activeElement!, {key: 'Home'});
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-BidCos-RF'));
        await fireEvent.keyDown(document.activeElement!, {key: 'End'});
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-VirtualDevices'));
    });

    it('selects with Enter and gives the focus back to the trigger', async () => {
        const {onselect} = mount();
        await fireEvent.keyDown(trigger(), {key: 'ArrowDown'});
        await fireEvent.keyDown(document.activeElement!, {key: 'ArrowDown'});
        await fireEvent.keyDown(document.activeElement!, {key: 'Enter'});

        expect(onselect).toHaveBeenCalledExactlyOnceWith('HmIP-RF');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('selects with the space bar as well', async () => {
        const {onselect} = mount({selected: 'HmIP-RF'});
        await fireEvent.keyDown(trigger(), {key: 'ArrowUp'});
        await fireEvent.keyDown(document.activeElement!, {key: 'ArrowUp'});
        expect(document.activeElement).toBe(screen.getByTestId('interface-item-BidCos-RF'));
        await fireEvent.keyDown(document.activeElement!, {key: ' '});
        expect(onselect).toHaveBeenCalledExactlyOnceWith('BidCos-RF');
    });

    it('closes when the focus tabs out of it', async () => {
        mount();
        await openPopup();
        await fireEvent.keyDown(document.activeElement!, {key: 'Tab'});
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('draws an empty CCU without falling over', async () => {
        render(InterfacePopup, {props: {interfaces: [], selected: '', testId: 'interface-select', ...LABELS}});
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByTestId('interface-host').textContent).toBe('—');
        expect(screen.getByTestId('interface-select-summary').getAttribute('data-mark')).toBe('absent');
        await fireEvent.keyDown(screen.getByTestId('interface-select-trigger'), {key: 'ArrowDown'});
        expect(screen.getByTestId('interface-select-trigger').getAttribute('aria-expanded')).toBe('true');
    });

    /** 2026-09-10: the metadata store is an entry of its own, above the interfaces. */
    describe('the store entry', () => {
        const store = {
            id: '#store',
            label: 'ReGaHSS',
            mark: 'ok' as const,
            title: 'ReGaHSS · Erreichbar · Schreibbar',
            selectable: true,
            provider: 'rega',
        };

        it('is not there without a store', async () => {
            mount();
            await openPopup();
            expect(screen.queryByTestId('meta-store')).toBeNull();
            expect(screen.getAllByRole('option')).toHaveLength(5);
        });

        it('is the first option, half an item high, with the dot and the title', async () => {
            mount({store, storeTestId: 'meta-store'});
            await openPopup();
            const options = screen.getAllByRole('option');
            expect(options).toHaveLength(6);
            expect(options[0]?.getAttribute('data-testid')).toBe('meta-store');
            const entry = screen.getByTestId('meta-store');
            expect(entry.tagName).toBe('BUTTON');
            expect(entry.textContent.trim()).toBe('ReGaHSS');
            expect(entry.title).toBe('ReGaHSS · Erreichbar · Schreibbar');
            expect(entry.dataset['mark']).toBe('ok');
            expect(entry.dataset['provider']).toBe('rega');
            expect(entry.getAttribute('aria-selected')).toBe('false');
            if (document.body.getBoundingClientRect().width > 0) {
                const item = screen.getByTestId('interface-item-BidCos-RF').getBoundingClientRect();
                expect(entry.getBoundingClientRect().height).toBeLessThan(item.height * 0.75);
            }
        });

        it('is chosen with the mouse and reported under its id; the trigger then says its name', async () => {
            const {onselect} = mount({store, storeTestId: 'meta-store'});
            await openPopup();
            await fireEvent.click(screen.getByTestId('meta-store'));
            expect(onselect).toHaveBeenCalledExactlyOnceWith('#store');
            expect(screen.queryByRole('listbox')).toBeNull();
        });

        it('is marked as current when it is the selection', async () => {
            mount({store, storeTestId: 'meta-store', selected: '#store'});
            expect(trigger().textContent).toContain('ReGaHSS');
            expect(trigger().textContent).not.toContain('#store');
            await openPopup();
            const entry = screen.getByTestId('meta-store');
            expect(entry.getAttribute('aria-selected')).toBe('true');
            expect(entry.classList.contains('hmm-interface-item-current')).toBe(true);
            expect(screen.getByTestId('interface-item-BidCos-RF').getAttribute('aria-selected')).toBe('false');
        });

        it('is reached by the arrow keys above the first interface, and wraps to it from the end', async () => {
            const {onselect} = mount({store, storeTestId: 'meta-store'});
            await fireEvent.keyDown(trigger(), {key: 'ArrowDown'});
            expect(document.activeElement).toBe(screen.getByTestId('interface-item-BidCos-RF'));
            await fireEvent.keyDown(document.activeElement!, {key: 'ArrowUp'});
            expect(document.activeElement).toBe(screen.getByTestId('meta-store'));
            await fireEvent.keyDown(document.activeElement!, {key: 'ArrowUp'});
            expect(document.activeElement).toBe(screen.getByTestId('interface-item-VirtualDevices'));
            await fireEvent.keyDown(document.activeElement!, {key: 'Home'});
            expect(document.activeElement).toBe(screen.getByTestId('meta-store'));
            await fireEvent.keyDown(document.activeElement!, {key: 'Enter'});
            expect(onselect).toHaveBeenCalledExactlyOnceWith('#store');
            expect(document.activeElement).toBe(trigger());
        });

        it('is shown but not selectable while the store does not answer, with the reason in its title', async () => {
            const {onselect} = mount({
                store: {...store, mark: 'bad', selectable: false, title: 'ReGaHSS · Nicht erreichbar · box off'},
                storeTestId: 'meta-store',
            });
            await openPopup();
            const entry = screen.getByTestId('meta-store');
            expect(entry.tagName).toBe('DIV');
            expect(entry.getAttribute('aria-disabled')).toBe('true');
            expect(entry.title).toContain('box off');
            await fireEvent.click(entry);
            expect(onselect).not.toHaveBeenCalled();
            expect(screen.queryByRole('listbox')).not.toBeNull();
            // and the keyboard skips it
            await fireEvent.keyDown(screen.getByTestId('interface-item-BidCos-RF'), {key: 'ArrowUp'});
            expect(document.activeElement).toBe(screen.getByTestId('interface-item-VirtualDevices'));
        });
    });

    describe.skipIf(document.body.getBoundingClientRect().width === 0)('its geometry', () => {
        it('opens below the trigger and inside the window', async () => {
            mount();
            await openPopup();
            const box = trigger().getBoundingClientRect();
            const menu = screen.getByRole('listbox').getBoundingClientRect();

            expect(menu.top).toBeGreaterThanOrEqual(box.bottom);
            expect(Math.round(menu.left)).toBeGreaterThanOrEqual(Math.round(box.left) - 1);
            expect(menu.width).toBeGreaterThan(0);
            expect(Math.round(menu.right)).toBeLessThanOrEqual(window.innerWidth);
        });

        /**
         * Task 19's rule for the header: the trigger is the only thing in front of the tab bar, so
         * a trigger that is as wide as its interface name would move every tab whenever an
         * interface reconnects or the user switches.
         */
        it('keeps its width and its place whatever happens', async () => {
            const {rerender} = render(InterfacePopup, {
                props: {interfaces: INTERFACES, selected: 'BidCos-RF', host: 'ccu.lan', ...LABELS},
            });
            const measure = (): string => {
                const box = document.querySelector('.hmm-interface-trigger')!.getBoundingClientRect();
                return `${String(Math.round(box.width))}x${String(Math.round(box.height))}@${String(Math.round(box.left))}`;
            };
            const first = measure();

            for (const selected of ['HmIP-RF', 'BidCos-Wired', 'VirtualDevices']) {
                await rerender({interfaces: INTERFACES, selected, host: 'ccu.lan', ...LABELS});
                expect(measure(), `selecting ${selected} moved the trigger`).toBe(first);
            }

            await rerender({
                interfaces: INTERFACES.map((entry) => ({...entry, connected: true, absent: false})),
                selected: 'BidCos-Wired',
                host: 'a-considerably-longer-ccu-name.lan',
                ...LABELS,
            });
            expect(measure(), 'a state change moved the trigger').toBe(first);
        });
    });
});
