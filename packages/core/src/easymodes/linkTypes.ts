/**
 * Task 108: which receiver folder and sender file of the easy-mode data a link's profiles come
 * from - the step the CCU's WebUI takes before it shows a single profile.
 *
 * `ic_setprofiles.cgi` does not open `<RECEIVER_TYPE>/<SENDER_TYPE>.tcl` directly. It opens
 * `linkHmIP_<RECEIVER_TYPE>.tcl` for an HmIP receiver, or the `<paramid>.tcl` its LINK paramset id
 * names for a BidCos one, and that file chooses the folder and the sender file; inside the folder,
 * a sender file may again be only a dispatcher that sources another by a value read at run time.
 * Looking the profiles up by the raw channel types, as hmm did up to 3.4.0, gave every link whose
 * WebUI file is chosen that way the expert profile only - HmIPW-DRI16/DRI32 inputs above all,
 * whose channels are `MULTI_MODE_INPUT_TRANSMITTER` - or another device's profiles (a wired blind
 * actuator run as a shutter got the blind profiles).
 *
 * The rules below are those of the WebUI's easymode tree (OpenCCU-Base `www/config/easymodes`);
 * `data/extracted/easymode_links.json` is extracted from it by `data/scripts/easymode-links.mjs`,
 * and `linkTypes.test.ts` fails for every rule of it this module does not follow.
 *
 * Pure: whatever has to be read from the interface (a MASTER paramset, the `channelMode`
 * metadata, a LINK paramset id, whether a link exists) is asked through {@link LinkTypeQueries},
 * and only when a rule needs it.
 */

import type {ParamsetDescription} from '../paramset/description.js';
import type {Paramset, ParamsetValue} from '../rpc/values.js';

/** What the device list says about one end of a link. */
export interface LinkEnd {
    /** The channel address, `<device>:<n>`. */
    readonly address: string;
    /** The channel type (`TYPE`). */
    readonly type: string;
    /** The device type (`PARENT_TYPE`). */
    readonly parentType: string;
    /** The device's firmware (`FIRMWARE` of the parent). */
    readonly firmware?: string;
    /** The channel's key-pair partner (`GROUP`), BidCos only. */
    readonly group?: string;
}

/** A MASTER paramset with its description, so an enum read as a name can be turned into its index. */
export interface MasterRead {
    readonly values: Paramset;
    readonly description?: ParamsetDescription;
}

/** The reads a rule may need; each is asked at most once per resolution, and only where a rule needs it. */
export interface LinkTypeQueries {
    /** `getParamset(address, MASTER)`. */
    readonly master?: (address: string) => Promise<MasterRead | undefined>;
    /** `getMetadata(address, 'channelMode')`; `''` where unset. */
    readonly channelMode?: (address: string) => Promise<string>;
    /** `getParamsetId(address, LINK)`; `''` where the interface does not answer. */
    readonly linkParamsetId?: (address: string) => Promise<string>;
    /** Whether a link `sender → receiver` exists (`getLinkInfo` answers). */
    readonly linked?: (sender: string, receiver: string) => Promise<boolean>;
}

/** The receiver folder and sender file of the profile data, where the WebUI takes them from. */
export interface LinkProfileTypes {
    readonly receiverType: string;
    readonly senderType: string;
}

/**
 * The sender files a `MULTI_MODE_INPUT_TRANSMITTER` / `ROTARY_CONTROL_TRANSCEIVER` dispatcher of a
 * receiver folder sources from, and from which folder (the WebUI's `UNIVERSAL_ACTOR` and
 * `UNIVERSAL_LIGHT_RECEIVER_PWM` take `DIMMER_VIRTUAL_RECEIVER`'s files).
 */
export interface LinkDispatcher {
    readonly by: 'CHANNEL_OPERATION_MODE' | 'channel';
    readonly folder: string;
    /** HmIP-FDC's key mode has a file of its own (`MULTI_MODE_INPUT_TRANSMITTER_1_FDC`). */
    readonly variant?: {readonly deviceType: string; readonly mode: number; readonly suffix: string};
}

