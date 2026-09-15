/**
 * The pure part of the room and function assignment dialog (task 49): what a checkbox shows for
 * the selected rows, what a click turns it into, and which requests a save sends. No DOM, no
 * transport - `assignment.test.ts` covers it directly.
 *
 * A checkbox has three states. `on`: every selected row is in the node. `off`: none is. `mixed`:
 * some are. A save writes only what the user changed, as one `meta.assign` per changed node.
 */

import type {MetaObjectView} from '@homematic-manager/core';

import type {NodeOption} from './taxonomy.js';

export type CheckState = 'on' | 'off' | 'mixed';

/** One selected row: its ref, and for a device row the refs of its channels. */
export interface AssignTarget {
    readonly ref: string;
    /** The channel refs of a device row, `:0` included; empty for a channel row. */
    readonly channels: readonly string[];
}

export type ViewLookup = (ref: string) => MetaObjectView | undefined;

/** One request of a save: the rows that go into (`on`) or out of a node. */
export interface AssignRequest {
    readonly path: string;
    readonly on: boolean;
    readonly refs: readonly string[];
}

/** The filter field is shown above the list when a taxonomy has more nodes than this. */
export const FILTER_THRESHOLD = 10;

function holds(lookup: ViewLookup, ref: string, path: string): boolean {
    return lookup(ref)?.enums.includes(path) === true;
}

/** The maintenance channel: never counted for a device's membership, as ReGa never files it. */
function isMaintenance(ref: string): boolean {
    return ref.endsWith(':0');
}

/**
 * One row. A channel is in a node when its own memberships hold it. A device is when it holds it
 * itself, or when every channel but `:0` does - the grid shows a device without memberships of its
 * own with its channels', and on a CCU a device never has any (ReGa files channels). Some channels
 * make a single device row `mixed`.
 */
export function targetState(target: AssignTarget, path: string, lookup: ViewLookup): CheckState {
    if (holds(lookup, target.ref, path)) {
        return 'on';
    }
    const counted = target.channels.filter((ref) => !isMaintenance(ref));
    const inside = counted.filter((ref) => holds(lookup, ref, path)).length;
    if (inside === 0) {
        return 'off';
    }
    return inside === counted.length ? 'on' : 'mixed';
}

/** The selection: all rows `on` is `on`, all `off` is `off`, anything else `mixed`. */
export function selectionState(targets: readonly AssignTarget[], path: string, lookup: ViewLookup): CheckState {
    let on = 0;
    let off = 0;
    for (const target of targets) {
        const state = targetState(target, path, lookup);
        if (state === 'on') {
            on += 1;
        } else if (state === 'off') {
            off += 1;
        }
    }
    if (targets.length === 0 || off === targets.length) {
        return 'off';
    }
    return on === targets.length ? 'on' : 'mixed';
}

/** The state of every node for the selection, keyed by path. */
export function membershipStates(
    targets: readonly AssignTarget[],
    paths: readonly string[],
    lookup: ViewLookup,
): Record<string, CheckState> {
    return Object.fromEntries(paths.map((path) => [path, selectionState(targets, path, lookup)]));
}

/**
 * What a click (or Space) makes of a box. One that opened `on` or `off` toggles. One that opened
 * `mixed` goes to all, then none, then back to `mixed` - "leave it as it was", which is otherwise
 * only reachable by cancelling the whole dialog.
 */
export function nextState(initial: CheckState, current: CheckState): CheckState {
    if (initial === 'mixed') {
        return current === 'mixed' ? 'on' : current === 'on' ? 'off' : 'mixed';
    }
    return current === 'on' ? 'off' : 'on';
}

/**
 * The nodes the user changed, in the order of `paths`. A box that is `mixed` again, or back where
 * it started, changes nothing. A path that is not in `initial` (a node created in the dialog) was
 * `off` when the dialog opened.
 */
export function changedPaths(
    paths: readonly string[],
    initial: Readonly<Record<string, CheckState>>,
    desired: Readonly<Record<string, CheckState>>,
): string[] {
    return paths.filter((path) => {
        const wanted = desired[path];
        return wanted !== undefined && wanted !== 'mixed' && wanted !== (initial[path] ?? 'off');
    });
}

/**
 * The requests of a save, one per changed node.
 *
 * Into a node: the selected rows that are not already in it. Out of a node: every selected row and
 * every channel of a selected device that holds it - a device row shown `on` because its channels
 * are in the room is only out of it when they are. A change that needs no request (nothing left
 * to move) is left out.
 */
export function assignRequests(
    targets: readonly AssignTarget[],
    paths: readonly string[],
    desired: Readonly<Record<string, CheckState>>,
    lookup: ViewLookup,
): AssignRequest[] {
    const requests: AssignRequest[] = [];
    for (const path of paths) {
        const on = desired[path] === 'on';
        const refs = new Set<string>();
        for (const target of targets) {
            if (on) {
                if (targetState(target, path, lookup) !== 'on') {
                    refs.add(target.ref);
                }
                continue;
            }
            for (const ref of [target.ref, ...target.channels]) {
                if (holds(lookup, ref, path)) {
                    refs.add(ref);
                }
            }
        }
        if (refs.size > 0) {
            requests.push({path, on, refs: [...refs]});
        }
    }
    return requests;
}

/** Lower case without accents: `Küche` and `kuche` are the same to the filter. */
export function foldForFilter(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/**
 * The nodes the filter leaves in the list: every node whose name contains the query, and the
 * parents of each, so a room is seen under its floor. An empty query leaves everything.
 */
export function filterOptions(options: readonly NodeOption[], query: string): NodeOption[] {
    const needle = foldForFilter(query.trim());
    if (needle === '') {
        return [...options];
    }
    const matches = options.filter((option) => foldForFilter(option.label).includes(needle));
    return options.filter(
        (option) => matches.includes(option) || matches.some((match) => match.path.startsWith(`${option.path}/`)),
    );
}
