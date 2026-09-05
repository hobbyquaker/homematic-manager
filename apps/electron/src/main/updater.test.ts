import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {UpdateState} from '../shared/ipc.js';

import {UpdateFlow, updaterDisabledReason, type AutoUpdaterLike} from './updater.js';

/** An `autoUpdater` whose answers the test decides and whose events it fires. */
class FakeUpdater implements AutoUpdaterLike {
    autoDownload = true;
    autoInstallOnAppQuit = true;
    checks = 0;
    downloads = 0;
    installed: Array<[boolean | undefined, boolean | undefined]> = [];
    available: string | null = null;
    failCheck: Error | undefined;
    failDownload: Error | undefined;
    failInstall: Error | undefined;
    /** Set to have `downloadUpdate()` resolve without an `update-downloaded` event. */
    silentDownload = false;

    readonly #handlers = new Map<string, Array<(...args: never[]) => void>>();

    checkForUpdates(): Promise<{updateInfo: {version: string}} | null> {
        this.checks += 1;
        if (this.failCheck) {
            return Promise.reject(this.failCheck);
        }
        return Promise.resolve(this.available === null ? null : {updateInfo: {version: this.available}});
    }

    async downloadUpdate(): Promise<unknown> {
        this.downloads += 1;
        if (this.failDownload) {
            throw this.failDownload;
        }
        if (!this.silentDownload) {
            this.emit('download-progress', {percent: 42.4});
            this.emit('update-downloaded', {version: this.available ?? '9.9.9'});
        }
        return null;
    }

    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
        if (this.failInstall) {
            throw this.failInstall;
        }
        this.installed.push([isSilent, isForceRunAfter]);
    }

    on(event: string, handler: (...args: never[]) => void): this {
        const list = this.#handlers.get(event) ?? [];
        list.push(handler);
        this.#handlers.set(event, list);
        return this;
    }

    emit(event: string, ...args: unknown[]): void {
        for (const handler of this.#handlers.get(event) ?? []) {
            (handler as (...a: unknown[]) => void)(...args);
        }
    }
}

let updater: FakeUpdater;
let states: UpdateState[];
let errors: Array<[string, unknown]>;

const flow = (overrides: Partial<ConstructorParameters<typeof UpdateFlow>[0]> = {}): UpdateFlow =>
    new UpdateFlow({
        updater,
        enabled: true,
        currentVersion: '3.0.0',
        onState: (s) => states.push(s),
        onError: (scope, error) => errors.push([scope, error]),
        ...overrides,
    });

beforeEach(() => {
    updater = new FakeUpdater();
    states = [];
    errors = [];
});

