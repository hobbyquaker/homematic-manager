/**
 * The main process: one backend, one window, one bridge between them.
 *
 * Everything that can be tested lives in its own module next to this one - the IPC bridge, the
 * window state, the image cache, the update flow, the menu, the error log. What is left here is
 * the wiring and the parts that only exist inside a running Electron: the app lifecycle, the
 * protocol registration and the native dialogs.
 *
 * Two differences to 2.x are worth spelling out:
 *
 * - **A configuration change no longer restarts the app.** 2.x wrote the file, called
 *   `app.relaunch()`, destroyed the window and killed the process, which is why changing the CCU
 *   address took ten seconds and lost the RPC log. The backend reconnects instead, and the UI sees
 *   it happen through `interfaces.changed`.
 * - **Quitting waits for the backend.** `stop()` de-registers the callbacks at the interface
 *   processes; 2.x raced that against a 15 s timer and `process.exit(0)`. Here `will-quit` is
 *   deferred until `backend.stop()` resolves or a bounded timeout passes, and the renderer is told
 *   the backend is gone before any of it starts.
 */

import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Backend, InProcessTransport} from '@homematic-manager/backend';
import {app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell} from 'electron';

import {
    HOST_EVENT_CHANNEL,
    HOST_INVOKE_CHANNEL,
    IMAGE_SCHEME,
    type HostCommandName,
    type HostEventName,
    type HostEvents,
    type HostInfo,
    type ThemeSource,
} from '../shared/ipc.js';

import {ErrorLog, installErrorHandlers} from './errorLog.js';
import {errorDialogsDisabled, readHostSettings} from './hostSettings.js';
import {DeviceImageService, imageLog, type ImageConnection} from './images.js';
import {IpcBridge} from './ipcBridge.js';
import {createQuitSequence, withDeadline} from './lifecycle.js';
import {buildMenuTemplate, externalUrlFromRenderer, isAllowedExternalUrl, ISSUES_URL} from './menu.js';
import {fileRoots, resolvePaths} from './paths.js';
import {createImageProtocolHandler, PRIVILEGED_SCHEMES} from './protocol.js';
import {createStartupTrace} from './startupTrace.js';
import {UpdateFlow, updaterDisabledReason, type AutoUpdaterLike} from './updater.js';
import {browserWindowBounds, WindowStateKeeper} from './windowState.js';

const APP_ID = 'de.hobbyquaker.homematic-manager';
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 620;
/**
 * How long one awaited start-up step may take before it is called out. It is not a cancellation -
 * a half-open `Backend` cannot be walked away from - but a hang that says which step it is in.
 */
const STEP_TIMEOUT_MS = 20_000;

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `HMM_STARTUP_TRACE=1` prints one stderr line per start-up phase. Off by default and a no-op
 * then; the smoke test turns it on and prints what it collected when an assertion fails, so a
 * main process that hangs or dies before the window exists still says where it stopped.
 */
const trace = createStartupTrace();
trace('module: entered');

/**
 * `electron-updater` is CommonJS and exports `autoUpdater` as a lazy getter, which Node's ESM
 * loader cannot see - `import {autoUpdater} from 'electron-updater'` throws "Named export not
 * found" the moment the packaged app starts, and only there, because the main bundle is ESM.
 * `createRequire` is the one import form that gets the real object.
 */
const {autoUpdater} = createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater');
trace('module: electron-updater required');

// Has to happen before the app is ready, and therefore before anything else in this file.
protocol.registerSchemesAsPrivileged([...PRIVILEGED_SCHEMES]);
trace('module: schemes registered');

/**
 * A second copy would open a second callback server and fight the first one for the CCU's `init`
 * registration. The first instance gets the focus instead.
 *
 * The flag is what makes that true. `app.quit()` alone does not stop this file: the module goes on
 * running, `whenReady` still fires, and `start()` would open the second backend the lock exists to
 * prevent - on the profile the first instance already has open - while the quit it raced is still
 * in flight.
 */
