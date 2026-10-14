import type {DeviceDescription, Transport} from '@homematic-manager/core';
import {paramsetIdentity} from '@homematic-manager/core';

import {
    isRouterCapable,
    maintenanceAddress,
    ROUTER_PARAMETER,
    routingEnabled,
    routingTableAddress,
    ROUTING_TABLE_PARAMSET,
    type RouterState,
} from '../util/routers.js';
import {parseRoutingTable, type RoutingEntry} from '../util/routingTable.js';

import type {StorageLike} from './AppStore.svelte.js';
import type {DevicesStore} from './DevicesStore.svelte.js';
import type {NoticesStore} from './NoticesStore.svelte.js';

/** Task 98: one router's table as last read, or why it could not be. */
export interface RouterTable {
    /** When the read ended (ms since the epoch). */
    readonly readAt: number;
    /** Where it was read from: the device or its channel 0, whichever lists `ROUTING_TABLE`. */
    readonly address: string;
    readonly entries?: RoutingEntry[] | undefined;
    readonly error?: string | undefined;
}

/** Task 98: the tables of one interface, from the last "Read routing tables". */
export interface InterfaceTables {
    readonly readAt: number;
    readonly tables: Record<string, RouterTable>;
}

export interface RoutersStoreOptions {
    /** Where the last read is kept across a reload: the browser's storage. */
    readonly storage?: StorageLike | undefined;
    /** The connection's profile, so two CCUs with the same interface names keep apart. */
    readonly profile?: (() => string) | undefined;
    /** The pause between two routers' reads, in ms (default 2 s). */
    readonly pauseMs?: number | undefined;
}

const TABLES_STORAGE_KEY = 'hmm.routingTables';

/** What is known of one device: whether it can route, and whether it does. */
interface Entry {
    readonly capable: boolean;
    readonly enabled: boolean | undefined;
}

/**
 * Task 97: which HmIP devices can route for others, and which do.
 *
 * Two reads per device, both answered by hmipserver without a frame on air (measured on a lab
 * system, 2026-10-14): the MASTER **description** of channel 0 decides whether the device has a
 * router module - asked once per paramset identity (type, firmware, version), so a hundred
 * devices of five kinds are five requests - and the MASTER **values** of the capable ones say
 * whether the module is switched on. Both are read once per device and session ({@link ensure},
 * what the device table's marker needs), and again only when the user asks ({@link load}, the
 * Routers view's Refresh). Never on a timer.
 *
 * The requests go one after the other, not in parallel: a CCU with a few hundred devices must not
 * see a burst of a few hundred calls because a tab was opened.
 */
export class RoutersStore {
    /** Interface -> device address -> entry. Reassigned on every change, so the views re-render. */
    entries = $state<Record<string, Record<string, Entry>>>({});
    /** Interfaces being read right now. */
    loading = $state<Record<string, boolean>>({});
    /** When the values of an interface were last read completely (ms since the epoch). */
    readAt = $state<Record<string, number>>({});
    /** The device whose switch is being written, `''` for none. */
    writing = $state('');
    /** Task 98: the routing tables per interface, from the last read (or the browser's storage). */
    tables = $state<Record<string, InterfaceTables>>({});
    /** Task 98: the read in progress, per interface: how many routers of how many. */
    tableProgress = $state<Record<string, {done: number; total: number} | undefined>>({});

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #devices: DevicesStore;
    /** Paramset identity -> capable. Plain: a cache, never rendered. */
    readonly #capability: Record<string, boolean> = {};
    /** The reads in flight per interface, so a second caller waits for the first. */
    readonly #running: Record<string, Promise<void> | undefined> = {};

    readonly #storage: StorageLike | undefined;
    readonly #profile: () => string;
    readonly #pauseMs: number;
    /** Interfaces whose stored tables were looked for already. Plain: bookkeeping, never rendered. */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above
    readonly #restored = new Set<string>();

    constructor(transport: Transport, notices: NoticesStore, devices: DevicesStore, options: RoutersStoreOptions = {}) {
        this.#transport = transport;
        this.#notices = notices;
        this.#devices = devices;
        this.#storage = options.storage;
        this.#profile = options.profile ?? (() => 'default');
        this.#pauseMs = options.pauseMs ?? 2000;
    }

    /** The router-capable devices of an interface, in the device list's order. */
    routers(interfaceName: string): RouterState[] {
        const known = this.entries[interfaceName] ?? {};
        return this.#devices
            .devices(interfaceName)
            .filter((device) => known[device.ADDRESS]?.capable === true)
            .map((device) => ({address: device.ADDRESS, enabled: known[device.ADDRESS]?.enabled}));
    }

    /** Is the router module of this device switched on? `false` while that is not known. */
    isRouting(interfaceName: string, address: string): boolean {
        return this.entries[interfaceName]?.[address]?.enabled === true;
    }

