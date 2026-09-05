import {BrowserWindow} from 'electron';

/**
 * Skeleton of the application window. Nothing calls this yet: task 11 hosts the backend in the
 * main process, adds the typed IPC transport, window state and the menus, and starts the app.
 */
export function createWindow(): BrowserWindow {
    return new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
}
