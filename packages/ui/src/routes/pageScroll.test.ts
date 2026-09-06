/**
 * The page never scrolls; the table inside the tab does (maintainer, 2026-09-06, on `beta.1`).
 *
 * On a CCU with a few hundred devices the whole document grew with the grid and the header band
 * scrolled off the top of the window - the toolbar and the interface picker were simply gone once
 * the user reached the bottom of the list. The shell is a column that is exactly as tall as the
 * window: the header, the tab's page and, when it is open, the RPC drawer share that height, and
 * the one element that scrolls is the table's own body.
 *
 * The defect lived in the *height chain*, which is why no test caught it: `.hmm-app` asked for
 * `height: 100%` and got `auto` wherever the element it is mounted into has no height of its own.
 * `mountApp` therefore mounts into a `<div id="app">` like the real hosts, and `.hmm-app` bounds
 * itself with `dvh` so that nothing above it can get it wrong; the last test here is the one that
 * pins the second half, by mounting into an element with no height at all.
 *
 * Pixel assertions, so browser mode only - jsdom reports every box as zero.
 */

import type {DeviceDescription, LinkRecord, RssiInfo, ServiceMessage} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {render} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import App from '../App.svelte';
import {createStores} from '../lib/stores/Stores.svelte.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {fakeRouter, MemoryStorage, mountApp} from '../testHarness.js';

const hasLayout = document.body.getBoundingClientRect().width > 0;

/** More rows than any window can show, so the grid has to scroll inside itself. */
const DEVICE_COUNT = 100;
const EVENT_COUNT = 300;

function manyDevices(): DeviceDescription[] {
    const devices: DeviceDescription[] = [];
    for (let index = 0; index < DEVICE_COUNT; index += 1) {
        const address = `MEQ${String(index).padStart(7, '0')}`;
        devices.push({
            ADDRESS: address,
            TYPE: 'HM-LC-SW1-PL',
            PARENT: '',
            CHILDREN: [`${address}:1`],
            PARAMSETS: ['MASTER'],
            FIRMWARE: '2.31.25',
            VERSION: 1,
            FLAGS: 1,
            RX_MODE: 1,
            INTERFACE: 'BidCoS-RF',
        });
        devices.push({
            ADDRESS: `${address}:1`,
            TYPE: 'SWITCH',
            PARENT: address,
            PARENT_TYPE: 'HM-LC-SW1-PL',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 1,
            DIRECTION: 2,
            FLAGS: 1,
            VERSION: 1,
        });
    }
    return devices;
}

function manyLinks(): LinkRecord[] {
    return Array.from({length: DEVICE_COUNT}, (_unused, index) => ({
        SENDER: `JEQ${String(index).padStart(7, '0')}:1`,
        RECEIVER: `MEQ${String(index).padStart(7, '0')}:1`,
        NAME: `link ${String(index)}`,
        DESCRIPTION: 'a link of the flood fixture',
        FLAGS: 0,
    }));
}

function manyRssi(): RssiInfo {
    const rssi: Record<string, Record<string, [number, number]>> = {};
    for (let index = 0; index < DEVICE_COUNT; index += 1) {
        rssi[`MEQ${String(index).padStart(7, '0')}`] = {'BidCoS-RF': [-52 - (index % 40), -56 - (index % 40)]};
    }
    return rssi;
}

function manyServiceMessages(): ServiceMessage[] {
    return Array.from({length: DEVICE_COUNT}, (_unused, index) => ({
        interfaceName: 'BidCos-RF',
        address: `MEQ${String(index).padStart(7, '0')}:0`,
        datapoint: index % 2 === 0 ? 'LOWBAT' : 'STICKY_UNREACH',
        value: true,
        since: Date.parse('2026-09-05T06:14:00Z') + index,
    }));
}

/** The demo transport with one tab's list filled far past the window. */
function floodedTransport(): MockTransport {
    const transport = new MockTransport({demo: true});
    transport.respond('devices.list', (interfaceName) => (interfaceName === 'BidCos-RF' ? manyDevices() : []));
    transport.respond('links.list', (interfaceName) => (interfaceName === 'BidCos-RF' ? manyLinks() : []));
    transport.respond('rssi.get', (interfaceName) => (interfaceName === 'BidCos-RF' ? manyRssi() : {}));
    // Not per interface: the store asks for the whole list and sorts it out itself.
    transport.result('serviceMessages.list', manyServiceMessages());
    return transport;
}

async function floodEvents(transport: MockTransport): Promise<void> {
    for (let index = 0; index < EVENT_COUNT; index += 1) {
        transport.emit('rpc.event', {
            timestamp: Date.parse('2026-09-06T10:00:00Z') + index,
            interfaceName: 'BidCos-RF',
            method: 'event',
            address: `MEQ${String(index % 20).padStart(7, '0')}:1`,
            datapoint: 'PRESS_SHORT',
            value: true,
        });
    }
    await waitFor(() => {
        expect(document.querySelectorAll('[data-row-id]').length).toBeGreaterThan(10);
    });
}

