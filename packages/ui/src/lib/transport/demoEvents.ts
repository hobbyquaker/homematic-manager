import type {EventRecord} from '@homematic-manager/core';

import {DEMO_EVENT_SCRIPT} from './demoData.js';
import type {MockTransport} from './MockTransport.js';

export interface DemoEventOptions {
    /** Milliseconds between two events. */
    readonly intervalMs?: number;
    /** Milliseconds since epoch of the first event; defaults to now. */
    readonly now?: () => number;
}

/**
 * Replays {@link DEMO_EVENT_SCRIPT} on a timer so the events tab, the service-message counter and
 * the connection indicator move in demo mode. Returns the stop function.
 */
export function startDemoEvents(transport: MockTransport, options: DemoEventOptions = {}): () => void {
    const intervalMs = options.intervalMs ?? 2500;
    const now = options.now ?? (() => Date.now());
    let index = 0;
    const timer = setInterval(() => {
        const scripted = DEMO_EVENT_SCRIPT[index % DEMO_EVENT_SCRIPT.length];
        index += 1;
        if (!scripted) {
            return;
        }
        const record: EventRecord = {...scripted, timestamp: now()};
        transport.emit('rpc.event', record);
    }, intervalMs);
    return () => {
        clearInterval(timer);
    };
}
