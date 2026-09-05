/**
 * The coverage merge is arithmetic on a text format, which is exactly the kind of thing that is
 * quietly wrong for months. These tests are the reason `lcov.mjs` is a module and not part of
 * `coverage-report.mjs`.
 */

import {describe, expect, it} from 'vitest';

import {PACKAGES, fileTotals, formatLcov, mergeCoverage, parseLcov, summarise} from './lcov.mjs';

const A = [
    'TN:',
    'SF:packages/core/src/a.ts',
    'FN:1,alpha',
    'FNDA:2,alpha',
    'FN:9,beta',
    'FNDA:0,beta',
    'BRDA:3,0,0,1',
    'BRDA:3,0,1,-',
    'DA:1,1',
    'DA:2,0',
    'DA:3,1',
    'end_of_record',
].join('\n');

const B = [
    'TN:',
    'SF:packages/core/src/a.ts',
    'FN:9,beta',
    'FNDA:5,beta',
    'BRDA:3,0,0,0',
    'BRDA:3,0,1,4',
    'DA:1,3',
    'DA:2,7',
    'DA:3,0',
    'end_of_record',
    'TN:',
    'SF:packages/backend/src/b.ts',
    'DA:1,1',
    'DA:2,0',
    'end_of_record',
].join('\n');

describe('parseLcov', () => {
    it('reads lines, branches and functions', () => {
        const files = parseLcov(A);
        const file = files.get('packages/core/src/a.ts');
        expect([...file.lines]).toEqual([
            [1, 1],
            [2, 0],
            [3, 1],
        ]);
        // `-` is "never reached", which is zero times taken, not "unknown"
        expect([...file.branches]).toEqual([
            ['3,0,0', 1],
            ['3,0,1', 0],
        ]);
        expect([...file.functions]).toEqual([
            ['alpha', 2],
            ['beta', 0],
        ]);
    });

    it('makes an absolute path relative to the repository root, in either slash', () => {
        const files = parseLcov('SF:/repo/packages/core/src/a.ts\nDA:1,1\nend_of_record', '/repo');
        expect([...files.keys()]).toEqual(['packages/core/src/a.ts']);
        const windows = parseLcov('SF:C:\\repo\\packages\\core\\src\\a.ts\nDA:1,1\nend_of_record', 'C:\\repo');
        expect([...windows.keys()]).toEqual(['packages/core/src/a.ts']);
    });

    it('drops a leading ./ and ignores anything outside a record', () => {
        const files = parseLcov('DA:1,1\nTN:\nSF:./x.ts\nDA:1,1\nend_of_record\nDA:99,1');
        expect([...files.keys()]).toEqual(['x.ts']);
        expect(files.get('x.ts').lines.size).toBe(1);
    });
});

describe('mergeCoverage', () => {
    it('adds the hits of both runs, so a line covered by either is covered', () => {
        const merged = mergeCoverage([parseLcov(A), parseLcov(B)]);
        const file = merged.get('packages/core/src/a.ts');
        expect(file.lines.get(1)).toBe(4);
        // line 2 was missed by the first run and hit by the second
        expect(file.lines.get(2)).toBe(7);
        expect(file.lines.get(3)).toBe(1);
        // and each branch was taken by one of the two
        expect([...file.branches.values()]).toEqual([1, 4]);
        expect(file.functions.get('beta')).toBe(5);
        expect(merged.size).toBe(2);
    });

    it('is a no-op for a single report and returns an empty map for none', () => {
        expect(formatLcov(mergeCoverage([parseLcov(A)]))).toBe(formatLcov(parseLcov(A)));
        expect(mergeCoverage([]).size).toBe(0);
    });
});

describe('formatLcov', () => {
    it('round-trips through the parser', () => {
        const merged = mergeCoverage([parseLcov(A), parseLcov(B)]);
        const again = parseLcov(formatLcov(merged));
        expect([...again.get('packages/core/src/a.ts').lines]).toEqual([...merged.get('packages/core/src/a.ts').lines]);
        expect([...again.keys()].sort()).toEqual([...merged.keys()].sort());
    });

    it('writes the totals lcov readers expect', () => {
        const text = formatLcov(parseLcov(A));
        expect(text).toContain('LF:3');
        expect(text).toContain('LH:2');
        expect(text).toContain('BRF:2');
        expect(text).toContain('BRH:1');
        expect(text).toContain('FNF:2');
        expect(text).toContain('FNH:1');
    });
});

describe('fileTotals', () => {
    it('counts a file with nothing to cover as covered', () => {
        const empty = {lines: new Map(), branches: new Map(), functions: new Map()};
        expect(fileTotals(empty)).toEqual({lines: 100, branches: 100, functions: 100, lineCount: 0});
    });

    it('rounds to two decimals', () => {
        const file = parseLcov(A).get('packages/core/src/a.ts');
        expect(fileTotals(file).lines).toBe(66.67);
        expect(fileTotals(file).branches).toBe(50);
    });
});

describe('summarise', () => {
    it('groups by package and marks a package below its target', () => {
        const rows = summarise(mergeCoverage([parseLcov(A), parseLcov(B)]));
        const core = rows.find((row) => row.name === 'core');
        expect(core.files).toBe(1);
        expect(core.lines).toBe(100);
        // core wants 100 % per file and this file has one branch of two... both, after the merge
        expect(core.branches).toBe(100);
        expect(core.met).toBe(true);

        const backend = rows.find((row) => row.name === 'backend');
        expect(backend.lines).toBe(50);
        expect(backend.met).toBe(false);
    });

    it('lists the files that miss a per-file target, worst first', () => {
        const rows = summarise(
            parseLcov(
                [
                    'SF:packages/core/src/good.ts',
                    'DA:1,1',
                    'end_of_record',
                    'SF:packages/core/src/half.ts',
                    'DA:1,1',
                    'DA:2,0',
                    'end_of_record',
                    'SF:packages/core/src/none.ts',
                    'DA:1,0',
                    'end_of_record',
                ].join('\n'),
            ),
        );
        const core = rows.find((row) => row.name === 'core');
        expect(core.met).toBe(false);
        expect(core.below.map((entry) => entry.path)).toEqual([
            'packages/core/src/none.ts',
            'packages/core/src/half.ts',
        ]);
    });

    it('reports a package without a target without judging it', () => {
        const rows = summarise(parseLcov('SF:apps/web/src/x.ts\nDA:1,0\nend_of_record'));
        const web = rows.find((row) => row.name === 'web');
        expect(web.lines).toBe(0);
        expect(web.met).toBeUndefined();
        expect(web.below).toEqual([]);
    });

    it('covers every package of the repository', () => {
        expect(PACKAGES.map((entry) => entry.name)).toEqual([
            'core',
            'backend',
            'ui',
            'web',
            'electron',
            'ccu-addon',
            'data',
        ]);
        // the three with a target are the three of D-12
        expect(PACKAGES.filter((entry) => entry.lines !== undefined).map((entry) => entry.lines)).toEqual([
            100, 95, 95,
        ]);
    });
});
