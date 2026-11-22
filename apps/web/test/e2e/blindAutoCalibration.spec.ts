/**
 * The automatic calibration of an HmIP blind actuator, end to end: the button in the MASTER dialog of the blind
 * channel, where the CCU's WebUI has its "Auto Calibration" - only on a channel whose MASTER has
 * `ENDPOSITION_AUTO_DETECT` switched on and whose VALUES have `SELF_CALIBRATION`.
 *
 * The descriptions are hm-simulator's real ones: a HmIP-BBL on firmware 1.6.2 (which has both), and the lab's HmIP-BBL
 * on firmware 1.0.2, whose VALUES have the datapoint while its MASTER has no such flag - no button there.
 *
 * hm-simulator stores `SELF_CALIBRATION` like any datapoint and moves no blind, so the device's part is played here:
 * the writes are recorded as they arrive, a `STOP` puts `SELF_CALIBRATION_RESULT` back to false (as the real actuator
 * does), and the test sets the result and the measured running times when "the run is over".
 *
 * A real HmIP-BBL (fw 1.8.20, homematic-manager#172) showed one more thing hm-simulator does not do by itself: hmipserver
 * answers `getValue SELF_CALIBRATION_RESULT` with fault -5 "Unknown Parameter value" while it holds no value for it.
 * {@link unknownResult} plays that.
 */

import {createRequire} from 'node:module';

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';
import type HmSim from 'hm-simulator/sim.mjs';

import {SIMULATOR_FIXTURE, expect, simulatorReady, test, type Simulator} from './fixtures.js';

const require = createRequire(import.meta.url);
const bundled = require('hm-simulator/data/paramset-descriptions.json') as Record<string, HmSim.ParamsetDescription>;
const lab = require('hm-simulator/data/fixtures/lab-2026-09.json') as {
    paramsetDescriptions: Record<string, HmSim.ParamsetDescription>;
};

/** A HmIP-BBL on firmware 1.6.2: the calibration is offered. */
const BBL = '00111A0000BB01';
/** The same, with `ENDPOSITION_AUTO_DETECT` switched off. */
const BBL_NO_DETECT = '00111A0000BB02';
/** A HmIP-BBL on firmware 1.0.2: `SELF_CALIBRATION` in VALUES, no `ENDPOSITION_AUTO_DETECT` in MASTER. */
const BBL_OLD = '00111A0000BB03';

function blind(address: string, firmware: string, version: number): HmSim.DeviceDescription[] {
    const channel = (index: number, type: string, paramsets: string[]): HmSim.DeviceDescription =>
        ({
            ADDRESS: `${address}:${String(index)}`,
            TYPE: type,
            VERSION: version,
            PARENT: address,
            PARENT_TYPE: 'HmIP-BBL',
            PARAMSETS: paramsets,
            INDEX: index,
        }) as HmSim.DeviceDescription;
    return [
        {
            ADDRESS: address,
            TYPE: 'HmIP-BBL',
            VERSION: version,
            FIRMWARE: firmware,
            CHILDREN: [`${address}:0`, `${address}:3`],
            PARAMSETS: ['MASTER', 'SERVICE'],
        } as HmSim.DeviceDescription,
        channel(0, 'MAINTENANCE', ['MASTER', 'VALUES', 'SERVICE']),
        channel(3, 'BLIND_TRANSMITTER', ['MASTER', 'VALUES', 'SERVICE']),
    ];
}

function fixture(): Record<string, unknown> {
    const base = structuredClone(SIMULATOR_FIXTURE) as Record<string, unknown> & {
        devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
        paramsetDescriptions: Record<string, unknown>;
    };
    base.devices['hmip'] = {
        devices: [
            ...(base.devices['hmip']?.devices ?? []),
            ...blind(BBL, '1.6.2', 3),
            ...blind(BBL_NO_DETECT, '1.6.2', 3),
            ...blind(BBL_OLD, '1.0.2', 1),
        ],
    };
    const descriptions = (source: Record<string, HmSim.ParamsetDescription>, prefix: string) =>
        Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith(prefix)));
    base.paramsetDescriptions = {
        ...base.paramsetDescriptions,
        ...descriptions(bundled, 'HmIP-RF/HmIP-BBL/1.6.2/3/'),
        ...descriptions(lab.paramsetDescriptions, 'HmIP-RF/HmIP-BBL/1.0.2/1/'),
    };
    base['paramsets'] = {
        hmip: {
            [`${BBL}:3`]: {MASTER: {ENDPOSITION_AUTO_DETECT: true}},
            [`${BBL_NO_DETECT}:3`]: {MASTER: {ENDPOSITION_AUTO_DETECT: false}},
        },
    };
    return base;
}

