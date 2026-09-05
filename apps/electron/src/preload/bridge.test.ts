import type {ApiError, ApiFrame} from '@homematic-manager/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {API_CHANNEL, API_CONNECTED_CHANNEL, HOST_EVENT_CHANNEL, HOST_INVOKE_CHANNEL} from '../shared/ipc.js';

import {createHostBridge, IpcTransport, type IpcRendererLike} from './bridge.js';

/** An `ipcRenderer` the test drives from both ends. */
class FakeIpc implements IpcRendererLike {
    readonly sent: Array<[string, unknown]> = [];
    readonly invoked: Array<[string, unknown[]]> = [];
    invokeResult: unknown = null;
    throwOnSend = false;

    readonly #listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>();

    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): this {
        const list = this.#listeners.get(channel) ?? [];
        list.push(listener);
        this.#listeners.set(channel, list);
        return this;
    }

    send(channel: string, ...args: unknown[]): void {
        if (this.throwOnSend) {
            throw new Error('ipc is gone');
        }
        this.sent.push([channel, args[0]]);
    }

    invoke(channel: string, ...args: unknown[]): Promise<unknown> {
        this.invoked.push([args[0] as string, args[1] as unknown[]]);
        expect(channel).toBe(HOST_INVOKE_CHANNEL);
        return Promise.resolve(this.invokeResult);
    }

    /** main -> renderer. */
    emit(channel: string, ...args: unknown[]): void {
        for (const listener of this.#listeners.get(channel) ?? []) {
            listener({}, ...args);
        }
    }

    /** The request frames the transport sent. */
    frames(): ApiFrame[] {
        return this.sent
            .filter(([channel]) => channel === API_CHANNEL)
            .map(([, payload]) => JSON.parse(payload as string) as ApiFrame);
    }

    answer(frame: ApiFrame): void {
        this.emit(API_CHANNEL, JSON.stringify(frame));
    }
}

