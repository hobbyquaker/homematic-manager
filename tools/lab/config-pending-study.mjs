#!/usr/bin/env node
/**
 * The CONFIG_PENDING study of roadmap task 6, as a repeatable script.
 *
 * It provokes bad `putParamset` calls on a single device on purpose, records what the interface
 * process answers, whether `CONFIG_PENDING` appears and which recovery clears it again. Everything
 * it needs about the target comes from the command line: this file contains no address, no alias
 * and no credential, and it never writes to more than the one device it was given.
 *
 * Safety rails that are not optional:
 *
 * - `baseline` has to run first; every provoking step refuses to start without the baseline dump,
 *   because the dump is what `restore` writes back.
 * - only the address given with `--device` (and its channels) is ever written to.
 * - the central `HM-RCV-50` / `HmIP-RCV-50` channels of the CCU itself are refused outright.
 * - `--dry-run` prints every call it would make and makes none.
 *
 * Usage (one target at a time):
 *
 *   node tools/lab/config-pending-study.mjs --host <ccu> --interface HmIP-RF \
 *       --device ABC0000001 --channel 1 --out ~/lab-results/hmm-task6 --ssh <ssh-alias> baseline
 *   ... rewrite
 *   ... provoke --case a
 *   ... recover --recovery fullwrite
 *   ... restore
 *
 * Steps: `baseline`, `rewrite`, `provoke`, `recover`, `poll`, `extras`, `restore`, `dump-devices`.
 */

import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {promisify} from 'node:util';

const require = createRequire(import.meta.url);
const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');
const execFileAsync = promisify(execFile);

/** The interfaces this script knows how to reach, mirrored from `packages/core/src/interfaces/table.ts`. */
const INTERFACES = {
    'BidCos-RF': {port: 2001, protocol: 'xmlrpc'},
    'BidCos-Wired': {port: 2000, protocol: 'xmlrpc'},
    'HmIP-RF': {port: 2010, protocol: 'xmlrpc'},
    VirtualDevices: {port: 9292, protocol: 'xmlrpc', path: '/groups'},
    CUxD: {port: 8701, protocol: 'binrpc'},
};

/** Never write to the interface process' own central control unit channel. */
const FORBIDDEN_PREFIXES = ['BidCoS-RF', 'HM-RCV-50', 'HmIP-RCV-50', 'BidCoS-Wir'];

/** Log files the study reads over ssh; a box that has none is simply skipped. */
const LOG_FILES = ['/var/log/messages', '/var/log/hmserver.log'];

const USAGE = `config-pending-study.mjs [options] <step>

steps
  baseline        dump listDevices entry, every paramset description and paramset, service
                  messages and the log tails; writes the file every other step needs
  rewrite         valid full re-write of the baseline MASTER (the control: does a no-change
                  full write raise CONFIG_PENDING?)
  provoke         one deliberate bad write, see --case
  recover         one recovery attempt, see --recovery
  poll            just watch CONFIG_PENDING / service messages for --poll-seconds
  extras          the read-only extra checks (LINK description per peer, link names, SPECIALs)
  faults          probe the interface process' fault codes with calls that change nothing
  special         write every SPECIAL value of the baseline and read it back (A-5)
  umlaut          write an umlaut string as device metadata and read it back over both
                  protocols (--other-port for the second one)
  link-umlaut     setLinkInfo with an umlaut, read back over both protocols (needs --peer)
  restore         write the baseline MASTER back
  dump-devices    listDevices of the interface, anonymised, for the simulator fixtures

options
  --host <host>            CCU address (required)
  --interface <name>       ${Object.keys(INTERFACES).join(' | ')}
  --port <n>               override the interface port
  --protocol <xmlrpc|binrpc>
  --tls                    use the +40000 TLS port
  --user <u> --password <p>  basic auth, if the CCU asks for it
  --device <address>       device address without channel (required except for dump-devices)
  --channel <n>            channel the MASTER paramset is written on; omit for the device paramset
  --peer <address>         peer channel for the link checks
  --case <a..h|custom>     which provocation, see below
  --param <name>           parameter to use instead of the automatically chosen one
  --value <json>           value for --case custom / --case f
  --recovery <name>        fullwrite | clearConfigCache | clearConfigCacheChannel |
                           restoreConfigToDevice | restoreConfigToChannel |
                           determineParameter | relink | wait
  --poll-seconds <n>       default 90
  --poll-interval <n>      seconds between polls, default 5
  --out <dir>              results directory (outside the repository!), default ./lab-results
  --label <name>           sub-directory inside --out, default <interface>-<device>
  --ssh <alias>            ssh alias of the CCU for the log tails; omitted = no logs
  --timeout <ms>           RPC timeout, default 20000
  --dry-run                print what would be sent, send nothing
  --yes                    required for the writing steps unless --dry-run

provocation cases
  a  unknown parameter name
  b  known parameter below MIN / above MAX
  c  wrong type (string for INTEGER, integer for BOOL)
  d  ENUM as name (--enum name) and as index (--enum index)
  e  a SPECIAL value outside MIN..MAX
  f  a parameter of a different device type with the same channel type (--param/--value)
  g  FLOAT sent as an explicit double vs. as a plain integer (--float double|int)
  h  an empty struct
`;

