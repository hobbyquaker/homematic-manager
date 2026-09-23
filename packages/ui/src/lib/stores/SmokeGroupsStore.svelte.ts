import type {SmokeGroupMemberships, Transport, WriteResult} from '@homematic-manager/core';
import {smokeGroupParameter, smokeGroupsOf} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * Task 58: which HmIP smoke groups (`GROUP_1` … `GROUP_8`) every smoke channel of an interface is
 * in. hmipserver keeps them as ordinary MASTER parameters of the detector's smoke channel and has
 * no group object, so the store reads each channel's MASTER once and the device list synthesises
 * the group rows from what came back. A change is a MASTER write of exactly the one `GROUP_n`
 * that changed, through the same validated, diffed path every paramset write takes (task 6);
 * afterwards the channel is read again, so the row shows what the interface holds and not what
 * was sent.
 *
 * BidCos teams need none of this: their members come with `listDevices` (`TEAM_CHANNELS`).
 */
export class SmokeGroupsStore {
    /** Interface name → channel address → groups, `null` for a channel without `GROUP_n`. */
    memberships = $state<Record<string, SmokeGroupMemberships>>({});
    loading = $state<Record<string, boolean>>({});
    writing = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
    }

    of(interfaceName: string): SmokeGroupMemberships {
        return this.memberships[interfaceName] ?? {};
    }

    isLoading(interfaceName: string): boolean {
        return this.loading[interfaceName] === true;
    }

    /**
     * Brings the memberships of an interface up to date with its smoke channels: channels the
     * store has not read yet are read, channels that are gone are forgotten, the rest is kept.
     * Called from the device list whenever its index changes; a re-read of everything is
     * {@link refresh}. Nothing is asked for while nothing changed.
     */
    async sync(interfaceName: string, channels: readonly string[]): Promise<void> {
        const known = this.memberships[interfaceName] ?? {};
        const missing = channels.filter((address) => !(address in known));
        const gone = Object.keys(known).filter((address) => !channels.includes(address));
        if (missing.length === 0 && gone.length === 0) {
            return;
        }
        const kept = Object.fromEntries(Object.entries(known).filter(([address]) => channels.includes(address)));
        if (missing.length === 0) {
            this.memberships = {...this.memberships, [interfaceName]: kept};
            return;
        }
        await this.#read(interfaceName, missing, kept);
    }

    /** Reads the given channels again - after a write, or when the user asks for a refresh. */
    async refresh(interfaceName: string, channels: readonly string[]): Promise<void> {
        if (channels.length === 0) {
            return;
        }
        await this.#read(interfaceName, channels, this.memberships[interfaceName] ?? {});
    }

    async #read(interfaceName: string, channels: readonly string[], base: SmokeGroupMemberships): Promise<void> {
        this.loading = {...this.loading, [interfaceName]: true};
        const next: Record<string, readonly number[] | null> = {...base};
        try {
            for (const address of channels) {
                try {
                    const master = await this.#transport.request('paramset.get', interfaceName, address, 'MASTER');
                    next[address] = smokeGroupsOf(master) ?? null;
                } catch (error) {
                    // a detector that does not answer stays as it was known, or unknown: neither is
                    // a reason to stop reading the others
                    this.#notices.fromError(error, `getParamset ${address} MASTER`);
                }
            }
            this.memberships = {...this.memberships, [interfaceName]: next};
        } finally {
            this.loading = {...this.loading, [interfaceName]: false};
        }
    }

    /**
     * Puts channels into a group and takes others out of it: one MASTER write per channel with
     * exactly its `GROUP_n`, validated by the backend against the channel's description - a
     * channel whose description has no `GROUP_n` is refused there, never written. Returns the
     * results; the channels written are read again afterwards.
     */
    async setMembers(
        interfaceName: string,
        group: number,
        added: readonly string[],
        removed: readonly string[],
    ): Promise<WriteResult[]> {
        const parameter = smokeGroupParameter(group);
        const results: WriteResult[] = [];
        this.writing = true;
        try {
            for (const [addresses, value] of [
                [added, true],
                [removed, false],
            ] as const) {
                for (const address of addresses) {
                    try {
                        results.push(
                            ...(await this.#transport.request('paramset.put', interfaceName, [address], 'MASTER', {
                                [parameter]: value,
                            })),
                        );
                    } catch (error) {
                        this.#notices.fromError(error, `putParamset ${address} MASTER ${parameter}`);
                    }
                }
            }
        } finally {
            this.writing = false;
        }
        await this.refresh(interfaceName, [...added, ...removed]);
        return results;
    }

    /** Drops one interface's memberships, or all of them. */
    forget(interfaceName?: string): void {
        if (interfaceName === undefined) {
            this.memberships = {};
            return;
        }
        this.memberships = Object.fromEntries(
            Object.entries(this.memberships).filter(([name]) => name !== interfaceName),
        );
    }
}
