import {flushSync} from 'svelte';
import {describe, expect, it, vi} from 'vitest';

import {MockTransport} from '../transport/MockTransport.js';

import {LinksStore} from './LinksStore.svelte.js';
import {NoticesStore} from './NoticesStore.svelte.js';

/**
 * B-104: the device grid reads the links of its interface from an effect (#25). With an interface
 * that refused `getLinks`, the end of every failed read re-ran that effect into the next read: on
 * an HmIP-only openccu-lite system thousands of `links.list BidCos-RF` in half a minute, and the
 * toast stack full of the same error.
 */
describe('LinksStore.ensure from an effect (B-104)', () => {
    it('reads a refusing interface once and does not loop', async () => {
        const transport = new MockTransport({demo: true});
        transport.fail('links.list', 'BidCos-RF: no such interface: BidCos-RF');
        const notices = new NoticesStore(transport);
        const store = new LinksStore(transport, notices);

        const stop = $effect.root(() => {
            $effect(() => {
                void store.ensure('BidCos-RF');
            });
        });
        flushSync();
        await vi.waitFor(() => {
            expect(store.failed['BidCos-RF']).toBe(true);
        });
        // a few turns of the loop the old code ran
        for (let round = 0; round < 5; round += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            flushSync();
        }
        expect(transport.countOf('links.list')).toBe(1);
        expect(notices.items).toHaveLength(1);
        stop();
    });

    it('does not re-run the effect that calls it when the read succeeds', async () => {
        const transport = new MockTransport({demo: true});
        transport.respond('links.list', () => []);
        const store = new LinksStore(transport, new NoticesStore(transport));
        let runs = 0;

        const stop = $effect.root(() => {
            $effect(() => {
                runs += 1;
                void store.ensure('HmIP-RF');
            });
        });
        flushSync();
        await vi.waitFor(() => {
            expect(store.links['HmIP-RF']).toEqual([]);
        });
        flushSync();
        expect(runs).toBe(1);
        expect(transport.countOf('links.list')).toBe(1);
        stop();
    });

    it('leaves a failed interface to an explicit load, which clears the mark when it works', async () => {
        const transport = new MockTransport({demo: true});
        transport.fail('links.list', 'down');
        const store = new LinksStore(transport, new NoticesStore(transport));

        await store.ensure('BidCos-RF');
        await store.ensure('BidCos-RF');
        expect(transport.countOf('links.list')).toBe(1);

        transport.respond('links.list', () => []);
        await store.load('BidCos-RF');
        expect(store.failed['BidCos-RF']).toBe(false);
        expect(store.of('BidCos-RF')).toEqual([]);

        store.forget('BidCos-RF');
        expect(store.failed['BidCos-RF']).toBeUndefined();
        await store.ensure('BidCos-RF');
        expect(transport.countOf('links.list')).toBe(3);
        store.forget();
        expect(store.links).toEqual({});
    });
});
