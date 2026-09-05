import type {DeviceDescription, ServiceMessage} from '@homematic-manager/core';
import {deviceAddress} from '@homematic-manager/core';

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
    CONFIG_PENDING: {symbol: '⚙', level: 'warn'},
    UPDATE_PENDING: {symbol: '⇩', level: 'warn'},
};

/**
 * The marks for one device, from the service messages of its channels. Unreachable first and at
 * most two of them, as 2.x did - the column is 44 px wide.
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

export function firmwareCell(
    device: DeviceDescription,
    options: {readonly busy?: boolean; readonly updatePending?: boolean} = {},
): FirmwareCell {
    const firmware = device.FIRMWARE ?? '';
    const available = device.AVAILABLE_FIRMWARE;
    const busy = options.busy === true;
    const state = device.FIRMWARE_UPDATE_STATE;

    if (state !== undefined && state !== '') {
        if (state === 'READY_FOR_UPDATE') {
            return {
                firmware,
                ...(available === undefined ? {} : {available}),
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
    if (available !== undefined && available !== '' && available !== firmware) {
        return {firmware, available, ...(busy ? {} : {action: 'update' as const}), busy};
    }
    return {firmware, busy};
}
