import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../lib/transport/MockTransport.js';
import {argFields, argValue, buildParams, emptyValue, isValidJson, parseJson} from '../lib/util/rpcForm.js';
import {mountApp} from '../testHarness.js';

describe('the generated argument form', () => {
    it('takes the argument types from the core catalogue', () => {
        expect(argFields('getParamset').map((field) => [field.name, field.kind])).toEqual([
            ['address', 'text'],
            ['paramset_key', 'text'],
            // `mode` is optional on rfd; the form draws it and says so.
            ['mode', 'number'],
        ]);
        expect(argFields('getParamset')[2]?.optional).toEqual(['rfd']);
        // putParamset is the one 2.x could not do from the console (#27, #136).
        expect(argFields('putParamset').map((field) => field.kind)).toContain('struct');
    });

    it('knows nothing about a method the catalogue does not have, and says so with an empty form', () => {
        expect(argFields('nonsenseMethod')).toEqual([]);
    });

    it('turns a bit field into its flags and back into the number that goes out', () => {
        const flags = argFields('deleteDevice').find((field) => field.kind === 'flags');
        expect(flags?.name).toBe('flags');
        expect(Object.values(flags?.options ?? {})).toContain('DELETE_FLAG_RESET');
        expect(argValue(flags!, 5)).toBe(5);
    });

    it('gives every kind an empty value that is safe to send', () => {
        expect(emptyValue({name: 'a', type: 'bool', kind: 'bool', optional: []})).toBe(false);
        expect(emptyValue({name: 'a', type: 'integer', kind: 'number', optional: []})).toBe(0);
        expect(emptyValue({name: 'a', type: 'paramset', kind: 'struct', optional: []})).toEqual([]);
        expect(emptyValue({name: 'a', type: 'variant', kind: 'variant', optional: []})).toEqual({
            type: 'string',
            value: '',
        });
        expect(emptyValue({name: 'a', type: 'string', kind: 'text', optional: []})).toBe('');
        expect(emptyValue({name: 'a', type: 'integer', kind: 'select', optional: [], options: {'1': 'one'}})).toBe('1');
    });

    it('builds a struct out of its rows, with the type of each row', () => {
        const field = {name: 'set', type: 'paramset' as const, kind: 'struct' as const, optional: []};
        expect(
            argValue(field, [
                {key: 'LOGGING', type: 'integer', value: '1'},
                {key: 'ON_TIME', type: 'double', value: '2.5'},
                {key: 'ACTIVE', type: 'bool', value: 'true'},
                {key: 'NAME', type: 'string', value: 'x'},
                // a row without a key is not sent at all
                {key: '', type: 'string', value: 'ignored'},
            ]),
        ).toEqual({LOGGING: 1, ON_TIME: 2.5, ACTIVE: true, NAME: 'x'});
    });

    it('never throws on half-typed JSON', () => {
        expect(parseJson('[{"a":1}]')).toEqual([{a: 1}]);
        expect(parseJson('[{"a":')).toEqual([]);
        expect(parseJson('   ')).toEqual([]);
        expect(isValidJson('[]')).toBe(true);
        expect(isValidJson('')).toBe(true);
        expect(isValidJson('{')).toBe(false);
    });

    it('sends a numeric select value as a number and everything else as text', () => {
        const select = {name: 'a', type: 'integer' as const, kind: 'select' as const, optional: []};
        expect(argValue(select, '2')).toBe(2);
        expect(argValue(select, 'MASTER')).toBe('MASTER');
    });

    it('builds the whole tuple, filling in what the form has not touched', () => {
        const fields = argFields('setValue');
        expect(buildParams(fields, ['ABC:1'])).toEqual(['ABC:1', '', '']);
    });
});

/** The control of one argument, by the id the form gives it. */
function argInput(name: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`#arg-input-${name}`);
    expect(element, `no input for ${name}`).not.toBeNull();
    return element!;
}

