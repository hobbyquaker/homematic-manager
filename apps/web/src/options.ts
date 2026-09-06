/**
 * The command line, in the style of the maintainer's other projects (hm2mqtt.js and the rest of
 * mqtt-interfaces): one plain object of option definitions, no yargs, `--help` and `--config-schema`
 * generated from it, and `HMM_*` environment variables mirroring every option.
 *
 * Precedence is CLI > environment > default. There is no configuration file: what the host itself
 * needs is a handful of paths and a port, and everything about the CCU lives in the backend's
 * `config.json` where the UI can change it.
 */

import {LOG_LEVELS, isLogLevel, type LogLevel} from './log.js';
import {defaultDataDir} from './paths.js';
import {DEFAULT_HOST, DEFAULT_PORT, type AuthMode} from './server.js';

/** Prefix of every environment variable: `--data-dir` is `HMM_DATA_DIR`. */
export const ENV_PREFIX = 'HMM';

/**
 * D-31: how long a server install waits with no page open before it de-registers from the interface
 * processes. On by default for every server install type - npm, Docker and the CCU addon all run
 * unattended for days, and an interface process pushing events at nobody costs the CCU's own CPU.
 * `0` disables it; Electron never gets here (its transport reports no sessions).
 */
export const DEFAULT_IDLE_UNSUBSCRIBE = '5m';

/**
 * D-32/D-40: how a browser is let in. `token` is what every install type but the CCU addon uses, and
 * stays the default there too - the addon's `settings.cgi` hand-over is the primary path and the
 * login is switched on by hand in `etc/hmm.env` or from the addon's settings page.
 *
 * `occulite` is the openccu-lite form of the same idea: no form of our own, the box's shell hands
 * the session over on the URL and the host checks it against the box. The addon's `update_script`
 * sets it by itself when it is installed on a box (`VARIANT=lite` in `/VERSION`).
 */
export const AUTH_MODES = ['token', 'rega', 'occulite'] as const;

/** D-32: a login lasts a day of not being used. Sliding, so a tab in use never expires. */
export const DEFAULT_SESSION_TTL = '24h';

/**
 * A duration as `90` (seconds), `300s`, `5m` or `1h`, in milliseconds. `0` is off.
 *
 * Not a general parser: three suffixes, no fractions, no `1m30s`. It exists so the addon's rc.d
 * line and the Docker environment can say `5m` instead of `300000`, and so a typo is a usage error
 * rather than a silently disabled feature.
 */
export function parseDuration(value: string, option: string): number {
    const match = /^(\d+)\s*(ms|s|m|h)?$/.exec(value.trim().toLowerCase());
    if (!match) {
        throw new CliError(`${option}: "${value}" is not a duration (e.g. 300s, 5m, 0)`);
    }
    const amount = Number(match[1]);
    const factor = {ms: 1, s: 1000, m: 60_000, h: 3_600_000}[match[2] ?? 's'] ?? 1000;
    return amount * factor;
}

/** Is this one of the three modes? `parseRaw` has already refused everything else. */
export function isAuthMode(value: string | undefined): value is AuthMode {
    return value === 'token' || value === 'rega' || value === 'occulite';
}

export type OptionType = 'string' | 'number' | 'boolean';

export interface OptionDefinition {
    readonly type: OptionType;
    readonly describe: string;
    readonly alias?: string;
    readonly default?: string | number | boolean;
    readonly choices?: readonly string[];
    /** How the default is described when it is only known at runtime. */
    readonly defaultDescription?: string;
    /** Not part of a configuration: never written to the schema. */
    readonly meta?: boolean;
}

