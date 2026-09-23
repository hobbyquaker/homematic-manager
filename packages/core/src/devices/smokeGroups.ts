/**
 * Smoke groups: which smoke detectors alarm together (task 58).
 *
 * The two radios do it differently, and neither has a "group" object of its own:
 *
 * - **BidCos** has *teams*. rfd creates a pseudo device per team (`*NEQ0448334`, type
 *   `HM-Sec-SD-Team` / `HM-Sec-SD-2-Team`) whose `:1` channel carries the members in
 *   `TEAM_CHANNELS`; every detector channel carries `TEAM`, the team channel it is in. Every
 *   detector starts in a team of its own, and `setTeam(channel, teamChannel)` moves it; an empty
 *   team address puts it back into its own. The team devices come with `listDevices`.
 * - **HmIP** has eight boolean MASTER parameters `GROUP_1` … `GROUP_8` on the smoke channel of
 *   the newer detectors (HmIP-SWSD); detectors with the same `GROUP_n` set form a group. There is
 *   no group object at all, so the device list synthesises one row per group that has a member,
 *   `*GROUP_n`, and a change is an ordinary MASTER write of the one `GROUP_n` that changed. The
 *   older channel type has no `GROUP_n` and cannot be grouped.
 *
 * Everything here is pure: the reads and writes are the UI store's, the shapes are decided here.
 */

import type {Paramset} from '../rpc/values.js';

import type {DeviceDescription, DeviceIndex} from './index.js';

/** How many HmIP smoke groups there are: `GROUP_1` … `GROUP_8`. */
export const SMOKE_GROUP_COUNT = 8;

/** The channel type of a smoke detector's smoke channel, on both radios. */
export const SMOKE_DETECTOR_CHANNEL_TYPE = 'SMOKE_DETECTOR';

/** The `TYPE` of the synthesised HmIP smoke group rows. */
export const SMOKE_GROUP_TYPE = 'HmIP-SWSD-Group';

const SMOKE_GROUP_ADDRESS_PATTERN = /^\*GROUP_([1-8])$/;

/** `GROUP_n`, the MASTER parameter of the n-th HmIP smoke group. */
export function smokeGroupParameter(group: number): string {
    return `GROUP_${String(group)}`;
}

/** The address of the synthesised row of the n-th HmIP smoke group: `*GROUP_n`. */
export function smokeGroupAddress(group: number): string {
    return `*GROUP_${String(group)}`;
}

