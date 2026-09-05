/**
 * Friendly names: the local store, merged with what ReGa knows.
 *
 * D-2 says ReGa is optional, so the local store is the source of truth and ReGa is an overlay: on a
 * CCU the names come from ReGa and renaming writes there as well, on Homegear or a bare rfd there
 * is no ReGa and the names live here alone. A ReGa failure therefore degrades to the local names
 * instead of leaving the grid without any.
 *
 * The ReGa object id per address is kept next to the name because the rename script addresses
 * objects by id (`dom.GetObject(<id>).Name("...")`), exactly as 2.x did - an address that ReGa has
 * never reported cannot be renamed there, only locally.
 */

/** What is written to `<cache>/names.json`. */
export interface NameCacheSnapshot {
    readonly names: Record<string, string>;
    readonly regaIds: Record<string, number>;
}

/** One name to set. */
export interface NameEntry {
    readonly address: string;
    readonly name: string;
}

export class NameStore {
    readonly #names = new Map<string, string>();
    readonly #regaIds = new Map<string, number>();

    get size(): number {
        return this.#names.size;
    }

    get(address: string): string | undefined {
        return this.#names.get(address);
    }

    /** The whole map, as the contract's `NameMap`. */
    all(): Record<string, string> {
        return Object.fromEntries([...this.#names].sort(([a], [b]) => a.localeCompare(b)));
    }

    /** The ReGa object id of an address, when ReGa has reported one. */
    regaId(address: string): number | undefined {
        return this.#regaIds.get(address);
    }

    /**
     * Sets names locally. A device gets its `:0` channel named with it as well, which is what 2.x
     * did (`main.js:622-625`) so that the maintenance channel is not left nameless in the grids.
     *
     * Returns the entries that have to be written to ReGa, in the order they were given.
     */
    set(entries: readonly NameEntry[]): NameEntry[] {
        const written: NameEntry[] = [];
        for (const entry of entries) {
            const name = entry.name.trim();
            if (entry.address === '' || name === '') {
                continue;
            }
            this.#names.set(entry.address, name);
            written.push({address: entry.address, name});
            if (!entry.address.includes(':')) {
                const maintenance = `${entry.address}:0`;
                const maintenanceName = `${name}:0`;
                this.#names.set(maintenance, maintenanceName);
                written.push({address: maintenance, name: maintenanceName});
            }
        }
        return written;
    }

    /** A rename that happened outside our control (the `replaceDevice` callback). */
    rename(oldAddress: string, newAddress: string): void {
        const name = this.#names.get(oldAddress);
        if (name !== undefined) {
            this.#names.set(newAddress, name);
            this.#names.delete(oldAddress);
        }
        const id = this.#regaIds.get(oldAddress);
        if (id !== undefined) {
            this.#regaIds.set(newAddress, id);
            this.#regaIds.delete(oldAddress);
        }
    }

    /**
     * Applies what `rega.getChannels()` returned. ReGa wins over the local name - it is what the
     * user sees in the CCU's own WebUI - and its object ids are remembered for the rename script.
     * Returns true when anything changed.
     */
    applyRega(channels: readonly {address: string; name: string; id: number}[]): boolean {
        let changed = false;
        for (const channel of channels) {
            if (typeof channel.address !== 'string' || channel.address === '') {
                continue;
            }
            if (this.#names.get(channel.address) !== channel.name) {
                this.#names.set(channel.address, channel.name);
                changed = true;
            }
            if (this.#regaIds.get(channel.address) !== channel.id) {
                this.#regaIds.set(channel.address, channel.id);
                changed = true;
            }
        }
        return changed;
    }

    clear(): void {
        this.#names.clear();
        this.#regaIds.clear();
    }

    toJSON(): NameCacheSnapshot {
        return {names: this.all(), regaIds: Object.fromEntries(this.#regaIds)};
    }

    load(snapshot: unknown): void {
        this.clear();
        if (typeof snapshot !== 'object' || snapshot === null) {
            return;
        }
        const raw = snapshot as {names?: unknown; regaIds?: unknown};
        if (typeof raw.names === 'object' && raw.names !== null) {
            for (const [address, name] of Object.entries(raw.names as Record<string, unknown>)) {
                if (typeof name === 'string') {
                    this.#names.set(address, name);
                }
            }
        }
        if (typeof raw.regaIds === 'object' && raw.regaIds !== null) {
            for (const [address, id] of Object.entries(raw.regaIds as Record<string, unknown>)) {
                if (typeof id === 'number') {
                    this.#regaIds.set(address, id);
                }
            }
        }
    }
}
