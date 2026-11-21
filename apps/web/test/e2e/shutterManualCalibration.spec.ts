/**
 * Task 122, end to end: the manual calibration of the end positions of an HmIP tubular motor, in the VALUES dialog
 * of its `SHUTTER_TRANSMITTER` channel, where the CCU's WebUI has its "Calibration of the end positions" button on the
 * channel's operating page.
 *
 * The device is an HmIP-M-TD15 **derived from the WebUI's sources** (packages/ui/test/fixtures/hmipMTd15.ts says
 * from what): no captured description exists, hm-simulator has none, the lab has no such motor. hm-simulator stores
 * the datapoints and moves no motor, so the device's part is played here: every `putParamset VALUES` is recorded as
 * it arrives, saving a position sets its flag on `:0` (and the event goes out, as from the device), deleting clears
 * both.
 */

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';
import type HmSim from 'hm-simulator/sim.mjs';

import {
    HMIP_M_TD15,
    HMIP_M_TD15_MAINTENANCE_VALUES,
    HMIP_M_TD15_SHUTTER_VALUES,
} from '../../../../packages/ui/test/fixtures/hmipMTd15.js';
import {SIMULATOR_FIXTURE, expect, simulatorReady, test, type Simulator} from './fixtures.js';

const MOTOR = '00AA1A0000TD01';
const SHUTTER = `${MOTOR}:${String(HMIP_M_TD15.channel)}`;
const MAINTENANCE = `${MOTOR}:0`;
const TOP = 'MANUAL_SELF_CALIBRATION_TOP_POS_SET';
const BOTTOM = 'MANUAL_SELF_CALIBRATION_BOTTOM_POS_SET';

function motor(): HmSim.DeviceDescription[] {
    const channel = (index: number, type: string): HmSim.DeviceDescription =>
        ({
            ADDRESS: `${MOTOR}:${String(index)}`,
            TYPE: type,
            VERSION: HMIP_M_TD15.version,
            PARENT: MOTOR,
            PARENT_TYPE: HMIP_M_TD15.type,
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: index,
        }) as HmSim.DeviceDescription;
    return [
        {
            ADDRESS: MOTOR,
            TYPE: HMIP_M_TD15.type,
            VERSION: HMIP_M_TD15.version,
            FIRMWARE: HMIP_M_TD15.firmware,
            CHILDREN: [MAINTENANCE, SHUTTER],
            PARAMSETS: ['MASTER'],
        } as HmSim.DeviceDescription,
        channel(0, 'MAINTENANCE'),
        channel(HMIP_M_TD15.channel, 'SHUTTER_TRANSMITTER'),
    ];
}

function fixture(): Record<string, unknown> {
    const base = structuredClone(SIMULATOR_FIXTURE) as Record<string, unknown> & {
        devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
        paramsetDescriptions: Record<string, unknown>;
    };
    base.devices['hmip'] = {devices: [...(base.devices['hmip']?.devices ?? []), ...motor()]};
    const prefix = `HmIP-RF/${HMIP_M_TD15.type}/${HMIP_M_TD15.firmware}/${String(HMIP_M_TD15.version)}`;
    base.paramsetDescriptions = {
        ...base.paramsetDescriptions,
        [`${prefix}//MASTER`]: {},
        [`${prefix}/MAINTENANCE/MASTER`]: {},
        [`${prefix}/MAINTENANCE/VALUES`]: HMIP_M_TD15_MAINTENANCE_VALUES,
        [`${prefix}/SHUTTER_TRANSMITTER/MASTER`]: {},
        [`${prefix}/SHUTTER_TRANSMITTER/VALUES`]: HMIP_M_TD15_SHUTTER_VALUES,
    };
    return base;
}

let host: TestHost | undefined;
/** Every `putParamset VALUES` the shutter channel received, in order. */
let commands: Record<string, unknown>[] = [];

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

