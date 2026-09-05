#!/usr/bin/env node

/**
 * A CycloneDX 1.6 SBOM of one built addon package (D-27).
 *
 *   node apps/ccu-addon/sbom.mjs --package out/hmm-ccu-<arch>-<version>.tar.gz \
 *        --tree out/work/<arch>/pkg/hmm --web-tarball <the packed apps/web tarball>
 *
 * What is inside an addon package is two different things, and a CVE search has to find both:
 *
 * - the npm tree of `app/` - which is exactly the published `@homematic-manager/web` tarball with
 *   its dependencies installed, so `apps/web/scripts/sbom.mjs` already knows how to describe it
 *   (it installs the tarball and runs `cyclonedx-npm` on the result, which is the only way the
 *   bundled workspace packages of D-29 show up at all). It is run here rather than reimplemented,
 *   so the npm half of this document can never drift from the npm deliverable's own;
 * - the runtime that is not an npm dependency: the bundled Node binary, and on armv7l the Alpine
 *   packages `build-runtime.sh` unpacked into `lib/` and `share/` - musl, ICU, OpenSSL among them.
 *   Those become `pkg:apk/alpine/...` components from the resolution `alpine-packages.js` wrote.
 *
 * `metadata.component` is the .tar.gz itself with its hashes, so the document is a statement about
 * one artefact - which is what `actions/attest-sbom` signs against that same file in
 * `release-addon.yml`. `apps/ccu-addon/test/package-test.sh` checks that the Node component in here
 * says the same version as the `node -v` of the binary in the package.
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const addonDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(addonDir, '..', '..');

const options = parseArguments(process.argv.slice(2));
if (!options.package || !options.tree) {
    console.error('usage: sbom.mjs --package <file.tar.gz> --tree <staging tree> [--web-tarball <file.tgz>]');
    process.exit(2);
}

const versions = readVersions(path.join(options.tree, 'versions'));
const sbom = npmPart(options.webTarball);
sbom.components.push(...runtimeComponents(versions, options.tree));
decorate(sbom, options.package, versions);
check(sbom, versions);

const out = options.out ?? `${options.package}.cdx.json`;
fs.writeFileSync(out, `${JSON.stringify(sbom, undefined, 2)}\n`);
console.log(`sbom:           ${path.relative(repoRoot, out)} (${sbom.components.length} components)`);

function parseArguments(argv) {
    const parsed = {};
    const names = {'--package': 'package', '--tree': 'tree', '--web-tarball': 'webTarball', '--out': 'out'};
    for (let index = 0; index < argv.length; index += 1) {
        const name = names[argv[index]];
        const value = argv[index + 1];
        if (name && value) {
            parsed[name] = path.resolve(value);
            index += 1;
        }
    }
    return parsed;
}

/** `KEY="value"` lines, the file `build-runtime.sh` writes and the rc.d script sources. */
function readVersions(file) {
    const values = {};
    if (!fs.existsSync(file)) {
        return values;
    }
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const match = /^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/.exec(line.trim());
        if (match) {
            values[match[1]] = match[2];
        }
    }
    return values;
}

