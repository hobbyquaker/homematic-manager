import {describe, expect, it} from 'vitest';

import {deviceAddressOf, isUnreachDatapoint, UnreachCache, UNREACH_DATAPOINTS} from './unreach.js';

describe('the small helpers', () => {
    it('knows the two datapoints and strips a channel index', () => {
        expect(UNREACH_DATAPOINTS).toEqual(['UNREACH', 'STICKY_UNREACH']);
        expect(isUnreachDatapoint('UNREACH')).toBe(true);
        expect(isUnreachDatapoint('STICKY_UNREACH')).toBe(true);
        expect(isUnreachDatapoint('CONFIG_PENDING')).toBe(false);
        expect(deviceAddressOf('LEQ0000001:0')).toBe('LEQ0000001');
        expect(deviceAddressOf('LEQ0000001')).toBe('LEQ0000001');
    });
});

describe('UnreachCache', () => {
    it('counts the edge, not the report', () => {
        const cache = new UnreachCache();
        // rfd re-sends UNREACH on every failed attempt, and the service-message poll repeats the
        // sticky flag on every round: counting reports would count how often we asked
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'UNREACH', true, 1000)).toBe(true);
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'UNREACH', true, 1100)).toBe(false);
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true, 1200)).toBe(false);
        expect(cache.countOf('BidCos-RF', 'LEQ1')).toBe(1);

        expect(cache.note('BidCos-RF', 'LEQ1:0', 'UNREACH', false, 2000)).toBe(true);
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'UNREACH', true, 3000)).toBe(true);
        expect(cache.countOf('BidCos-RF', 'LEQ1')).toBe(2);
    });

    it('does not treat an acknowledged STICKY_UNREACH as a recovery', () => {
        const cache = new UnreachCache();
        cache.note('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true, 1000);
        // acknowledging writes STICKY_UNREACH = false; the device is not back because of that
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', false, 1100)).toBe(false);
        cache.note('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true, 1200);
        expect(cache.countOf('BidCos-RF', 'LEQ1')).toBe(1);

        cache.note('BidCos-RF', 'LEQ1:0', 'UNREACH', false, 1300);
        cache.note('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true, 1400);
        expect(cache.countOf('BidCos-RF', 'LEQ1')).toBe(2);
    });

    it('ignores anything that is not one of the two booleans', () => {
        const cache = new UnreachCache();
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'LOWBAT', true, 1)).toBe(false);
        expect(cache.note('BidCos-RF', 'LEQ1:0', 'UNREACH', 'true', 1)).toBe(false);
        expect(cache.list()).toEqual([]);
    });

    it('lists the busiest device first and filters by interface', () => {
        const cache = new UnreachCache();
        cache.note('BidCos-RF', 'A:0', 'UNREACH', true, 10);
        cache.note('BidCos-RF', 'A:0', 'UNREACH', false, 20);
        cache.note('BidCos-RF', 'A:0', 'UNREACH', true, 30);
        cache.note('BidCos-RF', 'B:0', 'UNREACH', true, 40);
        cache.note('HmIP-RF', 'C:0', 'UNREACH', true, 50);

        expect(cache.list().map((entry) => [entry.address, entry.count])).toEqual([
            ['A', 2],
            ['B', 1],
            ['C', 1],
        ]);
        expect(cache.list('HmIP-RF').map((entry) => entry.address)).toEqual(['C']);
        expect(cache.list('BidCos-RF')[0]).toMatchObject({count: 2, lastAt: 30, unreach: true});
    });

    it('resets a device, an interface or everything, and keeps the current state', () => {
        const cache = new UnreachCache();
        cache.note('BidCos-RF', 'A:0', 'UNREACH', true, 10);
        cache.note('BidCos-RF', 'B:0', 'UNREACH', true, 20);
        cache.note('BidCos-RF', 'B:0', 'UNREACH', false, 30);
        cache.note('HmIP-RF', 'C:0', 'UNREACH', true, 40);

        cache.reset('BidCos-RF', 'B');
        expect(cache.list('BidCos-RF').map((entry) => entry.address)).toEqual(['A']);

        cache.reset('BidCos-RF');
        // A is unreachable right now: the counter is zeroed, the entry stays, and the recovery that
        // follows must not be counted as the start of a new outage
        expect(cache.list('BidCos-RF')).toEqual([{interfaceName: 'BidCos-RF', address: 'A', count: 0, unreach: true}]);
        expect(cache.note('BidCos-RF', 'A:0', 'UNREACH', true, 50)).toBe(false);

        cache.reset();
        // C is unreachable too, so it keeps its (zeroed) entry for the same reason A does
        expect(cache.list()).toEqual([
            {interfaceName: 'BidCos-RF', address: 'A', count: 0, unreach: true},
            {interfaceName: 'HmIP-RF', address: 'C', count: 0, unreach: true},
        ]);
        cache.clear();
        expect(cache.list()).toEqual([]);
    });

    it('round-trips through JSON and refuses rubbish', () => {
        const cache = new UnreachCache();
        cache.note('BidCos-RF', 'A:0', 'UNREACH', true, 10);
        const json = cache.toJSON();

        const restored = new UnreachCache();
        restored.load(json);
        expect(restored.countOf('BidCos-RF', 'A')).toBe(1);
        // the state is restored as well, so the `getServiceMessages` sweep of the next start does
        // not count the same outage a second time
        expect(restored.list()[0]?.unreach).toBe(true);
        expect(restored.note('BidCos-RF', 'A:0', 'STICKY_UNREACH', true, 20)).toBe(false);
        expect(restored.countOf('BidCos-RF', 'A')).toBe(1);

        restored.load('nonsense');
        expect(restored.list()).toEqual([]);
        restored.load([{interfaceName: 'x'}, null, {interfaceName: 'i', address: 'a', count: Number.NaN}]);
        expect(restored.list()).toEqual([]);
    });
});