const MULTI = 'MULTI_MODE_INPUT_TRANSMITTER';
const ROTARY = 'ROTARY_CONTROL_TRANSCEIVER';
const FDC = {deviceType: 'HmIP-FDC', mode: 1, suffix: '_FDC'} as const;

function multi(folder: string, variant?: LinkDispatcher['variant']): LinkDispatcher {
    return variant ? {by: 'CHANNEL_OPERATION_MODE', folder, variant} : {by: 'CHANNEL_OPERATION_MODE', folder};
}
function rotary(folder: string): LinkDispatcher {
    return {by: 'channel', folder};
}

/** The dispatcher files of the WebUI's receiver folders, by folder and sender type. */
export const LINK_DISPATCHERS: Readonly<Record<string, Readonly<Record<string, LinkDispatcher>>>> = {
    ACCESS_RECEIVER: {[MULTI]: multi('ACCESS_RECEIVER')},
    ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER: {[MULTI]: multi('ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER')},
    ALARM_SWITCH_VIRTUAL_RECEIVER: {[MULTI]: multi('ALARM_SWITCH_VIRTUAL_RECEIVER')},
    AUTO_RELOCK_TRANSCEIVER: {[MULTI]: multi('AUTO_RELOCK_TRANSCEIVER')},
    BLIND_VIRTUAL_RECEIVER: {[MULTI]: multi('BLIND_VIRTUAL_RECEIVER'), [ROTARY]: rotary('BLIND_VIRTUAL_RECEIVER')},
    DIMMER_VIRTUAL_RECEIVER: {[MULTI]: multi('DIMMER_VIRTUAL_RECEIVER'), [ROTARY]: rotary('DIMMER_VIRTUAL_RECEIVER')},
    DOOR_LOCK_TRANSCEIVER: {[MULTI]: multi('DOOR_LOCK_TRANSCEIVER')},
    DOOR_RECEIVER: {[MULTI]: multi('DOOR_RECEIVER')},
    HEATING_KEY_RECEIVER: {[MULTI]: multi('HEATING_KEY_RECEIVER')},
    SHUTTER_VIRTUAL_RECEIVER: {
        [MULTI]: multi('SHUTTER_VIRTUAL_RECEIVER'),
        [ROTARY]: rotary('SHUTTER_VIRTUAL_RECEIVER'),
    },
    SIMPLE_SWITCH_RECEIVER: {[MULTI]: multi('SIMPLE_SWITCH_RECEIVER')},
    STATE_RESET_RECEIVER: {[MULTI]: multi('STATE_RESET_RECEIVER')},
    SWITCH_VIRTUAL_RECEIVER: {
        [MULTI]: multi('SWITCH_VIRTUAL_RECEIVER', FDC),
        [ROTARY]: rotary('SWITCH_VIRTUAL_RECEIVER'),
    },
    UNIVERSAL_ACTOR: {[MULTI]: multi('DIMMER_VIRTUAL_RECEIVER'), [ROTARY]: rotary('DIMMER_VIRTUAL_RECEIVER')},
    UNIVERSAL_LIGHT_RECEIVER_LSC: {
        [MULTI]: multi('UNIVERSAL_LIGHT_RECEIVER_LSC'),
        [ROTARY]: rotary('UNIVERSAL_LIGHT_RECEIVER_LSC'),
    },
    UNIVERSAL_LIGHT_RECEIVER_PWM: {
        [MULTI]: multi('DIMMER_VIRTUAL_RECEIVER'),
        [ROTARY]: rotary('DIMMER_VIRTUAL_RECEIVER'),
    },
    'UNIVERSAL_LIGHT_RECEIVER_RGB(W)': {[MULTI]: multi('UNIVERSAL_LIGHT_RECEIVER_RGB(W)')},
    UNIVERSAL_LIGHT_RECEIVER_RGBW_DALI: {[MULTI]: multi('UNIVERSAL_LIGHT_RECEIVER_RGBW_DALI')},
    UNIVERSAL_LIGHT_RECEIVER_TW: {[MULTI]: multi('UNIVERSAL_LIGHT_RECEIVER_TW')},
    WATER_SWITCH_VIRTUAL_RECEIVER: {
        [MULTI]: multi('SWITCH_VIRTUAL_RECEIVER', FDC),
        [ROTARY]: rotary('SWITCH_VIRTUAL_RECEIVER'),
    },
};

