#!/usr/bin/env node
/**
 * The title and body of the GitHub draft release for a tag.
 *
 * The four release workflows of D-24 attach their assets with `softprops/action-gh-release`, and
 * whichever gets there first creates the draft. Left to itself the action names the release after
 * the tag (`v3.0.0-beta.5`, where every release so far was `3.0.0-beta.5`) and its body is only
 * GitHub's generated notes - and on every later attach it *replaces* name and body with whatever
 * that workflow hands it. So all four have to hand it the same thing, computed here from the tag:
 *
 *   1. the 3.0 hint, the paragraph every 3.0 pre-release opened with (German, then English),
 *   2. the CHANGELOG.md section of the version - the text between `## [<version>]` and the next
 *      `## [` - with its paragraphs unwrapped (a release body renders a newline as a line break,
 *      the changelog is wrapped at 100 columns) and its relative links pointed at the tag,
 *   3. GitHub's generated notes for the tag (the "Full Changelog" compare link, and the pull
 *      requests when there are any), fetched from the API the way `generate_release_notes` did.
 *
 * A missing changelog section or an unreachable API is said in the body and warned about, never
 * a failed release: the assets matter more than the prose, and the draft is edited by hand anyway
 * (docs/release-checklist.md, step 4).
 *
 * Usage: `node scripts/release-notes.mjs <tag> <body-file>`; needs `GH_TOKEN` (or `GITHUB_TOKEN`)
 * and `GITHUB_REPOSITORY` for the generated notes. Writes `name=<tag>` and `body=<body-file>`
 * to `$GITHUB_OUTPUT` when that is set, otherwise prints them.
 */
