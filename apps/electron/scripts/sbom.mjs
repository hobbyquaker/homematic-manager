#!/usr/bin/env node
/**
 * One CycloneDX 1.6 SBOM per installer (D-27).
 *
 * `@cyclonedx/cyclonedx-npm` describes the npm half of an installer: the production dependency
 * tree of this workspace, from the lock file, with the workspace packages resolved. That is maybe
 * a fifth of what is actually shipped. The rest is Electron - which is not an npm dependency at
 * runtime, is 200 MB of the 126 MB compressed installer, and is where a CVE is most likely to
 * turn up - plus whatever electron-builder embedded to make the installer itself: the AppImage
 * runtime, the NSIS toolchain, 7za.
 *
 * So this script takes the npm SBOM and adds:
 *
 * - `electron`, `chromium`, `node` and `v8` as separate components with the versions the target
 *   Electron actually reports, read by running it as Node. Separate components on purpose: a CVE
 *   feed is searched for "chromium 1xx", not for "electron 44".
 * - every tool electron-builder downloaded into its cache for this build, by name and version.
 *   Whatever is in that directory is what went into the installer.
 * - the installer file itself as `metadata.component`, with its SHA-512, so the SBOM is about one
 *   artefact rather than about "the project".
 *
 * The result is written next to each installer as `<installer>.cdx.json`, and the script fails
 * when the SBOM is obviously broken - too few components, or no Electron in it. D-27 asks for that
 * check to run on every push build, so that a broken SBOM step is found before a tag.
 *
 * Usage: node scripts/sbom.mjs [--out <dir>] [--floor <n>]
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(workspace, '..', '..');

/** Extensions that are an installer rather than a checksum, a blockmap or an update manifest. */
const INSTALLER_EXTENSIONS = ['.dmg', '.zip', '.exe', '.appimage', '.deb', '.rpm', '.snap'];

function parseArguments(argv) {
    const options = {out: path.join(workspace, 'dist-electron'), floor: 20};
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--out' && argv[i + 1]) {
            options.out = path.resolve(argv[(i += 1)]);
        } else if (argv[i] === '--floor' && argv[i + 1]) {
            options.floor = Number(argv[(i += 1)]);
        }
    }
    return options;
}

/**
 * The npm half: the production dependency tree of this workspace, from the lock file.
 *
 * It has to run in the repository root, because that is where the lock file is - a workspace
 * directory has none, and `--package-lock-only` needs one. `--workspace` narrows the tree to this
 * app and `--no-include-workspace-root` keeps the monorepo's own devDependencies out of it, which
 * is the difference between 22 components and several hundred.
 */
function npmSbom() {
    // the package's own entry, not the .bin shim: on Windows that shim is a shell script, and the
    // first CI run there died on its first line with a SyntaxError when node was handed it
    const cli = path.join(repoRoot, 'node_modules', '@cyclonedx', 'cyclonedx-npm', 'bin', 'cyclonedx-npm-cli.js');
    const raw = execFileSync(
        process.execPath,
        [
            cli,
            '--omit',
            'dev',
            '--omit',
            'optional',
            '--package-lock-only',
            '--workspace',
            path.relative(repoRoot, workspace),
            '--no-include-workspace-root',
            '--spec-version',
            '1.6',
            '--output-format',
            'JSON',
            '--output-file',
            '-',
            '--mc-type',
            'application',
        ],
        {cwd: repoRoot, maxBuffer: 128 * 1024 * 1024, encoding: 'utf8'},
    );
    return JSON.parse(raw);
}

/**
 * What the packaged Electron reports about itself.
 *
 * `ELECTRON_RUN_AS_NODE` starts the same binary as a plain Node process, which needs no display
 * and works on a CI runner - and `process.versions` still carries the Chromium, V8 and Electron
 * versions, because they are compiled in. When that fails (a cross-built arch, a runner without
 * the binary) the version from package.json is still recorded, with a note that the rest is
 * missing: an incomplete SBOM is better than none, a wrong one is not.
 */