const secondInstance = !app.requestSingleInstanceLock();
if (secondInstance) {
    trace('module: single-instance lock refused, quitting');
    app.quit();
} else {
    trace('module: single-instance lock held');
}

app.setAppUserModelId(APP_ID);

const paths = resolvePaths({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
    mainDir: here,
    exists: (candidate) => fs.existsSync(candidate),
});
const errorLog = new ErrorLog({dir: paths.logs});
const errors = installErrorHandlers({
    log: errorLog,
    showDialog: (message, logFile) => {
        // Always to stderr as well: in a terminal, on CI and under the smoke test this is the only
        // place anyone sees it, and it costs nothing.
        try {
            process.stderr.write(`Homematic Manager: ${message}\nSee ${logFile}\n`);
        } catch {
            // A packaged Windows app has no stderr; the log file has the message either way.
        }
        if (errorDialogsDisabled()) {
            return;
        }
        dialog.showErrorBox(
            'Homematic Manager',
            `${message}\n\nFurther errors are only written to\n${logFile}\n\n` +
                'Please attach that file to a bug report.',
        );
    },
});

let backend: Backend | undefined;
let transport: InProcessTransport | undefined;
let bridge: IpcBridge | undefined;
let images: DeviceImageService | undefined;
let updates: UpdateFlow | undefined;
let mainWindow: BrowserWindow | undefined;
let windowState: WindowStateKeeper | undefined;
const version = app.getVersion();
trace('module: paths and error log ready', `userData=${paths.userData} data=${paths.data}`);

function broadcast<E extends HostEventName>(name: E, payload: HostEvents[E]): void {
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.isDestroyed()) {
            window.webContents.send(HOST_EVENT_CHANNEL, name, payload);
        }
    }
}

function hostInfo(): HostInfo {
    return {
        version,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        userData: paths.userData,
        logFile: errorLog.file,
    };
}

function createWindow(): BrowserWindow {
    const defaults = {defaultWidth: 1280, defaultHeight: 960};
    const keeper = new WindowStateKeeper({
        dir: paths.userData,
        ...defaults,
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        displays: () => screen.getAllDisplays().map((display) => display.workArea),
    });
    windowState = keeper;

    const window = new BrowserWindow({
        ...browserWindowBounds(keeper.state, defaults),
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        show: false,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1e23' : '#f6f7f9',
        title: 'Homematic Manager',
        webPreferences: {
            preload: path.join(here, '..', 'preload', 'index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            spellcheck: false,
        },
    });

    if (keeper.state.maximised) {
        window.maximize();
    }

    const remember = (): void => {
        keeper.update(window.getNormalBounds(), window.isMaximized());
    };
    window.on('resize', remember);
    window.on('move', remember);
    window.on('maximize', remember);
    window.on('unmaximize', remember);
    window.on('close', () => {
        remember();
        keeper.save();
    });

    window.once('ready-to-show', () => {
        trace('window: ready-to-show');
        window.show();
        trace('window: shown');
    });

    // Nothing in this app navigates, and nothing opens a second window. A link the UI cannot
    // handle goes to the user's browser, and only when it is one of ours.
    window.webContents.setWindowOpenHandler(({url}) => {
        if (isAllowedExternalUrl(url)) {
            void shell.openExternal(url);
        }
        return {action: 'deny'};
    });
    window.webContents.on('will-navigate', (event, url) => {
        const devServer = process.env['ELECTRON_RENDERER_URL'];
        if (devServer === undefined || !url.startsWith(devServer)) {
            event.preventDefault();
        }
    });
    window.webContents.on('render-process-gone', (_event, details) => {
        errors.report('renderer', new Error(`the renderer process is gone: ${details.reason}`));
    });

    return window;
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    if (devServer !== undefined && devServer !== '') {
        await window.loadURL(devServer);
        window.webContents.openDevTools({mode: 'detach'});
        return;
    }
    await window.loadFile(path.join(here, '..', 'renderer', 'index.html'));
}

function buildMenu(): void {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate(
            // The template is plain data so that it can be tested without Electron; the roles it
            // uses are all real ones, which is what this cast asserts.
            buildMenuTemplate({
                appName: 'Homematic Manager',
                isMac: process.platform === 'darwin',
                updatesEnabled: updates?.state.phase !== 'disabled',
                onAbout: () => {
                    app.showAboutPanel();
                },
                onCheckForUpdates: () => {
                    void updates?.check();
                },
                onOpenIssues: () => {
                    void shell.openExternal(ISSUES_URL);
                },
                onOpenLogFolder: () => {
                    shell.showItemInFolder(errorLog.file);
                },
                onSettings: () => {
                    broadcast('menu.action', {action: 'settings'});
                },
            }) as Electron.MenuItemConstructorOptions[],
        ),
    );
}

