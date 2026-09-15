/**
 * Task 49: "Assign to room" / "Assign to function" - a list of checkboxes as tall as its rooms need,
 * against the profile's own `local` store as the provider (hm-simulator's ReGa mock has no rooms
 * script, so the rooms here are seeded into `meta.json` before the host starts).
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';

import {BIDCOS_SWITCH, HMIP_BUTTON, HMIP_DIMMER, SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

/** 24 rooms, none a part of another's name, one of them long enough to wrap. */
const ROOM_NAMES = [
    'Abstellraum',
    'Badezimmer',
    'Bibliothek',
    'Büro',
    'Dachboden',
    'Diele',
    'Esszimmer',
    'Flur oben',
    'Garage',
    'Gästezimmer',
    'Hauswirtschaftsraum',
    'Heizungskeller',
    'Kinderzimmer Nord',
    'Kinderzimmer Süd',
    'Küche',
    'Loggia',
    'Musikzimmer',
    'Schlafzimmer',
    'Speisekammer',
    'Terrasse',
    'Treppenhaus',
    'Wäscheraum',
    'Wintergarten',
    'Wohn- und Essbereich im Erdgeschoss mit dem Blick über die Terrasse hinaus bis zum See',
];

/** `r01` ... `r24`. */
function roomId(index: number): string {
    return `r${String(index + 1).padStart(2, '0')}`;
}

const SWITCH_CHANNEL = `BidCos-RF.${BIDCOS_SWITCH}:1`;
const DIMMER_CHANNEL = `HmIP-RF.${HMIP_DIMMER}:3`;
const BUTTON_CHANNEL = `HmIP-RF.${HMIP_BUTTON}:1`;

function seededDocument(): unknown {
    return {
        format: 1,
        revision: 1,
        objects: {
            [SWITCH_CHANNEL]: {name: 'Steckdose:1', enums: ['room/r02', 'function/licht'], meta: {}},
            [DIMMER_CHANNEL]: {name: 'Dimmer:3', enums: ['room/r01', 'room/r02', 'room/r05'], meta: {}},
            [BUTTON_CHANNEL]: {name: 'Wandtaster:1', enums: ['room/r02', 'room/r03'], meta: {}},
        },
        enums: {
            room: {
                name: {de: 'Räume', en: 'Rooms'},
                tree: ROOM_NAMES.map((name, index) => ({id: roomId(index), name})),
            },
            function: {
                name: {de: 'Gewerke', en: 'Functions'},
                tree: [
                    {id: 'licht', name: 'Licht'},
                    {id: 'heizung', name: 'Heizung'},
                ],
            },
        },
    };
}

interface Stack {
    readonly host: TestHost;
    readonly dataDir: string;
    /** Every object's memberships as the store wrote them to `meta.json`, sorted. */
    memberships(ref: string): Promise<string[]>;
    close(): Promise<void>;
}

/** The e2e fixture's stack with a profile whose store holds the rooms above. */
async function startWithRooms(): Promise<Stack> {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-e2e-assign-'));
    await fs.writeFile(path.join(dataDir, 'meta.json'), `${JSON.stringify(seededDocument(), null, 2)}\n`);
    const host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(SIMULATOR_FIXTURE),
        dataDir,
        connection: {rega: true, language: 'en', metaProvider: 'local'},
    });
    return {
        host,
        dataDir,
        memberships: async (ref) => {
            const document = JSON.parse(await fs.readFile(path.join(dataDir, 'meta.json'), 'utf8')) as {
                objects: Record<string, {enums: string[]} | undefined>;
            };
            return [...(document.objects[ref]?.enums ?? [])].sort();
        },
        close: async () => {
            await host.close();
            await fs.rm(dataDir, {recursive: true, force: true});
        },
    };
}

function assignRow(page: Page, path: string) {
    return page.getByTestId('assign-dialog').locator(`[data-testid="assign-row"][data-path="${path}"]`);
}