function parseArgs(argv) {
    const options = {
        pollSeconds: 90,
        pollInterval: 5,
        out: 'lab-results',
        timeout: 20_000,
    };
    const rest = [];
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => argv[(index += 1)];
        switch (argument) {
            case '--host':
                options.host = next();
                break;
            case '--interface':
                options.interfaceName = next();
                break;
            case '--port':
                options.port = Number(next());
                break;
            case '--protocol':
                options.protocol = next();
                break;
            case '--tls':
                options.tls = true;
                break;
            case '--user':
                options.user = next();
                break;
            case '--password':
                options.password = next();
                break;
            case '--device':
                options.device = next();
                break;
            case '--channel':
                options.channel = next();
                break;
            case '--peer':
                options.peer = next();
                break;
            case '--other-port':
                options.otherProtocolPort = Number(next());
                break;
            case '--case':
                options.case = next();
                break;
            case '--param':
                options.param = next();
                break;
            case '--value':
                options.value = next();
                break;
            case '--enum':
                options.enumAs = next();
                break;
            case '--float':
                options.floatAs = next();
                break;
            case '--recovery':
                options.recovery = next();
                break;
            case '--poll-seconds':
                options.pollSeconds = Number(next());
                break;
            case '--poll-interval':
                options.pollInterval = Number(next());
                break;
            case '--out':
                options.out = next();
                break;
            case '--label':
                options.label = next();
                break;
            case '--ssh':
                options.ssh = next();
                break;
            case '--timeout':
                options.timeout = Number(next());
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--yes':
                options.yes = true;
                break;
            case '-h':
            case '--help':
                options.help = true;
                break;
            default:
                rest.push(argument);
        }
    }
    options.step = rest[0];
    return options;
}

/* ------------------------------------------------------------------ RPC */

class Rpc {
    constructor(options) {
        const definition = INTERFACES[options.interfaceName] ?? {};
        this.protocol = options.protocol ?? definition.protocol ?? 'xmlrpc';
        this.port = options.port ?? (options.tls ? (definition.port ?? 0) + 40_000 : definition.port);
        this.host = options.host;
        this.path = definition.path ?? '/';
        this.timeout = options.timeout;
        this.dryRun = options.dryRun === true;
        this.calls = [];
        if (!this.host || !this.port) {
            throw new Error('--host and an --interface (or --port) are required');
        }
        if (this.protocol === 'binrpc') {
            this.client = binrpc.createClient({host: this.host, port: this.port, responseTimeout: this.timeout});
        } else {
            const clientOptions = {
                host: this.host,
                port: this.port,
                path: this.path,
                responseEncoding: 'latin1',
                rejectUnauthorized: false,
                ...(options.user ? {basic_auth: {user: options.user, pass: options.password ?? ''}} : {}),
            };
            this.client = options.tls ? xmlrpc.createSecureClient(clientOptions) : xmlrpc.createClient(clientOptions);
        }
    }

    /** One call; a fault becomes `{ok: false, faultCode, faultString}` instead of an exception. */
    async call(method, params = [], {write = false} = {}) {
        const started = Date.now();
        if (write && this.dryRun) {
            const record = {method, params, dryRun: true, ok: null, at: new Date().toISOString()};
            this.calls.push(record);
            console.log(`DRY-RUN would send ${method} ${JSON.stringify(params)}`);
            return record;
        }
        const record = await new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ok: false, error: `timeout after ${this.timeout} ms`});
                }
            }, this.timeout);
            this.client.methodCall(method, params, (error, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                if (error) {
                    resolve({
                        ok: false,
                        error: error.message,
                        ...(error.faultCode === undefined ? {} : {faultCode: error.faultCode}),
                        ...(error.faultString === undefined ? {} : {faultString: error.faultString}),
                    });
                    return;
                }
                // binrpc decodes a fault (type 0xff) into an ordinary struct, so look for it
                if (value && typeof value === 'object' && !Array.isArray(value) && value.faultCode !== undefined) {
                    resolve({ok: false, faultCode: value.faultCode, faultString: value.faultString, error: 'fault'});
                    return;
                }
                resolve({ok: true, result: value});
            });
        });
        const full = {method, params, ...record, durationMs: Date.now() - started, at: new Date().toISOString()};
        this.calls.push(full);
        const summary = full.ok
            ? 'ok'
            : `FAULT ${full.faultCode ?? '-'} ${JSON.stringify(full.faultString ?? full.error)}`;
        console.log(`  ${method}(${params.map(short).join(', ')}) -> ${summary} [${full.durationMs} ms]`);
        return full;
    }

    close() {
        if (this.protocol === 'binrpc' && this.client.socket) {
            this.client.socket.removeAllListeners();
            this.client.socket.on('error', () => undefined);
            this.client.socket.destroy();
            this.client.connect = () => undefined;
        }
    }
}

function short(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

/* ------------------------------------------------------------------ logs */

class LogTail {
    constructor(alias) {
        this.alias = alias;
        this.marks = {};
    }

    async #ssh(command) {
        if (!this.alias) {
            return '';
        }
        try {
            const {stdout} = await execFileAsync('ssh', ['-n', '-o', 'ConnectTimeout=8', this.alias, command], {
                maxBuffer: 8 * 1024 * 1024,
            });
            return stdout;
        } catch (error) {
            return `ssh failed: ${error.message}`;
        }
    }

    /** Remembers the current length of every log file. */
    async mark() {
        if (!this.alias) {
            return;
        }
        for (const file of LOG_FILES) {
            const out = await this.#ssh(`wc -l < ${file} 2>/dev/null || echo 0`);
            this.marks[file] = Number.parseInt(out.trim(), 10) || 0;
        }
    }

    /** Everything the log files gained since the last {@link mark}. */
    async since() {
        if (!this.alias) {
            return {skipped: 'no --ssh alias given'};
        }
        const result = {};
        for (const file of LOG_FILES) {
            const from = (this.marks[file] ?? 0) + 1;
            const out = await this.#ssh(`sed -n '${from},$p' ${file} 2>/dev/null | tail -n 400`);
            result[file] = out.split('\n').filter((line) => line.trim() !== '');
        }
        return result;
    }
}

