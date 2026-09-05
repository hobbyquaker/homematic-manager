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
    /**
     * We run on the CCU itself and talk to the interface processes directly, past the lighttpd
     * proxy: binrpc on 32001/32000, hmipserver on 32010, the group process on 39292, ReGa on 8183
     * and no CCU authentication. What the addon of task 13 sets; `local` wins over `tls`.
     */
    local?: boolean;
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
    /**
     * Issue #26: acknowledge `STICKY_UNREACH` as soon as it is reported, instead of leaving it in
     * the service-message list until somebody presses the button.
     *
     * Off by default and never on by accident: acknowledging is a write to the device, and a user
     * who watches the list to see *which* devices were unreachable would lose exactly that. The
     * unreach counter is what replaces it - it is kept whether this is on or off, so the
     * information survives the acknowledgement.
     *
     * Nothing to do with ReGa (D-2): this writes the datapoint through the interface process, the
     * same call the acknowledge button makes.
     */
    autoAckStickyUnreach?: boolean;
    /**
     * Issue #54: confirm a newly paired device out of the CCU's inbox by itself.
     *
     * A device that has just been paired sits in the WebUI's Posteingang with `ReadyConfig()` false
     * until somebody presses "fertig" there, and until then the CCU's own lists ignore it - which is
     * confusing when the device is plainly there in this application, which talks to the interface
     * process and never looked at the inbox.
     *
     * Requires ReGa (D-2): without it there is no inbox and this does nothing at all. Off by
     * default, because confirming is what a user may want to do in the WebUI, with its device
     * configuration dialog, rather than have happen behind their back.
     */
    autoConfirmRegaInbox?: boolean;
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
    /**
     * Nothing is listening on that port: the interface process does not exist on this system.
     *
     * A CCU without a wired gateway answers like this for BidCos-Wired, which is in the default
     * interface list. The manager then backs off (up to five minutes between attempts) instead of
     * retrying every 15 s, and the UI shows "not present" rather than a connection error.
     */
    absent?: boolean;
    /**
     * `init` has been sent and the first `listDevices` / service-message sweep after it is still
     * running. The UI shows "subscribing" for as long as this is true: `hmipserver` re-sends every
     * device on `init` (occu#45) and the grids are not complete until that has been taken in.
     */
    subscribing?: boolean;
    /**
     * D-31: no UI session was connected for the grace period, so the backend sent `init('')` and
     * the interface pushes nothing at us. Caches, names and the configuration are untouched; the
     * next session that connects subscribes again. Never set in Electron.
     */
    idle?: boolean;
}

/**
 * Issue #26: how often a device went unreachable, kept per CCU across restarts.
 *
 * `UNREACH` and `STICKY_UNREACH` are the two datapoints that say it; the first one comes and goes
 * with the radio, the second one stays until it is acknowledged. Either of them going true counts,
 * once - a device that is unreachable for an hour and reports it three times is one outage as far
 * as this is concerned, because it is one continuous state and not three.
 */
export interface UnreachCounter {
    interfaceName: string;
    /** The device address, never a channel: `:0` is where the datapoint lives, not what failed. */
    address: string;
    count: number;
    /** Milliseconds since epoch of the last time it went unreachable. */
    lastAt?: number;
    /** True while the device is unreachable now. */
    unreach?: boolean;
}

/**
 * Issue #21: a tuned link profile, saved under a name and applied to another link.
 *
 * What is kept is the easy-mode profile *and* the values it was tuned to - the profile alone is
 * already in the metadata, and it is the tuning that is worth saving. Templates live in the profile
 * directory, not in a per-CCU cache: they are the user's own work and they move with the profile.
 */
