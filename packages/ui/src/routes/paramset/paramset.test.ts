import type {MasterView, ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../../lib/transport/MockTransport.js';
import {buildPreview, fieldKind, formFields, displayValue} from '../../lib/util/paramsetForm.js';
import {mountApp} from '../../testHarness.js';

const description: ParamsetDescription = {
    ON_TIME: {
        TYPE: 'FLOAT',
        OPERATIONS: 3,
        MIN: 0,
        MAX: 100,
        UNIT: 's',
        TAB_ORDER: 2,
        SPECIAL: [{ID: 'NOT_USED', VALUE: 111_600}],
    },
    LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON'], TAB_ORDER: 1},
    LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1, UNIT: '100%', TAB_ORDER: 3},
    STATE: {TYPE: 'BOOL', OPERATIONS: 5, TAB_ORDER: 4},
};

describe('formFields', () => {
    it('maps every CCU type to a control, and anything else to "unknown"', () => {
        expect(fieldKind({TYPE: 'BOOL', OPERATIONS: 3})).toBe('bool');
        expect(fieldKind({TYPE: 'ACTION', OPERATIONS: 3})).toBe('action');
        expect(fieldKind({TYPE: 'ENUM', OPERATIONS: 3})).toBe('enum');
        expect(fieldKind({TYPE: 'INTEGER', OPERATIONS: 3})).toBe('integer');
        expect(fieldKind({TYPE: 'FLOAT', OPERATIONS: 3})).toBe('float');
        expect(fieldKind({TYPE: 'STRING', OPERATIONS: 3})).toBe('string');
        expect(fieldKind({TYPE: 'CUSTOM', OPERATIONS: 3})).toBe('unknown');
    });

    it('orders by TAB_ORDER without metadata, and takes the units and bounds along', () => {
        const fields = formFields(description);
        expect(fields.map((field) => field.name)).toEqual(['LOGGING', 'ON_TIME', 'LEVEL', 'STATE']);

        const onTime = fields[1]!;
        expect(onTime.unit).toBe('s');
        expect(onTime.min).toBe(0);
        expect(onTime.max).toBe(100);
        expect(onTime.special).toEqual([{ID: 'NOT_USED', VALUE: 111_600}]);

        // `100%` is a fraction on the wire and a percentage on screen (#96 neighbourhood).
        const level = fields[2]!;
        expect(level.unit).toBe('%');
        expect(level.max).toBe(100);

        expect(fields[3]!.writable).toBe(false);
    });

    it('follows the metadata order, visibility and presets when there is a MasterView', () => {
        const view: MasterView = {
            channelType: 'SWITCH',
            parameters: [
                {name: 'ON_TIME', description: description['ON_TIME']!, visible: true},
                {name: 'LOGGING', description: description['LOGGING']!, visible: false},
            ],
            problems: [],
        };
        const fields = formFields(description, view);
        expect(fields.map((field) => field.name)).toEqual(['ON_TIME', 'LOGGING']);
        expect(fields[1]!.visible).toBe(false);
    });

    it('drops a metadata name the firmware description does not have', () => {
        const view: MasterView = {
            channelType: 'SWITCH',
            parameters: [
                {name: 'GONE', description: {TYPE: 'BOOL', OPERATIONS: 3}, visible: true},
                {name: 'LOGGING', description: description['LOGGING']!, visible: true},
            ],
            problems: [],
        };
        expect(formFields(description, view).map((field) => field.name)).toEqual(['LOGGING']);
    });
});

