#!/usr/bin/env node
/**
 * One coverage report out of the two runs that produce coverage.
 *
 *   npm run test:cov         # unit and component tests   -> coverage/lcov.info
 *   npm run test:e2e:cov     # the Playwright web e2e      -> coverage-e2e/lcov.info
 *   npm run coverage:report  # this: merged.lcov + a summary
 *
 * The e2e run covers the backend and the web host through a real browser, which no unit test does,
 * and the component tests cover the UI, which the e2e only touches. Reading them apart makes both
 * look worse than the code is; this merges them and prints the per-package targets of D-12 next to
 * what was measured.
 *
 * **It never fails.** D-12 says coverage is reported and reviewed by hand, never enforced, so this
 * exits 0 whatever it finds - including when it finds no input at all. What it does do is say so
 * loudly: a package below its target is marked, and `packages/core`'s per-file target lists the
 * files that miss it.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {formatLcov, mergeCoverage, parseLcov, summarise} from './lcov.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INPUTS = [
    {label: 'unit and component', file: 'coverage/lcov.info'},
    {label: 'end-to-end', file: 'coverage-e2e/lcov.info'},
];

const found = [];
const reports = [];
for (const input of INPUTS) {
    const absolute = path.join(root, input.file);
    if (!fs.existsSync(absolute)) {
        console.log(`- ${input.label}: ${input.file} is not there, skipping`);
        continue;
    }
    const parsed = parseLcov(fs.readFileSync(absolute, 'utf8'), root);
    found.push(`${input.label} (${parsed.size} files)`);
    reports.push(parsed);
}

if (reports.length === 0) {
    console.log('No coverage to report. Run `npm run test:cov` first.');
    process.exit(0);
}

const merged = mergeCoverage(reports);
const outFile = path.join(root, 'coverage', 'merged.lcov');
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, formatLcov(merged));

const rows = summarise(merged);
const lines = [];
lines.push(`Merged: ${found.join(' + ')} -> ${merged.size} files in coverage/merged.lcov`);
lines.push('');
lines.push('| Package | Files | Lines | Branches | Functions | Target (D-12) | |');
lines.push('| --- | ---: | ---: | ---: | ---: | --- | --- |');
for (const row of rows) {
    if (row.files === 0) {
        continue;
    }
    const target = row.target === undefined ? 'reported only' : `${row.target} %${row.perFile ? ' per file' : ''}`;
    const mark = row.met === undefined ? '' : row.met ? 'met' : 'below';
    lines.push(
        `| ${row.name} | ${row.files} | ${pct(row.lines)} | ${pct(row.branches)} | ` +
            `${pct(row.functions)} | ${target} | ${mark} |`,
    );
}

for (const row of rows) {
    if (row.below.length > 0) {
        lines.push('');
        lines.push(`\`${row.name}\` wants ${row.target} % lines and branches in **every** file. Below it:`);
        lines.push('');
        for (const file of row.below.slice(0, 40)) {
            lines.push(`- \`${file.path}\` - ${pct(file.lines)} lines, ${pct(file.branches)} branches`);
        }
        if (row.below.length > 40) {
            lines.push(`- ... and ${row.below.length - 40} more`);
        }
    }
}

lines.push('');
lines.push('Coverage is reported, never enforced (D-12): these numbers are reviewed by hand.');

const text = lines.join('\n');
console.log(`\n${text}\n`);

const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
if (summaryFile !== undefined && summaryFile !== '') {
    fs.appendFileSync(summaryFile, `## Coverage\n\n${text}\n`);
}

function pct(value) {
    return `${value.toFixed(2)} %`;
}
