/**
 * "Repair configuration" - task 6, item 7, built from the recovery the lab measured.
 *
 * The study of 2026-09-05 (`docs/config-pending.md`) found that neither interface process protects
 * the device from the application:
 *
 * - **hmipserver stores a `putParamset` before it validates it.** A value of the wrong type or an
 *   `ENUM` outside its `VALUE_LIST` is kept, the call answers `-5 Invalid parameter or value`, and
 *   `CONFIG_PENDING` on `<device>:0` stays set until a valid configuration is written. The one
 *   recovery that works is a **valid full `MASTER` write of that channel** - and it works even when
 *   the call itself still faults.
 * - **A parameter the channel does not have is kept for ever.** It is persisted in the interface
 *   process' own device file, survives a restart, and makes every later `putParamset` on that
 *   channel fault, including one with an empty struct. `clearConfigCache`, `restoreConfigToDevice`
 *   and `determineParameter` all answer `-1 Generic error` on hmipserver: they are BidCos methods.
 *   Nothing short of deleting and pairing the device again removes it.
 * - **rfd is silent instead**: it drops what it does not know and clamps what is out of range, so a
 *   BidCos channel is never in this state - but `clearConfigCache` and `restoreConfigToDevice` do
 *   work there and are offered as a second step.
 *
 * So this is what a repair is: read each channel's own description and its stored values, replace
 * every value that is not valid for its parameter with one that is, and write the result back.
 * What it cannot do is remove an unknown parameter, and it says so instead of pretending - a
 * channel with one is reported as `unrepairable`, and the dialog of task 8 has to explain what that
 * means for the device.
 */

import {
    castValue,
    enumEncodingFor,
    isWritable,
    validateValue,
    type DeviceIndex,
    type ParameterDescription,
    type Paramset,
    type ParamsetDescription,
    type ParamsetWrite,
    type RepairChannelResult,
    type RepairConfigOptions,
    type RepairConfigResult,
    type RepairCorrection,
    type RpcValue,
    type RpcWriteValue,
    type WriteResult,
} from '@homematic-manager/core';

import {toApiError, validationError} from '../errors.js';
import type {RpcOutValue} from '../rpc/client.js';

/** What the repair needs from the backend; the same shape the paramset writer uses. */
export interface ConfigRepairDeps {
    index(interfaceName: string): DeviceIndex;
    describe(interfaceName: string, address: string, paramset: string): Promise<ParamsetDescription>;
    read(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue>;
    write(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue>;
    onProgress(progress: {done: number; total: number; last?: WriteResult}): void;
}

/**
 * `clearConfigCache` and `restoreConfigToDevice` exist in hmipserver's `system.listMethods` and
 * answer `-1 Generic error` to every call: they are BidCos methods. Offering them for an HmIP
 * device would only produce a fault the user cannot act on.
 */
export function supportsBidcosMaintenance(interfaceName: string): boolean {
    return interfaceName !== 'HmIP-RF';
}

/** A value that is certainly valid for this parameter, for a stored one that is not. */
export function fallbackValue(parameter: ParameterDescription): RpcWriteValue | undefined {
    const candidates: RpcWriteValue[] = [];
    if (parameter.DEFAULT !== undefined) {
        candidates.push(parameter.DEFAULT);
    }
    if (parameter.TYPE === 'ENUM') {
        candidates.push(0);
    } else if (parameter.TYPE === 'BOOL' || parameter.TYPE === 'ACTION') {
        candidates.push(false);
    } else if (parameter.TYPE === 'STRING') {
        candidates.push('');
    } else {
        if (parameter.MIN !== undefined) {
            candidates.push(parameter.MIN);
        }
        candidates.push(0);
    }
    for (const candidate of candidates) {
        const cast = castValue(candidate, parameter, {enumAs: 'index'});
        if (validateValue(parameter.ID ?? 'value', cast, parameter).length === 0) {
            return cast;
        }
    }
    return undefined;
}

/** Reads a paramset; a fault gives an empty set rather than aborting the whole repair. */
async function readParamset(
    deps: ConfigRepairDeps,
    interfaceName: string,
    address: string,
    paramset: string,
): Promise<Paramset> {
    const value: unknown = await deps.read(interfaceName, 'getParamset', [address, paramset]);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {};
    }
    const result: Record<string, boolean | number | string> = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
            result[name] = entry;
        }
    }
    return result;
}

export class ConfigRepair {
    readonly #deps: ConfigRepairDeps;

    constructor(deps: ConfigRepairDeps) {
        this.#deps = deps;
    }

    /** `devices.repairConfig`. */
    async repair(
        interfaceName: string,
        address: string,
        options: RepairConfigOptions = {},
    ): Promise<RepairConfigResult> {
        const index = this.#deps.index(interfaceName);
        const device = index.get(address);
        if (!device) {
            throw validationError(`${address} is not in the device list of ${interfaceName}`);
        }
        const deviceAddress = device.PARENT === undefined || device.PARENT === '' ? device.ADDRESS : device.PARENT;
        const targets = options.channels ?? this.#targetsOf(index, deviceAddress);

        const result: RepairConfigResult = {
            interfaceName,
            address: deviceAddress,
            channels: [],
            unrepairable: [],
        };
        const before = await this.#configPending(interfaceName, deviceAddress);
        if (before !== undefined) {
            result.configPendingBefore = before;
        }

        let done = 0;
        for (const target of targets) {
            const channel = await this.#repairChannel(interfaceName, target, options.dryRun === true);
            result.channels.push(channel);
            if (channel.unknown.length > 0) {
                result.unrepairable.push(channel.address);
            }
            done += 1;
            this.#deps.onProgress({done, total: targets.length, last: channel.write});
        }

        if (
            options.bidcosRecovery !== undefined &&
            options.bidcosRecovery !== 'none' &&
            options.dryRun !== true &&
            supportsBidcosMaintenance(interfaceName)
        ) {
            const method = options.bidcosRecovery === 'clearConfigCache' ? 'clearConfigCache' : 'restoreConfigToDevice';
            await this.#deps.write(interfaceName, method, [deviceAddress]);
            result.bidcosRecovery = options.bidcosRecovery;
        }

        const after = options.dryRun === true ? before : await this.#configPending(interfaceName, deviceAddress);
        if (after !== undefined) {
            result.configPendingAfter = after;
        }
        return result;
    }

