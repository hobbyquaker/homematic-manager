#!/usr/bin/env node
/**
 * The installers' file names and the names the update manifests point at must be one string
 * (B-47, #163).
 *
 * electron-updater downloads `releases/download/v<version>/<url>`, with `<url>` taken from the
 * release's `latest*.yml`. electron-builder writes that `url` as the file name when the name is
 * "safe" for GitHub (letters, digits, `.`, `_`, `-`) and as the name with its spaces turned into
 * dashes when it is not - while the file keeps its spaces, and the release upload turns them into
 * dots. From beta.1 to beta.18 every name started with `Homematic Manager-`, the manifests said
 * `Homematic-Manager-`, the assets were `Homematic.Manager-`, and every in-app download was a 404.
 *
 * Two checks, both exported for the unit test:
 *
 * - {@link checkBuilderConfig}: the name templates of `electron-builder.yml`, expanded the way
 *   electron-builder expands them, give safe and distinct names for every target and arch. This
 *   catches a template that falls back to electron-builder's default (which starts with the
 *   product name, and so with a space) before anything is built.
 * - {@link checkOutput}: after packaging, every `url` and `path` in every `latest*.yml` is a file
 *   next to it, and every file a release would carry has a safe name. This is the check on what
 *   electron-builder actually did; the release and build workflows run it after packaging.
 *
 * Usage: node scripts/update-names.mjs [--dir <dist-electron>] [--config-only]
 * Exits 1 and lists the problems when there are any.
 */

import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The YAML parser electron-builder itself reads and writes these files with, resolved through
 * electron-builder rather than declared again: whatever parses the config for the build parses it
 * here.
 */
function loadYaml() {
    const here = createRequire(import.meta.url);
    const builder = createRequire(here.resolve('electron-builder'));
    const lib = createRequire(builder.resolve('app-builder-lib/package.json'));
    return lib('js-yaml');
}

/** What GitHub keeps as it is in an asset name; `isSafeGithubName` in app-builder-lib. */
export const GITHUB_SAFE_NAME = /^[0-9A-Za-z._-]+$/;

/** The files a release carries for the desktop app (release-electron.yml's `assets`). */
const RELEASE_FILE = /\.(dmg|zip|exe|AppImage|deb|blockmap)$/i;

/**
 * The targets this script knows, with the section of the config each one reads and the default
 * template electron-builder falls back to (app-builder-lib 26). A target that is not listed here is
 * reported, so that a new one is looked at rather than waved through.
 */
const TARGETS = {
    dmg: {section: 'dmg', ext: 'dmg', fallback: '${productName}-${version}-${arch}.${ext}'},
    // The mac zip reads `config.zip`, which the schema does not allow, so in practice `mac`.
    zip: {section: 'zip', ext: 'zip', fallback: '${productName}-${version}-${arch}-${os}.${ext}'},
    nsis: {section: 'nsis', ext: 'exe', fallback: '${productName} Setup ${version}.${ext}', combined: true},
    portable: {section: 'portable', ext: 'exe', fallback: '${productName} ${version}.${ext}', combined: true},
    AppImage: {section: 'appImage', ext: 'AppImage', fallback: '${productName}-${version}-${arch}.${ext}'},
    deb: {section: 'deb', ext: 'deb', fallback: '${name}_${version}_${arch}.${ext}'},
};

/** `getArtifactArchName` in builder-util, for the archs this app is built for. */
function archName(arch, ext) {
    if (arch === 'x64') {
        if (ext === 'AppImage' || ext === 'rpm' || ext === 'flatpak') {
            return 'x86_64';
        }
        if (ext === 'deb' || ext === 'snap') {
            return 'amd64';
        }
    }
    return arch;
}

