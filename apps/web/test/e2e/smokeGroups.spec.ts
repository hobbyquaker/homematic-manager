/**
 * Task 58: smoke groups in the device list, against the real backend and hm-simulator.
 *
 * The stack of this file has its own device set - two HmIP-SWSD whose smoke channel's MASTER the
 * simulator describes with `GROUP_1` … `GROUP_8`, and two BidCos HM-Sec-SD-2 in one team that rfd
 * lists as the pseudo device `*NEQ0448334` - so the shared fixture's device counts stay what the
 * other specs expect.
 *
 * The HmIP side is exercised end to end: the group is created from the toolbar, the simulator's
 * write log shows one MASTER write of exactly `{GROUP_1: true}` per detector, the row appears with
 * what the interface holds, and a member taken out of it is one write of `{GROUP_1: false}`. The
 * BidCos side is read-only here: hm-simulator 1.0 has no `setTeam`, so the team row, its members
 * and the detectors' team column are checked, and the members dialog is opened, but not applied.
 */

import {startForTest, type TestHost} from 'homematic-manager';

import {BIDCOS_GATEWAY, expect, simulatorReady, test} from './fixtures.js';

const SWSD_1 = '0001D3C9000001';
const SWSD_2 = '0001D3C9000002';
const SD_1 = 'NEQ0448334';
const SD_2 = 'NEQ0448077';
const TEAM = `*${SD_1}`;

const BOOL = {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true};

function swsd(serial: string): unknown[] {
    return [
        {
            ADDRESS: serial,
            TYPE: 'HmIP-SWSD',
            VERSION: 1,
            FIRMWARE: '1.0.12',
            CHILDREN: [`${serial}:0`, `${serial}:1`],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: `${serial}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: 'HmIP-SWSD',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${serial}:1`,
            TYPE: 'SMOKE_DETECTOR',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: 'HmIP-SWSD',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 1,
            DIRECTION: 1,
        },
    ];
}

