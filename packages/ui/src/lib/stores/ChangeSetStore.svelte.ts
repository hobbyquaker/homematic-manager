import type {ParamsetWrite, Transport, WriteResult} from '@homematic-manager/core';
import {toApiRequestError} from '../transport/error.js';

import type {NoticesStore} from './NoticesStore.svelte.js';
import type {WriteLogStore} from './WriteLogStore.svelte.js';

/** One line of a staged change, as the review dialog prints it. */
export interface ChangeLine {
    readonly label: string;
    readonly from?: string;
    readonly to?: string;
}

interface StagedBase {
    readonly id: string;
    /** Everything in one change set belongs to one interface; the apply is per interface. */
    readonly interfaceName: string;
    /** One line for the list: "MASTER — Kitchen light (LEQ0000001:1)". */
    readonly title: string;
    /** The exact RPC calls, as text; the review shows them the way the write preview does. */
    readonly calls: readonly string[];
    /** What changes, parameter by parameter. Empty for a link that is only added or removed. */
    readonly lines: readonly ChangeLine[];
}

/** A `putParamset` on one or more channels - the staged form of the paramset dialog's write. */
export interface StagedParamset extends StagedBase {
    readonly kind: 'paramset';
    readonly targets: readonly string[];
    readonly paramset: string;
    readonly values: ParamsetWrite;
    readonly writeAll: boolean;
}

/** A `putParamset` on a link's two directions - the staged form of the link paramset dialog. */
export interface StagedLinkParamset extends StagedBase {
    readonly kind: 'linkParamset';
    readonly links: ReadonlyArray<{sender: string; receiver: string}>;
    readonly values: {senderToReceiver?: ParamsetWrite; receiverToSender?: ParamsetWrite};
}

/** `addLink` for every pair, with the per-pair names of #87. */
export interface StagedLinkAdd extends StagedBase {
    readonly kind: 'linkAdd';
    readonly pairs: ReadonlyArray<{sender: string; receiver: string; name?: string; description?: string}>;
}

/** `removeLink` for every pair. */
export interface StagedLinkRemove extends StagedBase {
    readonly kind: 'linkRemove';
    readonly pairs: ReadonlyArray<{sender: string; receiver: string}>;
}

export type StagedChange = StagedParamset | StagedLinkParamset | StagedLinkAdd | StagedLinkRemove;

/** A change as a caller hands it over: everything but the id, which the store assigns. */
export type StagedInput =
    | Omit<StagedParamset, 'id'>
    | Omit<StagedLinkParamset, 'id'>
    | Omit<StagedLinkAdd, 'id'>
    | Omit<StagedLinkRemove, 'id'>;

/** What one staged change did when it was applied. */
export interface ChangeOutcome {
    readonly id: string;
    readonly ok: boolean;
    readonly results: readonly WriteResult[];
    readonly error?: string;
}

/**
 * Issue #124: edit several things, review them in one place, write them with one Apply.
 *
 * The complaint is precise: creating three direct links in 2.7 meant three round trips to the CCU,
 * each with its own modal, each waited for on its own - "man müsste nicht immer wieder mal auf die
 * Kommunikation warten". So a change is *staged* rather than sent: the paramset dialog, the link
 * paramset dialog and the create/remove-link dialogs can all put what they would have written into
 * this store, and one Apply runs the lot.
 *
 * Three things it deliberately does **not** do:
 *
 * - It does not re-order or merge. A change set is applied in the order it was staged, and two
 *   changes to the same channel stay two writes, because merging them would change what the device
 *   sees and the preview would stop being the truth (task 6).
 * - It does not compute anything of its own. What is staged is exactly the payload the dialog had
 *   already built with `buildPreview()`, so what the review shows is what the backend will get.
 * - It does not hold the changes across a reload. A staged write is a plan, not a promise, and a
 *   plan that survives a restart would be applied against a device state nobody looked at since.
 *
 * Pacing and cancellation are the backend's: every entry goes through `paramset.put` /
 * `paramset.putLink`, which is the same paced `WriteQueue` a single write uses, so `write.progress`
 * and `write.cancel` work exactly as they do for one multi-apply. `cancel()` stops the queue *and*
 * the loop here, so the changes that have not started are still in the set afterwards.
 */
export class ChangeSetStore {
    changes = $state<StagedChange[]>([]);
    outcomes = $state<ChangeOutcome[]>([]);
    applying = $state(false);
    /** How many entries of the set are done; the review shows it next to the backend's progress. */
    applied = $state(0);
    /**
     * Which run is current. `cancel()` bumps it, so the loop of the run that was going notices that
     * it is no longer the current one and stops. A boolean would read as "always false" to the type
     * checker, because nothing it can see assigns it between the `await`s.
     */
    #runToken = 0;
    #nextId = 1;

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #writeLog: WriteLogStore;