function electronVersions() {
    const packaged = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
    );
    const fallback = {electron: packaged.version, incomplete: true};
    let binary;
    try {
        // What `require('electron')` returns in a Node process: dist/ plus the platform's file
        // name from path.txt (`electron`, `electron.exe`, `Electron.app/Contents/MacOS/Electron`).
        const electronDir = path.join(repoRoot, 'node_modules', 'electron');
        binary = path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim());
        if (!fs.existsSync(binary)) {
            return fallback;
        }
    } catch {
        return fallback;
    }
    try {
        const raw = execFileSync(binary, ['-p', 'JSON.stringify(process.versions)'], {
            env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
            encoding: 'utf8',
            timeout: 60_000,
        });
        const versions = JSON.parse(raw.trim().split('\n').at(-1));
        return {
            electron: versions.electron ?? packaged.version,
            chromium: versions.chrome,
            node: versions.node,
            v8: versions.v8,
        };
    } catch (error) {
        process.stderr.write(`sbom: could not ask Electron for its versions (${error.message})\n`);
        return fallback;
    }
}

function runtimeComponents(versions) {
    const components = [
        {
            type: 'framework',
            'bom-ref': `pkg:generic/electron@${versions.electron}`,
            name: 'electron',
            version: versions.electron,
            purl: `pkg:generic/electron@${versions.electron}`,
            description: 'The Electron runtime the installer ships; not an npm dependency at runtime.',
            licenses: [{license: {id: 'MIT'}}],
            externalReferences: [{type: 'website', url: 'https://github.com/electron/electron'}],
        },
    ];
    const parts = [
        ['chromium', versions.chromium, 'https://chromium.googlesource.com/chromium/src'],
        ['node', versions.node, 'https://github.com/nodejs/node'],
        ['v8', versions.v8, 'https://chromium.googlesource.com/v8/v8'],
    ];
    for (const [name, version, url] of parts) {
        if (version === undefined) {
            continue;
        }
        // Separate components, not properties: a CVE feed is searched for "chromium 1xx".
        components.push({
            type: 'framework',
            'bom-ref': `pkg:generic/${name}@${version}`,
            name,
            version,
            purl: `pkg:generic/${name}@${version}`,
            description: `Part of Electron ${versions.electron}.`,
            externalReferences: [{type: 'website', url}],
        });
    }
    return components;
}

/**
 * The tools electron-builder embedded, taken from its download cache: `appimage-12.0.1`,
 * `nsis-3.0.4.2`, `winCodeSign-2.6.0` and so on. Whatever it downloaded for this build is what
 * ended up in the installer, so the directory listing is the honest source.
 */
function builderToolComponents() {
    const cache =
        process.env['ELECTRON_BUILDER_CACHE'] ??
        (process.platform === 'darwin'
            ? path.join(process.env['HOME'] ?? '', 'Library', 'Caches', 'electron-builder')
            : process.platform === 'win32'
              ? path.join(process.env['LOCALAPPDATA'] ?? '', 'electron-builder', 'Cache')
              : path.join(process.env['HOME'] ?? '', '.cache', 'electron-builder'));
    let entries;
    try {
        entries = fs.readdirSync(cache, {withFileTypes: true});
    } catch {
        return [];
    }
    // electron-builder lays its cache out in two shapes: `appimage-12.0.1/` at the top level, and
    // `7zip/24.09/` as a name directory with version directories under it. Directories only, and
    // only dotted versions - the same places hold the downloaded archives (`appimage-12.0.1.7z`),
    // lock files and half-extracted temporary directories with random names.
    const found = new Map();
    const remember = (name, version) => {
        if (name !== 'downloads' && !found.has(`${name}@${version}`)) {
            found.set(`${name}@${version}`, {name, version});
        }
    };
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const flat = /^(.+?)-(\d+(?:\.\d+)+)$/.exec(entry.name);
        if (flat) {
            remember(flat[1], flat[2]);
            continue;
        }
        for (const inner of safeReaddir(path.join(cache, entry.name))) {
            if (!inner.isDirectory()) {
                continue;
            }
            const nested = /^(.+?)-(\d+(?:\.\d+)+)$/.exec(inner.name);
            if (nested) {
                remember(nested[1], nested[2]);
            } else if (/^\d+(?:\.\d+)+$/.test(inner.name)) {
                remember(entry.name, inner.name);
            }
        }
    }
    return [...found.values()].map(({name, version}) => ({
        type: 'application',
        'bom-ref': `pkg:generic/${name}@${version}`,
        name,
        version,
        purl: `pkg:generic/${name}@${version}`,
        description: 'Packaging tool embedded by electron-builder.',
    }));
}

