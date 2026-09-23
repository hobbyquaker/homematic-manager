/**
 * Task 57: the heating groups of openccu-lite - the Groups tab of VirtualDevices.
 *
 * Against the simulator and a stand-in for the system's `occulited` (`occuliteStub.ts`): the
 * backend detects the system's metadata API on the stub, so the store is the system's and the
 * tab is offered; the groups are created, changed and deleted through the stub's groups API, and
 * the spec reads back what went over the wire. The last test is the other half of the rule: on a
 * CCU - the ordinary fixture, ReGa and no system API - the tab does not exist.
 */

import {startForTest, type TestHost} from 'homematic-manager';

import {BIDCOS_SWITCH, HMIP_BUTTON, SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';
import {STUB_TOKEN, startOcculiteStub, type OcculiteStub} from './occuliteStub.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

/** A thermostat the stub knows and the simulator does not: the names come from the system's store anyway. */
const THERMOSTAT = 'LEQ0765432';

interface Stack {
    readonly host: TestHost;
    readonly stub: OcculiteStub;
    close(): Promise<void>;
}

/** The e2e fixture's stack, with the system's metadata and groups APIs answered by the stub. */
async function startWithBox(): Promise<Stack> {
    const stub = await startOcculiteStub({
        devices: [
            {address: BIDCOS_SWITCH, type: 'HM-LC-Sw1-Pl', name: 'Steckdose'},
            {address: THERMOSTAT, type: 'HM-CC-RT-DN', name: 'Thermostat Bad', fits: 'HomeMatic.heating'},
            {address: 'KEQ0165114', type: 'HM-Sec-SC', name: 'Fenster Bad', fits: 'HomeMatic.heating'},
            {
                address: `${HMIP_BUTTON}:1`,
                type: 'REMOTE_CONTROL',
                name: 'Wandtaster:1',
                fits: 'hmip.heating.group',
                connected: true,
            },
        ],
        groups: [{id: 1, name: 'Bad', type: 'HomeMatic.heating', members: ['KEQ0165114']}],
    });
    const host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(SIMULATOR_FIXTURE),
        // the system's API is where `metaUrl` points; the token is what an installation off the
        // system configures (D-40), and the one the stub accepts
        connection: {rega: true, language: 'en', metaUrl: stub.url, metaToken: STUB_TOKEN},
    });
    return {
        host,
        stub,
        close: async () => {
            await host.close();
            await stub.close();
        },
    };
}

test('the Groups tab is on VirtualDevices when the system has the groups API, lists the groups, and is on no other interface', async ({
    page,
}) => {
    const stack = await startWithBox();
    try {
        await page.goto(`${stack.host.url}#/VirtualDevices/groups`);
        const tab = page.getByRole('tab', {name: 'Groups'});
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        // right after Devices, as the CCU's own menu has it near the devices
        await expect(page.getByRole('tab').nth(0)).toHaveText(/Devices/);
        await expect(page.getByRole('tab').nth(1)).toHaveText(/Groups/);

        const table = page.getByTestId('groups-table');
        const row = table.locator('[data-row-id="1"]');
        await expect(row).toContainText('Bad');
        // the system's label key, translated; the virtual device; the member by its name from the system's store
        await expect(row).toContainText('Heating control');
        await expect(row).toContainText('INT0000001');
        await expect(page.getByTestId('group-members-1')).toContainText('Fenster Bad (KEQ0165114)');
        await expect(page.getByTestId('groups-table-count')).toHaveText('1 group');

        // the interface popup names the system's store, so the person can see where the names come from
        await page.getByTestId('interface-select-trigger').click();
        await expect(page.getByTestId('meta-indicator')).toContainText('occulited');
        await page.getByTestId('interface-item-BidCos-RF').click();
        await expect(page.getByRole('tab', {name: 'Devices'})).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tab', {name: 'Groups'})).toHaveCount(0);
        await page.goto(`${stack.host.url}#/HmIP-RF/devices`);
        await expect(page.getByRole('tab', {name: 'Groups'})).toHaveCount(0);
    } finally {
        await stack.close();
    }
});

