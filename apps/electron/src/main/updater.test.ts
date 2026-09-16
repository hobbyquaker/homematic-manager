import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {UpdateState} from '../shared/ipc.js';

import {
    manualCheckReport,
    releaseAssetUrl,
    releasePageUrl,
    UpdateFlow,
    updateInstall,
    updaterDisabledReason,
    type AutoUpdaterLike,
    type InstallEnvironment,
    type UpdateLinkOptions,
} from './updater.js';

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
    /** electron-updater emits `error` before its promise rejects; set to do the same. */
    emitsErrors = false;

    readonly #handlers = new Map<string, Array<(...args: never[]) => void>>();

    checkForUpdates(): Promise<{updateInfo: {version: string}} | null> {
        this.checks += 1;
        if (this.failCheck) {
            if (this.emitsErrors) {
                this.emit('error', this.failCheck);
            }
            return Promise.reject(this.failCheck);
        }
        return Promise.resolve(this.available === null ? null : {updateInfo: {version: this.available}});
    }

    async downloadUpdate(): Promise<unknown> {
        this.downloads += 1;
        if (this.failDownload) {
            if (this.emitsErrors) {
                this.emit('error', this.failDownload);
            }
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
        expect(flow().state).toEqual({phase: 'idle', install: 'app', dismissed: false});
    });

    it('reports itself disabled with a reason, and then does nothing at all', async () => {
        const disabled = flow({enabled: false, disabledReason: 'this build is not packaged'});
        expect(disabled.state).toEqual({
            phase: 'disabled',
            install: 'app',
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
        await expect(f.check()).resolves.toEqual({phase: 'idle', install: 'app', dismissed: false});
        expect(states.map((s) => s.phase)).toEqual(['checking', 'idle']);
    });

    it('stays idle when there is no release at all', async () => {
        const f = flow();
        await expect(f.check()).resolves.toMatchObject({phase: 'idle'});
    });

    it('announces a newer version without downloading it', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await expect(f.check()).resolves.toEqual({
            phase: 'available',
            install: 'app',
            version: '3.1.0',
            dismissed: false,
        });
        expect(updater.downloads).toBe(0);
    });

    it('downloads on request, reports the progress and ends downloaded', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        states.length = 0;
        await expect(f.download()).resolves.toEqual({
            phase: 'downloaded',
            install: 'app',
            version: '3.1.0',
            dismissed: false,
        });
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

    it('announces a dismissed version again when the user checks from the menu (#160)', async () => {
        updater.available = '3.1.0';
        const f = flow();
        await f.check();
        f.dismiss();
        await expect(f.check({manual: true})).resolves.toEqual({
            phase: 'available',
            install: 'app',
            version: '3.1.0',
            dismissed: false,
        });
        // and the six-hourly check after it keeps the dismissal rules as they were
        f.dismiss();
        await expect(f.check()).resolves.toMatchObject({dismissed: true});
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
        await expect(f.check()).resolves.toMatchObject({
            phase: 'error',
            message: '404 from GitHub',
            failed: 'check',
        });
        expect(errors[0]?.[0]).toBe('check');
    });

    it('turns a failed download into an error state', async () => {
        updater.available = '3.1.0';
        updater.failDownload = new Error('checksum mismatch');
        const f = flow();
        await f.check();
        await expect(f.download()).resolves.toMatchObject({
            phase: 'error',
            version: '3.1.0',
            message: 'checksum mismatch',
            failed: 'download',
        });
    });

    /**
     * B-47 (#163): the download 404'd and the strip vanished. The strip now says which step
     * failed, and electron-updater's own `error` event, which comes first, must say the same.
     */
    it('names the failed step also for the error electron-updater emits before it rejects', async () => {
        updater.emitsErrors = true;
        updater.failCheck = new Error('net::ERR_INTERNET_DISCONNECTED');
        const f = flow();
        await f.check();
        expect(states.filter((s) => s.phase === 'error').map((s) => s.failed)).toEqual(['check', 'check']);

        updater.failCheck = undefined;
        updater.available = '3.1.0';
        updater.failDownload = new Error('Cannot download "https://github.com/x", status 404');
        await f.check();
        states = [];
        await f.download();
        expect(states.filter((s) => s.phase === 'error').map((s) => s.failed)).toEqual(['download', 'download']);
    });

    it('keeps the failed step when the error is dismissed', async () => {
        updater.available = '3.1.0';
        updater.failDownload = new Error('status 404');
        const f = flow();
        await f.check();
        await f.download();
        expect(f.dismiss()).toEqual({
            phase: 'error',
            install: 'app',
            version: '3.1.0',
            message: 'status 404',
            failed: 'download',
            dismissed: true,
        });
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
        expect(f.state.failed).toBeUndefined();
    });

    it('reports an error the updater emits on its own', () => {
        const f = flow();
        updater.emit('error', new Error('ENOTFOUND github.com'));
        expect(f.state).toMatchObject({phase: 'error', message: 'ENOTFOUND github.com'});
        // outside a check or a download there is no step to name
        expect(f.state.failed).toBeUndefined();
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

const RELEASE = 'https://github.com/hobbyquaker/homematic-manager/releases';

/** The installer URL {@link updateInstall} picks for an environment, or `app`. */
const pick = (env: InstallEnvironment, version = '3.0.0-beta.19'): string => {
    const choice = updateInstall(env);
    return choice.install === 'app' ? 'app' : releaseAssetUrl(version, choice.asset(version));
};

describe('updateInstall (task 53, #163)', () => {
    it('links the universal dmg on macOS, whatever the arch', () => {
        for (const arch of ['arm64', 'x64']) {
            expect(pick({platform: 'darwin', arch})).toBe(
                `${RELEASE}/download/v3.0.0-beta.19/Homematic-Manager-3.0.0-beta.19-universal.dmg`,
            );
        }
    });

    it('links the one Setup exe for an installed Windows app, on both archs', () => {
        for (const arch of ['x64', 'arm64']) {
            expect(pick({platform: 'win32', arch})).toBe(
                `${RELEASE}/download/v3.0.0-beta.19/Homematic-Manager-Setup-3.0.0-beta.19.exe`,
            );
            // an empty variable is no portable exe
            expect(pick({platform: 'win32', arch, portableExecutable: ''})).toContain('Setup');
        }
    });

    it("links the portable exe of the running arch when the portable exe's variable is set", () => {
        const portable = 'C:\\Users\\x\\Downloads\\Homematic-Manager-3.0.0-beta.18-portable-x64.exe';
        expect(pick({platform: 'win32', arch: 'x64', portableExecutable: portable})).toBe(
            `${RELEASE}/download/v3.0.0-beta.19/Homematic-Manager-3.0.0-beta.19-portable-x64.exe`,
        );
        expect(pick({platform: 'win32', arch: 'arm64', portableExecutable: portable})).toBe(
            `${RELEASE}/download/v3.0.0-beta.19/Homematic-Manager-3.0.0-beta.19-portable-arm64.exe`,
        );
        // an arch there is no exe of its own for gets the combined one
        expect(pick({platform: 'win32', arch: 'ia32', portableExecutable: portable})).toBe(
            `${RELEASE}/download/v3.0.0-beta.19/Homematic-Manager-3.0.0-beta.19-portable.exe`,
        );
    });

    it('links the deb of the running arch for a deb install', () => {
        expect(pick({platform: 'linux', arch: 'x64', packageType: 'deb'})).toBe(
            `${RELEASE}/download/v3.0.0-beta.19/homematic-manager_3.0.0-beta.19_amd64.deb`,
        );
        expect(pick({platform: 'linux', arch: 'arm64', packageType: 'deb'})).toBe(
            `${RELEASE}/download/v3.0.0-beta.19/homematic-manager_3.0.0-beta.19_arm64.deb`,
        );
    });

    it('lets the AppImage (no package-type file) install its update itself', () => {
        expect(pick({platform: 'linux', arch: 'x64'})).toBe('app');
        expect(pick({platform: 'linux', arch: 'arm64', packageType: undefined})).toBe('app');
    });

    it('builds the release page URL and escapes what does not belong in a path', () => {
        expect(releasePageUrl('3.0.0-beta.19')).toBe(`${RELEASE}/tag/v3.0.0-beta.19`);
        expect(releaseAssetUrl('1.0.0+x/y', 'a b.exe')).toBe(`${RELEASE}/download/v1.0.0%2Bx%2Fy/a%20b.exe`);
    });
});

describe('UpdateFlow in link mode (task 53)', () => {
    let opened: string[];
    let probed: string[];

    const linkFlow = (link: Partial<UpdateLinkOptions> = {}): UpdateFlow =>
        flow({
            link: {
                asset: (version) => `Homematic-Manager-${version}-universal.dmg`,
                open: (url) => {
                    opened.push(url);
                },
                ...link,
            },
        });

    beforeEach(() => {
        opened = [];
        probed = [];
    });

    it('checks like the app mode and says it links', async () => {
        updater.available = '3.1.0';
        const f = linkFlow();
        expect(f.linkMode).toBe(true);
        expect(f.state).toEqual({phase: 'idle', install: 'link', dismissed: false});
        await expect(f.check()).resolves.toEqual({
            phase: 'available',
            install: 'link',
            version: '3.1.0',
            dismissed: false,
        });
        expect(updater.autoDownload).toBe(false);
        expect(updater.autoInstallOnAppQuit).toBe(false);
    });

    it('opens the installer instead of downloading, and never arms an install', async () => {
        updater.available = '3.1.0';
        const f = linkFlow({
            exists: (url) => {
                probed.push(url);
                return Promise.resolve(true);
            },
        });
        await f.check();
        states.length = 0;
        await expect(f.download()).resolves.toMatchObject({phase: 'available', version: '3.1.0'});
        expect(updater.downloads).toBe(0);
        expect(probed).toEqual([`${RELEASE}/download/v3.1.0/Homematic-Manager-3.1.0-universal.dmg`]);
        expect(opened).toEqual(probed);
        // no "downloading", no "downloaded": the strip stays as it was
        expect(states).toEqual([]);

        expect(f.installOnQuit()).toMatchObject({phase: 'available'});
        expect(f.willInstallOnQuit).toBe(false);
        expect(f.installIfArmed()).toBe(false);
        expect(updater.installed).toEqual([]);

        // a second click opens it again
        await f.download();
        expect(opened).toHaveLength(2);
        expect(updater.downloads).toBe(0);
    });

    it('opens nothing before a version was announced', async () => {
        const f = linkFlow();
        await f.download();
        expect(opened).toEqual([]);
        expect(updater.downloads).toBe(0);
    });

    it('opens the release page when the installer is not there', async () => {
        updater.available = '3.1.0';
        const f = linkFlow({exists: () => Promise.resolve(false)});
        await f.check();
        await f.download();
        expect(opened).toEqual([`${RELEASE}/tag/v3.1.0`]);
    });

    it('opens the release page when the probe fails, and logs why', async () => {
        updater.available = '3.1.0';
        const f = linkFlow({exists: () => Promise.reject(new Error('offline'))});
        await f.check();
        await expect(f.download()).resolves.toMatchObject({phase: 'available'});
        expect(opened).toEqual([`${RELEASE}/tag/v3.1.0`]);
        expect(errors.map(([scope]) => scope)).toEqual(['link']);
    });

    it('turns a browser that cannot be opened into a failed download', async () => {
        updater.available = '3.1.0';
        const f = linkFlow({open: () => Promise.reject(new Error('no browser'))});
        await f.check();
        await expect(f.download()).resolves.toMatchObject({
            phase: 'error',
            install: 'link',
            failed: 'download',
            message: 'no browser',
        });
        expect(updater.downloads).toBe(0);
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

describe('manualCheckReport (#160)', () => {
    const PHASES: UpdateState['phase'][] = [
        'disabled',
        'idle',
        'checking',
        'available',
        'downloading',
        'downloaded',
        'installOnQuit',
        'error',
    ];

    it('says the app is up to date when the check found nothing - which used to show nothing at all', async () => {
        updater.available = '3.0.0';
        const result = await flow().check({manual: true});
        expect(manualCheckReport(result, '3.0.0')).toEqual({
            type: 'info',
            message: 'Homematic Manager is up to date.',
            detail: '3.0.0 is the newest version.',
        });
        // no release at all is the same answer
        updater.available = null;
        expect(manualCheckReport(await flow().check({manual: true}), '3.0.0').message).toContain('up to date');
    });

    it('names a newer version and where it is offered, without promising a download', async () => {
        updater.available = '3.1.0';
        const report = manualCheckReport(await flow().check({manual: true}), '3.0.0');
        expect(report.type).toBe('info');
        expect(report.message).toBe('Version 3.1.0 is available.');
        expect(report.detail).toContain('You have 3.0.0');
        expect(report.detail).toContain('without your confirmation');
        expect(report.download).toBeUndefined();
    });

    it('offers the download in the box in link mode, and says it opens the browser (task 53)', async () => {
        updater.available = '3.1.0';
        const linked = flow({link: {asset: (v) => v, open: () => undefined}});
        const report = manualCheckReport(await linked.check({manual: true}), '3.0.0');
        expect(report.message).toBe('Version 3.1.0 is available.');
        expect(report.download).toBe(true);
        expect(report.detail).toContain('in your browser');
        expect(report.detail).not.toContain('confirmation');
    });

    it('says a failed check failed, with its reason', async () => {
        updater.failCheck = new Error('net::ERR_INTERNET_DISCONNECTED');
        const report = manualCheckReport(await flow().check({manual: true}), '3.0.0');
        expect(report.type).toBe('error');
        expect(report.message).toBe('The update check failed.');
        expect(report.detail).toContain('net::ERR_INTERNET_DISCONNECTED');
    });

    it('answers every phase with a message, so no click on the menu ends silently', () => {
        for (const phase of PHASES) {
            const report = manualCheckReport({phase, dismissed: false, version: '3.1.0'}, '3.0.0');
            expect(report.message, phase).not.toBe('');
            expect(['info', 'error'], phase).toContain(report.type);
        }
    });
});