describe('the RPC console', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('offers the methods the interface reports', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        expect([...select.options].map((option) => option.value)).toContain('putParamset');
    });

    it('generates a form per argument, and shows the exact tuple it will send', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });

        await fireEvent.change(select, {target: {value: 'getParamset'}});
        await waitFor(() => {
            expect(screen.getByTestId('arg-address')).toBeTruthy();
        });

        // An `<input list=...>` has the combobox role, not textbox - it offers the known addresses.
        await fireEvent.input(argInput('address'), {target: {value: 'MEQ0123456:1'}});
        await fireEvent.input(argInput('paramset_key'), {target: {value: 'MASTER'}});

        await waitFor(() => {
            expect(screen.getByTestId('console-params').textContent).toBe('getParamset("MEQ0123456:1","MASTER",0)');
        });
    });

    it('edits a putParamset struct row by row - what 2.x could not do (#27, #136)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        await fireEvent.change(select, {target: {value: 'putParamset'}});

        await waitFor(() => {
            expect(screen.getByTestId('arg-set-add')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('arg-set-add'));

        await fireEvent.input(screen.getByLabelText('set 0 key'), {target: {value: 'LOGGING'}});
        await fireEvent.change(screen.getByLabelText('set 0 type'), {target: {value: 'integer'}});
        await fireEvent.input(screen.getByLabelText('set 0 value'), {target: {value: '1'}});

        await waitFor(() => {
            expect(screen.getByTestId('console-params').textContent).toContain('{"LOGGING":1}');
        });

        await fireEvent.click(screen.getByTestId('console-send-button'));
        await waitFor(() => {
            expect(transport.lastCall('rpc.call')).toEqual(['BidCos-RF', 'putParamset', ['', '', {LOGGING: 1}]]);
        });
    });

    it('edits a bit field as flags', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        await fireEvent.change(select, {target: {value: 'deleteDevice'}});

        const flags = await waitFor(() => screen.getByTestId('arg-flags'));
        const boxes = within(flags).getAllByRole('checkbox') as HTMLInputElement[];
        await fireEvent.click(boxes[0]!);
        await waitFor(() => {
            expect(screen.getByTestId('console-params').textContent).toContain(',1)');
        });
    });

    it('shows the raw response and keeps a fault as a result rather than a toast', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        await fireEvent.change(select, {target: {value: 'listBidcosInterfaces'}});
        await fireEvent.click(screen.getByTestId('console-send-button'));

        await waitFor(() => {
            expect(screen.getByTestId<HTMLTextAreaElement>('console-response').value).toContain('listBidcosInterfaces');
        });

        transport.fail('rpc.call', {message: 'Unknown instance', kind: 'rpc', faultCode: -2});
        await fireEvent.click(screen.getByTestId('console-send-button'));

        await waitFor(() => {
            expect(screen.getByTestId('console-error').textContent).toContain('Unknown instance');
        });
        expect(screen.getByTestId<HTMLTextAreaElement>('console-response').value).toContain('-2');
        // A console fault is the answer the user asked for, not a notice.
        expect(stores.notices.items).toHaveLength(0);
    });

    it('keeps a history and refills the form from it', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        await fireEvent.change(select, {target: {value: 'getParamset'}});
        await fireEvent.input(argInput('address'), {target: {value: 'MEQ0123456:1'}});
        await fireEvent.click(screen.getByTestId('console-send-button'));

        const history = await waitFor(() => screen.getByTestId('console-history'));
        await waitFor(() => {
            expect(within(history).getAllByRole('button')).toHaveLength(1);
        });

        await fireEvent.change(select, {target: {value: 'listBidcosInterfaces'}});
        await fireEvent.click(within(history).getAllByRole('button')[0]!);

        await waitFor(() => {
            expect(screen.getByTestId('console-params').textContent).toBe('getParamset("MEQ0123456:1","",0)');
        });
    });

    it('clears the history', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        await fireEvent.change(select, {target: {value: 'listBidcosInterfaces'}});
        await fireEvent.click(screen.getByTestId('console-send-button'));
        await waitFor(() => {
            expect(stores.console.history).toHaveLength(1);
        });

        await fireEvent.click(screen.getByTestId('console-clear'));
        expect(stores.console.history).toEqual([]);
    });

    it('shows the help text of the method, without its markup', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/console'});
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('console-method'));
        await waitFor(() => {
            expect(select.options.length).toBeGreaterThan(1);
        });
        await fireEvent.change(select, {target: {value: 'listDevices'}});

        await waitFor(() => {
            expect(screen.getByTestId('console-help').textContent).toContain('device descriptions');
        });
    });
});
