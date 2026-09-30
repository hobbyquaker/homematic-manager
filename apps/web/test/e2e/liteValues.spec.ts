/**
 * Task 82 (task 68, task 72 step 4): a remote openccu-lite connection shows the system's own times. The
 * VALUES dialog says since when a value stands - the state store's last change - and greys a value the
 * system restored from its file that no device has reported since; the service-message list dates a
 * message by the store's last change, and its tooltip names that clock. occulite-client's `FakeBox`
 * stands in for the system, as in the backend's tests.
 */

import {startForTest, type TestHost} from 'homematic-manager';
import {FakeBox} from 'occulite-client/testing';

import {expect, test} from './fixtures.js';

const DEVICE = '0001D3C99A0082';
const TOKEN = 'olt_e2e_task82';

let fake: FakeBox | undefined;
let host: TestHost | undefined;

test.afterEach(async () => {
    await host?.close();
    host = undefined;
    await fake?.stop();
    fake = undefined;
});

async function connect(): Promise<{host: TestHost; fake: FakeBox}> {
    fake = new FakeBox({
        token: TOKEN,
        interfaces: ['HmIP-RF'],
        devices: {
            'HmIP-RF': [
                {
                    ADDRESS: DEVICE,
                    TYPE: 'HmIP-PS',
                    FIRMWARE: '1.4.8',
                    VERSION: 1,
                    CHILDREN: [`${DEVICE}:0`, `${DEVICE}:3`],
                    PARAMSETS: ['MASTER'],
                },
                {
                    ADDRESS: `${DEVICE}:0`,
                    TYPE: 'MAINTENANCE',
                    PARENT: DEVICE,
                    VERSION: 1,
                    PARAMSETS: ['MASTER', 'VALUES'],
                },
                {
                    ADDRESS: `${DEVICE}:3`,
                    TYPE: 'SWITCH_VIRTUAL_RECEIVER',
                    PARENT: DEVICE,
                    VERSION: 1,
                    PARAMSETS: ['MASTER', 'VALUES'],
                },
            ],
        },
        values: {
            [`HmIP-RF.${DEVICE}:0.UNREACH`]: {
                value: true,
                ts: '2026-09-30T06:00:00.000Z',
                lc: '2026-09-01T10:00:00.000Z',
                confirmed: true,
            },
            [`HmIP-RF.${DEVICE}:3.STATE`]: {
                value: true,
                ts: '2026-09-29T20:00:00.000Z',
                lc: '2026-09-29T19:00:00.000Z',
                confirmed: false,
                source: 'restored',
            },
        },
        descriptions: {
            [`HmIP-RF.${DEVICE}:0`]: {UNREACH: {TYPE: 'BOOL', OPERATIONS: 5}},
            [`HmIP-RF.${DEVICE}:3`]: {STATE: {TYPE: 'BOOL', OPERATIONS: 7}},
        },
        meta: {revision: 1, objects: {}, enums: {}},
    });
    const url = await fake.start();
    host = await startForTest();
    await host.backend!.request('config.set', {
        host: new URL(url).host,
        interfaces: ['HmIP-RF'],
        autoDetect: false,
        extraInterfaces: [],
        tls: false,
        rega: false,
        metaToken: TOKEN,
        callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0},
        language: 'en',
        writePaceMs: 0,
    } as never);
    return {host, fake};
}

test("the VALUES dialog says since when a value stands, from the system's store, and greys a restored one (task 82)", async ({
    page,
}) => {
    const {host} = await connect();
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${DEVICE}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${DEVICE}:3-VALUES`).click();

    const state = page.getByTestId('since-STATE');
    await expect(state).toHaveText('restored');
    await expect(state).toHaveAttribute('data-confirmed', 'false');
    await expect(state).toHaveAttribute('title', /Last change: .*\nLast report: .*\nRestored by the system/);
    await expect(state).toHaveAttribute('title', /The openccu-lite system's clock$/);
    // the value itself is still there, only greyed
    await expect(page.getByTestId('param-STATE').getByRole('checkbox')).toBeChecked();
});

test("a service message's Since is the system's last change of its datapoint (task 82)", async ({page}) => {
    const {host, fake} = await connect();
    await page.goto(`${host.url}#/HmIP-RF/messages`);
    // the device reports what the store already holds: the message dates from September 1st, not from now
    await expect.poll(() => fake.streamsOpened).toBeGreaterThan(0);
    fake.event('HmIP-RF', `${DEVICE}:0`, 'UNREACH', true);
    const since = page.getByTestId(`message-since-${DEVICE}:0-UNREACH`);
    await expect(since).toHaveAttribute('data-source', 'system');
    await expect(since).toHaveAttribute('title', 'Last changed, from the openccu-lite system');
    await expect(since).toContainText('2026');
    await expect(since).toContainText(new Date(Date.parse('2026-09-01T10:00:00.000Z')).toLocaleDateString('en'));
});
