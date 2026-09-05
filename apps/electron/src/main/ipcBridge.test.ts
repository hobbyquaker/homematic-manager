import type {ApiEventName, ApiFrame, ApiMethodName, ApiParams, ApiResult, Transport} from '@homematic-manager/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {API_CHANNEL, API_CONNECTED_CHANNEL} from '../shared/ipc.js';

import {
    API_EVENT_NAMES,
    IpcBridge,
    type IpcMainEventLike,
    type IpcMainLike,
    type WebContentsLike,
} from './ipcBridge.js';

/** A `webContents` that records what it was sent and can be destroyed. */
class FakeContents implements WebContentsLike {
    readonly sent: Array<[string, unknown]> = [];
    destroyed = false;
    throwOnSend = false;

    constructor(readonly id: number) {}

    isDestroyed(): boolean {
        return this.destroyed;
    }

    send(channel: string, ...args: unknown[]): void {
        if (this.throwOnSend) {
            throw new Error('Object has been destroyed');
        }
        this.sent.push([channel, args[0]]);
    }

    /** The `ApiFrame`s it received, decoded. */
    frames(): ApiFrame[] {
        return this.sent
            .filter(([channel]) => channel === API_CHANNEL)
            .map(([, payload]) => JSON.parse(payload as string) as ApiFrame);
    }
}

class FakeIpcMain implements IpcMainLike {
    readonly listeners = new Map<string, Array<(event: IpcMainEventLike, ...args: unknown[]) => void>>();

    on(channel: string, listener: (event: IpcMainEventLike, ...args: unknown[]) => void): this {
        const list = this.listeners.get(channel) ?? [];
        list.push(listener);
        this.listeners.set(channel, list);
        return this;
    }

    removeAllListeners(channel: string): this {
        this.listeners.delete(channel);
        return this;
    }

    emit(channel: string, sender: WebContentsLike, payload: unknown): void {
        for (const listener of this.listeners.get(channel) ?? []) {
            listener({sender}, payload);
        }
    }
}

/** A transport whose answers the test decides, and whose events it fires by hand. */
class FakeTransport implements Transport {
    readonly requests: Array<[string, unknown[]]> = [];
    respond: (method: string, params: unknown[]) => Promise<unknown> = () => Promise.resolve(null);

    readonly #handlers = new Map<string, Set<(payload: never) => void>>();
    readonly #connection = new Set<(connected: boolean) => void>();
    #connected = true;

    get connected(): boolean {
        return this.#connected;
    }