    /** Has every device of the interface been looked at at least once? */
    hasRead(interfaceName: string): boolean {
        return this.readAt[interfaceName] !== undefined;
    }

    isLoading(interfaceName: string): boolean {
        return this.loading[interfaceName] === true;
    }

    /**
     * Looks at the devices of the interface that have not been looked at yet - all of them the
     * first time, a newly paired one afterwards. What the device table calls whenever its list
     * changes; a device already known is not asked again.
     */
    async ensure(interfaceName: string): Promise<void> {
        await this.#read(interfaceName, false);
    }

    /** Reads the switch of every capable device again: the Routers view's Refresh. */
    async load(interfaceName: string): Promise<void> {
        await this.#read(interfaceName, true);
    }

    async #read(interfaceName: string, again: boolean): Promise<void> {
        const running = this.#running[interfaceName];
        if (running) {
            await running;
            if (!again) {
                return;
            }
        }
        const job = this.#readAll(interfaceName, again);
        this.#running[interfaceName] = job;
        try {
            await job;
        } finally {
            this.#running[interfaceName] = undefined;
        }
    }

    async #readAll(interfaceName: string, again: boolean): Promise<void> {
        const index = this.#devices.index(interfaceName);
        if (!index) {
            return;
        }
        const known = this.entries[interfaceName] ?? {};
        const todo = index
            .devices()
            .filter((device) =>
                again ? known[device.ADDRESS]?.capable !== false : known[device.ADDRESS] === undefined,
            );
        if (todo.length === 0) {
            if (this.readAt[interfaceName] === undefined) {
                this.readAt = {...this.readAt, [interfaceName]: Date.now()};
            }
            return;
        }
        this.loading = {...this.loading, [interfaceName]: true};
        let failure: unknown;
        try {
            for (const device of todo) {
                const channel = index.get(maintenanceAddress(device.ADDRESS));
                if (!channel) {
                    this.#set(interfaceName, device.ADDRESS, {capable: false, enabled: undefined});
                    continue;
                }
                const capable = await this.#capable(interfaceName, device, channel);
                if (!capable) {
                    this.#set(interfaceName, device.ADDRESS, {capable: false, enabled: undefined});
                    continue;
                }
                let enabled: boolean | undefined;
                try {
                    const values = await this.#transport.request(
                        'paramset.get',
                        interfaceName,
                        channel.ADDRESS,
                        'MASTER',
                    );
                    enabled = routingEnabled(values);
                } catch (error) {
                    failure ??= error;
                }
                this.#set(interfaceName, device.ADDRESS, {capable: true, enabled});
            }
            this.readAt = {...this.readAt, [interfaceName]: Date.now()};
        } finally {
            this.loading = {...this.loading, [interfaceName]: false};
        }
        if (failure !== undefined) {
            // one notice for the round, not one per device that did not answer
            this.#notices.fromError(failure, `getParamset MASTER ${ROUTER_PARAMETER}`);
        }
    }

    /** The capability of a device's kind, from its channel-0 MASTER description; cached by identity. */
    async #capable(interfaceName: string, device: DeviceDescription, channel: DeviceDescription): Promise<boolean> {
        let identity: string;
        try {
            identity = paramsetIdentity(interfaceName, channel, 'MASTER', device);
        } catch {
            identity = `${interfaceName}|${channel.ADDRESS}|MASTER`;
        }
        const cached = this.#capability[identity];
        if (cached !== undefined) {
            return cached;
        }
        try {
            const description = await this.#transport.request(
                'paramset.description',
                interfaceName,
                channel.ADDRESS,
                'MASTER',
            );
            const capable = isRouterCapable(description);
            this.#capability[identity] = capable;
            return capable;
        } catch {
            // nobody asked for this description: no notice, and the device is asked again next time
            return false;
        }
    }

    #set(interfaceName: string, address: string, entry: Entry): void {
        this.entries = {
            ...this.entries,
            [interfaceName]: {...this.entries[interfaceName], [address]: entry},
        };
    }

    /**
     * Switches the router module of a device on or off: `putParamset(<device>:0, MASTER,
     * {ROUTER_MODULE_ENABLED})`, through the backend's changed-only write (task 6). The caller has
     * asked the user first - this changes how the HmIP network routes. `true` when it was written.
     */
    async setRouting(interfaceName: string, address: string, on: boolean): Promise<boolean> {
        this.writing = address;
        try {
            const results = await this.#transport.request(
                'paramset.put',
                interfaceName,
                [maintenanceAddress(address)],
                'MASTER',
                {[ROUTER_PARAMETER]: on},
            );
            const result = results[0];
            if (result?.ok !== true) {
                const problem = result?.faultString ?? result?.problems.map((entry) => entry.message).join('; ') ?? '';
                this.#notices.fromError(
                    new Error(problem === '' ? 'no result' : problem),
                    `putParamset ${maintenanceAddress(address)} MASTER ${ROUTER_PARAMETER}`,
                );
                return false;
            }
            this.#set(interfaceName, address, {capable: true, enabled: on});
            return true;
        } catch (error) {
            this.#notices.fromError(error, `putParamset ${maintenanceAddress(address)} MASTER ${ROUTER_PARAMETER}`);
            return false;
        } finally {
            this.writing = '';
        }
    }

    #storageKey(interfaceName: string): string {
        return `${TABLES_STORAGE_KEY}.${this.#profile()}.${interfaceName}`;
    }

    /**
     * Task 98: the tables last read for an interface - this session's, or the ones the browser kept
     * from an earlier one. `undefined` when they were never read here.
     */
    tablesOf(interfaceName: string): InterfaceTables | undefined {
        const known = this.tables[interfaceName];
        if (known !== undefined || this.#restored.has(interfaceName)) {
            return known;
        }
        this.#restored.add(interfaceName);
        let stored: InterfaceTables | undefined;
        try {
            const text = this.#storage?.getItem(this.#storageKey(interfaceName));
            const parsed: unknown = text ? JSON.parse(text) : undefined;
            if (
                typeof parsed === 'object' &&
                parsed !== null &&
                typeof (parsed as InterfaceTables).readAt === 'number' &&
                typeof (parsed as InterfaceTables).tables === 'object'
            ) {
                stored = parsed as InterfaceTables;
            }
        } catch {
            stored = undefined;
        }
        if (stored !== undefined) {
            // a render must not write state: the restored tables arrive in a microtask
            const found = stored;
            queueMicrotask(() => {
                if (this.tables[interfaceName] === undefined) {
                    this.tables = {...this.tables, [interfaceName]: found};
                }
            });
        }
        return stored;
    }

    /** Is a "Read routing tables" running for this interface? */
    isReadingTables(interfaceName: string): boolean {
        return this.tableProgress[interfaceName] !== undefined;
    }

    /** The routers whose table can be read: the module on, and the interface offering the table. */
    tableTargets(interfaceName: string): Array<{router: string; address: string}> {
        const index = this.#devices.index(interfaceName);
        if (!index) {
            return [];
        }
        return this.routers(interfaceName)
            .filter((state) => state.enabled === true)
            .flatMap((state) => {
                const device = index.get(state.address);
                const address = device
                    ? routingTableAddress(device, index.get(maintenanceAddress(state.address)))
                    : undefined;
                return address === undefined ? [] : [{router: state.address, address}];
            });
    }

    /**
     * Task 98: reads the routing table of every router that routes and offers one - only when the
     * user asks for it. Each read goes to the device over the air (measured 2026-10-14: a frame,
     * retried for about 40 s when the device does not answer), so they go one at a time with a
     * pause between them, and the result is kept - in this session and in the browser - with the
     * time of the read. Never on a timer. A router that does not answer keeps its error and the
     * read goes on with the next one.
     */
    async readTables(interfaceName: string): Promise<void> {
        if (this.isReadingTables(interfaceName)) {
            return;
        }
        const targets = this.tableTargets(interfaceName);
        this.tableProgress = {...this.tableProgress, [interfaceName]: {done: 0, total: targets.length}};
        const tables: Record<string, RouterTable> = {};
        let failed = 0;
        try {
            for (const [position, target] of targets.entries()) {
                if (position > 0 && this.#pauseMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, this.#pauseMs));
                }
                try {
                    const values = await this.#transport.request(
                        'paramset.get',
                        interfaceName,
                        target.address,
                        ROUTING_TABLE_PARAMSET,
                    );
                    tables[target.router] = {
                        readAt: Date.now(),
                        address: target.address,
                        entries: parseRoutingTable(values),
                    };
                } catch (error) {
                    failed += 1;
                    tables[target.router] = {
                        readAt: Date.now(),
                        address: target.address,
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
                this.tableProgress = {
                    ...this.tableProgress,
                    [interfaceName]: {done: position + 1, total: targets.length},
                };
            }
        } finally {
            this.tableProgress = {...this.tableProgress, [interfaceName]: undefined};
        }
        const result: InterfaceTables = {readAt: Date.now(), tables};
        this.#restored.add(interfaceName);
        this.tables = {...this.tables, [interfaceName]: result};
        try {
            this.#storage?.setItem(this.#storageKey(interfaceName), JSON.stringify(result));
        } catch {
            // a full or refused storage only costs the copy for the next session
        }
        if (failed > 0) {
            this.#notices.push(
                'warn',
                `getParamset ${ROUTING_TABLE_PARAMSET}: ${String(failed)} / ${String(targets.length)}`,
                interfaceName,
            );
        }
    }
}
