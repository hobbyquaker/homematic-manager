import type {CallbackWarning, InterfaceState} from '@homematic-manager/core';

import type {MetaMark} from './metaIndicator.js';

/**
 * What the interface popup and the header's summary mark are made of (task 21).
 *
 * Pure, so the four marks and the second line under an interface name can be asserted without a
 * DOM: the component draws what these two functions decide and adds no rule of its own.
 */

/**
 * The four states an interface can be in, in the words of the header of 2.7 plus the two the
 * rebuild added.
 *
 * `absent` is not `bad`: a refused port means the interface process does not exist on this system
 * (task 13), which every CCU without a wired gateway answers for BidCos-Wired, and painting that
 * red made a healthy system look broken. `busy` is D-31: `init` is through and the first device
 * sweep is still running, so neither the tick nor the cross would be honest yet.
 */
export type InterfaceMark = 'ok' | 'busy' | 'absent' | 'bad';

/** The glyphs of 2.7 (✔ and ✕) plus one for each of the two states it did not know. */
export const MARK_GLYPH: Readonly<Record<InterfaceMark, string>> = {
    ok: '✔',
    busy: '↻',
    absent: '–',
    bad: '✕',
};

export function markOf(state: InterfaceState): InterfaceMark {
    // task 56: waiting at the start for an interface process that is not up yet is on its way too,
    // and so is one that lost its subscription and is being subscribed again (B-56)
    if (state.subscribing === true || ((state.waiting === true || state.reconnecting === true) && !state.connected)) {
        return 'busy';
    }
    if (state.connected) {
        return 'ok';
    }
    return state.absent === true ? 'absent' : 'bad';
}

/**
 * B-28: the interfaces the popup offers to try again at once - configured, not connected and not
 * answering (a timeout, no route). One that refuses is not present and would only refuse again; the
 * watchdog keeps its own slow retry for those.
 */
export function notAnsweringNames(states: readonly InterfaceState[]): string[] {
    return states
        .filter((state) => !state.connected && state.subscribing !== true && state.unreachable === true)
        .map((state) => state.name);
}

/**
 * One mark for the whole CCU - what the header shows now that the per-interface marks live in the
 * popup.
 *
 * A fault wins over everything: the point of the mark is that the user sees it without opening
 * anything. An interface that is only absent never makes the header red (see {@link markOf}), and
 * a CCU whose interfaces are *all* absent is not "connected" either, so the dash is what is left.
 */
export function summaryMark(states: readonly InterfaceState[]): InterfaceMark {
    const marks = states.map((state) => markOf(state));
    if (marks.includes('bad')) {
        return 'bad';
    }
    if (marks.includes('busy')) {
        return 'busy';
    }
    return marks.includes('ok') ? 'ok' : 'absent';
}

/**
 * The metadata store as an entry of the picker (the maintainer, 2026-09-10): one row under the
 * host and above the interfaces, half their height, with the store's dot and name. Selected like
 * an interface and reported through `onselect` under its `id`, which the app reserves so that it
 * cannot be the name of an interface process.
 */
export interface StoreEntry {
    readonly id: string;
    /** `ReGaHSS`, `occulited`, "This profile". */
    readonly label: string;
    readonly mark: MetaMark;
    /** The tooltip: state, revision, implementation, error - and so the reason when it cannot be selected. */
    readonly title: string;
    /** False while the store does not answer: the row is shown and greyed, never chosen. */
    readonly selectable: boolean;
    readonly provider?: string | undefined;
}

/** What the UI knows about an interface beyond its state; both halves are often unknown. */
export interface InterfaceDetails {
    /** Devices of that interface, when the devices store has loaded them. */
    readonly devices?: number | undefined;
    /** Duty cycle in percent of the busiest gateway, when the Radio tab has read them. */
    readonly dutyCycle?: number | undefined;
}

export interface CallbackLabels {
    readonly portInUse: (port: number) => string;
    readonly portFailed: (port: number) => string;
    readonly publish: string;
}

/**
 * Task 38: the third line of an item - the URL the interface was told to call back on, or why it
 * was told none. In a container whose callback servers listen beyond the loopback the URL carries
 * the reminder that its port has to be published unchanged; `undefined` when there is nothing to
 * say, which is every interface that takes no `init`.
 */
export function callbackLine(
    state: InterfaceState,
    publish: boolean,
    labels: CallbackLabels,
): {text: string; bad: boolean} | undefined {
    if (state.callbackFailure !== undefined) {
        const {port, inUse} = state.callbackFailure;
        return {text: inUse ? labels.portInUse(port) : labels.portFailed(port), bad: true};
    }
    if (state.callbackUrl === undefined) {
        return undefined;
    }
    return {text: publish ? `${state.callbackUrl} · ${labels.publish}` : state.callbackUrl, bad: false};
}

/**
 * B-53 (#162, #165): the set callback address does not fit - the same for every interface, since
 * they all share it, so the first one that says so speaks for all of them.
 */
export function callbackWarningOf(states: readonly InterfaceState[]): CallbackWarning | undefined {
    return states.find((state) => state.callbackWarning !== undefined)?.callbackWarning;
}

export interface DetailLabels {
    readonly port: string;
    readonly tls: string;
    readonly devices: (count: number) => string;
    readonly dutyCycle: (value: number) => string;
}

/**
 * The small second line of an item: protocol, port, encryption, and what the UI happens to know.
 *
 * Everything after the port is left out when it is unknown rather than shown as a zero - an
 * interface whose devices have never been loaded has no device count, and only the radio
 * interfaces report a duty cycle at all.
 */
export function detailParts(
    state: InterfaceState,
    details: InterfaceDetails | undefined,
    labels: DetailLabels,
): string[] {
    const parts = [state.protocol, `${labels.port} ${String(state.port)}`];
    if (state.tls === true) {
        parts.push(labels.tls);
    }
    if (details?.devices !== undefined) {
        parts.push(labels.devices(details.devices));
    }
    if (details?.dutyCycle !== undefined) {
        parts.push(labels.dutyCycle(details.dutyCycle));
    }
    return parts;
}
