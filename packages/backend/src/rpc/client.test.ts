import {describe, expect, it, vi} from 'vitest';

import type {RpcValue} from '@homematic-manager/core';

import {BackendError} from '../errors.js';
import {RpcClient, type RpcCallRecord, type RpcClientOptions, type RpcOutValue, type RpcTransport} from './client.js';

/** A transport that answers from a table instead of from a socket. */
function fakeTransport(
    answer: (method: string, params: RpcOutValue[]) => {value?: RpcValue; error?: Error} | 'never',
): {
    transport: RpcTransport;
    close: ReturnType<typeof vi.fn>;
} {
    const close = vi.fn();
    return {
        close,
        transport: {
            methodCall(method, params, callback) {
                const outcome = answer(method, params);
                if (outcome === 'never') {
                    return;
                }
                setTimeout(() => {
                    callback(outcome.error ?? null, outcome.value);
                }, 0);
            },
            close,
        },
    };
}

function client(
    answer: Parameters<typeof fakeTransport>[0],
    options: Partial<RpcClientOptions> = {},
): {rpc: RpcClient; close: ReturnType<typeof vi.fn>} {
    const {transport, close} = fakeTransport(answer);
    const rpc = new RpcClient({
        name: 'HmIP-RF',
        host: 'ccu.lan',
        port: 2010,
        protocol: 'xmlrpc',
        createTransport: () => transport,
        ...options,
    });
    return {rpc, close};
}

describe('RpcClient', () => {
    it('resolves with the answer of the interface process', async () => {
        const {rpc} = client(() => ({value: [{ADDRESS: 'ABC0000001'}]}));
        await expect(rpc.call('listDevices')).resolves.toEqual([{ADDRESS: 'ABC0000001'}]);
    });

    it('describes itself for error messages', () => {
        const {rpc} = client(() => ({value: ''}));
        expect(rpc.description).toBe('HmIP-RF (ccu.lan:2010, xmlrpc)');
    });

    it('turns an empty answer into an empty string', async () => {
        const {rpc} = client(() => ({}));
        await expect(rpc.call('ping', ['hmm'])).resolves.toBe('');
    });

    it('maps a thrown xml-rpc fault to kind rpc and keeps the code', async () => {
        const fault = Object.assign(new Error('XML-RPC fault: Unknown parameter'), {
            faultCode: -4,
            faultString: 'Unknown parameter',
        });
        const {rpc} = client(() => ({error: fault}));
        const error = await rpc.call('putParamset', ['ABC:1', 'MASTER', {}]).catch((value: unknown) => value);
        expect(error).toBeInstanceOf(BackendError);
        expect((error as BackendError).kind).toBe('rpc');
        expect((error as BackendError).faultCode).toBe(-4);
        expect((error as BackendError).faultString).toBe('Unknown parameter');
    });

    it('recognises the binrpc fault struct that comes back as an ordinary result', async () => {
        const {rpc} = client(() => ({value: {faultCode: -2, faultString: 'Unknown instance'}}), {protocol: 'binrpc'});
        const error = await rpc.call('getParamset', ['NOPE:1', 'MASTER']).catch((value: unknown) => value);
        expect((error as BackendError).kind).toBe('rpc');
        expect((error as BackendError).faultCode).toBe(-2);
        expect((error as BackendError).message).toContain('getParamset');
    });

    it('maps a socket error to kind connection', async () => {
        const {rpc} = client(() => ({error: new Error('connect ECONNREFUSED')}));
        const error = await rpc.call('ping').catch((value: unknown) => value);
        expect((error as BackendError).kind).toBe('connection');
        expect((error as BackendError).message).toContain('ECONNREFUSED');
    });

    it('rejects a call that is never answered', async () => {
        const {rpc} = client(() => 'never', {timeoutMs: 20});
        const error = await rpc.call('listDevices').catch((value: unknown) => value);
        expect((error as BackendError).kind).toBe('connection');
        expect((error as BackendError).message).toContain('timed out after 20 ms');
    });

    it('ignores a second answer to the same call', async () => {
        let seen = 0;
        const transport: RpcTransport = {
            methodCall(_method, _params, callback) {
                callback(null, 'first');
                callback(null, 'second');
                seen += 1;
            },
        };
        const rpc = new RpcClient({
            name: 'BidCos-RF',
            host: 'ccu',
            port: 2001,
            protocol: 'xmlrpc',
            createTransport: () => transport,
        });
        await expect(rpc.call('ping')).resolves.toBe('first');
        expect(seen).toBe(1);
    });

    it('reports every call to the log hook', async () => {
        const records: RpcCallRecord[] = [];
        const {rpc} = client((method) => (method === 'ping' ? {value: 'pong'} : {error: new Error('nope')}), {
            onCall: (record) => records.push(record),
        });
        await rpc.call('ping', ['hmm']);
        await rpc.call('boom').catch(() => undefined);
        expect(records).toHaveLength(2);
        expect(records[0]).toMatchObject({interfaceName: 'HmIP-RF', method: 'ping', params: ['hmm'], ok: true});
        expect(records[0]?.result).toBe('pong');
        expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
        expect(records[1]).toMatchObject({method: 'boom', ok: false});
        expect(records[1]?.error).toContain('nope');
    });

    it('closes the transport and refuses further calls', async () => {
        const {rpc, close} = client(() => ({value: ''}));
        rpc.close();
        expect(close).toHaveBeenCalledOnce();
        expect(rpc.closed).toBe(true);
        await expect(rpc.call('ping')).rejects.toThrow('the client is closed');
    });

    it('passes a BackendError from the transport through unchanged', async () => {
        const failure = new BackendError({message: 'already classified', kind: 'validation'});
        const {rpc} = client(() => ({error: failure}));
        const error = await rpc.call('ping').catch((value: unknown) => value);
        expect(error).toBe(failure);
    });
});

describe('the real transports', () => {
    it('builds an xmlrpc client with latin1 and basic auth without touching a socket', () => {
        const rpc = new RpcClient({
            name: 'BidCos-RF',
            host: '127.0.0.1',
            port: 1,
            protocol: 'xmlrpc',
            auth: {user: 'Admin', password: 'secret'},
        });
        expect(rpc.description).toBe('BidCos-RF (127.0.0.1:1, xmlrpc)');
        rpc.close();
    });

    it('builds a TLS client', () => {
        const rpc = new RpcClient({name: 'HmIP-RF', host: '127.0.0.1', port: 1, protocol: 'xmlrpc', tls: true});
        expect(rpc.protocol).toBe('xmlrpc');
        rpc.close();
    });

    it('builds a binrpc client and closes it without reconnecting', () => {
        const rpc = new RpcClient({name: 'CUxD', host: '127.0.0.1', port: 1, protocol: 'binrpc'});
        rpc.close();
        expect(rpc.closed).toBe(true);
    });
});
