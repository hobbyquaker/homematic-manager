/**
 * The service-message sweep against real sockets: who gets asked `getServiceMessages`, and who
 * never gets asked again.
 *
 * Task 17's hardware pass found the sweep asking `VirtualDevices` once a minute on all three lab
 * boxes and logging `getServiceMessages failed: Invalid XML-RPC message` every time - on an idle
 * CCU addon the only line in the log. The CCU's group process has no such method; hmipserver has
 * none either. The core's table says so now (`serviceMessages: false`), and an interface the table
 * does not know is asked exactly once.
 *
 * hm-simulator serves `VirtualDevices` from the same dispatcher as every other interface, so it
 * answers `getServiceMessages` perfectly well - which is what makes it the right witness here: the
 * sweep must skip it because the *table* says to, not because the answer was bad. The bad answer is
 * a stub of its own below, in the place a user-defined interface (D-13) sits.
 */

import http from 'node:http';
import type {AddressInfo} from 'node:net';

import {afterEach, describe, expect, it} from 'vitest';

import {simulatorAvailable, startBackend, startSimulator} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hm-simulator ships no types */

const running: {close: () => unknown}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

/** Every `<interface>:<method>` the simulator dispatched, from the moment this was called. */
function recordCalls(sim: any): string[] {
    const seen: string[] = [];
    const inner = sim.dispatch.bind(sim) as (
        iface: string,
        method: string,
        params: unknown[],
        callback: unknown,
    ) => void;
    sim.dispatch = (iface: string, method: string, params: unknown[], callback: unknown) => {
        seen.push(`${iface}:${method}`);
        inner(iface, method, params, callback);
    };
    return seen;
}

const RESPONSE_EMPTY_STRING =
    '<?xml version="1.0"?><methodResponse><params><param><value><string></string></value></param></params></methodResponse>';
const RESPONSE_EMPTY_ARRAY =
    '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>';

/**
 * A stub interface process that answers `getServiceMessages` with something that is not XML-RPC -
 * what the CCU's group process does, in the one place the built-in table cannot help: an interface
 * the user configured by hand.
 */
async function brokenServiceMessageInterface(): Promise<{
    port: number;
    calls: string[];
    close: () => Promise<void>;
}> {
    const calls: string[] = [];
    const server = http.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
            body += chunk;
        });
        request.on('end', () => {
            const method = /<methodName>([^<]*)<\/methodName>/.exec(body)?.[1] ?? '';
            calls.push(method);
            if (method === 'getServiceMessages') {
                // not XML at all, exactly the class of answer the group process gives
                response.writeHead(200, {'Content-Type': 'text/plain'});
                response.end('no service messages here');
                return;
            }
            response.writeHead(200, {'Content-Type': 'text/xml'});
            response.end(method === 'listDevices' ? RESPONSE_EMPTY_ARRAY : RESPONSE_EMPTY_STRING);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        port: (server.address() as AddressInfo).port,
        calls,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

describe.skipIf(!simulatorAvailable)('the service-message sweep', () => {
    it('never asks VirtualDevices, and keeps asking the interface that does answer', async () => {
        const sim = await startSimulator({virtual: true});
        running.push({close: () => sim.close()});
        const harness = await startBackend(sim, {
            connection: {interfaces: ['BidCos-RF', 'VirtualDevices']},
        });
        running.unshift({close: () => harness.close()});

        expect(
            (await harness.backend.request('interfaces.list')).map((state) => [state.name, state.connected]),
        ).toEqual([
            ['BidCos-RF', true],
            ['VirtualDevices', true],
        ]);

        const calls = recordCalls(sim);
        await harness.backend.pollServiceMessages();
        await harness.backend.pollServiceMessages();

        expect(calls).not.toContain('virtual:getServiceMessages');
        expect(calls.filter((call) => call === 'rfd:getServiceMessages')).toHaveLength(2);
        expect(harness.notices.filter((notice) => notice.message.includes('getServiceMessages'))).toEqual([]);
    });

    it('asks a user-defined interface once and then remembers that it has no such method', async () => {
        const stub = await brokenServiceMessageInterface();
        running.push({close: () => stub.close()});
        const sim = await startSimulator();
        running.push({close: () => sim.close()});
        const harness = await startBackend(sim, {
            connection: {
                interfaces: ['BidCos-RF', 'Groups'],
                extraInterfaces: [{name: 'Groups', host: '127.0.0.1', port: stub.port, protocol: 'xmlrpc'}],
            },
        });
        running.unshift({close: () => harness.close()});

        // the interface subscribed, and the sweep that follows a successful `init` asked it once
        expect(stub.calls).toContain('init');
        expect(stub.calls.filter((method) => method === 'getServiceMessages')).toHaveLength(1);

        await harness.backend.pollServiceMessages();
        await harness.backend.pollServiceMessages();

        expect(stub.calls.filter((method) => method === 'getServiceMessages')).toHaveLength(1);
        // and the one failure it did see was never worth a line
        expect(harness.notices.filter((notice) => notice.message.includes('getServiceMessages'))).toEqual([]);
    });
});
