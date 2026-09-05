/**
 * A small LCOV reader, merger and summariser.
 *
 * Two runs produce coverage of the same sources: `vitest run --coverage` (unit and component tests,
 * v8 through `@vitest/coverage-v8`) and the Playwright e2e run (v8 through `c8`, remapped to the
 * TypeScript sources by the build's source maps). They have to become one report, and no tool in
 * the tree does that - `nyc merge` works on raw v8 profiles, not on lcov, and the two runs do not
 * produce compatible raw profiles.
 *
 * LCOV is a line-oriented format and merging it is arithmetic: a line's hit counts add up, a branch
 * taken in either run is taken. That is all this module does, plus the grouping that turns 250 files
 * into the six numbers a human reads (D-12: reported, never enforced).
 *
 * Kept separate from `coverage-report.mjs` so that the arithmetic can be tested without files.
 */

/**
 * @typedef {object} FileCoverage
 * @property {Map<number, number>} lines       line number -> hits
 * @property {Map<string, number>} branches    "line,block,branch" -> times taken
 * @property {Map<string, number>} functions   "line,name" -> hits
 */

/**
 * Parses an LCOV file into `path -> FileCoverage`.
 *
 * Paths are normalised to forward slashes, relative to the repository root, so that the vitest
 * report (already relative) and the c8 report (absolute) describe the same file with the same key.
 *
 * @param {string} text
 * @param {string} [root] absolute repository root, stripped from absolute paths
 * @returns {Map<string, FileCoverage>}
 */
export function parseLcov(text, root = '') {
    /** @type {Map<string, FileCoverage>} */
    const files = new Map();
    /** @type {FileCoverage | undefined} */
    let current;

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('SF:')) {
            const path = normalisePath(line.slice(3), root);
            current = files.get(path);
            if (!current) {
                current = {lines: new Map(), branches: new Map(), functions: new Map()};
                files.set(path, current);
            }
            continue;
        }
        if (!current) {
            continue;
        }
        if (line.startsWith('DA:')) {
            const [number, hits] = line.slice(3).split(',');
            add(current.lines, Number(number), Number(hits));
        } else if (line.startsWith('BRDA:')) {
            const [number, block, branch, taken] = line.slice(5).split(',');
            // `-` means the branch was never reached at all, which is zero times taken
            add(current.branches, `${number},${block},${branch}`, taken === '-' ? 0 : Number(taken));
        } else if (line.startsWith('FNDA:')) {
            const [hits, ...rest] = line.slice(5).split(',');
            add(current.functions, rest.join(','), Number(hits));
        } else if (line.startsWith('FN:')) {
            const [, ...rest] = line.slice(3).split(',');
            const name = rest.join(',');
            if (!current.functions.has(name)) {
                current.functions.set(name, 0);
            }
        } else if (line === 'end_of_record') {
            current = undefined;
        }
    }
    return files;
}

/**
 * Merges any number of parsed reports. A line covered by either run is covered.
 *
 * @param {Map<string, FileCoverage>[]} reports
 * @returns {Map<string, FileCoverage>}
 */
export function mergeCoverage(reports) {
    /** @type {Map<string, FileCoverage>} */
    const merged = new Map();
    for (const report of reports) {
        for (const [path, coverage] of report) {
            let target = merged.get(path);
            if (!target) {
                target = {lines: new Map(), branches: new Map(), functions: new Map()};
                merged.set(path, target);
            }
            for (const [key, hits] of coverage.lines) {
                add(target.lines, key, hits);
            }
            for (const [key, hits] of coverage.branches) {
                add(target.branches, key, hits);
            }
            for (const [key, hits] of coverage.functions) {
                add(target.functions, key, hits);
            }
        }
    }
    return merged;
}

/** Serialises back to LCOV, so the merged report can be uploaded and read by any lcov tool. */
export function formatLcov(files) {
    const out = [];
    for (const path of [...files.keys()].sort()) {
        const coverage = files.get(path);
        out.push('TN:', `SF:${path}`);
        for (const [name, hits] of coverage.functions) {
            out.push(`FNDA:${hits},${name}`);
        }
        out.push(`FNF:${coverage.functions.size}`, `FNH:${countHit(coverage.functions)}`);
        for (const [key, hits] of coverage.branches) {
            out.push(`BRDA:${key},${hits}`);
        }
        out.push(`BRF:${coverage.branches.size}`, `BRH:${countHit(coverage.branches)}`);
        for (const [number, hits] of [...coverage.lines].sort((a, b) => a[0] - b[0])) {
            out.push(`DA:${number},${hits}`);
        }
        out.push(`LF:${coverage.lines.size}`, `LH:${countHit(coverage.lines)}`, 'end_of_record');
    }
    return `${out.join('\n')}\n`;
}

