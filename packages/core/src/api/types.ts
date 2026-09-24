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
import type {LanguageChoice} from '../data/types.js';
import type {MetaDocument, MetaEnum, MetaHmipPairing, MetaImportMode, MetaNodePatch} from '../meta/types.js';

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
    /**
     * D-40: where names, rooms and functions come from.
     *
     * `auto` (the default, and what every existing profile means) probes
     * `GET /api/meta/v1/version` on the configured host once per connect: an openccu-lite box
     * answers and its store is used, a CCU answers 404 and nothing changes. `local` never probes
     * and keeps everything in this profile; `occulite` insists on the box and says so when it is
     * not there, which is what a user behind a proxy that swallows the probe needs.
     *
     * `rega` (task 27) is the CCU's own rooms and functions through ReGaHSS: `auto` picks it when
     * there is no box and ReGa (switched on with `rega` above) answered, so a CCU gets the same
     * editing UI the box has, on ReGa's own objects. A box either has ReGa or the metadata API,
     * never both.
     */
    metaProvider?: MetaProviderChoice;
    /**
     * The API token for the metadata store, for an installation that is **not** on the box.
     *
     * Created on the box's Users page (`olt_…`, role `user` reads, `admin` also writes) and stored
     * like any other credential here. On the box itself this stays empty: the addon reads the local
     * token from `/usr/local/etc/occulite/local-token` for reads and uses the session of whoever
     * opened the page for writes.
     */
    metaToken?: string;
    /**
     * The box's base URL, when it is not `http(s)://<host>`.
     *
     * For a reverse proxy on another port and for the integration tests. Empty means "derive it
     * from `host`, `tls` and `local`", which is what every real installation wants.
     */
    metaUrl?: string;
    /**
     * Address and ports the interface processes call back to. A port of `0` is "none configured":
     * the host's default port where it has one (the CCU addon's fixed pair, task 35), a free port
     * from the kernel everywhere else.
     */
    callback: {ip: string; xmlrpcPort: number; binrpcPort: number};
    /**
     * The language the UI starts in, or `auto`/absent for "the browser decides" (D-36).
     *
     * Optional since 3.0.0-dev.7: the 2.x default was German first, and a backend that writes a
     * language into a fresh profile forces one on every user who never opened the setting. Unset
     * means the UI takes the first supported entry of `navigator.languages` with English behind
     * it; a value here is a choice the user made in the settings dialog and wins over the browser.
     */
    language?: LanguageChoice;
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
    /**
     * B-70 (D-31): how long the host waits with no UI session before it drops its event
     * subscriptions, in milliseconds; `0` is "never". Absent means the host's default
     * ({@link AppConfig.idleUnsubscribe}). Only a host that goes idle reads it - never Electron,
     * whose window is the session - and a value the host was started with wins over it.
     */
    idleUnsubscribeMs?: number;
    /**
     * B-67: the certificates of the system this profile trusts beyond the platform's CAs, for the
     * system's own HTTP APIs (the metadata store, the groups). Added from the settings dialog, where
     * a certificate error shows what the system presented.
     */
    systemTrust?: SystemTrust;
}

/** B-67: what a profile trusts on the system's `https://` besides the platform's CAs. */
export interface SystemTrust {
    /**
     * SHA-256 fingerprints (`AB:CD:…`) of certificates trusted as they are - whatever name the
     * system is reached by, an IP address included. A renewed certificate is a new one.
     */
    certificates?: string[];
    /** CA certificates (PEM) trusted for the chain; the name must still fit the host. */
    cas?: string[];
}

/** B-67: one certificate as the settings dialog shows it. */
export interface SystemCertificate {
    /** The common name, else the organisation. */
    subject: string;
    issuer: string;
    /** SHA-256, `AB:CD:…`. */
    fingerprint256: string;
    /** As OpenSSL prints it (`Dec 24 12:00:00 2026 GMT`). */
    validTo: string;
    /** `DNS:lab.example, IP Address:10.0.0.2`, when the certificate has any. */
    altNames?: string;
}

