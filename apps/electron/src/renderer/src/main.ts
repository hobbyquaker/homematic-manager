/**
 * The Electron renderer entry.
 *
 * It imports the app shell and the stores from `@homematic-manager/ui` as a library (the `svelte`
 * export condition points at the sources, so this bundle compiles the components itself and never
 * touches `packages/ui/dist`), and mounts them on the transport the preload injected.
 *
 * There is deliberately no Electron and no Node here: the only two things this file knows about
 * its host are `window.__HMM_TRANSPORT__`, which `createTransport()` finds on its own, and
 * `window.__HMM_HOST__` for the theme source. Everything else is the same UI that `apps/web`
 * serves over a WebSocket.
 */

import {App, createStores, createTransport} from '@homematic-manager/ui';
import type {Transport} from '@homematic-manager/core';
import {mount} from 'svelte';

import {HOST_GLOBAL, type HostBridge, type ThemeSource} from '../../shared/ipc.js';

/**
 * The injected transport, with `connected` tracked on this side of the bridge.
 *
 * `contextBridge` hands the renderer a proxy of the preload's object, and how it treats a getter
 * is an implementation detail of Electron that is not worth betting the connection indicator on.
 * The callbacks are the part that is specified, so this wrapper keeps the flag itself and reads
 * the injected value only once, for the initial state.
 */
function withTrackedConnection(injected: Transport): Transport {
    let connected = injected.connected;
    injected.onConnectionChange((next) => {
        connected = next;
    });
    return {
        request: injected.request.bind(injected),
        on: injected.on.bind(injected),
        onConnectionChange: injected.onConnectionChange.bind(injected),
        get connected() {
            return connected;
        },
    };
}

const host = (globalThis as unknown as Record<string, HostBridge | undefined>)[HOST_GLOBAL];
const stores = createStores(withTrackedConnection(createTransport()));

const target = document.querySelector('#app');
if (!target) {
    throw new Error('no #app element to mount into');
}

mount(App, {target, props: {stores}});
void stores.start();

/**
 * D-22: the renderer owns the theme choice (it is persisted in `localStorage` by `AppStore`), and
 * main needs to know it too - `nativeTheme.themeSource` decides the colour of the title bar, the
 * menus and the native dialogs, which are not ours to style. Pushing it on every change keeps the
 * window frame and the page from disagreeing.
 */
if (host) {
    // The native menu cannot reach into the page, so "Settings..." comes back as an event.
    host.onMenuAction((action) => {
        if (action === 'settings') {
            stores.app.configDialogOpen = true;
        }
    });

    // `App.svelte` mirrors the choice onto `<html data-theme>` (absent means `system`), so
    // watching that one attribute is the same information without a rune outside a component and
    // without a poll.
    const root = document.documentElement;
    let last: ThemeSource | undefined;
    const push = (): void => {
        const attribute = root.getAttribute('data-theme');
        const choice: ThemeSource = attribute === 'light' || attribute === 'dark' ? attribute : 'system';
        if (choice !== last) {
            last = choice;
            void host.setTheme(choice);
        }
    };
    new MutationObserver(push).observe(root, {attributes: true, attributeFilter: ['data-theme']});
    push();
}
