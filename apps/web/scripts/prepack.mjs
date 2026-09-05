#!/usr/bin/env node

/**
 * `prepack`: put everything the published package needs inside the package directory.
 *
 * npm only packs files below the package root, and the two things this package cannot work without
 * live elsewhere in the workspace - the built UI in `packages/ui/dist` and the generated device
 * metadata in `data/dist`. They are copied to `apps/web/ui/` and `apps/web/data/`, which is exactly
 * where `defaultUiDir()` and `defaultMetadataDir()` look first (`paths.ts`), so a global install
 * finds them without any configuration. The repository's LICENSE is copied for the same reason.
 *
 * Both copies are in `.gitignore` and `postpack.mjs` removes them again; re-running this is
 * idempotent.
 *
 * The two workspace packages the code imports - `@homematic-manager/backend` and `.../core` - are
 * **bundled**, not published on their own: they are internal (`private: true`), their API is not a
 * contract for anyone outside this repository, and three packages that must be version-locked to
 * each other is three ways for a user to end up with a broken tree. `bundleDependencies` puts a
 * package's `node_modules/<name>` directory into the tarball - but in a workspace those are
 * symlinks hoisted to the repository root, and npm packs nothing for them. So this script
 * materialises them as real directories under `apps/web/node_modules/@homematic-manager/`, which is
 * what `bundleDependencies` then finds. `postpack.mjs` removes them again, so development keeps
 * using the workspace symlinks and never a stale copy.
 *
 * Their own registry dependencies (`binrpc`, `homematic-rega`, `homematic-xmlrpc`, `ws`) are
 * declared as dependencies of this package, so npm installs them for the bundled code normally.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');

const copies = [
    {from: path.join(repoRoot, 'packages', 'ui', 'dist'), to: path.join(packageDir, 'ui'), marker: 'index.html'},
    {from: path.join(repoRoot, 'data', 'dist'), to: path.join(packageDir, 'data'), marker: 'manifest.json'},
];

for (const {from, to, marker} of copies) {
    if (!fs.existsSync(path.join(from, marker))) {
        console.error(`prepack: ${path.join(from, marker)} is missing - run \`npm run build\` at the repository root`);
        process.exit(1);
    }
    fs.rmSync(to, {recursive: true, force: true});
    fs.cpSync(from, to, {recursive: true});
    console.log(`prepack: ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)}`);
}

const license = path.join(repoRoot, 'LICENSE');
if (fs.existsSync(license)) {
    fs.copyFileSync(license, path.join(packageDir, 'LICENSE'));
}

for (const name of ['core', 'backend']) {
    const from = path.join(repoRoot, 'packages', name);
    const to = path.join(packageDir, 'node_modules', '@homematic-manager', name);
    if (!fs.existsSync(path.join(from, 'dist', 'index.js'))) {
        console.error(`prepack: ${name} is not built - run \`npm run build\` at the repository root`);
        process.exit(1);
    }
    fs.rmSync(to, {recursive: true, force: true});
    fs.mkdirSync(to, {recursive: true});
    fs.cpSync(path.join(from, 'dist'), path.join(to, 'dist'), {
        recursive: true,
        filter: (file) => !file.endsWith('.map') && !/\.test\.(js|d\.ts)$/.test(file),
    });
    fs.writeFileSync(path.join(to, 'package.json'), manifest(path.join(from, 'package.json')));
    for (const extra of ['README.md', 'LICENSE']) {
        const source = fs.existsSync(path.join(from, extra)) ? path.join(from, extra) : path.join(repoRoot, extra);
        if (fs.existsSync(source)) {
            fs.copyFileSync(source, path.join(to, extra));
        }
    }
    console.log(`prepack: packages/${name} -> apps/web/node_modules/@homematic-manager/${name} (bundled)`);
}

/** The bundled package's manifest, without the workspace-only fields npm would try to resolve. */
function manifest(file) {
    const source = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundled = {
        name: source.name,
        version: source.version,
        type: source.type,
        description: source.description,
        license: source.license,
        exports: source.exports,
        main: source.main,
        types: source.types,
        engines: source.engines,
        // the registry ones are dependencies of apps/web; the workspace ones sit next to this copy
        dependencies: Object.fromEntries(
            Object.entries(source.dependencies ?? {}).filter(([name]) => !name.startsWith('@homematic-manager/')),
        ),
    };
    return `${JSON.stringify(bundled, undefined, 2)}\n`;
}
