/**
 * Automatic updates (D-16): check, notify, ask, and only then install - or, on macOS and Windows,
 * check, notify and hand the user the installer (task 53, #163).
 *
 * The rules the decision spells out, and what they mean here:
 *
 * - **Never silent.** `autoDownload` and `autoInstallOnAppQuit` are switched off. The app checks,
 *   tells the user that a version is there, and downloads only when the user says so; the download
 *   is armed for the next quit only after a second, explicit confirmation.
 * - **Not in development, not unpackaged.** `electron-updater` has no `app-update.yml` outside a
 *   packaged build and would throw on every check; the flow reports `disabled` and does nothing.
 * - **Switchable off.** Whoever repackages the app sets `disableAutoUpdate` in `host.json` or the
 *   environment variable, and no check ever runs.
 *
 * - **Where the app cannot install itself, it links.** On macOS and Windows (installed or
 *   portable) and for a deb install the flow runs in *link* mode ({@link updateInstall}): the check
 *   is the same, but "Download" opens the matching installer of the new release in the browser,
 *   and electron-updater never downloads or installs anything. See {@link updateInstall} for why.
 *
 * The flow is a state machine over an injected updater, so the test drives every path - including
 * the ones that only happen when a GitHub release is broken - without a network and without
 * Electron.
 */

import type {UpdateFailedStep, UpdateInstallMode, UpdateState} from '../shared/ipc.js';
import {RELEASES_URL} from './menu.js';

/** The part of `electron-updater`'s `autoUpdater` this flow uses. */
export interface AutoUpdaterLike {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    checkForUpdates(): Promise<{updateInfo: {version: string}} | null>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
    on(event: string, handler: (...args: never[]) => void): unknown;
}

export interface UpdateFlowOptions {
    readonly updater: AutoUpdaterLike;
    /** False in development, when the app is not packaged, or when the user switched it off. */
    readonly enabled: boolean;
    /** Why it is off, for the About dialog. */
    readonly disabledReason?: string | undefined;
    /** The running version, so a "newer" answer that is not newer is ignored. */
    readonly currentVersion: string;
    readonly onState: (state: UpdateState) => void;
    readonly onError?: (scope: string, error: unknown) => void;
    /** First check after the app settled; D-16 says 10 s. */
    readonly firstCheckDelayMs?: number;
    /** And then every six hours. */
    readonly checkIntervalMs?: number;
    /**
     * Link mode (task 53): "Download" opens this platform's installer instead of downloading it.
     * Without it the app installs the update itself (D-16's original flow).
     */
    readonly link?: UpdateLinkOptions | undefined;
}

/** What link mode needs: which file, how to open it, and whether it is there. */
export interface UpdateLinkOptions {
    /** The installer's file name for a version, from {@link updateInstall}. */
    readonly asset: (version: string) => string;
    /** Opens a URL in the user's browser (`shell.openExternal`). */
    readonly open: (url: string) => Promise<void> | void;
    /**
     * Whether the URL answers 200. When it does not, or cannot tell, the release page is opened
     * instead, so a renamed or missing asset still leads somewhere. Without it the asset is opened
     * unchecked.
     */
    readonly exists?: ((url: string) => Promise<boolean>) | undefined;
}

/** A release asset's download URL. */
export function releaseAssetUrl(version: string, name: string): string {
    return `${RELEASES_URL}/download/v${encodeURIComponent(version)}/${encodeURIComponent(name)}`;
}

/** A release's own page: the fallback when the asset cannot be confirmed. */
export function releasePageUrl(version: string): string {
    return `${RELEASES_URL}/tag/v${encodeURIComponent(version)}`;
}

/** What the running installation is, as far as updates care. */
export interface InstallEnvironment {
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    /** `process.env.PORTABLE_EXECUTABLE_FILE`: set by electron-builder's portable exe. */
    readonly portableExecutable?: string | undefined;
    /** `<resources>/package-type`, trimmed: `deb` for a deb install (electron-builder writes it). */
    readonly packageType?: string | undefined;
}

/** How an update gets onto this machine, and for link mode the installer's name. */
export type UpdateInstall =
    {readonly install: 'app'} | {readonly install: 'link'; readonly asset: (version: string) => string};