test('a group is created with a member, its members changed as a whole, and deleted - through the system’s API', async ({
    page,
}) => {
    const stack = await startWithBox();
    try {
        await page.goto(`${stack.host.url}#/VirtualDevices/groups`);
        const table = page.getByTestId('groups-table');
        await expect(table.locator('[data-row-id="1"]')).toContainText('Bad');

        // New: the type is chosen, the thermostat is offered, the window contact already in a group is not
        await page.getByTestId('groups-new').click();
        const dialog = page.getByTestId('group-dialog');
        await expect(dialog).toHaveAttribute('open', '');
        await expect(page.getByTestId('group-type')).toHaveValue('HomeMatic.heating');
        await expect(page.getByTestId(`group-member-${THERMOSTAT}`)).toBeVisible();
        await expect(page.getByTestId('group-member-KEQ0165114')).toHaveCount(0);
        await expect(page.getByTestId('group-candidates')).toContainText('Thermostat Bad');
        await expect(page.getByTestId('group-save')).toBeDisabled();
        await page.getByTestId('group-name').fill('Küche');
        await page.getByTestId(`group-member-${THERMOSTAT}`).check();
        await page.getByTestId('group-save').click();
        await expect(dialog).not.toHaveAttribute('open');

        const created = table.locator('[data-row-id="2"]');
        await expect(created).toContainText('Küche');
        await expect(created).toContainText('INT0000002');
        await expect(page.getByTestId('group-members-2')).toContainText(`Thermostat Bad (${THERMOSTAT})`);
        await expect(page.getByTestId('groups-table-count')).toHaveText('2 groups');
        // the change's devices to configure, as the WebUI's popup showed them
        await expect(page.getByTestId('groups-pending')).toContainText(THERMOSTAT);
        expect(stack.stub.requests).toContain(
            `POST /groups {"name":"Küche","type":"HomeMatic.heating","members":["${THERMOSTAT}"]}`,
        );

        // Edit: the member goes, the name stays - and the name is therefore not sent
        await created.click();
        await page.getByTestId('groups-edit').click();
        await expect(dialog).toHaveAttribute('open', '');
        await expect(page.getByTestId('group-name')).toHaveValue('Küche');
        await expect(page.getByTestId('group-device')).toHaveText('INT0000002');
        await expect(page.getByTestId(`group-member-${THERMOSTAT}`)).toBeChecked();
        await expect(page.getByTestId('group-save')).toBeDisabled();
        await page.getByTestId(`group-member-${THERMOSTAT}`).uncheck();
        await page.getByTestId('group-save').click();
        await expect(dialog).not.toHaveAttribute('open');
        await expect(page.getByTestId('group-members-2')).toContainText('There are no devices in the group');
        expect(stack.stub.requests).toContain('PUT /groups/2 {"members":[]}');

        // the other type: nothing to take, and the wall button's channel is already connected elsewhere
        await page.getByTestId('groups-new').click();
        await page.getByTestId('group-type').selectOption('hmip.heating.group');
        await expect(page.getByTestId('group-no-candidates')).toBeVisible();
        await expect(page.getByTestId('group-connected')).toContainText(`${HMIP_BUTTON}:1`);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveAttribute('open');

        // Delete: the question names the group and its virtual device, then the row is gone
        await created.click();
        await page.getByTestId('groups-delete').click();
        const question = page.getByTestId('group-delete-dialog');
        await expect(question).toHaveAttribute('open', '');
        await expect(page.getByTestId('group-delete-subject')).toHaveText('Küche');
        await expect(question).toContainText('INT0000002');
        await page.getByTestId('group-delete-apply').click();
        await expect(question).not.toHaveAttribute('open');
        await expect(created).toHaveCount(0);
        await expect(page.getByTestId('groups-table-count')).toHaveText('1 group');
        expect(stack.stub.requests).toContain('DELETE /groups/2');
        expect(stack.stub.groups.map((group) => group.id)).toEqual([1]);
    } finally {
        await stack.close();
    }
});

test('on a CCU there is no Groups tab, and a bookmark of it lands on the devices', async ({page, host}) => {
    // the ordinary fixture: ReGa answers, nothing answers the metadata API - a CCU
    await page.goto(`${host.url}#/VirtualDevices/groups`);
    await expect(page.getByRole('tab', {name: 'Devices'})).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', {name: 'Groups'})).toHaveCount(0);
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await expect(page.getByTestId('groups-table')).toHaveCount(0);
});
