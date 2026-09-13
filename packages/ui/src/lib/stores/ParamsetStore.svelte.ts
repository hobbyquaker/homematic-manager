import {
    paramsetIdentity,
    type DeviceDescription,
    type Paramset,
    type ParamsetDescription,
    type ParamsetWrite,
    type RpcValue,
    type RpcWriteValue,
    type Transport,
    type WriteOptions,
    type WriteResult,
} from '@homematic-manager/core';

import type {ParamsetContent} from '../util/deviceGrid.js';
import {serviceMessageParameters} from '../util/paramsetForm.js';

import type {NoticesStore} from './NoticesStore.svelte.js';
import {readSuppressed, writeSuppressed} from './suppression.js';

/**
 * What counts as content of a description: any parameter, or - for the suppression rows the MASTER
 * dialog of an HmIP channel 0 draws from VALUES (task 26) - a service-message parameter.
 */
export type ContentMeasure = 'parameters' | 'service-messages';

/** Cache key of a description or a value set. */
function key(interfaceName: string, address: string, paramset: string): string {
    return `${interfaceName}|${address}|${paramset}`;
}

/**
 * B-33: what the content of a paramset is kept under - its identity (interface, device type,
 * firmware, version, channel type, paramset), so that every channel of the same kind shares one
 * answer. A channel whose device is not in the index has no identity and gets the address key.
 */
function contentKey(
    interfaceName: string,
    description: DeviceDescription,
    paramset: string,
    parent: DeviceDescription | undefined,
): string {
    try {
        return paramsetIdentity(interfaceName, description, paramset, parent);
    } catch {
        return key(interfaceName, description.ADDRESS, paramset);
    }
}

/**
 * Paramset descriptions, paramset values and the writes.
 *
 * Descriptions are cached here as well as in the backend (which keys them by the description
 * identity), because a dialog asks for the same one on every open and a `getParamsetDescription`
 * of a sleeping BidCos device is not free. Values are never cached across opens: a paramset the
 * dialog shows must be what the device holds now, otherwise the changed-only diff compares against
 * a stale reading and sends parameters nobody touched - which is exactly the failure mode of #98.
 */