/**
 * In-app update or download link (task 53, the maintainer's instruction on #163, 2026-09-16).
 *
 * - **macOS: link.** The build is unsigned, and Squirrel.Mac, which electron-updater uses there,
 *   installs only into a signed app whose designated requirement the update satisfies.
 * - **Windows: link.** The portable exe has no in-app update at all; an unsigned NSIS update would
 *   install, but the Windows signing is blocked (#68) and cannot be tested here.
 * - **Linux deb: link.** electron-updater's deb path runs `dpkg -i` through a graphical sudo, which
 *   most desktops only half provide and which could not be tested.
 * - **Linux AppImage: the app installs the update itself** - the one path verified end to end
 *   (task 53: an AppImage replaced itself with a newer one from a local update server).
 *
 * The names are the ones electron-builder.yml gives the files (B-47), pinned by
 * `scripts/update-names.test.mjs`.
 */
export function updateInstall(env: InstallEnvironment): UpdateInstall {
    const arch = env.arch;
    switch (env.platform) {
        case 'darwin':
            return {install: 'link', asset: (version) => `Homematic-Manager-${version}-universal.dmg`};
        case 'win32': {
            const portable = env.portableExecutable !== undefined && env.portableExecutable !== '';
            if (!portable) {
                return {install: 'link', asset: (version) => `Homematic-Manager-Setup-${version}.exe`};
            }
            // One exe per arch, and a combined one for anything else Windows might report.
            const suffix = arch === 'x64' || arch === 'arm64' ? `-${arch}` : '';
            return {install: 'link', asset: (version) => `Homematic-Manager-${version}-portable${suffix}.exe`};
        }
        default:
            if (env.packageType === 'deb') {
                const debArch = arch === 'x64' ? 'amd64' : arch;
                return {install: 'link', asset: (version) => `homematic-manager_${version}_${debArch}.deb`};
            }
            return {install: 'app'};
    }
}

const HOURS = 60 * 60 * 1000;

const state = (
    install: UpdateInstallMode,
    phase: UpdateState['phase'],
    fields: {
        version?: string | undefined;
        percent?: number | undefined;
        message?: string | undefined;
        failed?: UpdateFailedStep | undefined;
    } = {},
    dismissed = false,
): UpdateState => ({
    phase,
    install,
    dismissed,
    ...(fields.version === undefined ? {} : {version: fields.version}),
    ...(fields.percent === undefined ? {} : {percent: fields.percent}),
    ...(fields.message === undefined ? {} : {message: fields.message}),
    ...(fields.failed === undefined ? {} : {failed: fields.failed}),
});

/**
 * Where the update stands, and the only thing that may call `quitAndInstall()`.
 *
 * `installOnQuit()` is the confirmation: from then on the downloaded update is installed when the
 * user quits, and never before. Nothing here quits the app on its own.
 */
export class UpdateFlow {
    readonly #options: UpdateFlowOptions;
    #state: UpdateState;
    #armed = false;
    #firstTimer: ReturnType<typeof setTimeout> | undefined;
    #interval: ReturnType<typeof setInterval> | undefined;
    #busy = false;

