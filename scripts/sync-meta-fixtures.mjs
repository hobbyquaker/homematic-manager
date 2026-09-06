#!/usr/bin/env node
/**
 * Refreshes the vendored copy of openccu-lite's conformance corpus.
 *
 *   node scripts/sync-meta-fixtures.mjs ~/repos/openccu-lite
 *
 * The corpus is that project's D-16 contract - `occulited` in Go and `packages/core/src/meta/` here
 * both run it - and this repository keeps a copy so that CI needs no second checkout. A refresh is
 * a commit of its own: what changed in the corpus is a specification change to read before it is a
 * test failure to fix, which is why this prints the difference and never touches anything else.
 *
 * `--check` compares without writing and exits 1 on a difference; that is what a CI job would run
 * if the maintainer ever wants the copy watched.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const target = path.join(import.meta.dirname, '..', 'packages', 'core', 'test', 'fixtures', 'meta');
const args = process.argv.slice(2);
const check = args.includes('--check');
const source = args.find((argument) => !argument.startsWith('--'));

if (!source) {
    console.error('usage: node scripts/sync-meta-fixtures.mjs <openccu-lite checkout> [--check]');
    process.exit(2);
}

const from = fs.existsSync(path.join(source, 'fixtures')) ? path.join(source, 'fixtures') : source;
if (!fs.existsSync(path.join(from, 'cases'))) {
    console.error(`no corpus in ${from}: expected a fixtures directory with cases/ and store/`);
    process.exit(2);
}

let changed = 0;
for (const directory of ['cases', 'store']) {
    const files = fs.readdirSync(path.join(from, directory)).filter((name) => name.endsWith('.json'));
    for (const name of files) {
        const sourceFile = path.join(from, directory, name);
        const targetFile = path.join(target, directory, name);
        const content = fs.readFileSync(sourceFile, 'utf8');
        const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : undefined;
        if (current === content) {
            continue;
        }
        changed += 1;
        console.log(`${current === undefined ? 'new' : 'changed'}: ${directory}/${name}`);
        if (!check) {
            fs.mkdirSync(path.dirname(targetFile), {recursive: true});
            fs.writeFileSync(targetFile, content);
        }
    }
    for (const name of fs.readdirSync(path.join(target, directory))) {
        if (name.endsWith('.json') && !files.includes(name)) {
            changed += 1;
            console.log(`gone: ${directory}/${name}`);
            if (!check) {
                fs.rmSync(path.join(target, directory, name));
            }
        }
    }
}

const readme = path.join(from, 'README.md');
if (fs.existsSync(readme)) {
    const content = fs.readFileSync(readme, 'utf8');
    const corpus = path.join(target, 'CORPUS.md');
    if (fs.readFileSync(corpus, 'utf8') !== content) {
        changed += 1;
        console.log('changed: CORPUS.md (the upstream README)');
        if (!check) {
            fs.writeFileSync(corpus, content);
        }
    }
}

if (changed === 0) {
    console.log('the vendored corpus is up to date');
} else if (check) {
    console.error(`${changed} file(s) differ from ${from}`);
    process.exit(1);
} else {
    console.log(`${changed} file(s) refreshed from ${from} - update NOTICE.md's commit and run the tests`);
}
