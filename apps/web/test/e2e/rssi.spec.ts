/**
 * #161: the eight steps of the RSSI pill in a real browser, through the whole stack - hm-simulator's
 * `rssiInfo`, the backend, the Funk grid - in the light and in the dark theme.
 *
 * `theme.test.ts` asserts the tokens and their contrast against the stylesheet, and `radio.test.ts`
 * the markup in jsdom, which resolves neither `var()` nor a layout. What only a browser can say is
 * that the fill and the ink really arrive at the pill in both themes, and that the pill fits the
 * `← dBm` / `→ dBm` columns without being cut off.
 *
 * Four BidCos switches carry the eight bands as their receive/send pairs: the fixture's one plus
 * three added here, each with `RSSI_PEER` / `RSSI_DEVICE` on its maintenance channel, which is where
 * hm-simulator's `rssiInfo` takes the levels from. The two screenshots per theme are attachments of
 * the run to look at (the issue asked to judge both themes), not a comparison.
 */

import {BIDCOS_GATEWAY, BIDCOS_SWITCH, expect, simulatorReady, test} from './fixtures.js';
import type {Simulator} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

const SWITCHES = [BIDCOS_SWITCH, 'LEQ0000002', 'LEQ0000003', 'LEQ0000004'] as const;

interface Reading {
    readonly device: (typeof SWITCHES)[number];
    readonly direction: 'rx' | 'tx';
    readonly value: number;
    readonly step: number;
    readonly bars: number;
    readonly label: string;
    /** The step's fill and ink as the browser reports them. */
    readonly fill: string;
    readonly ink: string;
}

const DARK_INK = 'rgb(26, 26, 26)';

/** One reading per step; two of them on a lower edge, which belongs to its own band. */
const READINGS: readonly Reading[] = [
    {
        device: SWITCHES[0],
        direction: 'rx',
        value: -25,
        step: 1,
        bars: 4,
        label: 'Very good (maximum)',
        fill: 'rgb(0, 255, 102)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[0],
        direction: 'tx',
        value: -40,
        step: 2,
        bars: 4,
        label: 'Very good',
        fill: 'rgb(0, 200, 68)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[1],
        direction: 'rx',
        value: -45,
        step: 3,
        bars: 4,
        label: 'Good',
        fill: 'rgb(72, 199, 56)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[1],
        direction: 'tx',
        value: -58,
        step: 4,
        bars: 3,
        label: 'Good (normal operation)',
        fill: 'rgb(130, 199, 56)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[2],
        direction: 'rx',
        value: -65,
        step: 5,
        bars: 3,
        label: 'Sufficient',
        fill: 'rgb(184, 199, 56)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[2],
        direction: 'tx',
        value: -75,
        step: 6,
        bars: 2,
        label: 'Sufficient to weak',
        fill: 'rgb(253, 216, 53)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[3],
        direction: 'rx',
        value: -90,
        step: 7,
        bars: 1,
        label: 'Poor',
        fill: 'rgb(251, 140, 0)',
        ink: DARK_INK,
    },
    {
        device: SWITCHES[3],
        direction: 'tx',
        value: -97,
        step: 8,
        bars: 0,
        label: 'Critical',
        fill: 'rgb(211, 47, 47)',
        ink: 'rgb(255, 255, 255)',
    },
];

/** The fixture's switch under another address, with its maintenance and switch channel. */
function switchDescriptions(address: string, rfAddress: number): unknown[] {
    const channel = (index: number, type: string, paramsets: string[]): Record<string, unknown> => ({
        ADDRESS: `${address}:${String(index)}`,
        TYPE: type,
        VERSION: 1,
        PARENT: address,
        PARENT_TYPE: 'HM-LC-Sw1-Pl',
        PARAMSETS: paramsets,
        INDEX: index,
    });
    return [
        {
            ADDRESS: address,
            TYPE: 'HM-LC-Sw1-Pl',
            VERSION: 1,
            FIRMWARE: '2.8',
            CHILDREN: [`${address}:0`, `${address}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: rfAddress,
            INTERFACE: BIDCOS_GATEWAY,
            ROAMING: 0,
        },
        channel(0, 'MAINTENANCE', ['MASTER', 'VALUES']),
        {...channel(1, 'SWITCH', ['MASTER', 'VALUES', 'LINK']), LINK_TARGET_ROLES: 'SWITCH', DIRECTION: 2},
    ];
}

function seed(sim: Simulator): void {
    SWITCHES.slice(1).forEach((address, index) => {
        sim.addDevice('rfd', ...switchDescriptions(address, index + 2));
    });
    for (const reading of READINGS) {
        // rssiInfo answers [RSSI_PEER, RSSI_DEVICE] - what the device receives, what it sends
        const datapoint = reading.direction === 'rx' ? 'RSSI_PEER' : 'RSSI_DEVICE';
        sim.fireEvent('rfd', `${reading.device}:0`, datapoint, reading.value);
    }
}

for (const theme of ['light', 'dark'] as const) {
    test(`the Funk grid draws a pill per step, with fill, ink, bars and tooltip, in the ${theme} theme`, async ({
        page,
        host,
        sim,
    }, testInfo) => {
        seed(sim);
        await page.emulateMedia({colorScheme: theme});
        await page.addInitScript((value) => {
            window.localStorage.setItem('hmm.theme', value);
        }, theme);
        await page.goto(`${host.url}#/BidCos-RF/rssi`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const table = page.getByTestId('radio-table');
        // the unit is in the column heads, and only there
        const heads = await table.getByRole('columnheader').allTextContents();
        expect(heads.map((head) => head.trim())).toEqual(expect.arrayContaining(['← dBm', '→ dBm']));

        for (const reading of READINGS) {
            const name = `${String(reading.value)} dBm`;
            const pill = page.getByTestId(`rssi-${reading.device}-${BIDCOS_GATEWAY}-${reading.direction}`);
            await expect(pill, name).toHaveAttribute('data-rssi', String(reading.step));
            await expect(pill, name).toHaveAttribute('data-bars', String(reading.bars));
            await expect(pill, name).toHaveText(String(reading.value));
            await expect(pill, name).toHaveAttribute('title', `${name} · ${reading.label}`);
            await expect(pill.locator('.hmm-rssi-bar'), name).toHaveCount(4);
            await expect(pill.locator('.hmm-rssi-bar:not(.hmm-rssi-bar-off)'), name).toHaveCount(reading.bars);

            const painted = await pill.evaluate((element) => {
                const style = getComputedStyle(element);
                const cell = element.closest('.hmm-td')!.getBoundingClientRect();
                const box = element.getBoundingClientRect();
                return {
                    fill: style.backgroundColor,
                    ink: style.color,
                    width: box.width,
                    inside: box.left >= cell.left && box.right <= cell.right,
                };
            });
            expect(painted.fill, name).toBe(reading.fill);
            expect(painted.ink, name).toBe(reading.ink);
            // arrangement B is narrower than the 62 px pill with its unit, and nothing of it is cut off
            expect(painted.width, name).toBeGreaterThanOrEqual(56);
            expect(painted.width, name).toBeLessThanOrEqual(62);
            expect(painted.inside, `${name} is cut off by its cell`).toBe(true);
        }

        await page.screenshot({path: testInfo.outputPath(`funk-${theme}.png`)});
        await table.screenshot({path: testInfo.outputPath(`funk-${theme}-grid.png`)});
    });
}