const LEVEL_COMMAND: Readonly<Record<string, string>> = {
    LEVEL_COMMAND_TRANSMITTER_CO2: 'COND_SWITCH_TRANSMITTER',
    LEVEL_COMMAND_TRANSMITTER_HUMIDITY: 'COND_SWITCH_TRANSMITTER_HUMIDITY',
    LEVEL_COMMAND_TRANSMITTER_TEMPERATURE: 'COND_SWITCH_TRANSMITTER_TEMPERATURE',
};

/** What a `linkHmIP_<RECEIVER_TYPE>.tcl` does to the sender type. */
export interface HmipLinkFile {
    /** It reads an HmIP-MOD-RC8 key channel's `CHANNEL_OPERATION_MODE` (2: switch, 3: shutter contact). */
    readonly modRc8: boolean;
    /** `LEVEL_COMMAND_TRANSMITTER_*` senders it opens another sender file for. */
    readonly levelCommand: Readonly<Record<string, string>>;
}

const file = (modRc8: boolean, levelCommand: Readonly<Record<string, string>> = {}): HmipLinkFile => ({
    modRc8,
    levelCommand,
});

/**
 * The WebUI's `linkHmIP_<RECEIVER_TYPE>.tcl` files. An HmIP receiver type without one has no easy
 * mode in the WebUI (`receiver_paramid` stays empty); hmm still offers what the data has for it.
 */
export const HMIP_LINK_FILES: Readonly<Record<string, HmipLinkFile>> = {
    ACCESS_RECEIVER: file(true),
    ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER: file(true, LEVEL_COMMAND),
    ALARM_COND_SWITCH_RECEIVER: file(false),
    ALARM_SWITCH_VIRTUAL_RECEIVER: file(true, LEVEL_COMMAND),
    AUTO_RELOCK_TRANSCEIVER: file(true),
    BLIND_VIRTUAL_RECEIVER: file(true, LEVEL_COMMAND),
    CLIMATECONTROL_FLOOR_PUMP_TRANSCEIVER: file(false),
    CLIMATECONTROL_FLOOR_TRANSCEIVER: file(false),
    CLIMATECONTROL_INPUT_RECEIVER: file(false),
    DIMMER_VIRTUAL_RECEIVER: file(true, LEVEL_COMMAND),
    DOOR_LOCK_TRANSCEIVER: file(true),
    DOOR_RECEIVER: file(true),
    HEATING_CLIMATECONTROL_CL_RECEIVER: file(false),
    HEATING_CLIMATECONTROL_RECEIVER: file(false),
    HEATING_KEY_RECEIVER: file(false),
    HEATING_ROOM_TH_RECEIVER: file(false),
    HEATING_SHUTTER_CONTACT_RECEIVER: file(false),
    OPTICAL_SIGNAL_RECEIVER: file(true),
    SERVO_VIRTUAL_RECEIVER: file(true),
    SHUTTER_VIRTUAL_RECEIVER: file(true, LEVEL_COMMAND),
    SIMPLE_SWITCH_RECEIVER: file(true),
    STATE_RESET_RECEIVER: file(false),
    SWITCH_TRANSCEIVER: file(true, LEVEL_COMMAND),
    // the only one that keeps the CO2 sender apart
    SWITCH_VIRTUAL_RECEIVER: file(true, {
        ...LEVEL_COMMAND,
        LEVEL_COMMAND_TRANSMITTER_CO2: 'COND_SWITCH_TRANSMITTER_CO2',
    }),
    UNIVERSAL_LIGHT_RECEIVER: file(true, LEVEL_COMMAND),
    WATER_SWITCH_VIRTUAL_RECEIVER: file(true, LEVEL_COMMAND),
    WINDOW_DRIVE_RECEIVER: file(false, LEVEL_COMMAND),
};