/* ------------------------------------------------------------------ helpers */

function isForbidden(address) {
    return FORBIDDEN_PREFIXES.some((prefix) => address.toUpperCase().startsWith(prefix.toUpperCase()));
}

function targetAddress(options) {
    return options.channel === undefined ? options.device : `${options.device}:${options.channel}`;
}

async function resultDir(options) {
    const label = options.label ?? `${options.interfaceName ?? 'iface'}-${options.device ?? 'device'}`;
    const dir = path.resolve(options.out, label);
    await mkdir(dir, {recursive: true});
    return dir;
}

async function save(dir, name, data) {
    const file = path.join(dir, name);
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    console.log(`  -> ${file}`);
    return file;
}

async function loadBaseline(dir) {
    try {
        return JSON.parse(await readFile(path.join(dir, 'baseline.json'), 'utf8'));
    } catch {
        throw new Error(`no baseline.json in the result directory - run the "baseline" step first`);
    }
}

/** Everything that is writeable in a description (`OPERATIONS & 2`). */
function writeable(description) {
    return Object.entries(description).filter(([, parameter]) => (Number(parameter.OPERATIONS) & 2) === 2);
}

function pick(description, predicate, preferred) {
    const entries = writeable(description);
    if (preferred) {
        const found = entries.find(([name]) => name === preferred);
        if (found) {
            return found;
        }
    }
    return entries.find(([name, parameter]) => predicate(parameter, name));
}

/** Polls `CONFIG_PENDING` on `:0` and the service messages until they stop changing. */
async function watch(rpc, options, device, seconds) {
    const samples = [];
    const until = Date.now() + seconds * 1000;
    let round = 0;
    while (Date.now() <= until) {
        const values = await rpc.call('getParamset', [`${device}:0`, 'VALUES']);
        const messages = await rpc.call('getServiceMessages', []);
        const sample = {
            at: new Date().toISOString(),
            elapsedSeconds: round * options.pollInterval,
            configPending: values.ok ? (values.result?.CONFIG_PENDING ?? null) : `error: ${values.error}`,
            unreach: values.ok ? (values.result?.UNREACH ?? null) : null,
            updatePending: values.ok ? (values.result?.UPDATE_PENDING ?? null) : null,
            // rfd answers an *empty string* instead of an empty array when there is no service
            // message at all - measured in the lab, task 6; hmipserver answers an empty array
            deviceInMessages: !messages.ok
                ? `error: ${messages.error}`
                : Array.isArray(messages.result)
                  ? messages.result.filter((entry) => String(entry?.[0] ?? '').startsWith(device))
                  : [],
        };
        samples.push(sample);
        console.log(
            `  t+${sample.elapsedSeconds}s CONFIG_PENDING=${sample.configPending} UNREACH=${sample.unreach}` +
                ` messages=${Array.isArray(sample.deviceInMessages) ? sample.deviceInMessages.length : '?'}`,
        );
        round += 1;
        if (Date.now() + options.pollInterval * 1000 > until) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, options.pollInterval * 1000));
    }
    return samples;
}

/* ------------------------------------------------------------------ steps */

async function stepBaseline(rpc, options, dir, logs) {
    await logs.mark();
    const device = options.device;
    const listed = await rpc.call('listDevices', []);
    const entries = (listed.result ?? []).filter(
        (entry) => entry.ADDRESS === device || String(entry.ADDRESS ?? '').startsWith(`${device}:`),
    );
    const paramsets = {};
    for (const entry of entries) {
        for (const name of entry.PARAMSETS ?? []) {
            if (name === 'LINK') {
                continue; // a LINK paramset needs a peer, see the "extras" step
            }
            const key = `${entry.ADDRESS}/${name}`;
            paramsets[key] = {
                description: await rpc.call('getParamsetDescription', [entry.ADDRESS, name]),
                values: await rpc.call('getParamset', [entry.ADDRESS, name]),
            };
        }
    }
    const baseline = {
        at: new Date().toISOString(),
        host: '<given on the command line>',
        interface: options.interfaceName,
        device,
        target: targetAddress(options),
        devices: entries,
        paramsets,
        serviceMessages: await rpc.call('getServiceMessages', []),
        links: await rpc.call('getLinks', [device, 0]),
        logs: await logs.since(),
    };
    await save(dir, 'baseline.json', baseline);
    const target = targetAddress(options);
    const master = paramsets[`${target}/MASTER`];
    if (master?.values?.ok) {
        console.log(`  MASTER of ${target}: ${Object.keys(master.values.result).length} parameters`);
    } else {
        console.log(`  WARNING: no MASTER paramset read for ${target}`);
    }
    return baseline;
}

/** The values of the baseline MASTER, as a struct ready to be written back. */
function baselineMaster(baseline, target) {
    const entry = baseline.paramsets[`${target}/MASTER`];
    if (!entry?.values?.ok || !entry.description?.ok) {
        throw new Error(`the baseline has no readable MASTER for ${target}`);
    }
    const description = entry.description.result;
    const values = {};
    for (const [name, value] of Object.entries(entry.values.result)) {
        const parameter = description[name];
        if (!parameter || (Number(parameter.OPERATIONS) & 2) !== 2) {
            continue;
        }
        values[name] = parameter.TYPE === 'FLOAT' ? {explicitDouble: Number(value)} : value;
    }
    return {description, values};
}

