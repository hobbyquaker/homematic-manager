/**
 * Writing `data/dist/`: JSON formatted by Prettier so that the committed files are reviewable and
 * a re-run of the converter produces a byte-identical diff.
 */
import path from 'node:path';

import {format} from 'prettier';

import {writeText} from './paths.mjs';

/** Fixed options, independent of the repository's .prettierrc, so dist/ stays stable. */
const PRETTIER_OPTIONS = {parser: 'json', tabWidth: 2, printWidth: 120, bracketSpacing: false, endOfLine: 'lf'};

/**
 * @param {string} absolute
 * @param {unknown} value
 * @returns {Promise<number>} the number of bytes written
 */
export async function writeJson(absolute, value) {
    const pretty = await format(JSON.stringify(value), {...PRETTIER_OPTIONS, filepath: path.basename(absolute)});
    writeText(absolute, pretty);
    return Buffer.byteLength(pretty);
}
