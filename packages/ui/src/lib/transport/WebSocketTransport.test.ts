import type {ApiFrame} from '@homematic-manager/core';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {WebSocketLike} from './WebSocketTransport.js';
import {WebSocketTransport} from './WebSocketTransport.js';

/** A WebSocket that does exactly what the test tells it to and remembers what was sent. */
class FakeWebSocket implements WebSocketLike {
    static instances: FakeWebSocket[] = [];

    readyState = 0;
    readonly sent: string[] = [];
    closed = false;

    onopen: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: {data: unknown}) => void) | null = null;

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    static get last(): FakeWebSocket {
        const socket = FakeWebSocket.instances.at(-1);
        if (!socket) {
            throw new Error('no socket was created');
        }
        return socket;
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
    }

    open(): void {
        this.readyState = 1;
        this.onopen?.({});
    }

    receive(frame: ApiFrame | string): void {
        this.onmessage?.({data: typeof frame === 'string' ? frame : JSON.stringify(frame)});
    }

    drop(): void {
        this.readyState = 3;
        this.onerror?.({});
        this.onclose?.({});
    }

    lastFrame(): ApiFrame {
        const data = this.sent.at(-1);
        if (data === undefined) {
            throw new Error('nothing was sent');
        }
        return JSON.parse(data) as ApiFrame;
    }
}

function makeTransport(overrides: Partial<ConstructorParameters<typeof WebSocketTransport>[0]> = {}) {
    return new WebSocketTransport({
        url: 'ws://localhost/api',
        factory: (url) => new FakeWebSocket(url),
        requestTimeoutMs: 1000,
        minBackoffMs: 100,
        maxBackoffMs: 400,
        ...overrides,
    });
}

