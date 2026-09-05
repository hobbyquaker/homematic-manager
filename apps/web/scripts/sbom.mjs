#!/usr/bin/env node

/**
 * A CycloneDX 1.6 SBOM of the published npm tarball (D-27).
 *
 * Running `cyclonedx-npm` on the workspace would describe the *repository's* dependency tree, which
 * is not what a user installs: the tarball carries `@homematic-manager/backend` and `.../core`
 * bundled (see `prepack.mjs`), and those never appear in a registry lookup. So the SBOM is taken
 * from the real thing: the tarball is installed into a temporary directory with
 * `npm install --omit=dev --ignore-scripts`, and `cyclonedx-npm` describes *that* tree. What comes
 * out therefore lists the bundled workspace packages next to `binrpc`, `homematic-rega`,
 * `homematic-xmlrpc` and `ws`, at the versions the tarball actually resolves to.
 *
 * `metadata.component` is the tarball itself, with its SHA-512, so the document is a statement
 * about one artefact rather than about "the project" - which is what `actions/attest-sbom` signs
 * against that same file in `release-npm.yml`.
 *
 * The script fails when the result is obviously broken (too few components, or the bundled backend
 * missing), because D-27 wants a broken SBOM step found on a push build and not at a tag.
 *
 * Usage: node scripts/sbom.mjs [--tarball <file>] [--out <file>] [--floor <n>]
 *        With no `--tarball` it packs one into a temporary directory first.
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');

const options = parseArguments(process.argv.slice(2));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-sbom-'));

try {
    const tarball = options.tarball ?? pack(workDir);
    const tree = installInto(workDir, tarball);
    const sbom = describe(tree);
    addBundled(sbom, tree);
    decorate(sbom, tarball);
    check(sbom, options.floor);

    const out = options.out ?? `${tarball}.cdx.json`;
    fs.writeFileSync(out, `${JSON.stringify(sbom, undefined, 2)}\n`);
    console.log(`sbom: ${out} (${sbom.components.length} components)`);
} finally {
    fs.rmSync(workDir, {recursive: true, force: true});
}

function parseArguments(argv) {
    const parsed = {floor: 4};
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index + 1];
        if (argv[index] === '--tarball' && value) {
            parsed.tarball = path.resolve(value);
            index += 1;
        } else if (argv[index] === '--out' && value) {
            parsed.out = path.resolve(value);
            index += 1;
        } else if (argv[index] === '--floor' && value) {
            parsed.floor = Number(value);
            index += 1;
        }
    }
    return parsed;
}

function run(command, args, cwd) {
    return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 1 << 28,
    });
}

/** `npm pack` from the repository root, so the workspace flag and the lock file are where npm wants. */
function pack(destination) {
    const output = run('npm', ['pack', '-w', 'apps/web', '--pack-destination', destination], repoRoot);
    const file = output.trim().split('\n').at(-1);
    return path.join(destination, file);
}

/** The tree a user gets: production dependencies only, no lifecycle scripts. */
function installInto(workDir, tarball) {
    const tree = path.join(workDir, 'tree');
    fs.mkdirSync(tree, {recursive: true});
    fs.writeFileSync(path.join(tree, 'package.json'), '{"name":"hmm-sbom-tree","version":"0.0.0","private":true}\n');
    run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball], tree);
    return tree;
}

function describe(tree) {
    const out = path.join(tree, 'sbom.json');
    run(
        'npx',
        [
            '--yes',
            '@cyclonedx/cyclonedx-npm',
            '--spec-version',
            '1.6',
            '--output-format',
            'JSON',
            '--omit',
            'dev',
            '--output-file',
            out,
        ],
        tree,
    );
    const sbom = JSON.parse(fs.readFileSync(out, 'utf8'));
    sbom.components ??= [];
    return sbom;
}

/**
 * The bundled workspace packages, which `cyclonedx-npm` does not see.
 *
 * It builds its component list from what npm resolved against a registry, and a `bundleDependencies`
 * entry was never resolved - it came inside the tarball. They are the largest part of what actually
 * runs, so they are read from the installed tree and appended by hand.
 */
function addBundled(sbom, tree) {
    const bundledDir = path.join(tree, 'node_modules', 'homematic-manager', 'node_modules', '@homematic-manager');
    if (!fs.existsSync(bundledDir)) {
        return;
    }
    for (const entry of fs.readdirSync(bundledDir)) {
        const manifest = path.join(bundledDir, entry, 'package.json');
        if (!fs.existsSync(manifest)) {
            continue;
        }
        const {name, version, description, license} = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        sbom.components.push({
            type: 'library',
            'bom-ref': `${name}@${version}`,
            group: '@homematic-manager',
            name: entry,
            version,
            description,
            scope: 'required',
            ...(license === undefined ? {} : {licenses: [{license: {id: license}}]}),
            purl: `pkg:npm/%40homematic-manager/${entry}@${version}`,
            properties: [{name: 'cdx:npm:package:bundled', value: 'true'}],
        });
    }
}

/** Names the tarball as the subject of the document, with the hash `attest-sbom` will see. */
function decorate(sbom, tarball) {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const bytes = fs.readFileSync(tarball);
    sbom.metadata ??= {};
    sbom.metadata.component = {
        type: 'application',
        'bom-ref': `${manifest.name}@${manifest.version}`,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        licenses: [{license: {id: manifest.license}}],
        purl: `pkg:npm/${manifest.name.replace('@', '%40')}@${manifest.version}`,
        hashes: [
            {alg: 'SHA-256', content: createHash('sha256').update(bytes).digest('hex')},
            {alg: 'SHA-512', content: createHash('sha512').update(bytes).digest('hex')},
        ],
        properties: [{name: 'hmm:tarball', value: path.basename(tarball)}],
    };
}

function check(sbom, floor) {
    // CycloneDX splits a scoped name into `group` and `name`; both spellings are accepted here
    const names = new Set(
        sbom.components.flatMap((component) => [
            component.name,
            component.group === undefined ? component.name : `${component.group}/${component.name}`,
        ]),
    );
    const problems = [];
    if (sbom.components.length < floor) {
        problems.push(`only ${sbom.components.length} components, expected at least ${floor}`);
    }
    for (const wanted of ['@homematic-manager/backend', '@homematic-manager/core', 'ws']) {
        if (!names.has(wanted)) {
            problems.push(`${wanted} is missing - is it still bundled?`);
        }
    }
    if (problems.length > 0) {
        console.error(`sbom: ${problems.join('; ')}`);
        process.exit(1);
    }
}