export const OPTIONS = {
    port: {
        alias: 'p',
        type: 'number',
        describe: 'tcp port to listen on; 0 picks a free one',
        default: DEFAULT_PORT,
    },
    host: {
        type: 'string',
        describe: 'address to bind to; 0.0.0.0 exposes the host to the network',
        default: DEFAULT_HOST,
    },
    base: {
        type: 'string',
        describe: 'url prefix everything is served under, e.g. /addons/hmm/ behind a proxy',
        default: '/',
    },
    'data-dir': {
        alias: 'profile',
        type: 'string',
        describe: 'profile directory of the backend: config.json and the per-CCU caches',
        defaultDescription: '~/.config/homematic-manager (or the OS equivalent)',
    },
    'ui-dir': {
        type: 'string',
        describe: 'directory of the built UI',
        defaultDescription: 'packages/ui/dist, or ui/ next to the compiled host',
    },
    'metadata-dir': {
        type: 'string',
        describe: 'directory of the generated device metadata, served under <base>data/',
        defaultDescription: 'data/dist, or data/ next to the compiled host',
    },
    'ui-dev-server': {
        type: 'string',
        describe: 'proxy everything but the api to a vite dev server, e.g. http://127.0.0.1:5173',
    },
    token: {
        type: 'string',
        describe: 'token clients have to present; a random one is generated when this is omitted',
        defaultDescription: 'random',
    },
    auth: {
        type: 'boolean',
        describe: 'require a token on the api socket (--no-auth lets every client in)',
        default: true,
    },
    'issue-cookie': {
        type: 'boolean',
        describe: 'hand the token to the browser as a cookie on the page load',
        defaultDescription: 'on for a loopback bind, off otherwise',
    },
    'auth-mode': {
        type: 'string',
        describe:
            'token: the token guards the api. rega: ask for a CCU login first (addon only, needs --local). ' +
            'occulite: take the session openccu-lite hands over',
        choices: AUTH_MODES,
        default: 'token',
    },
    'occulite-url': {
        type: 'string',
        describe: 'with --auth-mode occulite: the box that issued the session',
        defaultDescription: 'http://127.0.0.1',
    },
    'session-ttl': {
        type: 'string',
        describe: 'with --auth-mode rega or occulite: how long a login lasts without being used (24h, 90m, ...)',
        default: DEFAULT_SESSION_TTL,
    },
    ccu: {
        alias: 'a',
        type: 'string',
        describe: 'hostname or ip of the CCU; written to the configuration when it differs',
    },
    local: {
        type: 'boolean',
        describe: 'we run on the CCU itself: talk to the interface processes directly (task 13)',
    },
    'callback-ip': {
        type: 'string',
        describe: 'address the interface processes call back to; set it where this host cannot see its own (docker)',
        defaultDescription: 'the local address the CCU is reachable from',
    },
    'callback-xmlrpc-port': {
        type: 'number',
        describe: 'fixed port for the xmlrpc callback server; needed when the ports are published, not host-networked',
        defaultDescription: '0, a free port',
    },
    'callback-binrpc-port': {
        type: 'number',
        describe: 'fixed port for the binrpc callback server; must differ from the xmlrpc one',
        defaultDescription: '0, a free port',
    },
    'idle-unsubscribe': {
        type: 'string',
        describe: 'drop the event subscriptions after this long with no page open (5m, 300s, 0 to disable)',
        default: DEFAULT_IDLE_UNSUBSCRIBE,
    },
    demo: {
        type: 'boolean',
        describe: 'serve the UI on its demo fixture and start no backend at all',
        default: false,
    },
    'log-level': {
        type: 'string',
        describe: 'log level',
        choices: LOG_LEVELS,
        default: 'info',
    },
    install: {
        type: 'boolean',
        describe: 'install as the systemd service homematic-manager, using the other options as its config; needs root',
        meta: true,
    },
    uninstall: {
        type: 'boolean',
        describe: 'stop, disable and remove the systemd service; needs root',
        meta: true,
    },
    purge: {
        type: 'boolean',
        describe: 'with --uninstall: also delete the configuration and the caches in /var/lib',
        meta: true,
    },
    prefix: {
        type: 'string',
        describe: 'write the systemd files under this root instead of /; for packaging and tests',
        meta: true,
    },
    help: {alias: 'h', type: 'boolean', describe: 'print this help and exit', meta: true},
    version: {type: 'boolean', describe: 'print the version and exit', meta: true},
    'config-schema': {type: 'boolean', describe: 'print the JSON Schema of all options and exit', meta: true},
} as const satisfies Record<string, OptionDefinition>;

export type OptionName = keyof typeof OPTIONS;

/** What the CLI produces and `createWebHost` plus `runCli` consume. */
export interface WebOptions {
    readonly port: number;
    readonly host: string;
    readonly base: string;
    readonly dataDir: string;
    readonly uiDir: string | undefined;
    readonly metadataDir: string | undefined;
    readonly uiDevServer: string | undefined;
    readonly token: string | undefined;
    readonly auth: boolean;
    readonly issueCookie: boolean | undefined;
    /** D-32: `token` or `rega`. */
    readonly authMode: AuthMode;
    /** D-40: the box `--auth-mode occulite` checks a handed-over session against. */
    readonly occuliteUrl: string | undefined;
    /** D-32, in milliseconds. */
    readonly sessionTtlMs: number;
    readonly ccu: string | undefined;
    readonly local: boolean | undefined;
    readonly callbackIp: string | undefined;
    readonly callbackXmlrpcPort: number | undefined;
    readonly callbackBinrpcPort: number | undefined;
    readonly demo: boolean;
    /** D-31, in milliseconds; `0` disables the idle unsubscribe. */
    readonly idleUnsubscribeMs: number;
    readonly logLevel: LogLevel;
    readonly help: boolean;
    readonly version: boolean;
    readonly configSchema: boolean;
    readonly install: boolean;
    readonly uninstall: boolean;
    readonly purge: boolean;
    readonly prefix: string | undefined;
}