describe('IpcTransport', () => {
    let ipc: FakeIpc;
    let transport: IpcTransport;

    beforeEach(() => {
        ipc = new FakeIpc();
        transport = new IpcTransport({ipcRenderer: ipc, requestTimeoutMs: 50});
    });

    it('starts connected, because main is the same process', () => {
        expect(transport.connected).toBe(true);
    });

    it('sends a req frame and resolves with the res', async () => {
        const pending = transport.request('devices.list', 'HmIP-RF');
        expect(ipc.frames()).toEqual([{t: 'req', id: 1, m: 'devices.list', p: ['HmIP-RF']}]);
        ipc.answer({t: 'res', id: 1, r: [{ADDRESS: 'ABC'}]});
        await expect(pending).resolves.toEqual([{ADDRESS: 'ABC'}]);
    });

    it('counts the ids up so two requests cannot be confused', async () => {
        const first = transport.request('names.get');
        const second = transport.request('events.clear');
        ipc.answer({t: 'res', id: 2, r: null});
        ipc.answer({t: 'res', id: 1, r: {'ABC:1': 'Lamp'}});
        await expect(second).resolves.toBeNull();
        await expect(first).resolves.toEqual({'ABC:1': 'Lamp'});
    });

    it('rejects with the plain ApiError, so contextBridge cannot drop the fault code', async () => {
        const pending = transport.request('value.get', 'BidCos-RF', 'ABC:1', 'NOPE');
        ipc.answer({t: 'err', id: 1, e: {message: 'Unknown parameter', kind: 'rpc', faultCode: -5}});
        await expect(pending).rejects.toEqual({message: 'Unknown parameter', kind: 'rpc', faultCode: -5});
    });

    it('rejects with an internal error for a malformed err frame', async () => {
        const pending = transport.request('names.get');
        ipc.answer({t: 'err', id: 1, e: {} as ApiError});
        await expect(pending).rejects.toEqual({message: 'malformed error frame', kind: 'internal'});
    });

    it('dispatches events by name and unsubscribes', () => {
        const seen: unknown[] = [];
        const off = transport.on('notice', (payload) => seen.push(payload));
        ipc.answer({t: 'ev', n: 'notice', d: {level: 'info', message: 'hello'}});
        off();
        ipc.answer({t: 'ev', n: 'notice', d: {level: 'info', message: 'gone'}});
        expect(seen).toEqual([{level: 'info', message: 'hello'}]);
    });

    it('ignores an event nobody listens to, and anything that is not a frame', () => {
        expect(() => {
            ipc.answer({t: 'ev', n: 'rega.changed', d: {}});
            ipc.emit(API_CHANNEL, '{not json');
            ipc.emit(API_CHANNEL, 42);
            ipc.emit(API_CHANNEL, 'null');
            ipc.emit(API_CHANNEL, JSON.stringify({t: 'nonsense'}));
        }).not.toThrow();
    });

    it('ignores a response to a request that is not pending', async () => {
        ipc.answer({t: 'res', id: 99, r: null});
        const pending = transport.request('names.get');
        ipc.answer({t: 'res', id: 1, r: {}});
        await expect(pending).resolves.toEqual({});
    });

    it('times a request out with kind connection', async () => {
        vi.useFakeTimers();
        try {
            const pending = transport.request('names.get');
            const assertion = expect(pending).rejects.toEqual({
                message: 'names.get timed out after 50 ms',
                kind: 'connection',
            });
            await vi.advanceTimersByTimeAsync(60);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects when the channel itself throws', async () => {
        ipc.throwOnSend = true;
        await expect(transport.request('names.get')).rejects.toEqual({message: 'ipc is gone', kind: 'internal'});
    });

    it('follows the connection channel and tells its listeners', () => {
        const seen: boolean[] = [];
        const off = transport.onConnectionChange((connected) => seen.push(connected));
        ipc.emit(API_CONNECTED_CHANNEL, true);
        ipc.emit(API_CONNECTED_CHANNEL, false);
        expect(transport.connected).toBe(false);
        off();
        ipc.emit(API_CONNECTED_CHANNEL, true);
        expect(seen).toEqual([false]);
    });

    it('fails the pending requests when main says the backend is gone', async () => {
        const pending = transport.request('names.get');
        ipc.emit(API_CONNECTED_CHANNEL, false);
        await expect(pending).rejects.toEqual({message: 'the backend was stopped', kind: 'connection'});
    });

    it('refuses a new request once it is disconnected', async () => {
        ipc.emit(API_CONNECTED_CHANNEL, false);
        await expect(transport.request('names.get')).rejects.toEqual({
            message: 'names.get: the backend is not available any more',
            kind: 'connection',
        });
    });
});

describe('the host bridge', () => {
    it('invokes one command channel with the command name and positional params', async () => {
        const ipc = new FakeIpc();
        const host = createHostBridge(ipc);
        ipc.invokeResult = null;
        await host.setTheme('dark');
        expect(ipc.invoked).toEqual([['theme.set', ['dark']]]);
    });

    it('answers app.info with what main sent', async () => {
        const ipc = new FakeIpc();
        const host = createHostBridge(ipc);
        ipc.invokeResult = {version: '3.0.0-dev.0'};
        await expect(host.info()).resolves.toEqual({version: '3.0.0-dev.0'});
    });

    it('builds a device image URL the renderer can put into an img tag', () => {
        expect(createHostBridge(new FakeIpc()).deviceImageUrl('HmIP-BSM')).toBe('hmm-image://device/HmIP-BSM');
    });

    it('drives the five updater commands', async () => {
        const ipc = new FakeIpc();
        const host = createHostBridge(ipc);
        ipc.invokeResult = {phase: 'idle', dismissed: false};
        await host.update.state();
        await host.update.check();
        await host.update.download();
        await host.update.installOnQuit();
        await host.update.dismiss();
        expect(ipc.invoked.map(([name]) => name)).toEqual([
            'update.state',
            'update.check',
            'update.download',
            'update.installOnQuit',
            'update.dismiss',
        ]);
    });

    it('pushes the update state to its listeners and unsubscribes', () => {
        const ipc = new FakeIpc();
        const host = createHostBridge(ipc);
        const seen: unknown[] = [];
        const off = host.update.on((state) => seen.push(state));
        ipc.emit(HOST_EVENT_CHANNEL, 'update.state', {phase: 'available', version: '3.1.0', dismissed: false});
        off();
        ipc.emit(HOST_EVENT_CHANNEL, 'update.state', {phase: 'downloaded', version: '3.1.0', dismissed: false});
        expect(seen).toEqual([{phase: 'available', version: '3.1.0', dismissed: false}]);
    });

    it('passes a menu action on, because the native menu cannot reach into the page', () => {
        const ipc = new FakeIpc();
        const host = createHostBridge(ipc);
        const seen: string[] = [];
        const off = host.onMenuAction((action) => seen.push(action));
        ipc.emit(HOST_EVENT_CHANNEL, 'menu.action', {action: 'settings'});
        ipc.emit(HOST_EVENT_CHANNEL, 'menu.action', {});
        off();
        ipc.emit(HOST_EVENT_CHANNEL, 'menu.action', {action: 'settings'});
        expect(seen).toEqual(['settings']);
    });

    it('pushes the OS theme and ignores an event it does not know', () => {
        const ipc = new FakeIpc();
        const host = createHostBridge(ipc);
        const seen: boolean[] = [];
        host.onSystemTheme((dark) => seen.push(dark));
        ipc.emit(HOST_EVENT_CHANNEL, 'theme.system', {dark: true});
        ipc.emit(HOST_EVENT_CHANNEL, 'theme.system', undefined);
        ipc.emit(HOST_EVENT_CHANNEL, 'something.else', {});
        expect(seen).toEqual([true, false]);
    });
});