/**
 * B-67: the system answered on `https://` with a certificate nothing trusts. `code` is Node's
 * (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `CERT_HAS_EXPIRED`,
 * `ERR_TLS_CERT_ALTNAME_INVALID`, …); `ca` is the topmost CA of the chain it sent, when it sent one.
 */
export interface SystemCertificateProblem {
    /** The `https://` origin that presented it. */
    url: string;
    code: string;
    certificate: SystemCertificate;
    ca?: SystemCertificate & {pem: string};
}

export interface AppConfig {
    version: string;
    connection: ConnectionConfig;
    /** IPv4 addresses of this machine, candidates for `connection.callback.ip`. */
    localAddresses: string[];
    /** CCUs found by UDP discovery (host names or addresses with what answered). */
    discovered: DiscoveredCcu[];
    /**
     * Task 35 (D-43): the callback ports this host takes while `connection.callback` says `0`. Only
     * the CCU addon has them; absent, a `0` is a free port. A property of the host, never written
     * to the profile, so the settings dialog can say what `0` means without changing what it saves.
     */
    callbackDefaultPorts?: {xmlrpc: number; binrpc: number};
    /**
     * Task 38: the callback fields the host was started with (`HMM_CALLBACK_*` or `--callback-*`).
     * Such a value wins over the profile's, the backend never saves another one over it, and the
     * settings dialog shows it read-only with the option that set it ({@link CALLBACK_PIN_OPTIONS}).
     * Absent where the host pins nothing.
     */
    callbackPinned?: CallbackPins;
    /**
     * Task 38: the host runs in a container and its callback servers listen beyond the loopback,
     * so the ports the interfaces are told only work when they are published unchanged. The
     * interface popup says so beside each callback URL. Absent everywhere else.
     */
    publishCallbackPorts?: boolean;
    /**
     * B-70 (D-31): this host drops its event subscriptions after a while with no UI session, and
     * the settings dialog offers the time. `defaultMs` is what an unset profile gets; `pinnedMs`
     * is the value the host was started with (`HMM_IDLE_UNSUBSCRIBE`, `--idle-unsubscribe`, the
     * addon's settings page), which wins over the profile and is shown read-only. `0` is "never".
     * Absent on a host that never goes idle (Electron).
     */
    idleUnsubscribe?: {defaultMs: number; pinnedMs?: number};
}

/**
 * B-53 (#162, #165): why the automatic callback address is the one it is.
 *
 * - `loopback`: the interface processes are on this machine (`local`, or a CCU at `127.x`);
 * - `subnet`: the address of this machine in the CCU's own network;
 * - `route`: no address shares the CCU's network, so the one the operating system sends from
 *   towards the CCU (a routed CCU, a VPN);
 * - `first`: neither could be found out (no CCU configured, a name that does not resolve), so the
 *   first address of this machine that is not link-local - the only rule there was until beta.18.
 */
export type CallbackAutoReason = 'loopback' | 'subnet' | 'route' | 'first';

/** B-53: one address of this machine, as the settings dialog offers it. */
export interface CallbackAddressCandidate {
    address: string;
    /** In the CCU's network (its `address/netmask` holds the CCU); always false while the CCU's address is unknown. */
    inSubnet: boolean;
    /** `169.254.0.0/16`: never chosen automatically unless the CCU is there too. */
    linkLocal?: boolean;
}

/**
 * B-53: what `config.callbackAddresses` answers - the address the backend takes when none is set,
 * and every address of this machine with whether it is in the CCU's network.
 */
export interface CallbackAddressInfo {
    /** The CCU host it was worked out for. */
    host: string;
    /** That host's IPv4 address; absent when it could not be resolved (or no host is set). */
    hostAddress?: string;
    auto: {address: string; reason: CallbackAutoReason};
    /** The machine's IPv4 addresses in the operating system's order, the loopback last. */
    addresses: CallbackAddressCandidate[];
    /**
     * The host takes a set address as it is, even one that is not on this machine: it was set at
     * start (task 38) or the host runs in a container, where the Docker host's address is the right
     * one. The dialog then warns about nothing.
     */
    keepsConfigured?: boolean;
}

