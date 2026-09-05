/**
 * Issue #124: stage several changes, review them in one place, write them with one Apply.
 *
 * The report is about waiting: three direct links in 2.7 were three round trips to the CCU, each
 * behind its own modal. What is asserted here is that nothing reaches the backend before Apply,
 * that Apply sends exactly what the review showed, and that a failure leaves its entry in the set
 * instead of losing it.
 */

import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

import type {StagedInput} from '../lib/stores/ChangeSetStore.svelte.js';

let transport: MockTransport;

beforeEach(() => {
    transport = new MockTransport({demo: true});
});

const paramsetChange = (id: string): StagedInput => ({
    kind: 'paramset',
    interfaceName: 'BidCos-RF',
    title: `MASTER — ${id}`,
    targets: [`LEQ000000${id}:1`],
    paramset: 'MASTER',
    values: {LOGGING: true},
    writeAll: false,
    calls: [`putParamset(LEQ000000${id}:1, MASTER, {"LOGGING":true})`],
    lines: [{label: 'LOGGING', from: 'false', to: 'true'}],
});

describe('the change set (#124)', () => {
    it('collects changes, sends nothing until Apply and then sends all of them', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        stores.changeSet.stage(paramsetChange('1'));
        stores.changeSet.stage({
            kind: 'linkAdd',
            interfaceName: 'BidCos-RF',
            title: 'two links',
            pairs: [
                {sender: 'A:1', receiver: 'B:1'},
                {sender: 'A:1', receiver: 'C:1'},
            ],
            calls: ['addLink(A:1, B:1)', 'addLink(A:1, C:1)'],
            lines: [],
        });

        expect(transport.countOf('paramset.put')).toBe(0);
        expect(transport.countOf('links.add')).toBe(0);

        await waitFor(() => {
            expect(screen.getByTestId('change-set-open')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('change-set-open'));
        const dialog = await screen.findByTestId('change-set-dialog');
        expect(dialog.textContent).toContain('putParamset(LEQ0000001:1, MASTER, {"LOGGING":true})');
        expect(dialog.textContent).toContain('addLink(A:1, B:1)');

        await fireEvent.click(screen.getByTestId('change-set-apply'));
        await waitFor(() => {
            expect(transport.countOf('paramset.put')).toBe(1);
            expect(transport.countOf('links.add')).toBe(2);
        });
        // everything succeeded, so the set is empty and the dialog closed itself
        expect(stores.changeSet.count).toBe(0);
        await waitFor(() => {
            expect(screen.queryByTestId('change-set-open')).toBeNull();
        });
    });

    it('sends the payload the review printed, unchanged', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        stores.changeSet.stage(paramsetChange('1'));
        await stores.changeSet.apply();
        expect(transport.lastCall('paramset.put')).toEqual([
            'BidCos-RF',
            ['LEQ0000001:1'],
            'MASTER',
            {LOGGING: true},
            undefined,
        ]);
    });

    it('keeps a change that failed, with its reason, and applies the rest', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        transport.fail('paramset.put', 'the device is not reachable');
        stores.changeSet.stage(paramsetChange('1'));
        stores.changeSet.stage({
            kind: 'linkRemove',
            interfaceName: 'BidCos-RF',
            title: 'one link',
            pairs: [{sender: 'A:1', receiver: 'B:1'}],
            calls: ['removeLink(A:1, B:1)'],
            lines: [],
        });

        await stores.changeSet.apply();
        expect(transport.countOf('links.remove')).toBe(1);
        expect(stores.changeSet.count).toBe(1);
        expect(stores.changeSet.changes[0]?.kind).toBe('paramset');
        expect(stores.changeSet.outcomes.find((entry) => !entry.ok)?.error).toContain('not reachable');
    });

    it('can drop one entry and discard the whole set', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const first = stores.changeSet.stage(paramsetChange('1'));
        stores.changeSet.stage(paramsetChange('2'));

        await fireEvent.click(await screen.findByTestId('change-set-open'));
        await fireEvent.click(screen.getByTestId(`change-remove-${first}`));
        expect(stores.changeSet.count).toBe(1);

        await fireEvent.click(screen.getByTestId('change-set-clear'));
        expect(stores.changeSet.count).toBe(0);
        expect(screen.getByTestId('change-set-empty')).toBeTruthy();
    });

    it('has no button at all while nothing is staged', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        expect(screen.queryByTestId('change-set-open')).toBeNull();
    });

    it('cancels a running apply through write.cancel and keeps what was not written', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        let release: (() => void) | undefined;
        transport.respond('paramset.put', async (interfaceName, addresses) => {
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            return addresses.map((address) => ({
                interfaceName,
                address,
                paramset: 'MASTER',
                ok: true,
                sent: {},
                problems: [],
            }));
        });

        stores.changeSet.stage(paramsetChange('1'));
        stores.changeSet.stage(paramsetChange('2'));
        const running = stores.changeSet.apply();
        await waitFor(() => {
            expect(release).toBeTypeOf('function');
        });

        // the user presses Cancel while the first write is on the wire
        await stores.changeSet.cancel();
        expect(transport.countOf('write.cancel')).toBe(1);
        release?.();
        await running;

        // the first one finished and left the set; the second was never started
        expect(transport.countOf('paramset.put')).toBe(1);
        expect(stores.changeSet.count).toBe(1);
        expect(stores.changeSet.changes[0]?.title).toContain('2');
    });
});

describe('what can be staged', () => {
    it('the write preview of a paramset, with the payload it printed', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]');
        await fireEvent.click(within(parent as HTMLElement).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-MASTER'));
        await waitFor(() => {
            expect(document.querySelectorAll('[data-testid^="param-"]').length).toBeGreaterThan(0);
        });

        const logging = within(screen.getByTestId('param-LOGGING')).getByRole('combobox');
        await fireEvent.change(logging, {target: {value: '0'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-stage')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('write-stage'));

        expect(transport.countOf('paramset.put')).toBe(0);
        expect(stores.changeSet.count).toBe(1);
        const staged = stores.changeSet.changes[0];
        expect(staged?.kind).toBe('paramset');
        // the review prints the same call the preview did, with the same struct
        expect(staged?.calls[0]).toBe('putParamset(MEQ0123456:1, MASTER, {"LOGGING":0})');
    });

    it('a set of links from the create dialog, without creating any of them', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));

        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        await fireEvent.click(within(senders).getAllByRole('option')[0]!);

        const receivers = screen.getByTestId('add-link-receivers');
        await fireEvent.click(within(receivers).getByRole('button'));
        await fireEvent.click(within(receivers).getAllByRole('option')[0]!);
        await fireEvent.click(within(receivers).getAllByRole('option')[1]!);

        await fireEvent.click(screen.getByTestId('add-link-stage'));
        expect(transport.countOf('links.add')).toBe(0);
        expect(stores.changeSet.count).toBe(1);
        const staged = stores.changeSet.changes[0];
        expect(staged?.kind).toBe('linkAdd');
        expect(staged?.calls).toHaveLength(2);
    });
});
