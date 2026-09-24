import type {MasterView, ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../../lib/transport/MockTransport.js';
import {
    buildPreview,
    buildSuppressPreview,
    fieldKind,
    formFields,
    displayValue,
    serviceMessageParameters,
} from '../../lib/util/paramsetForm.js';
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
        expect(screen.getByTestId<HTMLButtonElement>('write-confirm').disabled).toBe(true);
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
        expect(options.map((option) => option.textContent).join('|')).toContain('Taster Flur:2 (JEQ0234567:2)');
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
        // Task 19: the toast used to say "setValue MEQ0123456:1 STATE" and nothing about the value,
        // so a write that did nothing was indistinguishable from one that worked.
        await waitFor(() => {
            expect(screen.getByTestId('notices').textContent).toContain('MEQ0123456:1');
        });
        expect(screen.getByTestId('notices').textContent).toContain('STATE = false');
    });

    /**
     * The task 19 defect, at the unit level: the dialog must hand the raw value to the transport.
     * Casting it here as well wrapped a `FLOAT` in `{explicitDouble}`, which the backend then cast
     * a second time into `0`.
     */
    it('sends a float datapoint uncast, so the backend is the only place that casts', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="GEQ0567890"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-GEQ0567890:1-VALUES'));

        // LEVEL has UNIT `100%`, so the input shows percent and the store keeps the fraction.
        const row = await waitFor(() => screen.getByTestId('param-LEVEL'));
        await fireEvent.input(within(row).getByRole('spinbutton'), {target: {value: '50'}});
        await fireEvent.click(screen.getByTestId('set-LEVEL'));

        await waitFor(() => {
            expect(transport.lastCall('value.set')).toEqual(['BidCos-RF', 'GEQ0567890:1', 'LEVEL', 0.5]);
        });
        expect(screen.getByTestId('notices').textContent).toContain('LEVEL = 0.5');
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

/**
 * Task 26 (openccu-lite 28.9): the suppression of channel 0's service messages on an HmIP
 * interface - rows in the table, a checkbox each, and an Apply button whose preview lists the
 * exact `suppressServiceMessages` calls. Nothing goes out when a checkbox is toggled.
 */
describe('service-message suppression in the channel-0 dialog', () => {
    let transport: MockTransport;
    let suppressedNow: string[];

    function rpcCalls(): ReadonlyArray<readonly unknown[]> {
        return transport.calls.filter((call) => call.method === 'rpc.call').map((call) => call.params);
    }

    /** The write preview that is open - the paramset's own one stays in the DOM, closed. */
    function openPreview(): HTMLElement {
        const dialog = screen.getAllByTestId<HTMLDialogElement>('write-preview').find((element) => element.open);
        expect(dialog, 'no open write preview').toBeDefined();
        return dialog!;
    }

    async function openHmip(paramset: 'MASTER' | 'VALUES'): Promise<void> {
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="000A1B2C3D4E5F"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        // B-33: the MASTER of this channel 0 is empty in the demo; its button is offered because the
        // dialog carries the suppression rows from VALUES, which takes a second description
        await fireEvent.click(await screen.findByTestId(`paramset-000A1B2C3D4E5F:0-${paramset}`));
        await waitFor(() => {
            expect(screen.getByTestId('suppress-LOWBAT')).toBeTruthy();
        });
    }

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        suppressedNow = ['UNREACH'];
        transport.respond('rpc.call', (_interfaceName, method, params) => {
            if (method === 'suppressServiceMessages') {
                const [, parameter, suppress] = params;
                const name = typeof parameter === 'string' ? parameter : '';
                suppressedNow = suppressedNow.filter((entry) => entry !== name);
                if (suppress === true) {
                    suppressedNow.push(name);
                }
                return true;
            }
            return method === 'getSuppressedServiceMessages' ? [...suppressedNow] : '';
        });
    });

    it('lists the service parameters of a VALUES description, DUTY_CYCLE only where it is a boolean', () => {
        expect(
            serviceMessageParameters({
                UNREACH: {TYPE: 'BOOL', OPERATIONS: 5, TAB_ORDER: 2},
                LOWBAT: {TYPE: 'BOOL', OPERATIONS: 5, TAB_ORDER: 1},
                DUTY_CYCLE: {TYPE: 'INTEGER', OPERATIONS: 5, TAB_ORDER: 3},
                ERROR_CODE: {TYPE: 'INTEGER', OPERATIONS: 5, TAB_ORDER: 4},
                RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, TAB_ORDER: 5},
            }),
        ).toEqual(['LOWBAT', 'UNREACH', 'ERROR_CODE']);
        expect(serviceMessageParameters({DUTY_CYCLE: {TYPE: 'BOOL', OPERATIONS: 5}})).toEqual(['DUTY_CYCLE']);
    });

    it('previews one call per checkbox that differs from the interface, and nothing for the rest', () => {
        const preview = buildSuppressPreview({
            address: '000A1B2C3D4E5F:0',
            suppressed: ['UNREACH'],
            edits: {UNREACH: true, LOWBAT: true, STICKY_UNREACH: false, CONFIG_PENDING: true},
            labels: {suppressed: 'on', unsuppressed: 'off'},
        });
        expect(preview.targets).toEqual(['000A1B2C3D4E5F:0']);
        expect(preview.entries).toEqual([
            {param: 'CONFIG_PENDING', from: 'off', to: 'on'},
            {param: 'LOWBAT', from: 'off', to: 'on'},
        ]);
        expect(preview.calls).toEqual([
            'suppressServiceMessages(000A1B2C3D4E5F:0, "CONFIG_PENDING", true)',
            'suppressServiceMessages(000A1B2C3D4E5F:0, "LOWBAT", true)',
        ]);
        expect(preview.values).toEqual({});
        // unsuppressing one that is suppressed is a call as well
        expect(
            buildSuppressPreview({
                address: 'A:0',
                suppressed: ['UNREACH'],
                edits: {UNREACH: false},
                labels: {suppressed: 'on', unsuppressed: 'off'},
            }).calls,
        ).toEqual(['suppressServiceMessages(A:0, "UNREACH", false)']);
    });

    it('draws the service parameters as rows of the MASTER dialog, read from the VALUES description', async () => {
        await openHmip('MASTER');
        // the maintenance channel's MASTER paramset of the demo has no parameters; the rows are the
        // service datapoints of its VALUES paramset, at the end of the table
        expect(screen.getByTestId('suppress-row-UNREACH')).toBeTruthy();
        expect(screen.getByTestId('suppress-row-STICKY_UNREACH')).toBeTruthy();
        expect(screen.getByTestId<HTMLInputElement>('suppress-UNREACH').checked).toBe(true);
        expect(screen.getByTestId<HTMLInputElement>('suppress-LOWBAT').checked).toBe(false);
        expect(rpcCalls()).toEqual([['HmIP-RF', 'getSuppressedServiceMessages', ['000A1B2C3D4E5F:0']]]);
        expect(screen.getByTestId<HTMLButtonElement>('suppress-apply').disabled).toBe(true);
    });

    it('sends nothing on a toggle; Apply previews the exact calls and confirmation sends them', async () => {
        await openHmip('MASTER');

        await fireEvent.click(screen.getByTestId('suppress-LOWBAT'));
        await fireEvent.click(screen.getByTestId('suppress-UNREACH'));
        // toggling back and forth is not a change
        await fireEvent.click(screen.getByTestId('suppress-UNREACH'));
        expect(rpcCalls()).toHaveLength(1);
        expect(screen.getByTestId<HTMLButtonElement>('suppress-apply').disabled).toBe(false);

        await fireEvent.click(screen.getByTestId('suppress-apply'));
        // the paramset's own (closed) preview is in the DOM as well; the open one is the suppression's
        const preview = await waitFor(() => openPreview());
        expect(within(preview).getByTestId('preview-call-0').textContent).toBe(
            'suppressServiceMessages(000A1B2C3D4E5F:0, "LOWBAT", true)',
        );
        expect(within(preview).queryByTestId('preview-call-1')).toBeNull();
        expect(within(preview).getByTestId('preview-LOWBAT')).toBeTruthy();
        expect(within(preview).queryByTestId('write-stage')).toBeNull();
        expect(rpcCalls()).toHaveLength(1);

        await fireEvent.click(within(preview).getByTestId('write-confirm'));
        await waitFor(() => {
            expect(rpcCalls()).toEqual([
                ['HmIP-RF', 'getSuppressedServiceMessages', ['000A1B2C3D4E5F:0']],
                ['HmIP-RF', 'suppressServiceMessages', ['000A1B2C3D4E5F:0', 'LOWBAT', true]],
                ['HmIP-RF', 'getSuppressedServiceMessages', ['000A1B2C3D4E5F:0']],
            ]);
        });
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('suppress-apply').disabled).toBe(true);
        });
        expect(screen.getByTestId<HTMLInputElement>('suppress-LOWBAT').checked).toBe(true);
    });

    it('lets "Suppress all" tick every row, still sending nothing until Apply', async () => {
        await openHmip('MASTER');
        await fireEvent.click(screen.getByTestId('suppress-all'));
        expect(screen.getByTestId<HTMLInputElement>('suppress-LOWBAT').checked).toBe(true);
        expect(screen.getByTestId<HTMLInputElement>('suppress-STICKY_UNREACH').checked).toBe(true);
        expect(rpcCalls()).toHaveLength(1);
        await fireEvent.click(screen.getByTestId('unsuppress-all'));
        expect(screen.getByTestId<HTMLInputElement>('suppress-UNREACH').checked).toBe(false);
        await fireEvent.click(screen.getByTestId('suppress-apply'));
        const preview = await waitFor(() => openPreview());
        expect(within(preview).getByTestId('preview-call-0').textContent).toBe(
            'suppressServiceMessages(000A1B2C3D4E5F:0, "UNREACH", false)',
        );
    });

    it('puts the checkbox on the datapoint rows themselves in the VALUES dialog', async () => {
        await openHmip('VALUES');
        const row = screen.getByTestId('param-UNREACH');
        expect(within(row).getByTestId('suppress-UNREACH')).toBeTruthy();
        expect(within(row).getByTestId<HTMLInputElement>('suppress-UNREACH').checked).toBe(true);
        expect(screen.queryByTestId('suppress-row-UNREACH')).toBeNull();
        // no box on top of the dialog any more (the maintainer's first point)
        expect(screen.queryByTestId('suppress-UNREACH')?.closest('[data-testid="param-UNREACH"]')).not.toBeNull();
    });

    it('shows none of it on BidCos, and asks the interface nothing', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:0-VALUES'));
        await waitFor(() => {
            expect(screen.getByTestId('param-UNREACH')).toBeTruthy();
        });
        expect(screen.queryByTestId('suppress-UNREACH')).toBeNull();
        expect(screen.queryByTestId('paramset-service-messages')).toBeNull();
        expect(rpcCalls()).toEqual([]);
    });
});

