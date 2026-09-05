/**
 * The contract between the backend (task 4) and the UI (tasks 7/8): every request the UI can make
 * and every event the backend pushes. The transports (Electron IPC in apps/electron, WebSocket in
 * apps/web) carry exactly these shapes; the UI never sees a socket, a file or an RPC library.
 *
 * Rules: extend with new methods, events and optional fields; never rename or repurpose existing
 * ones. Parameters are positional tuples so that both transports can forward them verbatim.
 */

import type {DeviceDescription} from '../devices/index.js';
import type {RpcProtocol, UserDefinedInterface} from '../interfaces/table.js';
import type {ParamsetDescription} from '../paramset/description.js';
import type {Paramset, ParamsetWrite, RpcWriteValue} from '../rpc/values.js';
import type {Language} from '../data/types.js';

/** Any value an interface process returns: XML-RPC / BIN-RPC scalars, arrays and structs. */
export type RpcValue = boolean | number | string | RpcValue[] | {[key: string]: RpcValue};

/** One connection profile, persisted by the backend. */
export interface ConnectionConfig {
    /** Host name or IP of the CCU (or of the interface processes). Empty until configured. */
    host: string;
    /** Interfaces to use; unknown names refer to `extraInterfaces`. */
    interfaces: string[];
    /** Detect the interfaces by probing the well-known ports (background, never blocking). */
    autoDetect: boolean;
    extraInterfaces: UserDefinedInterface[];
    tls: boolean;
    auth?: {user: string; password: string};
    /** ReGa is optional (D-2): names come from ReGa when present, else from the local store. */
    rega: boolean;
    /** Address and ports the interface processes call back to; `0` picks free ports. */
    callback: {ip: string; xmlrpcPort: number; binrpcPort: number};
    language: Language;
    /** Minimum pause between two writes per interface, in milliseconds. */
    writePaceMs: number;
    /** Directory for the `putParamset` JSON dumps of 2.x; empty = off. */
    rpcLogFolder: string;
}

export interface AppConfig {
    version: string;
    connection: ConnectionConfig;
    /** IPv4 addresses of this machine, candidates for `connection.callback.ip`. */
    localAddresses: string[];
    /** CCUs found by UDP discovery (host names or addresses with what answered). */
    discovered: DiscoveredCcu[];
}

export interface DiscoveredCcu {
    address: string;
    name?: string;
    serial?: string;
    firmware?: string;
    interfaces: string[];
}

export interface InterfaceState {
    name: string;
    type: string;
    protocol: RpcProtocol;
    host: string;
    port: number;
    /** `init` succeeded and the ping/event watchdog is satisfied. */
    connected: boolean;
    /** Milliseconds since epoch of the last event or ping answer, if any. */
    lastEvent?: number;
    /** Last error text, cleared on reconnect. */
    error?: string;
}

export interface RegaState {
    enabled: boolean;
    reachable: boolean;
    /** Name count loaded from ReGa. */
    names: number;
    error?: string;
}

/** Friendly names: address -> name (devices and channels), from ReGa or the local store. */
export type NameMap = Record<string, string>;

export interface LinkRecord {
    SENDER: string;
    RECEIVER: string;
    NAME?: string;
    DESCRIPTION?: string;
    FLAGS?: number;
}

export interface ServiceMessage {
    interfaceName: string;
    address: string;
    datapoint: string;
    value: RpcValue;
    /** Milliseconds since epoch when it was first seen. */
    since: number;
}

export interface EventRecord {
    /** Milliseconds since epoch. */
    timestamp: number;
    interfaceName: string;
    method: 'event' | 'newDevices' | 'deleteDevices' | 'replaceDevice' | 'listDevices';
    address?: string;
    datapoint?: string;
    value?: RpcValue;
    /** For the device methods: the payload as received. */
    payload?: RpcValue;
}

/** RSSI matrix as `rssiInfo` returns it: peer address -> [rx, tx]; 65536 means unknown. */
export type RssiInfo = Record<string, Record<string, [number, number]>>;

export interface BidcosInterfaceInfo {
    ADDRESS: string;
    TYPE: string;
    DESCRIPTION?: string;
    CONNECTED?: boolean;
    DEFAULT?: boolean;
    DUTY_CYCLE?: number;
    CARRIER_SENSE_LEVEL?: number;
    FIRMWARE_VERSION?: string;
}

export interface WriteOptions {
    /** Send every writeable parameter, not only the changed ones (task 6, item 1). */
    writeAll?: boolean;
    /** Only validate and return what would be sent. */
    dryRun?: boolean;
}

