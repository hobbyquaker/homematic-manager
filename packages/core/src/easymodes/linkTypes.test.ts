import {readdirSync, readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
    BIDCOS_LINK_FILES,
    enumValueIndex,
    HMIP_LINK_FILES,
    isHmipInterface,
    LINK_DISPATCHERS,
    linkProfileTypes,
    type LinkEnd,
    type LinkTypeQueries,
    type MasterRead,
} from './linkTypes.js';
import {EasyModeEngine, EXPERT_PROFILE_ID} from './engine.js';
import {MemoryDataSource} from '../data/memory.js';
import type {ReceiverProfiles} from '../data/types.js';
import type {ParamsetDescription} from '../paramset/description.js';

/**
 * Task 108: the WebUI's table, extracted from its easymode tree by `data/scripts/easymode-links.mjs`.
 * Every test below that walks it fails for each WebUI pair or rule homematic-manager does not have.
 */
interface Extract {
    source: string;
    pairs: Record<string, Record<string, number[]>>;
    dispatchers: Record<
        string,
        Record<string, {by: string; folder: string; variant?: {deviceType: string; mode: number; suffix: string}}>
    >;
    hmip: Record<string, {levelCommand: Record<string, string>; modRc8: boolean; remapsReceiver: boolean}>;
    bidcos: Record<string, Record<string, unknown>>;
}

const extract = JSON.parse(
    readFileSync(new URL('../../../../data/extracted/easymode_links.json', import.meta.url), 'utf8'),
) as Extract;

const profilesDir = new URL('../../../../data/dist/profiles/', import.meta.url);
const shipped = new Map<string, ReceiverProfiles>(
    readdirSync(profilesDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
            const data = JSON.parse(readFileSync(new URL(name, profilesDir), 'utf8')) as ReceiverProfiles;
            return [data.receiverType, data];
        }),
);

function shippedIds(receiver: string, sender: string): number[] | undefined {
    return shipped
        .get(receiver)
        ?.senders[sender]?.map((profile) => profile.id)
        .sort((a, b) => a - b);
}

const end = (address: string, type: string, parentType: string, extra: Partial<LinkEnd> = {}): LinkEnd => ({
    address,
    type,
    parentType,
    ...extra,
});

/** Queries that answer from fixed tables and count what was asked. */
function answering(
    tables: {
        master?: Record<string, MasterRead>;
        channelMode?: Record<string, string>;
        paramsetId?: Record<string, string>;
        links?: string[];
    } = {},
): LinkTypeQueries & {asked: string[]} {
    const asked: string[] = [];
    return {
        asked,
        master: (address) => {
            asked.push(`master ${address}`);
            return Promise.resolve(tables.master?.[address]);
        },
        channelMode: (address) => {
            asked.push(`channelMode ${address}`);
            return Promise.resolve(tables.channelMode?.[address] ?? '');
        },
        linkParamsetId: (address) => {
            asked.push(`paramsetId ${address}`);
            return Promise.resolve(tables.paramsetId?.[address] ?? '');
        },
        linked: (sender, receiver) => {
            asked.push(`linked ${sender} ${receiver}`);
            return Promise.resolve(tables.links?.includes(`${sender}>${receiver}`) ?? false);
        },
    };
}

const MODE_LIST = ['INACTIVE', 'KEY_BEHAVIOR', 'SWITCH_BEHAVIOR', 'BINARY_BEHAVIOR'];
const operationMode = (value: number | string): MasterRead => ({
    values: {CHANNEL_OPERATION_MODE: value},
    description: {CHANNEL_OPERATION_MODE: {TYPE: 'ENUM', OPERATIONS: 7, VALUE_LIST: MODE_LIST}},
});