describe('buildPreview', () => {
    const original = {LOGGING: 1, ON_TIME: 5, LEVEL: 0.5};

    it('lists only what changed, with the enum name rather than its index', () => {
        const preview = buildPreview(original, {LOGGING: 0}, description, {
            interfaceName: 'BidCos-RF',
            targets: ['A:1'],
        });
        expect(preview.entries).toEqual([{param: 'LOGGING', from: 'ON', to: 'OFF'}]);
        expect(preview.values).toEqual({LOGGING: 0});
    });

    it('says nothing will be written when the value is set back to what it was', () => {
        const preview = buildPreview(original, {ON_TIME: 5}, description, {
            interfaceName: 'BidCos-RF',
            targets: ['A:1'],
        });
        expect(preview.entries).toEqual([]);
        expect(preview.values).toEqual({});
        expect(preview.skipped).toEqual([{param: 'ON_TIME', reason: 'unchanged'}]);
    });

    it('takes every writable parameter with writeAll, the explicit opt-out of task 6.1', () => {
        const preview = buildPreview(original, {}, description, {
            interfaceName: 'BidCos-RF',
            targets: ['A:1'],
            writeAll: true,
        });
        expect(preview.entries.map((entry) => entry.param).sort()).toEqual(['LEVEL', 'LOGGING', 'ON_TIME']);
        // STATE is read-only and is never in the payload, whatever the checkbox says.
        expect(preview.skipped).toContainEqual({param: 'STATE', reason: 'not-writable'});
    });

    it('reports a value outside MIN..MAX instead of sending it', () => {
        const preview = buildPreview(original, {ON_TIME: 500}, description, {
            interfaceName: 'BidCos-RF',
            targets: ['A:1'],
        });
        expect(preview.values).toEqual({});
        expect(preview.problems[0]?.code).toBe('above-max');
    });

    it('lets a SPECIAL value through even though it is out of range (#96)', () => {
        const preview = buildPreview(original, {ON_TIME: 111_600}, description, {
            interfaceName: 'BidCos-RF',
            targets: ['A:1'],
        });
        expect(preview.problems).toEqual([]);
        expect(preview.entries).toEqual([{param: 'ON_TIME', from: '5', to: '111600'}]);
    });

    it('prints an absent value as a dash and unwraps an explicitDouble', () => {
        expect(displayValue(undefined, undefined)).toBe('—');
        expect(displayValue({explicitDouble: 0.5}, description['LEVEL'])).toBe('0.5');
        expect(displayValue(true, description['STATE'])).toBe('true');
    });
});