test('shows all 24 rooms at once in a 1080 px window, without radios, and saves what one channel gains and loses', async ({
    page,
}) => {
    const stack = await startWithRooms();
    try {
        await page.setViewportSize({width: 1920, height: 1080});
        await page.goto(`${stack.host.url}#/BidCos-RF/devices`);
        const table = page.getByTestId('devices-table');
        const device = table.locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
        await expect(device).toContainText('Steckdose');
        await device.getByRole('button', {name: 'Expand row'}).click();
        const channel = table.locator(`[data-row-id="${BIDCOS_SWITCH}:1"]`);
        await expect(channel).toContainText(ROOM_NAMES[1]!);
        await channel.locator('[data-column-key="name"]').click();
        await expect(page.getByTestId('devices-assign-room')).toBeEnabled();
        await page.getByTestId('devices-assign-room').click();

        const dialog = page.getByTestId('assign-dialog');
        await expect(dialog).toHaveAttribute('open', '');
        const rows = dialog.getByTestId('assign-row');
        await expect(rows).toHaveCount(24);
        await expect(dialog.locator('input[type="radio"]')).toHaveCount(0);
        await expect(dialog.locator('select')).toHaveCount(0);
        await expect(dialog.getByTestId('assign-check')).toHaveCount(24);

        // nothing scrolls: the list is as tall as its rows, and every row and both buttons are in the window
        const list = dialog.getByTestId('assign-list');
        const scroll = await list.evaluate((element) => ({
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
        }));
        expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(1080);
        for (const row of await rows.all()) {
            await expect(row).toBeInViewport({ratio: 1});
        }
        await expect(dialog.getByTestId('assign-apply')).toBeInViewport({ratio: 1});
        // the long name wraps inside the dialog rather than widening it
        const longRow = await assignRow(page, 'room/r24').boundingBox();
        expect(longRow!.x + longRow!.width).toBeLessThanOrEqual(box!.x + box!.width);
        // more than ten rooms: the filter is there
        await expect(dialog.getByTestId('assign-filter')).toBeVisible();

        await expect(assignRow(page, 'room/r02')).toHaveAttribute('data-state', 'on');
        await expect(assignRow(page, 'room/r02').getByTestId('assign-check')).toBeChecked();
        await expect(assignRow(page, 'room/r07')).toHaveAttribute('data-state', 'off');

        await assignRow(page, 'room/r02').getByTestId('assign-check').click();
        await assignRow(page, 'room/r07').getByTestId('assign-check').click();
        // Enter on a box saves
        await assignRow(page, 'room/r07').getByTestId('assign-check').press('Enter');

        await expect(dialog).not.toHaveAttribute('open');
        await expect(channel).toContainText(ROOM_NAMES[6]!);
        await expect(channel).not.toContainText(ROOM_NAMES[1]!);
        await expect.poll(() => stack.memberships(SWITCH_CHANNEL)).toEqual(['function/licht', 'room/r07']);
    } finally {
        await stack.close();
    }
});