let host: TestHost | undefined;
/** Every `setValue SELF_CALIBRATION` the interface received, in order. */
let writes: string[] = [];

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
    expect(bundled['HmIP-RF/HmIP-BBL/1.6.2/3/BLIND_TRANSMITTER/MASTER']?.['ENDPOSITION_AUTO_DETECT']).toBeDefined();
    expect(bundled['HmIP-RF/HmIP-BBL/1.6.2/3/BLIND_TRANSMITTER/VALUES']?.['SELF_CALIBRATION']).toBeDefined();
    expect(
        lab.paramsetDescriptions['HmIP-RF/HmIP-BBL/1.0.2/1/BLIND_TRANSMITTER/MASTER']?.['ENDPOSITION_AUTO_DETECT'],
    ).toBeUndefined();
    expect(
        lab.paramsetDescriptions['HmIP-RF/HmIP-BBL/1.0.2/1/BLIND_TRANSMITTER/VALUES']?.['SELF_CALIBRATION'],
    ).toBeDefined();
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

/** Starts the stack and plays the actuator's part on the simulator (see the note at the top). */
async function start(): Promise<Simulator> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: fixture(),
        connection: {rega: true, language: 'en'},
    });
    const sim = host.simulator as Simulator;
    writes = [];
    const setValue = sim.setValue.bind(sim);
    sim.setValue = (iface, address, datapoint, value, options) => {
        if (datapoint === 'SELF_CALIBRATION' && options?.strict) {
            const name = value === 1 || value === 'START' ? 'START' : 'STOP';
            writes.push(`${address} ${name}`);
            if (name === 'STOP') {
                setValue(iface, address, 'SELF_CALIBRATION_RESULT', false, {internal: true});
            }
        }
        setValue(iface, address, datapoint, value, options);
    };
    return sim;
}

async function openMaster(page: Page, device: string): Promise<void> {
    await page.goto(`${host?.url ?? ''}#/HmIP-RF/devices`);
    // a second dialog in the same test: the hash is the same, so only a reload closes the first
    await page.reload();
    await page.locator(`[data-row-id="${device}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${device}:3-MASTER`).click();
    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');
    await expect(page.getByTestId('paramset-preview')).toBeVisible();
}

/**
 * hmipserver without a value for `SELF_CALIBRATION_RESULT` of the channel (#172): `getValue` answers -5, as on the real
 * system, also after the device reported the result - so only the event can end the run.
 */
function unknownResult(sim: Simulator, channel: string): () => number {
    let faults = 0;
    const getValue = sim.getValue.bind(sim);
    sim.getValue = (iface, address, datapoint) => {
        if (address === channel && datapoint === 'SELF_CALIBRATION_RESULT') {
            faults++;
            // the simulator's servers send any {faultCode, faultString} as a fault
            throw {
                faultCode: -5,
                faultString: 'Unknown Parameter value for value key: SELF_CALIBRATION_RESULT',
                message: 'Unknown Parameter value for value key: SELF_CALIBRATION_RESULT',
            };
        }
        return getValue(iface, address, datapoint);
    };
    return () => faults;
}

/** The actuator finished: it stored what it measured and reports the result. */
function finish(sim: Simulator, channel: string, seconds: number): void {
    sim.putParamset('hmip', channel, 'MASTER', {
        REFERENCE_RUNNING_TIME_TOP_BOTTOM_UNIT: 2,
        REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE: seconds,
    });
    sim.setValue('hmip', channel, 'SELF_CALIBRATION_RESULT', true, {internal: true});
}

test('a first run: one START after the question, and the measured running time is read back', async ({page}) => {
    const sim = await start();
    const channel = `${BBL}:3`;
    await openMaster(page, BBL);

    const row = page.getByTestId('blind-auto-calibration');
    await expect(row).toBeVisible();
    const idleBox = await page.getByTestId('blind-auto-calibration-start').boundingBox();
    const rowBox = await row.boundingBox();

    // the blind moves, so the start asks first - and cancelling writes nothing
    await page.getByTestId('blind-auto-calibration-start').click();
    await expect(page.getByTestId('blind-auto-calibration-dialog')).toHaveAttribute('open', '');
    await expect(page.getByTestId('blind-auto-calibration-target')).toContainText(channel);
    await page.getByTestId('blind-auto-calibration-cancel').click();
    expect(writes).toEqual([]);

    await page.getByTestId('blind-auto-calibration-start').click();
    await page.getByTestId('blind-auto-calibration-confirm').click();
    await expect.poll(() => writes).toEqual([`${channel} START`]);
    await expect(row).toHaveAttribute('data-state', 'running');
    await expect(page.getByTestId('blind-auto-calibration-status')).toHaveText('Calibration running…');

    // Start and Stop are one box, and the row is as tall as before
    const stopBox = await page.getByTestId('blind-auto-calibration-stop').boundingBox();
    expect(stopBox).toEqual(idleBox);
    expect(await row.boundingBox()).toEqual(rowBox);

    // still running after a few polls: the result is false
    await page.waitForTimeout(2500);
    await expect(row).toHaveAttribute('data-state', 'running');

    finish(sim, channel, 42);
    await expect(row).toHaveAttribute('data-state', 'success');
    await expect(page.getByTestId('blind-auto-calibration-status')).toContainText('Calibration finished');
    expect(await row.boundingBox()).toEqual(rowBox);
    expect(await page.getByTestId('blind-auto-calibration-start').boundingBox()).toEqual(idleBox);
    expect(writes).toEqual([`${channel} START`]);

    // MASTER was read again: the calibration block shows what the device stored
    await expect(page.getByTestId('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM-seconds')).toHaveValue('42');

    // the expert view is the raw parameters and nothing else
    await page.getByTestId('paramset-expert').check();
    await expect(row).toHaveCount(0);
});