describe('the paramset dialog', () => {
    let transport: MockTransport;

    async function openMaster(address = 'MEQ0123456:1'): Promise<void> {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const [device] = address.split(':');
        if (address.includes(':') && device !== undefined) {
            const parent = document.querySelector<HTMLElement>(`[data-row-id="${device}"]`)!;
            await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        }
        await fireEvent.click(screen.getByTestId(`paramset-${address}-MASTER`));
        await waitFor(() => {
            expect(document.querySelectorAll('[data-testid^="param-"]').length).toBeGreaterThan(0);
        });
    }

    /** The rows in the order the dialog draws them. */
    function paramRows(): (string | null)[] {
        return [...document.querySelectorAll('[data-testid^="param-"]')].map((row) => row.getAttribute('data-testid'));
    }

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('opens from the PARAMSETS button and shows the description-driven form', async () => {
        await openMaster();

        expect(screen.getByTestId('paramset-dialog').getAttribute('aria-label')).toContain('MEQ0123456:1');
        // The metadata's order first (TRANSMIT_TRY_MAX, LOGGING, ON_TIME), then what it does not
        // name, by TAB_ORDER - which is exactly what the CCU's own dialog does.
        await waitFor(() => {
            expect(paramRows()).toEqual([
                'param-TRANSMIT_TRY_MAX',
                'param-LOGGING',
                'param-ON_TIME',
                'param-STATUSINFO_MINDELAY',
            ]);
        });
    });

    it('hides a parameter whose visibility trigger no longer holds, and shows it on request', async () => {
        await openMaster();
        // The rule shows STATUSINFO_MINDELAY only while LOGGING is 1, which is the current value.
        await waitFor(() => {
            expect(screen.getByTestId('param-STATUSINFO_MINDELAY')).toBeTruthy();
        });

        await fireEvent.change(within(screen.getByTestId('param-LOGGING')).getByRole('combobox'), {
            target: {value: '0'},
        });
        await waitFor(() => {
            expect(screen.queryByTestId('param-STATUSINFO_MINDELAY')).toBeNull();
        });

        await fireEvent.click(screen.getByTestId('paramset-show-hidden'));
        await waitFor(() => {
            expect(screen.getByTestId('param-STATUSINFO_MINDELAY')).toBeTruthy();
        });
    });

    it('translates the label, the enum values and the help text of the CCU string table', async () => {
        await openMaster();
        const row = await waitFor(() => {
            const found = screen.getByTestId('param-LOGGING');
            expect(found.textContent).toContain('Statusmeldungen');
            return found;
        });
        expect(row.textContent).toContain('Sendet');
        expect(row.textContent).not.toContain('<b>');
        const options = within(row).getAllByRole('option') as HTMLOptionElement[];
        expect(options.map((option) => option.textContent)).toEqual(['aus', 'an']);
    });

    it('offers the SPECIAL value of the description rather than a hard-coded 111600 (#96)', async () => {
        await openMaster();
        const row = screen.getByTestId('param-ON_TIME');
        const special = await waitFor(() => within(row).getByLabelText(/SPECIAL/) as HTMLSelectElement);
        expect([...special.options].map((option) => option.value)).toEqual(['', 'NOT_USED']);
        // The demo value is the NOT_USED one, so the number box is inert until it is cleared.
        expect(special.value).toBe('NOT_USED');
        expect((within(row).getByRole('spinbutton') as HTMLInputElement).disabled).toBe(true);
    });

    it('previews only the changed parameter and writes exactly that', async () => {
        await openMaster();
        const logging = within(screen.getByTestId('param-LOGGING')).getByRole('combobox');
        await fireEvent.change(logging, {target: {value: '0'}});

        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-preview')).toBeTruthy();
        });
        expect(screen.getByTestId('preview-LOGGING').textContent).toContain('OFF');
        expect(screen.queryByTestId('preview-TRANSMIT_TRY_MAX')).toBeNull();

        await fireEvent.click(screen.getByTestId('write-confirm'));
        await waitFor(() => {
            expect(transport.lastCall('paramset.put')).toEqual([
                'BidCos-RF',
                ['MEQ0123456:1'],
                'MASTER',
                {LOGGING: 0},
                undefined,
            ]);
        });
    });

    it('refuses to write when nothing changed, and says so', async () => {
        await openMaster();
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('preview-empty')).toBeTruthy();
        });
        expect((screen.getByTestId('write-confirm') as HTMLButtonElement).disabled).toBe(true);
        expect(transport.countOf('paramset.put')).toBe(0);
    });

    it('sends writeAll when the box is ticked - the explicit opt-out of task 6.1', async () => {
        await openMaster();
        await fireEvent.click(screen.getByTestId('paramset-write-all'));
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-preview')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[4]).toEqual({writeAll: true});
        });
    });

    it('shows the fault of a failed write and keeps the preview open', async () => {
        transport.respond('paramset.put', (interfaceName, addresses, paramset, values) =>
            addresses.map((address) => ({
                interfaceName,
                address,
                paramset,
                sent: values,
                ok: false,
                problems: [],
                faultCode: -5,
                faultString: 'Unknown parameter',
            })),
        );
        await openMaster();
        await fireEvent.change(within(screen.getByTestId('param-LOGGING')).getByRole('combobox'), {
            target: {value: '0'},
        });
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('preview-results').textContent).toContain('Unknown parameter');
        });
        expect(screen.getByTestId('write-preview').hasAttribute('open')).toBe(true);
    });

    it('offers only channels with the same paramset identity for a multi-apply (task 6.3)', async () => {
        await openMaster('JEQ0234567:1');
        // JEQ0234567:2 is the same device, same channel type, same firmware: eligible.
        await fireEvent.click(within(await waitFor(() => screen.getByTestId('paramset-targets'))).getByRole('button'));
        const options = within(screen.getByTestId('paramset-targets')).getAllByRole('option');
        expect(options.map((option) => option.textContent ?? '').join('|')).toContain('Taster Flur:2 (JEQ0234567:2)');
    });

    it('writes a multi-apply to every chosen channel in one call', async () => {
        await openMaster('JEQ0234567:1');
        const picker = await waitFor(() => screen.getByTestId('paramset-targets'));
        await fireEvent.click(within(picker).getByRole('button'));
        await fireEvent.click(within(picker).getAllByRole('option')[0]!);

        const input = within(screen.getByTestId('param-LONG_PRESS_TIME')).getByRole('spinbutton');
        await fireEvent.input(input, {target: {value: '0.8'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[1]).toEqual(['JEQ0234567:1', 'JEQ0234567:2']);
        });
    });

    it('offers a setValue button per datapoint of the VALUES paramset, and never for a read-only one', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-VALUES'));

        await waitFor(() => {
            expect(screen.getByTestId('set-STATE')).toBeTruthy();
        });
        expect(screen.queryByTestId('set-WORKING')).toBeNull();

        await fireEvent.click(within(screen.getByTestId('param-STATE')).getByRole('checkbox'));
        await fireEvent.click(screen.getByTestId('set-STATE'));

        await waitFor(() => {
            expect(transport.lastCall('value.set')).toEqual(['BidCos-RF', 'MEQ0123456:1', 'STATE', false]);
        });
    });

    it('shows no multi-apply picker for VALUES - it is a MASTER affair', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-VALUES'));
        await waitFor(() => {
            expect(screen.getByTestId('param-STATE')).toBeTruthy();
        });
        expect(screen.queryByTestId('paramset-targets')).toBeNull();
    });

    it('reports a failing getParamsetDescription instead of drawing an empty dialog', async () => {
        transport.fail('paramset.description', 'Unknown instance');
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));

        await waitFor(() => {
            expect(screen.getByTestId('paramset-failed')).toBeTruthy();
        });
    });
});
