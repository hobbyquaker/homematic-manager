import type {
    Paramset,
    ParamsetDescription,
    ParamsetWrite,
    RpcValue,
    RpcWriteValue,
    Transport,
    WriteOptions,
    WriteResult,
} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/** Cache key of a description or a value set. */
function key(interfaceName: string, address: string, paramset: string): string {
    return `${interfaceName}|${address}|${paramset}`;
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

    readonly #transport: Transport;
    readonly #notices: NoticesStore;

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

    clearResults(): void {
        this.results = [];
    }
}