    /** The device itself and every channel of it that has a `MASTER` paramset. */
    #targetsOf(index: DeviceIndex, deviceAddress: string): string[] {
        const targets: string[] = [];
        const device = index.get(deviceAddress);
        if (device?.PARAMSETS?.includes('MASTER')) {
            targets.push(device.ADDRESS);
        }
        for (const channel of index.childrenOf(deviceAddress)) {
            if (channel.PARAMSETS?.includes('MASTER')) {
                targets.push(channel.ADDRESS);
            }
        }
        return targets;
    }

    /** `CONFIG_PENDING` of the device's `:0` channel, or `undefined` when it cannot be read. */
    async #configPending(interfaceName: string, deviceAddress: string): Promise<boolean | undefined> {
        try {
            const values = await readParamset(this.#deps, interfaceName, `${deviceAddress}:0`, 'VALUES');
            const pending = values['CONFIG_PENDING'];
            return typeof pending === 'boolean' ? pending : undefined;
        } catch {
            return undefined;
        }
    }

    async #repairChannel(interfaceName: string, address: string, dryRun: boolean): Promise<RepairChannelResult> {
        const base = {interfaceName, address, paramset: 'MASTER'};
        let description: ParamsetDescription;
        try {
            description = await this.#deps.describe(interfaceName, address, 'MASTER');
        } catch (error) {
            return {
                address,
                unknown: [],
                corrected: [],
                write: {...base, sent: {}, ok: false, skipped: true, problems: [{message: toApiError(error).message}]},
            };
        }

        let stored: Paramset;
        try {
            stored = await readParamset(this.#deps, interfaceName, address, 'MASTER');
        } catch (error) {
            return {
                address,
                unknown: [],
                corrected: [],
                write: {
                    ...base,
                    sent: {},
                    ok: false,
                    skipped: true,
                    problems: [{message: `reading the stored values failed: ${toApiError(error).message}`}],
                },
            };
        }

        const unknown = Object.keys(stored).filter((name) => description[name] === undefined);
        const corrected: RepairCorrection[] = [];
        const sent: ParamsetWrite = {};

        for (const [name, parameter] of Object.entries(description)) {
            if (!isWritable(parameter)) {
                continue;
            }
            const raw = stored[name];
            if (raw === undefined) {
                // A-14: `getParamset` should return every parameter of the description. When it
                // does not, the repair still has to send something, and that something is a change
                // the user did not ask for - so it is reported.
                const replacement = fallbackValue(parameter);
                if (replacement !== undefined) {
                    sent[name] = replacement;
                    corrected.push({
                        parameter: name,
                        stored: '',
                        replacement,
                        reason: 'the interface process did not report this parameter',
                    });
                }
                continue;
            }

            // the *stored* value is what is judged, not the cast of it: `cast` turns
            // `"not-a-number"` into `0`, which would write the right thing and tell the user
            // nothing about the garbage the interface process was holding
            const storedProblems = validateValue(name, raw, parameter);
            const cast = castValue(raw, parameter, {enumAs: enumEncodingFor(interfaceName)});
            if (storedProblems.length === 0) {
                sent[name] = cast;
                continue;
            }
            const usable = validateValue(name, cast, parameter).length === 0 ? cast : fallbackValue(parameter);
            if (usable === undefined) {
                continue;
            }
            sent[name] = usable;
            corrected.push({
                parameter: name,
                stored: raw,
                replacement: usable,
                reason: storedProblems[0]?.message ?? 'not valid for this parameter',
            });
        }

        if (Object.keys(sent).length === 0) {
            return {
                address,
                unknown,
                corrected,
                write: {...base, sent, ok: unknown.length === 0, skipped: true, problems: []},
            };
        }
        if (dryRun) {
            return {address, unknown, corrected, write: {...base, sent, ok: true, skipped: true, problems: []}};
        }

        const started = Date.now();
        try {
            await this.#deps.write(interfaceName, 'putParamset', [address, 'MASTER', sent]);
            return {
                address,
                unknown,
                corrected,
                write: {...base, sent, ok: true, problems: [], durationMs: Date.now() - started},
            };
        } catch (error) {
            const api = toApiError(error);
            return {
                address,
                unknown,
                corrected,
                write: {
                    ...base,
                    sent,
                    ok: false,
                    // the write still repairs what it can: on a channel with an unknown parameter
                    // hmipserver faults but applies the valid values and clears CONFIG_PENDING
                    problems: [{message: api.message}],
                    ...(api.faultCode === undefined ? {} : {faultCode: api.faultCode}),
                    ...(api.faultString === undefined ? {} : {faultString: api.faultString}),
                    durationMs: Date.now() - started,
                },
            };
        }
    }
}
