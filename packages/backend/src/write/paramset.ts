/**
 * The write path - the fix for issue #98, and the reason task 4 exists before any UI does.
 *
 * 2.x collected every enabled input of the dialog and sent all of them, always: the "skip
 * unchanged" branch has been commented out since 2019 (`homematic-manager.js:2046-2119`). A MASTER
 * write with 40 parameters where the user changed one is 40 chances for a device or for hmipserver
 * to disagree, and a disagreement is a `CONFIG_PENDING` that does not clear.
 *
 * Here every write goes through the same four steps:
 *
 * 1. the paramset **description** (from the cache, else fetched) says what exists and what is
 *    writable;
 * 2. the **current values** are read unless `writeAll` was asked for - a read, so it does not queue;
 * 3. `diffParamset()` of the core casts, validates and returns exactly the changed parameters, with
 *    a reason for every one it dropped; a parameter that is unknown, read-only, out of range or
 *    `NaN` never reaches the wire;
 * 4. the call goes through the paced write queue and into the write log.
 *
 * Multi-apply is restricted to channels whose paramset description **identity** is equal
 * (`multiApplyEligibility()`, task 6.3). 2.x offered every channel with the same `TYPE` and never
 * compared descriptions, which is exactly what put more than 100 devices into `CONFIG_PENDING`.
 *
 * `dryRun` performs everything except the call, so the preview dialog shows the real payload.
 */

import {
    diffParamset,
    enumEncodingFor,
    isWritable,
    multiApplyEligibility,
    validateValue,
    castValue,
    type DeviceIndex,
    type Paramset,
    type ParamsetDescription,
    type ParamsetWrite,
    type RpcValue,
    type RpcWriteValue,
    type WriteOptions,
    type WriteProblem,
    type WriteResult,
} from '@homematic-manager/core';

import {BackendError, toApiError, validationError} from '../errors.js';
import type {RpcOutValue} from '../rpc/client.js';

/**
 * Parameters that are sent even when they did not change.
 *
 * `UI_HINT` carries the id of the easy-mode profile; a link paramset written without it shows up as
 * "expert" in the CCU's own WebUI (roadmap task 6, item 5a). `UI_TEMPLATE` is the older spelling
 * 2.x also wrote. Both are ordinary parameters of the link paramset description, so they are cast
 * and validated like everything else - they are only exempt from the "unchanged" rule.
 */
export const ALWAYS_SENT_LINK_PARAMETERS: readonly string[] = ['UI_HINT', 'UI_TEMPLATE'];

/** What the writer needs from the backend. */
export interface ParamsetWriterDeps {
    /** The device index of an interface, for the multi-apply eligibility. */
    index(interfaceName: string): DeviceIndex;
    /** The paramset description, from the cache or freshly fetched. */
    describe(interfaceName: string, address: string, paramset: string): Promise<ParamsetDescription>;
    /** A read call: straight to the interface, never queued. */
    read(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue>;
    /** A write call: through the paced queue and the write log. */
    write(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue>;
    /** Progress of a bulk operation. */
    onProgress(progress: {done: number; total: number; last?: WriteResult}): void;
}

/** One link, as `paramset.putLink` receives it. */
export interface LinkTarget {
    readonly sender: string;
    readonly receiver: string;
}

/** The core's `ValidationProblem` in the contract's `WriteProblem` shape (`param` -> `parameter`). */
function problemsOf(problems: readonly {param?: string; message: string}[]): WriteProblem[] {
    return problems.map((problem) => ({
        ...(problem.param === undefined ? {} : {parameter: problem.param}),
        message: problem.message,
    }));
}

/** Reads a paramset; an interface that faults gives an empty set, and then nothing is "unchanged". */
async function readParamset(
    deps: ParamsetWriterDeps,
    interfaceName: string,
    address: string,
    paramsetKey: string,
): Promise<Paramset> {
    const value = await deps.read(interfaceName, 'getParamset', [address, paramsetKey]);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {};
    }
    const paramset: Record<string, boolean | number | string> = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
            paramset[name] = entry;
        }
    }
    return paramset;
}

/** Writes paramsets, link paramsets and single values. */
export class ParamsetWriter {
    readonly #deps: ParamsetWriterDeps;

    constructor(deps: ParamsetWriterDeps) {
        this.#deps = deps;
    }

