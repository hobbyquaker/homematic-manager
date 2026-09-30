/**
 * B-87: a BidCos remote's key linked to a switch actuator. The key's own LINK paramset (with the actuator as peer) holds
 * `EXPECT_AES` and `PEER_NEEDS_BURST`; ticking one of them in the link editor's sender section and pressing "Preview"
 * showed only the receiver's `putParamset(…, LINK, {})`, "nothing has changed", and never wrote the sender.
 */

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';

import {BIDCOS_GATEWAY, expect, simulatorReady, test} from './fixtures.js';

const REMOTE = 'LEQ0000111';
const SWITCH = 'LEQ0000112';
const SENDER = `${REMOTE}:1`;
const RECEIVER = `${SWITCH}:1`;

function device(address: string, type: string, channelType: string, roles: Record<string, string | number>): unknown[] {
    return [
        {
            ADDRESS: address,
            TYPE: type,
            VERSION: 1,
            FIRMWARE: '1.0',
            CHILDREN: [`${address}:0`, `${address}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 1,
            INTERFACE: BIDCOS_GATEWAY,
            ROAMING: 0,
        },
        {
            ADDRESS: `${address}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: address,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${address}:1`,
            TYPE: channelType,
            VERSION: 1,
            PARENT: address,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            INDEX: 1,
            ...roles,
        },
    ];
}

const BOOL = {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true};

const FIXTURE: Record<string, unknown> = {
    devices: {
        rfd: {
            devices: [
                ...device(REMOTE, 'HM-RC-4', 'KEY', {DIRECTION: 1, LINK_SOURCE_ROLES: 'SWITCH'}),
                ...device(SWITCH, 'HM-LC-Sw1-FM', 'SWITCH', {DIRECTION: 2, LINK_TARGET_ROLES: 'SWITCH'}),
            ],
        },
    },
    config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    paramsetDescriptions: {
        'BidCos-RF/HM-RC-4/1.0/1//MASTER': {},
        'BidCos-RF/HM-RC-4/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-RC-4/1.0/1/KEY/MASTER': {},
        'BidCos-RF/HM-RC-4/1.0/1/KEY/VALUES': {},
        'BidCos-RF/HM-RC-4/1.0/1/KEY/LINK': {PEER_NEEDS_BURST: BOOL, EXPECT_AES: BOOL},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1//MASTER': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/SWITCH/MASTER': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/SWITCH/VALUES': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/SWITCH/LINK': {
            SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, UNIT: 's', MIN: 0, MAX: 108000, DEFAULT: 0},
        },
    },
    interfaces: {rfd: {configPendingMode: 'bidcos'}},
};

type Sim = {
    callMethod(iface: string, method: string, params?: unknown[]): unknown;
    getWriteLog(): Array<{address?: string; paramset?: string; values: Record<string, unknown>}>;
};

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

async function openLink(page: Page): Promise<Sim> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(FIXTURE),
        connection: {rega: false, language: 'en'},
    });
    const sim = host.simulator as Sim;
    sim.callMethod('rfd', 'addLink', [SENDER, RECEIVER, '', '']);
    await page.goto(`${host.url}#/BidCos-RF/links`);
    await page.locator(`[data-row-id="${SENDER}->${RECEIVER}"]`).click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');
    await expect(page.getByTestId('link-sender-params').getByTestId('param-EXPECT_AES')).toBeVisible();
    return sim;
}

test('a sender-only change is previewed and written to the sender (B-87)', async ({page}) => {
    const sim = await openLink(page);
    await page.getByTestId('link-sender-params').getByTestId('param-EXPECT_AES').getByRole('checkbox').check();

    await page.getByTestId('link-preview').click();
    await expect(page.getByTestId('write-preview')).toHaveAttribute('open', '');
    await expect(page.getByTestId('preview-empty')).toHaveCount(0);
    await expect(page.getByTestId('preview-sender-EXPECT_AES')).toBeVisible();
    await expect(page.getByTestId('preview-call-0')).toHaveText(
        `putParamset(${SENDER}←${RECEIVER}, LINK, {"EXPECT_AES":true})`,
    );
    await expect(page.getByTestId('preview-call-1')).toHaveCount(0);

    await page.getByTestId('write-confirm').click();
    // written, read back as sent: the preview closes and the link editor lists the sender's result
    await expect(page.getByTestId('link-results')).toContainText(SENDER);
    await expect(page.getByTestId('link-results')).not.toContainText(RECEIVER);
    expect(sim.callMethod('rfd', 'getParamset', [SENDER, RECEIVER])).toMatchObject({EXPECT_AES: true});
    // nothing was sent to the receiver
    expect(sim.getWriteLog().filter((entry) => entry.address === RECEIVER)).toEqual([]);
    // the form now shows the stored value, no longer as an edit
    await expect(page.getByTestId('link-sender-params').getByTestId('param-EXPECT_AES')).not.toHaveClass(
        /hmm-param-changed/,
    );
    await expect(
        page.getByTestId('link-sender-params').getByTestId('param-EXPECT_AES').getByRole('checkbox'),
    ).toBeChecked();
});

test('a change on both ends is previewed as two calls and written to both (B-87)', async ({page}) => {
    const sim = await openLink(page);
    await page.getByTestId('link-expert').check();
    await page.getByTestId('link-sender-params').getByTestId('param-PEER_NEEDS_BURST').getByRole('checkbox').check();
    await page.getByTestId('link-receiver-params').getByTestId('param-SHORT_ON_TIME').getByRole('spinbutton').fill('2');

    await page.getByTestId('link-preview').click();
    await expect(page.getByTestId('preview-call-0')).toContainText(`putParamset(${RECEIVER}←${SENDER}, LINK,`);
    await expect(page.getByTestId('preview-call-1')).toHaveText(
        `putParamset(${SENDER}←${RECEIVER}, LINK, {"PEER_NEEDS_BURST":true})`,
    );
    await page.getByTestId('write-confirm').click();
    await expect(page.getByTestId('link-results')).toContainText(SENDER);
    await expect(page.getByTestId('link-results')).toContainText(RECEIVER);
    expect(sim.callMethod('rfd', 'getParamset', [SENDER, RECEIVER])).toMatchObject({PEER_NEEDS_BURST: true});
    expect(sim.callMethod('rfd', 'getParamset', [RECEIVER, SENDER])).toMatchObject({SHORT_ON_TIME: 2});
});
