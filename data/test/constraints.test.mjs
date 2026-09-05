/**
 * `lib/constraints.mjs` resolves the raw Tcl that `easymode_extract.json.gz` carries. The unit
 * cases run everywhere; the cross-check against the pinned artifacts needs `data/upstream/`, so it
 * is skipped in a checkout that has not run `npm run fetch` (CI has not).
 */
import {existsSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {JUMP_TARGETS, resolveValues, toConstraint} from '../scripts/lib/constraints.mjs';
import {readUpstreamJson, upstreamDir} from '../scripts/lib/paths.mjs';

describe('resolveValues', () => {
    it('passes numbers and booleans through', () => {
        expect(resolveValues(4)).toEqual([4]);
        expect(resolveValues(0.05)).toEqual([0.05]);
        expect(resolveValues(true)).toEqual([true]);
    });

    it('strips Tcl comments', () => {
        expect(resolveValues('149 ;# match with profile 4')).toEqual([149]);
        expect(resolveValues('{3 4} ;# siehe SHORT_JT_ON')).toEqual([3, 4]);
    });

    it('reads booleans written as words as 0 and 1', () => {
        expect(resolveValues('false')).toEqual([0]);
        expect(resolveValues('true')).toEqual([1]);
    });

    it('substitutes the jump-target symbols', () => {
        expect(resolveValues('[subst {$ON_DELAY $OFF_DELAY}]')).toEqual([1, 4]);
        expect(resolveValues('[subst {$REFON $OFF $RAMP_OFF}]')).toEqual([7, 6, 5]);
        expect(JUMP_TARGETS.NOP).toBe(0);
    });

    it('drops Tcl it cannot evaluate rather than emitting garbage', () => {
        expect(resolveValues('[subst {$operationMode}]')).toEqual([]);
        expect(resolveValues('')).toEqual([]);
    });
});

describe('toConstraint', () => {
    it('maps the three upstream constraint types', () => {
        expect(toConstraint({constraint_type: 'fixed', value: 4})).toEqual({kind: 'fixed', value: 4});
        expect(toConstraint({constraint_type: 'list', values: [1, 2, 3]})).toEqual({kind: 'list', values: [1, 2, 3]});
        expect(toConstraint({constraint_type: 'range', min_value: 0, max_value: 1, default: 0.5})).toEqual({
            kind: 'range',
            min: 0,
            max: 1,
            default: 0.5,
        });
    });

    it('collapses a one-value list to a fixed value, as the profiles extractor does', () => {
        expect(toConstraint({constraint_type: 'list', values: [0, 'false']})).toEqual({kind: 'fixed', value: 0});
    });

    it('returns undefined when nothing survives', () => {
        expect(toConstraint({constraint_type: 'fixed', value: ''})).toBeUndefined();
        expect(toConstraint({constraint_type: 'range', min_value: 'x', max_value: 1})).toBeUndefined();
    });
});

const hasUpstream = existsSync(path.join(upstreamDir, 'easymode_extract.json.gz'));

describe.skipIf(!hasUpstream)('cross-check against the pinned artifacts', () => {
    it('agrees with the profiles extractor wherever both sources describe the same profile', () => {
        const easymode = readUpstreamJson('easymode_extract.json.gz');
        let compared = 0;
        let equal = 0;
        const differences = [];
        for (const [receiverType, meta] of Object.entries(easymode.channel_metadata)) {
            const file = path.join(upstreamDir, 'profiles', `${receiverType}.json.gz`);
            if (!existsSync(file)) continue;
            const fromProfiles = readUpstreamJson(`profiles/${receiverType}.json.gz`);
            for (const [senderType, sender] of Object.entries(meta.sender_types)) {
                const byId = new Map((fromProfiles[senderType]?.profiles ?? []).map((p) => [p.id, p]));
                for (const profile of sender.profiles ?? []) {
                    const reference = byId.get(profile.id);
                    if (!reference) continue;
                    for (const [name, raw] of Object.entries(profile.params ?? {})) {
                        const expected = reference.params?.[name];
                        if (!expected) continue;
                        compared += 1;
                        const actual = toConstraint(raw);
                        const wanted = toConstraint(expected);
                        if (JSON.stringify(actual) === JSON.stringify(wanted)) equal += 1;
                        else differences.push(`${receiverType}/${senderType}#${profile.id}.${name}`);
                    }
                }
            }
        }
        expect(compared).toBeGreaterThan(20000);
        // The remainder are genuine upstream disagreements (a handful of `{a b}` lists that the
        // profiles extractor reduced differently); the profiles file wins in the converter.
        expect(equal / compared).toBeGreaterThan(0.99);
    });
});