async function stepRewrite(rpc, options, dir, logs) {
    const baseline = await loadBaseline(dir);
    const target = targetAddress(options);
    const {values} = baselineMaster(baseline, target);
    console.log(`  writing all ${Object.keys(values).length} writeable MASTER parameters unchanged`);
    await logs.mark();
    const answer = await rpc.call('putParamset', [target, 'MASTER', values], {write: true});
    const samples = options.dryRun ? [] : await watch(rpc, options, options.device, options.pollSeconds);
    const after = options.dryRun ? null : await rpc.call('getParamset', [target, 'MASTER']);
    const record = {
        at: new Date().toISOString(),
        step: 'rewrite',
        target,
        sent: values,
        answer,
        samples,
        masterAfter: after,
        logs: await logs.since(),
    };
    await save(dir, `rewrite-${Date.now()}.json`, record);
    return record;
}

/** Builds the payload of one provocation from the target's own MASTER description. */
function provocation(options, description, current) {
    const chosen = options.param;
    switch (options.case) {
        case 'a': {
            return {
                name: 'a-unknown-parameter',
                note: 'a parameter name the description does not contain',
                values: {HMM_LAB_NO_SUCH_PARAM: 1},
            };
        }
        case 'b': {
            const entry = pick(
                description,
                (parameter) =>
                    (parameter.TYPE === 'INTEGER' || parameter.TYPE === 'FLOAT') &&
                    Number.isFinite(Number(parameter.MAX)) &&
                    Number(parameter.MAX) > Number(parameter.MIN),
                chosen,
            );
            if (!entry) {
                throw new Error('no writeable numeric parameter with a MAX in this description');
            }
            const [name, parameter] = entry;
            const value = Number(parameter.MAX) + Math.max(1, Number(parameter.MAX) - Number(parameter.MIN));
            return {
                name: 'b-out-of-range',
                note: `${name} MIN ${parameter.MIN} MAX ${parameter.MAX}, sending ${value}`,
                values: {[name]: parameter.TYPE === 'FLOAT' ? {explicitDouble: value} : Math.round(value)},
                parameter: name,
                description: parameter,
            };
        }
        case 'c': {
            const integer = pick(description, (parameter) => parameter.TYPE === 'INTEGER', chosen);
            const boolean = pick(description, (parameter) => parameter.TYPE === 'BOOL');
            if (integer) {
                return {
                    name: 'c-wrong-type-string-for-integer',
                    note: `${integer[0]} is INTEGER, sending the string "not-a-number"`,
                    values: {[integer[0]]: 'not-a-number'},
                    parameter: integer[0],
                    description: integer[1],
                };
            }
            if (boolean) {
                return {
                    name: 'c-wrong-type-integer-for-bool',
                    note: `${boolean[0]} is BOOL, sending the integer 1`,
                    values: {[boolean[0]]: 1},
                    parameter: boolean[0],
                    description: boolean[1],
                };
            }
            throw new Error('no writeable INTEGER or BOOL parameter in this description');
        }
        case 'c-bool': {
            const boolean = pick(description, (parameter) => parameter.TYPE === 'BOOL', chosen);
            if (!boolean) {
                throw new Error('no writeable BOOL parameter in this description');
            }
            return {
                name: 'c-wrong-type-integer-for-bool',
                note: `${boolean[0]} is BOOL, sending the integer 1`,
                values: {[boolean[0]]: 1},
                parameter: boolean[0],
                description: boolean[1],
            };
        }
        case 'd': {
            const entry = pick(
                description,
                (parameter) => parameter.TYPE === 'ENUM' && Array.isArray(parameter.VALUE_LIST),
                chosen,
            );
            if (!entry) {
                throw new Error('no writeable ENUM parameter in this description');
            }
            const [name, parameter] = entry;
            const currentIndex = Number(current?.[name] ?? parameter.DEFAULT ?? 0);
            const asName = options.enumAs !== 'index';
            return {
                name: asName ? 'd-enum-as-name' : 'd-enum-as-index',
                note: `${name} VALUE_LIST ${JSON.stringify(parameter.VALUE_LIST)}, current index ${currentIndex}`,
                values: {[name]: asName ? parameter.VALUE_LIST[currentIndex] : currentIndex},
                parameter: name,
                description: parameter,
            };
        }
        case 'e': {
            const entry = pick(
                description,
                (parameter) => Array.isArray(parameter.SPECIAL) && parameter.SPECIAL.length > 0,
                chosen,
            );
            if (!entry) {
                throw new Error('no writeable parameter with a SPECIAL entry in this description');
            }
            const [name, parameter] = entry;
            const special = parameter.SPECIAL[0];
            return {
                name: 'e-special-value',
                note: `${name} MIN ${parameter.MIN} MAX ${parameter.MAX}, SPECIAL ${special.ID} = ${special.VALUE}`,
                values: {
                    [name]: parameter.TYPE === 'FLOAT' ? {explicitDouble: Number(special.VALUE)} : special.VALUE,
                },
                parameter: name,
                description: parameter,
            };
        }
        case 'f': {
            if (!chosen) {
                throw new Error('--case f needs --param <name of the other device type> and --value <json>');
            }
            return {
                name: 'f-foreign-parameter',
                note: `${chosen} exists on another device type with the same channel type`,
                values: {[chosen]: JSON.parse(options.value ?? '1')},
                parameter: chosen,
            };
        }
        case 'g': {
            const entry = pick(description, (parameter) => parameter.TYPE === 'FLOAT', chosen);
            if (!entry) {
                throw new Error('no writeable FLOAT parameter in this description');
            }
            const [name, parameter] = entry;
            const value =
                options.value === undefined
                    ? Number(current?.[name] ?? parameter.DEFAULT ?? parameter.MIN ?? 0)
                    : Number(options.value);
            const asDouble = options.floatAs !== 'int';
            return {
                name: asDouble ? 'g-float-explicit-double' : 'g-float-plain-int',
                note: `${name} is FLOAT, current ${value}, sending ${asDouble ? 'explicitDouble' : 'a plain integer'}`,
                values: {[name]: asDouble ? {explicitDouble: value} : Math.round(value)},
                parameter: name,
                description: parameter,
            };
        }
        case 'h': {
            return {name: 'h-empty-struct', note: 'putParamset with an empty struct', values: {}};
        }
        case 'custom': {
            if (!chosen) {
                throw new Error('--case custom needs --param and --value');
            }
            return {
                name: `custom-${chosen}`,
                note: 'a value given on the command line',
                values: {[chosen]: JSON.parse(options.value ?? 'null')},
                parameter: chosen,
            };
        }
        default:
            throw new Error(`unknown --case ${options.case}`);
    }
}

