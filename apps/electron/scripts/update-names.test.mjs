import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it} from 'vitest';

import {
    checkBuilderConfig,
    checkOutput,
    expandName,
    UPDATER_CACHE_DIR_NAME,
    updaterCacheDirName,
} from './update-names.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = createRequire(import.meta.url);
const yaml = createRequire(createRequire(here.resolve('electron-builder')).resolve('app-builder-lib/package.json'))(
    'js-yaml',
);

const realConfig = () => yaml.load(fs.readFileSync(path.join(workspace, 'electron-builder.yml'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));

/**
 * B-47 (#163): `latest*.yml` named `Homematic-Manager-...`, the files were `Homematic Manager-...`
 * and the release assets `Homematic.Manager-...`, so no in-app download ever worked. These names
 * are what the update manifests of the next release point at, and what task 53 links to.
 */
describe('the names electron-builder.yml gives the installers', () => {
    it('are GitHub asset names, one per target and arch', () => {
        const {names, problems} = checkBuilderConfig({
            config: realConfig(),
            packageJson,
            version: '3.0.0-beta.19',
        });

        expect(problems).toEqual([]);
        expect(names).toEqual([
            'Homematic-Manager-3.0.0-beta.19-universal.dmg',
            'Homematic-Manager-3.0.0-beta.19-universal-mac.zip',
            'Homematic-Manager-Setup-3.0.0-beta.19.exe',
            'Homematic-Manager-3.0.0-beta.19-portable.exe',
            'Homematic-Manager-3.0.0-beta.19-portable-x64.exe',
            'Homematic-Manager-3.0.0-beta.19-portable-arm64.exe',
            'Homematic-Manager-3.0.0-beta.19-x86_64.AppImage',
            'Homematic-Manager-3.0.0-beta.19-arm64.AppImage',
            'homematic-manager_3.0.0-beta.19_amd64.deb',
            'homematic-manager_3.0.0-beta.19_arm64.deb',
        ]);
    });

    it('fails for a target that falls back to the default name, which starts with the product name', () => {
        const config = realConfig();
        delete config.nsis.artifactName;

        const {names, problems} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(names).toContain('Homematic Manager Setup 1.0.0.exe');
        expect(problems).toEqual([
            expect.stringContaining('win target nsis: no artifactName'),
            expect.stringContaining('"Homematic Manager Setup 1.0.0.exe" is not a GitHub asset name'),
        ]);
    });

    it('fails for a template with a space, the beta.18 portable one', () => {
        const config = realConfig();
        config.portable.artifactName = '${productName}-${version}-portable-${arch}.${ext}';

        const {problems} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(problems).toEqual([
            expect.stringContaining('"Homematic Manager-1.0.0-portable.exe"'),
            expect.stringContaining('"Homematic Manager-1.0.0-portable-x64.exe"'),
            expect.stringContaining('"Homematic Manager-1.0.0-portable-arm64.exe"'),
        ]);
    });

    it('uses the platform section for the mac zip, which has none of its own', () => {
        const config = realConfig();
        delete config.mac.artifactName;

        const {problems} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(problems).toEqual([
            expect.stringContaining('mac target zip: no artifactName'),
            expect.stringContaining('"Homematic Manager-1.0.0-universal-mac.zip"'),
        ]);
    });

    it('fails when two archs would write the same file', () => {
        const config = realConfig();
        config.appImage.artifactName = 'Homematic-Manager-${version}.${ext}';

        const {problems} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(problems).toEqual([
            expect.stringContaining('"Homematic-Manager-1.0.0.AppImage" is also the name of linux AppImage x64'),
        ]);
    });

    it('fails for a target it does not know and for a macro it cannot expand', () => {
        const config = realConfig();
        config.linux.target.push({target: 'rpm', arch: ['x64']});
        config.deb.artifactName = '${nothing}-${version}.${ext}';

        const {problems} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(problems).toEqual([
            'linux target deb: cannot expand ${nothing} in "${nothing}-${version}.${ext}"',
            'linux target deb: cannot expand ${nothing} in "${nothing}-${version}.${ext}"',
            'linux target rpm: not known to this check, add it to TARGETS',
        ]);
    });

    it('fails when the package name would name the updater folder, the beta.18 one', () => {
        const config = realConfig();
        delete config.extraMetadata;

        const {problems} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(problems).toEqual([
            'the updater\'s download folder would be "@homematic-managerelectron-updater", not "homematic-manager-updater"; set extraMetadata.name',
        ]);
    });

    it('uses the name after extraMetadata for ${name}, as electron-builder does', () => {
        const config = realConfig();
        config.deb.artifactName = '${name}_${version}_${arch}.${ext}';

        const {names} = checkBuilderConfig({config, packageJson, version: '1.0.0'});

        expect(names).toContain('homematic-manager_1.0.0_amd64.deb');
    });

    it('drops an arch together with its separator, as electron-builder does', () => {
        const values = {arch: null, ext: 'exe', os: 'win', version: '1.0.0', productName: 'P', name: 'p'};
        expect(expandName('a-${version}-${arch}.${ext}', values)).toBe('a-1.0.0.exe');
        expect(expandName('a ${version} ${arch}.${ext}', values)).toBe('a 1.0.0.exe');
        expect(expandName('a_${version}_${arch}.${ext}', values)).toBe('a_1.0.0.exe');
        expect(expandName('${productName}-${os}-${name}', values)).toBe('P-win-p');
    });
});

/**
 * B-49: electron-updater downloads into `<cache>/<updaterCacheDirName>`, and the Windows installer
 * keeps a copy of itself there. electron-builder derives the name from the package name, which is
 * the workspace's `@homematic-manager/electron` unless extraMetadata says otherwise.
 */
describe("the updater's download folder", () => {
    it('is homematic-manager-updater', () => {
        expect(UPDATER_CACHE_DIR_NAME).toBe('homematic-manager-updater');
        expect(updaterCacheDirName({config: realConfig(), packageJson})).toBe('homematic-manager-updater');
    });

    it('comes from the package name as electron-builder sanitizes it', () => {
        expect(updaterCacheDirName({config: {}, packageJson})).toBe('@homematic-managerelectron-updater');
        expect(updaterCacheDirName({config: {extraMetadata: {name: 'Some/App'}}, packageJson})).toBe('someapp-updater');
    });
});

describe('a packaging output', () => {
    let dir;

    afterEach(() => {
        if (dir) {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    const output = (files) => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-update-names-'));
        for (const [name, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
            fs.writeFileSync(path.join(dir, name), content);
        }
        return dir;
    };

    const manifest = (...urls) =>
        yaml.dump({
            version: '1.0.0',
            files: urls.map((url) => ({url, sha512: 'x', size: 1})),
            path: urls[0],
            sha512: 'x',
        });

    const appUpdate = (updaterCacheDirName) =>
        yaml.dump({owner: 'hobbyquaker', repo: 'homematic-manager', provider: 'github', updaterCacheDirName});

    it('passes when every manifest entry is a file with a safe name', () => {
        const result = checkOutput(
            output({
                'latest.yml': manifest('Homematic-Manager-Setup-1.0.0.exe'),
                'Homematic-Manager-Setup-1.0.0.exe': '',
                'Homematic-Manager-Setup-1.0.0.exe.blockmap': '',
                'latest-linux.yml': manifest(
                    'Homematic-Manager-1.0.0-x86_64.AppImage',
                    'homematic-manager_1.0.0_amd64.deb',
                ),
                'Homematic-Manager-1.0.0-x86_64.AppImage': '',
                'homematic-manager_1.0.0_amd64.deb': '',
                'builder-effective-config.yaml': '',
                'linux-unpacked/resources/app-update.yml': appUpdate('homematic-manager-updater'),
                'win-unpacked/resources/app-update.yml': appUpdate('homematic-manager-updater'),
                'mac-universal/Homematic Manager.app/Contents/Resources/app-update.yml':
                    appUpdate('homematic-manager-updater'),
                '__appImage-x64/resources/app-update.yml': appUpdate('staging-is-not-checked'),
            }),
            yaml,
        );

        expect(result).toEqual({
            manifests: ['latest-linux.yml', 'latest.yml'],
            appUpdates: [
                'linux-unpacked/resources/app-update.yml',
                'mac-universal/Homematic Manager.app/Contents/Resources/app-update.yml',
                'win-unpacked/resources/app-update.yml',
            ],
            problems: [],
        });
    });

    it("fails on the beta.18 app-update.yml: the updater's folder is named after the workspace", () => {
        const result = checkOutput(
            output({
                'latest-linux.yml': manifest('Homematic-Manager-1.0.0-x86_64.AppImage'),
                'Homematic-Manager-1.0.0-x86_64.AppImage': '',
                'linux-unpacked/resources/app-update.yml': appUpdate('@homematic-managerelectron-updater'),
                'linux-arm64-unpacked/resources/app-update.yml': appUpdate('homematic-manager-updater'),
            }),
            yaml,
        );

        expect(result.problems).toEqual([
            'linux-unpacked/resources/app-update.yml: updaterCacheDirName is "@homematic-managerelectron-updater", not "homematic-manager-updater"',
        ]);
    });

    it('fails when a build has manifests but no packaged app-update.yml', () => {
        const result = checkOutput(
            output({
                'latest-linux.yml': manifest('Homematic-Manager-1.0.0-x86_64.AppImage'),
                'Homematic-Manager-1.0.0-x86_64.AppImage': '',
            }),
            yaml,
        );

        expect(result.problems).toEqual([
            `no packaged app-update.yml in ${dir}, so the updater's folder cannot be checked`,
        ]);
    });

    it('fails on the beta.18 output: the manifest names a file that is not there', () => {
        const result = checkOutput(
            output({
                'latest.yml': manifest('Homematic-Manager-Setup-1.0.0.exe'),
                'Homematic Manager Setup 1.0.0.exe': '',
                'Homematic Manager Setup 1.0.0.exe.blockmap': '',
                'win-unpacked/resources/app-update.yml': appUpdate('homematic-manager-updater'),
            }),
            yaml,
        );

        expect(result.problems).toEqual([
            `latest.yml: "Homematic-Manager-Setup-1.0.0.exe" is not in ${dir}`,
            expect.stringContaining('"Homematic Manager Setup 1.0.0.exe" is not a GitHub asset name'),
            expect.stringContaining('"Homematic Manager Setup 1.0.0.exe.blockmap" is not a GitHub asset name'),
        ]);
    });

    it('fails on a manifest that names nothing', () => {
        const result = checkOutput(
            output({
                'latest-mac.yml': 'version: 1.0.0\n',
                'mac-universal/Homematic Manager.app/Contents/Resources/app-update.yml':
                    appUpdate('homematic-manager-updater'),
            }),
            yaml,
        );

        expect(result.problems).toEqual(['latest-mac.yml: names no file']);
    });
});