function safeReaddir(dir) {
    try {
        return fs.readdirSync(dir, {withFileTypes: true});
    } catch {
        return [];
    }
}

function sha512(file) {
    return createHash('sha512').update(fs.readFileSync(file)).digest('hex');
}

function installersIn(dir) {
    return fs
        .readdirSync(dir, {withFileTypes: true})
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => INSTALLER_EXTENSIONS.includes(path.extname(name).toLowerCase()))
        .filter((name) => !name.endsWith('.blockmap'))
        .sort();
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    if (!fs.existsSync(options.out)) {
        throw new Error(`${options.out} does not exist - run electron-builder first`);
    }

    const base = npmSbom();
    const versions = electronVersions();
    base.components = [...(base.components ?? []), ...runtimeComponents(versions), ...builderToolComponents()];

    if (base.components.length < options.floor) {
        throw new Error(`the SBOM has ${base.components.length} components, fewer than the floor of ${options.floor}`);
    }
    // By purl, not by name: the workspace package `@homematic-manager/electron` is also called
    // "electron" in this list, and it is 30 kB of our own code, not the runtime.
    if (!base.components.some((component) => component.purl?.startsWith('pkg:generic/electron@'))) {
        throw new Error('the SBOM does not contain the Electron runtime, which is most of what the installer is');
    }
    if (versions.incomplete === true) {
        process.stderr.write('sbom: warning - Chromium, Node and V8 versions are missing from the SBOM\n');
    }

    const installers = installersIn(options.out);
    if (installers.length === 0) {
        throw new Error(`no installer found in ${options.out}`);
    }

    for (const installer of installers) {
        const file = path.join(options.out, installer);
        const bom = structuredClone(base);
        bom.metadata = {
            ...bom.metadata,
            component: {
                ...bom.metadata?.component,
                type: 'application',
                'bom-ref': `hmm:installer/${installer}`,
                name: installer,
                hashes: [{alg: 'SHA-512', content: sha512(file)}],
                properties: [
                    {name: 'hmm:artefact:size', value: String(fs.statSync(file).size)},
                    {name: 'hmm:build:platform', value: process.platform},
                    {name: 'hmm:build:arch', value: process.arch},
                    {name: 'hmm:build:target', value: path.extname(installer).slice(1)},
                ],
            },
        };
        fs.writeFileSync(`${file}.cdx.json`, `${JSON.stringify(bom, null, 2)}\n`);
        process.stdout.write(`${installer}.cdx.json: ${bom.components.length} components\n`);
    }

    // One more, for the attestation. `actions/attest-sbom` takes many subjects but a single SBOM
    // file, and attaching an SBOM whose `metadata.component` names a *different* installer to
    // every artefact would be a false statement. This one names the app, which is true of all of
    // them, and the per-installer files above stay as the release assets D-27 asks for.
    const shared = structuredClone(base);
    fs.writeFileSync(path.join(options.out, 'sbom.cdx.json'), `${JSON.stringify(shared, null, 2)}\n`);
    process.stdout.write(`sbom.cdx.json: ${shared.components.length} components (for the attestation)\n`);
}

main();
