import type {EventRecord} from '@homematic-manager/core';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DEMO_EVENT_SCRIPT} from './demoData.js';
import {startDemoEvents} from './demoEvents.js';
import {MockTransport} from './MockTransport.js';

describe('startDemoEvents', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('replays the script in order, wraps around and stops when told to', () => {
        const transport = new MockTransport();
        const seen: EventRecord[] = [];
        transport.on('rpc.event', (record) => seen.push(record));

        const stop = startDemoEvents(transport, {intervalMs: 10, now: () => 1234});
        vi.advanceTimersByTime(10 * (DEMO_EVENT_SCRIPT.length + 1));
        stop();
        const afterStop = seen.length;
        vi.advanceTimersByTime(100);

        expect(seen).toHaveLength(afterStop);
        expect(seen.length).toBe(DEMO_EVENT_SCRIPT.length + 1);
        expect(seen[0]).toEqual({...DEMO_EVENT_SCRIPT[0], timestamp: 1234});
        expect(seen.at(-1)).toEqual({...DEMO_EVENT_SCRIPT[0], timestamp: 1234});
    });

    it('uses the wall clock and a 2.5 s interval by default', () => {
        const transport = new MockTransport();
        const seen: EventRecord[] = [];
        transport.on('rpc.event', (record) => seen.push(record));
        const stop = startDemoEvents(transport);
        vi.advanceTimersByTime(2500);
        stop();
        expect(seen).toHaveLength(1);
        expect(seen[0]?.timestamp).toBeGreaterThan(0);
    });
});
