/**
 * Defaults, normalisation and validation of the connection configuration.
 *
 * The UI sends a `ConnectionConfig` and gets an `AppConfig` back; everything in between - a port
 * that is not a number, an interface name nothing knows, a callback address this machine does not
 * have - is caught here rather than at the first `init` call, where the error would arrive as a
 * socket timeout twenty seconds later.
 */

import {
    DEFAULT_INTERFACES,
    INTERFACE_NAMES,
    isKnownInterface,
    resolveInterface,
    resolveUserDefinedInterface,
    validateUserDefinedInterface,
    type ConnectionConfig,
    type Language,
    type ResolvedInterface,
    type UserDefinedInterface,
} from '@homematic-manager/core';

/**
 * Minimum pause between two writes to one interface.
 *
 * 2.x serialised **every** call through a modal dialog with `rpcDelay` = 3000 ms, so a multi-apply
 * to 100 channels took five minutes with the UI blocked (analysis 3.3). Only writes are paced here,
 * reads never queue at all, so the pace can be far shorter; HmIP gets the double of it (task 6.4).
 */
export const DEFAULT_WRITE_PACE_MS = 250;

/** The interface the roadmap calls "slower" for writes: hmipserver validates every parameter. */
export const SLOW_WRITE_INTERFACES: readonly string[] = ['HmIP-RF'];

/** The pace one interface is written with. */
export function writePaceFor(interfaceName: string, writePaceMs: number): number {
    const pace = Number.isFinite(writePaceMs) && writePaceMs >= 0 ? writePaceMs : DEFAULT_WRITE_PACE_MS;
    return SLOW_WRITE_INTERFACES.includes(interfaceName) ? pace * 2 : pace;
}

/** The languages the UI ships (`Language` in the core's data contract). */
export const LANGUAGES: readonly Language[] = ['de', 'en', 'tr'];

/** A connection nothing has configured yet: no host, the four default interfaces, ReGa on. */
export function defaultConnection(): ConnectionConfig {
    return {
        host: '',
        interfaces: [...DEFAULT_INTERFACES],
        autoDetect: true,
        extraInterfaces: [],
        tls: false,
        rega: true,
        callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0},
        language: 'de',
        writePaceMs: DEFAULT_WRITE_PACE_MS,
        rpcLogFolder: '',
        // #26: off unless the user asks. Acknowledging is a write, and the list of what was
        // unreachable is exactly what a user watching it would lose.
        autoAckStickyUnreach: false,
    };
}

function isPort(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535;
}

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

/**
 * Takes whatever came from the UI or from a config file and returns a complete `ConnectionConfig`.
 * Unknown fields are dropped, wrong types fall back to the default; nothing throws.
 */
export function normaliseConnection(input: unknown): ConnectionConfig {
    const defaults = defaultConnection();
    if (typeof input !== 'object' || input === null) {
        return defaults;
    }
    const raw = input as Partial<Record<keyof ConnectionConfig, unknown>>;

    const extraInterfaces = Array.isArray(raw.extraInterfaces)
        ? raw.extraInterfaces.filter((entry): entry is UserDefinedInterface => isUserDefinedInterface(entry))
        : defaults.extraInterfaces;

    const knownNames = new Set([...INTERFACE_NAMES, ...extraInterfaces.map((entry) => entry.name)]);
    const interfaces = Array.isArray(raw.interfaces)
        ? raw.interfaces.filter((name): name is string => typeof name === 'string' && knownNames.has(name))
        : defaults.interfaces;

    const callback =
        typeof raw.callback === 'object' && raw.callback !== null ? (raw.callback as Record<string, unknown>) : {};
    const language = LANGUAGES.find((candidate) => candidate === raw.language) ?? defaults.language;

    const connection: ConnectionConfig = {
        host: stringOr(raw.host, defaults.host).trim(),
        interfaces: interfaces.length > 0 ? [...new Set(interfaces)] : defaults.interfaces,
        autoDetect: typeof raw.autoDetect === 'boolean' ? raw.autoDetect : defaults.autoDetect,
        extraInterfaces,
        tls: typeof raw.tls === 'boolean' ? raw.tls : defaults.tls,
        ...(raw.local === true ? {local: true} : {}),
        rega: typeof raw.rega === 'boolean' ? raw.rega : defaults.rega,
        callback: {
            ip: stringOr(callback['ip'], defaults.callback.ip).trim(),
            xmlrpcPort: isPort(callback['xmlrpcPort']) ? callback['xmlrpcPort'] : defaults.callback.xmlrpcPort,
            binrpcPort: isPort(callback['binrpcPort']) ? callback['binrpcPort'] : defaults.callback.binrpcPort,
        },
        language,
        writePaceMs:
            typeof raw.writePaceMs === 'number' && Number.isFinite(raw.writePaceMs) && raw.writePaceMs >= 0
                ? Math.round(raw.writePaceMs)
                : defaults.writePaceMs,
        rpcLogFolder: stringOr(raw.rpcLogFolder, defaults.rpcLogFolder),
        autoAckStickyUnreach:
            typeof raw.autoAckStickyUnreach === 'boolean'
                ? raw.autoAckStickyUnreach
                : defaults.autoAckStickyUnreach === true,
    };

    const auth = normaliseAuth(raw.auth);
    return auth === undefined ? connection : {...connection, auth};
}