test('a second run: START, STOP, START, because the result of the first is still true', async ({page}) => {
    const sim = await start();
    const channel = `${BBL}:3`;
    sim.setValue('hmip', channel, 'SELF_CALIBRATION_RESULT', true, {internal: true});
    await openMaster(page, BBL);

    await page.getByTestId('blind-auto-calibration-start').click();
    await page.getByTestId('blind-auto-calibration-confirm').click();
    await expect.poll(() => writes).toEqual([`${channel} START`, `${channel} STOP`, `${channel} START`]);

    // the old "true" does not end the new run
    const row = page.getByTestId('blind-auto-calibration');
    await page.waitForTimeout(2500);
    await expect(row).toHaveAttribute('data-state', 'running');

    finish(sim, channel, 37);
    await expect(row).toHaveAttribute('data-state', 'success');
});

test('#172: the result unknown to hmipserver (-5) - START, STOP, START, no fault shown, the event ends the run', async ({
    page,
}) => {
    const sim = await start();
    const channel = `${BBL}:3`;
    const faults = unknownResult(sim, channel);
    await openMaster(page, BBL);

    await page.getByTestId('blind-auto-calibration-start').click();
    await page.getByTestId('blind-auto-calibration-confirm').click();
    // unknown may be an old run's true: the WebUI's START, STOP, START
    await expect.poll(() => writes).toEqual([`${channel} START`, `${channel} STOP`, `${channel} START`]);

    // the polls answer -5: the run goes on, and the fault is nowhere on the page
    const row = page.getByTestId('blind-auto-calibration');
    await expect.poll(faults).toBeGreaterThanOrEqual(3);
    await expect(row).toHaveAttribute('data-state', 'running');
    await expect(page.getByTestId('blind-auto-calibration-status')).toHaveText('Calibration running…');
    await expect(page.getByText(/Unknown Parameter/)).toHaveCount(0);

    finish(sim, channel, 51);
    await expect(row).toHaveAttribute('data-state', 'success');
    await expect(page.getByTestId('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM-seconds')).toHaveValue('51');
    await expect(page.getByText(/Unknown Parameter/)).toHaveCount(0);
    expect(writes).toEqual([`${channel} START`, `${channel} STOP`, `${channel} START`]);
});

test('Stop writes STOP and ends the run', async ({page}) => {
    await start();
    const channel = `${BBL}:3`;
    await openMaster(page, BBL);

    await page.getByTestId('blind-auto-calibration-start').click();
    await page.getByTestId('blind-auto-calibration-confirm').click();
    await expect.poll(() => writes).toEqual([`${channel} START`]);

    await page.getByTestId('blind-auto-calibration-stop').click();
    await expect(page.getByTestId('blind-auto-calibration')).toHaveAttribute('data-state', 'stopped');
    await expect(page.getByTestId('blind-auto-calibration-status')).toHaveText('Calibration stopped.');
    expect(writes).toEqual([`${channel} START`, `${channel} STOP`]);
    await expect(page.getByTestId('blind-auto-calibration-start')).toBeEnabled();
});

test('no button while ENDPOSITION_AUTO_DETECT is off, and none on a firmware without it', async ({page}) => {
    await start();

    await openMaster(page, BBL_NO_DETECT);
    await expect(page.getByTestId('blind-auto-calibration')).toHaveCount(0);

    await openMaster(page, BBL_OLD);
    await expect(page.getByTestId('blind-auto-calibration')).toHaveCount(0);

    // the control: the same dialog on the channel that offers it
    await openMaster(page, BBL);
    await expect(page.getByTestId('blind-auto-calibration')).toBeVisible();
    expect(writes).toEqual([]);
});