    /**
     * `paramset.put`: MASTER/VALUES/SERVICE to one or more channels.
     *
     * The first address is the one the dialog was opened on; every further address has to carry the
     * same description identity or it is refused with a reason instead of being written.
     */
    async put(
        interfaceName: string,
        addresses: readonly string[],
        paramset: string,
        values: ParamsetWrite,
        options: WriteOptions = {},
    ): Promise<WriteResult[]> {
        if (addresses.length === 0) {
            throw validationError('no address to write to');
        }
        const [source, ...extras] = addresses as [string, ...string[]];
        const refused = new Map<string, WriteProblem>();
        if (extras.length > 0) {
            for (const entry of this.#eligibility(interfaceName, source, paramset, extras)) {
                refused.set(entry.address, entry.problem);
            }
        }

        const results: WriteResult[] = [];
        let done = 0;
        for (const address of addresses) {
            const problem = refused.get(address);
            const result = problem
                ? {
                      interfaceName,
                      address,
                      paramset,
                      sent: {},
                      ok: false,
                      skipped: true,
                      problems: [problem],
                  }
                : await this.#putOne(interfaceName, address, paramset, paramset, values, options, {});
            results.push(result);
            done += 1;
            this.#deps.onProgress({done, total: addresses.length, last: result});
            if (wasCancelled(result)) {
                break;
            }
        }
        return results;
    }

    /**
     * `paramset.putLink`: the link paramset of one or both directions.
     *
     * A link paramset is addressed as `putParamset(<channel>, <peer address>, values)`, so
     * "sender to receiver" is written on the sender with the receiver as the key and the other way
     * round - exactly what `putLinkParamset()` of 2.x did.
     */
    async putLink(
        interfaceName: string,
        links: readonly LinkTarget[],
        values: {senderToReceiver?: ParamsetWrite; receiverToSender?: ParamsetWrite},
        options: WriteOptions = {},
    ): Promise<WriteResult[]> {
        if (links.length === 0) {
            throw validationError('no link to write to');
        }
        const directions: {
            owner: (link: LinkTarget) => string;
            peer: (link: LinkTarget) => string;
            values: ParamsetWrite;
        }[] = [];
        if (values.senderToReceiver) {
            directions.push({
                owner: (link) => link.sender,
                peer: (link) => link.receiver,
                values: values.senderToReceiver,
            });
        }
        if (values.receiverToSender) {
            directions.push({
                owner: (link) => link.receiver,
                peer: (link) => link.sender,
                values: values.receiverToSender,
            });
        }
        if (directions.length === 0) {
            throw validationError('no link paramset values to write');
        }

        const total = links.length * directions.length;
        const results: WriteResult[] = [];
        let done = 0;
        for (const link of links) {
            for (const direction of directions) {
                const owner = direction.owner(link);
                const peer = direction.peer(link);
                const result = await this.#putOne(interfaceName, owner, 'LINK', peer, direction.values, options, {
                    peer,
                    alwaysSend: ALWAYS_SENT_LINK_PARAMETERS,
                });
                results.push(result);
                done += 1;
                this.#deps.onProgress({done, total, last: result});
                if (wasCancelled(result)) {
                    return results;
                }
            }
        }
        return results;
    }

    /**
     * `value.set`: one datapoint, cast and validated against its `VALUES` description. 2.x had a
     * third copy of the cast logic here, which is where a `FLOAT` field could become `NaN` - a
     * value XML-RPC cannot even encode.
     */
    async setValue(interfaceName: string, address: string, parameter: string, value: RpcWriteValue): Promise<void> {
        const description = await this.#deps.describe(interfaceName, address, 'VALUES');
        const parameterDescription = description[parameter];
        if (!parameterDescription) {
            throw validationError(`${address} has no parameter ${parameter}`, [
                {parameter, message: 'not in the VALUES description'},
            ]);
        }
        if (!isWritable(parameterDescription)) {
            throw validationError(`${parameter} of ${address} is not writable`, [
                {parameter, message: 'OPERATIONS does not allow writing'},
            ]);
        }
        const cast = castValue(value, parameterDescription, {enumAs: enumEncodingFor(interfaceName)});
        const problems = validateValue(parameter, cast, parameterDescription);
        if (problems.length > 0) {
            throw validationError(
                `${parameter} of ${address}: ${problems[0]?.message ?? 'invalid value'}`,
                problemsOf(problems),
            );
        }
        await this.#deps.write(interfaceName, 'setValue', [address, parameter, cast]);
    }

    /** Which of the extra addresses may be written, and why the others may not. */
    #eligibility(
        interfaceName: string,
        source: string,
        paramset: string,
        extras: readonly string[],
    ): {address: string; problem: WriteProblem}[] {
        let eligibility;
        try {
            eligibility = multiApplyEligibility(this.#deps.index(interfaceName), source, paramset, extras);
        } catch (error) {
            // the source itself has no identity: nothing can be multi-applied from it
            const message = error instanceof Error ? error.message : String(error);
            return extras.map((address) => ({address, problem: {message}}));
        }
        return eligibility.ineligible.map((entry) => ({
            address: entry.address,
            problem: {message: describeIneligible(entry.reason, eligibility.identity, entry.identity)},
        }));
    }

    async #putOne(
        interfaceName: string,
        address: string,
        paramset: string,
        paramsetKey: string,
        values: ParamsetWrite,
        options: WriteOptions,
        extra: {peer?: string; alwaysSend?: readonly string[]},
    ): Promise<WriteResult> {
        const base = {
            interfaceName,
            address,
            ...(extra.peer === undefined ? {} : {peer: extra.peer}),
            paramset,
        };
        let description: ParamsetDescription;
        try {
            // the description is asked for by paramset *name* (MASTER/VALUES/LINK), the values by
            // paramset *key* - which for a link is the peer channel's address
            description = await this.#deps.describe(interfaceName, address, paramset);
        } catch (error) {
            return {...base, sent: {}, ok: false, problems: [{message: toApiError(error).message}], ...faultOf(error)};
        }

        let original: Paramset = {};
        if (options.writeAll !== true) {
            try {
                original = await readParamset(this.#deps, interfaceName, address, paramsetKey);
            } catch (error) {
                return {
                    ...base,
                    sent: {},
                    ok: false,
                    problems: [{message: `reading the current values failed: ${toApiError(error).message}`}],
                    ...faultOf(error),
                };
            }
        }

        const diff = diffParamset(original, values, description, {
            writeAll: options.writeAll === true,
            enumAs: enumEncodingFor(interfaceName),
        });
        const sent: ParamsetWrite = {...diff.values};
        for (const parameter of extra.alwaysSend ?? []) {
            addAlwaysSent(sent, diff.values, values, description, parameter, interfaceName);
        }

        const problems = problemsOf(diff.problems);
        if (problems.length > 0) {
            return {...base, sent, ok: false, skipped: true, problems};
        }
        if (Object.keys(sent).length === 0) {
            return {...base, sent, ok: true, skipped: true, problems: []};
        }
        if (options.dryRun === true) {
            return {...base, sent, ok: true, skipped: true, problems: []};
        }

        const started = Date.now();
        try {
            await this.#deps.write(interfaceName, 'putParamset', [address, paramsetKey, sent]);
            return {...base, sent, ok: true, problems: [], durationMs: Date.now() - started};
        } catch (error) {
            return {
                ...base,
                sent,
                ok: false,
                problems: [{message: toApiError(error).message}],
                ...faultOf(error),
                durationMs: Date.now() - started,
            };
        }
    }
}