function registerHostCommands(): void {
    ipcMain.handle(HOST_INVOKE_CHANNEL, async (_event, command: unknown, params: unknown) => {
        const name = command as HostCommandName;
        const args = Array.isArray(params) ? params : [];
        switch (name) {
            case 'app.info':
                return hostInfo();
            case 'theme.set': {
                const source = args[0];
                if (source === 'system' || source === 'light' || source === 'dark') {
                    nativeTheme.themeSource = source satisfies ThemeSource;
                }
                return null;
            }
            case 'shell.openExternal': {
                // The allow-list is here and not in the renderer: a page that can be made to ask
                // for a URL must not be able to choose which one (task 23).
                const url = externalUrlFromRenderer(args[0]);
                if (url !== undefined) {
                    void shell.openExternal(url);
                }
                return null;
            }
            case 'update.state':
                return updates?.state ?? null;
            case 'update.check':
                return (await updates?.check()) ?? null;
            case 'update.download':
                return (await updates?.download()) ?? null;
            case 'update.installOnQuit':
                return updates?.installOnQuit() ?? null;
            case 'update.dismiss':
                return updates?.dismiss() ?? null;
            default:
                throw new Error(`unknown host command ${String(command)}`);
        }
    });
}

async function start(): Promise<void> {
    trace('start: entered');
    backend = await withDeadline(
        Backend.open({
            dataDir: paths.userData,
            version,
            fileRoots: fileRoots(paths),
        }),
        STEP_TIMEOUT_MS,
        () => {
            trace('start: Backend.open is still running');
            errorLog.append('startup', `Backend.open has not finished after ${String(STEP_TIMEOUT_MS)}ms`);
        },
    );
    trace('start: backend opened');
    transport = new InProcessTransport(backend);
    bridge = new IpcBridge({
        ipcMain,
        transport,
        onProtocolError: (message) => errorLog.append('ipc', message),
    });

    images = new DeviceImageService({
        cacheDir: paths.images,
        fallbackDir: paths.icons,
        icons: readIconMap,
        // The image server is the CCU's own web server, so it follows whatever the backend is
        // connected to - including its TLS setting and its credentials.
        upstream: () => ccuConnection,
        log: imageLog((message) => errorLog.append('images', message)),
    });
    protocol.handle(IMAGE_SCHEME, createImageProtocolHandler(images));
    trace('start: image protocol handled');

    const settings = readHostSettings(paths.hostSettingsFile);
    const disabledReason = updaterDisabledReason({
        packaged: app.isPackaged,
        disabledBySetting: settings.disableAutoUpdate,
    });
    updates = new UpdateFlow({
        updater: autoUpdater as unknown as AutoUpdaterLike,
        enabled: disabledReason === undefined,
        disabledReason,
        currentVersion: version,
        onState: (state) => {
            broadcast('update.state', state);
        },
        onError: (scope, error) => {
            errorLog.append(`update:${scope}`, error);
        },
    });
    updates.start();
    trace('start: update flow started', disabledReason ?? 'enabled');

    app.setAboutPanelOptions({
        applicationName: 'Homematic Manager',
        applicationVersion: version,
        version: `Electron ${process.versions.electron}`,
        copyright: 'AGPL-3.0-or-later - Sebastian Raff and contributors',
    });
    buildMenu();
    registerHostCommands();
    trace('start: menu and host commands ready');

    nativeTheme.on('updated', () => {
        broadcast('theme.system', {dark: nativeTheme.shouldUseDarkColors});
    });

    mainWindow = createWindow();
    trace('start: window created');
    bridge.attach(mainWindow.webContents);
    mainWindow.on('closed', () => {
        mainWindow = undefined;
    });
    await withDeadline(loadRenderer(mainWindow), STEP_TIMEOUT_MS, () => {
        trace('start: the renderer is still loading');
        errorLog.append('startup', `the renderer has not loaded after ${String(STEP_TIMEOUT_MS)}ms`);
    });
    trace('start: renderer loaded');
    await trackConfig();
    trace('start: config tracked');

    // Connecting happens after the window exists, so its notices land in the UI rather than in a
    // buffer nobody reads.
    await backend.start();
    trace('start: backend started');
}

