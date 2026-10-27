import type {InterfaceState, RpcLogEntry} from '@homematic-manager/core';
import {fireEvent, render, screen} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import ConnectionIndicator from './ConnectionIndicator.svelte';
import RpcLogPanel from './RpcLogPanel.svelte';
import RpcProgress from './RpcProgress.svelte';

describe('RpcLogPanel', () => {
    const entries: RpcLogEntry[] = [
        {
            id: 1,
            timestamp: Date.parse('2026-09-05T09:57:02Z'),
            interfaceName: 'BidCos-RF',
            method: 'putParamset',
            params: ['MEQ0123456:1', 'MASTER', {LOGGING: 1}],
            ok: true,
            result: '',
            durationMs: 184,
            origin: 'ui',
        },
        {
            id: 2,
            timestamp: Date.parse('2026-09-05T09:57:44Z'),
            interfaceName: 'HmIP-RF',
            method: 'putParamset',
            params: ['000A:4', 'MASTER', {}],
            ok: false,
            error: 'Unknown parameter',
            durationMs: 1902,
            origin: 'ui',
        },
    ];

    it('lists finished calls with their duration and marks the failed one', () => {
        render(RpcLogPanel, {props: {open: true, entries, title: 'RPC log'}});
        expect(screen.getByText('184 ms')).toBeTruthy();
        expect(screen.getByText('1.90 s')).toBeTruthy();
        expect(screen.getByText('Unknown parameter')).toBeTruthy();
    });

    it('shows a spinner line for a write that is still running', () => {
        const {container} = render(RpcLogPanel, {
            props: {
                open: true,
                entries: [],
                pending: [{id: 1, interfaceName: 'BidCos-RF', method: 'putParamset', params: ['A:1'], startedAt: 0}],
                pendingText: 'in progress',
            },
        });
        expect(screen.getByText('in progress')).toBeTruthy();
        expect(container.querySelector('.hmm-rpclog-spinner')).toBeTruthy();
    });

    it('shows the empty text, clears and closes', async () => {
        const onclear = vi.fn();
        render(RpcLogPanel, {props: {open: true, entries: [], emptyText: 'No RPC calls yet', onclear}});
        expect(screen.getByText('No RPC calls yet')).toBeTruthy();

        await fireEvent.click(screen.getByText('Clear'));
        expect(onclear).toHaveBeenCalledOnce();

        await fireEvent.click(screen.getByLabelText('Close'));
        expect(screen.queryByText('No RPC calls yet')).toBeNull();
    });

    it('draws nothing while closed', () => {
        render(RpcLogPanel, {props: {open: false, entries}});
        expect(screen.queryByText('184 ms')).toBeNull();
    });

    // task 48: every outgoing call is in the log, with where it came from
    const background: RpcLogEntry = {
        id: 3,
        timestamp: Date.parse('2026-09-05T09:58:00Z'),
        interfaceName: 'HmIP-RF',
        method: 'ping',
        params: ['hmm'],
        ok: true,
        result: '',
        durationMs: 8,
        origin: 'background',
    };

    it('says where each call came from and marks the background ones (task 48)', () => {
        const {container} = render(RpcLogPanel, {
            props: {
                open: true,
                entries: [...entries, background],
                originLabels: {console: 'Konsole', ui: 'UI', background: 'Hintergrund'},
            },
        });
        expect(screen.getAllByText('UI')).toHaveLength(2);
        expect(screen.getByText('Hintergrund')).toBeTruthy();
        expect(container.querySelectorAll('.hmm-rpclog-background')).toHaveLength(1);
        expect(container.querySelector('[data-origin="background"]')?.textContent).toContain('ping');
    });

    it('offers the background filter and hands the choice back to the store (task 48)', async () => {
        const onopen = vi.fn();
        render(RpcLogPanel, {
            props: {
                open: true,
                entries: [background],
                hideBackgroundLabel: 'Hide background calls',
                onopen,
                testId: 'log',
            },
        });
        const filter = screen.getByTestId<HTMLInputElement>('log-hide-background');
        expect(filter.checked).toBe(false);
        expect(screen.getByLabelText('Hide background calls')).toBe(filter);
        await fireEvent.click(filter);
        expect(filter.checked).toBe(true);
        // the drawer shows what it is given; the store does the filtering with the bound flag
        expect(screen.getByText('HmIP-RF ping')).toBeTruthy();
    });

    it('opens an entry in the console (task 48)', async () => {
        const onopen = vi.fn();
        render(RpcLogPanel, {props: {open: true, entries, openLabel: 'Open in console', onopen}});
        // both demo entries are putParamset; the first row is the first entry
        await fireEvent.click(screen.getAllByLabelText('Open in console: putParamset')[0]!);
        expect(onopen).toHaveBeenCalledWith(entries[0]);
    });

    it('shows a capped answer with its size (task 48)', () => {
        render(RpcLogPanel, {
            props: {
                open: true,
                entries: [
                    {...background, id: 4, method: 'listDevices', result: '[{"ADDRESS":"ABC…', resultBytes: 204_800},
                ],
            },
        });
        expect(screen.getByText('[{"ADDRESS":"ABC… (200 kB)')).toBeTruthy();
    });
});