/** What a BidCos `<paramid>.tcl` link dispatcher does beyond `<TYPE>/<SENDER_TYPE>.tcl`. */
export interface BidcosLinkFile {
    /** `HMW_` + type (wired actors), type + `M` (the MP3 chime/LED), or a fixed folder. */
    readonly receiver?: 'HMW_' | 'M' | 'DIMMER';
    /** `VIRTUAL_DIMMER` channels use the `DIMMER` folder. */
    readonly virtualDimmer?: 'DIMMER';
    /** The sender file is `<TYPE>_<INPUT_TYPE>` (the sender's MASTER; `1` where it has none). */
    readonly inputType?: boolean;
    /** The sender file is `<TYPE>_PAIR` when the sender's key-pair partner is linked to the receiver too. */
    readonly pair?: boolean;
    /** A sender of this device type uses `<TYPE><suffix>`. */
    readonly senderSuffix?: {readonly deviceType: string; readonly suffix: string};
}

const WDS100 = {senderSuffix: {deviceType: 'HM-WDS100-C6-O-2', suffix: '_2'}} as const;

/** The BidCos link dispatchers that do more than open `<TYPE>/<SENDER_TYPE>.tcl`, by paramset id. */
export const BIDCOS_LINK_FILES: Readonly<Record<string, BidcosLinkFile>> = {
    alarmactuator_ch_link: WDS100,
    blind_ch_link: WDS100,
    dimmer_ch_link: {virtualDimmer: 'DIMMER'},
    dw_controller_brightness_ch_link: {receiver: 'DIMMER'},
    hmw_blind_ch_link: {receiver: 'HMW_', inputType: true},
    hmw_dimmer_ch_link: {receiver: 'HMW_', inputType: true},
    hmw_switch_ch_link: {receiver: 'HMW_', inputType: true},
    jalousie_ch_link: WDS100,
    signal_chime_ch_link: {pair: true},
    signal_led_ch_link: {pair: true},
    signal_mchime_ch_link: {receiver: 'M', pair: true},
    signal_mled_ch_link: {receiver: 'M', pair: true},
    statusindicator_ch_link: WDS100,
    switch_ch_link: WDS100,
};

/** Whether an interface is served by hmipserver, where the WebUI takes the `linkHmIP_*` route. */
export function isHmipInterface(interfaceName: string): boolean {
    return interfaceName.startsWith('HmIP');
}

/**
 * An enum read from a MASTER paramset as the number the WebUI's Tcl compares: HmIP answers the
 * index, a name is looked up in the description's `VALUE_LIST`. `undefined` when neither works.
 */
export function enumValueIndex(
    value: ParamsetValue | undefined,
    values: readonly string[] | undefined,
): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value !== 'string' || value === '') return undefined;
    if (/^\d+$/u.test(value)) return Number(value);
    const at = values?.indexOf(value) ?? -1;
    return at >= 0 ? at : undefined;
}

/** `x.y.z` >= `major.minor`, as `linkHmIP_BLIND_VIRTUAL_RECEIVER.tcl` compares a firmware. */
function firmwareAtLeast(firmware: string | undefined, major: number, minor: number): boolean {
    const [a = 'x', b = 'x'] = (firmware ?? '').split('.');
    const fwMajor = Number.parseInt(a, 10);
    const fwMinor = Number.parseInt(b, 10);
    if (Number.isNaN(fwMajor) || Number.isNaN(fwMinor)) return false;
    return fwMajor > major || (fwMajor === major && fwMinor >= minor);
}

function channelNumber(address: string): string {
    return address.slice(address.lastIndexOf(':') + 1);
}

function deviceAddress(address: string): string {
    const at = address.lastIndexOf(':');
    return at < 0 ? address : address.slice(0, at);
}

/** One MASTER read per address within one resolution. */
function cachedMaster(queries: LinkTypeQueries): (address: string) => Promise<MasterRead | undefined> {
    const cache = new Map<string, Promise<MasterRead | undefined>>();
    return (address) => {
        let entry = cache.get(address);
        if (!entry) {
            entry = (queries.master?.(address) ?? Promise.resolve(undefined)).catch(() => undefined);
            cache.set(address, entry);
        }
        return entry;
    };
}