describe('the WebUI easymode table (task 108)', () => {
    it('was extracted from a named tree', () => {
        expect(extract.source).not.toBe('');
        expect(Object.keys(extract.pairs).length).toBeGreaterThan(50);
    });

    it('every WebUI receiver/sender pair is shipped with every profile it offers', () => {
        const missing: string[] = [];
        for (const [receiver, senders] of Object.entries(extract.pairs)) {
            for (const [sender, ids] of Object.entries(senders)) {
                const have = shippedIds(receiver, sender);
                const lacking = ids.filter((id) => id !== 0 && !(have ?? []).includes(id));
                if (have === undefined || lacking.length > 0) {
                    missing.push(`${receiver}/${sender}${have === undefined ? '' : ` profiles ${lacking.join(',')}`}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('knows every dispatcher of the WebUI, with its folder, its value and its variant', () => {
        expect(LINK_DISPATCHERS).toEqual(extract.dispatchers);
    });

    it('knows every linkHmIP file of the WebUI and what it does to the sender', () => {
        expect(
            Object.fromEntries(
                Object.entries(extract.hmip).map(([type, rules]) => [
                    type,
                    {modRc8: rules.modRc8, levelCommand: rules.levelCommand},
                ]),
            ),
        ).toEqual(HMIP_LINK_FILES);
    });

    it('knows every BidCos link dispatcher that does more than open <TYPE>/<SENDER>', () => {
        const special = Object.fromEntries(
            Object.entries(extract.bidcos).filter(([, rules]) => Object.keys(rules).length > 0),
        );
        expect(special).toEqual(BIDCOS_LINK_FILES);
    });

    it('resolves every receiver type a linkHmIP file remaps to a shipped folder', async () => {
        const remapped = Object.entries(extract.hmip)
            .filter(([, rules]) => rules.remapsReceiver)
            .map(([type]) => type)
            .sort();
        expect(remapped).toEqual([
            'BLIND_VIRTUAL_RECEIVER',
            'DIMMER_VIRTUAL_RECEIVER',
            'OPTICAL_SIGNAL_RECEIVER',
            'SWITCH_TRANSCEIVER',
            'UNIVERSAL_LIGHT_RECEIVER',
        ]);
        // one device for each way out of each file
        const cases: [LinkEnd, Record<string, MasterRead>, string][] = [
            [end('W:2', 'BLIND_VIRTUAL_RECEIVER', 'HmIPW-DRBL4', {firmware: '1.6.2'}), {}, 'SHUTTER_VIRTUAL_RECEIVER'],
            [end('W:2', 'BLIND_VIRTUAL_RECEIVER', 'HmIP-BBL', {firmware: '1.6.2'}), {}, 'BLIND_VIRTUAL_RECEIVER'],
            [end('U:2', 'DIMMER_VIRTUAL_RECEIVER', 'HmIP-WUA'), {}, 'UNIVERSAL_ACTOR'],
            [end('O:2', 'OPTICAL_SIGNAL_RECEIVER', 'HmIP-BSL'), {}, 'DIMMER_VIRTUAL_RECEIVER'],
            [end('S:2', 'SWITCH_TRANSCEIVER', 'HmIP-X'), {}, 'SWITCH_VIRTUAL_RECEIVER'],
            [end('L:2', 'UNIVERSAL_LIGHT_RECEIVER', 'HmIP-LSC'), {}, 'UNIVERSAL_LIGHT_RECEIVER_LSC'],
        ];
        for (const [receiver, master, folder] of cases) {
            const types = await linkProfileTypes(
                'HmIP-RF',
                receiver,
                end('K:1', 'KEY_TRANSCEIVER', 'HmIP-WRC2'),
                answering({master}),
            );
            expect(types.receiverType).toBe(folder);
            expect(shipped.has(folder) || folder === 'SWITCH_VIRTUAL_RECEIVER').toBe(true);
        }
    });

    it('every file a dispatcher sources is reached and shipped', async () => {
        const unreached: string[] = [];
        for (const [folder, senders] of Object.entries(extract.dispatchers)) {
            for (const [sender, dispatcher] of Object.entries(senders)) {
                const targets = Object.keys(extract.pairs[dispatcher.folder] ?? {}).filter((name) =>
                    name.startsWith(`${sender}_`),
                );
                expect(targets.length, `${folder}/${sender}`).toBeGreaterThan(0);
                for (const target of targets) {
                    const suffix = target.slice(sender.length + 1);
                    const [n = '', variant = ''] = suffix.split('_');
                    // a receiver of this folder's own type, on the variant's device where the file is one
                    const receiver = end('R:3', folder, variant === '' ? 'HmIP-ANY' : `HmIP-${variant}`);
                    const senderEnd = end(`S:${dispatcher.by === 'channel' ? n : '1'}`, sender, 'HmIP-ANY');
                    const types = await linkProfileTypes(
                        'HmIP-RF',
                        receiver,
                        senderEnd,
                        answering({master: {'S:1': operationMode(Number(n))}}),
                    );
                    if (
                        types.receiverType !== dispatcher.folder ||
                        types.senderType !== target ||
                        shippedIds(types.receiverType, types.senderType) === undefined
                    ) {
                        unreached.push(`${folder}/${sender} -> ${dispatcher.folder}/${target}`);
                    }
                }
            }
        }
        expect(unreached).toEqual([]);
    });
});

describe('linkProfileTypes: HmIP (task 108)', () => {
    const DRBL4 = (firmware: string): LinkEnd =>
        end('0029DRBL400001:2', 'BLIND_VIRTUAL_RECEIVER', 'HmIPW-DRBL4', {firmware});
    const DRI32 = end('0029DRI3200001:7', 'MULTI_MODE_INPUT_TRANSMITTER', 'HmIPW-DRI32', {firmware: '1.4.6'});

    it('a wired blind actuator run as a shutter takes the shutter profiles, a key input its mode', async () => {
        const queries = answering({master: {[DRI32.address]: operationMode(1)}});
        await expect(linkProfileTypes('HmIP-RF', DRBL4('1.6.2'), DRI32, queries)).resolves.toEqual({
            receiverType: 'SHUTTER_VIRTUAL_RECEIVER',
            senderType: 'MULTI_MODE_INPUT_TRANSMITTER_1',
        });
        expect(queries.asked).toEqual([`channelMode ${DRBL4('1.6.2').address}`, `master ${DRI32.address}`]);
    });

    it('takes the blind profiles when the channel is set to blind, and on a firmware before 1.6', async () => {
        const blind = answering({channelMode: {[DRBL4('1.6.2').address]: 'blind'}});
        expect((await linkProfileTypes('HmIP-RF', DRBL4('1.6.2'), DRI32, blind)).receiverType).toBe(
            'BLIND_VIRTUAL_RECEIVER',
        );
        const old = answering();
        expect((await linkProfileTypes('HmIP-RF', DRBL4('1.4.12'), DRI32, old)).receiverType).toBe(
            'BLIND_VIRTUAL_RECEIVER',
        );
        expect(old.asked).not.toContain(`channelMode ${DRBL4('1.4.12').address}`);
        for (const parentType of ['HmIP-DRBLI4', 'HmIP-FBL']) {
            const receiver = end('B:2', 'BLIND_VIRTUAL_RECEIVER', parentType, {firmware: '2.0.0'});
            expect((await linkProfileTypes('HmIP-RF', receiver, DRI32)).receiverType).toBe('SHUTTER_VIRTUAL_RECEIVER');
        }
        const noFirmware = end('B:2', 'BLIND_VIRTUAL_RECEIVER', 'HmIPW-DRBL4');
        expect((await linkProfileTypes('HmIP-RF', noFirmware, DRI32)).receiverType).toBe('BLIND_VIRTUAL_RECEIVER');
    });

    it('reads the input mode as hmipserver answers it (an index) or as a name', async () => {
        for (const [mode, file] of [
            [2, 'MULTI_MODE_INPUT_TRANSMITTER_2'],
            ['BINARY_BEHAVIOR', 'MULTI_MODE_INPUT_TRANSMITTER_3'],
            ['1', 'MULTI_MODE_INPUT_TRANSMITTER_1'],
        ] as const) {
            const queries = answering({master: {[DRI32.address]: operationMode(mode)}});
            expect((await linkProfileTypes('HmIP-RF', DRBL4('1.6.2'), DRI32, queries)).senderType).toBe(file);
        }
    });

    it('leaves the dispatcher type as it is when the mode cannot be read', async () => {
        await expect(linkProfileTypes('HmIP-RF', DRBL4('1.6.2'), DRI32)).resolves.toEqual({
            receiverType: 'SHUTTER_VIRTUAL_RECEIVER',
            senderType: 'MULTI_MODE_INPUT_TRANSMITTER',
        });
        const failing: LinkTypeQueries = {
            master: () => Promise.reject(new Error('down')),
            channelMode: () => Promise.reject(new Error('down')),
        };
        await expect(linkProfileTypes('HmIP-RF', DRBL4('1.6.2'), DRI32, failing)).resolves.toEqual({
            receiverType: 'SHUTTER_VIRTUAL_RECEIVER',
            senderType: 'MULTI_MODE_INPUT_TRANSMITTER',
        });
    });

    it('a key channel (KEY_TRANSCEIVER) keeps its type', async () => {
        const wrc6 = end('0029WRC600001:3', 'KEY_TRANSCEIVER', 'HmIPW-WRC6');
        const queries = answering();
        await expect(linkProfileTypes('HmIP-RF', DRBL4('1.6.2'), wrc6, queries)).resolves.toEqual({
            receiverType: 'SHUTTER_VIRTUAL_RECEIVER',
            senderType: 'KEY_TRANSCEIVER',
        });
        expect(queries.asked).not.toContain(`master ${wrc6.address}`);
    });

    it('a rotary control by its channel number', async () => {
        const rotary = end('R:3', 'ROTARY_CONTROL_TRANSCEIVER', 'HmIP-WRCR');
        const dimmer = end('D:2', 'DIMMER_VIRTUAL_RECEIVER', 'HmIP-PDT');
        await expect(linkProfileTypes('HmIP-RF', dimmer, rotary)).resolves.toEqual({
            receiverType: 'DIMMER_VIRTUAL_RECEIVER',
            senderType: 'ROTARY_CONTROL_TRANSCEIVER_3',
        });
    });

    it('the universal actor and the PWM light take the dimmer folder for an input', async () => {
        const wua = end('U:2', 'DIMMER_VIRTUAL_RECEIVER', 'ELV-SH-WUA');
        const queries = answering({master: {[DRI32.address]: operationMode(1)}});
        await expect(linkProfileTypes('HmIP-RF', wua, DRI32, queries)).resolves.toEqual({
            receiverType: 'DIMMER_VIRTUAL_RECEIVER',
            senderType: 'MULTI_MODE_INPUT_TRANSMITTER_1',
        });
        const key = end('K:1', 'KEY_TRANSCEIVER', 'HmIP-WRC2');
        expect((await linkProfileTypes('HmIP-RF', wua, key)).receiverType).toBe('UNIVERSAL_ACTOR');
    });

    it('HmIP-FDC has a key profile of its own', async () => {
        const fdc = end('F:3', 'SWITCH_VIRTUAL_RECEIVER', 'HmIP-FDC');
        const fci = end('C:1', 'MULTI_MODE_INPUT_TRANSMITTER', 'HmIP-FCI6');
        const key = answering({master: {'C:1': operationMode(1)}});
        expect((await linkProfileTypes('HmIP-RF', fdc, fci, key)).senderType).toBe(
            'MULTI_MODE_INPUT_TRANSMITTER_1_FDC',
        );
        const binary = answering({master: {'C:1': operationMode(3)}});
        expect((await linkProfileTypes('HmIP-RF', fdc, fci, binary)).senderType).toBe('MULTI_MODE_INPUT_TRANSMITTER_3');
        const water = end('W:3', 'WATER_SWITCH_VIRTUAL_RECEIVER', 'HmIP-FDC');
        await expect(linkProfileTypes('HmIP-RF', water, fci, key)).resolves.toEqual({
            receiverType: 'SWITCH_VIRTUAL_RECEIVER',
            senderType: 'MULTI_MODE_INPUT_TRANSMITTER_1_FDC',
        });
    });

    it('HmIP-MOD-RC8 key channels by their mode, where the receiver file reads it', async () => {
        const rc8 = end('M:1', 'KEY_TRANSCEIVER', 'HmIP-MOD-RC8');
        const svr = end('S:3', 'SWITCH_VIRTUAL_RECEIVER', 'HmIP-PS');
        for (const [mode, type] of [
            [2, 'SWITCH_TRANSCEIVER'],
            [3, 'SHUTTER_CONTACT'],
            [1, 'KEY_TRANSCEIVER'],
        ] as const) {
            const queries = answering({master: {'M:1': operationMode(mode)}});
            expect((await linkProfileTypes('HmIP-RF', svr, rc8, queries)).senderType).toBe(type);
        }
        // the heating receivers' files do not
        const heating = end('H:1', 'HEATING_KEY_RECEIVER', 'HmIP-eTRV');
        const queries = answering({master: {'M:1': operationMode(2)}});
        expect((await linkProfileTypes('HmIP-RF', heating, rc8, queries)).senderType).toBe('KEY_TRANSCEIVER');
        expect(queries.asked).toEqual([]);
    });

    it('level command senders as the conditional switch files, CO2 apart on a switch', async () => {
        const co2 = end('C:4', 'LEVEL_COMMAND_TRANSMITTER_CO2', 'HmIP-SCTH230');
        const svr = end('S:3', 'SWITCH_VIRTUAL_RECEIVER', 'HmIP-PS');
        const dimmer = end('D:3', 'DIMMER_VIRTUAL_RECEIVER', 'HmIP-PDT');
        expect((await linkProfileTypes('HmIP-RF', svr, co2)).senderType).toBe('COND_SWITCH_TRANSMITTER_CO2');
        expect((await linkProfileTypes('HmIP-RF', dimmer, co2)).senderType).toBe('COND_SWITCH_TRANSMITTER');
        const unknown = end('X:1', 'SOMETHING', 'HmIP-X');
        expect((await linkProfileTypes('HmIP-RF', unknown, co2)).senderType).toBe('LEVEL_COMMAND_TRANSMITTER_CO2');
    });

    it('the universal light receiver by the device and its mode', async () => {
        const key = end('K:1', 'KEY_TRANSCEIVER', 'HmIP-WRC2');
        const rgbw = end('RGBW1:2', 'UNIVERSAL_LIGHT_RECEIVER', 'HmIP-RGBW');
        const deviceMode = (value: number): Record<string, MasterRead> => ({
            'RGBW1:0': {values: {DEVICE_OPERATION_MODE: value}},
        });
        for (const [mode, folder] of [
            [0, 'UNIVERSAL_LIGHT_RECEIVER_RGB(W)'],
            [1, 'UNIVERSAL_LIGHT_RECEIVER_RGB(W)'],
            [2, 'UNIVERSAL_LIGHT_RECEIVER_TW'],
            [3, 'UNIVERSAL_LIGHT_RECEIVER_PWM'],
            [9, 'UNIVERSAL_LIGHT_RECEIVER'],
        ] as const) {
            const types = await linkProfileTypes('HmIP-RF', rgbw, key, answering({master: deviceMode(mode)}));
            expect(types.receiverType).toBe(folder);
        }
        const dali = end('DALI1:2', 'UNIVERSAL_LIGHT_RECEIVER', 'HmIP-DRG-DALI');
        for (const [mode, folder] of [
            [0, 'SWITCH_VIRTUAL_RECEIVER'],
            [1, 'UNIVERSAL_LIGHT_RECEIVER_PWM'],
            [2, 'UNIVERSAL_LIGHT_RECEIVER_TW'],
            [3, 'UNIVERSAL_LIGHT_RECEIVER_RGBW_DALI'],
            [4, 'UNIVERSAL_LIGHT_RECEIVER_RGBW_DALI'],
            [7, 'UNIVERSAL_LIGHT_RECEIVER'],
        ] as const) {
            const queries = answering({master: {'DALI1:2': {values: {UNIVERSAL_LIGHT_MAX_CAPABILITIES: mode}}}});
            expect((await linkProfileTypes('HmIP-RF', dali, key, queries)).receiverType).toBe(folder);
        }
        const other = end('X:2', 'UNIVERSAL_LIGHT_RECEIVER', 'HmIP-OTHER');
        expect((await linkProfileTypes('HmIP-RF', other, key)).receiverType).toBe('UNIVERSAL_LIGHT_RECEIVER');
    });

    it('asks a MASTER once per address, however many rules read it', async () => {
        let reads = 0;
        const queries: LinkTypeQueries = {
            master: () => {
                reads += 1;
                return Promise.resolve(operationMode(1));
            },
        };
        const svr = end('S:3', 'SWITCH_VIRTUAL_RECEIVER', 'HmIP-PS');
        const rc8 = end('M:1', 'KEY_TRANSCEIVER', 'HmIP-MOD-RC8');
        await linkProfileTypes('HmIP-RF', svr, rc8, queries);
        expect(reads).toBe(1);
    });
});

describe('linkProfileTypes: BidCos (task 108)', () => {
    it('a wired actor: HMW_ folder, the sender file by its input type', async () => {
        const actor = end('LEQ1:13', 'SWITCH', 'HMW-IO-12-Sw7-DR');
        const key = end('LEQ1:1', 'KEY', 'HMW-IO-12-Sw7-DR');
        const queries = answering({
            paramsetId: {'LEQ1:13': 'hmw_switch_ch_link'},
            master: {
                'LEQ1:1': {
                    values: {INPUT_TYPE: 'SWITCH'},
                    description: {INPUT_TYPE: {TYPE: 'ENUM', OPERATIONS: 7, VALUE_LIST: ['SWITCH', 'PUSHBUTTON']}},
                },
            },
        });
        await expect(linkProfileTypes('BidCos-Wired', actor, key, queries)).resolves.toEqual({
            receiverType: 'HMW_SWITCH',
            senderType: 'KEY_0',
        });
        const virtual = end('BidCoS-Wir:1', 'VIRTUAL_KEY', 'HMW-RCV-50');
        expect((await linkProfileTypes('BidCos-Wired', actor, virtual, queries)).senderType).toBe('VIRTUAL_KEY_1');
        expect(shippedIds('HMW_SWITCH', 'KEY_0')).toBeDefined();
        expect(shippedIds('HMW_SWITCH', 'VIRTUAL_KEY_1')).toBeDefined();
    });

    it('a signal LED with a linked key pair, and the MP3 variant', async () => {
        const led = end('LED1:1', 'SIGNAL_LED', 'HM-OU-LED16');
        const key = end('KEY1:1', 'KEY', 'HM-RC-4-2', {group: 'KEY1:2'});
        const paired = answering({paramsetId: {'LED1:1': 'signal_led_ch_link'}, links: ['KEY1:2>LED1:1']});
        expect((await linkProfileTypes('BidCos-RF', led, key, paired)).senderType).toBe('KEY_PAIR');
        const single = answering({paramsetId: {'LED1:1': 'signal_led_ch_link'}});
        expect((await linkProfileTypes('BidCos-RF', led, key, single)).senderType).toBe('KEY');
        const mp3 = answering({paramsetId: {'LED1:1': 'signal_mled_ch_link'}});
        expect((await linkProfileTypes('BidCos-RF', led, end('K:1', 'KEY', 'HM-PB-2-WM55'), mp3)).receiverType).toBe(
            'SIGNAL_LEDM',
        );
        expect(shippedIds('SIGNAL_LED', 'KEY_PAIR')).toBeDefined();
    });

    it('a virtual dimmer and the dual-white brightness as DIMMER, a WDS100 sender with _2', async () => {
        const key = end('K:1', 'KEY', 'HM-PB-2-WM55');
        const virtual = end('D:4', 'VIRTUAL_DIMMER', 'HM-LC-Dim1T-FM');
        const ids = answering({
            paramsetId: {'D:4': 'dimmer_ch_link', 'DW:1': 'dw_controller_brightness_ch_link', 'S:1': 'switch_ch_link'},
        });
        expect((await linkProfileTypes('BidCos-RF', virtual, key, ids)).receiverType).toBe('DIMMER');
        const dw = end('DW:1', 'DUAL_WHITE_BRIGHTNESS', 'HM-LC-DW-WM');
        expect((await linkProfileTypes('BidCos-RF', dw, key, ids)).receiverType).toBe('DIMMER');
        const sw = end('S:1', 'SWITCH', 'HM-LC-Sw1-FM');
        const wds = end('W:1', 'WEATHER', 'HM-WDS100-C6-O-2');
        await expect(linkProfileTypes('BidCos-RF', sw, wds, ids)).resolves.toEqual({
            receiverType: 'SWITCH',
            senderType: 'WEATHER_2',
        });
    });

    it('keeps the types where the paramset id is unknown, missing, or a Tcl list with a mapping', async () => {
        const sw = end('S:1', 'SWITCH', 'HM-LC-Sw1-FM');
        const key = end('K:1', 'KEY', 'HM-PB-2-WM55');
        await expect(linkProfileTypes('BidCos-RF', sw, key)).resolves.toEqual({
            receiverType: 'SWITCH',
            senderType: 'KEY',
        });
        const listed = answering({paramsetId: {'S:1': 'foo x=hmw_switch_ch_link'}});
        expect((await linkProfileTypes('BidCos-Wired', sw, key, listed)).receiverType).toBe('HMW_SWITCH');
        const failing: LinkTypeQueries = {linkParamsetId: () => Promise.reject(new Error('fault'))};
        expect((await linkProfileTypes('BidCos-RF', sw, key, failing)).receiverType).toBe('SWITCH');
    });
});

describe('helpers (task 108)', () => {
    it('isHmipInterface', () => {
        expect(isHmipInterface('HmIP-RF')).toBe(true);
        expect(isHmipInterface('HmIP-Wired')).toBe(true);
        expect(isHmipInterface('BidCos-Wired')).toBe(false);
    });

    it('enumValueIndex', () => {
        expect(enumValueIndex(2, undefined)).toBe(2);
        expect(enumValueIndex(true, undefined)).toBe(1);
        expect(enumValueIndex(false, undefined)).toBe(0);
        expect(enumValueIndex('3', undefined)).toBe(3);
        expect(enumValueIndex('B', ['A', 'B'])).toBe(1);
        expect(enumValueIndex('C', ['A', 'B'])).toBeUndefined();
        expect(enumValueIndex('', ['A'])).toBeUndefined();
        expect(enumValueIndex(undefined, ['A'])).toBeUndefined();
    });
});

describe('recognising a CCU-made link of a wired blind actuator (task 108)', () => {
    const {description} = JSON.parse(
        readFileSync(new URL('../../test/fixtures/hmip-blind-link.json', import.meta.url), 'utf8'),
    ) as {description: ParamsetDescription};
    const engine = new EasyModeEngine(new MemoryDataSource({profiles: Object.fromEntries(shipped)}));
    const drbl4 = end('0029DRBL400001:2', 'BLIND_VIRTUAL_RECEIVER', 'HmIPW-DRBL4', {firmware: '1.6.2'});
    const dri32 = end('0029DRI3200001:7', 'MULTI_MODE_INPUT_TRANSMITTER', 'HmIPW-DRI32');
    const wrc6 = end('0029WRC600001:3', 'KEY_TRANSCEIVER', 'HmIPW-WRC6');
    const key = answering({master: {[dri32.address]: operationMode('KEY_BEHAVIOR')}});

    it('before task 108 an input of a wired input module offered the expert profile only', async () => {
        const raw = await engine.profilesFor(drbl4.type, dri32.type);
        expect(raw.map((profile) => profile.id)).toEqual([EXPERT_PROFILE_ID]);
    });

    it('offers the shutter profiles and recognises each of them on a link the CCU wrote', async () => {
        for (const sender of [dri32, wrc6]) {
            const types = await linkProfileTypes('HmIP-RF', drbl4, sender, key);
            const profiles = await engine.profilesFor(types.receiverType, types.senderType);
            expect(profiles.length, `${types.receiverType}/${types.senderType}`).toBeGreaterThan(4);
            for (const profile of profiles.filter((entry) => entry.id !== EXPERT_PROFILE_ID)) {
                // what the WebUI writes for a profile: its presets (HmIP links carry no UI_HINT)
                const {values} = engine.applyProfile(profile, {}, description, {keepCurrent: false});
                expect(engine.detectProfile(values, profiles)?.key, `${types.senderType}: ${profile.key}`).toBe(
                    profile.key,
                );
            }
        }
    });
});