async function stepProvoke(rpc, options, dir, logs) {
    const baseline = await loadBaseline(dir);
    const target = targetAddress(options);
    const entry = baseline.paramsets[`${target}/MASTER`];
    if (!entry?.description?.ok) {
        throw new Error(`the baseline has no MASTER description for ${target}`);
    }
    const built = provocation(options, entry.description.result, entry.values?.result ?? {});
    console.log(`  ${built.name}: ${built.note}`);
    await logs.mark();
    const answer = await rpc.call('putParamset', [target, 'MASTER', built.values], {write: true});
    const samples = options.dryRun ? [] : await watch(rpc, options, options.device, options.pollSeconds);
    const after = options.dryRun ? null : await rpc.call('getParamset', [target, 'MASTER']);
    const record = {
        at: new Date().toISOString(),
        step: 'provoke',
        case: options.case,
        target,
        provocation: built,
        answer,
        samples,
        masterAfter: after,
        logs: await logs.since(),
    };
    await save(dir, `provoke-${built.name}-${Date.now()}.json`, record);
    return record;
}

async function stepRecover(rpc, options, dir, logs) {
    const baseline = await loadBaseline(dir);
    const target = targetAddress(options);
    await logs.mark();
    let answer;
    switch (options.recovery) {
        case 'fullwrite': {
            const {values} = baselineMaster(baseline, target);
            answer = await rpc.call('putParamset', [target, 'MASTER', values], {write: true});
            break;
        }
        case 'clearConfigCache':
            answer = await rpc.call('clearConfigCache', [options.device], {write: true});
            break;
        case 'restoreConfigToDevice':
            answer = await rpc.call('restoreConfigToDevice', [options.device], {write: true});
            break;
        case 'clearConfigCacheChannel':
            answer = await rpc.call('clearConfigCache', [target], {write: true});
            break;
        case 'restoreConfigToChannel':
            answer = await rpc.call('restoreConfigToDevice', [target], {write: true});
            break;
        case 'determineParameter': {
            // asks the interface process to read one parameter back from the device; if it
            // refreshes the whole stored paramset it would also drop a parameter the device
            // does not have
            const {description} = baselineMaster(baseline, target);
            const parameter = options.param ?? Object.keys(description)[0];
            answer = await rpc.call('determineParameter', [target, 'MASTER', parameter], {write: true});
            break;
        }
        case 'relink': {
            // add and remove a link: the interface process rebuilds the channel's configuration
            if (!options.peer) {
                throw new Error('--recovery relink needs --peer <sender channel>');
            }
            const added = await rpc.call('addLink', [options.peer, target, 'hmm-task6', 'lab recovery probe'], {
                write: true,
            });
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            const removed = await rpc.call('removeLink', [options.peer, target], {write: true});
            answer = {added, removed};
            break;
        }
        case 'wait':
            answer = {method: 'none', note: 'only waiting'};
            break;
        default:
            throw new Error(`unknown --recovery ${options.recovery}`);
    }
    const samples = options.dryRun ? [] : await watch(rpc, options, options.device, options.pollSeconds);
    const record = {
        at: new Date().toISOString(),
        step: 'recover',
        recovery: options.recovery,
        target,
        answer,
        samples,
        masterAfter: options.dryRun ? null : await rpc.call('getParamset', [target, 'MASTER']),
        logs: await logs.since(),
    };
    await save(dir, `recover-${options.recovery}-${Date.now()}.json`, record);
    return record;
}

/**
 * The fault table of the interface process, measured instead of assumed.
 *
 * Every probe is a read or a write that cannot change anything: an address that does not exist, a
 * paramset that does not exist, a read-only parameter. hm-simulator's `lib/faults.js` is
 * calibrated from what this prints.
 */
