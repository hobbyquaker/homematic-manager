/**
 * The systemd installer, run against a fake root with a stubbed `systemctl`, `useradd` and `id`.
 * Nothing here needs (or gets) root: `--prefix` moves every path under a temporary directory.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {runCli} from './cli.js';
import {
    envFile,
    ENV_OPTIONS,
    installPaths,
    installService,
    resolveExecStart,
    SERVICE,
    UNIT,
    uninstallService,
    unitFile,
} from './install.js';
import {parseOptions} from './options.js';

let prefix: string;
let commands: string[][];

const run = (command: string, args: readonly string[]): string => {
    commands.push([command, ...args]);
    if (command === 'id') {
        throw new Error('no such user');
    }
    return '';
};

beforeEach(async () => {
    prefix = await fsp.mkdtemp(path.join(os.tmpdir(), 'hmm-install-'));
    commands = [];
});

afterEach(async () => {
    await fsp.rm(prefix, {recursive: true, force: true});
});

function values(argv: string[] = []): ReturnType<typeof parseOptions> {
    return parseOptions(argv, {HOME: '/home/tester'});
}

describe('installPaths', () => {
    it('are the systemd places, under the prefix when one is given', () => {
        expect(installPaths()).toEqual({
            unitFile: `/etc/systemd/system/${UNIT}`,
            configDir: `/etc/${SERVICE}`,
            configFile: `/etc/${SERVICE}/config.env`,
            stateDir: `/var/lib/${SERVICE}`,
        });
        expect(installPaths('/tmp/root').unitFile).toBe(`/tmp/root/etc/systemd/system/${UNIT}`);
    });
});

describe('unitFile', () => {
    it('has the hardening, the state directory and the resolved ExecStart', () => {
        const unit = unitFile('/usr/bin/node /usr/lib/x/dist/cli.js', '/var/lib/homematic-manager');
        expect(unit).toContain('ExecStart=/usr/bin/node /usr/lib/x/dist/cli.js');
        expect(unit).toContain(`User=${SERVICE}`);
        expect(unit).toContain(`StateDirectory=${SERVICE}`);
        expect(unit).toContain('EnvironmentFile=/etc/homematic-manager/config.env');
        expect(unit).toContain('Environment=HMM_DATA_DIR=/var/lib/homematic-manager');
        expect(unit).toContain('Restart=always');
        expect(unit).toContain('NoNewPrivileges=true');
        expect(unit).toContain('ProtectSystem=full');
        expect(unit).toContain('Documentation=https://github.com/hobbyquaker/homematic-manager');
        expect(unit).toContain('WantedBy=multi-user.target');
    });
});

describe('envFile', () => {
    it('writes only what differs from the defaults, as HMM_ variables', () => {
        const content = envFile(values(['--port', '8100', '--ccu', 'ccu3', '--no-auth']), {
            port: 8090,
            auth: true,
            host: '127.0.0.1',
        });
        expect(content).toContain('HMM_PORT=8100');
        expect(content).toContain('HMM_CCU=ccu3');
        expect(content).toContain('HMM_AUTH=false');
        // the host default was not changed, so it is not pinned in the file
        expect(content).not.toContain('HMM_HOST=');
        expect(content).not.toContain('HMM_DATA_DIR=');
    });

    it('never writes the meta options and cannot be broken by a newline', () => {
        const content = envFile({token: 'a\nb', install: true} as never);
        expect(content).toContain('HMM_TOKEN=a b');
        expect(content).not.toContain('HMM_INSTALL');
        expect(ENV_OPTIONS).not.toContain('install');
    });
});

describe('installService', () => {
    it('creates the user, writes the files and enables the unit', () => {
        const log: string[] = [];
        installService(values(['--port', '8100', '--ccu', 'ccu3']), {
            prefix,
            run,
            execStart: '/usr/bin/node /opt/hmm/cli.js',
            log: (line) => log.push(line),
        });
        const paths = installPaths(prefix);
        expect(fs.readFileSync(paths.unitFile, 'utf8')).toContain('ExecStart=/usr/bin/node /opt/hmm/cli.js');
        expect(fs.readFileSync(paths.configFile, 'utf8')).toContain('HMM_PORT=8100');
        expect(fs.existsSync(paths.stateDir)).toBe(true);
        expect(commands.map((entry) => entry.slice(0, 2).join(' '))).toEqual([
            'id -u',
            'useradd --system',
            'chown -R',
            'chown -R',
            'systemctl daemon-reload',
            'systemctl enable',
        ]);
        expect(log.join(' ')).toContain('enabled and started');
    });

    it('does not create the user when it is already there', () => {
        installService(values(), {
            prefix,
            run: (command, args) => (commands.push([command, ...args]), ''),
            log: () => undefined,
        });
        expect(commands.some((entry) => entry[0] === 'useradd')).toBe(false);
    });

    it('is idempotent and backs up an existing configuration', () => {
        const log: string[] = [];
        installService(values(['--port', '8100']), {prefix, run, log: () => undefined});
        installService(values(['--port', '8200']), {prefix, run, log: (line) => log.push(line)});
        const paths = installPaths(prefix);
        expect(fs.readFileSync(paths.configFile, 'utf8')).toContain('HMM_PORT=8200');
        expect(fs.readFileSync(`${paths.configFile}.bak`, 'utf8')).toContain('HMM_PORT=8100');
        expect(log.join(' ')).toContain('backed up');
    });
});

describe('uninstallService', () => {
    it('removes the unit and the configuration but keeps the state', () => {
        installService(values(), {prefix, run, log: () => undefined});
        const paths = installPaths(prefix);
        fs.writeFileSync(path.join(paths.stateDir, 'config.json'), '{}');
        const log: string[] = [];
        uninstallService({prefix, run, log: (line) => log.push(line)});
        expect(fs.existsSync(paths.unitFile)).toBe(false);
        expect(fs.existsSync(paths.configFile)).toBe(false);
        expect(fs.existsSync(path.join(paths.stateDir, 'config.json'))).toBe(true);
        expect(log.join(' ')).toContain('--purge');
    });

    it('deletes the state with --purge, and is quiet when nothing is installed', () => {
        installService(values(), {prefix, run, log: () => undefined});
        uninstallService({prefix, run, purge: true, log: () => undefined});
        expect(fs.existsSync(installPaths(prefix).stateDir)).toBe(false);
        expect(() => uninstallService({prefix, run, log: () => undefined})).not.toThrow();
    });

    it('survives a systemctl that fails because the unit is not there', () => {
        expect(() =>
            uninstallService({
                prefix,
                run: (command, args) => {
                    if (command === 'systemctl' && args[0] === 'disable') {
                        throw new Error('Unit not loaded');
                    }
                    return '';
                },
                log: () => undefined,
            }),
        ).not.toThrow();
    });
});

describe('resolveExecStart', () => {
    it('resolves the symlink npm installs as the bin', () => {
        const target = path.join(prefix, 'cli.js');
        fs.writeFileSync(target, '');
        const link = path.join(prefix, 'homematic-manager-web');
        fs.symlinkSync(target, link);
        expect(resolveExecStart(link)).toBe(`${process.execPath} ${fs.realpathSync(target)}`);
        expect(resolveExecStart(path.join(prefix, 'gone'))).toContain('gone');
        expect(resolveExecStart(undefined)).toContain('homematic-manager-web');
    });
});

describe('the CLI wiring', () => {
    it('installs and uninstalls through --install / --uninstall', async () => {
        const out: string[] = [];
        const installed = await runCli({
            argv: ['--install', '--prefix', prefix, '--port', '8100'],
            env: {},
            write: (text) => out.push(text),
            installer: {run, execStart: '/usr/bin/node /opt/hmm/cli.js'},
        });
        expect(installed.code).toBe(0);
        expect(installed.host).toBeUndefined();
        expect(fs.existsSync(installPaths(prefix).unitFile)).toBe(true);

        const removed = await runCli({
            argv: ['--uninstall', '--prefix', prefix, '--purge'],
            env: {},
            write: (text) => out.push(text),
            installer: {run},
        });
        expect(removed.code).toBe(0);
        expect(fs.existsSync(installPaths(prefix).stateDir)).toBe(false);
    });

    it('reports why it cannot install instead of throwing', async () => {
        const errors: string[] = [];
        const failed = await runCli({
            argv: ['--install'],
            env: {},
            writeError: (text) => errors.push(text),
            installer: {
                prefix,
                run: () => {
                    throw new Error('systemctl is not there');
                },
            },
        });
        expect(failed.code).toBe(1);
        expect(errors.join('')).toContain('systemctl is not there');
    });
});