/**
 * B-53: a set callback address that does not fit. `notLocal`: it is no address of this machine
 * any more (another lease, another network), so the automatic one is used instead. `otherNetwork`:
 * it is one, but neither in the CCU's network nor the one this machine sends from towards the CCU;
 * it is used as set, and the CCU may well not reach it.
 */
export interface CallbackWarning {
    address: string;
    reason: 'notLocal' | 'otherNetwork';
    /** The address the automatic choice would take (and, for `notLocal`, takes). */
    auto: string;
}

/** Task 38: which of `connection.callback`'s fields the host set at start. */
export interface CallbackPins {
    ip?: boolean;
    xmlrpcPort?: boolean;
    binrpcPort?: boolean;
}

/**
 * Task 38: the environment variable and command-line option behind each callback field, for the
 * settings dialog's read-only hint and the backend's log lines - one table, so the two cannot name
 * different options.
 */
export const CALLBACK_PIN_OPTIONS: Readonly<Record<keyof CallbackPins, {env: string; cli: string}>> = Object.freeze({
    ip: {env: 'HMM_CALLBACK_IP', cli: '--callback-ip'},
    xmlrpcPort: {env: 'HMM_CALLBACK_XMLRPC_PORT', cli: '--callback-xmlrpc-port'},
    binrpcPort: {env: 'HMM_CALLBACK_BINRPC_PORT', cli: '--callback-binrpc-port'},
});

/** Task 38: `HMM_CALLBACK_XMLRPC_PORT / --callback-xmlrpc-port`, as the hint and the log write it. */
export function callbackPinOption(field: keyof CallbackPins): string {
    const {env, cli} = CALLBACK_PIN_OPTIONS[field];
    return `${env} / ${cli}`;
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
    /**
     * The connection to this interface process is encrypted - the CCU's 42xxx ports.
     *
     * Only present when it is true, so the state of a plain installation stays the object it was.
     * The interface popup shows it beside protocol and port, because the port number alone says it
     * only to somebody who knows the CCU's port table by heart.
     */
    tls?: boolean;
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
     * B-28: the interface did not answer in time - its `init` or the port probe timed out, or its
     * host has no route. Not the same as {@link absent}: the process may well be there, only slow or
     * away for a moment (a CCU-Jack, a remote CUxD). It stays configured and shown, the watchdog tries
     * it again, and the UI says "not answering" and offers to try at once. Present only when true.
     */
    unreachable?: boolean;
    /**
     * `init` has been sent and the first `listDevices` / service-message sweep after it is still
     * running. The UI shows "subscribing" for as long as this is true: `hmipserver` re-sends every
     * device on `init` (occu#45) and the grids are not complete until that has been taken in.
     */
    subscribing?: boolean;
    /**
     * Task 56 (D-52): the interface refused or did not answer its `init` at the start, and is tried
     * again within seconds (1, 2, 4, 8 s, then every 2 s) for the first two minutes. On
     * openccu-lite that is the interface process not having started yet, so the UI shows "waiting"
     * rather than "not present" or "not answering". Present only when true.
     */
    waiting?: boolean;
    /**
     * B-56 (D-53): the interface was connected, stopped answering its liveness ping (HmIP-RF: no
     * PONG within 10 s after 30 s of silence), and is being subscribed again - on the quick
     * schedule of {@link waiting}. After an hmipserver restart this is what bridges the time until
     * the process answers `init` again. The UI shows "reconnecting". Present only when true.
     */
    reconnecting?: boolean;
    /**
     * D-31: no UI session was connected for the grace period, so the backend sent `init('')` and
     * the interface pushes nothing at us. Caches, names and the configuration are untouched; the
     * next session that connects subscribes again. Never set in Electron.
     */
    idle?: boolean;
    /**
     * Task 38: the URL this interface was told to call back on in its last `init` -
     * `http://<callback ip>:<port>` for XML-RPC, `xmlrpc_bin://…` for BIN-RPC. Absent for an
     * interface that takes no `init`, and while its callback server could not be opened.
     */
    callbackUrl?: string;
    /**
     * Task 38: the fixed callback port of this interface's protocol could not be opened, so it is
     * not subscribed. `inUse` is the common case - another process holds the port - and there is no
     * free port instead: a fixed port is the one that was published or opened in a firewall.
     */
    callbackFailure?: {port: number; inUse: boolean};
    /**
     * B-53: the callback address set in the settings does not fit this machine or the CCU's
     * network. The interface popup shows it with a one-click switch to the automatic address.
     */
    callbackWarning?: CallbackWarning;
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
    /**
     * B-62: why ReGa is off although the profile has it on. `openccu-lite`: the connected system is
     * an openccu-lite, which has no ReGaHSS - nothing is called, and the settings say so.
     */
    reason?: 'openccu-lite';
    /**
     * B-64: addresses whose name was set here but has not reached ReGa - a device still in the
     * CCU's inbox has no ReGa object id yet. They are renamed on the CCU once the inbox is
     * confirmed through this application (the button or the auto-confirm). Absent when none wait.
     */
    pendingNames?: string[];
}

