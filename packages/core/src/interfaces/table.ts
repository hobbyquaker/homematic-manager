/**
 * The CCU interface processes: names as the CCU uses them, ports (public / TLS / process-local),
 * protocol, whether they want an `init()` subscription and answer pings.
 *
 * Ported from hm2mqtt.js `lib/interfaces.js`, minus the socket probing - the core does no I/O, the
 * probe lives in the backend (task 4).
 *
 * `localPort` is what the interface process itself listens on; 2000/2001/2010/9292 are lighttpd
 * proxies in front of it. Running on the CCU (the addon, task 13) we talk to the process directly:
 * one hop less, binrpc for rfd/hs485d, and no CCU authentication.
 *
 * BIN-RPC exists on the CCU's loopback only (D-28): rfd and hs485d take it on 32001/32000, but the
 * public ports are lighttpd's XML-RPC proxies and nothing on the LAN speaks BIN-RPC to a CCU. The
 * one exception is CUxD, a third-party daemon with its own BIN-RPC listener on 8701.
 */

/** How an interface is spoken to. `binrpc` is eQ-3's binary XML-RPC dialect. */
export type RpcProtocol = 'xmlrpc' | 'binrpc';

/** Basic authentication for an interface (the CCU's lighttpd asks for it when it is enabled). */
export interface InterfaceAuth {
    readonly user: string;
    readonly password: string;
}

/** One entry of the built-in interface table. */
export interface InterfaceDefinition {
    /** The name the CCU uses; also the name in the paramset description identity key. */
    readonly name: string;
    /** Port of the lighttpd proxy on the CCU. */
    readonly port: number;
    /** Same interface behind TLS: the plain port plus 40000. */
    readonly tlsPort?: number;
    /** Port the interface process itself listens on, reachable only from the CCU. */
    readonly localPort?: number;
    /** The process port speaks binrpc (rfd and hs485d do, hmipserver and the group process do not). */
    readonly localBinrpc?: boolean;
    /** Protocol on the public port; always `xmlrpc` behind the CCU's lighttpd (D-28). */
    readonly protocol: RpcProtocol;
    /** Request path, `/` unless the interface insists on something else. */
    readonly path?: string;
    /** Wants an `init(url, ident)` subscription. */
    readonly init: boolean;
    /** Answers `ping` and therefore takes part in the connection watchdog. */
    readonly ping: boolean;
    /** Seconds without an event after which the connection counts as dead. */
    readonly pingTimeout?: number;
    /** Reports a duty cycle (relevant for the radio tab). */
    readonly dutyCycle?: boolean;
    /** A fixed `init` identity string; only CUxD has one (it matches on the literal `CUxD`). */
    readonly ident?: string;
}

/**
 * Seconds without an event after which an interface counts as dead. HmIP-RF gets 600 s because
 * hmipserver answers pings but sends events rarely (eq-3/occu#42); everything else gets 60 s.
 */
export const DEFAULT_PING_TIMEOUT_SECONDS = 60;

export const INTERFACES = {
    'BidCos-RF': {
        name: 'BidCos-RF',
        port: 2001,
        tlsPort: 42001,
        localPort: 32001,
        localBinrpc: true,
        protocol: 'xmlrpc',
        init: true,
        ping: true,
        dutyCycle: true,
    },
    'BidCos-Wired': {
        name: 'BidCos-Wired',
        port: 2000,
        tlsPort: 42000,
        localPort: 32000,
        localBinrpc: true,
        protocol: 'xmlrpc',
        init: true,
        ping: true,
    },
    'HmIP-RF': {
        name: 'HmIP-RF',
        port: 2010,
        tlsPort: 42010,
        // hmipserver speaks no binrpc; "local" here only means past the proxy
        localPort: 32010,
        protocol: 'xmlrpc',
        init: true,
        ping: true,
        pingTimeout: 600,
        dutyCycle: true,
    },
    VirtualDevices: {
        name: 'VirtualDevices',
        port: 9292,
        tlsPort: 49292,
        localPort: 39292,
        path: '/groups',
        protocol: 'xmlrpc',
        init: true,
        // the group process answers no ping, so it is watched by events only
        ping: false,
    },
    CUxD: {
        name: 'CUxD',
        port: 8701,
        protocol: 'binrpc',
        init: true,
        ping: true,
        // CUxD matches the init identity against the literal string, `hmm_CUxD` is ignored
        ident: 'CUxD',
    },
} as const satisfies Record<string, InterfaceDefinition>;

