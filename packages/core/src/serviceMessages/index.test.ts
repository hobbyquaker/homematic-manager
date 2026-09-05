import {describe, expect, it} from 'vitest';

import {
    ACKNOWLEDGEABLE_DATAPOINTS,
    countsAsServiceMessage,
    isAcknowledgeable,
    isServiceMessageDatapoint,
    SERVICE_MESSAGE_DATAPOINTS,
    ServiceMessageStore,
} from './index.js';

describe('which datapoints are service messages', () => {
    it('knows the documented list', () => {
        for (const datapoint of SERVICE_MESSAGE_DATAPOINTS) {
            expect(isServiceMessageDatapoint(datapoint)).toBe(true);
        }
        expect(SERVICE_MESSAGE_DATAPOINTS).toContain('LOWBAT');
        expect(SERVICE_MESSAGE_DATAPOINTS).toContain('LOW_BAT');
        expect(SERVICE_MESSAGE_DATAPOINTS).toContain('STICKY_UNREACH');
        expect(SERVICE_MESSAGE_DATAPOINTS).toContain('UPDATE_PENDING');
    });

    it('takes every ERROR datapoint, whatever the device calls it', () => {
        expect(isServiceMessageDatapoint('ERROR')).toBe(true);
        expect(isServiceMessageDatapoint('ERROR_CODE')).toBe(true);
        expect(isServiceMessageDatapoint('ERROR_OVERHEAT')).toBe(true);
    });

    it('ignores ordinary datapoints', () => {
        expect(isServiceMessageDatapoint('STATE')).toBe(false);
        expect(isServiceMessageDatapoint('LEVEL')).toBe(false);
        expect(isServiceMessageDatapoint('RSSI_DEVICE')).toBe(false);
    });

    it('takes DUTY_CYCLE only as a boolean, never as the HmIP percentage', () => {
        expect(countsAsServiceMessage('DUTY_CYCLE', true)).toBe(true);
        expect(countsAsServiceMessage('DUTY_CYCLE', false)).toBe(true);
        expect(countsAsServiceMessage('DUTY_CYCLE', 42)).toBe(false);
        expect(countsAsServiceMessage('UNREACH', true)).toBe(true);
        expect(countsAsServiceMessage('LEVEL', 1)).toBe(false);
    });
});

describe('which service messages can be acknowledged', () => {
    it('takes the sticky ones and the errors', () => {
        for (const datapoint of ACKNOWLEDGEABLE_DATAPOINTS) {
            expect(isAcknowledgeable(datapoint)).toBe(true);
        }
        expect(isAcknowledgeable('ERROR_CODE')).toBe(true);
    });

    it('leaves the ones that clear themselves alone', () => {
        expect(isAcknowledgeable('UNREACH')).toBe(false);
        expect(isAcknowledgeable('LOWBAT')).toBe(false);
        expect(isAcknowledgeable('CONFIG_PENDING')).toBe(false);
        expect(isAcknowledgeable('DUTY_CYCLE')).toBe(false);
    });
});

