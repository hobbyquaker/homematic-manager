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
 */

import {paramsetIdentity, type DeviceDescription, type ParamsetDescription} from '@homematic-manager/core';

/** What is written to `<cache>/descriptions.json`: identity -> description. */
export type DescriptionCacheSnapshot = Record<string, ParamsetDescription>;

export class ParamsetDescriptionCache {
    readonly #byIdentity = new Map<string, ParamsetDescription>();
    #dirty = false;

    get size(): number {
        return this.#byIdentity.size;
    }

    /** True when something was stored since the last `markClean()`. */
    get dirty(): boolean {
        return this.#dirty;
    }

    markClean(): void {
        this.#dirty = false;
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
        this.#byIdentity.set(identity, description);
        this.#dirty = true;
    }

    has(identity: string | undefined): boolean {
        return identity !== undefined && this.#byIdentity.has(identity);
    }

    /** Drops everything, or everything of one interface (the identity starts with its name). */
    clear(interfaceName?: string): void {
        if (interfaceName === undefined) {
            this.#byIdentity.clear();
        } else {
            for (const identity of [...this.#byIdentity.keys()]) {
                if (identity.startsWith(`${interfaceName}/`)) {
                    this.#byIdentity.delete(identity);
                }
            }
        }
        this.#dirty = true;
    }

    toJSON(): DescriptionCacheSnapshot {
        return Object.fromEntries(this.#byIdentity);
    }

    load(snapshot: unknown): void {
        this.#byIdentity.clear();
        if (typeof snapshot === 'object' && snapshot !== null) {
            for (const [identity, description] of Object.entries(snapshot as Record<string, unknown>)) {
                if (typeof description === 'object' && description !== null && !Array.isArray(description)) {
                    this.#byIdentity.set(identity, description as ParamsetDescription);
                }
            }
        }
        this.#dirty = false;
    }
}
