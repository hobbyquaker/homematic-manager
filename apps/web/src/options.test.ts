import {describe, expect, it} from 'vitest';

import {
    camelCase,
    CliError,
    coerce,
    configSchema,
    envVarName,
    helpText,
    OPTIONS,
    parseDuration,
    parseOptions,
} from './options.js';

const noEnv: NodeJS.ProcessEnv = {HOME: '/home/tester'};

describe('envVarName and camelCase', () => {
    it('map an option name to its two other spellings', () => {
        expect(envVarName('data-dir')).toBe('HMM_DATA_DIR');
        expect(envVarName('port')).toBe('HMM_PORT');
        expect(envVarName('port', 'OTHER')).toBe('OTHER_PORT');
        expect(camelCase('ui-dev-server')).toBe('uiDevServer');
        expect(camelCase('port')).toBe('port');
    });
});

describe('coerce', () => {
    it('reads the boolean spellings a service file uses', () => {
        for (const value of ['1', 'true', 'YES', ' on ']) {
            expect(coerce(value, 'boolean', 'x'), value).toBe(true);
        }
        for (const value of ['0', 'false', 'no', 'off', '']) {
            expect(coerce(value, 'boolean', 'x'), value).toBe(false);
        }
        expect(() => coerce('maybe', 'boolean', 'HMM_AUTH')).toThrow(CliError);
    });

    it('reads numbers and refuses what is not one', () => {
        expect(coerce('8090', 'number', 'x')).toBe(8090);
        expect(() => coerce('eight', 'number', '--port')).toThrow(/not a number/);
    });

    it('leaves strings alone', () => {
        expect(coerce('ccu3', 'string', 'x')).toBe('ccu3');
    });
});

describe('parseOptions', () => {
    it('has the defaults the README documents', () => {
        const values = parseOptions([], noEnv);
        expect(values.port).toBe(8090);
        expect(values.host).toBe('127.0.0.1');
        expect(values.base).toBe('/');
        expect(values.auth).toBe(true);
        expect(values.demo).toBe(false);
        expect(values.logLevel).toBe('info');
        expect(values.dataDir).toContain('homematic-manager');
        expect(values.issueCookie).toBeUndefined();
        expect(values.local).toBeUndefined();
        expect(values.token).toBeUndefined();
    });

    it('reads the callback address a container behind NAT has to be told', () => {
        const values = parseOptions(['--callback-ip', '192.168.1.10', '--callback-xmlrpc-port=2126'], {
            ...noEnv,
            HMM_CALLBACK_BINRPC_PORT: '2127',
        });
        expect(values.callbackIp).toBe('192.168.1.10');
        expect(values.callbackXmlrpcPort).toBe(2126);
        expect(values.callbackBinrpcPort).toBe(2127);
        const none = parseOptions([], noEnv);
        expect(none.callbackIp).toBeUndefined();
        expect(none.callbackXmlrpcPort).toBeUndefined();
    });

    it('reads long options with a space and with an equals sign', () => {
        expect(parseOptions(['--port', '9000'], noEnv).port).toBe(9000);
        expect(parseOptions(['--port=9000'], noEnv).port).toBe(9000);
        expect(parseOptions(['--base=/addons/hmm/'], noEnv).base).toBe('/addons/hmm/');
    });

    it('reads the aliases', () => {
        expect(parseOptions(['-p', '0'], noEnv).port).toBe(0);
        expect(parseOptions(['-a', 'ccu3'], noEnv).ccu).toBe('ccu3');
        expect(parseOptions(['-h'], noEnv).help).toBe(true);
    });

    it('reads booleans, their negation and an explicit value', () => {
        expect(parseOptions(['--demo'], noEnv).demo).toBe(true);
        expect(parseOptions(['--no-auth'], noEnv).auth).toBe(false);
        expect(parseOptions(['--no-issue-cookie'], noEnv).issueCookie).toBe(false);
        expect(parseOptions(['--issue-cookie'], noEnv).issueCookie).toBe(true);
        expect(parseOptions(['--auth=false'], noEnv).auth).toBe(false);
        expect(parseOptions(['--local'], noEnv).local).toBe(true);
    });

    it('reads every option from the environment too', () => {
        const values = parseOptions([], {
            ...noEnv,
            HMM_PORT: '8100',
            HMM_HOST: '0.0.0.0',
            HMM_DATA_DIR: '/var/lib/hmm',
            HMM_AUTH: 'false',
            HMM_LOG_LEVEL: 'debug',
            HMM_UI_DEV_SERVER: 'http://127.0.0.1:5173',
        });
        expect(values).toMatchObject({
            port: 8100,
            host: '0.0.0.0',
            dataDir: '/var/lib/hmm',
            auth: false,
            logLevel: 'debug',
            uiDevServer: 'http://127.0.0.1:5173',
        });
    });

    it('lets the command line win over the environment', () => {
        const values = parseOptions(['--port', '1234', '--auth'], {...noEnv, HMM_PORT: '8100', HMM_AUTH: 'false'});
        expect(values.port).toBe(1234);
        expect(values.auth).toBe(true);
    });

    it('refuses an unknown option, a missing value and a positional argument', () => {
        expect(() => parseOptions(['--nope'], noEnv)).toThrow(/unknown option/);
        expect(() => parseOptions(['--port'], noEnv)).toThrow(/needs a value/);
        expect(() => parseOptions(['--port', '--demo'], noEnv)).toThrow(/needs a value/);
        expect(() => parseOptions(['serve'], noEnv)).toThrow(/unexpected argument/);
        expect(() => parseOptions(['--no-port'], noEnv)).toThrow(/not a boolean option/);
    });

    it('refuses a value that is not one of the choices', () => {
        expect(() => parseOptions(['--log-level', 'verbose'], noEnv)).toThrow(/is not one of/);
        expect(() => parseOptions([], {...noEnv, HMM_LOG_LEVEL: 'chatty'})).toThrow(/is not one of/);
    });
});

