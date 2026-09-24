/**
 * The ReGa scripts are the part of the backend that cannot be typechecked: they are code sent to
 * someone else's interpreter. Each of them gets a test of its text here, and the two that matter
 * are driven end to end against hm-simulator's ReGa mock in `test/simulator/rega.test.ts`.
 */

import {describe, expect, it} from 'vitest';

import {
    acknowledgeAlarmScript,
    CONFIRM_INBOX_SCRIPT,
    createEnumNodeScript,
    deleteEnumNodeScript,
    escapeRegaString,
    isPlainRegaName,
    membershipScript,
    META_READ_SCRIPT,
    parseConfirmedDevices,
    parseCreatedId,
    parseMetaSnapshot,
    parseRegaAlarms,
    REGA_ALARMS_SCRIPT,
    renameObjectsScript,
    unescapeRegaUrl,
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
        // B-61: over ID_SERVICES and the alarm's trigger datapoint, as the WebUI does - not
        // dom.GetObject(<name>), which is the datapoint itself and has no alarm to receipt
        const script = acknowledgeAlarmScript('BidCos-RF', 'LEQ0000001:0', 'STICKY_UNREACH') ?? '';
        expect(script).toContain('foreach (sId, dom.GetObject(ID_SERVICES).EnumIDs())');
        expect(script).toContain('dom.GetObject(oAlarm.AlTriggerDP())');
        expect(script).toContain('if (oTrigger.Name() == "BidCos-RF.LEQ0000001:0.STICKY_UNREACH")');
        expect(script).toContain('oAlarm.AlReceipt();');
        expect(script).toContain('Write(iDone);');
        expect(script).not.toContain('dom.GetObject("BidCos-RF.LEQ0000001:0.STICKY_UNREACH")');
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

describe("ReGa's pending service messages (task 36)", () => {
    it('reads the oncoming alarms of ID_SERVICES with their trigger and both times', () => {
        expect(REGA_ALARMS_SCRIPT).toContain('dom.GetObject(ID_SERVICES).EnumIDs()');
        expect(REGA_ALARMS_SCRIPT).toContain('oAlarm.AlState() == asOncoming');
        expect(REGA_ALARMS_SCRIPT).toContain('oAlarm.AlOccurrenceTime().ToInteger()');
        expect(REGA_ALARMS_SCRIPT).toContain('oAlarm.Timestamp().ToInteger()');
        // ReGa's own escapes in the script, not a raw tab
        expect(REGA_ALARMS_SCRIPT).toContain('"\\t"');
    });

    it('parses the lines into messages with epoch milliseconds, and skips what is no datapoint', () => {
        const output =
            'BidCos-RF.LEQ0000001:0.STICKY_UNREACH\t1790000000\t1790000500\n' +
            'HmIP-RF.0001D3C99ABCDE:0.LOW_BAT\t1790001000\t0\n' +
            'Systemalarm\t1790002000\t1790002000\n' +
            'CUxD.CUX.2801:1.STATE\t1790003000\t1790003000\n' +
            'BidCos-RF.LEQ0000002:0.UNREACH\t0\t0\n' +
            '\n';
        expect(parseRegaAlarms(output)).toEqual([
            {
                interfaceName: 'BidCos-RF',
                address: 'LEQ0000001:0',
                datapoint: 'STICKY_UNREACH',
                first: 1_790_000_000_000,
                last: 1_790_000_500_000,
            },
            {
                interfaceName: 'HmIP-RF',
                address: '0001D3C99ABCDE:0',
                datapoint: 'LOW_BAT',
                first: 1_790_001_000_000,
                last: 1_790_001_000_000,
            },
        ]);
        expect(parseRegaAlarms('')).toEqual([]);
    });
});

describe('the rooms and functions scripts (task 27)', () => {
    it('reads devices, channels, rooms and functions in one round trip, with the interface per device', () => {
        // the idioms of homematic-rega's channels.rega, rooms.rega and functions.rega, in one script
        expect(META_READ_SCRIPT).toContain('root.Devices().EnumUsedIDs()');
        expect(META_READ_SCRIPT).toContain('dom.GetObject(ID_ROOMS).EnumUsedIDs()');
        expect(META_READ_SCRIPT).toContain('dom.GetObject(ID_FUNCTIONS).EnumUsedIDs()');
        expect(META_READ_SCRIPT).toContain('oRoom.EnumUsedIDs()');
        // the ref of the metadata store needs the interface, which the address alone does not carry
        expect(META_READ_SCRIPT).toContain('dom.GetObject(oDevice.Interface())');
        // names go out URL-encoded, as every homematic-rega script writes them
        expect(META_READ_SCRIPT).toContain('WriteURL(oChannel.Name())');
        // every variable is declared once, at the top: ReGa has no block scope
        expect(META_READ_SCRIPT.startsWith('string sDevId;')).toBe(true);
    });

    it('decodes WriteURL output as ISO-8859-1 bytes, which decodeURIComponent would refuse', () => {
        expect(unescapeRegaUrl('K%FCche')).toBe('Küche');
        expect(unescapeRegaUrl('Licht%20Flur')).toBe('Licht Flur');
        expect(unescapeRegaUrl('%u20AC')).toBe('€');
        expect(unescapeRegaUrl('plain')).toBe('plain');
    });

    it('parses what the read script wrote and drops what does not fit', () => {
        const snapshot = parseMetaSnapshot(
            JSON.stringify({
                objects: [
                    {id: 1, address: 'ABC1', interface: 'BidCos-RF', name: 'Lampe'},
                    {id: 2, address: 'ABC1:1', interface: 'BidCos-RF', name: 'Lampe%3A1'},
                    {id: 'x', address: 'no'},
                    {id: 3, address: '', interface: 'BidCos-RF', name: 'x'},
                    null,
                ],
                rooms: [{id: 10, name: 'K%FCche', channels: [2, 'x']}, {name: 'no id'}],
                functions: [{id: 20, name: 'Licht'}],
            }),
        );
        expect(snapshot.objects).toEqual([
            {id: 1, address: 'ABC1', interfaceName: 'BidCos-RF', name: 'Lampe'},
            {id: 2, address: 'ABC1:1', interfaceName: 'BidCos-RF', name: 'Lampe:1'},
        ]);
        expect(snapshot.rooms).toEqual([{id: 10, name: 'Küche', channels: [2]}]);
        expect(snapshot.functions).toEqual([{id: 20, name: 'Licht', channels: []}]);
    });

    it('refuses an answer that is not the document', () => {
        expect(() => parseMetaSnapshot('null')).toThrow('no document');
        expect(() => parseMetaSnapshot('{"rooms":[],"functions":[]}')).toThrow('object list');
        expect(() => parseMetaSnapshot('{"objects":[],"functions":[]}')).toThrow('rooms');
        expect(() => parseMetaSnapshot('{"objects":[],"rooms":[]}')).toThrow('functions');
        expect(() => parseMetaSnapshot('<html>')).toThrow();
    });

    it('creates an enum object, names it, lists it and writes its id', () => {
        expect(createEnumNodeScript('room', 'Bad "oben"')).toBe(
            'object oNew = dom.CreateObject(OT_ENUM);\n' +
                'oNew.Name("Bad \\"oben\\"");\n' +
                'dom.GetObject(ID_ROOMS).Add(oNew.ID());\n' +
                'Write(oNew.ID());\n',
        );
        expect(createEnumNodeScript('function', 'Licht')).toContain('dom.GetObject(ID_FUNCTIONS).Add(oNew.ID());');
        expect(parseCreatedId('4711\n')).toBe(4711);
        expect(parseCreatedId('')).toBeUndefined();
        expect(parseCreatedId('Error')).toBeUndefined();
    });

    it('removes a node from its list and deletes the object, guarded against one that is gone', () => {
        expect(deleteEnumNodeScript('room', 4711)).toBe(
            'object oGone = dom.GetObject(4711);\n' +
                'if (oGone) { dom.GetObject(ID_ROOMS).Remove(4711); dom.DeleteObject(4711); }\n',
        );
        expect(deleteEnumNodeScript('function', 5)).toContain('dom.GetObject(ID_FUNCTIONS).Remove(5)');
    });

    it('adds and removes channel ids on the enum, one statement each, nothing for no change', () => {
        expect(
            membershipScript([
                {enumId: 10, channelId: 2, on: true},
                {enumId: 20, channelId: 2, on: false},
            ]),
        ).toBe('dom.GetObject(10).Add(2);\ndom.GetObject(20).Remove(2);\n');
        expect(membershipScript([])).toBeUndefined();
    });
});