/** The group number of a synthesised HmIP smoke group row's address, or `undefined`. */
export function smokeGroupNumber(address: string): number | undefined {
    const match = SMOKE_GROUP_ADDRESS_PATTERN.exec(address);
    return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Is this the address of a synthesised HmIP smoke group row? */
export function isSmokeGroupAddress(address: string): boolean {
    return SMOKE_GROUP_ADDRESS_PATTERN.test(address);
}

/** Is this channel a smoke detector's smoke channel? */
export function isSmokeDetectorChannel(description: DeviceDescription): boolean {
    return description.TYPE === SMOKE_DETECTOR_CHANNEL_TYPE && (description.PARENT ?? '') !== '';
}

/**
 * The HmIP smoke groups a MASTER paramset puts its channel into, from its `GROUP_n` values -
 * or `undefined` when the paramset has no `GROUP_n` at all, which is the older channel type that
 * cannot be grouped. `true` and `1` both count as set; hmipserver answers booleans.
 */
export function smokeGroupsOf(master: Paramset): number[] | undefined {
    let known = false;
    const groups: number[] = [];
    for (let group = 1; group <= SMOKE_GROUP_COUNT; group += 1) {
        const value = master[smokeGroupParameter(group)];
        if (value === undefined) {
            continue;
        }
        known = true;
        if (value === true || value === 1) {
            groups.push(group);
        }
    }
    return known ? groups : undefined;
}

/**
 * One group row of the device list: a BidCos team (a real device the interface process lists) or
 * an HmIP smoke group (synthesised from the members' `GROUP_n`). `members` are the detector
 * channels' addresses.
 */
export interface SmokeGroup {
    /** The row's address: the team device (`*NEQ0448334`) or `*GROUP_n`. */
    readonly address: string;
    readonly kind: 'team' | 'hmip';
    /** HmIP: 1 … 8. */
    readonly number?: number;
    /** BidCos: the team channel (`*NEQ0448334:1`) a `setTeam` names, and its `TEAM_TAG`. */
    readonly teamChannel?: string;
    readonly teamTag?: string;
    readonly members: readonly string[];
}

/** The membership of one interface's HmIP smoke channels: address → groups, `null` = not groupable. */
export type SmokeGroupMemberships = Readonly<Record<string, readonly number[] | null>>;

/**
 * The BidCos teams of an index: every device with a channel that carries a non-empty
 * `TEAM_CHANNELS`. A team of one (the state every detector starts in) is a team too - it has one
 * member. The group process sends `TEAM_CHANNELS: []` on everything, which is no team.
 */
export function smokeTeams(index: DeviceIndex): SmokeGroup[] {
    const teams: SmokeGroup[] = [];
    for (const device of index.devices()) {
        for (const channel of index.childrenOf(device.ADDRESS)) {
            const members = channel.TEAM_CHANNELS ?? [];
            if (members.length === 0) {
                continue;
            }
            teams.push({
                address: device.ADDRESS,
                kind: 'team',
                teamChannel: channel.ADDRESS,
                teamTag: channel.TEAM_TAG ?? '',
                members: [...members],
            });
            break;
        }
    }
    return teams;
}

/** Is this device a BidCos team - does one of its channels carry members? */
export function isSmokeTeamDevice(index: DeviceIndex, address: string): boolean {
    return index.childrenOf(address).some((channel) => (channel.TEAM_CHANNELS ?? []).length > 0);
}

/**
 * The team device a channel is in, from its `TEAM` (the team channel's address) - or `undefined`
 * when it is in none or the index does not list that team.
 */
export function teamDeviceOf(index: DeviceIndex, channelAddress: string): string | undefined {
    const team = index.get(channelAddress)?.TEAM ?? '';
    if (team === '') {
        return undefined;
    }
    const teamChannel = index.get(team);
    const device = teamChannel?.PARENT ?? '';
    return device !== '' && index.has(device) ? device : undefined;
}

/** The HmIP smoke groups that have at least one member, in group order. */
export function hmipSmokeGroups(memberships: SmokeGroupMemberships): SmokeGroup[] {
    const groups: SmokeGroup[] = [];
    for (let group = 1; group <= SMOKE_GROUP_COUNT; group += 1) {
        const members = Object.entries(memberships)
            .filter(([, groupsOf]) => groupsOf?.includes(group) === true)
            .map(([address]) => address)
            .sort();
        if (members.length > 0) {
            groups.push({address: smokeGroupAddress(group), kind: 'hmip', number: group, members});
        }
    }
    return groups;
}

/** The lowest HmIP group number nobody is in - what *New* takes - or `undefined` when all eight are used. */
export function lowestFreeSmokeGroup(memberships: SmokeGroupMemberships): number | undefined {
    const used = new Set<number>();
    for (const groups of Object.values(memberships)) {
        for (const group of groups ?? []) {
            used.add(group);
        }
    }
    for (let group = 1; group <= SMOKE_GROUP_COUNT; group += 1) {
        if (!used.has(group)) {
            return group;
        }
    }
    return undefined;
}

/** The row of an HmIP smoke group, in the shape the device list draws. */
export function smokeGroupDescription(group: number): DeviceDescription {
    return {
        ADDRESS: smokeGroupAddress(group),
        TYPE: SMOKE_GROUP_TYPE,
        PARENT: '',
        CHILDREN: [],
        PARAMSETS: [],
        FLAGS: 0,
    };
}

/** What changes when a group's members become `wanted`: who joins, who leaves. Order kept. */
export function smokeGroupChanges(
    current: readonly string[],
    wanted: readonly string[],
): {added: string[]; removed: string[]} {
    return {
        added: wanted.filter((address) => !current.includes(address)),
        removed: current.filter((address) => !wanted.includes(address)),
    };
}