/** Name of a built-in interface. */
export type InterfaceName = keyof typeof INTERFACES;

/** The built-in interfaces in table order. */
export const INTERFACE_NAMES = Object.keys(INTERFACES) as InterfaceName[];

/** The interfaces the app subscribes to unless the user says otherwise; CUxD is opt-in. */
export const DEFAULT_INTERFACES: readonly InterfaceName[] = ['BidCos-RF', 'HmIP-RF', 'VirtualDevices', 'BidCos-Wired'];

/** ReGa's script port: 8181 through lighttpd, 48181 with TLS, 8183 is ReGaHSS itself (no auth). */
export const REGA_PORT = 8181;
export const REGA_TLS_PORT = 48181;
export const REGA_LOCAL_PORT = 8183;

/** How the CCU is reached; the same options decide every interface's port and protocol. */
export interface ConnectionMode {
    /** TLS through lighttpd (public port + 40000). */
    readonly tls?: boolean;
    /** We run on the CCU itself and talk to the interface processes directly. */
    readonly local?: boolean;
}

/** Everything a client needs to talk to one interface. */
export interface ResolvedInterface {
    readonly name: string;
    readonly port: number;
    readonly protocol: RpcProtocol;
    readonly path: string;
    readonly tls: boolean;
    readonly init: boolean;
    readonly ident: string;
    readonly ping: boolean;
    readonly pingTimeoutSeconds: number;
    readonly dutyCycle: boolean;
}

/** An extra interface the user configured by hand (D-13, issue #135). */
/**
 * An interface the table does not know, configured by hand (D-13, issue #135).
 *
 * **CCU-Jack** (#135) was the case this was asked for, and it needs nothing more than these five
 * fields. Verified 2026-09-05 against `mdzio/ccu-jack`: its README offers REST/VEAP and MQTT, and
 * the BIN-RPC in its credits is its *client* side towards CUxD - but its virtual devices
 * ("Fremdgeräte") are served to logic layers over plain XML-RPC. `virtdev/virtdev.go` registers
 * `xmlrpc.Handler` with the standard `go-hmccu` interface dispatcher on the path `/RPC3` of its own
 * HTTP server, and announces itself in `/etc/config/InterfacesList.xml` as
 * `xmlrpc://<ccu>:<HTTP.Port>/RPC3` so the CCU sees it like any other interface process.
 *
 * So a user-defined interface for it is:
 *
 * | field | value |
 * | --- | --- |
 * | `name` | anything, e.g. `CCU-Jack` (it is the `init` ident, `hmm_CCU-Jack`) |
 * | `host` | where CCU-Jack runs - the CCU itself in the usual addon install |
 * | `port` | `2121`, its `HTTP.Port` (`2122` is `PortTLS`; `2123` is its BIN-RPC *client* port) |
 * | `protocol` | `xmlrpc` |
 * | `path` | `/RPC3` |
 *
 * No code is needed for it, which is why there is none: the only thing #135 wanted that was missing
 * is a `path`, and a user-defined interface has had one since task 4.
 */
export interface UserDefinedInterface {
    /** Free text; must not collide with a built-in name. */
    readonly name: string;
    readonly host: string;
    readonly port: number;
    readonly protocol: RpcProtocol;
    /** Request path; `/` when omitted. */
    readonly path?: string;
    readonly tls?: boolean;
    readonly auth?: InterfaceAuth;
}

/** Is this one of the built-in interfaces? */
export function isKnownInterface(name: string): name is InterfaceName {
    return Object.prototype.hasOwnProperty.call(INTERFACES, name);
}

/** The built-in definition, or `undefined` for a name the table does not know. */
export function interfaceDefinition(name: string): InterfaceDefinition | undefined {
    return isKnownInterface(name) ? INTERFACES[name] : undefined;
}

/**
 * The identity string passed to `init(url, ident)` and sent back with every callback, which is how
 * the callback server tells the interfaces apart. `hmm_<name>` for everything except CUxD, which
 * compares the identity against the literal `CUxD` and drops the subscription otherwise.
 */
export function interfaceIdent(name: string): string {
    return interfaceDefinition(name)?.ident ?? `hmm_${name}`;
}

