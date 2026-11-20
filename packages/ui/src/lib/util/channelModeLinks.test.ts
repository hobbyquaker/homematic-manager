import {describe, expect, it} from 'vitest';

import {changedModeParameters, modeBlockingPeers, modeParameters} from './channelModeLinks.js';

describe('channel mode and links (task 118)', () => {
    it('finds the writable mode parameters of a description', () => {
        expect(
            modeParameters({
                CHANNEL_OPERATION_MODE: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['KEY_BEHAVIOR', 'SWITCH_BEHAVIOR']},
                BEHAVIOUR: {TYPE: 'ENUM', OPERATIONS: 1, VALUE_LIST: ['A', 'B']},
                CHANNEL_FUNCTION: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['A', 'B']},
                LONG_PRESS_TIME: {TYPE: 'FLOAT', OPERATIONS: 3},
            }),
        ).toEqual(['CHANNEL_OPERATION_MODE', 'CHANNEL_FUNCTION']);
        expect(modeParameters(undefined)).toEqual([]);
    });

    it('counts every peer, an internal one too', () => {
        expect(modeBlockingPeers('0001:1', 'HmIP-FCI1', ['0002:3'])).toEqual(['0002:3']);
        expect(modeBlockingPeers('0001:1', 'HmIP-FCI1', ['0001:4'])).toEqual(['0001:4']);
        expect(modeBlockingPeers('0001:1', 'HmIP-FCI1', [])).toEqual([]);
    });

    it("leaves the mode free on the WebUI's exception devices when the only links are internal", () => {
        expect(modeBlockingPeers('0001:1', 'HmIP-FSI16', ['0001:5'])).toEqual([]);
        expect(modeBlockingPeers('0001:1', 'HmIP-FSI16', ['0001:5', '0002:3'])).toEqual(['0001:5', '0002:3']);
    });

    it('reports only the mode parameters that differ from what the device answered', () => {
        const params = ['CHANNEL_OPERATION_MODE'];
        expect(changedModeParameters(params, {CHANNEL_OPERATION_MODE: 0}, {})).toEqual([]);
        expect(changedModeParameters(params, {CHANNEL_OPERATION_MODE: 0}, {CHANNEL_OPERATION_MODE: 0})).toEqual([]);
        expect(changedModeParameters(params, {CHANNEL_OPERATION_MODE: 0}, {CHANNEL_OPERATION_MODE: 1})).toEqual(params);
    });
});
