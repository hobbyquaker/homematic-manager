import type {
    HeatingGroup,
    HeatingGroupChange,
    HeatingGroupDetail,
    HeatingGroupMember,
    HeatingGroupsState,
    HeatingGroupType,
    MetaState,
    Transport,
} from '@homematic-manager/core';

import {toApiRequestError} from '../transport/error.js';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * Task 57: the heating groups of openccu-lite - the `VirtualDevices` group devices and who is in
 * them - and whether this connection has them at all.
 *
 * Whether it has them follows the metadata store: only a connection whose store is the system's
 * (`provider: 'occulite'`) can have the groups API, so the probe runs when that state says so and
 * again when it changes - a reconnect, a system that comes back. Every CCU, Homegear and bare
 * interface process answers "no" without a request. The Groups tab exists exactly while
 * {@link offered} is true.
 *
 * No optimistic update: a change answers with the system's own view of the group, and the list is
 * read again afterwards - the group process may have refused a member, and on the system somebody
 * else may be editing at the same time. Nothing here ever throws into a component: a failure is a
 * notice and a `false` or `undefined`.
 */
export class GroupsStore {
    /** `undefined` until the metadata store has said what kind of connection this is. */
    state = $state<HeatingGroupsState | undefined>(undefined);
    groups = $state<HeatingGroup[]>([]);
    /** The members whose configuration is still pending from the last change - shown as a hint. */
    devicesToConfigure = $state<HeatingGroupMember[]>([]);
    loading = $state(false);
    /** The list was read at least once, so an empty grid means "no groups" and not "not yet". */
    loaded = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: Array<() => void> = [];
    /** What the last probe was made for, so a revision tick of the store does not probe again. */
    #probedFor = '';
    /** The probe in flight, so the start-up and a `meta.changed` of the same moment share it. */
    #probing: Promise<void> | undefined;

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe.push(
            transport.on('meta.changed', (meta) => {
                void this.follow(meta);
            }),
        );
    }

    /** The connection has the groups API and the credential may read it: the tab is shown. */
    get offered(): boolean {
        return this.state?.available === true;
    }

    /**
     * Decides from the metadata store's state whether to ask the backend at all. A system that is
     * reachable is probed once per (provider, reachable) pair; everything else is "no groups" on
     * the spot, and the list is dropped with it.
     */
    async follow(meta: MetaState | undefined): Promise<void> {
        const onBox = meta?.provider === 'occulite' && meta.reachable;
        const key = onBox ? `occulite/${meta.url ?? ''}` : 'none';
        if (key === this.#probedFor && (this.state !== undefined || this.#probing !== undefined)) {
            await this.#probing;
            return;
        }
        this.#probedFor = key;
        if (!onBox) {
            this.state = {available: false, reason: 'no-box'};
            this.groups = [];
            this.devicesToConfigure = [];
            this.loaded = false;
            return;
        }
        this.#probing = this.#probe();
        try {
            await this.#probing;
        } finally {
            this.#probing = undefined;
        }
    }

    async #probe(): Promise<void> {
        try {
            this.state = await this.#transport.request('groups.state');
        } catch (error) {
            // a transport without the method (an older backend) is a connection without groups
            this.state = {available: false, reason: 'error', message: toApiRequestError(error).message};
        }
    }

    /** The groups with their members; what the tab reads when it opens and after every change. */
    async load(): Promise<boolean> {
        this.loading = true;
        try {
            const list = await this.#transport.request('groups.list');
            this.groups = list.groups;
            this.devicesToConfigure = list.devicesToConfigure;
            this.loaded = true;
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'groups.list');
            return false;
        } finally {
            this.loading = false;
        }
    }

    /** The types a new group can have, each with the devices it could take now. */
    async types(): Promise<HeatingGroupType[]> {
        try {
            return await this.#transport.request('groups.types');
        } catch (error) {
            this.#notices.fromError(error, 'groups.types');
            return [];
        }
    }

    /** One group as the editor needs it: members, candidates, what is already connected. */
    async detail(id: number): Promise<HeatingGroupDetail | undefined> {
        try {
            return await this.#transport.request('groups.get', id);
        } catch (error) {
            this.#notices.fromError(error, 'groups.get');
            return undefined;
        }
    }

    async create(name: string, type: string, members: readonly string[]): Promise<HeatingGroupChange | undefined> {
        try {
            const change = await this.#transport.request('groups.create', name, type, [...members]);
            await this.#afterChange(change);
            return change;
        } catch (error) {
            this.#notices.fromError(error, 'groups.create');
            return undefined;
        }
    }

    /**
     * The name and the members as a whole - one change with the new list, as the WebUI saved it.
     * `undefined` keeps a field.
     */
    async update(
        id: number,
        name: string | undefined,
        members: readonly string[] | undefined,
    ): Promise<HeatingGroupChange | undefined> {
        try {
            const change = await this.#transport.request(
                'groups.update',
                id,
                name,
                members === undefined ? undefined : [...members],
            );
            await this.#afterChange(change);
            return change;
        } catch (error) {
            this.#notices.fromError(error, 'groups.update');
            return undefined;
        }
    }

    /** The group goes; its former members lose the membership and are the ones to configure now. */
    async remove(id: number): Promise<boolean> {
        try {
            const former = await this.#transport.request('groups.delete', id);
            await this.load();
            // after the list, which brings its own (usually empty) list of them
            this.devicesToConfigure = former;
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'groups.delete');
            return false;
        }
    }

    /**
     * After a create or an update: the list again, and the answer's devices to configure - the
     * list's own would name them too, but the answer is the one the change produced.
     */
    async #afterChange(change: HeatingGroupChange): Promise<void> {
        await this.load();
        this.devicesToConfigure = change.devicesToConfigure;
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
