import {describe, expect, it, vi} from 'vitest';

import {CANCELLED_MESSAGE, WriteQueue} from './queue.js';

/** A queue whose clock and timer the test drives. */
function harness(paces: Record<string, number> = {}) {
    const clock = {value: 0};
    const timers: {callback: () => void; ms: number}[] = [];
    const queue = new WriteQueue({
        paceFor: (name) => paces[name] ?? 100,
        now: () => clock.value,
        schedule: (callback, ms) => timers.push({callback, ms}),
    });
    const runTimers = (): void => {
        const due = timers.splice(0);
        for (const timer of due) {
            clock.value += timer.ms;
            timer.callback();
        }
    };
    return {queue, clock, timers, runTimers};
}

/** A task that resolves when the test says so. */
function deferred(): {task: () => Promise<string>; resolve: (value: string) => void; started: () => boolean} {
    let started = false;
    let settle: ((value: string) => void) | undefined;
    return {
        task: () => {
            started = true;
            return new Promise<string>((resolve) => {
                settle = resolve;
            });
        },
        resolve: (value) => settle?.(value),
        started: () => started,
    };
}

describe('WriteQueue', () => {
    it('runs the first task immediately', async () => {
        const {queue} = harness();
        await expect(queue.enqueue('HmIP-RF', () => Promise.resolve(42))).resolves.toBe(42);
        expect(queue.pending).toBe(0);
    });

    it('runs one task per interface at a time', async () => {
        const {queue, runTimers} = harness({'HmIP-RF': 0});
        const first = deferred();
        const second = deferred();
        const a = queue.enqueue('HmIP-RF', first.task);
        const b = queue.enqueue('HmIP-RF', second.task);
        expect(first.started()).toBe(true);
        expect(second.started()).toBe(false);
        expect(queue.pending).toBe(1);
        first.resolve('a');
        await a;
        runTimers();
        expect(second.started()).toBe(true);
        second.resolve('b');
        await expect(b).resolves.toBe('b');
    });

    it('keeps the pace between two writes of one interface', async () => {
        const {queue, timers, clock} = harness({'HmIP-RF': 500});
        await queue.enqueue('HmIP-RF', () => Promise.resolve(1));
        clock.value += 100;
        const second = queue.enqueue('HmIP-RF', () => Promise.resolve(2));
        expect(timers).toHaveLength(1);
        expect(timers[0]?.ms).toBe(400);
        timers[0]?.callback();
        await expect(second).resolves.toBe(2);
    });

    it('does not wait when the pace has already passed', async () => {
        const {queue, timers, clock} = harness({'HmIP-RF': 100});
        await queue.enqueue('HmIP-RF', () => Promise.resolve(1));
        clock.value += 1000;
        await expect(queue.enqueue('HmIP-RF', () => Promise.resolve(2))).resolves.toBe(2);
        expect(timers).toHaveLength(0);
    });

    it('paces the interfaces independently', async () => {
        const {queue} = harness({'HmIP-RF': 1000, 'BidCos-RF': 0});
        const hmip = deferred();
        void queue.enqueue('HmIP-RF', hmip.task);
        await expect(queue.enqueue('BidCos-RF', () => Promise.resolve('bidcos'))).resolves.toBe('bidcos');
        hmip.resolve('hmip');
    });

    it('rejects with the task error and keeps going', async () => {
        const {queue, runTimers} = harness({'HmIP-RF': 0});
        const failing = queue.enqueue('HmIP-RF', () => Promise.reject(new Error('fault -7')));
        await expect(failing).rejects.toThrow('fault -7');
        runTimers();
        await expect(queue.enqueue('HmIP-RF', () => Promise.resolve('next'))).resolves.toBe('next');
    });

    it('wraps a non-error rejection', async () => {
        const {queue} = harness({'HmIP-RF': 0});
        // a task that rejects with a bare string is what the wrapping in the queue is there for
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        const task = (): Promise<never> => Promise.reject('plain');
        await expect(queue.enqueue('HmIP-RF', task)).rejects.toThrow('plain');
    });

    it('cancels what has not started and leaves the running task alone', async () => {
        const {queue} = harness({'HmIP-RF': 0});
        const running = deferred();
        const first = queue.enqueue('HmIP-RF', running.task);
        const second = queue.enqueue('HmIP-RF', () => Promise.resolve('never'));
        const third = queue.enqueue('HmIP-RF', () => Promise.resolve('never'));
        expect(queue.cancel()).toBe(2);
        await expect(second).rejects.toThrow(CANCELLED_MESSAGE);
        await expect(third).rejects.toThrow(CANCELLED_MESSAGE);
        running.resolve('done');
        await expect(first).resolves.toBe('done');
    });

    it('cancels one interface only', async () => {
        const {queue} = harness({'HmIP-RF': 0, 'BidCos-RF': 0});
        const hmip = deferred();
        const bidcos = deferred();
        void queue.enqueue('HmIP-RF', hmip.task);
        void queue.enqueue('BidCos-RF', bidcos.task);
        const queued = queue.enqueue('HmIP-RF', () => Promise.resolve('x'));
        expect(queue.cancel('BidCos-RF')).toBe(0);
        expect(queue.cancel('HmIP-RF')).toBe(1);
        await expect(queued).rejects.toThrow(CANCELLED_MESSAGE);
        hmip.resolve('a');
        bidcos.resolve('b');
    });

    it('uses a real timer when none is injected', async () => {
        const queue = new WriteQueue({paceFor: () => 1});
        const started = Date.now();
        await queue.enqueue('HmIP-RF', () => Promise.resolve(1));
        await queue.enqueue('HmIP-RF', () => Promise.resolve(2));
        expect(Date.now() - started).toBeGreaterThanOrEqual(0);
    });

    it('does nothing when an empty queue is drained', () => {
        const {queue} = harness();
        expect(queue.cancel('nothing')).toBe(0);
        expect(queue.pending).toBe(0);
    });

    it('reports how many tasks wait over all interfaces', () => {
        const {queue} = harness({a: 0, b: 0});
        const a = deferred();
        const b = deferred();
        void queue.enqueue('a', a.task);
        void queue.enqueue('a', () => Promise.resolve(1));
        void queue.enqueue('b', b.task);
        void queue.enqueue('b', () => Promise.resolve(1));
        expect(queue.pending).toBe(2);
        queue.cancel();
        a.resolve('');
        b.resolve('');
    });

    it('does not start a queued task twice', async () => {
        const {queue, runTimers} = harness({x: 0});
        const run = vi.fn(() => Promise.resolve(1));
        const first = deferred();
        void queue.enqueue('x', first.task);
        const second = queue.enqueue('x', run);
        first.resolve('a');
        await Promise.resolve();
        runTimers();
        await second;
        expect(run).toHaveBeenCalledTimes(1);
    });
});
