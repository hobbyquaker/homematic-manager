/**
 * `--install` / `--uninstall`: run the web host as a systemd service (D-25).
 *
 * The same shape as the installer of the maintainer's mqtt-interfaces adapters
 * (`mqtt-interfaces-core/lib/install.js`), minus everything that is about MQTT and about one
 * instance per device - there is exactly one Homematic Manager per machine, so no template unit and
 * no `@instance`:
 *
 * ```
 *   /etc/systemd/system/homematic-manager.service   the unit, ExecStart resolved to the bin
 *   /etc/homematic-manager/config.env               HMM_* variables, from the options given
 *   /var/lib/homematic-manager/                     StateDirectory: the profile directory
 *   system user homematic-manager                   what it runs as
 * ```
 *
 * Both operations are idempotent: installing twice rewrites the unit (so an `npm update -g` that
 * moves the binary is picked up) and backs up an existing `config.env` instead of losing it;
 * uninstalling twice is quiet. `--uninstall` keeps the state directory unless `--purge` is given -
 * it holds the CCU configuration and the caches, and losing those to a typo would be rude.
 *
 * Every path is prefixed with `--prefix` when one is given, and every command goes through the
 * injected `run`, which is what lets the tests exercise the whole thing in a temporary directory
 * with a stubbed `systemctl` and no root.
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {envVarName, OPTIONS, type OptionDefinition, type OptionName, type WebOptions} from './options.js';

export const SERVICE = 'homematic-manager';
export const UNIT = `${SERVICE}.service`;
export const REPOSITORY = 'https://github.com/hobbyquaker/homematic-manager';

/** Options that configure the process itself and therefore belong in `config.env`. */
export const ENV_OPTIONS: readonly OptionName[] = [
    'port',
    'host',
    'base',
    'ui-dir',
    'metadata-dir',
    'token',
    'auth',
    'issue-cookie',
    'ccu',
    'local',
    'log-level',
];

export interface InstallerOptions {
    /** A fake root; every path is written under it. The tests use one, root does not. */
    readonly prefix?: string;
    /** `execFileSync` by default; the tests stub `systemctl`, `useradd` and `id`. */
    readonly run?: (command: string, args: readonly string[]) => string;
    readonly log?: (line: string) => void;
    /** What `ExecStart` should point at; the resolved bin by default. */
    readonly execStart?: string;
    /** Skips the "must be root on linux with systemd" check; only the tests do. */
    readonly skipChecks?: boolean;
}

export interface InstallPaths {
    readonly unitFile: string;
    readonly configDir: string;
    readonly configFile: string;
    readonly stateDir: string;
}

/** Where everything goes, under an optional fake root. */
export function installPaths(prefix = ''): InstallPaths {
    const under = (absolute: string): string => (prefix === '' ? absolute : path.join(prefix, absolute));
    const configDir = under(`/etc/${SERVICE}`);
    return {
        unitFile: under(`/etc/systemd/system/${UNIT}`),
        configDir,
        configFile: path.join(configDir, 'config.env'),
        stateDir: under(`/var/lib/${SERVICE}`),
    };
}

/** The unit file. `StateDirectory` is what makes `/var/lib/<service>` exist with the right owner. */
export function unitFile(execStart: string, stateDir: string): string {
    return `[Unit]
Description=Homematic Manager - device configuration and administration
Documentation=${REPOSITORY}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/${SERVICE}/config.env
Environment=HMM_DATA_DIR=${stateDir}
ExecStart=${execStart}
Restart=always
RestartSec=10
SyslogIdentifier=${SERVICE}
User=${SERVICE}
Group=${SERVICE}
StateDirectory=${SERVICE}
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

/** `config.env`: the options that were given, as the `HMM_*` variables the CLI reads back. */
export function envFile(values: Partial<WebOptions>, defaults: Partial<WebOptions> = {}): string {
    const lines = [
        `# ${SERVICE} - read by ${UNIT}.`,
        `# Every option of \`${SERVICE}-web --help\` has a variable here.`,
        `# Edit and run: systemctl restart ${UNIT}`,
        '',
    ];
    for (const name of ENV_OPTIONS) {
        const key = camelKey(name);
        const value = values[key];
        if (value === undefined || value === '' || value === defaults[key]) {
            continue;
        }
        lines.push(`${envVarName(name)}=${String(value).replace(/[\r\n]/g, ' ')}`);
    }
    return `${lines.join('\n')}\n`;
}

