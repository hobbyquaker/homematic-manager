import type {InterfaceState} from '@homematic-manager/core';
import {fireEvent, render, screen} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import InterfacePopup from './InterfacePopup.svelte';
import {detailParts, markOf, summaryMark} from './interfacePopup.js';

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

describe('InterfacePopup', () => {
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