/** Starts the stack and plays the motor's part on the simulator (see the note at the top). */
async function start(flags: {top?: boolean; bottom?: boolean} = {}): Promise<Simulator> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: fixture(),
        connection: {rega: true, language: 'en'},
    });
    const sim = host.simulator as Simulator;
    commands = [];
    sim.setValue('hmip', MAINTENANCE, TOP, flags.top ?? false, {internal: true});
    sim.setValue('hmip', MAINTENANCE, BOTTOM, flags.bottom ?? false, {internal: true});
    const putParamset = sim.putParamset.bind(sim);
    sim.putParamset = (iface, address, key, set) => {
        const result = putParamset(iface, address, key, set);
        if (address === SHUTTER && key === 'VALUES') {
            commands.push({...set});
            switch (set['MANUAL_SELF_CALIBRATION']) {
                case 0:
                    sim.setValue('hmip', MAINTENANCE, TOP, false, {internal: true});
                    sim.setValue('hmip', MAINTENANCE, BOTTOM, false, {internal: true});
                    break;
                case 1:
                    sim.setValue('hmip', MAINTENANCE, TOP, true, {internal: true});
                    break;
                case 2:
                    sim.setValue('hmip', MAINTENANCE, BOTTOM, true, {internal: true});
                    break;
            }
        }
        return result;
    };
    return sim;
}

async function openValues(page: Page): Promise<void> {
    await page.goto(`${host?.url ?? ''}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${MOTOR}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${SHUTTER}-VALUES`).click();
    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');
}

const steps = (): unknown[] => commands.map((command) => command['MANUAL_SELF_CALIBRATION']);