describe('helpText', () => {
    it('lists every option, its default and how to set it from the environment', () => {
        const text = helpText();
        for (const name of Object.keys(OPTIONS)) {
            expect(text, name).toContain(`--${name}`);
        }
        expect(text).toContain('default: 8090');
        expect(text).toContain('one of: error, warn, info, debug');
        expect(text).toContain('HMM_DATA_DIR');
        expect(helpText('hmm-web')).toContain('usage: hmm-web [options]');
    });
});

describe('configSchema', () => {
    it('describes the configuration options and leaves the meta ones out', () => {
        const schema = configSchema('3.0.0-dev.0') as {properties: Record<string, Record<string, unknown>>};
        expect(schema.properties['dataDir']).toMatchObject({type: 'string', env: 'HMM_DATA_DIR'});
        expect(schema.properties['port']).toMatchObject({type: 'number', default: 8090});
        expect(schema.properties['logLevel']).toMatchObject({enum: ['error', 'warn', 'info', 'debug']});
        expect(schema.properties['help']).toBeUndefined();
        expect(schema.properties['configSchema']).toBeUndefined();
        expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    });
});

describe('--auth-mode and --session-ttl (D-32)', () => {
    it('is token by default: nothing changes for anybody who does not ask for the login', () => {
        expect(parseOptions([], noEnv).authMode).toBe('token');
        expect(parseOptions([], noEnv).sessionTtlMs).toBe(24 * 3_600_000);
    });

    it('takes the mode from the command line and from the environment', () => {
        expect(parseOptions(['--auth-mode', 'rega'], noEnv).authMode).toBe('rega');
        expect(parseOptions([], {...noEnv, HMM_AUTH_MODE: 'rega'}).authMode).toBe('rega');
        // the addon's etc/hmm.env is the environment, and the rc.d command line wins over it
        expect(parseOptions(['--auth-mode', 'token'], {...noEnv, HMM_AUTH_MODE: 'rega'}).authMode).toBe('token');
    });

    it('refuses a mode that does not exist rather than falling back to one', () => {
        expect(() => parseOptions(['--auth-mode', 'oauth'], noEnv)).toThrow(CliError);
        expect(() => parseOptions(['--auth-mode', 'oauth'], noEnv)).toThrow(/token, rega/);
    });

    it('takes the session lifetime as a duration', () => {
        expect(parseOptions(['--session-ttl', '30m'], noEnv).sessionTtlMs).toBe(1_800_000);
        expect(parseOptions([], {...noEnv, HMM_SESSION_TTL: '2h'}).sessionTtlMs).toBe(7_200_000);
        expect(() => parseOptions(['--session-ttl', 'a while'], noEnv)).toThrow(/not a duration/);
    });
});

describe('parseDuration and --idle-unsubscribe (D-31)', () => {
    it('reads the four spellings the addon and the compose file use', () => {
        expect(parseDuration('5m', 'x')).toBe(300_000);
        expect(parseDuration('300s', 'x')).toBe(300_000);
        expect(parseDuration('90', 'x')).toBe(90_000);
        expect(parseDuration(' 1h ', 'x')).toBe(3_600_000);
        expect(parseDuration('250ms', 'x')).toBe(250);
        expect(parseDuration('0', 'x')).toBe(0);
    });

    it('is a usage error rather than a silently disabled feature', () => {
        expect(() => parseDuration('five minutes', '--idle-unsubscribe')).toThrow(CliError);
        expect(() => parseDuration('-1', '--idle-unsubscribe')).toThrow(/not a duration/);
        expect(() => parseDuration('5 days', '--idle-unsubscribe')).toThrow(/not a duration/);
    });

    it('defaults to five minutes for every server install type, and 0 turns it off', () => {
        expect(parseOptions([], noEnv).idleUnsubscribeMs).toBe(300_000);
        expect(parseOptions(['--idle-unsubscribe', '30s'], noEnv).idleUnsubscribeMs).toBe(30_000);
        expect(parseOptions([], {...noEnv, HMM_IDLE_UNSUBSCRIBE: '2m'}).idleUnsubscribeMs).toBe(120_000);
        expect(parseOptions(['--idle-unsubscribe', '0'], noEnv).idleUnsubscribeMs).toBe(0);
        // the command line wins over the environment, as everywhere else
        expect(
            parseOptions(['--idle-unsubscribe', '0'], {...noEnv, HMM_IDLE_UNSUBSCRIBE: '9m'}).idleUnsubscribeMs,
        ).toBe(0);
    });
});