/** A usage error: `runCli` prints the message and exits 1 instead of dumping a stack. */
export class CliError extends Error {}

/** `data-dir` -> `HMM_DATA_DIR`. */
export function envVarName(option: string, prefix = ENV_PREFIX): string {
    return `${prefix}_${option.replace(/-/g, '_').toUpperCase()}`;
}

/** `ui-dev-server` -> `uiDevServer`. */
export function camelCase(option: string): string {
    return option.replace(/-(.)/g, (_, character: string) => character.toUpperCase());
}

/** Environment strings are all strings; the definition says what they mean. */
export function coerce(value: string, type: OptionType, option: string): string | number | boolean {
    if (type === 'boolean') {
        const normalised = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalised)) {
            return true;
        }
        if (['0', 'false', 'no', 'off', ''].includes(normalised)) {
            return false;
        }
        throw new CliError(`${option}: "${value}" is not a boolean`);
    }
    if (type === 'number') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new CliError(`${option}: "${value}" is not a number`);
        }
        return parsed;
    }
    return value;
}

const BY_ALIAS = new Map<string, OptionName>();
for (const [name, definition] of Object.entries(OPTIONS) as [OptionName, OptionDefinition][]) {
    if (definition.alias !== undefined) {
        BY_ALIAS.set(definition.alias, name);
    }
}

/** Reads the raw values from `argv` and `env`, CLI winning over the environment. */
export function parseRaw(
    argv: readonly string[],
    env: NodeJS.ProcessEnv = process.env,
): Record<string, string | number | boolean> {
    const values: Record<string, string | number | boolean> = {};
    for (const [name, definition] of Object.entries(OPTIONS) as [OptionName, OptionDefinition][]) {
        const fromEnv = env[envVarName(name)];
        if (fromEnv !== undefined) {
            values[name] = coerce(fromEnv, definition.type, envVarName(name));
        }
    }
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index] as string;
        if (!argument.startsWith('-') || argument === '-') {
            throw new CliError(`unexpected argument "${argument}"`);
        }
        let name = argument.replace(/^--?/, '');
        let inline: string | undefined;
        const equals = name.indexOf('=');
        if (equals !== -1) {
            inline = name.slice(equals + 1);
            name = name.slice(0, equals);
        }
        let negated = false;
        if (name.startsWith('no-') && !(name in OPTIONS)) {
            negated = true;
            name = name.slice(3);
        }
        const resolved = (BY_ALIAS.get(name) ?? name) as OptionName;
        const definition: OptionDefinition | undefined = OPTIONS[resolved];
        if (!definition) {
            throw new CliError(`unknown option "${argument}"`);
        }
        if (definition.type === 'boolean') {
            values[resolved] = inline === undefined ? !negated : coerce(inline, 'boolean', argument);
            continue;
        }
        if (negated) {
            throw new CliError(`--no-${resolved} is not a boolean option`);
        }
        const value = inline ?? argv[index + 1];
        if (value === undefined || (inline === undefined && value.startsWith('--'))) {
            throw new CliError(`--${resolved} needs a value`);
        }
        if (inline === undefined) {
            index += 1;
        }
        values[resolved] = coerce(value, definition.type, argument);
    }
    for (const [name, definition] of Object.entries(OPTIONS) as [OptionName, OptionDefinition][]) {
        const value = values[name];
        if (definition.choices && value !== undefined && !definition.choices.includes(String(value))) {
            throw new CliError(`--${name}: "${String(value)}" is not one of ${definition.choices.join(', ')}`);
        }
    }
    return values;
}