function normaliseAuth(value: unknown): {user: string; password: string} | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const raw = value as Record<string, unknown>;
    const user = raw['user'];
    if (typeof user !== 'string' || user === '') {
        return undefined;
    }
    return {user, password: typeof raw['password'] === 'string' ? raw['password'] : ''};
}

function isUserDefinedInterface(value: unknown): value is UserDefinedInterface {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const raw = value as Record<string, unknown>;
    return (
        typeof raw['name'] === 'string' &&
        typeof raw['host'] === 'string' &&
        isPort(raw['port']) &&
        (raw['protocol'] === 'xmlrpc' || raw['protocol'] === 'binrpc')
    );
}

/** Everything wrong with a connection, as messages the UI can show next to the field. */
export function validateConnection(connection: ConnectionConfig): string[] {
    const problems: string[] = [];
    if (connection.host === '') {
        problems.push('no CCU address configured');
    }
    if (connection.interfaces.length === 0) {
        problems.push('no interface selected');
    }
    const names = new Set<string>();
    for (const extra of connection.extraInterfaces) {
        for (const problem of validateUserDefinedInterface(extra)) {
            problems.push(describeInterfaceProblem(extra, problem));
        }
        if (names.has(extra.name)) {
            problems.push(`extra interface "${extra.name}" is defined twice`);
        }
        names.add(extra.name);
    }
    for (const name of connection.interfaces) {
        if (!isKnownInterface(name) && !names.has(name)) {
            problems.push(`unknown interface "${name}"`);
        }
    }
    if (connection.callback.xmlrpcPort === connection.callback.binrpcPort && connection.callback.xmlrpcPort !== 0) {
        problems.push('the xmlrpc and binrpc callback ports must differ');
    }
    return problems;
}

function describeInterfaceProblem(
    definition: UserDefinedInterface,
    problem: ReturnType<typeof validateUserDefinedInterface>[number],
): string {
    switch (problem.code) {
        case 'empty-name':
            return 'an extra interface has no name';
        case 'reserved-name':
            return `"${problem.name}" is the name of a built-in interface`;
        case 'empty-host':
            return `extra interface "${definition.name}" has no host`;
        default:
            return `extra interface "${definition.name}" has an invalid port ${String(problem.port)}`;
    }
}

/** One entry of the interface list the manager works from. */
export interface InterfaceTarget {
    readonly resolved: ResolvedInterface;
    /** The host to talk to; a user-defined interface may live somewhere else than the CCU. */
    readonly host: string;
    readonly auth: {user: string; password: string} | undefined;
}

/**
 * The interfaces a connection asks for, resolved against the core's table (D-13: built-in names
 * plus whatever the user defined by hand). An unknown name is skipped, not thrown.
 */
export function interfaceTargets(connection: ConnectionConfig): InterfaceTarget[] {
    const extras = new Map(connection.extraInterfaces.map((entry) => [entry.name, entry]));
    const targets: InterfaceTarget[] = [];
    for (const name of connection.interfaces) {
        const extra = extras.get(name);
        if (extra) {
            targets.push({
                resolved: resolveUserDefinedInterface(extra),
                host: extra.host,
                auth: extra.auth ? {user: extra.auth.user, password: extra.auth.password} : connection.auth,
            });
            continue;
        }
        if (!isKnownInterface(name)) {
            continue;
        }
        targets.push({
            resolved: resolveInterface(name, {
                tls: connection.tls,
                local: connection.local === true,
            }),
            host: connection.host,
            auth: connection.auth,
        });
    }
    return targets;
}