/** Percentages of one file. `total 0` is 100 %: a file with no branches has missed none. */
export function fileTotals(coverage) {
    return {
        lines: ratio(countHit(coverage.lines), coverage.lines.size),
        branches: ratio(countHit(coverage.branches), coverage.branches.size),
        functions: ratio(countHit(coverage.functions), coverage.functions.size),
        lineCount: coverage.lines.size,
    };
}

/**
 * The per-package targets of D-12. `perFile` means the target applies to every file on its own,
 * not to the package average - which is what "core 100 % lines and branches per file" asks for.
 *
 * @type {{name: string, prefix: string, lines?: number, branches?: number, perFile?: boolean}[]}
 */
export const PACKAGES = [
    {name: 'core', prefix: 'packages/core/src/', lines: 100, branches: 100, perFile: true},
    {name: 'backend', prefix: 'packages/backend/src/', lines: 95, branches: 95},
    {name: 'ui', prefix: 'packages/ui/src/', lines: 95, branches: 95},
    {name: 'web', prefix: 'apps/web/src/'},
    {name: 'electron', prefix: 'apps/electron/src/'},
    {name: 'ccu-addon', prefix: 'apps/ccu-addon/src/'},
    {name: 'data', prefix: 'data/src/'},
];

/**
 * Groups a merged report by package and works out whether each one meets its target.
 *
 * @param {Map<string, FileCoverage>} files
 * @param {typeof PACKAGES} [packages]
 */
export function summarise(files, packages = PACKAGES) {
    return packages.map((entry) => {
        const own = [...files].filter(([path]) => path.startsWith(entry.prefix));
        const totals = {lines: [0, 0], branches: [0, 0], functions: [0, 0]};
        /** @type {{path: string, lines: number, branches: number}[]} */
        const below = [];
        for (const [path, coverage] of own) {
            totals.lines[0] += countHit(coverage.lines);
            totals.lines[1] += coverage.lines.size;
            totals.branches[0] += countHit(coverage.branches);
            totals.branches[1] += coverage.branches.size;
            totals.functions[0] += countHit(coverage.functions);
            totals.functions[1] += coverage.functions.size;
            const file = fileTotals(coverage);
            if (
                entry.perFile === true &&
                ((entry.lines !== undefined && file.lines < entry.lines) ||
                    (entry.branches !== undefined && file.branches < entry.branches))
            ) {
                below.push({path, lines: file.lines, branches: file.branches});
            }
        }
        const lines = ratio(totals.lines[0], totals.lines[1]);
        const branches = ratio(totals.branches[0], totals.branches[1]);
        const target = entry.lines;
        return {
            name: entry.name,
            files: own.length,
            lines,
            branches,
            functions: ratio(totals.functions[0], totals.functions[1]),
            target: target ?? undefined,
            perFile: entry.perFile === true,
            // A package with no target is reported, not judged; one with a per-file target is met
            // only when no file is below it.
            met:
                target === undefined
                    ? undefined
                    : entry.perFile === true
                      ? below.length === 0
                      : lines >= target && branches >= (entry.branches ?? target),
            below: below.sort((a, b) => a.lines - b.lines),
        };
    });
}

function add(map, key, value) {
    map.set(key, (map.get(key) ?? 0) + value);
}

function countHit(map) {
    let hit = 0;
    for (const hits of map.values()) {
        if (hits > 0) {
            hit += 1;
        }
    }
    return hit;
}

function ratio(hit, total) {
    return total === 0 ? 100 : Math.round((hit / total) * 10_000) / 100;
}

function normalisePath(path, root) {
    let value = path.trim().replace(/\\/g, '/');
    const prefix = root.replace(/\\/g, '/').replace(/\/$/, '');
    if (prefix !== '' && value.startsWith(`${prefix}/`)) {
        value = value.slice(prefix.length + 1);
    }
    return value.replace(/^\.\//, '');
}
