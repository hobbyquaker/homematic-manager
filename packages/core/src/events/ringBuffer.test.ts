import {describe, expect, it} from 'vitest';

import {
    DEFAULT_EVENT_BUFFER_SIZE,
    filterEvents,
    matchesEventFilter,
    RingBuffer,
    type FilterableEvent,
} from './ringBuffer.js';

function event(partial: Partial<FilterableEvent> = {}): FilterableEvent {
    return {
        interfaceName: 'BidCos-RF',
        address: 'MEQ0123456:1',
        datapoint: 'STATE',
        value: true,
        ...partial,
    };
}

describe('RingBuffer', () => {
    it('keeps 8192 entries by default, as the 2.x grid did', () => {
        expect(new RingBuffer().capacity).toBe(DEFAULT_EVENT_BUFFER_SIZE);
    });

    it('starts empty', () => {
        const buffer = new RingBuffer<number>(3);
        expect(buffer.size).toBe(0);
        expect(buffer.full).toBe(false);
        expect(buffer.toArray()).toEqual([]);
    });

    it('keeps entries in order while it fills up', () => {
        const buffer = new RingBuffer<number>(3);
        expect(buffer.push(1)).toBeUndefined();
        buffer.push(2);
        expect(buffer.toArray()).toEqual([1, 2]);
        expect(buffer.size).toBe(2);
        expect(buffer.full).toBe(false);
    });

    it('drops the oldest entry once it is full and says which', () => {
        const buffer = new RingBuffer<number>(3);
        buffer.push(1);
        buffer.push(2);
        buffer.push(3);
        expect(buffer.full).toBe(true);
        expect(buffer.push(4)).toBe(1);
        expect(buffer.toArray()).toEqual([2, 3, 4]);
        expect(buffer.size).toBe(3);
    });

    it('keeps working after wrapping several times', () => {
        const buffer = new RingBuffer<number>(3);
        for (let index = 1; index <= 10; index += 1) {
            buffer.push(index);
        }
        expect(buffer.toArray()).toEqual([8, 9, 10]);
    });

    it('works with a capacity of one', () => {
        const buffer = new RingBuffer<number>(1);
        buffer.push(1);
        expect(buffer.push(2)).toBe(1);
        expect(buffer.toArray()).toEqual([2]);
    });

    it('empties out', () => {
        const buffer = new RingBuffer<number>(3);
        buffer.push(1);
        buffer.push(2);
        buffer.clear();
        expect(buffer.size).toBe(0);
        expect(buffer.toArray()).toEqual([]);
        buffer.push(9);
        expect(buffer.toArray()).toEqual([9]);
    });

    it('filters, oldest first', () => {
        const buffer = new RingBuffer<number>(4);
        for (const value of [1, 2, 3, 4, 5]) {
            buffer.push(value);
        }
        expect(buffer.filter((value) => value % 2 === 1)).toEqual([3, 5]);
    });

    it('refuses a capacity that makes no sense', () => {
        expect(() => new RingBuffer(0)).toThrow(RangeError);
        expect(() => new RingBuffer(-1)).toThrow(RangeError);
        expect(() => new RingBuffer(1.5)).toThrow(/positive integer/);
    });
});

describe('matchesEventFilter', () => {
    const record = event({address: 'MEQ0123456:1', datapoint: 'LEVEL', value: 0.5});

    it('passes everything through an empty filter', () => {
        expect(matchesEventFilter(record, {})).toBe(true);
    });

    it('filters by interface exactly', () => {
        expect(matchesEventFilter(record, {interfaceName: 'BidCos-RF'})).toBe(true);
        expect(matchesEventFilter(record, {interfaceName: 'HmIP-RF'})).toBe(false);
    });

    it('filters by a part of the address, case-insensitively', () => {
        expect(matchesEventFilter(record, {address: 'meq0123'})).toBe(true);
        expect(matchesEventFilter(record, {address: ':1'})).toBe(true);
        expect(matchesEventFilter(record, {address: 'LEQ'})).toBe(false);
        expect(matchesEventFilter(record, {address: ''})).toBe(true);
    });

    it('filters by a part of the datapoint', () => {
        expect(matchesEventFilter(record, {datapoint: 'lev'})).toBe(true);
        expect(matchesEventFilter(record, {datapoint: 'STATE'})).toBe(false);
    });

    it('searches address, datapoint and value at once', () => {
        expect(matchesEventFilter(record, {text: '0.5'})).toBe(true);
        expect(matchesEventFilter(record, {text: 'level'})).toBe(true);
        expect(matchesEventFilter(record, {text: 'MEQ'})).toBe(true);
        expect(matchesEventFilter(record, {text: 'nope'})).toBe(false);
        expect(matchesEventFilter(record, {text: ''})).toBe(true);
    });

    it('combines the parts with AND', () => {
        expect(matchesEventFilter(record, {interfaceName: 'BidCos-RF', datapoint: 'LEVEL', text: '0.5'})).toBe(true);
        expect(matchesEventFilter(record, {interfaceName: 'BidCos-RF', datapoint: 'STATE'})).toBe(false);
    });
});

describe('filterEvents', () => {
    it('filters a whole buffer', () => {
        const buffer = new RingBuffer<FilterableEvent>(10);
        buffer.push(event({datapoint: 'STATE', value: true}));
        buffer.push(event({datapoint: 'LEVEL', value: 0.5}));
        buffer.push(event({interfaceName: 'HmIP-RF', datapoint: 'LEVEL', value: 1}));
        expect(filterEvents(buffer, {datapoint: 'LEVEL'})).toHaveLength(2);
        expect(filterEvents(buffer, {interfaceName: 'HmIP-RF'})).toHaveLength(1);
        expect(filterEvents(buffer, {})).toHaveLength(3);
    });
});

describe('an event without an address or a datapoint', () => {
    it('passes an empty filter and fails a narrowing one', () => {
        const bare: FilterableEvent = {interfaceName: 'BidCos-RF'};
        expect(matchesEventFilter(bare, {})).toBe(true);
        expect(matchesEventFilter(bare, {address: 'MEQ'})).toBe(false);
        expect(matchesEventFilter(bare, {datapoint: 'STATE'})).toBe(false);
        expect(matchesEventFilter(bare, {text: 'undefined'})).toBe(true);
    });
});
