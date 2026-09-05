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
import {DEFAULT_HOST, DEFAULT_PORT} from './server.js';

/** Prefix of every environment variable: `--data-dir` is `HMM_DATA_DIR`. */
export const ENV_PREFIX = 'HMM';

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
    ccu: {
        alias: 'a',
        type: 'string',
        describe: 'hostname or ip of the CCU; written to the configuration when it differs',
    },
    local: {
        type: 'boolean',
        describe: 'we run on the CCU itself: talk to the interface processes directly (task 13)',
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
    readonly ccu: string | undefined;
    readonly local: boolean | undefined;
    readonly demo: boolean;
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
        ccu: string('ccu'),
        local: boolean('local'),
        demo: boolean('demo') as boolean,
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
        title: `@homematic-manager/web ${version}`,
        type: 'object',
        additionalProperties: false,
        properties,
    };
}
