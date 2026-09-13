import type {DeviceDescription, ServiceMessage} from '@homematic-manager/core';
import {asStringList, deviceAddress} from '@homematic-manager/core';

/**
 * The two derived cells of the device grid that carry more than text: the service-message marks in
 * the "Msgs" column and the firmware column with its update button.
 *
 * Both were built inline as HTML strings in `refreshGridDevices()` (2.x, homematic-manager.js:1469)
 * and both got their state exactly once, when the grid was drawn - which is why the firmware button
 * of a device that had just been updated stayed there until the tab was switched (#95, #113). Here
 * the rules are pure functions and the grid re-renders from them.
 */

/** One mark in the Msgs column. `level` picks the colour token, so both themes stay legible. */
export interface ServiceMark {
    readonly datapoint: string;
    readonly symbol: string;
    readonly level: 'warn' | 'error';
    readonly title: string;
}

const MARKS: Readonly<Record<string, {symbol: string; level: 'warn' | 'error'}>> = {
    UNREACH: {symbol: '✖', level: 'error'},
    STICKY_UNREACH: {symbol: '✖', level: 'error'},
    LOWBAT: {symbol: '▮', level: 'warn'},
    LOW_BAT: {symbol: '▮', level: 'warn'},
    ERROR: {symbol: '⚠', level: 'error'},
    ERROR_CODE: {symbol: '⚠', level: 'error'},
    SABOTAGE: {symbol: '⚠', level: 'error'},
    // B-24: the HM-CC-RT-DN's fault report - a communication error, a stuck valve
    FAULT_REPORTING: {symbol: '⚠', level: 'error'},
    CONFIG_PENDING: {symbol: '⚙', level: 'warn'},
    UPDATE_PENDING: {symbol: '⇩', level: 'warn'},
};

/**
 * The width the Msgs column is designed with, and the narrowest the grid draws it (B-34): two marks
 * and the repair button that follows a `CONFIG_PENDING` on HmIP. At 48 px the button was cut off,
 * and the column could neither be dragged wider nor show a tooltip.
 */
export const SERVICE_MARKS_COLUMN_WIDTH = 84;

/**
 * The marks for one device, from the service messages of its channels. Unreachable first and at
 * most two of them, as 2.x did; {@link SERVICE_MARKS_COLUMN_WIDTH} has room for those two and the
 * repair button.
 */
export function serviceMarks(address: string, messages: readonly ServiceMessage[], limit = 2): ServiceMark[] {
    const marks: ServiceMark[] = [];
    for (const message of messages) {
        if (deviceAddress(message.address) !== address) {
            continue;
        }
        const mark = MARKS[message.datapoint];
        if (!mark) {
            continue;
        }
        const entry: ServiceMark = {
            datapoint: message.datapoint,
            symbol: mark.symbol,
            level: mark.level,
            title: `${message.datapoint} ${message.address}`,
        };
        if (mark.level === 'error') {
            marks.unshift(entry);
        } else {
            marks.push(entry);
        }
    }
    return marks.slice(0, limit);
}

/**
 * What a service message means, as a message key - and whether the "repair configuration" action is
 * any use against it.
 *
 * `CONFIG_PENDING` is the one that needs two texts, measured in the lab (task 6,
 * `docs/config-pending.md`): on BidCos it means "a configuration is queued and the device has not
 * picked it up yet", which is the normal state of a battery device for 160-300 s and clears by
 * itself - there is nothing to repair. On HmIP it means the configuration could not be transferred,
 * and the valid full MASTER re-write of `devices.repairConfig` is the recovery that was measured to
 * work. Offering the repair on BidCos would only queue another transfer the device is already
 * waiting for.
 */
export function serviceMessageExplanation(datapoint: string, hmip: boolean): string | undefined {
    if (datapoint !== 'CONFIG_PENDING') {
        return undefined;
    }
    return hmip
        ? 'The configuration could not be transferred to the device'
        : 'A configuration is queued; the device takes it when it next wakes up';
}

/**
 * What the description of a paramset an object lists turned out to hold (B-33): parameters,
 * nothing at all, or no answer - the interface refused or the connection failed.
 */
export type ParamsetContent = 'parameters' | 'empty' | 'failed';

/** The paramset buttons of one row, and whether a listed paramset is still being asked about. */
export interface OfferedParamsets {
    readonly names: string[];
    readonly pending: boolean;
}

