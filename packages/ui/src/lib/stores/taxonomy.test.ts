import {describe, expect, it} from 'vitest';

import {MockTransport} from '../transport/MockTransport.js';

import {NoticesStore} from './NoticesStore.svelte.js';
import {TaxonomyStore} from './TaxonomyStore.svelte.js';

function build(transport = new MockTransport({demo: true})): {store: TaxonomyStore; notices: NoticesStore} {
    const notices = new NoticesStore(transport);
    return {store: new TaxonomyStore(transport, notices), notices};
}

describe('TaxonomyStore', () => {
    it('loads the snapshot and answers the questions of the grid', async () => {
        const {store} = build();
        expect(store.available).toBe(false);
        await store.load();

        expect(store.state?.provider).toBe('local');
        expect(store.available).toBe(true);
        expect(store.writable).toBe(true);
        expect(store.flatOnly).toBe(false);
        expect(store.options('room').map((option) => option.label)).toEqual([
            'Erdgeschoss',
            'Küche',
            'Wohnzimmer',
            'Flur',
            'Obergeschoss',
            'Bad',
            'Schlafzimmer',
            'Außen',
        ]);
        const ref = store.refOf('BidCos-RF', 'MEQ0123456:1');
        expect(ref).toBe('BidCos-RF.MEQ0123456:1');
        expect(store.view(ref)?.rooms).toEqual(['Küche']);
        expect(store.matches(ref, 'room/eg')).toBe(true);
        expect(store.matches(ref, 'room/og')).toBe(false);
        expect(store.deviceMatches('BidCos-RF.MEQ0123456', [ref], 'room/eg/kueche')).toBe(true);
        expect(store.members('room/eg')).toEqual([
            'BidCos-RF.GEQ0567890:1',
            'BidCos-RF.JEQ0234567:1',
            'BidCos-RF.MEQ0123456:1',
        ]);
        expect(store.nameOf('room/eg/kueche')).toBe('Küche');
        expect(store.nameOf('room/nirgends')).toBe('room/nirgends');
    });

    it('stays quiet without a store: no state, every answer "no", no notice (D-2)', async () => {
        const transport = new MockTransport();
        const {store, notices} = build(transport);
        await store.load();

        expect(store.state).toBeUndefined();
        expect(store.available).toBe(false);
        expect(store.writable).toBe(false);
        expect(store.options('room')).toEqual([]);
        expect(notices.items).toEqual([]);
    });

    it('follows the three events, and stops after dispose', async () => {
        const transport = new MockTransport({demo: true});
        const {store} = build(transport);
        await store.load();

        transport.emit('meta.changed', {
            provider: 'occulite',
            reachable: true,
            writable: false,
            revision: 9,
            objects: 1,
        });
        expect(store.writable).toBe(false);
        expect(store.available).toBe(true);
        transport.emit('meta.enums.changed', {room: {name: {en: 'Rooms'}, tree: [{id: 'keller', name: 'Keller'}]}});
        expect(store.options('room').map((option) => option.path)).toEqual(['room/keller']);
        transport.emit('meta.objects.changed', {});
        expect(store.members('room/keller')).toEqual([]);

        store.dispose();
        expect(transport.listenerCount('meta.changed')).toBe(0);
        expect(transport.listenerCount('meta.enums.changed')).toBe(0);
        expect(transport.listenerCount('meta.objects.changed')).toBe(0);
    });

    it('reads `flat` from the state - a ReGa store has no floors', async () => {
        const transport = new MockTransport({demo: true});
        const {store} = build(transport);
        await store.load();
        transport.emit('meta.changed', {
            provider: 'local',
            reachable: true,
            writable: true,
            revision: 1,
            objects: 0,
            flat: true,
        });
        expect(store.flatOnly).toBe(true);
    });

    it('assigns the selection with one request and sees the change through the event', async () => {
        const transport = new MockTransport({demo: true});
        const {store} = build(transport);
        await store.load();

        const refs = ['BidCos-RF.MEQ0123456:1', 'BidCos-RF.JEQ0234567:1'];
        await expect(store.assign(refs, 'room/aussen', true)).resolves.toBe(true);
        expect(transport.lastCall('meta.assign')).toEqual([refs, 'room/aussen', true]);
        expect(store.view('BidCos-RF.JEQ0234567:1')?.rooms).toEqual(['Flur', 'Außen']);
        expect(store.state?.revision).toBe(8);

        await expect(store.assign(refs, 'room/aussen', false)).resolves.toBe(true);
        expect(store.view('BidCos-RF.JEQ0234567:1')?.rooms).toEqual(['Flur']);
        // nothing to do is not a request
        await expect(store.assign([], 'room/aussen', true)).resolves.toBe(false);
        expect(transport.countOf('meta.assign')).toBe(2);
    });

    it('sends the dialog save one request after another and answers each with its outcome (task 49)', async () => {
        const transport = new MockTransport({demo: true});
        const {store, notices} = build(transport);
        await store.load();
        const started: string[] = [];
        const release: Array<() => void> = [];
        transport.respond('meta.assign', (_refs, path) => {
            started.push(path);
            return new Promise<null>((resolve, reject) => {
                release.push(() => {
                    if (path === 'room/aussen') {
                        reject(new Error('forbidden'));
                    } else {
                        resolve(null);
                    }
                });
            });
        });

        const saving = store.assignEach([
            {path: 'room/eg/kueche', on: false, refs: ['BidCos-RF.MEQ0123456:1']},
            {path: 'room/aussen', on: true, refs: ['BidCos-RF.MEQ0123456:1']},
            {path: 'function/heizung', on: true, refs: ['BidCos-RF.MEQ0123456:1']},
        ]);
        // the second is not asked while the first is still out
        await Promise.resolve();
        expect(started).toEqual(['room/eg/kueche']);
        for (let index = 0; index < 3; index += 1) {
            await Promise.resolve();
            release.shift()?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(started).toHaveLength(Math.min(3, index + 2));
        }
        await expect(saving).resolves.toEqual([
            {path: 'room/eg/kueche', ok: true},
            {path: 'room/aussen', ok: false, message: 'forbidden'},
            {path: 'function/heizung', ok: true},
        ]);
        // the dialog shows a refusal; the store does not add a toast on top
        expect(notices.items).toEqual([]);
    });

    it('creates, renames, moves and deletes nodes through the contract', async () => {
        const transport = new MockTransport({demo: true});
        const {store} = build(transport);
        await store.load();

        await expect(store.createNode('room', undefined, 'Keller')).resolves.toBe('room/keller');
        expect(transport.lastCall('meta.node.create')).toEqual(['room', undefined, 'Keller']);
        await expect(store.createNode('room', 'room/keller', 'Werkstatt')).resolves.toBe('room/keller/werkstatt');
        await expect(store.renameNode('room/keller/werkstatt', 'Hobbyraum')).resolves.toBe(true);
        expect(store.nameOf('room/keller/werkstatt')).toBe('Hobbyraum');
        await expect(store.moveNode('room/keller/werkstatt', null)).resolves.toBe(true);
        expect(store.options('room').map((option) => option.path)).toContain('room/werkstatt');
        await expect(store.deleteNode('room/werkstatt', false)).resolves.toBe(true);
        expect(store.options('room').map((option) => option.path)).not.toContain('room/werkstatt');
    });

    it('reads the store again on request - ReGa has no change stream (task 27)', async () => {
        const transport = new MockTransport({demo: true});
        const {store, notices} = build(transport);
        await store.load();
        await expect(store.refresh()).resolves.toBe(true);
        expect(transport.countOf('meta.refresh')).toBe(1);
        expect(store.state?.provider).toBe('local');
        transport.fail('meta.refresh', 'ReGa is not answering');
        await expect(store.refresh()).resolves.toBe(false);
        expect(notices.items.at(-1)?.message).toBe('meta.refresh: ReGa is not answering');
    });

    it('turns a refused write into a notice and answers false', async () => {
        const transport = new MockTransport({demo: true});
        const {store, notices} = build(transport);
        await store.load();

        // the demo store refuses to delete a node that has members unless they are detached
        await expect(store.deleteNode('room/eg', false)).resolves.toBe(false);
        expect(notices.items.at(-1)?.message).toContain('meta.node.delete');
        expect(store.options('room').map((option) => option.path)).toContain('room/eg');

        await expect(store.deleteNode('room/eg', true)).resolves.toBe(true);
        expect(store.view('BidCos-RF.MEQ0123456:1')?.rooms).toEqual([]);

        transport.fail('meta.assign', {message: 'forbidden', kind: 'validation'});
        await expect(store.assign(['BidCos-RF.MEQ0123456:1'], 'room/aussen', true)).resolves.toBe(false);
        expect(notices.items.at(-1)?.message).toBe('meta.assign: forbidden');
        transport.fail('meta.node.create', 'no');
        await expect(store.createNode('room', undefined, 'x')).resolves.toBeUndefined();
        transport.fail('meta.node.update', 'no');
        await expect(store.renameNode('room/aussen', 'x')).resolves.toBe(false);
        await expect(store.moveNode('room/aussen', null)).resolves.toBe(false);
    });
});