/** The interface an incoming callback belongs to, the reverse of {@link interfaceIdent}. */
export function interfaceNameFromIdent(ident: string): string | undefined {
    for (const name of INTERFACE_NAMES) {
        if (interfaceIdent(name) === ident) {
            return name;
        }
    }
    return ident.startsWith('hmm_') && ident.length > 'hmm_'.length ? ident.slice('hmm_'.length) : undefined;
}

/** The port of a built-in interface for the given mode. `local` wins over `tls`. */
export function interfacePort(definition: InterfaceDefinition, mode: ConnectionMode = {}): number {
    if (mode.local === true && definition.localPort !== undefined) {
        return definition.localPort;
    }
    if (mode.tls === true && definition.tlsPort !== undefined) {
        return definition.tlsPort;
    }
    return definition.port;
}

/**
 * The protocol of a built-in interface for the given mode: what the table says, except that on the
 * CCU itself rfd and hs485d are spoken to in binrpc. Off the CCU there is no binrpc (D-28).
 */
export function interfaceProtocol(definition: InterfaceDefinition, mode: ConnectionMode = {}): RpcProtocol {
    if (definition.protocol === 'binrpc') {
        return 'binrpc';
    }
    const useLocal = mode.local === true && definition.localPort !== undefined;
    return useLocal && definition.localBinrpc === true ? 'binrpc' : 'xmlrpc';
}

/** Connection parameters of a built-in interface. Throws for a name the table does not know. */
export function resolveInterface(name: string, mode: ConnectionMode = {}): ResolvedInterface {
    const definition = interfaceDefinition(name);
    if (!definition) {
        throw new Error(`unknown interface "${name}" (known: ${INTERFACE_NAMES.join(', ')})`);
    }
    const local = mode.local === true && definition.localPort !== undefined;
    return {
        name: definition.name,
        port: interfacePort(definition, mode),
        protocol: interfaceProtocol(definition, mode),
        path: definition.path ?? '/',
        // the process ports carry no TLS and need none on loopback
        tls: mode.tls === true && !local && definition.tlsPort !== undefined,
        init: definition.init,
        ident: interfaceIdent(definition.name),
        ping: definition.ping,
        pingTimeoutSeconds: definition.pingTimeout ?? DEFAULT_PING_TIMEOUT_SECONDS,
        dutyCycle: definition.dutyCycle ?? false,
    };
}

/**
 * Connection parameters of a user-defined interface (D-13). Everything is taken as configured -
 * there is no port table to consult and no vendor detection; a user-defined interface always gets
 * an `init` subscription and is watched by the default ping timeout.
 */
export function resolveUserDefinedInterface(definition: UserDefinedInterface): ResolvedInterface {
    return {
        name: definition.name,
        port: definition.port,
        protocol: definition.protocol,
        path: definition.path ?? '/',
        tls: definition.tls ?? false,
        init: true,
        ident: interfaceIdent(definition.name),
        ping: true,
        pingTimeoutSeconds: DEFAULT_PING_TIMEOUT_SECONDS,
        dutyCycle: false,
    };
}

/** Why a user-defined interface cannot be used. */
export type UserDefinedInterfaceProblem =
    | {readonly code: 'empty-name'}
    | {readonly code: 'reserved-name'; readonly name: string}
    | {readonly code: 'empty-host'}
    | {readonly code: 'invalid-port'; readonly port: number};

/** Checks a user-defined interface without throwing; an empty result means it is usable. */
export function validateUserDefinedInterface(definition: UserDefinedInterface): UserDefinedInterfaceProblem[] {
    const problems: UserDefinedInterfaceProblem[] = [];
    if (definition.name.trim() === '') {
        problems.push({code: 'empty-name'});
    } else if (isKnownInterface(definition.name)) {
        problems.push({code: 'reserved-name', name: definition.name});
    }
    if (definition.host.trim() === '') {
        problems.push({code: 'empty-host'});
    }
    if (!Number.isInteger(definition.port) || definition.port < 1 || definition.port > 65535) {
        problems.push({code: 'invalid-port', port: definition.port});
    }
    return problems;
}

/** The port ReGa's script interface is reached on (D-2: ReGa is optional). */
export function regaPort(mode: ConnectionMode = {}): number {
    if (mode.local === true) {
        return REGA_LOCAL_PORT;
    }
    return mode.tls === true ? REGA_TLS_PORT : REGA_PORT;
}
