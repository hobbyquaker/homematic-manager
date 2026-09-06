import type {InterfaceState} from '@homematic-manager/core';

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
    if (state.subscribing === true) {
        return 'busy';
    }
    if (state.connected) {
        return 'ok';
    }
    return state.absent === true ? 'absent' : 'bad';
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

/** What the UI knows about an interface beyond its state; both halves are often unknown. */
export interface InterfaceDetails {
    /** Devices of that interface, when the devices store has loaded them. */
    readonly devices?: number | undefined;
    /** Duty cycle in percent of the busiest gateway, when the Radio tab has read them. */
    readonly dutyCycle?: number | undefined;
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