test('shows a mixed multi-selection as indeterminate and saves only what was changed', async ({page}) => {
    const stack = await startWithRooms();
    try {
        await page.setViewportSize({width: 1920, height: 1080});
        await page.goto(`${stack.host.url}#/HmIP-RF/devices`);
        const table = page.getByTestId('devices-table');
        const dimmer = table.locator(`[data-row-id="${HMIP_DIMMER}"]`);
        const button = table.locator(`[data-row-id="${HMIP_BUTTON}"]`);
        await expect(dimmer).toContainText('Dimmer');
        // two device rows: the dimmer's one channel is in r01, r02, r05, the button's in r02, r03
        await dimmer.locator('[data-column-key="name"]').click();
        await button.locator('[data-column-key="name"]').click({modifiers: ['ControlOrMeta']});
        await expect(button).toHaveAttribute('aria-selected', 'true');
        await expect(dimmer).toHaveAttribute('aria-selected', 'true');

        const open = async (): Promise<void> => {
            await page.getByTestId('devices-assign-room').click();
            await expect(page.getByTestId('assign-dialog')).toHaveAttribute('open', '');
            await expect(page.getByTestId('assign-count')).toHaveText('2 rows selected');
        };
        const states = async (): Promise<Record<string, string>> => {
            const entries = await page
                .getByTestId('assign-dialog')
                .getByTestId('assign-row')
                .evaluateAll((elements) =>
                    elements.map((element) => [element.getAttribute('data-path'), element.getAttribute('data-state')]),
                );
            return Object.fromEntries(entries.filter(([, state]) => state !== 'off'));
        };
        await open();
        expect(await states()).toEqual({
            'room/r01': 'mixed',
            'room/r02': 'on',
            'room/r03': 'mixed',
            'room/r05': 'mixed',
        });
        const r01 = assignRow(page, 'room/r01').getByTestId('assign-check');
        expect(await r01.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(true);
        await expect(page.getByTestId('assign-dialog').locator('input[type="radio"]')).toHaveCount(0);

        // r01 for both, r02 for neither, r03 three clicks back to as it was, r05 untouched, r10 new for both
        await r01.click();
        await assignRow(page, 'room/r02').getByTestId('assign-check').click();
        for (let click = 0; click < 3; click += 1) {
            await assignRow(page, 'room/r03').getByTestId('assign-check').click();
        }
        await expect(assignRow(page, 'room/r03')).toHaveAttribute('data-state', 'mixed');
        await assignRow(page, 'room/r10').getByTestId('assign-check').click();
        await page.getByTestId('assign-apply').click();
        await expect(page.getByTestId('assign-dialog')).not.toHaveAttribute('open');

        // the dimmer's channel was already in r01, so only the button went in; r03 and r05 are as they were
        await expect.poll(() => stack.memberships(DIMMER_CHANNEL)).toEqual(['room/r01', 'room/r05']);
        expect(await stack.memberships(BUTTON_CHANNEL)).toEqual(['room/r03']);
        expect(await stack.memberships(`HmIP-RF.${HMIP_BUTTON}`)).toEqual(['room/r01', 'room/r10']);
        expect(await stack.memberships(`HmIP-RF.${HMIP_DIMMER}`)).toEqual(['room/r10']);

        // and the dialog, opened again on the same two rows, says the same
        await open();
        expect(await states()).toEqual({
            'room/r01': 'on',
            'room/r03': 'mixed',
            'room/r05': 'mixed',
            'room/r10': 'on',
        });
    } finally {
        await stack.close();
    }
});

test('filters by keyboard without saving, cancels with Escape, and makes a new room that Apply assigns', async ({
    page,
}) => {
    const stack = await startWithRooms();
    try {
        await page.goto(`${stack.host.url}#/BidCos-RF/devices`);
        const table = page.getByTestId('devices-table');
        const device = table.locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
        await expect(device).toContainText('Steckdose');
        await device.getByRole('button', {name: 'Expand row'}).click();
        const channel = table.locator(`[data-row-id="${BIDCOS_SWITCH}:1"]`);
        await channel.locator('[data-column-key="name"]').click();
        await page.getByTestId('devices-assign-room').click();
        const dialog = page.getByTestId('assign-dialog');
        await expect(dialog).toHaveAttribute('open', '');

        // accent-insensitive, and Enter in the field hands the focus to the box instead of saving
        await dialog.getByTestId('assign-filter').fill('kuche');
        await expect(dialog.getByTestId('assign-row')).toHaveCount(1);
        await dialog.getByTestId('assign-filter').press('Enter');
        await expect(dialog).toHaveAttribute('open', '');
        const kitchen = assignRow(page, 'room/r15').getByTestId('assign-check');
        await expect(kitchen).toBeFocused();
        await expect(kitchen).not.toBeChecked();
        // Space toggles, Escape cancels, and nothing was written
        await page.keyboard.press('Space');
        await expect(kitchen).toBeChecked();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveAttribute('open');
        expect(await stack.memberships(SWITCH_CHANNEL)).toEqual(['function/licht', 'room/r02']);

        // opened again: the filter is empty, the kitchen unchecked
        await page.getByTestId('devices-assign-room').click();
        await expect(dialog).toHaveAttribute('open', '');
        await expect(dialog.getByTestId('assign-filter')).toHaveValue('');
        await expect(assignRow(page, 'room/r15')).toHaveAttribute('data-state', 'off');

        await dialog.getByTestId('assign-new').click();
        await expect(dialog.getByTestId('assign-new-name')).toBeFocused();
        await page.keyboard.type('Weinkeller');
        await page.keyboard.press('Enter');
        const cellar = dialog.locator('[data-testid="assign-row"]', {hasText: 'Weinkeller'});
        await expect(cellar).toHaveAttribute('data-state', 'on');
        await expect(cellar.getByTestId('assign-check')).toBeFocused();
        // made at once, assigned only with Apply
        expect(await stack.memberships(SWITCH_CHANNEL)).toEqual(['function/licht', 'room/r02']);
        await dialog.getByTestId('assign-apply').click();
        await expect(dialog).not.toHaveAttribute('open');
        await expect(channel).toContainText('Weinkeller');
        await expect
            .poll(() => stack.memberships(SWITCH_CHANNEL))
            .toEqual(['function/licht', 'room/r02', 'room/weinkeller']);
    } finally {
        await stack.close();
    }
});