describe('WebSocketTransport', () => {
    beforeEach(() => {
        FakeWebSocket.instances = [];
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('opens a socket for the url and reports the connection', () => {
        const changes: boolean[] = [];
        const transport = makeTransport();
        transport.onConnectionChange((connected) => changes.push(connected));

        expect(FakeWebSocket.last.url).toBe('ws://localhost/api');
        expect(transport.connected).toBe(false);
        FakeWebSocket.last.open();
        expect(transport.connected).toBe(true);
        expect(changes).toEqual([true]);
    });

    it('does not connect when autoConnect is off, and connect() is idempotent', () => {
        const transport = makeTransport({autoConnect: false});
        expect(FakeWebSocket.instances).toHaveLength(0);
        transport.connect();
        transport.connect();
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('sends a req frame with an increasing id and resolves on the res frame', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();

        const first = transport.request('devices.list', 'BidCos-RF');
        await Promise.resolve();
        expect(FakeWebSocket.last.lastFrame()).toEqual({t: 'req', id: 1, m: 'devices.list', p: ['BidCos-RF']});
        FakeWebSocket.last.receive({t: 'res', id: 1, r: []});
        await expect(first).resolves.toEqual([]);

        const second = transport.request('names.get');
        await Promise.resolve();
        expect(FakeWebSocket.last.lastFrame()).toMatchObject({id: 2, m: 'names.get'});
        FakeWebSocket.last.receive({t: 'res', id: 2, r: {'A:1': 'Test'}});
        await expect(second).resolves.toEqual({'A:1': 'Test'});
    });

    it('rejects on an err frame and keeps the fault code', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        const pending = transport.request('value.get', 'BidCos-RF', 'A:1', 'STATE');
        await Promise.resolve();
        FakeWebSocket.last.receive({
            t: 'err',
            id: 1,
            e: {message: 'Unknown parameter', kind: 'rpc', faultCode: -5},
        });
        await expect(pending).rejects.toMatchObject({kind: 'rpc', faultCode: -5, message: 'Unknown parameter'});
    });

    it('turns a malformed err frame into an internal error', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        const pending = transport.request('names.get');
        await Promise.resolve();
        FakeWebSocket.last.receive({t: 'err', id: 1, e: 'nonsense'} as unknown as ApiFrame);
        await expect(pending).rejects.toMatchObject({kind: 'internal'});
    });

    it('waits for the socket to open before sending', async () => {
        const transport = makeTransport();
        const pending = transport.request('names.get');
        await Promise.resolve();
        expect(FakeWebSocket.last.sent).toHaveLength(0);

        FakeWebSocket.last.open();
        await Promise.resolve();
        await Promise.resolve();
        expect(FakeWebSocket.last.sent).toHaveLength(1);
        FakeWebSocket.last.receive({t: 'res', id: 1, r: {}});
        await expect(pending).resolves.toEqual({});
    });

    it('gives up waiting for a socket that never opens', async () => {
        const transport = makeTransport();
        const pending = transport.request('names.get');
        const assertion = expect(pending).rejects.toMatchObject({kind: 'connection'});
        await vi.advanceTimersByTimeAsync(1001);
        await assertion;
    });

    it('times out a request that is never answered', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        const pending = transport.request('devices.list', 'BidCos-RF');
        const assertion = expect(pending).rejects.toMatchObject({
            kind: 'connection',
            message: 'devices.list timed out after 1000 ms',
        });
        await vi.advanceTimersByTimeAsync(1001);
        await assertion;
    });

    it('dispatches ev frames by name and stops on unsubscribe', () => {
        const transport = makeTransport();
        const handler = vi.fn();
        const off = transport.on('rpc.event', handler);
        FakeWebSocket.last.open();

        const record = {timestamp: 1, interfaceName: 'BidCos-RF', method: 'event' as const};
        FakeWebSocket.last.receive({t: 'ev', n: 'rpc.event', d: record});
        off();
        FakeWebSocket.last.receive({t: 'ev', n: 'rpc.event', d: record});
        FakeWebSocket.last.receive({t: 'ev', n: 'names.changed', d: {}});

        expect(handler).toHaveBeenCalledExactlyOnceWith(record);
    });

    it('ignores frames it cannot use', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        const pending = transport.request('names.get');
        await Promise.resolve();

        FakeWebSocket.last.receive('not json');
        FakeWebSocket.last.receive('null');
        FakeWebSocket.last.receive({t: 'nonsense'} as unknown as ApiFrame);
        FakeWebSocket.last.receive({t: 'res', id: 99, r: {}});
        FakeWebSocket.last.onmessage?.({data: new ArrayBuffer(2)});

        FakeWebSocket.last.receive({t: 'res', id: 1, r: {ok: true}});
        await expect(pending).resolves.toEqual({ok: true});
    });

    it('rejects pending requests when the socket drops and reconnects with a doubling backoff', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        const pending = transport.request('devices.list', 'BidCos-RF');
        await Promise.resolve();

        const assertion = expect(pending).rejects.toMatchObject({kind: 'connection'});
        FakeWebSocket.last.drop();
        await assertion;
        expect(transport.connected).toBe(false);
        expect(transport.backoffMs).toBe(200);

        await vi.advanceTimersByTimeAsync(100);
        expect(FakeWebSocket.instances).toHaveLength(2);

        FakeWebSocket.last.drop();
        expect(transport.backoffMs).toBe(400);
        await vi.advanceTimersByTimeAsync(200);
        expect(FakeWebSocket.instances).toHaveLength(3);

        FakeWebSocket.last.drop();
        expect(transport.backoffMs).toBe(400);
    });

    it('resets the backoff after a successful reconnect', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        FakeWebSocket.last.drop();
        expect(transport.backoffMs).toBe(200);
        await vi.advanceTimersByTimeAsync(100);
        FakeWebSocket.last.open();
        expect(transport.backoffMs).toBe(100);
    });

    it('does not reconnect when reconnect is off', async () => {
        makeTransport({reconnect: false});
        FakeWebSocket.last.open();
        FakeWebSocket.last.drop();
        await vi.advanceTimersByTimeAsync(1000);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('close() stops the reconnect and rejects everything that is pending', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        const pending = transport.request('names.get');
        await Promise.resolve();
        const assertion = expect(pending).rejects.toMatchObject({message: 'transport closed'});

        transport.close();
        await assertion;
        expect(FakeWebSocket.last.closed).toBe(true);
        expect(transport.connected).toBe(false);

        await vi.advanceTimersByTimeAsync(1000);
        expect(FakeWebSocket.instances).toHaveLength(1);
        await expect(transport.request('names.get')).rejects.toMatchObject({kind: 'connection'});
    });

    it('cancels a pending reconnect when it is closed while waiting', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        FakeWebSocket.last.drop();
        transport.close();
        await vi.advanceTimersByTimeAsync(1000);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('reports a send that throws as a connection error', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        vi.spyOn(FakeWebSocket.last, 'send').mockImplementation(() => {
            throw new Error('socket is gone');
        });
        await expect(transport.request('names.get')).rejects.toMatchObject({
            kind: 'connection',
            message: 'socket is gone',
        });
    });

    it('rejects when the socket reports open but is no longer OPEN', async () => {
        const transport = makeTransport();
        FakeWebSocket.last.open();
        FakeWebSocket.last.readyState = 2;
        await expect(transport.request('names.get')).rejects.toMatchObject({kind: 'connection'});
    });

    it('uses the global WebSocket when no factory is given', () => {
        const created: string[] = [];
        const original = globalThis.WebSocket;
        globalThis.WebSocket = class {
            constructor(url: string) {
                created.push(url);
            }
            close(): void {}
        } as unknown as typeof WebSocket;
        try {
            new WebSocketTransport({url: 'ws://example/api'});
            expect(created).toEqual(['ws://example/api']);
        } finally {
            globalThis.WebSocket = original;
        }
    });
});
