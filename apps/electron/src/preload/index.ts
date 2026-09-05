/**
 * The preload: context isolation on, sandbox on, no Node in the renderer.
 *
 * Exactly two globals reach the page, and nothing else - no `ipcRenderer`, no `require`, no
 * `process`, no path of ours:
 *
 * - `window.__HMM_TRANSPORT__`, the `Transport` of the contract. `createTransport()` in
 *   `@homematic-manager/ui` looks for this name first and uses it when it is there, which is what
 *   makes the same UI run over IPC here and over a WebSocket in `apps/web`.
 * - `window.__HMM_HOST__`, the small host bridge for the three things the contract does not cover:
 *   the device-image URL (D-10), the theme source (D-22) and the updater (D-16).
 *
 * The renderer is loaded from a `file:` URL with a CSP that allows no remote code, so even a
 * cross-site scripting bug in the UI would find only these two objects.
 */

import {contextBridge, ipcRenderer} from 'electron';

import {HOST_GLOBAL, TRANSPORT_GLOBAL} from '../shared/ipc.js';

import {createHostBridge, IpcTransport} from './bridge.js';

const transport = new IpcTransport({ipcRenderer});

contextBridge.exposeInMainWorld(TRANSPORT_GLOBAL, {
    request: (method: string, ...params: unknown[]) =>
        (transport.request as unknown as (m: string, ...p: unknown[]) => Promise<unknown>)(method, ...params),
    on: (event: string, handler: (payload: unknown) => void) =>
        (transport.on as unknown as (e: string, h: (payload: unknown) => void) => () => void)(event, handler),
    onConnectionChange: (handler: (connected: boolean) => void) => transport.onConnectionChange(handler),
    // A getter, not a value: `contextBridge` proxies property reads, so the renderer sees the
    // current state rather than the one that happened to hold when the preload ran.
    get connected() {
        return transport.connected;
    },
});

contextBridge.exposeInMainWorld(HOST_GLOBAL, createHostBridge(ipcRenderer));