async function masterEnum(
    master: (address: string) => Promise<MasterRead | undefined>,
    address: string,
    param: string,
): Promise<number | undefined> {
    const read = await master(address);
    return enumValueIndex(read?.values[param], read?.description?.[param]?.VALUE_LIST);
}

async function ask<T>(question: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
    if (!question) return fallback;
    try {
        return await question();
    } catch {
        return fallback;
    }
}

/** `linkHmIP_<TYPE>.tcl`'s receiver part: the folder its profiles come from. */
async function hmipReceiver(
    receiver: LinkEnd,
    queries: LinkTypeQueries,
    master: (address: string) => Promise<MasterRead | undefined>,
): Promise<string> {
    const {type, parentType} = receiver;
    if (type === 'BLIND_VIRTUAL_RECEIVER') {
        const wired = parentType.split('-')[0] === 'HmIPW' || parentType === 'HmIP-DRBLI4' || parentType === 'HmIP-FBL';
        if (wired && firmwareAtLeast(receiver.firmware, 1, 6)) {
            const mode = await ask(() => queries.channelMode?.(receiver.address) ?? Promise.resolve(''), '');
            return mode === '' || mode === 'shutter' ? 'SHUTTER_VIRTUAL_RECEIVER' : 'BLIND_VIRTUAL_RECEIVER';
        }
        return type;
    }
    if (type === 'DIMMER_VIRTUAL_RECEIVER' && (parentType === 'HmIP-WUA' || parentType === 'ELV-SH-WUA')) {
        return 'UNIVERSAL_ACTOR';
    }
    if (type === 'UNIVERSAL_LIGHT_RECEIVER') {
        if (parentType === 'HmIP-RGBW') {
            // 0 = RGBW, 1 = RGB, 2 = tunable white, 3 = PWM
            const mode = await masterEnum(master, `${deviceAddress(receiver.address)}:0`, 'DEVICE_OPERATION_MODE');
            if (mode === 0 || mode === 1) return 'UNIVERSAL_LIGHT_RECEIVER_RGB(W)';
            if (mode === 2) return 'UNIVERSAL_LIGHT_RECEIVER_TW';
            if (mode === 3) return 'UNIVERSAL_LIGHT_RECEIVER_PWM';
            return type;
        }
        if (parentType === 'HmIP-DRG-DALI') {
            // 0 = switch, 1 = dimmer (PWM), 2 = tunable white, 3/4 = RGB + tunable white
            const mode = await masterEnum(master, receiver.address, 'UNIVERSAL_LIGHT_MAX_CAPABILITIES');
            if (mode === 0) return 'SWITCH_VIRTUAL_RECEIVER';
            if (mode === 1) return 'UNIVERSAL_LIGHT_RECEIVER_PWM';
            if (mode === 2) return 'UNIVERSAL_LIGHT_RECEIVER_TW';
            if (mode === 3 || mode === 4) return 'UNIVERSAL_LIGHT_RECEIVER_RGBW_DALI';
            return type;
        }
        if (parentType === 'HmIP-LSC') return 'UNIVERSAL_LIGHT_RECEIVER_LSC';
        return type;
    }
    if (type === 'OPTICAL_SIGNAL_RECEIVER') return 'DIMMER_VIRTUAL_RECEIVER';
    if (type === 'SWITCH_TRANSCEIVER') return 'SWITCH_VIRTUAL_RECEIVER';
    return type;
}

/** `linkHmIP_<TYPE>.tcl`'s sender part. */
async function hmipSender(
    receiver: LinkEnd,
    sender: LinkEnd,
    master: (address: string) => Promise<MasterRead | undefined>,
): Promise<string> {
    const rules = HMIP_LINK_FILES[receiver.type];
    if (!rules) return sender.type;
    if (rules.modRc8 && sender.type === 'KEY_TRANSCEIVER' && sender.parentType === 'HmIP-MOD-RC8') {
        const mode = await masterEnum(master, sender.address, 'CHANNEL_OPERATION_MODE');
        if (mode === 2) return 'SWITCH_TRANSCEIVER';
        if (mode === 3) return 'SHUTTER_CONTACT';
        return sender.type;
    }
    return rules.levelCommand[sender.type] ?? sender.type;
}