/**
 * Reads `device-icons.json` through the backend's `data.file`, so the image cache uses the one
 * path that is allowed to read from the data directory instead of opening a second one.
 */
async function readIconMap(): Promise<Record<string, string>> {
    const content = await backend?.request('data.file', 'data/device-icons.json');
    return typeof content === 'object' && content !== null ? (content as Record<string, string>) : {};
}

/**
 * The CCU the device images come from, kept in step with the backend's configuration.
 *
 * This is the part a config change touches, and it is why 2.x's relaunch is gone: a new host
 * simply lands here on the next `config.changed`, the image cache asks the new CCU from then on,
 * and nothing restarts.
 */
let ccuConnection: {host: string; tls: boolean; auth?: {user: string; password: string}} | undefined;

async function trackConfig(): Promise<void> {
    const remember = (connection: ImageConnection): void => {
        ccuConnection =
            connection.host === ''
                ? undefined
                : {
                      host: connection.host,
                      tls: connection.tls === true,
                      ...(connection.auth === undefined ? {} : {auth: connection.auth}),
                  };
    };
    backend?.on('config.changed', (config) => {
        remember(config.connection);
    });
    const config = await backend?.request('config.get');
    if (config) {
        remember(config.connection);
    }
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    trace('app: window-all-closed');
    // Same as 2.x on every platform: this is a tool, not a document editor, and a menu bar with no
    // window behind it is not what anyone came for.
    app.quit();
});

app.on('before-quit', () => {
    trace('app: before-quit');
    // The renderer greys itself out immediately rather than waiting for answers that will not come.
    transport?.setConnected(false);
    updates?.stop();
});

/**
 * The quit, with its two bounds in `lifecycle.ts` rather than here: `backend.stop()` may take
 * eight seconds, the whole shutdown fifteen, and after that the process ends with `app.exit()`.
 *
 * The bound that was missing is the second one. Playwright's `electronApplication.close()` asks
 * the app to quit and then waits for the process to exit with no timeout of its own, so an app
 * that defers its quit and never comes back costs the full test timeout and the worker teardown
 * after it - which is what every smoke test of the first `build.yml` run paid, twice.
 */
const quitSequence = createQuitSequence({
    stop: async () => {
        await (backend?.stop() ?? Promise.resolve());
    },
    finish: () => {
        bridge?.dispose();
        windowState?.save();
    },
    installIfArmed: () => updates?.installIfArmed() === true,
    quit: () => {
        app.quit();
    },
    exit: (code) => {
        app.exit(code);
    },
    onError: (scope, error) => {
        errorLog.append(scope, error);
    },
    trace,
});

app.on('will-quit', (event) => {
    if (quitSequence.willQuit()) {
        event.preventDefault();
    }
});

trace('module: awaiting whenReady');
app.whenReady()
    .then(() => {
        trace('app: ready');
        if (secondInstance) {
            // The lock belongs to the copy that was already running; this one has opened nothing.
            trace('app: second instance, exiting');
            app.exit(0);
            return;
        }
        return start();
    })
    .then(() => {
        trace('app: start resolved');
    })
    .catch((error: unknown) => {
        trace('app: start failed', String(error));
        errors.report('startup', error);
        app.quit();
    });
