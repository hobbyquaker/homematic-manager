import {describe, expect, it, vi} from 'vitest';

import {createQuitSequence, withDeadline, type QuitOptions} from './lifecycle.js';

describe('withDeadline', () => {
    it('passes the value through and never reports a promise that is quick enough', async () => {
        const onOverrun = vi.fn();
        await expect(withDeadline(Promise.resolve('value'), 1000, onOverrun)).resolves.toBe('value');
        expect(onOverrun).not.toHaveBeenCalled();
    });

    it('passes a rejection through unchanged', async () => {
        const onOverrun = vi.fn();
        await expect(withDeadline(Promise.reject(new Error('no')), 1000, onOverrun)).rejects.toThrow('no');
        expect(onOverrun).not.toHaveBeenCalled();
    });

    it('reports the overrun but keeps waiting: an unfinished open cannot be abandoned', async () => {
        vi.useFakeTimers();
        try {
            const onOverrun = vi.fn();
            let settle: (value: string) => void = () => undefined;
            const pending = withDeadline(
                new Promise<string>((resolve) => {
                    settle = resolve;
                }),
                5000,
                onOverrun,
            );
            await vi.advanceTimersByTimeAsync(5000);
            expect(onOverrun).toHaveBeenCalledTimes(1);
            settle('late');
            await expect(pending).resolves.toBe('late');
        } finally {
            vi.useRealTimers();
        }
    });
});

function quitHarness(overrides: Partial<QuitOptions> = {}): {
    sequence: ReturnType<typeof createQuitSequence>;
    calls: string[];
    errors: {scope: string; message: string}[];
} {
    const calls: string[] = [];
    const errors: {scope: string; message: string}[] = [];
    const sequence = createQuitSequence({
        stop: async () => {
            calls.push('stop');
        },
        finish: () => {
            calls.push('finish');
        },
        installIfArmed: () => {
            calls.push('installIfArmed');
            return false;
        },
        quit: () => {
            calls.push('quit');
        },
        exit: (code) => {
            calls.push(`exit ${String(code)}`);
        },
        onError: (scope, error) => {
            errors.push({scope, message: error instanceof Error ? error.message : String(error)});
        },
        trace: () => undefined,
        ...overrides,
    });
    return {sequence, calls, errors};
}

describe('createQuitSequence', () => {
    it('defers the first quit, runs the shutdown and quits again', async () => {
        const {sequence, calls} = quitHarness();
        expect(sequence.willQuit()).toBe(true);
        await vi.waitFor(() => expect(calls).toContain('quit'));
        expect(calls).toEqual(['stop', 'finish', 'installIfArmed', 'quit']);
        // The second `will-quit`, the one the final `quit()` raises, must let the app go.
        expect(sequence.willQuit()).toBe(false);
    });

    it('defers every further will-quit while the shutdown is still running', async () => {
        let release: () => void = () => undefined;
        const {sequence, calls} = quitHarness({
            stop: async () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        });
        expect(sequence.willQuit()).toBe(true);
        expect(sequence.willQuit()).toBe(true);
        expect(calls).toEqual([]);
        release();
        await vi.waitFor(() => expect(calls).toContain('quit'));
    });

    it('goes on when the backend does not stop within the timeout', async () => {
        vi.useFakeTimers();
        try {
            const {sequence, calls} = quitHarness({stop: async () => new Promise<void>(() => undefined)});
            expect(sequence.willQuit()).toBe(true);
            await vi.advanceTimersByTimeAsync(8000);
            expect(calls).toEqual(['finish', 'installIfArmed', 'quit']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('quits even when stopping, finishing or the updater throws', async () => {
        const {sequence, calls, errors} = quitHarness({
            stop: async () => {
                throw new Error('stop failed');
            },
            finish: () => {
                throw new Error('save failed');
            },
            installIfArmed: () => {
                throw new Error('updater failed');
            },
        });
        expect(sequence.willQuit()).toBe(true);
        await vi.waitFor(() => expect(calls).toContain('quit'));
        // Every one of the three was caught: an unhandled rejection here would put a modal error
        // box in front of an app that is trying to quit, and the process would never end.
        expect(errors.map((entry) => entry.message)).toEqual(['stop failed', 'save failed', 'updater failed']);
    });

    it('leaves the process to the installer when the updater is armed', async () => {
        const {sequence, calls} = quitHarness({installIfArmed: () => true});
        expect(sequence.willQuit()).toBe(true);
        await vi.waitFor(() => expect(calls).toContain('finish'));
        expect(calls).not.toContain('quit');
    });

    it('exits the hard way when quit() does not take', async () => {
        vi.useFakeTimers();
        try {
            const {sequence, calls, errors} = quitHarness({
                quit: () => {
                    calls.push('quit (ignored)');
                },
            });
            expect(sequence.willQuit()).toBe(true);
            await vi.advanceTimersByTimeAsync(15_000);
            expect(calls).toContain('exit 0');
            expect(errors.at(-1)?.message).toContain('did not quit within 15000ms');
        } finally {
            vi.useRealTimers();
        }
    });
});
