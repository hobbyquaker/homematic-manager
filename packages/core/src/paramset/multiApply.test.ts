import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {multiApplyEligibility} from './multiApply.js';
import {DeviceIndex, type DeviceDescription} from '../devices/index.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/devices.json', import.meta.url), 'utf8'),
) as Record<string, DeviceDescription[]>;

const index = new DeviceIndex('BidCos-RF', fixtures['BidCos-RF'] ?? []);

describe('multiApplyEligibility', () => {
    it('offers only channels with the same paramset description', () => {
        const result = multiApplyEligibility(index, 'MEQ0123456:1', 'MASTER');
        expect(result.identity).toBe('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/MASTER');
        expect(result.eligible).toEqual(['MEQ0999999:1']);
    });

    it('does not offer the same channel type on a different firmware (issue #98)', () => {
        const result = multiApplyEligibility(index, 'MEQ0123456:1', 'MASTER');
        const other = result.ineligible.find((entry) => entry.address === 'MEQ0888888:1');
        expect(other?.reason).toBe('different-identity');
        // the difference the dialog shows the user: same channel type, older firmware
        expect(other?.identity).toBe('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.4/8/SWITCH/MASTER');
    });

    it('does not offer the channel the dialog was opened on', () => {
        const result = multiApplyEligibility(index, 'MEQ0123456:1', 'MASTER');
        expect(result.eligible).not.toContain('MEQ0123456:1');
        expect(result.ineligible).toContainEqual({
            address: 'MEQ0123456:1',
            reason: 'same-channel',
            identity: result.identity,
        });
    });

    it('does not offer a device when the dialog is on a channel, and the other way round', () => {
        const channels = multiApplyEligibility(index, 'MEQ0123456:1', 'MASTER');
        expect(channels.eligible).not.toContain('MEQ0999999');

        const devices = multiApplyEligibility(index, 'MEQ0123456', 'MASTER');
        expect(devices.identity).toBe('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8//MASTER');
        expect(devices.eligible).toEqual(['MEQ0999999']);
    });

    it('distinguishes the paramsets of the same channel', () => {
        expect(multiApplyEligibility(index, 'MEQ0123456:1', 'LINK').identity).toBe(
            'BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/LINK',
        );
    });

    it('takes an explicit candidate list', () => {
        const result = multiApplyEligibility(index, 'MEQ0123456:1', 'MASTER', ['MEQ0999999:1', 'LEQ0654321:1']);
        expect(result.eligible).toEqual(['MEQ0999999:1']);
        expect(result.ineligible).toEqual([
            {address: 'LEQ0654321:1', reason: 'different-identity', identity: 'BidCos-RF/HM-RC-4-2/1.2/7/KEY/MASTER'},
        ]);
    });

    it('reports a candidate that is not in the index', () => {
        const result = multiApplyEligibility(index, 'MEQ0123456:1', 'MASTER', ['nope']);
        expect(result.ineligible).toEqual([{address: 'nope', reason: 'unknown-address'}]);
    });

    it('reports a candidate whose device is missing', () => {
        const orphaned = new DeviceIndex('BidCos-RF', [
            ...(fixtures['BidCos-RF'] ?? []),
            {ADDRESS: 'ORPHAN:1', TYPE: 'SWITCH', PARENT: 'ORPHAN'},
        ]);
        const result = multiApplyEligibility(orphaned, 'MEQ0123456:1', 'MASTER', ['ORPHAN:1']);
        expect(result.ineligible).toEqual([{address: 'ORPHAN:1', reason: 'no-identity'}]);
    });

    it('refuses to work from a source without an identity', () => {
        expect(() => multiApplyEligibility(index, 'nope', 'MASTER')).toThrow(/no paramset identity for nope MASTER/);
    });
});