    constructor(options: UpdateFlowOptions) {
        this.#options = options;
        this.#state = options.enabled
            ? this.#make('idle')
            : this.#make('disabled', {message: options.disabledReason ?? 'automatic updates are switched off'});

        if (!options.enabled) {
            return;
        }
        const updater = options.updater;
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
        updater.on('download-progress', ((progress: {percent?: number}) => {
            this.#emit(
                this.#make('downloading', {version: this.#state.version, percent: Math.round(progress.percent ?? 0)}),
            );
        }) as (...args: never[]) => void);
        updater.on('update-downloaded', ((info: {version?: string}) => {
            this.#emit(this.#make('downloaded', {version: info.version ?? this.#state.version}));
        }) as (...args: never[]) => void);
        updater.on('error', ((error: Error) => {
            this.#fail('updater', error);
        }) as (...args: never[]) => void);
    }

    get state(): UpdateState {
        return {...this.#state};
    }

    /** True once the user confirmed; `will-quit` in `index.ts` asks this and nothing else. */
    get willInstallOnQuit(): boolean {
        return this.#armed;
    }

    /** Starts the 10 s check and the six-hourly one. Does nothing when the flow is disabled. */
    start(): void {
        if (!this.#options.enabled || this.#firstTimer !== undefined) {
            return;
        }
        this.#firstTimer = setTimeout(() => {
            void this.check();
            this.#interval = setInterval(
                () => {
                    void this.check();
                },
                this.#options.checkIntervalMs ?? 6 * HOURS,
            );
        }, this.#options.firstCheckDelayMs ?? 10_000);
    }

    /** Stops the timers; called on quit so a pending check cannot hold the process. */
    stop(): void {
        if (this.#firstTimer !== undefined) {
            clearTimeout(this.#firstTimer);
            this.#firstTimer = undefined;
        }
        if (this.#interval !== undefined) {
            clearInterval(this.#interval);
            this.#interval = undefined;
        }
    }

    /**
     * Asks GitHub. Answers with the new state; never throws.
     *
     * `manual` is the menu's "Check for Updates...": the user asked, so a version they dismissed
     * earlier is announced again rather than kept out of sight (#160).
     */
    async check(options: {readonly manual?: boolean} = {}): Promise<UpdateState> {
        if (!this.#options.enabled || this.#busy) {
            return this.state;
        }
        if (this.#state.phase === 'downloaded' || this.#state.phase === 'installOnQuit') {
            // An update is already sitting there waiting for the quit; a check would only undo it.
            return this.state;
        }
        this.#busy = true;
        const known = this.#state.version;
        const dismissed = this.#state.dismissed;
        this.#emit(this.#make('checking', {version: known}, dismissed));
        try {
            const result = await this.#options.updater.checkForUpdates();
            const version = result?.updateInfo.version;
            if (version === undefined || version === this.#options.currentVersion) {
                this.#emit(this.#make('idle'));
            } else {
                // A dismissal is for one version; a newer one is announced again, and so is the same
                // one when the user asks from the menu.
                this.#emit(
                    this.#make('available', {version}, options.manual !== true && dismissed && version === known),
                );
            }
        } catch (error) {
            this.#fail('check', error);
        } finally {
            this.#busy = false;
        }
        return this.state;
    }

    /** Downloads the available update, on the user's request. */
    async download(): Promise<UpdateState> {
        if (!this.#options.enabled || this.#state.phase !== 'available') {
            return this.state;
        }
        const version = this.#state.version;
        if (this.#options.link !== undefined) {
            await this.#openDownload(this.#options.link, version ?? '');
            return this.state;
        }
        this.#emit(this.#make('downloading', {version, percent: 0}));
        try {
            await this.#options.updater.downloadUpdate();
            // `this.state`, not `this.#state`: the phase moved on inside `#emit`, which the
            // narrowing of the guard above does not know about.
            if (this.state.phase === 'downloading') {
                // `update-downloaded` normally moved us on already; make sure either way.
                this.#emit(this.#make('downloaded', {version}));
            }
        } catch (error) {
            this.#fail('download', error);
        }
        return this.state;
    }

    /**
     * The confirmation of D-16. From here on the update is installed when the app quits - and the
     * user quits it, not this method.
     */
    installOnQuit(): UpdateState {
        if (this.linkMode) {
            // Nothing was downloaded, so there is nothing to arm.
            return this.state;
        }
        if (this.#state.phase !== 'downloaded' && this.#state.phase !== 'installOnQuit') {
            return this.state;
        }
        this.#armed = true;
        this.#emit(this.#make('installOnQuit', {version: this.#state.version}));
        return this.state;
    }

    /** The user does not want to hear about this version again until the next one. */
    dismiss(): UpdateState {
        this.#armed = false;
        this.#emit(
            this.#make(
                this.#state.phase,
                {version: this.#state.version, message: this.#state.message, failed: this.#state.failed},
                true,
            ),
        );
        return this.state;
    }

    /**
     * Installs, if and only if the user confirmed. `index.ts` calls this from `will-quit`, after
     * the backend has stopped.
     */
    installIfArmed(): boolean {
        if (!this.#armed) {
            return false;
        }
        this.#armed = false;
        try {
            this.#options.updater.quitAndInstall(false, true);
            return true;
        } catch (error) {
            this.#fail('install', error);
            return false;
        }
    }

    /** Link mode (task 53): the app never downloads or installs; "Download" opens the installer. */
    get linkMode(): boolean {
        return this.#options.link !== undefined;
    }

    #make(phase: UpdateState['phase'], fields?: Parameters<typeof state>[2], dismissed?: boolean): UpdateState {
        return state(this.linkMode ? 'link' : 'app', phase, fields, dismissed);
    }

    /**
     * Link mode's "Download": the installer of that version in the browser, or the release page
     * when the installer cannot be confirmed. The strip stays as it is - the user may dismiss it.
     */
    async #openDownload(link: UpdateLinkOptions, version: string): Promise<void> {
        try {
            let url = releaseAssetUrl(version, link.asset(version));
            if (link.exists !== undefined) {
                let found = false;
                try {
                    found = await link.exists(url);
                } catch (error) {
                    this.#options.onError?.('link', error);
                }
                if (!found) {
                    url = releasePageUrl(version);
                }
            }
            await link.open(url);
        } catch (error) {
            this.#fail('download', error);
        }
    }

    #emit(next: UpdateState): void {
        this.#state = next;
        this.#options.onState(this.state);
    }

    #fail(scope: string, error: unknown): void {
        this.#options.onError?.(scope, error);
        this.#emit(
            this.#make(
                'error',
                {
                    version: this.#state.version,
                    message: error instanceof Error ? error.message : String(error),
                    failed: this.#failedStep(scope),
                },
                this.#state.dismissed,
            ),
        );
    }

    /**
     * Which step the strip says failed (B-47). electron-updater emits its own `error` before the
     * promise of the check or the download rejects, so for that one the phase it interrupted
     * tells; the rejection that follows names the step again.
     */
    #failedStep(scope: string): UpdateFailedStep | undefined {
        if (scope === 'check' || scope === 'download') {
            return scope;
        }
        if (scope === 'updater') {
            if (this.#state.phase === 'checking') {
                return 'check';
            }
            if (this.#state.phase === 'downloading') {
                return 'download';
            }
            return this.#state.failed;
        }
        return undefined;
    }
}