/** Friendly names: address -> name (devices and channels), from ReGa or the local store. */
export type NameMap = Record<string, string>;

/** D-40: which metadata provider a profile asks for; `rega` since task 27. */
export type MetaProviderChoice = 'auto' | 'local' | 'occulite' | 'rega';

/** The values of {@link MetaProviderChoice} as a runtime list, for validation and a select. */
export const META_PROVIDERS: readonly MetaProviderChoice[] = Object.freeze(['auto', 'local', 'occulite', 'rega']);

/**
 * D-40: which store the names, rooms and functions come from, and whether it can be written.
 *
 * Shown next to the ReGa indicator, and for the same reason: a user has to be able to see where the
 * name in the grid came from before they wonder why renaming it did not change anything in the
 * other application.
 */
export interface MetaState {
    /**
     * `local` is this profile's own store, `occulite` an openccu-lite box, `rega` the CCU's own
     * rooms and functions through ReGaHSS (task 27).
     */
    provider: 'local' | 'occulite' | 'rega';
    /** For `occulite` and `rega`: the other side answered. Always true for `local`. */
    reachable: boolean;
    /**
     * Writes are accepted.
     *
     * False on a box whose credential only has the `user` role - the local token of an addon, or a
     * read-only API token - which is a normal state and not an error: the names are shown, the
     * rename button says why it cannot be used.
     */
    writable: boolean;
    /** The store's revision; `0` for a fresh one. */
    revision: number;
    /** How many devices and channels the store knows. */
    objects: number;
    /** `occulited 0.1.0`, from `/api/meta/v1/version`. */
    implementation?: string;
    /**
     * The provider's taxonomies are flat lists: no node below another, no new taxonomy. The
     * editing UI (task 25) hides "add below" and "move" then and says so. Absent means trees.
     */
    flat?: boolean;
    /** The base URL the provider talks to, for the settings dialog and the log. */
    url?: string;
    error?: string;
    /**
     * B-67: the host (or `metaUrl`) redirected to `https://` and its certificate is not trusted, so
     * whether it is an openccu-lite system is not known. The provider is the fallback meanwhile;
     * the settings dialog shows this and offers to trust the certificate or its CA.
     */
    certificate?: SystemCertificateProblem;
}

/**
 * One device or channel as the UI shows it: the name, the paths it is a member of, and those paths
 * as the arrays of names every consumer of ReGa's rooms and functions has always been given.
 *
 * Keyed by **ref** (`<interface>.<address>`), not by address: the metadata store's identity is the
 * ref, and two interfaces may in principle report the same address. `makeRef(interfaceName,
 * address)` builds one.
 */
export interface MetaObjectView {
    name: string;
    /** Node paths, e.g. `room/eg/wohnzimmer`. */
    enums: string[];
    /** The names of the `room` nodes it belongs to, in tree order. */
    rooms: string[];
    /** The same for `function`. */
    functions: string[];
    /** The box says the address is no longer reported by any interface. */
    orphaned?: boolean;
}

/** Everything the UI needs about the store in one answer: the state, the trees and the objects. */
export interface MetaSnapshot {
    state: MetaState;
    enums: Record<string, MetaEnum>;
    objects: Record<string, MetaObjectView>;
}