import {readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `v3.0.0-beta.5` -> `3.0.0-beta.5`: the tag carries the `v`, the release title and the changelog do not. */
export function versionOf(tag) {
    return tag.replace(/^v/, '');
}

/**
 * The changelog section of one version: the lines between its `## [<version>]` heading and the
 * next `## [` heading, the heading itself included. `undefined` when there is no such section.
 *
 * @param {string} changelog the text of CHANGELOG.md
 * @param {string} version
 * @returns {{heading: string, body: string} | undefined}
 */
export function changelogSection(changelog, version) {
    const lines = changelog.split(/\r?\n/);
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const start = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\](\\s|$)`).test(line));
    if (start === -1) {
        return undefined;
    }
    let end = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
    if (end === -1) {
        end = lines.length;
    }
    // `## [3.0.0-beta.5] — 2026-09-08` -> `## 3.0.0-beta.5 — 2026-09-08`: the brackets are a
    // reference link inside CHANGELOG.md, whose definitions are not part of the section.
    const heading = lines[start].replace(/^## \[([^\]]+)\]/, '## $1');
    const body = lines
        .slice(start + 1, end)
        .join('\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');
    return {heading, body};
}

/**
 * Joins the hard-wrapped lines of paragraphs and list items back into one line each. A GitHub
 * release body renders a newline as a line break, so a changelog wrapped at 100 columns would come
 * out ragged. Headings, list items, table rows, block quotes and blank lines start a line; fenced
 * code is left alone.
 *
 * @param {string} markdown
 */
export function unwrap(markdown) {
    const out = [];
    let inCode = false;
    let joinable = false;
    for (const raw of markdown.split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (/^\s*(```|~~~)/.test(line)) {
            inCode = !inCode;
            out.push(line);
            joinable = false;
            continue;
        }
        if (inCode) {
            out.push(line);
            continue;
        }
        const startsBlock = line === '' || /^\s*(#|[-*+]\s|\d+[.)]\s|\||>)/.test(line);
        if (joinable && !startsBlock) {
            out[out.length - 1] += ` ${line.trim()}`;
        } else {
            out.push(line);
        }
        joinable = line !== '' && !/^\s*(#|\||>)/.test(line);
    }
    return out.join('\n');
}

/**
 * Points the relative links of the changelog (`[openccu-lite](docs/openccu-lite.md)`) at the
 * repository at the tag, so they work from the release page. Absolute URLs, anchors and
 * root-relative paths are left as they are.
 *
 * @param {string} markdown
 * @param {string} base `https://github.com/<owner>/<repo>/blob/<tag>`
 */
export function absoluteLinks(markdown, base) {
    return markdown.replace(/\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi, (_, path) => `](${base}/${path})`);
}

/**
 * The paragraph every 3.0 pre-release opened with, in both languages. The "for testing" sentence
 * is a pre-release thing and is dropped for a plain version.
 *
 * @param {string} version
 * @param {string} base `https://github.com/<owner>/<repo>/blob/<tag>`
 */
export function hint(version, base) {
    const prerelease = version.includes('-');
    const migration = `${base}/docs/migration-from-2.x.md`;
    const changelog = `${base}/CHANGELOG.md`;
    const de =
        '**Homematic Manager 3.0 ist ein kompletter Neubau** von 2.7.1: aktuelles Electron, Svelte 5, ein getesteter ' +
        'TypeScript-Kern, ein Node-Backend — und dieselben Reiter, Tabellen, Dialoge und Arbeitsabläufe wie bisher.' +
        (prerelease ? ' Diese Beta ist zum Testen gedacht.' : '') +
        ` Was sich für 2.x-Nutzer ändert: [docs/migration-from-2.x.md](${migration}); alles Weitere: ` +
        `[CHANGELOG.md](${changelog}).`;
    const en =
        '**Homematic Manager 3.0 is a complete rebuild** of 2.7.1 on current Electron, Svelte 5, a tested TypeScript ' +
        'core and a Node backend, keeping the tabs, grids, dialogs and workflows of 2.x.' +
        (prerelease ? ' This beta is for testing.' : '') +
        ` What changed for 2.x users: [docs/migration-from-2.x.md](${migration}); everything: ` +
        `[CHANGELOG.md](${changelog}).`;
    return `${de}\n\n${en}`;
}

/**
 * Assembles the body: hint, changelog section, generated notes. Each part is optional except the
 * hint, and a missing changelog section is stated in its place.
 *
 * @param {{tag: string, repository: string, changelog: string, generated?: string}} input
 * @returns {{name: string, body: string, missingSection: boolean}}
 */
export function releaseNotes({tag, repository, changelog, generated}) {
    const version = versionOf(tag);
    const base = `https://github.com/${repository}/blob/${tag}`;
    const section = changelogSection(changelog, version);
    const parts = [hint(version, base)];
    if (section) {
        parts.push(`${section.heading}\n\n${absoluteLinks(unwrap(section.body), base)}`);
    } else {
        parts.push(`_CHANGELOG.md has no section for ${version}._`);
    }
    const notes = generated?.trim();
    if (notes) {
        parts.push(notes);
    }
    // the title is the tag itself, `v3.0.0` (the maintainer, 2026-09-29: "title = tag")
    return {name: tag, body: `${parts.join('\n\n')}\n`, missingSection: !section};
}

/**
 * What `generate_release_notes: true` asked GitHub for, fetched directly so that it can be put
 * *below* the changelog section (the API prepends a given body, and only when creating).
 *
 * @returns {Promise<string>} the generated body, or '' with a warning when it cannot be fetched
 */
export async function fetchGeneratedNotes(tag, repository, token) {
    if (!token) {
        console.log('::warning::no GH_TOKEN, the release body has no generated notes');
        return '';
    }
    try {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases/generate-notes`, {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({tag_name: tag}),
        });
        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 200)}`);
        }
        return (await response.json()).body ?? '';
    } catch (error) {
        console.log(`::warning::could not generate the release notes for ${tag}: ${error.message}`);
        return '';
    }
}

async function main() {
    const [tag, outFile] = process.argv.slice(2);
    if (!tag || !outFile) {
        console.error('usage: node scripts/release-notes.mjs <tag> <body-file>');
        process.exit(2);
    }
    const repository = process.env.GITHUB_REPOSITORY || 'hobbyquaker/homematic-manager';
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
    const generated = await fetchGeneratedNotes(tag, repository, token);
    const {name, body, missingSection} = releaseNotes({tag, repository, changelog, generated});
    if (missingSection) {
        console.log(`::warning::CHANGELOG.md has no section for ${name}; the release body says so`);
    }
    writeFileSync(outFile, body);
    const outputs = `name=${name}\nbody=${outFile}\n`;
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, outputs);
    }
    process.stdout.write(outputs);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    await main();
}