/** A dispatcher file inside the receiver folder: the folder and sender file it sources. */
async function dispatch(
    folder: string,
    senderType: string,
    receiver: LinkEnd,
    sender: LinkEnd,
    master: (address: string) => Promise<MasterRead | undefined>,
): Promise<LinkProfileTypes> {
    const dispatcher = LINK_DISPATCHERS[folder]?.[senderType];
    if (!dispatcher) return {receiverType: folder, senderType};
    if (dispatcher.by === 'channel') {
        return {receiverType: dispatcher.folder, senderType: `${senderType}_${channelNumber(sender.address)}`};
    }
    const mode = await masterEnum(master, sender.address, 'CHANNEL_OPERATION_MODE');
    if (mode === undefined) return {receiverType: folder, senderType};
    const variant =
        dispatcher.variant && receiver.parentType === dispatcher.variant.deviceType && mode === dispatcher.variant.mode
            ? dispatcher.variant.suffix
            : '';
    return {receiverType: dispatcher.folder, senderType: `${senderType}_${String(mode)}${variant}`};
}

async function bidcosTypes(
    receiver: LinkEnd,
    sender: LinkEnd,
    queries: LinkTypeQueries,
    master: (address: string) => Promise<MasterRead | undefined>,
): Promise<LinkProfileTypes> {
    const answer = await ask(() => queries.linkParamsetId?.(receiver.address) ?? Promise.resolve(''), '');
    // the WebUI's getExistingParamId: the first id of the (Tcl) list it has a file for
    const paramid = answer
        .trim()
        .split(/\s+/u)
        .map((word) => (word.includes('=') ? (word.split('=')[1] ?? '') : word))
        .find((id) => Object.prototype.hasOwnProperty.call(BIDCOS_LINK_FILES, id));
    const rules = paramid === undefined ? undefined : BIDCOS_LINK_FILES[paramid];
    if (!rules) return {receiverType: receiver.type, senderType: sender.type};

    let receiverType = receiver.type;
    if (rules.receiver === 'HMW_') receiverType = `HMW_${receiver.type}`;
    else if (rules.receiver === 'M') receiverType = `${receiver.type}M`;
    else if (rules.receiver === 'DIMMER') receiverType = 'DIMMER';
    if (rules.virtualDimmer && receiver.type === 'VIRTUAL_DIMMER') receiverType = rules.virtualDimmer;

    let senderType = sender.type;
    if (rules.senderSuffix && sender.parentType === rules.senderSuffix.deviceType) {
        senderType += rules.senderSuffix.suffix;
    }
    if (rules.inputType) {
        // `set IO "_1"` for a virtual key, `_$hmw(INPUT_TYPE)` where the sender has it
        senderType += `_${String((await masterEnum(master, sender.address, 'INPUT_TYPE')) ?? 1)}`;
    }
    if (rules.pair && sender.group !== undefined && sender.group !== '') {
        const group = sender.group;
        const linked = await ask(() => queries.linked?.(group, receiver.address) ?? Promise.resolve(false), false);
        if (linked) senderType += '_PAIR';
    }
    return {receiverType, senderType};
}

/**
 * The receiver folder and sender file the WebUI takes a link's profiles from. Without the reads a
 * rule needs (a query missing, failing or answering nothing), the rule leaves the type as it is,
 * which is what hmm did before.
 */
export async function linkProfileTypes(
    interfaceName: string,
    receiver: LinkEnd,
    sender: LinkEnd,
    queries: LinkTypeQueries = {},
): Promise<LinkProfileTypes> {
    const master = cachedMaster(queries);
    if (!isHmipInterface(interfaceName)) {
        return bidcosTypes(receiver, sender, queries, master);
    }
    const folder = await hmipReceiver(receiver, queries, master);
    const senderType = await hmipSender(receiver, sender, master);
    return dispatch(folder, senderType, receiver, sender, master);
}