test('a whole calibration: up, save the top, down, save the bottom - Stop in the same box throughout', async ({
    page,
}) => {
    await start();
    await openValues(page);

    const row = page.getByTestId('shutter-manual-calibration');
    await expect(row).toHaveAttribute('data-state', 'uncalibrated');
    await expect(page.getByTestId('shutter-manual-calibration-status')).toContainText(
        'The tubular motor therefore cannot be used.',
    );
    expect(commands).toEqual([]);

    await page.getByTestId('shutter-manual-calibration-open').click();
    const dialog = page.getByTestId('shutter-manual-calibration-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.getByRole('alert')).toContainText('The motor moves as soon as a movement button is pressed.');
    await expect(page.getByTestId('shutter-manual-calibration-target')).toContainText(SHUTTER);
    const step = page.getByTestId('shutter-manual-calibration-step');
    await expect(step).toHaveAttribute('data-step', 'top');
    const stop = page.getByTestId('shutter-manual-calibration-stop');
    const stopBox = await stop.boundingBox();

    await page.getByTestId('shutter-manual-calibration-reverse').click();
    await page.getByTestId('shutter-manual-calibration-seconds').fill('5');
    await page.getByTestId('shutter-manual-calibration-up-duration').click();
    await expect.poll(steps).toEqual([3, 6]);
    expect(commands[1]).toEqual({
        MANUAL_SELF_CALIBRATION: 6,
        MANUAL_SELF_CALIBRATION_LEVEL: 1,
        MANUAL_SELF_CALIBRATION_DURATION_VALUE: 5,
        MANUAL_SELF_CALIBRATION_DURATION_UNIT: 0,
    });
    await expect(page.getByTestId('shutter-manual-calibration-last')).toHaveText('Up for 5 s.');

    await page.getByTestId('shutter-manual-calibration-up-short').click();
    await page.getByTestId('shutter-manual-calibration-save-top').click();
    await expect(step).toHaveAttribute('data-step', 'bottom');
    await expect(page.getByTestId('shutter-manual-calibration-top')).toHaveText('Upper end position set: Yes');
    expect(await stop.boundingBox()).toEqual(stopBox);

    await page.getByTestId('shutter-manual-calibration-down-long').click();
    await page.getByTestId('shutter-manual-calibration-save-bottom').click();
    await expect(step).toHaveAttribute('data-step', 'saved');
    await expect(page.getByTestId('shutter-manual-calibration-hint')).toHaveText(
        'The end positions have been saved. The tubular motor can be used.',
    );
    expect(await stop.boundingBox()).toEqual(stopBox);
    expect(steps()).toEqual([3, 6, 4, 1, 5, 2]);
    expect(commands[4]).toEqual({MANUAL_SELF_CALIBRATION: 5, MANUAL_SELF_CALIBRATION_LEVEL: 0});

    // closing stops the motor it set moving (the WebUI's Cancel does the same), and the row reads the flags again
    await page.getByTestId('shutter-manual-calibration-close').click();
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect.poll(steps).toEqual([3, 6, 4, 1, 5, 2, 7]);
    await expect(row).toHaveAttribute('data-state', 'calibrated');
    await expect(page.getByTestId('shutter-manual-calibration-status')).toHaveText('The end positions are calibrated');
});

test('Stop goes out at once, and closing after it writes nothing more', async ({page}) => {
    await start();
    await openValues(page);
    await page.getByTestId('shutter-manual-calibration-open').click();
    await page.getByTestId('shutter-manual-calibration-down-short').click();
    await page.getByTestId('shutter-manual-calibration-stop').click();
    await expect.poll(steps).toEqual([4, 7]);
    await expect(page.getByTestId('shutter-manual-calibration-last')).toHaveText('Stopped.');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shutter-manual-calibration-dialog')).not.toHaveAttribute('open', '');
    await page.waitForTimeout(500);
    expect(steps()).toEqual([4, 7]);
});

test('a calibrated motor: only "Delete end positions", which asks first, and then the steps start over', async ({
    page,
}) => {
    await start({top: true, bottom: true});
    await openValues(page);
    await expect(page.getByTestId('shutter-manual-calibration')).toHaveAttribute('data-state', 'calibrated');

    await page.getByTestId('shutter-manual-calibration-open').click();
    const step = page.getByTestId('shutter-manual-calibration-step');
    await expect(step).toHaveAttribute('data-step', 'calibrated');
    await expect(page.getByTestId('shutter-manual-calibration-up-short')).toHaveCount(0);

    await page.getByTestId('shutter-manual-calibration-clear').click();
    await page.getByTestId('shutter-manual-calibration-confirm-cancel').click();
    expect(commands).toEqual([]);

    await page.getByTestId('shutter-manual-calibration-clear').click();
    await page.getByTestId('shutter-manual-calibration-confirm-delete').click();
    await expect.poll(steps).toEqual([0]);
    await expect(step).toHaveAttribute('data-step', 'top');
    await expect(page.getByTestId('shutter-manual-calibration-bottom')).toHaveText('Lower end position set: No');
});

test('flags hmipserver does not know yet (-5): no fault shown, the steps start at the top', async ({page}) => {
    const sim = await start();
    const getValue = sim.getValue.bind(sim);
    sim.getValue = (iface, address, datapoint) => {
        if (address === MAINTENANCE && (datapoint === TOP || datapoint === BOTTOM)) {
            throw {
                faultCode: -5,
                faultString: `Unknown Parameter value for value key: ${datapoint}`,
                message: `Unknown Parameter value for value key: ${datapoint}`,
            };
        }
        return getValue(iface, address, datapoint);
    };
    await openValues(page);
    await expect(page.getByTestId('shutter-manual-calibration')).toHaveAttribute('data-state', 'unknown');
    await page.getByTestId('shutter-manual-calibration-open').click();
    await expect(page.getByTestId('shutter-manual-calibration-top')).toHaveText('Upper end position set: not known');
    await expect(page.getByTestId('shutter-manual-calibration-step')).toHaveAttribute('data-step', 'top');
    await expect(page.getByText(/Unknown Parameter/)).toHaveCount(0);
});

test("no calibration on a channel without the datapoint: the motor's channel 0", async ({page}) => {
    await start();
    await page.goto(`${host?.url ?? ''}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${MOTOR}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${MAINTENANCE}-VALUES`).click();
    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');
    await expect(page.getByTestId('param-UNREACH')).toBeVisible();
    await expect(page.getByTestId('shutter-manual-calibration')).toHaveCount(0);
});
