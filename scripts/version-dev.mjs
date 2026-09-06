#!/usr/bin/env node
/**
 * Bumps the prerelease counter of the root package (D-18: `3.0.0-dev.n` -> `3.0.0-dev.n+1`, later
 * `alpha`/`beta`) and writes the same version into every workspace package.json, so the whole
 * monorepo always ships one version. Does not commit, tag, push or publish - the maintainer does.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const readPackage = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const writePackage = (dir, pkg) => {
    // Two spaces plus a trailing newline: what npm writes and what prettier checks.
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
};

const workspaceDirs = (patterns) =>
    patterns.flatMap((pattern) => {
        const base = join(root, pattern.replace(/\/\*$/, ''));
        if (pattern.endsWith('/*')) {
            return readdirSync(base, {withFileTypes: true})
                .filter((entry) => entry.isDirectory())
                .map((entry) => join(base, entry.name))
                .filter((dir) => existsSync(join(dir, 'package.json')));
        }
        return existsSync(join(base, 'package.json')) ? [base] : [];
    });

// **Before** the bump: this is the version the cross-dependency ranges are pinned to today, and
// reading it afterwards - which is what this script did until the first real run of it, task 17 -
// yields the *new* version, so no range is ever rewritten. `npm install --package-lock-only` then
// cannot resolve `@homematic-manager/backend@<old>` inside the workspace, goes to the registry and
// fails with a 404 on a package that was never published.
const previous = readPackage(root).version;

// Without an argument the prerelease counter moves and the preid stays what it is (dev stays dev,
// beta stays beta: `npm version prerelease --preid dev` on a beta would fall back to dev.0). With
// an explicit version (`node scripts/version-dev.mjs 3.0.0-beta.0`) that version is set, which is
// how the step from dev to alpha, beta and 3.0.0 is taken (D-18).
const requested = process.argv[2];
const currentPreid = /-([a-z]+)\./.exec(readPackage(root).version)?.[1] ?? 'dev';
const versionArgs = requested ? [requested] : ['prerelease', '--preid', currentPreid];
execFileSync(npm, ['version', ...versionArgs, '--no-git-tag-version'], {
    cwd: root,
    stdio: 'inherit',
});

const {version, workspaces} = readPackage(root);

// The workspace packages depend on each other with exact versions (`"@homematic-manager/core":
// "3.0.0-dev.0"`), so those ranges move with the version; otherwise `npm ci` refuses the lockfile
// after the first bump (found by task 11).
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

for (const dir of workspaceDirs(workspaces)) {
    const pkg = readPackage(dir);
    let changed = pkg.version !== version;
    pkg.version = version;
    for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of Object.entries(pkg[field] ?? {})) {
            if (name.startsWith('@homematic-manager/') && (range === previous || range === version)) {
                pkg[field][name] = version;
                changed = changed || range !== version;
            }
        }
    }
    if (!changed) {
        continue;
    }
    writePackage(dir, pkg);
    console.log(`${relative(root, dir)}: ${version}`);
}

// Every workspace range has to point at a version that exists inside the workspace now. If one
// still points at the old one, `npm install` below goes to the registry for a package that was
// never published and fails with a 404 that says nothing about the cause - which is exactly how
// the `previous` bug above showed itself. Say it here instead, before npm does.
const stale = [];
for (const dir of workspaceDirs(workspaces)) {
    const pkg = readPackage(dir);
    for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of Object.entries(pkg[field] ?? {})) {
            if (name.startsWith('@homematic-manager/') && range !== version) {
                stale.push(`${relative(root, dir)}: ${field}.${name} is "${range}", not "${version}"`);
            }
        }
    }
}
if (stale.length > 0) {
    console.error(`\nworkspace ranges were not moved to ${version}:\n  ${stale.join('\n  ')}`);
    console.error('package.json files are already bumped; fix the ranges by hand or `git checkout` them.');
    process.exit(1);
}

// Keep package-lock.json consistent with the bumped workspace versions.
execFileSync(npm, ['install', '--package-lock-only', '--ignore-scripts'], {cwd: root, stdio: 'inherit'});

console.log(`\nhomematic-manager is now ${version}. Commit it; the maintainer tags and releases.`);
