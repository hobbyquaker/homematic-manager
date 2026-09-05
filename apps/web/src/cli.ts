#!/usr/bin/env node

/**
 * `homematic-manager-web`: start the web host, print where it is, stop it cleanly.
 *
 * The three things that make it usable from a service manager: every option is also an `HMM_*`
 * environment variable, `--config-schema` prints what those options are so a config UI (or the
 * addon's `settings.cgi` in task 13) does not have to hard-code them, and SIGINT/SIGTERM run
 * `backend.stop()` - the de-registration the CCU's interface processes want - with a bound on how
 * long that may take.
 */

import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

import {createWebHost, type WebHost} from './server.js';
import {installService, uninstallService, type InstallerOptions} from './install.js';
import {createLogger, type Logger} from './log.js';
import {CliError, configSchema, helpText, parseOptions, type WebOptions} from './options.js';
import {packageVersion} from './paths.js';

export interface RunCliOptions {
    readonly argv?: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
    readonly write?: (text: string) => void;
    readonly writeError?: (text: string) => void;
    readonly version?: string;
    /** Injected by the tests in place of the real one. */
    readonly start?: (options: WebOptions, log: Logger) => Promise<WebHost>;
    /** Injected by the tests; the real one installs SIGINT/SIGTERM handlers. */
    readonly onSignal?: (handler: () => void) => void;
    /** Injected by the tests; the real one ends the process. */
    readonly exit?: (code: number) => void;
    /** Injected by the tests: a fake root and a stubbed `systemctl` for `--install`. */
    readonly installer?: InstallerOptions;
}

export interface CliRun {
    /** The process exit code. */
    readonly code: number;
    /** `undefined` when the run only printed something. */
    readonly host?: WebHost;
    /** What SIGINT and SIGTERM run; exposed so a test can await the shutdown. */
    readonly stop?: () => Promise<void>;
}

/** Runs the CLI. Returns instead of exiting, so the tests can drive it. */
export async function runCli(options: RunCliOptions = {}): Promise<CliRun> {
    const write = options.write ?? ((text: string) => process.stdout.write(text));
    const writeError = options.writeError ?? ((text: string) => process.stderr.write(text));
    const version = options.version ?? packageVersion();

    let parsed: WebOptions;
    try {
        parsed = parseOptions(options.argv ?? process.argv.slice(2), options.env ?? process.env);
    } catch (error) {
        if (error instanceof CliError) {
            writeError(`${error.message}\nrun with --help for the option list\n`);
            return {code: 1};
        }
        throw error;
    }

    if (parsed.help) {
        write(helpText());
        return {code: 0};
    }
    if (parsed.version) {
        write(`${version}\n`);
        return {code: 0};
    }
    if (parsed.configSchema) {
        write(`${JSON.stringify(configSchema(version), undefined, 2)}\n`);
        return {code: 0};
    }
    if (parsed.install || parsed.uninstall) {
        try {
            const installerOptions = {
                log: (line: string) => write(`${line}\n`),
                ...(parsed.prefix === undefined ? {} : {prefix: parsed.prefix}),
                ...options.installer,
            };
            if (parsed.uninstall) {
                uninstallService({...installerOptions, purge: parsed.purge});
            } else {
                installService(parsed, installerOptions);
            }
            return {code: 0};
        } catch (error) {
            writeError(`${error instanceof Error ? error.message : String(error)}\n`);
            return {code: 1};
        }
    }

    const log = createLogger({level: parsed.logLevel});
    const start = options.start ?? ((values, logger) => startHost(values, logger, version));
    let host: WebHost;
    try {
        host = await start(parsed, log);
    } catch (error) {
        writeError(`${error instanceof Error ? error.message : String(error)}\n`);
        return {code: 1};
    }

    log.info(`homematic-manager-web ${version} on ${host.url}`);
    if (parsed.demo) {
        log.info('demo mode: the UI runs on its fixture, no backend was started');
    } else if (host.token === undefined) {
        log.info('authentication is off (--no-auth): every client of this port may talk to the backend');
    } else {
        log.info(`token ${host.token}`);
        log.debug(`a client without a cookie can use ${host.url}?token=${host.token}`);
    }
    if (parsed.uiDevServer !== undefined) {
        log.info(`development mode: everything but the api is proxied to ${parsed.uiDevServer}`);
    }

    const exit = options.exit ?? ((code: number) => process.exit(code));
    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
        stopping ??= (async (): Promise<void> => {
            log.info('shutting down');
            try {
                await host.close();
                exit(0);
            } catch (error) {
                log.error('shutdown failed:', error);
                exit(1);
            }
        })();
        return stopping;
    };
    const onSignal =
        options.onSignal ??
        ((handler: () => void): void => {
            process.on('SIGINT', handler);
            process.on('SIGTERM', handler);
        });
    onSignal(() => void stop());

    return {code: 0, host, stop};
}

function startHost(values: WebOptions, log: Logger, version: string): Promise<WebHost> {
    return createWebHost({
        port: values.port,
        host: values.host,
        base: values.base,
        dataDir: values.dataDir,
        demo: values.demo,
        auth: values.auth,
        log,
        version,
        ...(values.uiDir === undefined ? {} : {uiDir: values.uiDir}),
        ...(values.metadataDir === undefined ? {} : {metadataDir: values.metadataDir}),
        ...(values.uiDevServer === undefined ? {} : {uiDevServer: values.uiDevServer}),
        ...(values.token === undefined ? {} : {token: values.token}),
        ...(values.issueCookie === undefined ? {} : {issueCookie: values.issueCookie}),
        ...(values.ccu === undefined ? {} : {ccu: values.ccu}),
        ...(values.local === undefined ? {} : {local: values.local}),
        ...(values.callbackIp === undefined ? {} : {callbackIp: values.callbackIp}),
        ...(values.callbackXmlrpcPort === undefined ? {} : {callbackXmlrpcPort: values.callbackXmlrpcPort}),
        ...(values.callbackBinrpcPort === undefined ? {} : {callbackBinrpcPort: values.callbackBinrpcPort}),
    });
}

/** Was this file started, or only imported? The tests and `dev.ts` import it. */
export function isMainModule(url: string, argv1: string | undefined): boolean {
    if (argv1 === undefined) {
        return false;
    }
    try {
        // realpath because npm installs the bin as a symlink, and `import.meta.url` is the target
        return pathToFileURL(realpathSync(argv1)).href === url;
    } catch {
        return false;
    }
}

if (isMainModule(import.meta.url, process.argv[1])) {
    const run = await runCli();
    if (run.code !== 0 || run.host === undefined) {
        process.exit(run.code);
    }
}