export interface WriteProblem {
    parameter?: string;
    message: string;
}

/** Outcome of one write to one target; a bulk write returns one per target. */
export interface WriteResult {
    interfaceName: string;
    address: string;
    /** For LINK paramsets: the peer address. */
    peer?: string;
    paramset: string;
    /** Exactly what was (or would be) sent. */
    sent: ParamsetWrite;
    ok: boolean;
    skipped?: boolean;
    problems: WriteProblem[];
    faultCode?: number;
    faultString?: string;
    durationMs?: number;
}

export interface WriteLogEntry {
    id: number;
    timestamp: number;
    interfaceName: string;
    method: string;
    params: RpcValue[];
    ok: boolean;
    result?: RpcValue;
    error?: string;
    durationMs: number;
}

export interface InstallModeOptions {
    /** Seconds; the interface's default when omitted. */
    seconds?: number;
    /** BidCos: install mode kind (1 normal, 2 with temporary key). */
    mode?: number;
    /** HmIP: the device key (SGTIN + key from the QR code or the sticker). */
    hmipKey?: {sgtin: string; key: string};
    /** HmIP: whether the key mode is "KEY" or "SGTIN". */
    hmipKeyMode?: 'KEY' | 'SGTIN';
    /** BidCos: temporary key for `setTempKey`. */
    tempKey?: string;
    /** Restrict to a device address (BidCos `setInstallMode` with address). */
    address?: string;
}

export interface RpcMethodInfo {
    name: string;
    help?: string;
    params: Array<{name: string; type: string; optional?: boolean; values?: string[]}>;
}

/**
 * Request methods: `params` is the positional tuple the UI sends, `result` what it receives.
 * Every method rejects with `ApiError` on failure; RPC faults keep their `faultCode`. Methods
 * without a result value resolve with `null`, which both transports carry verbatim.
 */
export interface ApiMethods {
    'config.get': {params: []; result: AppConfig};
    /** Persist and reconnect. */
    'config.set': {params: [connection: ConnectionConfig]; result: AppConfig};
    'config.discover': {params: []; result: DiscoveredCcu[]};
    'config.clearCaches': {params: []; result: null};

    'interfaces.list': {params: []; result: InterfaceState[]};
    'interfaces.reconnect': {params: [interfaceName?: string]; result: null};
    'rega.state': {params: []; result: RegaState};

    'devices.list': {params: [interfaceName: string, options?: {refresh?: boolean}]; result: DeviceDescription[]};
    'devices.description': {params: [interfaceName: string, address: string]; result: DeviceDescription};
    'devices.delete': {params: [interfaceName: string, address: string, flags: number]; result: null};
    'devices.replace': {params: [interfaceName: string, oldAddress: string, newAddress: string]; result: boolean};
    'devices.reportValueUsage': {
        params: [interfaceName: string, address: string, valueId: string, refCounter: number];
        result: number;
    };
    'devices.restoreConfig': {params: [interfaceName: string, address: string]; result: null};
    'devices.clearConfigCache': {params: [interfaceName: string, address: string]; result: null};
    'devices.updateFirmware': {params: [interfaceName: string, addresses: string[]]; result: boolean[]};
    'devices.installFirmware': {params: [interfaceName: string, address: string]; result: boolean};
    'devices.installMode.set': {
        params: [interfaceName: string, on: boolean, options?: InstallModeOptions];
        result: null;
    };
    'devices.installMode.get': {params: [interfaceName: string]; result: number};
    'devices.replaceable': {params: [interfaceName: string, address: string]; result: DeviceDescription[]};

    'names.get': {params: []; result: NameMap};
    'names.set': {params: [entries: Array<{address: string; name: string}>]; result: NameMap};

    'paramset.get': {params: [interfaceName: string, address: string, paramset: string]; result: Paramset};
    'paramset.description': {
        params: [interfaceName: string, address: string, paramset: string];
        result: ParamsetDescription;
    };
    /** MASTER/VALUES/SERVICE write to one or more channels (multi-apply, task 6). */
    'paramset.put': {
        params: [
            interfaceName: string,
            addresses: string[],
            paramset: string,
            values: ParamsetWrite,
            options?: WriteOptions,
        ];
        result: WriteResult[];
    };
    /** LINK paramset write: `values` keyed by direction. */
    'paramset.putLink': {
        params: [
            interfaceName: string,
            links: Array<{sender: string; receiver: string}>,
            values: {senderToReceiver?: ParamsetWrite; receiverToSender?: ParamsetWrite},
            options?: WriteOptions,
        ];
        result: WriteResult[];
    };
    'value.set': {
        params: [interfaceName: string, address: string, parameter: string, value: RpcWriteValue];
        result: null;
    };
    'value.get': {params: [interfaceName: string, address: string, parameter: string]; result: RpcValue};