describe('ServiceMessageStore', () => {
    const clock = () => 1_700_000_000_000;

    function store(): ServiceMessageStore {
        return new ServiceMessageStore({now: clock});
    }

    it('starts empty', () => {
        const messages = store();
        expect(messages.size).toBe(0);
        expect(messages.list()).toEqual([]);
    });

    it('adds a message from an event', () => {
        const messages = store();
        expect(messages.applyEvent('HmIP-RF', '0001D3C99C1234:0', 'UNREACH', true)).toBe(true);
        expect(messages.list()).toEqual([
            {
                interfaceName: 'HmIP-RF',
                address: '0001D3C99C1234:0',
                device: '0001D3C99C1234',
                datapoint: 'UNREACH',
                value: true,
                acknowledgeable: false,
                timestamp: 1_700_000_000_000,
            },
        ]);
    });

    it('clears a message when the value goes false', () => {
        const messages = store();
        messages.apply('HmIP-RF', 'A:0', 'UNREACH', true);
        expect(messages.apply('HmIP-RF', 'A:0', 'UNREACH', false)).toBe(true);
        expect(messages.size).toBe(0);
    });

    it('reports no change for a value that was not there and for one that is the same', () => {
        const messages = store();
        expect(messages.apply('HmIP-RF', 'A:0', 'UNREACH', false)).toBe(false);
        messages.apply('HmIP-RF', 'A:0', 'UNREACH', true);
        expect(messages.apply('HmIP-RF', 'A:0', 'UNREACH', true)).toBe(false);
    });

    it('reports a change when the value of an existing message changes', () => {
        const messages = store();
        messages.apply('BidCos-RF', 'A:0', 'ERROR_CODE', 1);
        expect(messages.apply('BidCos-RF', 'A:0', 'ERROR_CODE', 2)).toBe(true);
        expect(messages.list()[0]?.value).toBe(2);
    });

    it('ignores a datapoint that is not a service message', () => {
        const messages = store();
        expect(messages.apply('HmIP-RF', 'A:1', 'STATE', true)).toBe(false);
        expect(messages.apply('HmIP-RF', 'A:0', 'DUTY_CYCLE', 42)).toBe(false);
        expect(messages.size).toBe(0);
    });

    it('drops the channel and the interface when the last message goes', () => {
        const messages = store();
        messages.apply('HmIP-RF', 'A:0', 'UNREACH', true);
        messages.apply('HmIP-RF', 'A:0', 'LOWBAT', true);
        messages.clear('HmIP-RF', 'A:0', 'UNREACH');
        expect(messages.size).toBe(1);
        messages.clear('HmIP-RF', 'A:0', 'LOWBAT');
        expect(messages.size).toBe(0);
        expect(messages.forInterface('HmIP-RF')).toEqual([]);
    });

    it('says nothing was cleared when there was nothing to clear', () => {
        const messages = store();
        expect(messages.clear('HmIP-RF', 'A:0', 'UNREACH')).toBe(false);
        messages.apply('HmIP-RF', 'A:0', 'UNREACH', true);
        expect(messages.clear('HmIP-RF', 'B:0', 'UNREACH')).toBe(false);
        expect(messages.clear('HmIP-RF', 'A:0', 'LOWBAT')).toBe(false);
        expect(messages.clear('BidCos-RF', 'A:0', 'UNREACH')).toBe(false);
    });

    it('builds the HmIP list from a maintenance paramset, as the start-up read does', () => {
        const messages = store();
        const changed = messages.applyParamset('HmIP-RF', '0001D3C99C1234:0', {
            UNREACH: true,
            LOW_BAT: false,
            CONFIG_PENDING: true,
            RSSI_DEVICE: -60,
            DUTY_CYCLE: 12,
            OPERATING_VOLTAGE: 2.9,
        });
        expect(changed).toBe(true);
        expect(messages.list().map((message) => message.datapoint)).toEqual(['CONFIG_PENDING', 'UNREACH']);
    });

    it('reports no change for a maintenance paramset without any message', () => {
        expect(store().applyParamset('HmIP-RF', 'A:0', {RSSI_DEVICE: -60})).toBe(false);
    });

    it('replaces an interface with a fresh getServiceMessages answer', () => {
        const messages = store();
        messages.apply('BidCos-RF', 'A:0', 'UNREACH', true);
        messages.apply('HmIP-RF', 'B:0', 'UNREACH', true);
        messages.replaceInterface('BidCos-RF', [
            ['C:0', 'LOWBAT', true],
            ['C:0', 'CONFIG_PENDING', true],
        ]);
        expect(messages.forInterface('BidCos-RF').map((message) => message.address)).toEqual(['C:0', 'C:0']);
        // the other interface is untouched
        expect(messages.forInterface('HmIP-RF')).toHaveLength(1);
    });

    it('answers in the tuple format a BidCos interface would', () => {
        const messages = store();
        messages.apply('HmIP-RF', 'B:0', 'UNREACH', true);
        messages.apply('HmIP-RF', 'A:0', 'LOWBAT', true);
        expect(messages.toTuples('HmIP-RF')).toEqual([
            ['A:0', 'LOWBAT', true],
            ['B:0', 'UNREACH', true],
        ]);
        expect(messages.toTuples('BidCos-RF')).toEqual([]);
    });

    it('groups by device, whichever channel the message sits on', () => {
        const messages = store();
        messages.apply('BidCos-RF', 'LEQ1:0', 'UNREACH', true);
        messages.apply('BidCos-RF', 'LEQ1:1', 'ERROR_CODE', 7);
        messages.apply('BidCos-RF', 'LEQ2:0', 'UNREACH', true);
        expect(messages.forDevice('LEQ1').map((message) => message.datapoint)).toEqual(['UNREACH', 'ERROR_CODE']);
    });

    it('sorts channels and datapoints so the grid is stable', () => {
        const messages = store();
        messages.apply('BidCos-RF', 'B:0', 'UNREACH', true);
        messages.apply('BidCos-RF', 'A:0', 'UNREACH', true);
        messages.apply('BidCos-RF', 'A:0', 'CONFIG_PENDING', true);
        expect(messages.list().map((message) => `${message.address}/${message.datapoint}`)).toEqual([
            'A:0/CONFIG_PENDING',
            'A:0/UNREACH',
            'B:0/UNREACH',
        ]);
    });

    it('uses a zero timestamp when no clock was injected', () => {
        const messages = new ServiceMessageStore();
        messages.apply('BidCos-RF', 'A:0', 'UNREACH', true);
        expect(messages.list()[0]?.timestamp).toBe(0);
    });

    it('marks an acknowledgeable message as such', () => {
        const messages = store();
        messages.apply('BidCos-RF', 'A:0', 'STICKY_UNREACH', true);
        expect(messages.list()[0]?.acknowledgeable).toBe(true);
    });
});