export interface LinkTemplate {
    name: string;
    /**
     * The receiver's and the sender's `LINK` paramset identity, joined - device type, firmware,
     * version and channel type on both sides. A template may only be applied where this matches,
     * for the same reason multi-apply is limited that way (task 6, item 3).
     */
    identity: string;
    /** The easy-mode profile the values follow, when they follow one. */
    profileId?: number;
    profileName?: string;
    /** The receiver-side `LINK` values. */
    receiver: ParamsetWrite;
    /** The sender-side ones, where the sender has any. */
    sender?: ParamsetWrite;
    /** Milliseconds since epoch. */
    createdAt: number;
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

/** What `devices.repairConfig` may do beyond writing a valid MASTER paramset back. */
export interface RepairConfigOptions {
    /** Work out the repair and return it without writing anything. */
    dryRun?: boolean;
    /**
     * Repair only these channels; by default every channel of the device that has a `MASTER`
     * paramset, plus the device's own.
     */
    channels?: string[];
    /**
     * BidCos only. `clearConfigCache` drops the interface process' cached configuration,
     * `restoreConfigToDevice` re-sends it. Both answer `-1 Generic error` on hmipserver, so they
     * are never called for an HmIP interface whatever this says (task 6, `docs/config-pending.md`).
     */
    bidcosRecovery?: 'none' | 'clearConfigCache' | 'restoreConfigToDevice';
}

/** One parameter the repair replaces, and why. */
export interface RepairCorrection {
    parameter: string;
    /** What the interface process has stored. */
    stored: RpcValue;
    /** What will be written instead. */
    replacement: RpcWriteValue;
    reason: string;
}

/** What the repair found on one channel and what it wrote there. */
export interface RepairChannelResult {
    address: string;
    /**
     * Parameters the interface process stores although the paramset description does not have
     * them. They cannot be removed through the RPC API - on hmipserver they make every further
     * `putParamset` on the channel fault, and only re-pairing the device clears them.
     */
    unknown: string[];
    /** Stored values that are not valid for their parameter, with what replaces them. */
    corrected: RepairCorrection[];
    /** The write, exactly as `paramset.put` would report it. */
    write: WriteResult;
}

/** The answer of `devices.repairConfig`. */
export interface RepairConfigResult {
    interfaceName: string;
    address: string;
    /** `CONFIG_PENDING` of `<device>:0` before and after; `undefined` when it could not be read. */
    configPendingBefore?: boolean;
    configPendingAfter?: boolean;
    channels: RepairChannelResult[];
    /**
     * Channels the repair cannot fix because the interface process stores a parameter their
     * description does not have. The UI has to say what that means: the device has to be deleted
     * and paired again, or a CCU backup from before the bad write restored.
     */
    unrepairable: string[];
    /** The BidCos recovery that was called, if any. */
    bidcosRecovery?: 'clearConfigCache' | 'restoreConfigToDevice';
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
    /**
     * Issue #54: confirm every device that is still in the CCU's inbox, and answer with the
     * addresses. Without ReGa (D-2) the answer is an empty list and nothing happened.
     */
    'rega.confirmInbox': {params: []; result: string[]};

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
    /**
     * "Repair configuration" (task 6, item 7), built from the recovery the lab measured: a valid
     * full `MASTER` write per channel, made from that channel's own description and its stored
     * values. It clears a sticky `CONFIG_PENDING` and replaces values the interface process kept
     * although they are not valid; it cannot remove a parameter the channel does not have, and
     * reports those channels as `unrepairable` instead of pretending.
     */
    'devices.repairConfig': {
        params: [interfaceName: string, address: string, options?: RepairConfigOptions];
        result: RepairConfigResult;
    };
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
    /** Issue #21: the saved link templates, all of them or those that fit one identity. */
    'linkTemplates.list': {params: [identity?: string]; result: LinkTemplate[]};
    /** Saves one; a name that exists is replaced. Returns the whole list. */
    'linkTemplates.save': {params: [template: LinkTemplate]; result: LinkTemplate[]};
    'linkTemplates.remove': {params: [name: string]; result: LinkTemplate[]};

    'rssi.get': {params: [interfaceName: string]; result: RssiInfo};
    'bidcos.interfaces': {params: [interfaceName: string]; result: BidcosInterfaceInfo[]};
    'bidcos.setInterface': {
        params: [interfaceName: string, address: string, bidcosInterface: string, roaming: boolean];
        result: null;
    };

    /** Issue #26: the unreach counters, all of them or those of one interface. */
    'unreach.list': {params: [interfaceName?: string]; result: UnreachCounter[]};
    /** Resets one device's counter, an interface's, or every one of them. */
    'unreach.reset': {params: [interfaceName?: string, address?: string]; result: null};

    'serviceMessages.list': {params: [interfaceName?: string]; result: ServiceMessage[]};
    /** Acknowledge by writing the datapoint (STICKY_UNREACH etc.). */
    'serviceMessages.ack': {params: [interfaceName: string, address: string, datapoint: string]; result: null};

    'events.recent': {params: [interfaceName?: string, limit?: number]; result: EventRecord[]};
    'events.clear': {params: []; result: null};

    /** The RPC console: any method, any params; goes through the write log when it is a write. */
    'rpc.call': {params: [interfaceName: string, method: string, params: RpcValue[]]; result: RpcValue};
    'rpc.methods': {params: [interfaceName: string]; result: RpcMethodInfo[]};

    /**
     * Cancels the writes of a bulk operation that have not started yet, on one interface or on all
     * of them; the result is how many were dropped. A call that is already on the wire is not
     * taken back - it cannot be - so the `WriteResult[]` of the running operation ends early with
     * the cancelled target as its last entry. Added in task 4 for the "cancel" button of task 6.4.
     */
    'write.cancel': {params: [interfaceName?: string]; result: number};

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
    /** Issue #26: a device went unreachable, or a counter was reset. */
    'unreach.changed': UnreachCounter[];
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

/**
 * Every event of {@link ApiEvents} as a runtime value, because a type has none.
 *
 * `satisfies Record<ApiEventName, true>` checks the contract in both directions: a new event added
 * to `ApiEvents` and forgotten here fails to compile, and a name here that is not an event does
 * too. Every transport subscribes to exactly this list - the Electron IPC bridge, the WebSocket
 * server, the mock - so "the backend pushes it but the UI never sees it" cannot happen by omission.
 */
const API_EVENT_FLAGS = {
    'interfaces.changed': true,
    'rega.changed': true,
    'devices.changed': true,
    'names.changed': true,
    'rpc.event': true,
    'serviceMessages.changed': true,
    'writeLog.appended': true,
    'write.progress': true,
    'unreach.changed': true,
    'config.changed': true,
    notice: true,
} as const satisfies Record<ApiEventName, true>;

/** The ten event names of {@link ApiEvents}, in the order the contract declares them. */
export const API_EVENT_NAMES: readonly ApiEventName[] = Object.freeze(Object.keys(API_EVENT_FLAGS) as ApiEventName[]);