describe('UpdateFlow', () => {
    it('switches the silent behaviour of electron-updater off, as D-16 demands', () => {
        flow();
        expect(updater.autoDownload).toBe(false);
        expect(updater.autoInstallOnAppQuit).toBe(false);
    });

    it('starts idle when it is enabled', () => {
        expect(flow().state).toEqual({phase: 'idle', dismissed: false});
    });

    it('reports itself disabled with a reason, and then does nothing at all', async () => {
        const disabled = flow({enabled: false, disabledReason: 'this build is not packaged'});
        expect(disabled.state).toEqual({
            phase: 'disabled',
            dismissed: false,
            message: 'this build is not packaged',
        });
        disabled.start();
        await disabled.check();
        await disabled.download();
        expect(updater.checks).toBe(0);
        expect(updater.autoDownload).toBe(true);
    });

    it('stays idle when the running version is the newest', async () => {
        updater.available = '3.0.0';
        const f = flow();
        await expect(f.check()).resolves.toEqual({phase: 'idle', dismissed: false});
        expect(states.map((s) => s.phase)).toEqual(['checking', 'idle']);
    });

    it('stays idle when there is no release at all', async () => {
        const f = flow();
        await expect(f.check()).resolves.toMatchObject({phase: 'idle'});
    });

    it('announces a newer version without downloading it', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await expect(f.check()).resolves.toEqual({phase: 'available', version: '3.1.0', dismissed: false});
        expect(updater.downloads).toBe(0);
    });

    it('downloads on request, reports the progress and ends downloaded', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        states.length = 0;
        await expect(f.download()).resolves.toEqual({phase: 'downloaded', version: '3.1.0', dismissed: false});
        expect(states.map((s) => s.phase)).toEqual(['downloading', 'downloading', 'downloaded']);
        expect(states[1]?.percent).toBe(42);
    });

    it('ends downloaded even when the updater emits no event', async () => {
        updater.available = '3.1.0';
        updater.silentDownload = true;
        const f = flow();
        await f.check();
        await expect(f.download()).resolves.toMatchObject({phase: 'downloaded', version: '3.1.0'});
    });

    it('refuses to download what was not announced', async () => {
        const f = flow();
        await expect(f.download()).resolves.toMatchObject({phase: 'idle'});
        expect(updater.downloads).toBe(0);
    });

    it('installs only after the explicit confirmation', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        await f.download();
        expect(f.willInstallOnQuit).toBe(false);
        expect(f.installIfArmed()).toBe(false);
        expect(updater.installed).toEqual([]);

        expect(f.installOnQuit()).toMatchObject({phase: 'installOnQuit', version: '3.1.0'});
        expect(f.willInstallOnQuit).toBe(true);
        expect(f.installIfArmed()).toBe(true);
        expect(updater.installed).toEqual([[false, true]]);
    });

    it('does not arm the install before the download finished', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        expect(f.installOnQuit()).toMatchObject({phase: 'available'});
        expect(f.willInstallOnQuit).toBe(false);
    });

    it('installs at most once', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        await f.download();
        f.installOnQuit();
        expect(f.installIfArmed()).toBe(true);
        expect(f.installIfArmed()).toBe(false);
        expect(updater.installed).toHaveLength(1);
    });

    it('keeps a dismissal for the same version and drops it for a newer one', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        f.dismiss();
        expect(f.state.dismissed).toBe(true);

        await f.check();
        expect(f.state).toMatchObject({phase: 'available', version: '3.1.0', dismissed: true});

        updater.available = '3.2.0';
        await f.check();
        expect(f.state).toMatchObject({phase: 'available', version: '3.2.0', dismissed: false});
    });

    it('disarms the install when the user dismisses after confirming', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        await f.download();
        f.installOnQuit();
        f.dismiss();
        expect(f.willInstallOnQuit).toBe(false);
        expect(f.installIfArmed()).toBe(false);
    });

    it('does not check again once an update is waiting for the quit', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        await f.download();
        const before = updater.checks;
        await f.check();
        expect(updater.checks).toBe(before);
    });

    it('turns a failed check into an error state and not into an exception', async () => {
        updater.failCheck = new Error('404 from GitHub');
        const f = flow();
        await expect(f.check()).resolves.toMatchObject({phase: 'error', message: '404 from GitHub'});
        expect(errors[0]?.[0]).toBe('check');
    });

    it('turns a failed download into an error state', async () => {
        updater.available = '3.1.0';
        updater.failDownload = new Error('checksum mismatch');
        const f = flow();
        await f.check();
        await expect(f.download()).resolves.toMatchObject({phase: 'error', message: 'checksum mismatch'});
    });

    it('turns a failed install into an error state and stays in the app', async () => {
        updater.available = '3.1.0';
        updater.failInstall = new Error('cannot write to /Applications');
        const f = flow();
        await f.check();
        await f.download();
        f.installOnQuit();
        expect(f.installIfArmed()).toBe(false);
        expect(f.state).toMatchObject({phase: 'error'});
    });

    it('reports an error the updater emits on its own', () => {
        const f = flow();
        updater.emit('error', new Error('ENOTFOUND github.com'));
        expect(f.state).toMatchObject({phase: 'error', message: 'ENOTFOUND github.com'});
    });

    it('runs one check at a time', async () => {
        updater.available = '3.1.0';
        const f = flow();
        const both = await Promise.all([f.check(), f.check()]);
        expect(updater.checks).toBe(1);
        expect(both[0]).toMatchObject({phase: 'available'});
    });

    it('checks after ten seconds and then every six hours', async () => {
        vi.useFakeTimers();
        try {
            const f = flow();
            f.start();
            f.start();
            expect(updater.checks).toBe(0);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(updater.checks).toBe(1);
            await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
            expect(updater.checks).toBe(2);
            f.stop();
            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(updater.checks).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not start its timers when it is disabled', async () => {
        vi.useFakeTimers();
        try {
            flow({enabled: false}).start();
            await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(updater.checks).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('can be stopped before it was started', () => {
        expect(() => flow().stop()).not.toThrow();
    });
});

describe('updaterDisabledReason', () => {
    it('names an unpackaged build', () => {
        expect(updaterDisabledReason({packaged: false, disabledBySetting: false})).toContain('not packaged');
    });

    it('names the setting', () => {
        expect(updaterDisabledReason({packaged: true, disabledBySetting: true})).toContain('host.json');
    });

    it('says nothing when the updater is on', () => {
        expect(updaterDisabledReason({packaged: true, disabledBySetting: false})).toBeUndefined();
    });
});