/*
 * Task 57: the heating groups of openccu-lite - the `VirtualDevices` group devices `INT000000N`.
 *
 * They are made, changed and deleted through the box's system API (`/api/system/v1/groups`), not
 * through RPC: the group process has no method for any of it. On a CCU there is no such API, and
 * the WebUI's own way needs a WebUI session, which D-1 rules out - so the feature exists on
 * openccu-lite only, and the state below says whether it does.
 */

/** A device or channel as the group process knows it. On openccu-lite `id` is the address. */
export interface HeatingGroupMember {
    id: string;
    serial: string;
    /** The device type, or the channel role (`REMOTE_CONTROL`) for an HmIP channel. */
    type: string;
}

/** One of the group types the editor offers, with what a new group of it could take right now. */
export interface HeatingGroupType {
    /** `HomeMatic.heating`, `hmip.heating.group`. */
    id: string;
    /** The label as the box reports it (`Heating_Control`, `HmIP-Heizungssteuerung`). */
    label: string;
    /** The devices a new group of this type could take. */
    assignable: HeatingGroupMember[];
    /** The devices that fit the type but are already connected elsewhere - shown, never offered. */
    leftover: HeatingGroupMember[];
}

/** A group as the list shows it. */
export interface HeatingGroup {
    id: number;
    name: string;
    type: string;
    typeLabel: string;
    /** The group device's address on VirtualDevices, `INT0000001`. */
    device: string;
    /** The group device's metadata ref, `VirtualDevices.INT0000001`. */
    ref: string;
    /** The members; the list reads every group once for them. */
    members: HeatingGroupMember[];
}

/** One group as the editor needs it: its members, what it could take, what fits no more. */
export interface HeatingGroupDetail extends HeatingGroup {
    /** The name the group device carries in the group store; the metadata store's name wins. */
    deviceName: string;
    forbidSingleOperation: boolean;
    assignable: HeatingGroupMember[];
    leftover: HeatingGroupMember[];
    types: Array<{id: string; label: string}>;
}

export interface HeatingGroupList {
    groups: HeatingGroup[];
    /** The members whose configuration is still pending from the last change. */
    devicesToConfigure: HeatingGroupMember[];
}

/** What a create or a change answers with: the group, and who still has to be configured. */
export interface HeatingGroupChange extends HeatingGroupDetail {
    devicesToConfigure: HeatingGroupMember[];
}

/**
 * Whether this connection has heating groups at all.
 *
 * `available` is true when the box answered the group list. The reason says why not otherwise:
 * `no-box` on a CCU, Homegear or a bare interface process; `unsupported` on a box without the
 * group process (a development root); `not-offered` on an older box whose API has no groups;
 * `forbidden` when the credential may not read them (the addon's local token only reads metadata,
 * so the person's session is what lets the tab in); `error` for anything else, with the message.
 */
export interface HeatingGroupsState {
    available: boolean;
    reason?: 'no-box' | 'unsupported' | 'not-offered' | 'forbidden' | 'error';
    message?: string;
}

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
    /**
     * Task 36: `rega` when `since` is the CCU's own first report of the message (ReGa's alarm, the
     * WebUI's *Erste Meldung*); absent when it is when this application first saw it.
     */
    sinceSource?: 'rega';
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

/**
 * Task 48: who asked for an RPC call. `console` is the RPC console, `ui` any other action of a
 * user session (a tab's refresh, a paramset write, pairing), `background` the backend on its own
 * - `init` and de-init, the keep-alive `ping`, the polls and sweeps after an event or a connect.
 */
export type RpcOrigin = 'console' | 'ui' | 'background';

export const RPC_ORIGINS: readonly RpcOrigin[] = Object.freeze(['console', 'ui', 'background']);

/**
 * One outgoing RPC call, as the RPC log keeps it (task 48: every call, not only the writes).
 *
 * The parameters are what went on the wire, verbatim - a `putParamset` in `CONFIG_PENDING` is
 * traced from them - except the keys of `changeKey`, `setTempKey` and a whitelist, which are
 * logged as `***`. A result over the log's size cap is kept as a preview string and `resultBytes`
 * says how big the whole answer was.
 */