    constructor(transport: Transport, notices: NoticesStore, writeLog: WriteLogStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#writeLog = writeLog;
    }

    get count(): number {
        return this.changes.length;
    }

    get empty(): boolean {
        return this.changes.length === 0;
    }

    /** The interfaces the set touches; more than one is possible and is applied one after another. */
    get interfaces(): string[] {
        const names: string[] = [];
        for (const change of this.changes) {
            if (!names.includes(change.interfaceName)) {
                names.push(change.interfaceName);
            }
        }
        return names;
    }

    /** Adds a change and returns its id. The caller passes everything but the id. */
    stage(change: StagedInput): string {
        const id = `c${String(this.#nextId)}`;
        this.#nextId += 1;
        this.changes = [...this.changes, {...change, id} as StagedChange];
        this.outcomes = [];
        return id;
    }

    remove(id: string): void {
        this.changes = this.changes.filter((change) => change.id !== id);
        this.outcomes = this.outcomes.filter((outcome) => outcome.id !== id);
    }

    clear(): void {
        this.changes = [];
        this.outcomes = [];
        this.applied = 0;
    }

    outcome(id: string): ChangeOutcome | undefined {
        return this.outcomes.find((entry) => entry.id === id);
    }

    /**
     * Applies every staged change, in order, and removes the ones that succeeded.
     *
     * A failing entry does not stop the run - the user asked for all of them - but it stays in the
     * set with its error, so Apply can be pressed again after the cause is fixed. Returns how many
     * were applied.
     */
    async apply(): Promise<number> {
        if (this.applying || this.empty) {
            return 0;
        }
        this.applying = true;
        const token = (this.#runToken += 1);
        this.applied = 0;
        this.outcomes = [];
        const done: string[] = [];
        try {
            for (const change of this.changes) {
                if (this.#runToken !== token) {
                    break;
                }
                const outcome = await this.#applyOne(change);
                this.outcomes = [...this.outcomes, outcome];
                this.applied += 1;
                if (outcome.ok) {
                    done.push(change.id);
                }
            }
        } finally {
            this.applying = false;
            this.changes = this.changes.filter((change) => !done.includes(change.id));
        }
        return done.length;
    }

    /**
     * Stops the run: the backend drops the writes of the current entry that have not started, and
     * the loop here does not begin the next one. What is left in the set is what was not written.
     */
    async cancel(): Promise<number> {
        this.#runToken += 1;
        return this.#writeLog.cancel();
    }

    async #applyOne(change: StagedChange): Promise<ChangeOutcome> {
        try {
            switch (change.kind) {
                case 'paramset': {
                    const results = await this.#transport.request(
                        'paramset.put',
                        change.interfaceName,
                        [...change.targets],
                        change.paramset,
                        change.values,
                        change.writeAll ? {writeAll: true} : undefined,
                    );
                    return this.#fromResults(change.id, results);
                }
                case 'linkParamset': {
                    const results = await this.#transport.request(
                        'paramset.putLink',
                        change.interfaceName,
                        change.links.map((link) => ({...link})),
                        change.values,
                    );
                    return this.#fromResults(change.id, results);
                }
                case 'linkAdd': {
                    for (const pair of change.pairs) {
                        await this.#transport.request(
                            'links.add',
                            change.interfaceName,
                            pair.sender,
                            pair.receiver,
                            pair.name,
                            pair.description,
                        );
                    }
                    return {id: change.id, ok: true, results: []};
                }
                case 'linkRemove': {
                    for (const pair of change.pairs) {
                        await this.#transport.request('links.remove', change.interfaceName, pair.sender, pair.receiver);
                    }
                    return {id: change.id, ok: true, results: []};
                }
            }
        } catch (error) {
            this.#notices.fromError(error, change.title);
            return {id: change.id, ok: false, results: [], error: toApiRequestError(error).message};
        }
    }

    #fromResults(id: string, results: WriteResult[]): ChangeOutcome {
        const failed = results.filter((result) => !result.ok);
        return {
            id,
            ok: results.length > 0 && failed.length === 0,
            results,
            ...(failed.length === 0
                ? {}
                : {error: failed.map((result) => `${result.address}: ${result.faultString ?? 'failed'}`).join(', ')}),
        };
    }
}