    'links.list': {params: [interfaceName: string]; result: LinkRecord[]};
    'links.add': {
        params: [interfaceName: string, sender: string, receiver: string, name?: string, description?: string];
        result: null;
    };
    'links.remove': {params: [interfaceName: string, sender: string, receiver: string]; result: null};
    'links.info.get': {params: [interfaceName: string, sender: string, receiver: string]; result: LinkRecord};
    'links.info.set': {
        params: [interfaceName: string, sender: string, receiver: string, name: string, description: string];
        result: null;
    };
    'links.activate': {params: [interfaceName: string, receiver: string, sender: string, long: boolean]; result: null};
    'links.peers': {params: [interfaceName: string, address: string]; result: string[]};

    'rssi.get': {params: [interfaceName: string]; result: RssiInfo};
    'bidcos.interfaces': {params: [interfaceName: string]; result: BidcosInterfaceInfo[]};
    'bidcos.setInterface': {
        params: [interfaceName: string, address: string, bidcosInterface: string, roaming: boolean];
        result: null;
    };

    'serviceMessages.list': {params: [interfaceName?: string]; result: ServiceMessage[]};
    /** Acknowledge by writing the datapoint (STICKY_UNREACH etc.). */
    'serviceMessages.ack': {params: [interfaceName: string, address: string, datapoint: string]; result: null};

    'events.recent': {params: [interfaceName?: string, limit?: number]; result: EventRecord[]};
    'events.clear': {params: []; result: null};

    /** The RPC console: any method, any params; goes through the write log when it is a write. */
    'rpc.call': {params: [interfaceName: string, method: string, params: RpcValue[]]; result: RpcValue};
    'rpc.methods': {params: [interfaceName: string]; result: RpcMethodInfo[]};

    'writeLog.list': {params: [limit?: number]; result: WriteLogEntry[]};
    'writeLog.clear': {params: []; result: null};

    'data.file': {params: [path: string]; result: unknown};
}

export type ApiMethodName = keyof ApiMethods;
export type ApiParams<M extends ApiMethodName> = ApiMethods[M]['params'];
export type ApiResult<M extends ApiMethodName> = ApiMethods[M]['result'];

/** Events the backend pushes; the UI subscribes per name. */
export interface ApiEvents {
    'interfaces.changed': InterfaceState[];
    'rega.changed': RegaState;
    'devices.changed': {interfaceName: string; kind: 'new' | 'deleted' | 'replaced' | 'refreshed'; addresses: string[]};
    'names.changed': NameMap;
    'rpc.event': EventRecord;
    'serviceMessages.changed': ServiceMessage[];
    'writeLog.appended': WriteLogEntry;
    /** Progress of a bulk write: done of total, last result. */
    'write.progress': {done: number; total: number; last?: WriteResult};
    'config.changed': AppConfig;
    /** Backend-side problem the user should see (ReGa down, port in use, ...). */
    notice: {level: 'info' | 'warn' | 'error'; message: string; interfaceName?: string};
}

export type ApiEventName = keyof ApiEvents;

/** Error shape every transport delivers for a rejected request. */
export interface ApiError {
    message: string;
    /** XML-RPC fault code when the interface process answered with a fault. */
    faultCode?: number;
    faultString?: string;
    /** Machine-readable class: `rpc`, `validation`, `connection`, `config`, `internal`. */
    kind: 'rpc' | 'validation' | 'connection' | 'config' | 'internal';
    problems?: WriteProblem[];
}

/** What the UI talks to. Implemented over Electron IPC and over WebSocket; mocked in tests. */
export interface Transport {
    request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>>;
    /** Returns the unsubscribe function. */
    on<E extends ApiEventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void;
    /** Transport-level connection to the backend (not the CCU). */
    readonly connected: boolean;
    onConnectionChange(handler: (connected: boolean) => void): () => void;
}

/** Wire format of both transports (Electron IPC channel `api`, WebSocket JSON frames). */
export type ApiFrame =
    | {t: 'req'; id: number; m: ApiMethodName; p: unknown[]}
    | {t: 'res'; id: number; r: unknown}
    | {t: 'err'; id: number; e: ApiError}
    | {t: 'ev'; n: ApiEventName; d: unknown};
