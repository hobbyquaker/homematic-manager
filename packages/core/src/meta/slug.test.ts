/**
 * Node ids out of names a user typed.
 *
 * Nothing in the corpus creates a node from a name - it always names the id itself - so the
 * transcription is ours to keep honest, and it is the one openccu-lite's own CCU import uses. Two
 * properties matter beyond "it looks tidy": "Bad" and "Bäd" have to stay two different ids, or an
 * import would silently merge two rooms, and a name that folds to nothing at all still has to
 * produce an id, because the id is a machine key and the name is what the user reads.
 */

import {describe, expect, it} from 'vitest';

import {slugOf, slugId} from './slug.js';

describe('slugOf', () => {
    it('lower cases and leaves an ordinary name alone', () => {
        expect(slugOf('Wohnzimmer')).toBe('wohnzimmer');
    });

    it('writes the German umlauts out, the way the CCU import does', () => {
        expect(slugOf('Küche')).toBe('kueche');
        expect(slugOf('Straße')).toBe('strasse');
        // which is what keeps two rooms two rooms
        expect(slugOf('Bäd')).toBe('baed');
        expect(slugOf('Bad')).toBe('bad');
        expect(slugOf('Bäd')).not.toBe(slugOf('Bad'));
    });

    it('writes the Nordic letters out and drops an accent', () => {
        expect(slugOf('Åre')).toBe('are');
        expect(slugOf('Ærø')).toBe('aeroe');
        expect(slugOf('Søndre')).toBe('soendre');
        expect(slugOf('Café')).toBe('cafe');
        expect(slugOf('Étage')).toBe('etage');
    });

    it('folds punctuation and spaces to single hyphens and trims them off the ends', () => {
        expect(slugOf('Wohn / Ess-Zimmer!')).toBe('wohn-ess-zimmer');
        expect(slugOf('Büro 2. OG')).toBe('buero-2-og');
        expect(slugOf('-Bad-')).toBe('bad');
        expect(slugOf('2. Stock')).toBe('2-stock');
    });

    it('cuts at the 32 characters an id may have', () => {
        expect(slugOf('Ein sehr langer Raumname im Erdgeschoss hinten')).toBe('ein-sehr-langer-raumname-im-erdg');
        expect(slugOf('a'.repeat(40))).toHaveLength(32);
    });

    it('is empty when nothing survives the fold', () => {
        expect(slugOf('   ')).toBe('');
        expect(slugOf('???')).toBe('');
        expect(slugOf('😀🎉')).toBe('');
        expect(slugOf('Комната')).toBe('');
    });
});

describe('slugId', () => {
    it('is the slug when nothing has it yet', () => {
        expect(slugId('Wohnzimmer')).toBe('wohnzimmer');
        expect(slugId('Wohnzimmer', ['bad', 'kueche'])).toBe('wohnzimmer');
    });

    it('counts up behind a collision', () => {
        expect(slugId('Bad', ['bad'])).toBe('bad-2');
        expect(slugId('Bad', ['bad', 'bad-2'])).toBe('bad-3');
        expect(slugId('Bad', ['bad', 'bad-2', 'bad-3'])).toBe('bad-4');
    });

    it('keeps a numbered id inside the 32 characters, by shortening the base', () => {
        const long = slugOf('Ein sehr langer Raumname im Erdgeschoss hinten');
        const next = slugId('Ein sehr langer Raumname im Erdgeschoss hinten', [long]);
        expect(next).toBe('ein-sehr-langer-raumname-im-er-2');
        expect(next.length).toBeLessThanOrEqual(32);
    });

    it('a name that folds to nothing still gets an id', () => {
        expect(slugId('😀')).toBe('node');
        expect(slugId('Комната', ['node'])).toBe('node-2');
    });

    it('gives up rather than count for ever', () => {
        const taken = ['bad', ...Array.from({length: 998}, (_, index) => `bad-${index + 2}`)];
        expect(() => slugId('Bad', taken)).toThrow('no free id for Bad');
    });
});
