import type {MetaEnum, MetaObjectView, MetaState, Transport} from '@homematic-manager/core';
import {enumTitle, flattenAll, makeRef, type FlatNode} from '@homematic-manager/core';

import {toApiRequestError} from '../transport/error.js';
import type {AssignRequest} from '../util/assignment.js';
import {deviceMatches, membersOf, nodeOptions, objectMatches, type NodeOption} from '../util/taxonomy.js';

import type {NoticesStore} from './NoticesStore.svelte.js';

/** What became of one request of the assignment dialog. */
export type AssignOutcome =
    {readonly path: string; readonly ok: true} | {readonly path: string; readonly ok: false; readonly message: string};

/**
 * Rooms, functions and whatever other taxonomy the metadata store carries (D-40, task 25).
 *
 * One `meta.get` on start, then the three events keep it current: `meta.changed` for the provider
 * state, `meta.enums.changed` for the trees, `meta.objects.changed` for who is where. Every write
 * goes through the contract's methods and answers with the backend's events, never with an
 * optimistic update - on an openccu-lite box the store is the box's and somebody else may be
 * editing it at the same time, and the event is what says what really happened.
 *
 * The store is optional in the same sense ReGa is (D-2): a host that has not connected yet, or a
 * transport without the methods, leaves `state` undefined and every question answered with "no".
 * Nothing here ever throws into a component.
 */