/** Neither the document nor the body is taller than the window: nothing scrolls the page. */
function expectNoPageScroll(): void {
    expect(document.documentElement.scrollHeight).toBe(window.innerHeight);
    expect(document.body.scrollHeight).toBe(window.innerHeight);
    // and nothing sticks out sideways either (task 19's rule for the whole shell)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
}

const headerBox = (): DOMRect => screen.getByTestId('app').querySelector('header')!.getBoundingClientRect();

/**
 * The tab's grid is the thing that scrolls, and scrolling it to the bottom leaves the header
 * exactly where it was - which is the half of the defect a user actually notices.
 */
async function expectScrollsInsideItself(tableTestId: string): Promise<void> {
    const body = screen.getByTestId(tableTestId).querySelector<HTMLElement>('.hmm-table-body')!;
    await waitFor(() => {
        expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    });

    const before = headerBox();
    body.scrollTop = body.scrollHeight;
    await fireEvent.scroll(body);
    await waitFor(() => {
        expect(body.scrollTop).toBeGreaterThan(0);
    });

    const after = headerBox();
    expect({top: after.top, height: after.height}).toEqual({top: before.top, height: before.height});
    expectNoPageScroll();
}

describe.skipIf(!hasLayout)('the page never scrolls, the tab does', () => {
    it.each([
        ['#/BidCos-RF/devices', 'devices-table'],
        ['#/BidCos-RF/links', 'links-table'],
        ['#/BidCos-RF/rssi', 'radio-table'],
        ['#/BidCos-RF/messages', 'messages-table'],
    ])('%s keeps the window and scrolls its grid', async (hash, tableTestId) => {
        await mountApp({transport: floodedTransport(), hash});
        await waitFor(() => {
            expect(screen.getByTestId(tableTestId)).toBeTruthy();
        });
        expectNoPageScroll();
        await expectScrollsInsideItself(tableTestId);
    });

    it('the events tab keeps the window with a full buffer', async () => {
        const transport = floodedTransport();
        await mountApp({transport, hash: '#/BidCos-RF/events'});
        await floodEvents(transport);

        expectNoPageScroll();
        await expectScrollsInsideItself('events-table');
    });

    /** The RPC console has no grid; its own column is what scrolls, and the page still does not. */
    it('the RPC console keeps the window', async () => {
        await mountApp({transport: floodedTransport(), hash: '#/BidCos-RF/console'});
        await waitFor(() => {
            expect(screen.getByTestId('console-method')).toBeTruthy();
        });

        expectNoPageScroll();
        const page = screen.getByTestId('app').querySelector<HTMLElement>('.hmm-panel > div')!;
        expect(page.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    });

    /** Task 22's drawer takes half the window from the grid, and gives none of it to the page. */
    it('the RPC drawer takes its half out of the grid, not out of the document', async () => {
        const transport = floodedTransport();
        await mountApp({transport, hash: '#/BidCos-RF/events'});
        await floodEvents(transport);

        await fireEvent.click(screen.getByTestId('rpclog-toggle'));
        const drawer = await waitFor(() => {
            const panel = screen.getByTestId('rpclog');
            expect(panel.getBoundingClientRect().height).toBeGreaterThan(0);
            return panel;
        });

        expect(Math.round(drawer.getBoundingClientRect().height)).toBe(Math.round(window.innerHeight / 2));
        expectNoPageScroll();
        await expectScrollsInsideItself('events-table');
    });

    /**
     * The second half of the fix: `.hmm-app` is the window whatever it was mounted into. A host
     * that hands the UI an element with no height of its own - or a stylesheet that has not
     * applied to `#app` yet - used to make the whole grid grow instead of scroll.
     */
    it('bounds itself even when the mount element has no height', async () => {
        const container = document.createElement('div');
        document.body.append(container);
        const transport = floodedTransport();
        const router = fakeRouter('#/BidCos-RF/devices');
        const stores = createStores(transport, {
            location: router.location,
            onHashChange: router.onHashChange,
            storage: new MemoryStorage(),
            hostScope: {},
        });
        render(App, {props: {stores}, target: container});
        await stores.start();
        await waitFor(() => {
            expect(stores.app.loading).toBe(false);
        });
        await waitFor(() => {
            expect(screen.getByTestId('devices-table')).toBeTruthy();
        });

        expect(Math.round(container.getBoundingClientRect().height)).toBe(window.innerHeight);
        expectNoPageScroll();
        await expectScrollsInsideItself('devices-table');
    });
});
