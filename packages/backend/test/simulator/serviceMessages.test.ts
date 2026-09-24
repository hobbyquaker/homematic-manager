/**
 * The service-message sweep against real sockets: who gets asked `getServiceMessages`, and who
 * never gets asked again.
 *
 * Task 17's hardware pass found the sweep asking `VirtualDevices` once a minute on all three lab
 * boxes and logging `getServiceMessages failed: Invalid XML-RPC message` every time - on an idle
 * CCU addon the only line in the log. The CCU's group process has no such method; hmipserver has
 * none either, and B-26 (#158) found the same for CUxD, which warns in the CCU's syslog for every
 * call. The core's table says so now (`serviceMessages: false`). An interface the table does not know
 * is judged by its `system.listMethods`, and without a usable list it is asked exactly once.
 *
 * hm-simulator serves `VirtualDevices` and CUxD from the same dispatcher as every other interface, so
 * they answer `getServiceMessages` perfectly well - which is what makes them the right witnesses
 * here: the sweep must skip them because the *table* says to, not because the answer was bad. The
 * bad answer is a stub of its own below, in the place a user-defined interface (D-13) sits.
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

/** An XML-RPC answer carrying a list of strings. */
function stringArrayResponse(values: readonly string[]): string {
    const items = values.map((value) => `<value><string>${value}</string></value>`).join('');
    return `<?xml version="1.0"?><methodResponse><params><param><value><array><data>${items}</data></array></value></param></params></methodResponse>`;
}

/**
 * A stub interface process that answers `getServiceMessages` with something that is not XML-RPC -
 * what the CCU's group process does, in the one place the built-in table cannot help: an interface
 * the user configured by hand. Its `system.listMethods` gives no list unless `listMethods` is set.
 */
async function brokenServiceMessageInterface(options: {listMethods?: readonly string[]} = {}): Promise<{
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
            if (method === 'system.listMethods' && options.listMethods !== undefined) {
                response.writeHead(200, {'Content-Type': 'text/xml'});
                response.end(stringArrayResponse(options.listMethods));
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
    it('never asks VirtualDevices or CUxD, and keeps asking the interface that does answer', async () => {
        const sim = await startSimulator({virtual: true, cuxd: true});
        running.push({close: () => sim.close()});
        const harness = await startBackend(sim, {
            connection: {interfaces: ['BidCos-RF', 'VirtualDevices', 'CUxD']},
        });
        running.unshift({close: () => harness.close()});

        expect(
            (await harness.backend.request('interfaces.list')).map((state) => [state.name, state.connected]),
        ).toEqual([
            ['BidCos-RF', true],
            ['VirtualDevices', true],
            ['CUxD', true],
        ]);

        const calls = recordCalls(sim);
        await harness.backend.pollServiceMessages();
        await harness.backend.pollServiceMessages();

        expect(calls).not.toContain('virtual:getServiceMessages');
        expect(calls).not.toContain('cuxd:getServiceMessages');
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

    it('never asks a user-defined interface whose system.listMethods does not list the method (B-26)', async () => {
        const stub = await brokenServiceMessageInterface({
            listMethods: ['init', 'ping', 'listDevices', 'system.listMethods'],
        });
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

        expect(stub.calls).toContain('init');
        await harness.backend.pollServiceMessages();
        await harness.backend.pollServiceMessages();

        expect(stub.calls.filter((method) => method === 'getServiceMessages')).toEqual([]);
        expect(stub.calls.filter((method) => method === 'system.listMethods')).toHaveLength(1);
        expect(harness.notices.filter((notice) => notice.message.includes('getServiceMessages'))).toEqual([]);
    });
});

/**
 * Task 36 and B-61: the CCU's own service messages are ReGa alarms. Their first report (the
 * WebUI's *Erste Meldung*) replaces the time this application first saw a message, and an
 * acknowledgement receipts the alarm too. The ReGa client is a stand-in here: hm-simulator's ReGa
 * mock knows no alarms.
 */
describe.skipIf(!simulatorAvailable)("ReGa's alarms beside the service messages (task 36, B-61)", () => {
    const FIRST = 1_790_000_000;

    function regaWithAlarm(scripts: string[]): {
        getChannels: () => Promise<unknown[]>;
        exec: (script: string) => Promise<{output: string; objects: Record<string, string>}>;
    } {
        let receipted = false;
        return {
            getChannels: () => Promise.resolve([{id: 1000, address: 'LEQ0000001', name: 'Steckdose'}]),
            exec: (script: string) => {
                scripts.push(script);
                if (script.includes('AlReceipt')) {
                    receipted = true;
                    return Promise.resolve({output: '1', objects: {}});
                }
                if (script.includes('AlOccurrenceTime')) {
                    return Promise.resolve({
                        output: receipted
                            ? ''
                            : `BidCos-RF.LEQ0000001:0.STICKY_UNREACH\t${String(FIRST)}\t${String(FIRST + 60)}\n`,
                        objects: {},
                    });
                }
                return Promise.resolve({output: '', objects: {}});
            },
        };
    }

    it("shows the CCU's first report as Since, and receipts the alarm with the acknowledgement", async () => {
        const sim = await startSimulator({rega: false});
        running.push({close: () => sim.close()});
        const scripts: string[] = [];
        const harness = await startBackend(sim, {
            backend: {regaOptions: {createClient: () => regaWithAlarm(scripts) as never}},
        });
        running.unshift({close: () => harness.close()});
        sim.setServiceMessage('rfd', 'LEQ0000001:0', 'STICKY_UNREACH', true);

        const list = await harness.backend.request('serviceMessages.refresh', 'BidCos-RF');
        const sticky = list.find((message) => message.datapoint === 'STICKY_UNREACH');
        expect(sticky).toMatchObject({address: 'LEQ0000001:0', since: FIRST * 1000, sinceSource: 'rega'});

        await harness.backend.request('serviceMessages.ack', 'BidCos-RF', 'LEQ0000001:0', 'STICKY_UNREACH');
        await waitUntil(() => scripts.some((script) => script.includes('AlReceipt')));
        const receipt = scripts.find((script) => script.includes('AlReceipt')) ?? '';
        expect(receipt).toContain('"BidCos-RF.LEQ0000001:0.STICKY_UNREACH"');
    });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error('condition was not met in time');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
