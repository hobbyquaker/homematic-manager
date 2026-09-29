/**
 * "Replace device" end to end (task 8, task 78): the dialog asks rfd's `listReplaceableDevices` for
 * the devices the new one may take over, and `replaceDevice` hands the old one's configuration to
 * it. hm-simulator 1.3.0 answers the list (the other devices of the same type); hmipserver answers
 * the method with an empty body, which the dialog shows as "no suitable device".
 */

import type HmSim from 'hm-simulator/sim.mjs';

import {BIDCOS_SWITCH, HMIP_DIMMER, expect, simulatorReady, test, type Simulator} from './fixtures.js';

const NEW_SWITCH = 'LEQ0000008';

/** The fixture's switch with its channels again, under another serial: the device that came in its place. */
function sameTypeAs(sim: Simulator, address: string, serial: string): HmSim.DeviceDescription[] {
    const device = sim.getDevice('rfd', address);
    if (device === false) {
        throw new Error(`no ${address} in the fixture`);
    }
    const channels = (device.CHILDREN ?? []).map((child) => sim.getDevice('rfd', child));
    return [device, ...channels]
        .filter((entry): entry is HmSim.DeviceDescription => entry !== false)
        .map((entry) => {
            const copy = structuredClone(entry);
            copy.ADDRESS = copy.ADDRESS.replace(address, serial);
            if (copy.PARENT) {
                copy.PARENT = serial;
            }
            if (copy.CHILDREN) {
                copy.CHILDREN = copy.CHILDREN.map((child) => child.replace(address, serial));
            }
            return copy;
        });
}

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('a new switch takes over the old one it replaces (task 8)', async ({page, host, sim}) => {
    sim.addDevice('rfd', ...sameTypeAs(sim, BIDCOS_SWITCH, NEW_SWITCH));
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    const row = page.locator(`[data-row-id="${NEW_SWITCH}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await page.getByTestId('devices-replace').click();

    const dialog = page.getByTestId('replace-device-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    const choice = dialog.getByRole('combobox', {name: 'Replace device'});
    await expect(choice).toHaveValue(BIDCOS_SWITCH);
    await expect(choice.locator('option')).toHaveCount(1);
    await dialog.getByTestId('replace-device-confirm').click();

    // the old device is gone on the interface, its links and values went to the new one
    await expect.poll(() => sim.getDevice('rfd', BIDCOS_SWITCH)).toBe(false);
    expect(sim.getDevice('rfd', NEW_SWITCH)).not.toBe(false);
});

test('an HmIP device has nothing to replace: hmipserver answers with an empty body', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    const row = page.locator(`[data-row-id="${HMIP_DIMMER}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await page.getByTestId('devices-replace').click();
    await expect(page.getByTestId('replace-none')).toBeVisible();
    await expect(page.getByTestId('replace-device-confirm')).toBeDisabled();
});
