/**
 * The ReGa scripts are the part of the backend that cannot be typechecked: they are code sent to
 * someone else's interpreter. Each of them gets a test of its text here, and the two that matter
 * are driven end to end against hm-simulator's ReGa mock in `test/simulator/rega.test.ts`.
 */

import {describe, expect, it} from 'vitest';

import {
    acknowledgeAlarmScript,
    CONFIRM_INBOX_SCRIPT,
    escapeRegaString,
    isPlainRegaName,
    parseConfirmedDevices,
    renameObjectsScript,
} from './scripts.js';

describe('escapeRegaString', () => {
    it('escapes what would end the string literal or the statement', () => {
        expect(escapeRegaString('a"b')).toBe('a\\"b');
        expect(escapeRegaString('a\\b')).toBe('a\\\\b');
        expect(escapeRegaString('a\nb\r\nc')).toBe('a b c');
    });
});

describe('renameObjectsScript', () => {
    it('is one statement per object, and nothing at all for an empty list', () => {
        expect(renameObjectsScript([{id: 4711, name: 'Lampe "Flur"'}])).toBe(
            'dom.GetObject(4711).Name("Lampe \\"Flur\\"");\n',
        );
        expect(renameObjectsScript([])).toBeUndefined();
    });
});

describe('the inbox script (#54)', () => {
    it('uses the idioms of eQ-3s own scripts and confirms only what is not confirmed', () => {
        // `root.Devices().EnumUsedIDs()` and `ReadyConfig()` are what homematic-rega's own
        // channels.rega uses; `ReadyConfig(true)` is what the CCU's WebUI/bin/hm_autoconf sends
        expect(CONFIRM_INBOX_SCRIPT).toContain('root.Devices().EnumUsedIDs()');
        expect(CONFIRM_INBOX_SCRIPT).toContain('oDevice.ReadyConfig() == false');
        expect(CONFIRM_INBOX_SCRIPT).toContain('oDevice.ReadyConfig(true);');
        // and it reports what it did, so the caller can name the devices
        expect(CONFIRM_INBOX_SCRIPT).toContain('oDevice.Address()');
    });

    it('reads what the script wrote, and survives anything else', () => {
        expect(parseConfirmedDevices('[{"id": 4711, "address": "MEQ0123456"}]')).toEqual([
            {id: 4711, address: 'MEQ0123456'},
        ]);
        expect(parseConfirmedDevices('[]')).toEqual([]);
        expect(parseConfirmedDevices('')).toEqual([]);
        expect(parseConfirmedDevices('not json')).toEqual([]);
        expect(parseConfirmedDevices('{"id": 1}')).toEqual([]);
        expect(parseConfirmedDevices('[null, 42, {"id": "x", "address": "A"}, {"id": 1, "address": ""}]')).toEqual([]);
    });
});

describe('the acknowledge script (#94)', () => {
    it('addresses the datapoint the way the CCU does and guards the null case', () => {
        expect(acknowledgeAlarmScript('BidCos-RF', 'LEQ0000001:0', 'STICKY_UNREACH')).toBe(
            'object oAlarm = dom.GetObject("BidCos-RF.LEQ0000001:0.STICKY_UNREACH");\n' +
                'if (oAlarm) { oAlarm.AlReceipt(); }\n',
        );
    });

    it('refuses a name that has no business in a script rather than escaping it', () => {
        // these come from the interface process, not from a user - but they end up in a script, and
        // a refusal loses one acknowledgement where a wrong escape loses the interpreter
        expect(acknowledgeAlarmScript('BidCos-RF', 'A"); Foo(', 'STICKY_UNREACH')).toBeUndefined();
        expect(acknowledgeAlarmScript('Bid Cos', 'LEQ1:0', 'STICKY_UNREACH')).toBeUndefined();
        expect(acknowledgeAlarmScript('BidCos-RF', 'LEQ1:0', 'STICKY UNREACH')).toBeUndefined();
        expect(acknowledgeAlarmScript('BidCos-RF', '', 'X')).toBeUndefined();
    });

    it('accepts the shapes the interfaces really use', () => {
        expect(isPlainRegaName('HmIP-RF')).toBe(true);
        expect(isPlainRegaName('0001D3C99ABCDE:3')).toBe(true);
        expect(isPlainRegaName('CUX2801001:1')).toBe(true);
        expect(isPlainRegaName('LOWBAT')).toBe(true);
        expect(isPlainRegaName('a b')).toBe(false);
    });
});