/**
 * Why the updater is off, or `undefined` when it is on.
 *
 * Spelled out as a function because the answer belongs in the About dialog: "no updates because
 * this build is not packaged" and "no updates because you switched them off" are different
 * answers, and neither should look like a broken updater.
 */
export function updaterDisabledReason(input: {
    readonly packaged: boolean;
    readonly disabledBySetting: boolean;
}): string | undefined {
    if (!input.packaged) {
        return 'this build is not packaged, so it has no update channel';
    }
    if (input.disabledBySetting) {
        return 'automatic updates are switched off in host.json';
    }
    return undefined;
}

/** The message box the menu's "Check for Updates..." answers with (#160). */
export interface UpdateCheckReport {
    readonly type: 'info' | 'error';
    readonly message: string;
    readonly detail: string;
    /** Link mode, a version available: the box offers "Download", which opens the installer (task 53). */
    readonly download?: boolean;
}

/**
 * What a check the user started from the menu found, in words (#160).
 *
 * The strip under the header only appears when there is something to download or install, so a
 * check that found nothing - or failed - used to end without anything visible at all: "Es gibt kein
 * sichtbares Ergebnis." The menu entry answers every outcome with a message box instead; the strip
 * stays what offers the download.
 */
export function manualCheckReport(result: UpdateState, currentVersion: string): UpdateCheckReport {
    const version = result.version ?? '';
    switch (result.phase) {
        case 'idle':
            return {
                type: 'info',
                message: 'Homematic Manager is up to date.',
                detail: `${currentVersion} is the newest version.`,
            };
        case 'available':
            if (result.install === 'link') {
                return {
                    type: 'info',
                    message: `Version ${version} is available.`,
                    detail: `You have ${currentVersion}. "Download" opens the installer of the new version in your browser; install it from there. The bar at the top of the window offers the same.`,
                    download: true,
                };
            }
            return {
                type: 'info',
                message: `Version ${version} is available.`,
                detail: `You have ${currentVersion}. The bar at the top of the window offers the download; nothing is downloaded or installed without your confirmation.`,
            };
        case 'downloading':
            return {
                type: 'info',
                message: `Version ${version} is being downloaded.`,
                detail: 'The bar at the top of the window shows the progress.',
            };
        case 'downloaded':
            return {
                type: 'info',
                message: `Version ${version} is downloaded.`,
                detail: 'The bar at the top of the window offers to install it.',
            };
        case 'installOnQuit':
            return {
                type: 'info',
                message: `Version ${version} is installed when you quit Homematic Manager.`,
                detail: `You have ${currentVersion}.`,
            };
        case 'checking':
            return {
                type: 'info',
                message: 'An update check is already running.',
                detail: 'If it finds a new version, the bar at the top of the window says so.',
            };
        case 'disabled':
            return {
                type: 'info',
                message: 'Automatic updates are off.',
                detail: result.message ?? '',
            };
        case 'error':
            return {
                type: 'error',
                message: 'The update check failed.',
                detail: `${result.message ?? 'No reason was given.'}\n\nThe releases are also on https://github.com/hobbyquaker/homematic-manager/releases`,
            };
    }
}