async function stepFaults(rpc, options, dir) {
    const device = options.device;
    const target = targetAddress(options);
    const probes = [
        ['unknownMethod', 'hmmLabNoSuchMethod', []],
        ['unknownInstance (getParamset)', 'getParamset', ['HMM0000000:9', 'MASTER']],
        ['unknownInstance (putParamset)', 'putParamset', ['HMM0000000:9', 'MASTER', {}]],
        ['unknownParamset', 'getParamset', [target, 'HMM_LAB_NO_SUCH_PARAMSET']],
        ['unknownParamset (put)', 'putParamset', [target, 'HMM_LAB_NO_SUCH_PARAMSET', {}]],
        ['unknownParameter (getValue)', 'getValue', [`${device}:0`, 'HMM_LAB_NO_SUCH_PARAM']],
        // UNREACH is read-only in every description; rfd nevertheless accepts a `setValue` on it,
        // which is why the original value is read first and written back below
        ['readOnly (setValue on UNREACH)', 'setValue', [`${device}:0`, 'UNREACH', true]],
        ['unknownLink (getLinkInfo)', 'getLinkInfo', [`${device}:1`, 'HMM0000000:1']],
        ['invalidArguments (getParamset with one argument)', 'getParamset', [target]],
        ['unknownDeviceDescription', 'getDeviceDescription', ['HMM0000000']],
        ['getParamsetId', 'getParamsetId', [target, 'MASTER']],
        ['getServiceMessages (shape)', 'getServiceMessages', []],
    ];
    const before = await rpc.call('getParamset', [`${device}:0`, 'VALUES']);
    const results = [];
    for (const [label, method, params] of probes) {
        const answer = await rpc.call(method, params);
        results.push({label, method, params, answer});
        if (method === 'setValue' && answer.ok) {
            // rfd accepted a write to a read-only maintenance datapoint: put the old value back
            const original = before.ok ? before.result?.[String(params[1])] : undefined;
            if (original !== undefined) {
                results.push({
                    label: `${label} - undo`,
                    method: 'setValue',
                    params: [params[0], params[1], original],
                    answer: await rpc.call('setValue', [params[0], params[1], original]),
                });
            }
        }
    }
    const record = {at: new Date().toISOString(), step: 'faults', interface: options.interfaceName, results};
    await save(dir, `faults-${Date.now()}.json`, record);
    for (const entry of results) {
        console.log(
            `  ${entry.label.padEnd(48)} ${
                entry.answer.ok
                    ? `ok ${JSON.stringify(entry.answer.result).slice(0, 60)}`
                    : `fault ${entry.answer.faultCode ?? '-'} ${JSON.stringify(entry.answer.faultString ?? entry.answer.error)}`
            }`,
        );
    }
    return record;
}

async function stepPoll(rpc, options, dir, logs) {
    await logs.mark();
    const samples = await watch(rpc, options, options.device, options.pollSeconds);
    const record = {at: new Date().toISOString(), step: 'poll', samples, logs: await logs.since()};
    await save(dir, `poll-${Date.now()}.json`, record);
    return record;
}

async function stepExtras(rpc, options, dir) {
    const device = options.device;
    const links = await rpc.call('getLinks', [device, 0]);
    const peers = {};
    const linkDescriptions = {};
    for (const link of links.result ?? []) {
        for (const [own, peer] of [
            [link.SENDER, link.RECEIVER],
            [link.RECEIVER, link.SENDER],
        ]) {
            if (!String(own).startsWith(device)) {
                continue;
            }
            peers[own] = peers[own] ?? [];
            peers[own].push(peer);
            linkDescriptions[`${own}<-${peer}`] = await rpc.call('getParamsetDescription', [own, peer]);
            linkDescriptions[`${own}/LINK`] =
                linkDescriptions[`${own}/LINK`] ?? (await rpc.call('getParamsetDescription', [own, 'LINK']));
            linkDescriptions[`${own}<-${peer}#values`] = await rpc.call('getParamset', [own, peer]);
        }
    }
    // The LINK description question of task 4 does not need an existing link: the interface
    // process answers `getParamsetDescription(channel, <peer address>)` for any peer, so two
    // different peers on the same channel show directly whether the description depends on them.
    const target = targetAddress(options);
    linkDescriptions[`${target}/LINK`] =
        linkDescriptions[`${target}/LINK`] ?? (await rpc.call('getParamsetDescription', [target, 'LINK']));
    for (const peer of (options.peer ?? '').split(',').filter((entry) => entry !== '')) {
        linkDescriptions[`${target}<-${peer}`] = await rpc.call('getParamsetDescription', [target, peer]);
        linkDescriptions[`${target}<-${peer}#values`] = await rpc.call('getParamset', [target, peer]);
    }
    const record = {
        at: new Date().toISOString(),
        step: 'extras',
        target,
        links,
        peers,
        linkDescriptions,
        linkInfos: await Promise.all(
            (links.result ?? []).map((link) => rpc.call('getLinkInfo', [link.SENDER, link.RECEIVER])),
        ),
    };
    await save(dir, `extras-${Date.now()}.json`, record);
    return record;
}

/**
 * Core assumption A-5: a `SPECIAL` value has to pass validation although it lies outside
 * `MIN`..`MAX`. The descriptions say so; whether the *device* accepts it is what this measures.
 *
 * Every parameter of the baseline that has a `SPECIAL` list is written once with each of its
 * special values and read back; the original value is written back afterwards.
 */