export interface RpcLogEntry {
    id: number;
    timestamp: number;
    interfaceName: string;
    method: string;
    params: RpcValue[];
    ok: boolean;
    result?: RpcValue;
    /** Set when `result` is a preview of an answer too big for the log: the size of the whole answer, in bytes. */
    resultBytes?: number;
    error?: string;
    durationMs: number;
    origin: RpcOrigin;
}

export interface InstallModeOptions {
    /** Seconds; the interface's default when omitted. */
    seconds?: number;
    /** BidCos: install mode kind (1 normal, 2 with temporary key). */
    mode?: number;
    /** HmIP: the device key (SGTIN + key from the QR code or the sticker). */
    hmipKey?: {sgtin: string; key: string};
    /**
     * HmIP: how the device is admitted. `KEY` whitelists the SGTIN with its key (the only way that
     * works offline), `SGTIN` whitelists the SGTIN and takes the key from eQ-3's key server, and
     * `ANY` (task 28) admits whatever device in factory state asks to join: `setInstallMode(true,
     * seconds)` with exactly two arguments, `hmipKey` ignored.
     */
    hmipKeyMode?: 'KEY' | 'SGTIN' | 'ANY';
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
 * D-32: who the host thinks is asking, when the host has a login at all.
 *
 * Read-only and additive. Only the CCU addon in `--auth-mode rega` ever fills it in - Electron, the
 * npm install, Docker and the demo have no session concept and answer `null`, which the UI shows as
 * nothing at all. `level` is ReGa's `UserLevel()`: 8 admin, 2 user, 1 guest. It is *shown*, not
 * enforced: everyone who may log in may write, exactly as in the CCU's own WebUI. Gating writes to
 * admins is a later decision, and this field is what it would be built on.
 */
export interface SessionInfo {
    /** The CCU user name the session was opened with. */
    user: string;
    /** ReGa `UserLevel()`; `0` when ReGa reported none. */
    level: number;
}

/** What a save does besides storing the connection - `config.set`'s optional second argument. */
export interface ConfigSetOptions {
    /**
     * Task 34 (#147, D-42): the answer to the question the settings dialog asks when
     * `autoAckStickyUnreach` is switched on - acknowledge the `STICKY_UNREACH` messages that are
     * already in the list as well, not only the ones that appear afterwards.
     *
     * It counts only on the save that switches the option from off to on, and only for the CCU the
     * list belongs to (a save that also changes the host acknowledges nothing). Each message gets
     * exactly the write of `serviceMessages.ack`; HmIP messages are left alone.
     */
    acknowledgeExisting?: boolean;
}

/**
 * Request methods: `params` is the positional tuple the UI sends, `result` what it receives.
 * Every method rejects with `ApiError` on failure; RPC faults keep their `faultCode`. Methods
 * without a result value resolve with `null`, which both transports carry verbatim.
 */
export interface ApiMethods {
    'config.get': {params: []; result: AppConfig};
    /** Persist and reconnect. */
    'config.set': {params: [connection: ConnectionConfig, options?: ConfigSetOptions]; result: AppConfig};
    'config.discover': {params: []; result: DiscoveredCcu[]};
    'config.clearCaches': {params: []; result: null};
    /**
     * B-53: the automatic callback address and this machine's addresses, worked out for `host` -
     * the one being typed into the settings dialog - or the configured CCU when it is absent.
     */
    'config.callbackAddresses': {params: [host?: string]; result: CallbackAddressInfo};

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
    /**
     * Issue #97: the teams an interface process knows, as device descriptions.
     *
     * A BidCos smoke detector is not linked to the others; it belongs to a *team*, a pseudo device
     * (`HM-Sec-SD-Team`) whose `TEAM_CHANNELS` are its members. Every channel that can join one
     * carries a `TEAM_TAG` saying which family of team it fits and a `TEAM` saying which one it is
     * in right now - each detector starts in a team of its own, which is what the report describes.
     */
    'teams.list': {params: [interfaceName: string]; result: DeviceDescription[]};
    /**
     * `setTeam(channelAddress, teamAddress)`: puts a channel into a team. An empty `teamAddress`
     * puts it back into its own. The interface process creates and deletes the team devices as
     * needed - there is no "create team" call, and none is wanted.
     */
    'teams.set': {params: [interfaceName: string, channelAddress: string, teamAddress: string]; result: null};