/** The npm half, produced by the web package's own SBOM script against the tarball this build packed. */
function npmPart(webTarball) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-addon-sbom-'));
    try {
        const out = path.join(workDir, 'web.cdx.json');
        const script = path.join(repoRoot, 'apps', 'web', 'scripts', 'sbom.mjs');
        const args = [script, '--out', out];
        if (webTarball) {
            args.push('--tarball', webTarball);
        }
        execFileSync(process.execPath, args, {cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit']});
        const document = JSON.parse(fs.readFileSync(out, 'utf8'));
        document.components ??= [];
        return document;
    } finally {
        fs.rmSync(workDir, {recursive: true, force: true});
    }
}

/** The bundled Node, and on armv7l the Alpine packages it was taken from. */
function runtimeComponents(versions, tree) {
    const components = [];
    const nodeVersion = (versions.NODE_VERSION ?? '').replace(/^v/, '');
    if (nodeVersion !== '') {
        components.push({
            type: 'application',
            'bom-ref': `node@${nodeVersion}`,
            name: 'node',
            version: nodeVersion,
            description: `the Node.js runtime bundled in the addon (${versions.NODE_SOURCE ?? 'unknown source'})`,
            scope: 'required',
            licenses: [{license: {id: 'MIT'}}],
            purl: `pkg:generic/node@${nodeVersion}?arch=${versions.NODE_ARCH ?? 'unknown'}`,
            externalReferences: [{type: 'website', url: 'https://nodejs.org/'}],
            properties: [
                {name: 'hmm:runtime', value: 'node'},
                {name: 'hmm:runtime:arch', value: versions.NODE_ARCH ?? ''},
                {name: 'hmm:runtime:source', value: versions.NODE_SOURCE ?? ''},
            ],
        });
    }

    const alpineFile = path.join(tree, 'alpine-packages.json');
    if (!fs.existsSync(alpineFile)) {
        return components;
    }
    const alpine = JSON.parse(fs.readFileSync(alpineFile, 'utf8'));
    for (const entry of alpine.packages ?? []) {
        const qualifiers = `arch=${alpine.arch}&distro=alpine-${alpine.branch}`;
        components.push({
            type: 'library',
            'bom-ref': `pkg:apk/alpine/${entry.name}@${entry.version}?${qualifiers}`,
            name: entry.name,
            version: entry.version,
            scope: 'required',
            ...(entry.license ? {licenses: [{license: {name: entry.license}}]} : {}),
            purl: `pkg:apk/alpine/${entry.name}@${entry.version}?${qualifiers}`,
            externalReferences: [{type: 'distribution', url: entry.url}],
            properties: [
                {name: 'hmm:runtime', value: 'alpine'},
                ...(entry.origin ? [{name: 'apk:origin', value: entry.origin}] : []),
            ],
        });
    }
    return components;
}

/** Names the .tar.gz as the subject of the document, with the hashes `attest-sbom` will see. */
function decorate(sbom, packageFile, versions) {
    const bytes = fs.readFileSync(packageFile);
    const name = path.basename(packageFile).replace(/\.tar\.gz$/, '');
    const version = versions.VERSION_ADDON ?? '0.0.0';
    sbom.metadata ??= {};
    sbom.metadata.component = {
        type: 'application',
        'bom-ref': `${name}@${version}`,
        name: `homematic-manager-ccu-addon-${versions.NODE_ARCH ?? 'unknown'}`,
        version,
        description: `Homematic Manager CCU3 / OpenCCU addon for ${versions.NODE_ARCH ?? 'unknown'}`,
        licenses: [{license: {id: 'AGPL-3.0-or-later'}}],
        purl: `pkg:generic/homematic-manager-ccu-addon@${version}?arch=${versions.NODE_ARCH ?? 'unknown'}`,
        hashes: [
            {alg: 'SHA-256', content: createHash('sha256').update(bytes).digest('hex')},
            {alg: 'SHA-512', content: createHash('sha512').update(bytes).digest('hex')},
        ],
        properties: [
            {name: 'hmm:package', value: path.basename(packageFile)},
            {name: 'hmm:node', value: versions.NODE_VERSION ?? ''},
            {name: 'hmm:build-date', value: versions.BUILD_DATE ?? ''},
        ],
    };
}

/** D-27 wants a broken SBOM found on a push build, not at a tag. */
function check(sbom, versions) {
    const problems = [];
    const names = new Set(
        sbom.components.flatMap((component) => [
            component.name,
            component.group === undefined ? component.name : `${component.group}/${component.name}`,
        ]),
    );
    for (const wanted of ['@homematic-manager/backend', '@homematic-manager/core', 'ws', 'node']) {
        if (!names.has(wanted)) {
            problems.push(`${wanted} is missing from the component list`);
        }
    }
    if (
        versions.NODE_ARCH === 'armv7l' &&
        !sbom.components.some((component) => component.purl?.startsWith('pkg:apk/'))
    ) {
        problems.push('the armv7l runtime is repackaged from Alpine but no apk component is listed');
    }
    if (problems.length > 0) {
        console.error(`sbom: ${problems.join('; ')}`);
        process.exit(1);
    }
}