    request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        this.requests.push([method, params]);
        return this.respond(method, params) as Promise<ApiResult<M>>;
    }

    on(event: string, handler: (payload: never) => void): () => void {
        const set = this.#handlers.get(event) ?? new Set();
        set.add(handler);
        this.#handlers.set(event, set);
        return () => set.delete(handler);
    }

    onConnectionChange(handler: (connected: boolean) => void): () => void {
        this.#connection.add(handler);
        return () => this.#connection.delete(handler);
    }

    emit(event: string, payload: unknown): void {
        for (const handler of [...(this.#handlers.get(event) ?? [])]) {
            (handler as (payload: unknown) => void)(payload);
        }
    }

    setConnected(connected: boolean): void {
        this.#connected = connected;
        for (const handler of [...this.#connection]) {
            handler(connected);
        }
    }

    get subscribed(): string[] {
        return [...this.#handlers].filter(([, set]) => set.size > 0).map(([name]) => name);
    }
}

const request = (id: number, method: string, params: unknown[] = []): string =>
    JSON.stringify({t: 'req', id, m: method, p: params});

describe('IpcBridge', () => {
    let ipcMain: FakeIpcMain;
    let transport: FakeTransport;
    let bridge: IpcBridge;
    let contents: FakeContents;

    beforeEach(() => {
        ipcMain = new FakeIpcMain();
        transport = new FakeTransport();
        bridge = new IpcBridge({ipcMain, transport});
        contents = new FakeContents(1);
        bridge.attach(contents);
    });

    it('subscribes to every event of the contract', () => {
        expect(transport.subscribed.sort()).toEqual([...API_EVENT_NAMES].sort());
    });

    it('tells a fresh renderer the connection state', () => {
        expect(contents.sent[0]).toEqual([API_CONNECTED_CHANNEL, true]);
    });

    it('answers a request with a res frame carrying the result', async () => {
        transport.respond = () => Promise.resolve([{name: 'BidCos-RF'}]);
        ipcMain.emit(API_CHANNEL, contents, request(7, 'interfaces.list'));
        await vi.waitFor(() => expect(contents.frames()).toHaveLength(1));
        expect(contents.frames()[0]).toEqual({t: 'res', id: 7, r: [{name: 'BidCos-RF'}]});
        expect(transport.requests).toEqual([['interfaces.list', []]]);
    });

    it('forwards the positional params verbatim', async () => {
        ipcMain.emit(API_CHANNEL, contents, request(1, 'devices.list', ['HmIP-RF', {refresh: true}]));
        await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
        expect(transport.requests[0]).toEqual(['devices.list', ['HmIP-RF', {refresh: true}]]);
    });

    it('turns a null result into a res frame, because null is what the contract carries', async () => {
        transport.respond = () => Promise.resolve(null);
        ipcMain.emit(API_CHANNEL, contents, request(2, 'events.clear'));
        await vi.waitFor(() => expect(contents.frames()).toHaveLength(1));
        expect(contents.frames()[0]).toEqual({t: 'res', id: 2, r: null});
    });

    it('answers a rejection with an err frame that keeps the fault code', async () => {
        transport.respond = () =>
            Promise.reject({message: 'Unknown parameter', kind: 'rpc', faultCode: -5, faultString: 'no such param'});
        ipcMain.emit(API_CHANNEL, contents, request(3, 'value.get', ['BidCos-RF', 'ABC:1', 'NOPE']));
        await vi.waitFor(() => expect(contents.frames()).toHaveLength(1));
        expect(contents.frames()[0]).toEqual({
            t: 'err',
            id: 3,
            e: {message: 'Unknown parameter', kind: 'rpc', faultCode: -5, faultString: 'no such param'},
        });
    });

    it('classifies anything that is not an ApiError as internal', async () => {
        transport.respond = () => Promise.reject(new TypeError('x is not a function'));
        ipcMain.emit(API_CHANNEL, contents, request(4, 'names.get'));
        await vi.waitFor(() => expect(contents.frames()).toHaveLength(1));
        expect(contents.frames()[0]).toEqual({
            t: 'err',
            id: 4,
            e: {message: 'x is not a function', kind: 'internal'},
        });
    });

    it('fans events out to every attached renderer', () => {
        const second = new FakeContents(2);
        bridge.attach(second);
        transport.emit('notice', {level: 'warn', message: 'ReGa is not answering'});
        for (const target of [contents, second]) {
            expect(target.frames()).toEqual([
                {t: 'ev', n: 'notice', d: {level: 'warn', message: 'ReGa is not answering'}},
            ]);
        }
    });

    it('does not send a renderer its events twice after a reload', () => {
        bridge.attach(contents);
        transport.emit('names.changed', {'ABC:1': 'Lamp'});
        expect(contents.frames()).toHaveLength(1);
        expect(bridge.renderers).toHaveLength(1);
    });

    it('passes the connection state on its own channel and drops pending renderers', () => {
        transport.setConnected(false);
        expect(contents.sent.at(-1)).toEqual([API_CONNECTED_CHANNEL, false]);
    });

    it('forgets a destroyed renderer instead of throwing at it', () => {
        contents.destroyed = true;
        transport.emit('names.changed', {});
        expect(bridge.renderers).toHaveLength(0);
    });

    it('survives a renderer that is destroyed between the check and the send', () => {
        contents.throwOnSend = true;
        expect(() => {
            transport.emit('names.changed', {});
        }).not.toThrow();
        expect(bridge.renderers).toHaveLength(0);
    });

    it('drops a request from a renderer that closed while it ran', async () => {
        let release: (value: unknown) => void = () => undefined;
        transport.respond = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        ipcMain.emit(API_CHANNEL, contents, request(9, 'names.get'));
        await vi.waitFor(() => expect(transport.requests).toHaveLength(1));
        contents.destroyed = true;
        release({});
        await Promise.resolve();
        expect(contents.frames()).toHaveLength(0);
    });

    it('refuses anything that is not a request frame', () => {
        const errors: string[] = [];
        const ipc = new FakeIpcMain();
        const other = new IpcBridge({ipcMain: ipc, transport, onProtocolError: (m) => errors.push(m)});
        ipc.emit(API_CHANNEL, contents, 'this is not json at all');
        ipc.emit(API_CHANNEL, contents, JSON.stringify({t: 'res', id: 1, r: null}));
        expect(errors).toEqual([
            'a renderer sent something that is not an ApiFrame',
            'a renderer sent a "res" frame, which only main may send',
        ]);
        expect(transport.requests).toHaveLength(0);
        other.dispose();
    });

    it('unsubscribes and forgets everything on dispose, twice without complaint', () => {
        bridge.dispose();
        bridge.dispose();
        expect(transport.subscribed).toEqual([]);
        expect(bridge.renderers).toEqual([]);
        expect(ipcMain.listeners.has(API_CHANNEL)).toBe(false);
    });

    it('detaches a window on request', () => {
        bridge.detach(contents);
        transport.emit('names.changed', {});
        expect(contents.frames()).toHaveLength(0);
    });

    it('only knows event names the contract has', () => {
        const names: readonly ApiEventName[] = API_EVENT_NAMES;
        expect(names).toContain('write.progress');
    });
});
