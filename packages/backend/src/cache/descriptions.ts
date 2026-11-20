/**
 * Paramset descriptions, cached by the identity key of the core.
 *
 * `interface/deviceType/firmware/version/channelType/paramset` (`paramsetIdentity()`) is the same
 * key 2.x used, so a cache written by 2.x would fit - the file is new all the same, because D-17
 * discards the 2.x caches.
 *
 * A description never changes for a given identity, which is why this is the one cache that is
 * worth persisting across sessions: fetching `getParamsetDescription` for every channel of a CCU
 * with 100 devices is a minute of RPC traffic, and it is the same answer every time. The identity
 * carries the firmware and the version, so a device that was updated gets a new key rather than a
 * stale description - and it is the same key `multiApplyEligibility()` compares (task 6.3).
 *
 * **Stored in shards, one per interface and device type.** A CCU with a few dozen device types
 * has megabytes of descriptions; kept in one file, every description fetched for a type not seen
 * before rewrote all of them, on the addon to the CCU's SD card. Each shard is its own file now
 * (`CacheStore` decides where), and only the shards that gained something are written. A device
 * of a type that is cached already writes nothing at all.
 */

import {paramsetIdentity, type DeviceDescription, type ParamsetDescription} from '@homematic-manager/core';

/** What is written to `<cache>/descriptions.json`: identity -> description. */
export type DescriptionCacheSnapshot = Record<string, ParamsetDescription>;

/**
 * The shard an identity belongs to: its interface and device type (`BidCos-RF/HM-LC-Sw1-Pl`).
 * Only a bucket - the identity itself is what a shard file is keyed by.
 */
export function shardOf(identity: string): string {
    const [interfaceName = '', deviceType = ''] = identity.split('/');
    return `${interfaceName}/${deviceType}`;
}

export class ParamsetDescriptionCache {
    readonly #byIdentity = new Map<string, ParamsetDescription>();
    readonly #dirtyShards = new Set<string>();

    get size(): number {
        return this.#byIdentity.size;
    }

    /** True when something was stored since the last `takeDirty()`. */
    get dirty(): boolean {
        return this.#dirtyShards.size > 0;
    }

    /** The shards that changed since the last call, and forgets them. */
    takeDirty(): string[] {
        const shards = [...this.#dirtyShards];
        this.#dirtyShards.clear();
        return shards;
    }

    /** Every shard that holds something. */
    shards(): string[] {
        return [...new Set([...this.#byIdentity.keys()].map((identity) => shardOf(identity)))];
    }

    /** What is written to the file of one shard: identity -> description; empty when it holds nothing. */
    shardSnapshot(shard: string): DescriptionCacheSnapshot {
        const snapshot: DescriptionCacheSnapshot = {};
        for (const [identity, description] of this.#byIdentity) {
            if (shardOf(identity) === shard) {
                snapshot[identity] = description;
            }
        }
        return snapshot;
    }

    /**
     * The identity of a paramset, or `undefined` when the device is not in the index - which is the
     * case for a channel whose parent has not been listed yet, and means "do not cache this".
     */
    identity(
        interfaceName: string,
        description: DeviceDescription,
        paramset: string,
        parent: DeviceDescription | undefined,
    ): string | undefined {
        try {
            return paramsetIdentity(interfaceName, description, paramset, parent);
        } catch {
            return undefined;
        }
    }

    get(identity: string | undefined): ParamsetDescription | undefined {
        return identity === undefined ? undefined : this.#byIdentity.get(identity);
    }

    set(identity: string | undefined, description: ParamsetDescription): void {
        if (identity === undefined) {
            return;
        }
        const known = this.#byIdentity.get(identity);
        this.#byIdentity.set(identity, description);
        if (known === undefined || JSON.stringify(known) !== JSON.stringify(description)) {
            this.#dirtyShards.add(shardOf(identity));
        }
    }

    has(identity: string | undefined): boolean {
        return identity !== undefined && this.#byIdentity.has(identity);
    }

    /** Drops everything, or everything of one interface (the identity starts with its name). */
    clear(interfaceName?: string): void {
        for (const identity of [...this.#byIdentity.keys()]) {
            if (interfaceName === undefined || identity.startsWith(`${interfaceName}/`)) {
                this.#byIdentity.delete(identity);
                this.#dirtyShards.add(shardOf(identity));
            }
        }
    }

    toJSON(): DescriptionCacheSnapshot {
        return Object.fromEntries(this.#byIdentity);
    }

    /** Replaces everything with one snapshot (a shard file, or the single file of 3.5 and older). */
    load(snapshot: unknown): void {
        this.#byIdentity.clear();
        this.#dirtyShards.clear();
        this.merge(snapshot);
    }

    /** Adds a snapshot to what is there, without marking anything changed: it came from disk. */
    merge(snapshot: unknown): void {
        if (typeof snapshot === 'object' && snapshot !== null) {
            for (const [identity, description] of Object.entries(snapshot as Record<string, unknown>)) {
                if (typeof description === 'object' && description !== null && !Array.isArray(description)) {
                    this.#byIdentity.set(identity, description as ParamsetDescription);
                }
            }
        }
    }
}
