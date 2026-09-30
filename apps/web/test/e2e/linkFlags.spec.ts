/**
 * B-86: rfd answers every device-internal link with `FLAGS: 1` (`SENDER_BROKEN`) - a switch actuator's own button on its
 * relay (`:1` → `:1`), a dimmer's real channel and its virtual ones (`:1` → `:2`, `:2` → `:1`) - although these links
 * work. The Links list marked all of them as defective. The mark and the toolbar's count stay for a link whose peer is
 * not a device of the interface (`@1A2B3C:14`, `@4D5E6F:1`), which rfd flags the same way.
 *
 * hm-simulator stores every link it makes with `FLAGS: 0`, so the links are seeded here with the flags rfd reports.
 */

import {startForTest, type TestHost} from 'homematic-manager';

import {BIDCOS_GATEWAY, BIDCOS_SWITCH, expect, SIMULATOR_FIXTURE, simulatorReady, test} from './fixtures.js';

const DIMMER = 'LEQ0000201';
const DIMMER_TYPE = 'HM-LC-Dim1TPBU-FM';

function dimmer(): unknown[] {
    const channel = (index: number, type: string) => ({
        ADDRESS: `${DIMMER}:${String(index)}`,
        TYPE: type,
        VERSION: 1,
        PARENT: DIMMER,
        PARENT_TYPE: DIMMER_TYPE,
        PARAMSETS: index === 0 ? ['MASTER', 'VALUES'] : ['MASTER', 'VALUES', 'LINK'],
        INDEX: index,
        ...(index === 0 ? {} : {DIRECTION: 2, LINK_SOURCE_ROLES: 'SWITCH', LINK_TARGET_ROLES: 'SWITCH'}),
    });
    return [
        {
            ADDRESS: DIMMER,
            TYPE: DIMMER_TYPE,
            VERSION: 1,
            FIRMWARE: '2.9',
            CHILDREN: [0, 1, 2, 3].map((index) => `${DIMMER}:${String(index)}`),
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 2,
            INTERFACE: BIDCOS_GATEWAY,
            ROAMING: 0,
        },
        channel(0, 'MAINTENANCE'),
        channel(1, 'DIMMER'),
        channel(2, 'VIRTUAL_DIMMER'),
        channel(3, 'VIRTUAL_DIMMER'),
    ];
}

const INTERNAL = [
    [`${BIDCOS_SWITCH}:1`, `${BIDCOS_SWITCH}:1`],
    [`${DIMMER}:1`, `${DIMMER}:1`],
    [`${DIMMER}:1`, `${DIMMER}:2`],
    [`${DIMMER}:2`, `${DIMMER}:1`],
    [`${DIMMER}:2`, `${DIMMER}:3`],
] as const;
const MISSING_SENDER = ['@1A2B3C:14', `${DIMMER}:1`] as const;
const MISSING_RECEIVER = [`${BIDCOS_SWITCH}:1`, '@4D5E6F:1'] as const;

function fixture(): Record<string, unknown> {
    const options = structuredClone(SIMULATOR_FIXTURE) as Record<string, unknown> & {
        devices: {rfd: {devices: unknown[]}};
        paramsetDescriptions: Record<string, unknown>;
        links?: Record<string, unknown[]>;
    };
    options.devices.rfd.devices.push(...dimmer());
    options.paramsetDescriptions = {
        ...options.paramsetDescriptions,
        [`BidCos-RF/${DIMMER_TYPE}/2.9/1//MASTER`]: {},
        [`BidCos-RF/${DIMMER_TYPE}/2.9/1/MAINTENANCE/VALUES`]: {},
        [`BidCos-RF/${DIMMER_TYPE}/2.9/1/DIMMER/MASTER`]: {},
        [`BidCos-RF/${DIMMER_TYPE}/2.9/1/DIMMER/VALUES`]: {},
        [`BidCos-RF/${DIMMER_TYPE}/2.9/1/VIRTUAL_DIMMER/MASTER`]: {},
        [`BidCos-RF/${DIMMER_TYPE}/2.9/1/VIRTUAL_DIMMER/VALUES`]: {},
    };
    const link = (sender: string, receiver: string, flags: number) => ({
        SENDER: sender,
        RECEIVER: receiver,
        FLAGS: flags,
        NAME: '',
        DESCRIPTION: '',
    });
    options.links = {
        rfd: [
            // what rfd answers: SENDER_BROKEN on every internal link (a lab HM-LC-Sw1, the maintainer's dimmers)
            ...INTERNAL.map(([sender, receiver]) => link(sender, receiver, 1)),
            link(...MISSING_SENDER, 1),
            link(...MISSING_RECEIVER, 2),
        ],
    };
    return options;
}

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

test('device-internal links carry no defect mark, links to a missing peer do (B-86)', async ({page}) => {
    host = await startForTest({
        simulator: true,
        simulatorOptions: fixture(),
        connection: {rega: true, language: 'en'},
    });
    await page.goto(`${host.url}#/BidCos-RF/links`);
    await expect(page.getByTestId('links-table')).toBeVisible();

    for (const [sender, receiver] of INTERNAL) {
        const row = page.locator(`[data-row-id="${sender}->${receiver}"]`);
        await expect(row).toBeVisible();
        await expect(row.locator('.hmm-link-broken')).toHaveCount(0);
    }
    await expect(page.locator(`[data-row-id="${MISSING_SENDER.join('->')}"] .hmm-link-broken`)).toHaveAttribute(
        'title',
        'SENDER_BROKEN',
    );
    await expect(page.locator(`[data-row-id="${MISSING_RECEIVER.join('->')}"] .hmm-link-broken`)).toHaveAttribute(
        'title',
        'RECEIVER_BROKEN',
    );
    await expect(page.getByTestId('links-defective')).toContainText('2');
});