async function stepSpecial(rpc, options, dir) {
    const baseline = await loadBaseline(dir);
    const results = [];
    for (const [key, entry] of Object.entries(baseline.paramsets)) {
        if (!entry.description?.ok) {
            continue;
        }
        const [address, paramsetName] = key.split('/');
        for (const [name, parameter] of Object.entries(entry.description.result)) {
            if (!Array.isArray(parameter.SPECIAL) || parameter.SPECIAL.length === 0) {
                continue;
            }
            if ((Number(parameter.OPERATIONS) & 2) !== 2) {
                results.push({address, paramset: paramsetName, parameter: name, skipped: 'not writeable'});
                continue;
            }
            const original = entry.values?.ok ? entry.values.result[name] : undefined;
            for (const special of parameter.SPECIAL) {
                const value = parameter.TYPE === 'FLOAT' ? {explicitDouble: Number(special.VALUE)} : special.VALUE;
                const answer =
                    paramsetName === 'VALUES'
                        ? await rpc.call('setValue', [address, name, value], {write: true})
                        : await rpc.call('putParamset', [address, paramsetName, {[name]: value}], {write: true});
                const readBack = options.dryRun ? null : await rpc.call('getParamset', [address, paramsetName]);
                results.push({
                    address,
                    paramset: paramsetName,
                    parameter: name,
                    special: special.ID,
                    sent: value,
                    min: parameter.MIN,
                    max: parameter.MAX,
                    answer,
                    readBack: readBack?.ok ? readBack.result[name] : readBack,
                });
                console.log(
                    `  ${address} ${name} = ${special.ID} (${special.VALUE}, MIN ${parameter.MIN} MAX ${parameter.MAX}) -> ` +
                        `${answer.ok ? 'ok' : `fault ${answer.faultCode}`}, read back ${JSON.stringify(readBack?.ok ? readBack.result[name] : null)}`,
                );
            }
            if (original !== undefined && !options.dryRun) {
                const restore = parameter.TYPE === 'FLOAT' ? {explicitDouble: Number(original)} : original;
                await rpc.call(
                    paramsetName === 'VALUES' ? 'setValue' : 'putParamset',
                    paramsetName === 'VALUES' ? [address, name, restore] : [address, paramsetName, {[name]: restore}],
                    {write: true},
                );
                console.log(`  restored ${address} ${name} = ${JSON.stringify(original)}`);
            }
        }
    }
    const record = {at: new Date().toISOString(), step: 'special', results};
    await save(dir, `special-${Date.now()}.json`, record);
    return record;
}

const UMLAUT_NAME = 'Tür Küche äöüß °C';

/**
 * How an umlaut survives the two transports.
 *
 * `setLinkInfo` needs an existing link; `setMetadata` does not, and it goes through exactly the
 * same string encoders on both sides, so it answers the same question on a system without links.
 * The value is written over the configured protocol and read back over XML-RPC **and** BIN-RPC
 * where the interface offers both (rfd and hs485d do), and the raw bytes are recorded.
 */
async function stepUmlaut(rpc, options, dir) {
    const key = 'HMM_TASK6_UMLAUT';
    const address = options.device;
    const written = await rpc.call('setMetadata', [address, key, UMLAUT_NAME], {write: true});
    const readSame = options.dryRun ? null : await rpc.call('getMetadata', [address, key]);
    let readOther = null;
    if (!options.dryRun && options.otherProtocolPort) {
        const other = new Rpc({
            ...options,
            protocol: rpc.protocol === 'binrpc' ? 'xmlrpc' : 'binrpc',
            port: Number(options.otherProtocolPort),
        });
        readOther = {
            protocol: other.protocol,
            port: other.port,
            answer: await other.call('getMetadata', [address, key]),
        };
        other.close();
    }
    const hex = (value) => (typeof value === 'string' ? Buffer.from(value, 'latin1').toString('hex') : null);
    const record = {
        at: new Date().toISOString(),
        step: 'umlaut',
        address,
        key,
        sent: UMLAUT_NAME,
        sentUtf8Hex: Buffer.from(UMLAUT_NAME, 'utf8').toString('hex'),
        sentLatin1Hex: Buffer.from(UMLAUT_NAME, 'latin1').toString('hex'),
        writeProtocol: rpc.protocol,
        written,
        readSameProtocol: readSame,
        readSameHex: hex(readSame?.result),
        readOtherProtocol: readOther,
        readOtherHex: hex(readOther?.answer?.result),
    };
    await save(dir, `umlaut-${rpc.protocol}-${Date.now()}.json`, record);
    console.log(`  sent          ${JSON.stringify(UMLAUT_NAME)}`);
    console.log(`  as utf8       ${record.sentUtf8Hex}`);
    console.log(`  as latin1     ${record.sentLatin1Hex}`);
    console.log(
        `  back ${rpc.protocol.padEnd(7)} ${JSON.stringify(readSame?.result ?? readSame)} (${record.readSameHex})`,
    );
    if (readOther) {
        console.log(
            `  back ${readOther.protocol.padEnd(7)} ${JSON.stringify(readOther.answer.result ?? readOther.answer)} (${record.readOtherHex})`,
        );
    }
    if (!options.dryRun) {
        await rpc.call('setMetadata', [address, key, ''], {write: true});
        console.log('  metadata key cleared');
    }
    return record;
}

async function stepLinkUmlaut(rpc, options, dir) {
    if (!options.peer) {
        throw new Error('--peer <address> is required for the link-umlaut step');
    }
    const sender = targetAddress(options);
    const receiver = options.peer;
    const before = await rpc.call('getLinkInfo', [sender, receiver]);
    const written = await rpc.call('setLinkInfo', [sender, receiver, UMLAUT_NAME, 'Task 6 umlaut check'], {
        write: true,
    });
    const readBack = options.dryRun ? null : await rpc.call('getLinkInfo', [sender, receiver]);
    const record = {
        at: new Date().toISOString(),
        step: 'link-umlaut',
        sender,
        receiver,
        sentName: UMLAUT_NAME,
        sentBytes: Buffer.from(UMLAUT_NAME, 'latin1').toString('hex'),
        before,
        written,
        readBack,
        readBackBytes:
            readBack?.ok && typeof readBack.result?.[0] === 'string'
                ? Buffer.from(readBack.result[0], 'latin1').toString('hex')
                : null,
        protocol: rpc.protocol,
    };
    await save(dir, `link-umlaut-${rpc.protocol}-${Date.now()}.json`, record);
    if (before.ok && !options.dryRun) {
        console.log('  restoring the previous link name');
        await rpc.call('setLinkInfo', [sender, receiver, before.result?.[0] ?? '', before.result?.[1] ?? ''], {
            write: true,
        });
    }
    return record;
}