/** A BidCos detector in the team, with `TEAM` and `TEAM_TAG` as rfd sends them. */
function secSd(serial: string): unknown[] {
    return [
        {
            ADDRESS: serial,
            TYPE: 'HM-Sec-SD-2',
            VERSION: 1,
            FIRMWARE: '1.0',
            CHILDREN: [`${serial}:0`, `${serial}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 1,
            INTERFACE: BIDCOS_GATEWAY,
            ROAMING: 0,
        },
        {
            ADDRESS: `${serial}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: 'HM-Sec-SD-2',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${serial}:1`,
            TYPE: 'SMOKE_DETECTOR',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: 'HM-Sec-SD-2',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 1,
            DIRECTION: 1,
            TEAM: `${TEAM}:1`,
            TEAM_TAG: 'smoke_detector',
        },
    ];
}

const SMOKE_FIXTURE: Record<string, unknown> = {
    devices: {
        rfd: {
            devices: [
                ...secSd(SD_1),
                ...secSd(SD_2),
                // the team, as rfd lists it: `*` plus the serial of the detector it came from
                {
                    ADDRESS: TEAM,
                    TYPE: 'HM-Sec-SD-2-Team',
                    VERSION: 1,
                    FIRMWARE: '1.0',
                    CHILDREN: [`${TEAM}:0`, `${TEAM}:1`],
                    PARAMSETS: ['MASTER'],
                    FLAGS: 9,
                },
                {
                    ADDRESS: `${TEAM}:0`,
                    TYPE: 'MAINTENANCE',
                    VERSION: 1,
                    PARENT: TEAM,
                    PARENT_TYPE: 'HM-Sec-SD-2-Team',
                    PARAMSETS: ['MASTER', 'VALUES'],
                    INDEX: 0,
                },
                {
                    ADDRESS: `${TEAM}:1`,
                    TYPE: 'SMOKE_DETECTOR_TEAM_V2',
                    VERSION: 1,
                    PARENT: TEAM,
                    PARENT_TYPE: 'HM-Sec-SD-2-Team',
                    PARAMSETS: ['MASTER', 'VALUES'],
                    INDEX: 1,
                    TEAM_TAG: 'smoke_detector',
                    TEAM_CHANNELS: [`${SD_2}:1`, `${SD_1}:1`],
                },
            ],
        },
        hmip: {devices: [...swsd(SWSD_1), ...swsd(SWSD_2)]},
    },
    config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    paramsetDescriptions: {
        'HmIP-RF/HmIP-SWSD/1.0.12/1//MASTER': {},
        'HmIP-RF/HmIP-SWSD/1.0.12/1/MAINTENANCE/VALUES': {
            CONFIG_PENDING: {...BOOL, OPERATIONS: 5, FLAGS: 9},
            UNREACH: {...BOOL, OPERATIONS: 5, FLAGS: 9},
        },
        // the newer smoke channel: REPEAT_ENABLE and the eight groups, as the WebUI's checkboxes
        'HmIP-RF/HmIP-SWSD/1.0.12/1/SMOKE_DETECTOR/MASTER': Object.fromEntries([
            ['REPEAT_ENABLE', {...BOOL, DEFAULT: true}],
            ...Array.from({length: 8}, (_, i) => [`GROUP_${String(i + 1)}`, BOOL]),
        ]),
        'HmIP-RF/HmIP-SWSD/1.0.12/1/SMOKE_DETECTOR/VALUES': {
            SMOKE_DETECTOR_ALARM_STATUS: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, DEFAULT: 0, MIN: 0, MAX: 3},
        },
        'BidCos-RF/HM-Sec-SD-2/1.0/1//MASTER': {},
        'BidCos-RF/HM-Sec-SD-2/1.0/1/MAINTENANCE/VALUES': {UNREACH: {...BOOL, OPERATIONS: 5, FLAGS: 9}},
        'BidCos-RF/HM-Sec-SD-2/1.0/1/SMOKE_DETECTOR/MASTER': {},
        'BidCos-RF/HM-Sec-SD-2/1.0/1/SMOKE_DETECTOR/VALUES': {STATE: {...BOOL, OPERATIONS: 5}},
        'BidCos-RF/HM-Sec-SD-2-Team/1.0/1//MASTER': {},
        'BidCos-RF/HM-Sec-SD-2-Team/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-Sec-SD-2-Team/1.0/1/SMOKE_DETECTOR_TEAM_V2/MASTER': {},
        'BidCos-RF/HM-Sec-SD-2-Team/1.0/1/SMOKE_DETECTOR_TEAM_V2/VALUES': {STATE: {...BOOL, OPERATIONS: 5}},
    },
    rega: {
        port: 0,
        listenAddress: '127.0.0.1',
        channels: [
            {id: 4000, address: SD_1, name: 'Rauchmelder Flur'},
            {id: 4001, address: `${SD_1}:1`, name: 'Rauchmelder Flur:1'},
            {id: 4010, address: SD_2, name: 'Rauchmelder Küche'},
            {id: 4011, address: `${SD_2}:1`, name: 'Rauchmelder Küche:1'},
            {id: 4020, address: TEAM, name: 'Rauchmelder Gruppe'},
            {id: 5000, address: SWSD_1, name: 'Rauchmelder Schlafzimmer'},
            {id: 5001, address: `${SWSD_1}:1`, name: 'Rauchmelder Schlafzimmer:1'},
            {id: 5010, address: SWSD_2, name: 'Rauchmelder Kinderzimmer'},
            {id: 5011, address: `${SWSD_2}:1`, name: 'Rauchmelder Kinderzimmer:1'},
        ],
    },
    interfaces: {hmip: {configPendingMode: 'hmip'}, rfd: {configPendingMode: 'bidcos'}},
};

let host: TestHost;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.beforeEach(async () => {
    host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(SMOKE_FIXTURE),
        connection: {rega: true, language: 'en'},
    });
});

test.afterEach(async () => {
    await host.close();
});

/** The Smoke group cell of a row: the sixth cell of a device row, the fifth of a channel row. */
function groupCell(page: import('@playwright/test').Page, address: string) {
    return page.locator(`[data-row-id="${address}"] [role=gridcell]`).nth(address.includes(':') ? 4 : 5);
}

test('a BidCos team is a row with its detectors under it, and the detectors name their team', async ({page}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    const team = page.locator(`[data-row-id="${TEAM}"]`);
    await expect(team).toBeVisible();
    await expect(team).toContainText('Rauchmelder Gruppe');
    await expect(team).toContainText('HM-Sec-SD-2-Team');
    await expect(groupCell(page, TEAM)).toContainText('2 detectors');
    await expect(groupCell(page, SD_1)).toHaveText('Rauchmelder Gruppe');
    await expect(groupCell(page, SD_2)).toHaveText('Rauchmelder Gruppe');

    await team.getByRole('button', {name: 'Expand row'}).click();
    // the team's own channels, then the member detectors' smoke channels
    await expect(page.locator(`[data-row-id="${TEAM}:1"]`)).toContainText('SMOKE_DETECTOR_TEAM_V2');
    await expect(page.locator(`[data-row-id="${SD_1}:1"]`)).toContainText('Rauchmelder Flur:1');
    await expect(page.locator(`[data-row-id="${SD_2}:1"]`)).toContainText('Rauchmelder Küche:1');

    // the members dialog from the row: both ticked, nothing to apply yet. hm-simulator 1.0 has
    // no setTeam, so the write itself is the unit tests' and the maintainer's real detectors'.
    await page.getByTestId(`smoke-group-members-${TEAM}`).click();
    const dialog = page.getByTestId('smoke-group-dialog');
    await expect(dialog).toContainText('Team: Rauchmelder Gruppe');
    await expect(dialog.getByTestId(`smoke-group-member-${SD_1}:1`)).toBeChecked();
    await expect(dialog.getByTestId(`smoke-group-member-${SD_2}:1`)).toBeChecked();
    await expect(dialog.getByTestId('smoke-group-apply')).toBeDisabled();
    // New is for HmIP: rfd makes the teams itself
    await expect(page.getByTestId('devices-smoke-group-new')).toBeDisabled();
});

test('an HmIP smoke group is created from the toolbar with one GROUP_n write per detector, and shrinks the same way', async ({
    page,
}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await expect(page.locator(`[data-row-id="${SWSD_1}"]`)).toBeVisible();
    // nobody is in a group yet: no group row, no Smoke group column
    await expect(page.locator('[data-row-id="*GROUP_1"]')).toHaveCount(0);
    await expect(page.getByRole('columnheader', {name: 'Smoke group'})).toHaveCount(0);

    const newButton = page.getByTestId('devices-smoke-group-new');
    await expect(newButton).toBeEnabled();
    await newButton.click();
    const dialog = page.getByTestId('smoke-group-dialog');
    await expect(dialog).toContainText('Smoke group 1');
    await dialog.getByTestId(`smoke-group-member-${SWSD_1}:1`).check();
    await dialog.getByTestId(`smoke-group-member-${SWSD_2}:1`).check();
    await dialog.getByTestId('smoke-group-apply').click();
    await expect(dialog).toBeHidden();

    // the row appears with what the interface reports, and the column with it
    const group = page.locator('[data-row-id="*GROUP_1"]');
    await expect(group).toBeVisible();
    await expect(group).toContainText('Smoke group 1');
    await expect(groupCell(page, '*GROUP_1')).toContainText('2 detectors');
    await expect(groupCell(page, SWSD_1)).toHaveText('Smoke group 1');
    await expect(groupCell(page, SWSD_2)).toHaveText('Smoke group 1');
    await group.getByRole('button', {name: 'Expand row'}).click();
    await expect(page.locator(`[data-row-id="${SWSD_1}:1"]`)).toContainText('Rauchmelder Schlafzimmer:1');

    // exactly one MASTER write per detector, carrying exactly the one parameter that changed
    const writes = host.simulator.getWriteLog() as {
        address: string;
        paramset: string;
        values: Record<string, unknown>;
    }[];
    expect(writes.map((write) => [write.address, write.paramset, write.values])).toEqual([
        [`${SWSD_1}:1`, 'MASTER', {GROUP_1: true}],
        [`${SWSD_2}:1`, 'MASTER', {GROUP_1: true}],
    ]);

    // one leaves from the group's row: one write of GROUP_1 false, and the count follows
    await page.getByTestId('smoke-group-members-*GROUP_1').click();
    await dialog.getByTestId(`smoke-group-member-${SWSD_2}:1`).uncheck();
    await dialog.getByTestId('smoke-group-apply').click();
    await expect(dialog).toBeHidden();
    await expect(groupCell(page, '*GROUP_1')).toContainText('1 detector');
    await expect(groupCell(page, SWSD_2)).toHaveText('');
    const after = host.simulator.getWriteLog() as {address: string; values: Record<string, unknown>}[];
    expect(after).toHaveLength(3);
    expect(after[2]).toMatchObject({address: `${SWSD_2}:1`, values: {GROUP_1: false}});
});
