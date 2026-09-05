#!/usr/bin/env node

/**
 * Resolves an Alpine package and everything it needs into a list of `.apk` URLs - and, with
 * `--json`, into the metadata the SBOM of D-27 needs (name, version, architecture, origin,
 * licence, URL).
 *
 *   node apps/ccu-addon/alpine-packages.js nodejs armv7 [branch] [mirror] [--json]
 *
 * Why not run `apk` in a container: the whole armv7l runtime is four steps - resolve, download,
 * unpack, patch - and `apk` only does the first. Doing it here keeps the build to curl, tar and
 * patchelf, one moving part instead of a docker daemon plus whichever apk-tools the image of the
 * day happens to ship.
 *
 * APKINDEX is a flat text file of records: `P` (package), `V` (version), `D` (dependencies), `p`
 * (what it provides), `o` (origin, the aport a package was built from), `L` (licence). Dependencies
 * are plain package names, `so:libfoo.so.1` for a shared library, or a virtual like
 * `icu-data=78.1-r0`; all three resolve through `p:`.
 *
 * Taken from hm2mqtt.js's `addon/alpine-packages.js` (same author, MIT there) and extended with the
 * JSON output, because the addon's SBOM has to name the Alpine packages that end up inside the
 * armv7l runtime as `pkg:apk/alpine/...` components.
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const positional = argv.filter((value) => !value.startsWith('--'));
const [pkg = 'nodejs', arch = 'armv7', branch = 'edge', mirror = 'https://dl-cdn.alpinelinux.org/alpine'] = positional;

const base = `${mirror}/${branch}/main/${arch}`;
const index = fetchIndex(base);

/** @type {Map<string, {name: string, version: string, deps: string[], origin: string, license: string}>} */
const packages = new Map();
/** what a name (package, `so:...`, virtual) resolves to */
const provides = new Map();

for (const block of index.split('\n\n')) {
    /** @type {Record<string, string[]>} */
    const fields = {};
    for (const line of block.split('\n')) {
        const colon = line.indexOf(':');
        if (colon < 1) {
            continue;
        }
        (fields[line.slice(0, colon)] ||= []).push(line.slice(colon + 1));
    }
    if (!fields.P) {
        continue;
    }
    const entry = {
        name: fields.P[0],
        version: fields.V[0],
        deps: (fields.D ? fields.D[0].split(' ') : []).filter(Boolean),
        origin: fields.o ? fields.o[0] : fields.P[0],
        license: fields.L ? fields.L[0] : '',
    };
    packages.set(entry.name, entry);
    provides.set(entry.name, entry.name);
    for (const item of fields.p ? fields.p[0].split(' ') : []) {
        const name = item.split('=')[0];
        // first provider wins, which is Alpine's own default (icu-data-en over icu-data-full)
        if (!provides.has(name)) {
            provides.set(name, entry.name);
        }
    }
}

const seen = new Set();
const queue = [pkg];
const result = [];
while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) {
        continue;
    }
    seen.add(name);
    const entry = packages.get(name);
    if (!entry) {
        console.error(`error: no package "${name}" in alpine/${branch}/main/${arch}`);
        process.exit(1);
    }
    result.push(entry);
    for (const dep of entry.deps) {
        // "!foo" is a conflict, "/bin/sh" a command dependency - neither pulls a package in
        if (dep.startsWith('!') || dep.startsWith('/')) {
            continue;
        }
        const target = provides.get(dep.split(/[=<>~]/)[0]);
        if (target && !seen.has(target)) {
            queue.push(target);
        }
    }
}

if (json) {
    process.stdout.write(
        `${JSON.stringify(
            {
                branch,
                arch,
                mirror,
                packages: result.map((entry) => ({
                    name: entry.name,
                    version: entry.version,
                    origin: entry.origin,
                    license: entry.license,
                    url: `${base}/${entry.name}-${entry.version}.apk`,
                })),
            },
            undefined,
            2,
        )}\n`,
    );
} else {
    for (const entry of result) {
        process.stdout.write(`${base}/${entry.name}-${entry.version}.apk\n`);
    }
}

/** APKINDEX.tar.gz is a tar of one text file; curl and tar are already required by the build. */
function fetchIndex(from) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apkindex-'));
    try {
        execFileSync('sh', [
            '-c',
            `curl -fsSL --max-time 120 "${from}/APKINDEX.tar.gz" | tar -xzf - -C "${tmp}" APKINDEX`,
        ]);
        return fs.readFileSync(path.join(tmp, 'APKINDEX'), 'utf8');
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
}
