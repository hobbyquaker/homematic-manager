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
import {readHostSettings} from './hostSettings.js';
import {DeviceImageService, imageLog, type ImageConnection} from './images.js';
import {IpcBridge} from './ipcBridge.js';
import {buildMenuTemplate, isAllowedExternalUrl, ISSUES_URL} from './menu.js';
import {fileRoots, resolvePaths} from './paths.js';
import {createImageProtocolHandler, PRIVILEGED_SCHEMES} from './protocol.js';
import {UpdateFlow, updaterDisabledReason, type AutoUpdaterLike} from './updater.js';
import {browserWindowBounds, WindowStateKeeper} from './windowState.js';

const APP_ID = 'de.hobbyquaker.homematic-manager';
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 620;
/** How long `backend.stop()` may take before the app quits anyway. */
const STOP_TIMEOUT_MS = 8000;

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `electron-updater` is CommonJS and exports `autoUpdater` as a lazy getter, which Node's ESM
 * loader cannot see - `import {autoUpdater} from 'electron-updater'` throws "Named export not
 * found" the moment the packaged app starts, and only there, because the main bundle is ESM.
 * `createRequire` is the one import form that gets the real object.
 */
const {autoUpdater} = createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater');

// Has to happen before the app is ready, and therefore before anything else in this file.
protocol.registerSchemesAsPrivileged([...PRIVILEGED_SCHEMES]);

if (!app.requestSingleInstanceLock()) {
    // A second copy would open a second callback server and fight the first one for the CCU's
    // `init` registration. The first instance gets the focus instead.
    app.quit();
}

app.setAppUserModelId(APP_ID);

const paths = resolvePaths({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    userData: app.getPath('userData'),
});
const errorLog = new ErrorLog({dir: paths.logs});
const errors = installErrorHandlers({
    log: errorLog,
    showDialog: (message, logFile) => {
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
let stopping = false;
let stopped = false;

const version = app.getVersion();

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
        window.show();
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
    backend = await Backend.open({
        dataDir: paths.userData,
        version,
        fileRoots: fileRoots(paths),
    });
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

    app.setAboutPanelOptions({
        applicationName: 'Homematic Manager',
        applicationVersion: version,
        version: `Electron ${process.versions.electron}`,
        copyright: 'AGPL-3.0-or-later - Sebastian Raff and contributors',
    });
    buildMenu();
    registerHostCommands();

    nativeTheme.on('updated', () => {
        broadcast('theme.system', {dark: nativeTheme.shouldUseDarkColors});
    });

    mainWindow = createWindow();
    bridge.attach(mainWindow.webContents);
    mainWindow.on('closed', () => {
        mainWindow = undefined;
    });
    await loadRenderer(mainWindow);
    await trackConfig();

    // Connecting happens after the window exists, so its notices land in the UI rather than in a
    // buffer nobody reads.
    await backend.start();
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
    // Same as 2.x on every platform: this is a tool, not a document editor, and a menu bar with no
    // window behind it is not what anyone came for.
    app.quit();
});

app.on('before-quit', () => {
    // The renderer greys itself out immediately rather than waiting for answers that will not come.
    transport?.setConnected(false);
    updates?.stop();
});

app.on('will-quit', (event) => {
    if (stopped) {
        return;
    }
    event.preventDefault();
    if (stopping) {
        return;
    }
    stopping = true;
    void (async () => {
        try {
            await Promise.race([
                backend?.stop() ?? Promise.resolve(),
                new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
            ]);
        } catch (error) {
            errorLog.append('stop', error);
        }
        bridge?.dispose();
        windowState?.save();
        stopped = true;
        if (updates?.installIfArmed() === true) {
            // `quitAndInstall()` quits the app itself; anything after it would race the installer.
            return;
        }
        app.quit();
    })();
});

app.whenReady()
    .then(start)
    .catch((error: unknown) => {
        errors.report('startup', error);
        app.quit();
    });
