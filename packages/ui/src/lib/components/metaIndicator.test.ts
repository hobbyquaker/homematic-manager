import {describe, expect, it} from 'vitest';

import type {MetaState} from '@homematic-manager/core';

import {metaTitle} from './metaIndicator.js';

const LABELS = {
    label: 'this profile',
    reachable: 'reachable',
    unreachable: 'unreachable',
    readOnly: 'read-only',
    writable: 'writable',
    detail: (state: MetaState) => `revision ${String(state.revision)}`,
};

const STATE: MetaState = {provider: 'local', reachable: true, writable: true, revision: 3, objects: 0};

describe('the store tooltip', () => {
    it('names what exists', () => {
        expect(metaTitle(STATE, LABELS)).toBe('this profile · reachable · writable · revision 3');
        expect(metaTitle(undefined, LABELS)).toBe('');
    });

    it('says when the certificate of the system is not trusted (B-67)', () => {
        const certificate = {
            url: 'https://10.0.0.5',
            code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
            certificate: {subject: 'lite', issuer: 'CA', fingerprint256: 'AA', validTo: '2027'},
        };
        const state = {...STATE, certificate};
        expect(metaTitle(state, LABELS)).toContain('· UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
        expect(metaTitle(state, {...LABELS, certificate: (problem) => `untrusted: ${problem.url}`})).toContain(
            '· untrusted: https://10.0.0.5',
        );
    });
});
