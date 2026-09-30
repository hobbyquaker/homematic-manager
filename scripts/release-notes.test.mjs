/**
 * The release body is text arithmetic over CHANGELOG.md, run once per release on four runners
 * where nobody looks at it until the draft is open. The pure parts are tested here; the API call
 * and the file writing are the CLI's and are not.
 */

import {describe, expect, it} from 'vitest';

import {absoluteLinks, changelogSection, hint, releaseNotes, unwrap, versionOf} from './release-notes.mjs';

const CHANGELOG = [
    '# Changelog',
    '',
    'Preamble with a [link](docs/x.md).',
    '',
    '## [3.0.0-beta.5] — 2026-09-08',
    '',
    'The first beta that talks to the HmIP addendum, and a smaller change',
    'for a box.',
    '',
    '- **HmIP service messages can be suppressed.** The VALUES dialog of a channel on an HmIP',
    '  interface shows a _Service messages_ section, see [the docs](docs/openccu-lite.md) and',
    '  [the site](https://example.org/x) and [the anchor](#known-issues).',
    '- **Fixed:** something.',
    '',
    '### Not in this release',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```sh',
    'one',
    'two',
    '```',
    '',
    '',
    '## [3.0.0-beta.4] — 2026-09-06',
    '',
    '- **Fixed:** older.',
    '',
    '[3.0.0-beta.4]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.4',
].join('\n');

const BASE = 'https://github.com/hobbyquaker/homematic-manager/blob/v3.0.0-beta.5';

describe('versionOf', () => {
    it('strips the v of the tag and nothing else', () => {
        expect(versionOf('v3.0.0-beta.5')).toBe('3.0.0-beta.5');
        expect(versionOf('3.1.0')).toBe('3.1.0');
        expect(versionOf('v3.1.0')).toBe('3.1.0');
    });
});

describe('changelogSection', () => {
    it('takes the text between the version heading and the next version heading', () => {
        const section = changelogSection(CHANGELOG, '3.0.0-beta.5');
        expect(section?.heading).toBe('## 3.0.0-beta.5 — 2026-09-08');
        expect(section?.body.startsWith('The first beta')).toBe(true);
        expect(section?.body.endsWith('```')).toBe(true);
        expect(section?.body).not.toContain('older');
    });

    it('takes the last section to the end of the file, link definitions included', () => {
        const section = changelogSection(CHANGELOG, '3.0.0-beta.4');
        expect(section?.body).toBe(
            '- **Fixed:** older.\n\n[3.0.0-beta.4]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.4',
        );
    });

    it('does not mistake 3.0.0-beta.5 for 3.0.0-beta.50, and reports a missing version', () => {
        expect(changelogSection(CHANGELOG.replace('[3.0.0-beta.5]', '[3.0.0-beta.50]'), '3.0.0-beta.5')).toBe(
            undefined,
        );
        expect(changelogSection(CHANGELOG, '3.0.0')).toBe(undefined);
        expect(changelogSection(CHANGELOG.replace(/\n/g, '\r\n'), '3.0.0-beta.5')?.heading).toBe(
            '## 3.0.0-beta.5 — 2026-09-08',
        );
    });
});

describe('unwrap', () => {
    it('joins wrapped paragraphs and list items and leaves blocks alone', () => {
        const section = changelogSection(CHANGELOG, '3.0.0-beta.5');
        const lines = unwrap(section.body).split('\n');
        expect(lines[0]).toBe('The first beta that talks to the HmIP addendum, and a smaller change for a box.');
        expect(lines[2]).toMatch(/^- \*\*HmIP service messages.*and \[the anchor\]\(#known-issues\)\.$/);
        expect(lines[3]).toBe('- **Fixed:** something.');
        expect(lines.slice(5)).toEqual([
            '### Not in this release',
            '',
            '| a | b |',
            '| --- | --- |',
            '| 1 | 2 |',
            '',
            '```sh',
            'one',
            'two',
            '```',
        ]);
    });

    it('starts a line at a heading, a quote or a numbered item', () => {
        expect(unwrap('a\nb\n# H\nc\n> q\n> r\n1. x\n   y\n2) z')).toBe('a b\n# H\nc\n> q\n> r\n1. x y\n2) z');
    });
});

describe('absoluteLinks', () => {
    it('points relative links at the tag and leaves the others', () => {
        const out = absoluteLinks(
            '[a](docs/x.md) [b](https://e.org/y) [c](#z) [d](/root) [e](mailto:x@y) [f](docs/y.md "t")',
            BASE,
        );
        expect(out).toBe(
            `[a](${BASE}/docs/x.md) [b](https://e.org/y) [c](#z) [d](/root) [e](mailto:x@y) [f](docs/y.md "t")`,
        );
    });
});

describe('hint', () => {
    it('says "for testing" for a pre-release only, in both languages', () => {
        const beta = hint('3.0.0-beta.5', BASE);
        expect(beta).toContain('Diese Beta ist zum Testen gedacht.');
        expect(beta).toContain('This beta is for testing.');
        expect(beta).toContain(`[CHANGELOG.md](${BASE}/CHANGELOG.md)`);
        const final = hint('3.0.0', BASE.replace('v3.0.0-beta.5', 'v3.0.0'));
        expect(final).not.toContain('Beta');
        expect(final).not.toContain('beta');
    });
});

describe('releaseNotes', () => {
    it('is the hint, the changelog section and the generated notes, in that order', () => {
        const {name, body, missingSection} = releaseNotes({
            tag: 'v3.0.0-beta.5',
            repository: 'hobbyquaker/homematic-manager',
            changelog: CHANGELOG,
            generated: '**Full Changelog**: https://github.com/hobbyquaker/homematic-manager/compare/a...b\n',
        });
        expect(name).toBe('v3.0.0-beta.5');
        expect(missingSection).toBe(false);
        const i = (needle) => body.indexOf(needle);
        expect(i('**Homematic Manager 3.0 ist')).toBe(0);
        expect(i('**Homematic Manager 3.0 is a complete')).toBeGreaterThan(0);
        expect(i('## 3.0.0-beta.5 — 2026-09-08')).toBeGreaterThan(i('**Homematic Manager 3.0 is a complete'));
        expect(i(`[the docs](${BASE}/docs/openccu-lite.md)`)).toBeGreaterThan(i('## 3.0.0-beta.5'));
        expect(i('**Full Changelog**')).toBeGreaterThan(i('```'));
        expect(body.endsWith('compare/a...b\n')).toBe(true);
        // the preamble's relative link is not in the section and is not rewritten anywhere
        expect(body).not.toContain('docs/x.md');
    });

    it('says so when the changelog has no section, and copes without generated notes', () => {
        const {body, missingSection} = releaseNotes({
            tag: 'v3.1.0',
            repository: 'hobbyquaker/homematic-manager',
            changelog: CHANGELOG,
            generated: '',
        });
        expect(missingSection).toBe(true);
        expect(body).toContain('_CHANGELOG.md has no section for 3.1.0._');
        expect(body.endsWith('for 3.1.0._\n')).toBe(true);
    });
});