export class ParamsetStore {
    descriptions = $state<Record<string, ParamsetDescription>>({});
    loading = $state(false);
    /** The results of the last write, one per target; the dialog shows them under the form. */
    results = $state<WriteResult[]>([]);
    writing = $state(false);
    /** B-33: per paramset identity, what its description holds (see {@link contentOf}). */
    contents = $state<Record<string, ParamsetContent>>({});

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    /** The identities whose description is being asked for; plain, only `contentOf` reads it. */
    #probing: string[] = [];

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
    }

    description(interfaceName: string, address: string, paramset: string): ParamsetDescription | undefined {
        return this.descriptions[key(interfaceName, address, paramset)];
    }

    /** `getParamsetDescription`, cached. `undefined` when the interface refused. */
    async describe(interfaceName: string, address: string, paramset: string): Promise<ParamsetDescription | undefined> {
        const cacheKey = key(interfaceName, address, paramset);
        const cached = this.descriptions[cacheKey];
        if (cached) {
            return cached;
        }
        try {
            const description = await this.#transport.request('paramset.description', interfaceName, address, paramset);
            this.descriptions = {...this.descriptions, [cacheKey]: description};
            return description;
        } catch (error) {
            this.#notices.fromError(error, `getParamsetDescription ${address} ${paramset}`);
            return undefined;
        }
    }

    /**
     * B-33: whether the description of a paramset an object lists has parameters - what decides if
     * the device grid offers it. `undefined` while that is not known yet.
     *
     * The first question for an identity starts one `getParamsetDescription` (the backend answers
     * it from its own identity cache when it can); every other object of the same kind gets the
     * same answer without a request. The request starts in a microtask, because this is asked while
     * the grid renders, and a render must not change state. A failure is kept as `failed` and
     * raises no notice: nobody asked for this description, and the dialog reports the failure when
     * somebody does.
     */
    contentOf(
        interfaceName: string,
        description: DeviceDescription,
        paramset: string,
        parent: DeviceDescription | undefined,
        measure: ContentMeasure = 'parameters',
    ): ParamsetContent | undefined {
        const identity = `${contentKey(interfaceName, description, paramset, parent)}#${measure}`;
        const known = this.contents[identity];
        if (known !== undefined || this.#probing.includes(identity)) {
            return known;
        }
        this.#probing.push(identity);
        const address = description.ADDRESS;
        queueMicrotask(() => {
            void this.#probe(identity, interfaceName, address, paramset, measure);
        });
        return undefined;
    }

    async #probe(
        identity: string,
        interfaceName: string,
        address: string,
        paramset: string,
        measure: ContentMeasure,
    ): Promise<void> {
        let content: ParamsetContent;
        try {
            const description =
                this.descriptions[key(interfaceName, address, paramset)] ??
                (await this.#transport.request('paramset.description', interfaceName, address, paramset));
            const names =
                measure === 'service-messages' ? serviceMessageParameters(description) : Object.keys(description);
            content = names.length === 0 ? 'empty' : 'parameters';
        } catch {
            content = 'failed';
        }
        this.#probing = this.#probing.filter((entry) => entry !== identity);
        this.contents = {...this.contents, [identity]: content};
    }

    /** `getParamset`. Never cached - see the note on the class. */
    async read(interfaceName: string, address: string, paramset: string): Promise<Paramset | undefined> {
        try {
            return await this.#transport.request('paramset.get', interfaceName, address, paramset);
        } catch (error) {
            this.#notices.fromError(error, `getParamset ${address} ${paramset}`);
            return undefined;
        }
    }

    /** Loads description and values together - what opening the dialog needs. */
    async open(
        interfaceName: string,
        address: string,
        paramset: string,
    ): Promise<{description: ParamsetDescription; values: Paramset} | undefined> {
        this.loading = true;
        try {
            const [description, values] = await Promise.all([
                this.describe(interfaceName, address, paramset),
                this.read(interfaceName, address, paramset),
            ]);
            if (!description) {
                return undefined;
            }
            return {description, values: values ?? {}};
        } finally {
            this.loading = false;
        }
    }

    /**
     * `putParamset` on one or more channels. The backend computes the changed-only payload again
     * from its own reading (task 6), so what is sent here is the edited values, not a diff.
     */
    async put(
        interfaceName: string,
        addresses: string[],
        paramset: string,
        values: ParamsetWrite,
        options?: WriteOptions,
    ): Promise<WriteResult[]> {
        this.writing = true;
        try {
            const results = await this.#transport.request(
                'paramset.put',
                interfaceName,
                addresses,
                paramset,
                values,
                options,
            );
            this.results = results;
            return results;
        } catch (error) {
            this.#notices.fromError(error, `putParamset ${paramset}`);
            this.results = [];
            return [];
        } finally {
            this.writing = false;
        }
    }

    /** The LINK variant, keyed by direction. */
    async putLink(
        interfaceName: string,
        links: Array<{sender: string; receiver: string}>,
        values: {senderToReceiver?: ParamsetWrite; receiverToSender?: ParamsetWrite},
        options?: WriteOptions,
    ): Promise<WriteResult[]> {
        this.writing = true;
        try {
            const results = await this.#transport.request('paramset.putLink', interfaceName, links, values, options);
            this.results = results;
            return results;
        } catch (error) {
            this.#notices.fromError(error, 'putParamset LINK');
            this.results = [];
            return [];
        } finally {
            this.writing = false;
        }
    }

    /** One datapoint, the button next to a VALUES row. */
    async setValue(interfaceName: string, address: string, parameter: string, value: RpcWriteValue): Promise<boolean> {
        try {
            await this.#transport.request('value.set', interfaceName, address, parameter, value);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `setValue ${address} ${parameter}`);
            return false;
        }
    }

    async getValue(interfaceName: string, address: string, parameter: string): Promise<RpcValue | undefined> {
        try {
            return await this.#transport.request('value.get', interfaceName, address, parameter);
        } catch (error) {
            this.#notices.fromError(error, `getValue ${address} ${parameter}`);
            return undefined;
        }
    }

    /**
     * Task 26 (openccu-lite 28.9): the service parameters of a channel whose messages the HmIP
     * server suppresses - eQ-3's `getSuppressedServiceMessages`, HmIP only. `undefined` when the
     * interface does not offer the method (BidCos, Homegear): the dialog then shows nothing, and
     * no notice is raised for what is simply not there.
     */
    async suppressedServiceMessages(interfaceName: string, address: string): Promise<string[] | undefined> {
        return readSuppressed(this.#transport, interfaceName, address);
    }

    /**
     * `suppressServiceMessages(channelAddress, parameter, suppress)`: `parameter` is one with the
     * service flag, or `''` for every service parameter of the channel. Suppression works by the
     * interface reporting a value that raises no message (`UNREACH` becomes `false`).
     */
    async suppressServiceMessages(
        interfaceName: string,
        address: string,
        parameter: string,
        suppress: boolean,
    ): Promise<boolean> {
        try {
            await writeSuppressed(this.#transport, interfaceName, address, parameter, suppress);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `suppressServiceMessages ${address} ${parameter || '*'}`);
            return false;
        }
    }

    clearResults(): void {
        this.results = [];
    }
}