/** Re-adds a parameter the diff dropped as unchanged, if it is valid. */
function addAlwaysSent(
    sent: ParamsetWrite,
    already: ParamsetWrite,
    values: ParamsetWrite,
    description: ParamsetDescription,
    parameter: string,
    interfaceName: string,
): void {
    if (Object.prototype.hasOwnProperty.call(already, parameter)) {
        return;
    }
    const parameterDescription = description[parameter];
    const raw = values[parameter];
    if (raw === undefined || !parameterDescription || !isWritable(parameterDescription)) {
        return;
    }
    const cast = castValue(raw, parameterDescription, {enumAs: enumEncodingFor(interfaceName)});
    if (validateValue(parameter, cast, parameterDescription).length === 0) {
        sent[parameter] = cast;
    }
}

function describeIneligible(reason: string, identity: string, otherIdentity: string | undefined): string {
    switch (reason) {
        case 'same-channel':
            return 'the channel the dialog was opened on';
        case 'unknown-address':
            return 'the channel is not in the device list';
        case 'no-identity':
            return 'the device of this channel is unknown, so its paramset cannot be compared';
        default:
            return `a different paramset description: ${otherIdentity ?? 'unknown'} instead of ${identity}`;
    }
}

function faultOf(error: unknown): {faultCode?: number; faultString?: string} {
    if (!(error instanceof BackendError) || error.faultCode === undefined) {
        return {};
    }
    return {
        faultCode: error.faultCode,
        ...(error.faultString === undefined ? {} : {faultString: error.faultString}),
    };
}

function wasCancelled(result: WriteResult): boolean {
    return !result.ok && result.problems.some((problem) => problem.message.includes('cancelled'));
}
