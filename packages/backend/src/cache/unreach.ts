/**
 * Issue #26: how often each device has gone unreachable, kept per CCU across restarts.
 *
 * `UNREACH` and `STICKY_UNREACH` are the two datapoints that report it, and the interface processes
 * repeat them: rfd re-sends `UNREACH` on every failed transmission attempt, and `getServiceMessages`
 * returns the same sticky flag on every poll. Counting each report would produce a number that says
 * how often we asked, not how often the device was away - so what is counted is the **edge**: the
 * counter goes up when a device that was reachable stops being reachable, and not again until it
 * has been reachable in between.
 *
 * `STICKY_UNREACH` alone does not clear the state: it stays true until somebody acknowledges it,
 * and acknowledging it is not the device coming back. Only `UNREACH` going false is, which is the
 * event rfd and hmipserver both send when the next message gets through.
 *
 * The counter is what makes the auto-acknowledge of #26 safe to switch on: the acknowledgement
 * removes the service message, and this keeps the fact that there was one.
 */

import type {UnreachCounter} from '@homematic-manager/core';

/** The two datapoints that mean "this device did not answer". */
export const UNREACH_DATAPOINTS: readonly string[] = ['UNREACH', 'STICKY_UNREACH'];

/** Is this one of them? */
export function isUnreachDatapoint(datapoint: string): boolean {
    return UNREACH_DATAPOINTS.includes(datapoint);
}

/** The device address of a channel address: `LEQ0000001:0` -> `LEQ0000001`. */
export function deviceAddressOf(address: string): string {
    const separator = address.indexOf(':');
    return separator === -1 ? address : address.slice(0, separator);
}

interface Entry {
    count: number;
    lastAt?: number;
    unreach: boolean;
}

/** The counters of one connection. */
export class UnreachCache {
    readonly #entries = new Map<string, Entry>();

    static #key(interfaceName: string, address: string): string {
        return `${interfaceName}|${address}`;
    }

    /**
     * Records what a datapoint said. Returns true when something changed, so the caller knows
     * whether to persist and to emit.
     *
     * `STICKY_UNREACH` going false is an acknowledgement, not a recovery, and is ignored on
     * purpose: the device is only back when `UNREACH` says so.
     */
    note(interfaceName: string, address: string, datapoint: string, value: unknown, now: number): boolean {
        if (!isUnreachDatapoint(datapoint) || typeof value !== 'boolean') {
            return false;
        }
        const device = deviceAddressOf(address);
        const key = UnreachCache.#key(interfaceName, device);
        const entry = this.#entries.get(key) ?? {count: 0, unreach: false};
        if (value) {
            if (entry.unreach) {
                return false;
            }
            this.#entries.set(key, {count: entry.count + 1, lastAt: now, unreach: true});
            return true;
        }
        if (datapoint !== 'UNREACH' || !entry.unreach) {
            return false;
        }
        this.#entries.set(key, {...entry, unreach: false});
        return true;
    }

    /** Every counter, or those of one interface, with the busiest device first. */
    list(interfaceName?: string): UnreachCounter[] {
        const result: UnreachCounter[] = [];
        for (const [key, entry] of this.#entries) {
            const [name, address] = key.split('|');
            if (name === undefined || address === undefined) {
                continue;
            }
            if (interfaceName !== undefined && name !== interfaceName) {
                continue;
            }
            result.push({
                interfaceName: name,
                address,
                count: entry.count,
                ...(entry.lastAt === undefined ? {} : {lastAt: entry.lastAt}),
                ...(entry.unreach ? {unreach: true} : {}),
            });
        }
        return result.sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
    }

    /** The counter of one device, 0 when it has never failed. */
    countOf(interfaceName: string, address: string): number {
        return this.#entries.get(UnreachCache.#key(interfaceName, deviceAddressOf(address)))?.count ?? 0;
    }

    /**
     * Resets one device, one interface or everything. The current unreach *state* is kept: a device
     * that is away now is still away after the counter was zeroed, and the next recovery must not
     * be counted as a new outage.
     */
    reset(interfaceName?: string, address?: string): void {
        for (const [key, entry] of [...this.#entries]) {
            const [name, device] = key.split('|');
            if (interfaceName !== undefined && name !== interfaceName) {
                continue;
            }
            if (address !== undefined && device !== deviceAddressOf(address)) {
                continue;
            }
            if (entry.unreach) {
                this.#entries.set(key, {count: 0, unreach: true});
            } else {
                this.#entries.delete(key);
            }
        }
    }

    clear(): void {
        this.#entries.clear();
    }

    /** What is written to `unreach.json`. */
    toJSON(): UnreachCounter[] {
        return this.list();
    }

    /** Reads it back. Anything that is not a counter is dropped rather than trusted. */
    load(data: unknown): void {
        this.#entries.clear();
        if (!Array.isArray(data)) {
            return;
        }
        for (const item of data) {
            if (typeof item !== 'object' || item === null) {
                continue;
            }
            const entry = item as Partial<UnreachCounter>;
            if (
                typeof entry.interfaceName !== 'string' ||
                typeof entry.address !== 'string' ||
                typeof entry.count !== 'number' ||
                !Number.isFinite(entry.count)
            ) {
                continue;
            }
            this.#entries.set(UnreachCache.#key(entry.interfaceName, entry.address), {
                count: Math.max(0, Math.round(entry.count)),
                ...(typeof entry.lastAt === 'number' ? {lastAt: entry.lastAt} : {}),
                // The state is restored too, and it has to be: the first thing the backend does
                // after a restart is a `getServiceMessages` sweep, and a device that is still
                // sticky-unreachable would otherwise be counted again on every start. If it did
                // recover while we were off, the `UNREACH` false of that recovery - or the next
                // one - clears it, and only the outage after that is counted.
                unreach: entry.unreach === true,
            });
        }
    }
}