/** The typed options, defaults applied. */
export function parseOptions(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): WebOptions {
    const raw = parseRaw(argv, env);
    const string = (name: OptionName): string | undefined => {
        const value = raw[name] ?? (OPTIONS[name] as OptionDefinition).default;
        return value === undefined ? undefined : String(value);
    };
    const boolean = (name: OptionName): boolean | undefined => {
        const value = raw[name] ?? (OPTIONS[name] as OptionDefinition).default;
        return value === undefined ? undefined : Boolean(value);
    };
    const number = (name: OptionName): number | undefined => {
        const value = raw[name] ?? (OPTIONS[name] as OptionDefinition).default;
        return value === undefined ? undefined : Number(value);
    };
    const logLevel = string('log-level');
    return {
        port: Number(raw['port'] ?? OPTIONS.port.default),
        host: string('host') as string,
        base: string('base') as string,
        dataDir: string('data-dir') ?? defaultDataDir(env),
        uiDir: string('ui-dir'),
        metadataDir: string('metadata-dir'),
        uiDevServer: string('ui-dev-server'),
        token: string('token'),
        auth: boolean('auth') as boolean,
        issueCookie: boolean('issue-cookie'),
        authMode: isAuthMode(string('auth-mode')) ? (string('auth-mode') as AuthMode) : 'token',
        occuliteUrl: string('occulite-url'),
        sessionTtlMs: parseDuration(string('session-ttl') as string, '--session-ttl'),
        ccu: string('ccu'),
        local: boolean('local'),
        callbackIp: string('callback-ip'),
        callbackXmlrpcPort: number('callback-xmlrpc-port'),
        callbackBinrpcPort: number('callback-binrpc-port'),
        demo: boolean('demo') as boolean,
        idleUnsubscribeMs: parseDuration(string('idle-unsubscribe') as string, '--idle-unsubscribe'),
        logLevel: isLogLevel(logLevel) ? logLevel : 'info',
        help: boolean('help') ?? false,
        version: boolean('version') ?? false,
        configSchema: boolean('config-schema') ?? false,
        install: boolean('install') ?? false,
        uninstall: boolean('uninstall') ?? false,
        purge: boolean('purge') ?? false,
        prefix: string('prefix'),
    };
}

/** The `--help` text, generated from the definitions so it can never drift from them. */
export function helpText(binary = 'homematic-manager-web'): string {
    const rows = (Object.entries(OPTIONS) as [OptionName, OptionDefinition][]).map(([name, definition]) => {
        const alias =
            definition.alias === undefined
                ? '    '
                : `${definition.alias.length === 1 ? '-' : '--'}${definition.alias}, `.padStart(4);
        const suffix = definition.type === 'boolean' ? '' : ` <${definition.type}>`;
        return [`${alias}--${name}${suffix}`, definition] as const;
    });
    const width = Math.max(...rows.map(([flag]) => flag.length));
    const lines = rows.map(([flag, definition]) => {
        const extras: string[] = [];
        if (definition.choices) {
            extras.push(`one of: ${definition.choices.join(', ')}`);
        }
        const fallback = definition.defaultDescription ?? (definition.default as string | number | boolean | undefined);
        if (fallback !== undefined && !definition.meta) {
            extras.push(`default: ${String(fallback)}`);
        }
        const tail = extras.length > 0 ? ` (${extras.join('; ')})` : '';
        return `  ${flag.padEnd(width)}  ${definition.describe}${tail}`;
    });
    return [
        `${binary} - the Homematic Manager backend as a local http/websocket server serving the built UI`,
        '',
        `usage: ${binary} [options]`,
        '',
        'options:',
        ...lines,
        '',
        'every option can also be given as an environment variable, e.g. --data-dir is HMM_DATA_DIR,',
        '--no-auth is HMM_AUTH=false. the command line wins over the environment.',
        '',
        'examples:',
        `  ${binary}                              serve the built UI and a backend on 127.0.0.1:8090`,
        `  ${binary} --demo --port 0              the UI on its demo fixture, no backend, a free port`,
        `  ${binary} -a ccu3 --log-level debug    point the backend at a CCU and say what it does`,
        `  ${binary} --base /addons/hmm/ --no-issue-cookie   behind a proxy that issues the token`,
        '',
    ].join('\n');
}

/** The JSON Schema of everything that is a configuration, for a config UI or the addon's CGI. */
export function configSchema(version: string): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(OPTIONS) as [OptionName, OptionDefinition][]) {
        if (definition.meta) {
            continue;
        }
        properties[camelCase(name)] = {
            type: definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'boolean' : 'string',
            description: definition.describe,
            env: envVarName(name),
            ...(definition.choices ? {enum: [...definition.choices]} : {}),
            ...(definition.default === undefined ? {} : {default: definition.default}),
        };
    }
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: `homematic-manager ${version}`,
        type: 'object',
        additionalProperties: false,
        properties,
    };
}