/** `expandMacro` in app-builder-lib: a missing arch takes its separator with it. */
export function expandName(pattern, {arch, ext, os, version, productName, name}) {
    let result = pattern;
    if (arch == null) {
        for (const separator of ['-', ' ', '_', '/']) {
            result = result.replace(`${separator}\${arch}`, '');
        }
    }
    const values = {arch: arch ?? '', ext, os, version, productName, name};
    return result.replace(/\${([_a-zA-Z./*+]+)}/g, (match, key) => {
        if (!(key in values) || values[key] === undefined) {
            throw new Error(`cannot expand ${match} in "${pattern}"`);
        }
        return values[key];
    });
}

function asArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

/**
 * Every file name the config makes for `version`, and what is wrong with them.
 *
 * @param {object} input
 * @param {object} input.config the parsed electron-builder.yml
 * @param {{name: string, productName?: string}} input.packageJson the app's package.json
 * @param {string} input.version
 * @returns {{names: string[], problems: string[]}}
 */
export function checkBuilderConfig({config, packageJson, version}) {
    const names = [];
    const problems = [];
    const productName = config.productName ?? packageJson.productName ?? packageJson.name;
    const seen = new Map();
    for (const os of ['mac', 'win', 'linux']) {
        const platform = config[os] ?? {};
        for (const entry of asArray(platform.target)) {
            const target = typeof entry === 'string' ? entry : entry.target;
            const archs = asArray(typeof entry === 'string' ? undefined : entry.arch);
            const known = TARGETS[target];
            if (known === undefined) {
                problems.push(`${os} target ${target}: not known to this check, add it to TARGETS`);
                continue;
            }
            const own = config[known.section]?.artifactName;
            const pattern = own ?? platform.artifactName ?? config.artifactName;
            if (pattern === undefined) {
                problems.push(
                    `${os} target ${target}: no artifactName, so electron-builder's default "${known.fallback}" names the file`,
                );
            }
            const template = pattern ?? known.fallback;
            // With a template of our own, electron-builder always passes the arch (`isUserForced`).
            // A Windows installer for several archs is one file without an arch, plus one per
            // arch when the template names it.
            const builds =
                known.combined && archs.length > 1
                    ? [null, ...(template.includes('${arch}') ? archs : [])]
                    : archs.length > 0
                      ? archs
                      : ['x64'];
            for (const arch of builds) {
                let file;
                try {
                    file = expandName(template, {
                        arch: arch === null ? null : archName(arch, known.ext),
                        ext: known.ext,
                        os,
                        version,
                        productName,
                        name: packageJson.name,
                    });
                } catch (error) {
                    problems.push(`${os} target ${target}: ${error.message}`);
                    continue;
                }
                names.push(file);
                const label = `${os} ${target} ${arch ?? 'all archs'}`;
                if (!GITHUB_SAFE_NAME.test(file)) {
                    problems.push(
                        `${label}: "${file}" is not a GitHub asset name; latest*.yml would name another file`,
                    );
                }
                if (seen.has(file)) {
                    problems.push(`${label}: "${file}" is also the name of ${seen.get(file)}`);
                } else {
                    seen.set(file, label);
                }
            }
        }
    }
    return {names, problems};
}

/**
 * What is wrong with a packaging output directory: manifest entries without their file, and files
 * whose names a release upload would change.
 *
 * @param {string} dir
 * @param {{load: (text: string) => unknown}} yaml
 * @returns {{manifests: string[], problems: string[]}}
 */
export function checkOutput(dir, yaml = loadYaml()) {
    const problems = [];
    const entries = fs.readdirSync(dir, {withFileTypes: true}).filter((entry) => entry.isFile());
    const files = new Set(entries.map((entry) => entry.name).sort());
    const manifests = [...files].filter((file) => /^latest.*\.yml$/.test(file));
    for (const manifest of manifests) {
        const info = yaml.load(fs.readFileSync(path.join(dir, manifest), 'utf8')) ?? {};
        const urls = [...asArray(info.files).map((file) => file?.url), info.path].filter(
            (url) => url !== undefined && url !== null,
        );
        if (urls.length === 0) {
            problems.push(`${manifest}: names no file`);
        }
        for (const url of new Set(urls)) {
            if (!files.has(String(url))) {
                problems.push(`${manifest}: "${url}" is not in ${dir}`);
            }
        }
    }
    for (const file of files) {
        if ((RELEASE_FILE.test(file) || manifests.includes(file)) && !GITHUB_SAFE_NAME.test(file)) {
            problems.push(`"${file}" is not a GitHub asset name; the release would carry it under another one`);
        }
    }
    return {manifests, problems};
}

function parseArguments(argv) {
    const options = {dir: path.join(workspace, 'dist-electron'), configOnly: false};
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--dir' && argv[i + 1]) {
            options.dir = path.resolve(argv[(i += 1)]);
        } else if (argv[i] === '--config-only') {
            options.configOnly = true;
        }
    }
    return options;
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    const yaml = loadYaml();
    const config = yaml.load(fs.readFileSync(path.join(workspace, 'electron-builder.yml'), 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
    const fromConfig = checkBuilderConfig({config, packageJson, version: packageJson.version});
    const problems = [...fromConfig.problems];
    console.log(`electron-builder.yml names: ${fromConfig.names.join(', ')}`);
    if (!options.configOnly) {
        const fromOutput = checkOutput(options.dir, yaml);
        if (fromOutput.manifests.length === 0) {
            problems.push(`no latest*.yml in ${options.dir}`);
        }
        console.log(`checked: ${fromOutput.manifests.join(', ')}`);
        problems.push(...fromOutput.problems);
    }
    if (problems.length > 0) {
        console.error(`update names (B-47): ${problems.length} problem(s)`);
        for (const problem of problems) {
            console.error(`  - ${problem}`);
        }
        process.exit(1);
    }
    console.log('update names (B-47): the manifests and the files agree');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main();
}