async function stepRestore(rpc, options, dir, logs) {
    const baseline = await loadBaseline(dir);
    const target = targetAddress(options);
    const {values} = baselineMaster(baseline, target);
    await logs.mark();
    const answer = await rpc.call('putParamset', [target, 'MASTER', values], {write: true});
    const after = options.dryRun ? null : await rpc.call('getParamset', [target, 'MASTER']);
    const differences = [];
    if (after?.ok) {
        const original = baseline.paramsets[`${target}/MASTER`].values.result;
        for (const [name, value] of Object.entries(original)) {
            if (String(after.result?.[name]) !== String(value)) {
                differences.push({parameter: name, baseline: value, now: after.result?.[name]});
            }
        }
    }
    const record = {
        at: new Date().toISOString(),
        step: 'restore',
        target,
        answer,
        masterAfter: after,
        differences,
        samples: options.dryRun ? [] : await watch(rpc, options, options.device, options.pollSeconds),
        logs: await logs.since(),
    };
    await save(dir, `restore-${Date.now()}.json`, record);
    console.log(differences.length === 0 ? '  MASTER equals the baseline' : `  ${differences.length} differences left`);
    return record;
}

/** Anonymises a serial consistently: the first three characters stay, the rest becomes a counter. */
function anonymiser() {
    const map = new Map();
    return (address) => {
        if (typeof address !== 'string' || address === '') {
            return address;
        }
        const [serial, channel] = address.split(':');
        // only real serials are replaced: a BidCos serial (three letters, seven digits) and an
        // HmIP SGTIN (14 hex digits). `BidCoS-RF`, `HmIP-RCV-1` and the `*` group addresses are
        // not identifying and stay readable, which is what makes the fixture useful.
        const isSerial = /^[A-Z]{3}[0-9]{7}$/i.test(serial) || /^[0-9A-F]{14}$/i.test(serial);
        if (!isSerial) {
            return address;
        }
        if (!map.has(serial)) {
            map.set(serial, `XXX${String(map.size + 1).padStart(7, '0')}`);
        }
        const replaced = map.get(serial);
        return channel === undefined ? replaced : `${replaced}:${channel}`;
    };
}

async function stepDumpDevices(rpc, options, dir) {
    const listed = await rpc.call('listDevices', []);
    if (!listed.ok) {
        throw new Error(`listDevices failed: ${listed.error}`);
    }
    const anonymise = anonymiser();
    const devices = listed.result.map((entry) => ({
        ...entry,
        ADDRESS: anonymise(entry.ADDRESS),
        ...(entry.PARENT ? {PARENT: anonymise(entry.PARENT)} : {}),
        ...(entry.CHILDREN ? {CHILDREN: entry.CHILDREN.map(anonymise)} : {}),
    }));
    const wanted = options.device
        ? devices.filter((entry) => {
              const anonymisedDevice = anonymise(options.device);
              return entry.ADDRESS === anonymisedDevice || String(entry.ADDRESS).startsWith(`${anonymisedDevice}:`);
          })
        : devices;
    await save(dir, `listDevices-${options.interfaceName}.json`, {
        at: new Date().toISOString(),
        interface: options.interfaceName,
        count: devices.length,
        devices: wanted,
    });
    return wanted;
}

/* ------------------------------------------------------------------ main */

const WRITING_STEPS = new Set(['rewrite', 'provoke', 'recover', 'restore', 'link-umlaut', 'special', 'umlaut']);

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.step) {
        console.log(USAGE);
        process.exit(options.help ? 0 : 1);
    }
    if (options.device && isForbidden(options.device)) {
        throw new Error(`${options.device} is the interface process' own central channel - refusing`);
    }
    if (WRITING_STEPS.has(options.step) && options.dryRun !== true && options.yes !== true) {
        throw new Error(`${options.step} writes to a device: pass --yes (or --dry-run)`);
    }
    const dir = await resultDir(options);
    const logs = new LogTail(options.ssh);
    const rpc = new Rpc(options);
    console.log(
        `${options.step} on ${options.interfaceName ?? options.protocol}:${rpc.port} target ${
            options.device ?? '-'
        }${options.dryRun ? ' (dry run)' : ''}`,
    );
    try {
        switch (options.step) {
            case 'baseline':
                await stepBaseline(rpc, options, dir, logs);
                break;
            case 'rewrite':
                await stepRewrite(rpc, options, dir, logs);
                break;
            case 'provoke':
                await stepProvoke(rpc, options, dir, logs);
                break;
            case 'recover':
                await stepRecover(rpc, options, dir, logs);
                break;
            case 'poll':
                await stepPoll(rpc, options, dir, logs);
                break;
            case 'extras':
                await stepExtras(rpc, options, dir);
                break;
            case 'faults':
                await stepFaults(rpc, options, dir);
                break;
            case 'special':
                await stepSpecial(rpc, options, dir);
                break;
            case 'umlaut':
                await stepUmlaut(rpc, options, dir);
                break;
            case 'link-umlaut':
                await stepLinkUmlaut(rpc, options, dir);
                break;
            case 'restore':
                await stepRestore(rpc, options, dir, logs);
                break;
            case 'dump-devices':
                await stepDumpDevices(rpc, options, dir);
                break;
            default:
                throw new Error(`unknown step ${options.step}`);
        }
        await save(dir, `calls-${options.step}-${Date.now()}.json`, rpc.calls);
    } finally {
        rpc.close();
    }
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(`error: ${error.message}`);
        process.exit(1);
    },
);