/** Writes the unit and the configuration, creates the user, enables and starts the service. */
export function installService(values: WebOptions, options: InstallerOptions = {}): void {
    const log = options.log ?? ((line: string): void => console.log(line));
    const run = options.run ?? defaultRun;
    const paths = installPaths(options.prefix);
    requireRoot('--install', options);

    try {
        run('id', ['-u', SERVICE]);
    } catch {
        log(`creating system user ${SERVICE}`);
        run('useradd', [
            '--system',
            '--no-create-home',
            '--home-dir',
            paths.stateDir,
            '--shell',
            '/usr/sbin/nologin',
            SERVICE,
        ]);
    }

    fs.mkdirSync(paths.stateDir, {recursive: true, mode: 0o750});
    run('chown', ['-R', `${SERVICE}:${SERVICE}`, paths.stateDir]);

    fs.mkdirSync(paths.configDir, {recursive: true, mode: 0o750});
    if (fs.existsSync(paths.configFile)) {
        fs.copyFileSync(paths.configFile, `${paths.configFile}.bak`);
        log(`existing ${paths.configFile} backed up to ${paths.configFile}.bak`);
    }
    fs.writeFileSync(paths.configFile, envFile(values, defaultValues()), {mode: 0o640});
    run('chown', ['-R', `root:${SERVICE}`, paths.configDir]);
    log(`wrote ${paths.configFile}`);

    const execStart = options.execStart ?? resolveExecStart(process.argv[1]);
    fs.mkdirSync(path.dirname(paths.unitFile), {recursive: true});
    fs.writeFileSync(paths.unitFile, unitFile(execStart, stateDirOf(options.prefix)), {mode: 0o644});
    log(`wrote ${paths.unitFile} (ExecStart=${execStart})`);

    run('systemctl', ['daemon-reload']);
    run('systemctl', ['enable', '--now', UNIT]);
    log(`${UNIT} enabled and started. logs: journalctl -u ${UNIT} -f`);
}

/** Stops and removes the service. The state directory survives unless `purge` is set. */
export function uninstallService(options: InstallerOptions & {purge?: boolean} = {}): void {
    const log = options.log ?? ((line: string): void => console.log(line));
    const run = options.run ?? defaultRun;
    const paths = installPaths(options.prefix);
    requireRoot('--uninstall', options);

    try {
        run('systemctl', ['disable', '--now', UNIT]);
    } catch {
        // not installed, or already stopped: nothing to undo
    }
    for (const file of [paths.unitFile, paths.configFile]) {
        if (fs.existsSync(file)) {
            fs.rmSync(file);
            log(`removed ${file}`);
        }
    }
    if (fs.existsSync(paths.configDir)) {
        fs.rmSync(paths.configDir, {recursive: true, force: true});
    }
    run('systemctl', ['daemon-reload']);
    if (options.purge === true) {
        fs.rmSync(paths.stateDir, {recursive: true, force: true});
        log(`removed ${paths.stateDir} (--purge)`);
    } else {
        log(`${UNIT} removed. the configuration and the caches are kept in ${paths.stateDir};`);
        log('run --uninstall --purge to delete them too.');
    }
}

/** `node /usr/lib/node_modules/.../dist/cli.js`, resolved so an update of the package follows. */
export function resolveExecStart(argv1: string | undefined): string {
    if (argv1 === undefined) {
        return `${process.execPath} ${SERVICE}-web`;
    }
    try {
        return `${process.execPath} ${fs.realpathSync(argv1)}`;
    } catch {
        return `${process.execPath} ${argv1}`;
    }
}

function stateDirOf(prefix: string | undefined): string {
    // the unit's own view: systemd's StateDirectory is always the real /var/lib path
    return installPaths(prefix === undefined || prefix === '' ? '' : prefix).stateDir;
}

function camelKey(name: OptionName): keyof WebOptions {
    return name.replace(/-(.)/g, (_, character: string) => character.toUpperCase()) as keyof WebOptions;
}

function defaultValues(): Partial<WebOptions> {
    const defaults: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(OPTIONS) as [OptionName, OptionDefinition][]) {
        if (definition.default !== undefined) {
            defaults[camelKey(name)] = definition.default;
        }
    }
    return defaults as Partial<WebOptions>;
}

function requireRoot(option: string, options: InstallerOptions): void {
    if (options.skipChecks === true || options.prefix !== undefined) {
        return;
    }
    if (os.platform() !== 'linux') {
        throw new Error(`${option} is only supported on Linux with systemd`);
    }
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        throw new Error(`${option} must run as root, e.g. sudo ${SERVICE}-web ${option}`);
    }
    if (!fs.existsSync('/run/systemd/system')) {
        throw new Error('systemd is not running on this system');
    }
}

function defaultRun(command: string, args: readonly string[]): string {
    return execFileSync(command, [...args], {stdio: ['ignore', 'pipe', 'inherit']})
        .toString()
        .trim();
}
