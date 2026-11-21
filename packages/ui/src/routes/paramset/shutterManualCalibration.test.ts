import type {ParamsetDescription, ParamsetWrite} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {HMIP_M_TD15_MAINTENANCE_VALUES, HMIP_M_TD15_SHUTTER_VALUES} from '../../../test/fixtures/hmipMTd15.js';
import {createI18n, resolveLanguage} from '../../lib/i18n/index.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {expandRowName, mountApp} from '../../testHarness.js';

/**
 * Task 122 in the VALUES dialog, on MockTransport: the demo's channel `MEQ0123456:1` answers the derived HmIP-M-TD15
 * descriptions, `value.get` the two flags of `:0`, and every `paramset.put` is recorded with its options.
 */
describe('the manual calibration of the end positions', () => {
    let transport: MockTransport;
    let flags: {top: unknown; bottom: unknown};
    let commands: Array<{address: string; values: ParamsetWrite; options: unknown}>;
    let refuse: boolean;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        flags = {top: false, bottom: false};
        commands = [];
        refuse = false;
        transport.respond('value.get', (_interfaceName, _address, parameter) => {
            const value = parameter === 'MANUAL_SELF_CALIBRATION_TOP_POS_SET' ? flags.top : flags.bottom;
            if (value === undefined) {
                throw Object.assign(new Error('Unknown Parameter value for value key'), {faultCode: -5});
            }
            return value as boolean;
        });
        transport.respond('paramset.get', () => ({}));
        transport.respond('paramset.put', (interfaceName, addresses, paramset, values, options) => {
            const [address = ''] = addresses;
            commands.push({address, values, options});
            return [{interfaceName, address, paramset, sent: values, ok: !refuse, problems: []}];
        });
    });

    async function open(values: ParamsetDescription = HMIP_M_TD15_SHUTTER_VALUES): Promise<void> {
        transport.respond('paramset.description', (_interfaceName, address, paramset) =>
            paramset === 'VALUES' && address.endsWith(':0') ? HMIP_M_TD15_MAINTENANCE_VALUES : values,
        );
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: expandRowName()}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-VALUES'));
        await waitFor(() => {
            expect(screen.getByTestId('paramset-dialog').hasAttribute('open')).toBe(true);
        });
    }

    async function calibrate(): Promise<HTMLElement> {
        await fireEvent.click(await screen.findByTestId('shutter-manual-calibration-open'));
        const dialog = screen.getByTestId('shutter-manual-calibration-dialog');
        await waitFor(() => {
            expect(dialog.hasAttribute('open')).toBe(true);
        });
        return dialog;
    }

    /** A text in the language the mounted app speaks (it follows the browser's). */
    const tr = (key: string, params: Record<string, string> = {}): string =>
        createI18n(resolveLanguage(document.documentElement.lang)).t(key, params);

    const steps = (): unknown[] => commands.map((command) => command.values['MANUAL_SELF_CALIBRATION']);

    it('is offered in the VALUES dialog of a channel with MANUAL_SELF_CALIBRATION, and says the motor cannot be used yet', async () => {
        await open();
        const row = await screen.findByTestId('shutter-manual-calibration');
        await waitFor(() => {
            expect(row.dataset['state']).toBe('uncalibrated');
        });
        expect(screen.getByTestId('shutter-manual-calibration-status').textContent).toContain(
            tr('The end positions have not been saved. The tubular motor therefore cannot be used.'),
        );
        // the flags were read from channel 0, and opening wrote nothing
        expect(transport.calls.filter((call) => call.method === 'value.get').map((call) => call.params[1])).toContain(
            'MEQ0123456:0',
        );
        expect(commands).toEqual([]);
    });

    it('is not offered on a channel without the datapoint', async () => {
        const without = Object.fromEntries(
            Object.entries(HMIP_M_TD15_SHUTTER_VALUES).filter(([name]) => name !== 'MANUAL_SELF_CALIBRATION'),
        );
        await open(without);
        await waitFor(() => {
            expect(screen.getByTestId('param-LEVEL')).toBeTruthy();
        });
        expect(screen.queryByTestId('shutter-manual-calibration')).toBeNull();
    });

    it('walks the WebUI steps: warning and Stop first, up, save the top, down, save the bottom - one command each', async () => {
        await open();
        const dialog = await calibrate();
        expect(within(dialog).getByRole('alert').textContent).toContain(
            tr(
                'The motor moves as soon as a movement button is pressed. Make sure nothing and nobody is in the way of the shutter. STOP stops it at any time; closing this dialog stops it too.',
            ),
        );
        expect(screen.getByTestId('shutter-manual-calibration-stop')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('top');
        });
        expect(screen.getByTestId('shutter-manual-calibration-top').textContent).toBe(tr('Upper end position set: No'));

        // the timed move waits for a time
        const upTimed = screen.getByTestId<HTMLButtonElement>('shutter-manual-calibration-up-duration');
        expect(upTimed.disabled).toBe(true);
        await fireEvent.input(screen.getByTestId('shutter-manual-calibration-seconds'), {target: {value: '45'}});
        await waitFor(() => {
            expect(upTimed.disabled).toBe(false);
        });
        await fireEvent.click(upTimed);
        await waitFor(() => {
            expect(commands).toHaveLength(1);
        });
        // clamped to the WebUI's 30 s, written as one VALUES command
        expect(commands[0]).toEqual({
            address: 'MEQ0123456:1',
            values: {
                MANUAL_SELF_CALIBRATION: 6,
                MANUAL_SELF_CALIBRATION_LEVEL: 1,
                MANUAL_SELF_CALIBRATION_DURATION_VALUE: 30,
                MANUAL_SELF_CALIBRATION_DURATION_UNIT: 0,
            },
            options: {command: true},
        });
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-last').textContent).toContain(
                tr('Up for {seconds} s.', {seconds: '30'}),
            );
        });

        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-up-short'));
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-save-top'));
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('bottom');
        });
        expect(screen.queryByTestId('shutter-manual-calibration-reverse')).toBeNull();

        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-down-long'));
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-save-bottom'));
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('saved');
        });
        expect(screen.getByTestId('shutter-manual-calibration-hint').textContent).toContain(
            tr('The end positions have been saved. The tubular motor can be used.'),
        );
        expect(steps()).toEqual([6, 4, 1, 5, 2]);
        expect(commands.at(-2)?.values).toEqual({MANUAL_SELF_CALIBRATION: 5, MANUAL_SELF_CALIBRATION_LEVEL: 0});

        // done: closing sends the Stop of a shutter set moving, as the WebUI's Cancel does
        expect(screen.getByTestId('shutter-manual-calibration-close').textContent).toBe(tr('Done'));
        flags = {top: true, bottom: true};
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-close'));
        await waitFor(() => {
            expect(steps()).toEqual([6, 4, 1, 5, 2, 7]);
        });
        // the row read the flags again
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration').dataset['state']).toBe('calibrated');
        });
    });

    it('Stop is there in every step and goes out at once; Stop then close writes no second one', async () => {
        await open();
        await calibrate();
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-down-short'));
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-stop'));
        await waitFor(() => {
            expect(steps()).toEqual([4, 7]);
        });
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-close'));
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-dialog').hasAttribute('open')).toBe(false);
        });
        expect(steps()).toEqual([4, 7]);
    });

    it('closing without a move writes nothing', async () => {
        await open();
        await calibrate();
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-close'));
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-dialog').hasAttribute('open')).toBe(false);
        });
        expect(commands).toEqual([]);
    });

    it('a calibrated motor offers only "Delete end positions", which asks first', async () => {
        flags = {top: true, bottom: true};
        await open();
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration').dataset['state']).toBe('calibrated');
        });
        await calibrate();
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('calibrated');
        });
        expect(screen.queryByTestId('shutter-manual-calibration-up-short')).toBeNull();
        expect(screen.queryByTestId('shutter-manual-calibration-save-top')).toBeNull();

        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-clear'));
        await fireEvent.click(await screen.findByTestId('shutter-manual-calibration-confirm-cancel'));
        expect(commands).toEqual([]);

        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-clear'));
        flags = {top: false, bottom: false};
        await fireEvent.click(await screen.findByTestId('shutter-manual-calibration-confirm-delete'));
        await waitFor(() => {
            expect(steps()).toEqual([0]);
        });
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('top');
        });
    });

    it('flags hmipserver does not know yet (-5) raise no notice, and the steps start at the top', async () => {
        flags = {top: undefined, bottom: undefined};
        await open();
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration').dataset['state']).toBe('unknown');
        });
        await calibrate();
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-top').textContent).toBe(
                tr('Upper end position set: not known'),
            );
        });
        expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('top');
        expect(screen.getByTestId('notices').textContent).not.toContain('Unknown Parameter');
    });

    it('a refused command keeps the step and says so', async () => {
        await open();
        await calibrate();
        refuse = true;
        await fireEvent.click(screen.getByTestId('shutter-manual-calibration-save-top'));
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-last').textContent).toContain(
                tr('The device did not take the command.'),
            );
        });
        expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('top');
    });

    it('the flag events move the row and the steps along', async () => {
        await open();
        await calibrate();
        transport.emit('rpc.event', {
            timestamp: Date.now(),
            interfaceName: 'BidCos-RF',
            method: 'event',
            address: 'MEQ0123456:0',
            datapoint: 'MANUAL_SELF_CALIBRATION_TOP_POS_SET',
            value: true,
        });
        await waitFor(() => {
            expect(screen.getByTestId('shutter-manual-calibration-step').dataset['step']).toBe('bottom');
        });
        expect(commands).toEqual([]);
    });
});
