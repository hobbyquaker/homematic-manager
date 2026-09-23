import type {MetaState} from '@homematic-manager/core';

/**
 * The pure part of the store indicator (D-40, task 25): the colour of its dot and the words of
 * its tooltip. Two places draw it - the `MetaIndicator` control and the store's row in the
 * interface picker, where the store is an entry a user selects (the maintainer, 2026-09-10) - and
 * both have to agree on what green, amber and red mean.
 */

/** Green when the store takes writes, amber when it only answers reads, red when it does not answer. */
export type MetaMark = 'ok' | 'readonly' | 'bad';

export function metaMark(state: MetaState | undefined): MetaMark {
    if (state === undefined || !state.reachable) {
        return 'bad';
    }
    return state.writable ? 'ok' : 'readonly';
}

export interface MetaTitleLabels {
    readonly label: string;
    readonly reachable: string;
    readonly unreachable: string;
    readonly readOnly: string;
    readonly writable: string;
    /** `revision {revision}, {count} objects` */
    readonly detail: (state: MetaState) => string;
    /** B-67: `the certificate of {url} is not trusted ({code})`; left out, the code alone is said. */
    readonly certificate?: (problem: NonNullable<MetaState['certificate']>) => string;
}

/** The tooltip: name, state, revision and objects, the implementation and the error - what exists. */
export function metaTitle(state: MetaState | undefined, labels: MetaTitleLabels): string {
    if (state === undefined) {
        return '';
    }
    const parts = [
        labels.label,
        state.reachable ? labels.reachable : labels.unreachable,
        state.reachable ? (state.writable ? labels.writable : labels.readOnly) : undefined,
        labels.detail(state),
        state.implementation,
        state.error,
        // B-67: the system redirected to https:// and its certificate is trusted by nothing yet
        state.certificate === undefined
            ? undefined
            : (labels.certificate?.(state.certificate) ?? state.certificate.code),
    ];
    return parts.filter((part): part is string => part !== undefined && part !== '').join(' · ');
}