describe('the CCU MASTER form (task 63, D-55)', () => {
    // An HmIP button channel: its MASTER form on the CCU shows the LED switch and the long-press
    // timeout (one selector over the unit/value pair); PERMANENT_FULL_RX is not on it.
    const CHANNEL = '0001D8A9B7C6D5:1';
    const description: ParamsetDescription = {
        LED_DISABLE_CHANNELSTATE: {TYPE: 'BOOL', OPERATIONS: 3, DEFAULT: false},
        REPEATED_LONG_PRESS_TIMEOUT_UNIT: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['S', 'M', 'H']},
        REPEATED_LONG_PRESS_TIMEOUT_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 15},
        PERMANENT_FULL_RX: {TYPE: 'BOOL', OPERATIONS: 3, DEFAULT: true},
        EVENT_DELAY: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 111_600, DEFAULT: 5},
    };
    const masterMetadata = {
        KEY_TRANSCEIVER: {
            channelType: 'KEY_TRANSCEIVER',
            controls: [
                {kind: 'param', param: 'LED_DISABLE_CHANNELSTATE', label: {de: 'Geräte-LED deaktivieren'}},
                {kind: 'param', param: 'EVENT_DELAY', option: 'duration'},
                {
                    kind: 'time',
                    prefix: 'REPEATED_LONG_PRESS_TIMEOUT',
                    selector: 'timeOnOffShort',
                    label: {de: 'Timeout'},
                },
                {kind: 'param', param: 'SOMETHING_ELSE', requires: ['SOMETHING_ELSE']},
            ],
        },
    };
    let transport: MockTransport;

    async function openButton(): Promise<void> {
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="0001D8A9B7C6D5"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(await screen.findByTestId(`paramset-${CHANNEL}-MASTER`));
    }

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        const demoFile = transport.handlerFor('data.file');
        transport.respond('data.file', (path) => {
            if (path === 'data/master-metadata.json') return {...(demoFile(path) as object), ...masterMetadata};
            if (path === 'data/easymode-time-selectors.json') {
                return {
                    source: 'test',
                    types: {
                        timeOnOffShort: [
                            {special: 'notActive', label: {de: 'Nicht aktiv'}},
                            {seconds: 120, label: {de: '2 Minuten'}},
                            {special: 'enterValue', label: {de: 'Wert eingeben'}},
                        ],
                    },
                };
            }
            return demoFile(path);
        });
        const demoDescription = transport.handlerFor('paramset.description');
        transport.respond('paramset.description', (interfaceName, address, paramset) =>
            address === CHANNEL && paramset === 'MASTER'
                ? description
                : demoDescription(interfaceName, address, paramset),
        );
        const demoGet = transport.handlerFor('paramset.get');
        transport.respond('paramset.get', (interfaceName, address, paramset) =>
            address === CHANNEL && paramset === 'MASTER'
                ? {
                      LED_DISABLE_CHANNELSTATE: false,
                      REPEATED_LONG_PRESS_TIMEOUT_UNIT: 1,
                      REPEATED_LONG_PRESS_TIMEOUT_VALUE: 2,
                      PERMANENT_FULL_RX: true,
                  }
                : demoGet(interfaceName, address, paramset),
        );
    });

    it('shows only the CCU form, the time as one selector, and hides the rest', async () => {
        await openButton();
        const form = await screen.findByTestId('paramset-easy-form');
        expect(within(form).getByTestId('param-LED_DISABLE_CHANNELSTATE')).toBeTruthy();
        expect(within(form).getByText('Geräte-LED deaktivieren')).toBeTruthy();
        const select = within(form).getByTestId<HTMLSelectElement>('easy-time-select-REPEATED_LONG_PRESS_TIMEOUT');
        // M x 2 = 120 s
        expect(select.selectedOptions[0]?.textContent).toBe('2 Minuten');
        expect(screen.queryByTestId('param-PERMANENT_FULL_RX')).toBeNull();
        expect(screen.queryByTestId('param-REPEATED_LONG_PRESS_TIMEOUT_UNIT')).toBeNull();
        // the duration editor of task 10 would edit the same pair a second time: not in the easy mode
        expect(screen.queryByTestId('duration-REPEATED_LONG_PRESS_TIMEOUT')).toBeNull();
    });

    // task 67: the expert view is the raw values and nothing else - no form, no device editor, and
    // the list is no scroller of its own, the dialog's body is the one that scrolls
    it('shows no editor in the expert view, and the list does not scroll on its own', async () => {
        await openButton();
        await screen.findByTestId('paramset-easy-form');
        await fireEvent.click(screen.getByTestId('paramset-expert'));
        await waitFor(() => {
            expect(screen.getByTestId('param-REPEATED_LONG_PRESS_TIMEOUT_UNIT')).toBeTruthy();
        });
        expect(screen.queryByTestId('duration-REPEATED_LONG_PRESS_TIMEOUT')).toBeNull();
        expect(screen.queryByTestId('paramset-easy-form')).toBeNull();
        // "as well" means beside an editor; with none shown the box is not offered
        expect(screen.queryByTestId('paramset-show-covered')).toBeNull();
        const list = screen.getByTestId('paramset-dialog').querySelector<HTMLElement>('.hmm-paramset-list')!;
        expect(getComputedStyle(list).overflowY).toBe('visible');
    });

    // a preset's label key is one of the WebUI's labels (uiLabels), not an enum name: the easy form
    // showed "stringtablelogicor" where the expert view said "OR (höherer Pegel hat Priorität)"
    it("names a preset by the WebUI's label, not by its key", async () => {
        await openButton();
        const select = await screen.findByTestId<HTMLSelectElement>('easy-preset-select-EVENT_DELAY');
        const labels = [...select.options].map((option) => option.textContent.trim());
        expect(labels).toEqual(['5s', '30s', 'nicht benutzt', 'Wert eingeben']);
    });

    it('writes a preset as unit and value', async () => {
        await openButton();
        const select = await screen.findByTestId<HTMLSelectElement>('easy-time-select-REPEATED_LONG_PRESS_TIMEOUT');
        await fireEvent.change(select, {target: {value: '0'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('preview-REPEATED_LONG_PRESS_TIMEOUT_VALUE').textContent).toContain('0');
        });
    });

    it('shows every parameter raw with the expert view, the form ones marked', async () => {
        await openButton();
        await screen.findByTestId('paramset-easy-form');
        await fireEvent.click(screen.getByTestId('paramset-expert'));
        await waitFor(() => {
            expect(screen.getByTestId('param-PERMANENT_FULL_RX')).toBeTruthy();
        });
        expect(screen.queryByTestId('paramset-easy-form')).toBeNull();
        expect(screen.getByTestId('paramset-easy-legend')).toBeTruthy();
        const marked = (param: string): boolean =>
            screen.getByTestId(`param-${param}`).parentElement?.classList.contains('hmm-paramset-easy-marked') ?? false;
        expect(marked('LED_DISABLE_CHANNELSTATE')).toBe(true);
        expect(marked('REPEATED_LONG_PRESS_TIMEOUT_UNIT')).toBe(true);
        expect(marked('REPEATED_LONG_PRESS_TIMEOUT_VALUE')).toBe(true);
        expect(marked('PERMANENT_FULL_RX')).toBe(false);
    });

    it('keeps the full list, without the checkbox, where the channel type has no form', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-MASTER'));
        await waitFor(() => {
            expect(document.querySelectorAll('[data-testid^="param-"]').length).toBeGreaterThan(0);
        });
        expect(screen.queryByTestId('paramset-easy-form')).toBeNull();
        expect(screen.queryByTestId('paramset-expert')).toBeNull();
    });
});