describe('RpcProgress', () => {
    it('is open exactly while a bulk write is running', async () => {
        const {rerender} = render(RpcProgress, {props: {progress: undefined}});
        expect(document.querySelector('dialog')?.open).toBe(false);

        await rerender({
            progress: {
                done: 2,
                total: 5,
                last: {
                    interfaceName: 'BidCos-RF',
                    address: 'MEQ0123456:1',
                    paramset: 'MASTER',
                    sent: {},
                    ok: true,
                    problems: [],
                },
            },
        });
        expect(document.querySelector('dialog')?.open).toBe(true);
        expect(screen.getByText('2 / 5')).toBeTruthy();
        expect(screen.getByText(/MEQ0123456:1/)).toBeTruthy();
    });

    it('offers a cancel button when the caller supplies one', async () => {
        const oncancel = vi.fn();
        render(RpcProgress, {props: {progress: {done: 1, total: 3}, cancelLabel: 'Abbrechen', oncancel}});
        await fireEvent.click(screen.getByText('Abbrechen'));
        expect(oncancel).toHaveBeenCalledOnce();
    });
});

/**
 * Task 21: the block of 2.7 - the CCU address and one ✔/✕ per interface - moved into the interface
 * popup, and what is left in the header is a single mark for the whole CCU. Its rules are
 * `summaryMark`'s (tested in `interfacePopup.test.ts`); what is tested here is that the component
 * paints them and keeps the header still.
 */

describe('ConnectionIndicator', () => {
    const state = (name: string, extra: Partial<InterfaceState> = {}): InterfaceState => ({
        name,
        type: name,
        protocol: 'xmlrpc',
        host: 'ccu',
        port: 2001,
        connected: true,
        ...extra,
    });

    it('is green with a title when every interface answers', () => {
        const {container} = render(ConnectionIndicator, {
            props: {interfaces: [state('BidCos-RF'), state('HmIP-RF')], allConnectedText: 'Alle verbunden'},
        });
        const mark = container.querySelector('.hmm-connection');
        expect(mark?.classList.contains('hmm-connection-ok')).toBe(true);
        expect(mark?.textContent).toBe('✔');
        expect(mark?.getAttribute('title')).toBe('Alle verbunden');
        expect(container.querySelector('.hmm-connection-offline')).toBeNull();
    });

    it('is red as soon as one interface does not answer', () => {
        const {container} = render(ConnectionIndicator, {
            props: {
                interfaces: [state('BidCos-RF'), state('HmIP-RF', {connected: false})],
                someNotConnectedText: 'Nicht jede Schnittstelle ist verbunden',
            },
        });
        const mark = container.querySelector('.hmm-connection');
        expect(mark?.classList.contains('hmm-connection-bad')).toBe(true);
        expect(mark?.getAttribute('title')).toBe('Nicht jede Schnittstelle ist verbunden');
    });

    it('greys itself out and says so when the backend is gone', () => {
        const {container} = render(ConnectionIndicator, {
            props: {interfaces: [], backendConnected: false, someNotConnectedText: 'Nicht verbunden'},
        });
        expect(container.querySelector('.hmm-connection-offline')).toBeTruthy();
        expect(container.querySelector('.hmm-connection')?.getAttribute('title')).toBe('Nicht verbunden');
    });

    /** Task 19's rule: four glyphs of four widths must not move what stands behind them. */
    it.skipIf(document.body.getBoundingClientRect().width === 0)(
        'keeps the same box whatever the state is',
        async () => {
            const {container, rerender} = render(ConnectionIndicator, {props: {interfaces: [state('BidCos-RF')]}});
            const width = (): number => container.querySelector('.hmm-connection')!.getBoundingClientRect().width;
            const first = width();
            expect(first).toBeGreaterThan(0);

            for (const extra of [{connected: false}, {connected: false, absent: true}, {subscribing: true}]) {
                await rerender({interfaces: [state('BidCos-RF', extra)]});
                expect(width(), `the ${JSON.stringify(extra)} mark has another width`).toBe(first);
            }
        },
    );
});