    'names.get': {params: []; result: NameMap};
    'names.set': {params: [entries: Array<{address: string; name: string}>]; result: NameMap};

    /*
     * D-40: the metadata store - names, rooms, functions and any other taxonomy the user made.
     *
     * Every one of these works with both providers. With `local` they change this profile's own
     * store; with `occulite` they are written through the box's metadata API, because on
     * openccu-lite this application *is* the editor of that store. A write that the credential is
     * not allowed to make rejects with `kind: 'validation'` and the API's own message rather than
     * being hidden - the user has to know that their rename went nowhere.
     */
    'meta.state': {params: []; result: MetaState};
    /** The state, the trees and every object in one answer; what the UI asks for on connect. */
    'meta.get': {params: []; result: MetaSnapshot};
    /** Every taxonomy with its tree. */
    'meta.enums': {params: []; result: Record<string, MetaEnum>};
    /** Every device and channel the store knows, keyed by ref. */
    'meta.objects': {params: []; result: Record<string, MetaObjectView>};
    /** The membership of one object: the complete list of paths it should have afterwards. */
    'meta.setMembership': {params: [entries: Array<{ref: string; paths: string[]}>]; result: null};
    /**
     * The interaction that matters: select rows in the grid, assign them to a room.
     *
     * `on: false` takes them out of it again. One revision for the whole selection, so a consumer
     * of the change stream sees one change and not forty.
     */
    'meta.assign': {params: [refs: string[], path: string, on: boolean]; result: null};
    /** A new taxonomy beside `room` and `function`. */
    'meta.enum.create': {params: [id: string, name: Record<string, string>]; result: null};
    'meta.enum.update': {params: [id: string, name: Record<string, string>]; result: null};
    /** Refused while it has members unless `detach` is true; the UI lists them first. */
    'meta.enum.delete': {params: [id: string, detach?: boolean]; result: null};
    /**
     * A node - a room, a floor, a function. The id is derived from the name and is stable
     * afterwards; the answer is the path the node got.
     */
    'meta.node.create': {
        params: [
            enumId: string,
            /**
             * The parent node's path, or **absent** for a node at the root of the taxonomy.
             *
             * Absent and not `null`: the backend turns a `null` parameter into `undefined` because
             * the two transports disagree about which of them an omitted argument becomes
             * (`JSON.stringify` writes `null`, structured clone keeps `undefined`), so no method of
             * this contract may give `null` a meaning of its own.
             */
            parent: string | undefined,
            name: string,
            options?: {icon?: string; position?: number},
        ];
        result: string;
    };
    'meta.node.update': {params: [path: string, patch: MetaNodePatch]; result: null};
    'meta.node.delete': {params: [path: string, detach?: boolean]; result: null};
    /**
     * Reads the store again and answers with its state. The box has a change stream and never
     * needs this; ReGa has none, so a room made in the WebUI shows up here only after a refresh -
     * on connect, after every write of our own, and when the user asks (task 27).
     */
    'meta.refresh': {params: []; result: MetaState};
    /**
     * Task 66: what the system says about HmIP pairing, asked afresh each time (a mode switch on
     * the system shows in the next answer). `null` wherever there is nothing to say: a CCU, a
     * system from before openccu-lite task 192, a system that does not answer, no connection.
     */
    'meta.pairing': {params: []; result: MetaHmipPairing | null};
    /** The whole document, for a backup or a move between installations. */
    'meta.export': {params: []; result: MetaDocument};
    'meta.import': {params: [document: unknown, mode?: MetaImportMode]; result: null};

