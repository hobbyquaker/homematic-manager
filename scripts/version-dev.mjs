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

execFileSync(npm, ['version', 'prerelease', '--preid', 'dev', '--no-git-tag-version'], {
    cwd: root,
    stdio: 'inherit',
});

const {version, workspaces} = readPackage(root);

// The workspace packages depend on each other with exact versions (`"@homematic-manager/core":
// "3.0.0-dev.0"`), so those ranges move with the version; otherwise `npm ci` refuses the lockfile
// after the first bump (found by task 11).
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const previous = readPackage(root).version;

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

// Keep package-lock.json consistent with the bumped workspace versions.
execFileSync(npm, ['install', '--package-lock-only', '--ignore-scripts'], {cwd: root, stdio: 'inherit'});

console.log(`\nhomematic-manager is now ${version}. Commit it; the maintainer tags and releases.`);