/**
 * B-33: the paramsets a row of the device grid offers - as a button in the PARAMSETS cell and as an
 * entry of the context menu.
 *
 * Only what the object itself lists in `PARAMSETS`, and only when its description has parameters.
 * What interfaces list empty is mostly `MASTER` - every HmIP device, the virtual keys of the CCU's own
 * radio module - and a button for it opened an empty dialog. LINK is never a button: it is the Links
 * tab.
 *
 * SERVICE is never a button on a channel (the maintainer, 2026-09-13), whatever it holds: hmipserver
 * lists it on most HmIP channels and describes it there as a copy of the device's (lab, 2026-09-13),
 * so the device's button is the one place for it. It is not even asked about.
 *
 * A paramset whose description has not been answered yet is not offered: a button that appears is
 * better than one that appears and disappears under the pointer. One whose description failed is
 * offered, because hiding it would hide the failure too - the dialog reports it.
 */
export function offeredParamsets(
    listed: unknown,
    contentOf: (paramset: string) => ParamsetContent | undefined,
    row: {readonly channel: boolean} = {channel: false},
): OfferedParamsets {
    const names: string[] = [];
    let pending = false;
    for (const name of asStringList(listed) ?? []) {
        if (name === 'LINK' || (row.channel && name === 'SERVICE')) {
            continue;
        }
        const content = contentOf(name);
        if (content === undefined) {
            pending = true;
        } else if (content !== 'empty') {
            names.push(name);
        }
    }
    return {names, pending};
}

/** Is `devices.repairConfig` worth offering for this service message on this interface? */
export function offersRepair(datapoint: string, hmip: boolean): boolean {
    return hmip && datapoint === 'CONFIG_PENDING';
}

/** What the FIRMWARE column shows besides the version. */
export type FirmwareAction =
    /** rfd: `updateFirmware`, the interface fetches the image and sends it at the next wake-up. */
    | 'update'
    /** hmipserver: the image is on the access point already, `installFirmware` starts the flash. */
    | 'install';

export interface FirmwareCell {
    readonly firmware: string;
    /** The version the button offers, when there is one. */
    readonly available?: string;
    readonly action?: FirmwareAction;
    /** `deliver firmware image`, `performing update`, `update pending` - hmipserver's own words. */
    readonly status?: string;
    /** An update this session asked for has not shown up in `listDevices` yet. */
    readonly busy: boolean;
}

/** hmipserver's `FIRMWARE_UPDATE_STATE` values that are worth printing next to the version. */
const HMIP_STATUS = ['UP_TO_DATE', 'NEW_FIRMWARE_AVAILABLE', 'DELIVER_FIRMWARE_IMAGE', 'PERFORMING_UPDATE'];

/**
 * Is there really a new firmware on offer?
 *
 * Issue #153: hmipserver reports `AVAILABLE_FIRMWARE` `0.0.0` for its access points and for the
 * CCU's own radio module - "none", not a version - and pairs it with `READY_FOR_UPDATE`. The grid
 * took that at face value and offered to install 0.0.0 over a working 4.4.18.
 */
function hasOffer(available: string | undefined, firmware: string): available is string {
    return available !== undefined && available !== '' && available !== '0.0.0' && available !== firmware;
}

export function firmwareCell(
    device: DeviceDescription,
    options: {readonly busy?: boolean; readonly updatePending?: boolean} = {},
): FirmwareCell {
    const firmware = device.FIRMWARE ?? '';
    const available = device.AVAILABLE_FIRMWARE;
    const busy = options.busy === true;
    const state = device.FIRMWARE_UPDATE_STATE;

    if (state !== undefined && state !== '') {
        if (state === 'READY_FOR_UPDATE' && hasOffer(available, firmware)) {
            return {
                firmware,
                available,
                ...(busy ? {} : {action: 'install' as const}),
                busy,
            };
        }
        if (HMIP_STATUS.includes(state)) {
            return {firmware, status: state.toLowerCase().replace(/_/g, ' '), busy};
        }
    }
    if (options.updatePending === true) {
        return {firmware, status: 'update pending', busy};
    }
    if (hasOffer(available, firmware)) {
        return {firmware, available, ...(busy ? {} : {action: 'update' as const}), busy};
    }
    return {firmware, busy};
}
