import {describe, expect, it} from 'vitest';

import {API_EVENT_NAMES} from './types.js';

/**
 * The runtime half of the contract. The type half is checked by `tsc`: `API_EVENT_FLAGS` is a
 * `satisfies Record<ApiEventName, true>`, so a missing or invented name does not compile. What is
 * left to assert here is that the exported array really carries those keys and is not mutable.
 */
describe('API_EVENT_NAMES', () => {
    it('lists every event of the contract exactly once', () => {
        expect([...API_EVENT_NAMES].sort()).toEqual([
            'config.changed',
            'devices.changed',
            'interfaces.changed',
            'names.changed',
            'notice',
            'rega.changed',
            'rpc.event',
            'serviceMessages.changed',
            'unreach.changed',
            'write.progress',
            'writeLog.appended',
        ]);
        expect(new Set(API_EVENT_NAMES).size).toBe(API_EVENT_NAMES.length);
    });

    it('is frozen, so a subscriber cannot shorten the list for everyone else', () => {
        expect(Object.isFrozen(API_EVENT_NAMES)).toBe(true);
    });
});
