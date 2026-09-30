/**
 * B-82 on the maintainer's Keymatic link: a remote's key (`KEY`) to a Keymatic (`KEYMATIC`), profile "unlock door".
 * The WebUI's form draws *Lock automatically* as the DOOR_LOCK_TIME combo box, whose entries `etc/options.tcl` writes as
 * `${after} 1$m` - a WebUI label and a text. hmm kept only the label and listed "after" six times; the entries are the
 * WebUI's templates now, rendered from the string table in the current language.
 */

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';

import {BIDCOS_GATEWAY, expect, simulatorReady, test} from './fixtures.js';

const REMOTE = 'LEQ0000201';
const KEYMATIC = 'LEQ0000202';
const SENDER = `${REMOTE}:1`;
const RECEIVER = `${KEYMATIC}:1`;

function device(address: string, type: string, channelType: string, direction: number): unknown[] {
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
            DIRECTION: direction,
        },
    ];
}

/** A BidCos time as rfd describes it: seconds, a range, and 111600 as "not used" above it. */
const TIME = {
    TYPE: 'FLOAT',
    OPERATIONS: 7,
    FLAGS: 1,
    UNIT: 's',
    MIN: 0,
    MAX: 108000,
    DEFAULT: 111600,
    SPECIAL: [{ID: 'NOT_USED', VALUE: 111600}],
};

const FIXTURE: Record<string, unknown> = {
    devices: {
        rfd: {
            devices: [...device(REMOTE, 'HM-RC-4-2', 'KEY', 1), ...device(KEYMATIC, 'HM-Sec-Key', 'KEYMATIC', 2)],
        },
        hmip: {devices: []},
    },
    config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    paramsetDescriptions: {
        'BidCos-RF/HM-RC-4-2/1.0/1//MASTER': {},
        'BidCos-RF/HM-RC-4-2/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-RC-4-2/1.0/1/KEY/MASTER': {},
        'BidCos-RF/HM-RC-4-2/1.0/1/KEY/VALUES': {},
        'BidCos-RF/HM-RC-4-2/1.0/1/KEY/LINK': {},
        'BidCos-RF/HM-Sec-Key/1.0/1//MASTER': {},
        'BidCos-RF/HM-Sec-Key/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-Sec-Key/1.0/1/KEYMATIC/MASTER': {},
        'BidCos-RF/HM-Sec-Key/1.0/1/KEYMATIC/VALUES': {},
        'BidCos-RF/HM-Sec-Key/1.0/1/KEYMATIC/LINK': {
            UI_HINT: {TYPE: 'STRING', OPERATIONS: 7, FLAGS: 1, DEFAULT: ''},
            SHORT_ON_TIME: TIME,
            LONG_ON_TIME: TIME,
        },
    },
    rega: {
        port: 0,
        listenAddress: '127.0.0.1',
        channels: [
            {id: 6100, address: REMOTE, name: 'RCKeymatic'},
            {id: 6101, address: SENDER, name: 'RCKeymatic:1'},
            {id: 6110, address: KEYMATIC, name: 'Keymatic'},
            {id: 6111, address: RECEIVER, name: 'Keymatic:1'},
        ],
    },
    interfaces: {rfd: {configPendingMode: 'bidcos'}},
};

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

/** The stack in `language`, the link made as the WebUI makes it (profile 1 in `UI_HINT`), its editor open. */
async function openLink(page: Page, language: 'de' | 'en'): Promise<void> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(FIXTURE),
        connection: {rega: true, language},
    });
    const sim = host.simulator as {callMethod(iface: string, method: string, params?: unknown[]): unknown};
    sim.callMethod('rfd', 'addLink', [SENDER, RECEIVER, '', '']);
    sim.callMethod('rfd', 'putParamset', [RECEIVER, SENDER, {UI_HINT: '1'}]);
    await page.goto(`${host.url}#/BidCos-RF/links`);
    await page.locator(`[data-row-id="${SENDER}->${RECEIVER}"]`).click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');
}

for (const [language, words] of [
    [
        'de',
        {
            list: ['nach 1min', 'nach 3min', 'nach 5min', 'nach 10min', 'nach 15min', 'nach 1h', 'Inaktiv'],
            enter: 'Wert eingeben',
        },
    ],
    [
        'en',
        {
            list: ['after 1min', 'after 3min', 'after 5min', 'after 10min', 'after 15min', 'after 1h', 'Inactive'],
            enter: 'Enter value',
        },
    ],
] as const) {
    test(`the Keymatic's "Lock automatically" lists the WebUI's texts, each once (B-82, ${language})`, async ({
        page,
    }) => {
        await openLink(page, language);
        await expect(page.getByTestId('link-easy-form')).toBeVisible();
        const lock = page.getByTestId('easy-preset-select-SHORT_ON_TIME');
        await expect(lock).toBeEnabled();
        await expect
            .poll(() =>
                lock.evaluate((select: HTMLSelectElement) =>
                    [...select.options].map((option) => option.textContent?.trim() ?? ''),
                ),
            )
            .toEqual([...words.list, words.enter]);
        // the profile's 111600 is where it starts: "inactive"
        await expect
            .poll(() => lock.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent?.trim()))
            .toBe(words.list.at(-1));
    });
}
