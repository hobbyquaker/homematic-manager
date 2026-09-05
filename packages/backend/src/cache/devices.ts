/**
 * The device cache: what `listDevices` returned, kept per interface and updated by the callbacks.
 *
 * It exists for three reasons. The interface process asks *us* for `listDevices` after every `init`
 * and re-sends only what is missing, so without a cache every reconnect re-transfers hundreds of
 * descriptions. The UI wants the device grid before the first RPC round trip finishes. And
 * `paramsetIdentity()` needs a channel's parent device, which only an index over the whole
 * interface can give.
 *
 * The core's `DeviceIndex` does the actual indexing; this class owns the mutable state, keeps one
 * index per interface and rebuilds it lazily whenever something changed.
 */

import {DeviceIndex, type DeviceDescription} from '@homematic-manager/core';

/** What is written to `<cache>/devices.json`: interface -> address -> description. */
export type DeviceCacheSnapshot = Record<string, Record<string, DeviceDescription>>;

/** Devices and channels per interface. */
export class DeviceCache {
    readonly #byInterface = new Map<string, Map<string, DeviceDescription>>();
    readonly #indexes = new Map<string, DeviceIndex>();

    /** The interfaces that have devices, in insertion order. */
    interfaces(): string[] {
        return [...this.#byInterface.keys()];
    }

    /** True when this interface has ever been filled (an empty CCU counts as filled). */
    has(interfaceName: string): boolean {
        return this.#byInterface.has(interfaceName);
    }

    /** Every description of an interface, devices before their channels. */
    list(interfaceName: string): DeviceDescription[] {
        return this.index(interfaceName).all();
    }

    get(interfaceName: string, address: string): DeviceDescription | undefined {
        return this.#byInterface.get(interfaceName)?.get(address);
    }

    /** The core index of one interface; built on first use and after every change. */
    index(interfaceName: string): DeviceIndex {
        const cached = this.#indexes.get(interfaceName);
        if (cached) {
            return cached;
        }
        const index = new DeviceIndex(interfaceName, this.#byInterface.get(interfaceName)?.values() ?? []);
        this.#indexes.set(interfaceName, index);
        return index;
    }

    /** How many descriptions an interface holds. */
    size(interfaceName: string): number {
        return this.#byInterface.get(interfaceName)?.size ?? 0;
    }

    /** Replaces everything an interface has - the answer to a fresh `listDevices`. */
    replace(interfaceName: string, descriptions: readonly DeviceDescription[]): void {
        const map = new Map<string, DeviceDescription>();
        for (const description of descriptions) {
            map.set(description.ADDRESS, description);
        }
        this.#byInterface.set(interfaceName, map);
        this.#indexes.delete(interfaceName);
    }

    /** The `newDevices` callback; returns the addresses that were actually new or changed. */
    add(interfaceName: string, descriptions: readonly DeviceDescription[]): string[] {
        const map = this.#ensure(interfaceName);
        const touched: string[] = [];
        for (const description of descriptions) {
            map.set(description.ADDRESS, description);
            touched.push(description.ADDRESS);
        }
        if (touched.length > 0) {
            this.#indexes.delete(interfaceName);
        }
        return touched;
    }

    /** The `deleteDevices` callback; a device takes its channels with it. */
    remove(interfaceName: string, addresses: readonly string[]): string[] {
        const map = this.#byInterface.get(interfaceName);
        if (!map) {
            return [];
        }
        const removed: string[] = [];
        for (const address of addresses) {
            for (const candidate of [...map.keys()]) {
                if (candidate === address || candidate.startsWith(`${address}:`)) {
                    map.delete(candidate);
                    removed.push(candidate);
                }
            }
        }
        if (removed.length > 0) {
            this.#indexes.delete(interfaceName);
        }
        return removed;
    }

    /**
     * The `replaceDevice` callback. 2.x deleted the old device and waited for the interface to send
     * the new one with `newDevices`; the same is done here, so an address that is not in the cache
     * yet is not invented.
     */
    replaceDevice(interfaceName: string, oldAddress: string, newAddress: string): string[] {
        const removed = this.remove(interfaceName, [oldAddress]);
        return [...removed, newAddress];
    }

    /** Drops one interface, or everything. */
    clear(interfaceName?: string): void {
        if (interfaceName === undefined) {
            this.#byInterface.clear();
            this.#indexes.clear();
            return;
        }
        this.#byInterface.delete(interfaceName);
        this.#indexes.delete(interfaceName);
    }

    toJSON(): DeviceCacheSnapshot {
        const snapshot: DeviceCacheSnapshot = {};
        for (const [interfaceName, devices] of this.#byInterface) {
            snapshot[interfaceName] = Object.fromEntries(devices);
        }
        return snapshot;
    }

    /** Loads a snapshot; anything that is not a description is skipped. */
    load(snapshot: unknown): void {
        this.clear();
        if (typeof snapshot !== 'object' || snapshot === null) {
            return;
        }
        for (const [interfaceName, devices] of Object.entries(snapshot as Record<string, unknown>)) {
            if (typeof devices !== 'object' || devices === null) {
                continue;
            }
            const descriptions: DeviceDescription[] = [];
            for (const value of Object.values(devices as Record<string, unknown>)) {
                if (
                    typeof value === 'object' &&
                    value !== null &&
                    typeof (value as DeviceDescription).ADDRESS === 'string'
                ) {
                    descriptions.push(value as DeviceDescription);
                }
            }
            this.replace(interfaceName, descriptions);
        }
    }

    #ensure(interfaceName: string): Map<string, DeviceDescription> {
        const existing = this.#byInterface.get(interfaceName);
        if (existing) {
            return existing;
        }
        const created = new Map<string, DeviceDescription>();
        this.#byInterface.set(interfaceName, created);
        return created;
    }
}