test('#172: the measured times reach hmipserver seconds after the result - the open dialog shows them', async ({
    page,
}) => {
    const sim = await start();
    const channel = `${BBL}:3`;
    await openMaster(page, BBL);
    const row = page.getByTestId('blind-auto-calibration');
    const rowBox = await row.boundingBox();
    const seconds = page.getByTestId('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM-seconds');
    const before = await seconds.inputValue();

    await page.getByTestId('blind-auto-calibration-start').click();
    await page.getByTestId('blind-auto-calibration-confirm').click();
    await expect.poll(() => writes).toEqual([`${channel} START`]);

    // the real HmIP-BBL: the result first, while MASTER still holds the old running times ...
    sim.setValue('hmip', channel, 'SELF_CALIBRATION_RESULT', true, {internal: true});
    await expect(row).toHaveAttribute('data-state', 'reading');
    await expect(page.getByTestId('blind-auto-calibration-status')).toContainText('Waiting for the device');
    await expect(page.getByTestId('blind-auto-calibration-start')).toBeDisabled();
    expect(await row.boundingBox()).toEqual(rowBox);
    await page.waitForTimeout(2500);
    await expect(seconds).toHaveValue(before);

    // ... and the measured ones a few seconds later
    sim.putParamset('hmip', channel, 'MASTER', {
        REFERENCE_RUNNING_TIME_TOP_BOTTOM_UNIT: 0,
        REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE: 5878,
    });
    await expect(seconds).toHaveValue('58.78', {timeout: 10_000});
    await expect(row).toHaveAttribute('data-state', 'success');
    await expect(page.getByTestId('blind-auto-calibration-status')).toHaveText(
        'Calibration finished. The measured running times were read from the device.',
    );
    expect(await row.boundingBox()).toEqual(rowBox);

    // the reading is the device's state, not an edit of the user's
    await page.getByTestId('paramset-preview').click();
    await expect(page.getByTestId('preview-empty')).toBeVisible();
    expect(writes).toEqual([`${channel} START`]);
});

/**
 * #172: the running-time rows read "REFERENCE_RUNNING_TIME_TOP_BOTT…" - the raw name as the title, cut off by the
 * input, over the same raw name. The WebUI's labels now, the raw name only as the second line, and no label of the
 * block runs under its control - on a desktop and on a phone, in both themes (the screenshots are attachments).
 */
for (const theme of ['light', 'dark'] as const) {
    for (const width of [1280, 390]) {
        test(`the calibration block's labels are whole at ${String(width)} px, ${theme}`, async ({page}, testInfo) => {
            await start();
            await page.setViewportSize({width, height: 900});
            await page.emulateMedia({colorScheme: theme});
            await page.addInitScript((value) => {
                window.localStorage.setItem('hmm.theme', value);
            }, theme);
            await openMaster(page, BBL);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            const block = page.getByTestId('editor-blind-calibration');
            await expect(block).toBeVisible();

            const top = page.getByTestId('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM');
            await expect(top.locator('.hmm-blind-name')).toHaveText('Running time top to bottom');
            await expect(top.locator('.hmm-blind-id')).toHaveText('REFERENCE_RUNNING_TIME_TOP_BOTTOM');
            await expect(
                page.getByTestId('blind-REFERENCE_RUNNING_TIME_BOTTOM_TOP').locator('.hmm-blind-name'),
            ).toHaveText('Running time bottom to top');

            const rows = page.locator('.hmm-blind-row, .hmm-autocal');
            expect(await rows.count()).toBeGreaterThan(3);
            const problems = await rows.evaluateAll((elements) =>
                elements.flatMap((element) => {
                    const label = element.firstElementChild as HTMLElement;
                    const control = label.nextElementSibling as HTMLElement;
                    const found: string[] = [];
                    const name = label.textContent?.trim().slice(0, 40) ?? '';
                    for (const part of label.children) {
                        if (part.scrollWidth > part.clientWidth + 1) found.push(`${name}: cut off`);
                    }
                    const a = label.getBoundingClientRect();
                    const b = control.getBoundingClientRect();
                    // side by side, or the control on a line of its own below
                    if (a.right > b.left + 1 && a.bottom > b.top + 1) found.push(`${name}: under its control`);
                    if (element.scrollWidth > element.clientWidth + 1) found.push(`${name}: wider than the dialog`);
                    return found;
                }),
            );
            expect(problems).toEqual([]);
            await block.screenshot({path: testInfo.outputPath(`blind-calibration-${String(width)}-${theme}.png`)});
            await page
                .getByTestId('blind-auto-calibration')
                .screenshot({path: testInfo.outputPath(`blind-auto-calibration-${String(width)}-${theme}.png`)});
        });
    }
}