/**
 * Task 64: the WebUI picks a MASTER form by the paramset id the interface reports
 * (`getParamsetId`) before the channel type, and some BidCos forms show the channel's own button -
 * its internal key - as a link profile of the channel with itself.
 */
describe('the MASTER form by paramset id (task 64)', () => {
    let transport: MockTransport;
    const CHANNEL = 'MEQ0123456:1';

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        const demoFile = transport.handlerFor('data.file');
        transport.respond('data.file', (path) =>
            path === 'data/master-forms.json'
                ? {
                      byParamsetId: {
                          switch_ch_master: {
                              controls: [{kind: 'param', param: 'LOGGING'}],
                              internalKey: {receiverType: 'SWITCH'},
                          },
                      },
                  }
                : demoFile(path),
        );
        transport.respond('paramset.id', (_interfaceName, address) => (address === CHANNEL ? 'switch_ch_master' : ''));
    });

    async function openSwitch(): Promise<void> {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId(`paramset-${CHANNEL}-MASTER`));
    }

    it("shows the form the paramset id names, and asks for the id with the channel's address", async () => {
        await openSwitch();
        const form = await screen.findByTestId('paramset-easy-form');
        expect(within(form).getByTestId('param-LOGGING')).toBeTruthy();
        expect(screen.queryByTestId('param-TRANSMIT_TRY_MAX')).toBeNull();
        expect(
            transport.calls.filter((call) => call.method === 'paramset.id').map((call) => call.params),
        ).toContainEqual(['BidCos-RF', CHANNEL]);
    });

    it('opens the internal key as the link of the channel with itself, without a sender part', async () => {
        await openSwitch();
        const button = await screen.findByTestId('paramset-internal-key');
        expect(button.textContent).toContain('Interne Taste');
        await fireEvent.click(button);
        await waitFor(() => {
            expect(
                transport.calls.some(
                    (call) =>
                        call.method === 'paramset.get' && call.params[1] === CHANNEL && call.params[2] === CHANNEL,
                ),
            ).toBe(true);
        });
        expect(screen.queryByTestId('link-sender-toggle')).toBeNull();
    });

    it('keeps the channel type and offers no internal key where the interface has no paramset id', async () => {
        transport.result('paramset.id', '');
        await openSwitch();
        await waitFor(() => {
            expect(document.querySelectorAll('[data-testid^="param-"]').length).toBeGreaterThan(0);
        });
        expect(screen.queryByTestId('paramset-easy-form')).toBeNull();
        expect(screen.queryByTestId('paramset-internal-key')).toBeNull();
        expect(screen.getByTestId('param-TRANSMIT_TRY_MAX')).toBeTruthy();
    });
});