    /*
     * Task 57: the heating groups of openccu-lite, through the box's system API. Every one of these
     * answers `kind: 'config'` with the reason where there is no box, and the API's own message
     * (`kind: 'validation'` for a refused body, `'config'` for a credential without the right,
     * `'connection'` for a box that does not answer) otherwise.
     */
    /** Is there a groups API behind this connection? Asked once per connect, and after a reconnect. */
    'groups.state': {params: []; result: HeatingGroupsState};
    /** The groups with their members, and the devices whose configuration is still pending. */
    'groups.list': {params: []; result: HeatingGroupList};
    /** The types a new group can have, each with the devices it could take now. */
    'groups.types': {params: []; result: HeatingGroupType[]};
    'groups.get': {params: [id: number]; result: HeatingGroupDetail};
    /** A new group: its name, its type and its members (the box's member ids). */
    'groups.create': {params: [name: string, type: string, members: string[]]; result: HeatingGroupChange};
    /**
     * The name and the members **as a whole**: adding and removing a member is one change with
     * the new list, as the WebUI did it. A field left `undefined` keeps its value.
     */
    'groups.update': {
        params: [id: number, name: string | undefined, members: string[] | undefined];
        result: HeatingGroupChange;
    };
    /** The group goes; its former members lose the group membership. */
    'groups.delete': {params: [id: number]; result: HeatingGroupMember[]};

    'paramset.get': {params: [interfaceName: string, address: string, paramset: string]; result: Paramset};
    /**
     * Task 64: what `getParamsetId(address, MASTER)` answers - the key the WebUI picks a MASTER form
     * by. `''` where the interface has no such method or refuses it; cached per address.
     */
    'paramset.id': {params: [interfaceName: string, address: string]; result: string};
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
    /**
     * Issue #146: asks the interface processes again and answers with the fresh list.
     *
     * {@link 'serviceMessages.list'} reads the backend's cache, which is filled by the events and
     * by a poll every five minutes - so the refresh button of the tab returned the same list it
     * already showed and looked like a button without a function. This is the call that makes the
     * round trip: `getServiceMessages` per BidCos interface, the `:0` sweep on HmIP.
     */
    'serviceMessages.refresh': {params: [interfaceName?: string]; result: ServiceMessage[]};
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

    /** Task 48: the RPC log - every outgoing call of the session, oldest first, the newest `limit` of them. */
    'rpcLog.list': {params: [limit?: number]; result: RpcLogEntry[]};
    'rpcLog.clear': {params: []; result: null};

    'data.file': {params: [path: string]; result: unknown};

    /**
     * D-32: the session this transport belongs to, or `null` where the host has no login.
     *
     * Answered by the *transport*, not by the backend: a session belongs to one WebSocket, and the
     * backend knows nothing about sockets. Read-only - there is no `session.set`, and logging out
     * is an HTTP route of the host, not a method here.
     */
    'session.info': {params: []; result: SessionInfo | null};
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
    /** D-40: the provider, its reachability and whether it takes writes. */
    'meta.changed': MetaState;
    /** D-40: a taxonomy or a node was created, renamed, moved or deleted. */
    'meta.enums.changed': Record<string, MetaEnum>;
    /** D-40: an object's name or membership changed - on the box, possibly by somebody else. */
    'meta.objects.changed': Record<string, MetaObjectView>;
    'rpc.event': EventRecord;
    'serviceMessages.changed': ServiceMessage[];
    /** Task 48: one more outgoing call is finished and in the log. */
    'rpcLog.appended': RpcLogEntry;
    /** Progress of a bulk write: done of total, last result. */
    'write.progress': {done: number; total: number; last?: WriteResult};
    /** Issue #26: a device went unreachable, or a counter was reset. */
    'unreach.changed': UnreachCounter[];
    'config.changed': AppConfig;
    /** Backend-side problem the user should see (ReGa down, port in use, ...). */
    /**
     * `debug` is for the host's log only (task 56: the start retries of an interface that is not
     * there yet); the UI shows no toast for it.
     */
    notice: {level: 'debug' | 'info' | 'warn' | 'error'; message: string; interfaceName?: string};
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
    'meta.changed': true,
    'meta.enums.changed': true,
    'meta.objects.changed': true,
    'rpc.event': true,
    'serviceMessages.changed': true,
    'rpcLog.appended': true,
    'write.progress': true,
    'unreach.changed': true,
    'config.changed': true,
    notice: true,
} as const satisfies Record<ApiEventName, true>;

/** Every event name of {@link ApiEvents}, in the order the contract declares them. */
export const API_EVENT_NAMES: readonly ApiEventName[] = Object.freeze(Object.keys(API_EVENT_FLAGS) as ApiEventName[]);