export class TaxonomyStore {
    state = $state<MetaState | undefined>(undefined);
    enums = $state<Record<string, MetaEnum>>({});
    objects = $state<Record<string, MetaObjectView>>({});
    /** Every enum flattened once, depth first - the tree dialog and the selects read this. */
    readonly flat: Record<string, FlatNode[]> = $derived(flattenAll(this.enums));

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe.push(
            transport.on('meta.changed', (state) => {
                this.state = state;
            }),
            transport.on('meta.enums.changed', (enums) => {
                this.enums = enums;
            }),
            transport.on('meta.objects.changed', (objects) => {
                this.objects = objects;
            }),
        );
    }

    /** A store answered at all - before the first connect there is none, and the UI hides itself. */
    get available(): boolean {
        return this.state !== undefined && this.state.reachable;
    }

    /** The store takes writes: the box answered, and the credential may edit. */
    get writable(): boolean {
        return this.state !== undefined && this.state.reachable && this.state.writable;
    }

    /**
     * The provider's taxonomies are flat lists: no node below another, no new taxonomy. ReGa's
     * rooms and functions are that (task 27); the dialog hides "add below" and "move" then.
     */
    get flatOnly(): boolean {
        return this.state?.flat === true;
    }

    /** `<interface>.<address>`: the store's identity for a row of the grid. */
    refOf(interfaceName: string, address: string): string {
        return makeRef(interfaceName, address);
    }

    view(ref: string): MetaObjectView | undefined {
        return this.objects[ref];
    }

    /** The display name of a taxonomy in a language, English and then the id behind it. */
    titleOf(enumId: string, language: string): string {
        return enumTitle(enumId, this.enums[enumId], language);
    }

    /** The nodes of one enum for a select or a list, depth first. */
    options(enumId: string): NodeOption[] {
        return nodeOptions(this.enums, enumId);
    }

    /** The display name of a node path, or the path when the tree does not have it any more. */
    nameOf(path: string): string {
        for (const nodes of Object.values(this.flat)) {
            const found = nodes.find((entry) => entry.path === path);
            if (found) {
                return found.node.name;
            }
        }
        return path;
    }

    matches(ref: string, target: string): boolean {
        return objectMatches(this.objects[ref], target);
    }

    deviceMatches(deviceRef: string, channelRefs: readonly string[], target: string): boolean {
        return deviceMatches(
            this.objects[deviceRef],
            channelRefs.map((ref) => this.objects[ref]),
            target,
        );
    }

    /** The refs in a node's subtree - what the dialog lists before the node is removed. */
    members(target: string): string[] {
        return membersOf(this.objects, target);
    }

    async load(): Promise<void> {
        try {
            const snapshot = await this.#transport.request('meta.get');
            this.state = snapshot.state;
            this.enums = snapshot.enums;
            this.objects = snapshot.objects;
        } catch {
            // D-2 in its metadata shape: a host without the store is a state, not a failure. The
            // grid keeps its name column and the rooms column stays empty.
            this.state = undefined;
        }
    }

    /**
     * Reads the store again. A box has a change stream and never needs it; ReGa has none (task
     * 27), so a room made in the WebUI shows up here only when somebody asks.
     */
    async refresh(): Promise<boolean> {
        try {
            this.state = await this.#transport.request('meta.refresh');
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.refresh');
            return false;
        }
    }

    /**
     * The interaction of the whole feature: the selected rows into (or out of) a node. One request
     * for the whole selection, which the backend turns into one revision.
     */
    async assign(refs: readonly string[], path: string, on: boolean): Promise<boolean> {
        if (refs.length === 0) {
            return false;
        }
        try {
            await this.#transport.request('meta.assign', [...refs], path, on);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.assign');
            return false;
        }
    }

    /**
     * Task 49: the save of the assignment dialog - one `meta.assign` per changed node, one after
     * another, each with its own outcome.
     *
     * One after another because the backend reads the document and then writes each object's whole
     * list: two assignments of the same object in parallel would lose one of them. A refusal is
     * answered, not announced: the dialog is open and shows it beside the node, and a toast per
     * failed node would only pile up.
     */
    async assignEach(requests: readonly AssignRequest[]): Promise<AssignOutcome[]> {
        const outcomes: AssignOutcome[] = [];
        for (const request of requests) {
            try {
                await this.#transport.request('meta.assign', [...request.refs], request.path, request.on);
                outcomes.push({path: request.path, ok: true});
            } catch (error) {
                outcomes.push({path: request.path, ok: false, message: toApiRequestError(error).message});
            }
        }
        return outcomes;
    }

    /**
     * A new taxonomy beside `room`, `function` and `floor` - the Metadata page of a tree store
     * (ReGaHSS refuses it: its two lists are all there is, task 27).
     */
    async createEnum(id: string, name: Record<string, string>): Promise<boolean> {
        try {
            await this.#transport.request('meta.enum.create', id, name);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.enum.create');
            return false;
        }
    }

    /** The display names of a taxonomy; the whole record, as the contract wants it. */
    async renameEnum(id: string, name: Record<string, string>): Promise<boolean> {
        try {
            await this.#transport.request('meta.enum.update', id, name);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.enum.update');
            return false;
        }
    }

    /** The taxonomy with every node in it; refused while anything is a member unless `detach`. */
    async deleteEnum(id: string, detach: boolean): Promise<boolean> {
        try {
            await this.#transport.request('meta.enum.delete', id, detach);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.enum.delete');
            return false;
        }
    }

    /** A new node; at the root when `parent` is undefined. Answers with the path it got. */
    async createNode(enumId: string, parent: string | undefined, name: string): Promise<string | undefined> {
        try {
            return await this.#transport.request('meta.node.create', enumId, parent, name);
        } catch (error) {
            this.#notices.fromError(error, 'meta.node.create');
            return undefined;
        }
    }

    async renameNode(path: string, name: string): Promise<boolean> {
        try {
            await this.#transport.request('meta.node.update', path, {name});
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.node.update');
            return false;
        }
    }

    /** A move; `null` puts the node at the root of its enum. Members follow, in the same revision. */
    async moveNode(path: string, parent: string | null): Promise<boolean> {
        try {
            await this.#transport.request('meta.node.update', path, {parent});
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.node.update');
            return false;
        }
    }

    /** Refused by the store while the subtree has members, unless `detach` takes them out first. */
    async deleteNode(path: string, detach: boolean): Promise<boolean> {
        try {
            await this.#transport.request('meta.node.delete', path, detach);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'meta.node.delete');
            return false;
        }
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
