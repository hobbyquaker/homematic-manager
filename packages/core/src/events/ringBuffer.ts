/**
 * The bounded buffer behind the events tab.
 *
 * 2.x kept 8192 rows in a jqGrid and searched them with the grid's filter toolbar; the buffer is
 * the only part of that which is logic. It is a fixed-size ring: pushing into a full buffer drops
 * the oldest entry, so a busy CCU cannot make the app grow without bound.
 */

/** The number of events the 2.x grid kept, and the default here. */
export const DEFAULT_EVENT_BUFFER_SIZE = 8192;

/**
 * What the filter needs of an event. Structural on purpose: the record that actually travels is
 * `EventRecord` in `api/types.ts`, and the buffer itself does not care what it holds.
 */
export interface FilterableEvent {
    readonly interfaceName: string;
    readonly address?: string;
    readonly datapoint?: string;
    readonly value?: unknown;
}

/** A fixed-size ring buffer, oldest entry first. */
export class RingBuffer<T> {
    readonly #items: T[] = [];
    readonly #capacity: number;

    /** @param capacity must be at least 1. */
    constructor(capacity: number = DEFAULT_EVENT_BUFFER_SIZE) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError(`ring buffer capacity must be a positive integer, got ${capacity}`);
        }
        this.#capacity = capacity;
    }

    get capacity(): number {
        return this.#capacity;
    }

    /** How many entries the buffer currently holds. */
    get size(): number {
        return this.#items.length;
    }

    /** True once the buffer has filled up, i.e. once entries are being dropped. */
    get full(): boolean {
        return this.#items.length === this.#capacity;
    }

    /** Appends an entry and returns the one it evicted, if any. */
    push(item: T): T | undefined {
        this.#items.push(item);
        return this.#items.length > this.#capacity ? this.#items.shift() : undefined;
    }

    /** Everything in the buffer, oldest first. */
    toArray(): T[] {
        return [...this.#items];
    }

    /** The entries a predicate accepts, oldest first. */
    filter(predicate: (item: T) => boolean): T[] {
        return this.#items.filter((item) => predicate(item));
    }

    clear(): void {
        this.#items.length = 0;
    }
}

/** What the events tab's filter row can narrow by. All parts are combined with AND. */
export interface EventFilter {
    readonly interfaceName?: string;
    /** Substring of the address, case-insensitive - the grid's "contains" search. */
    readonly address?: string;
    /** Substring of the datapoint, case-insensitive. */
    readonly datapoint?: string;
    /** Substring of any of address, datapoint or the formatted value. */
    readonly text?: string;
}

/** Does this event pass the filter? An empty filter passes everything. */
export function matchesEventFilter(record: FilterableEvent, filter: EventFilter): boolean {
    if (filter.interfaceName !== undefined && record.interfaceName !== filter.interfaceName) {
        return false;
    }
    if (!contains(record.address ?? '', filter.address)) {
        return false;
    }
    if (!contains(record.datapoint ?? '', filter.datapoint)) {
        return false;
    }
    if (filter.text !== undefined && filter.text !== '') {
        const haystack = `${record.address ?? ''} ${record.datapoint ?? ''} ${String(record.value)}`;
        return haystack.toLowerCase().includes(filter.text.toLowerCase());
    }
    return true;
}

/** The buffer's entries that pass the filter, oldest first. */
export function filterEvents<T extends FilterableEvent>(buffer: RingBuffer<T>, filter: EventFilter): T[] {
    return buffer.filter((record) => matchesEventFilter(record, filter));
}

function contains(value: string, needle: string | undefined): boolean {
    if (needle === undefined || needle === '') {
        return true;
    }
    return value.toLowerCase().includes(needle.toLowerCase());
}
