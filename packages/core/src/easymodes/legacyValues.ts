/**
 * B-98: what the CCU's WebUI wrote for a profile before eQ-3 changed the profile, so that a link made
 * with the older WebUI is still recognised.
 *
 * On 2026-06-22 eQ-3 changed the long press of the shutter and blind profiles (OpenCCU-Base
 * `src/webui` commit `122e267b`, "Easymode parameter LONG_PROFILE_ACTION_TYPE for blind and jalousie
 * actors changed"): `LONG_PROFILE_ACTION_TYPE` `5` (toggle, last direction) or `{5 1}` became `1`. The
 * profile data follows the new WebUI, so a link a CCU made before - an HmIPW-DRBL4 run as a shutter
 * with "auf / zu & hoch / herunter" holds `5` - fitted none of the profiles and showed as Expert.
 *
 * The profiles of exactly the files eQ-3 changed carry the old values as `legacy`. Detection takes
 * them only where no profile fits the link as the data has it: the current WebUI shows an old
 * "auf / zu & hoch / herunter" link as "Toggle", whose list still takes 5 and whose other presets
 * are the same, and that stays so - but an old "auf / hoch", "zu / herunter" or "Position anfahren"
 * link, which fits nothing, is recognised instead of falling back to Expert. Applying a profile
 * keeps the old value where the link already holds it (nothing to write for a link left as the CCU
 * made it) and writes the new one otherwise, as the current WebUI does.
 */

import type {LinkProfile, ProfileConstraint} from '../data/types.js';

type LegacyValues = Readonly<Record<number, Readonly<Record<string, readonly number[]>>>>;

const LONG_PROFILE_ACTION_TYPE = 'LONG_PROFILE_ACTION_TYPE';

/** SHUTTER_VIRTUAL_RECEIVER: profiles 1, 2, 4 wrote `{5 1}`, profile 3 wrote `5`. */
const SHUTTER: LegacyValues = {
    1: {[LONG_PROFILE_ACTION_TYPE]: [5, 1]},
    2: {[LONG_PROFILE_ACTION_TYPE]: [5, 1]},
    3: {[LONG_PROFILE_ACTION_TYPE]: [5]},
    4: {[LONG_PROFILE_ACTION_TYPE]: [5, 1]},
};

/** BLIND_VIRTUAL_RECEIVER: profile 3 wrote `5` or took `{1 5}` / `{5 1}`. */
const BLIND: LegacyValues = {3: {[LONG_PROFILE_ACTION_TYPE]: [5, 1]}};

/** By receiver folder and sender file: the values the WebUI wrote before the change, per profile. */
export const LEGACY_PROFILE_VALUES: Readonly<Record<string, Readonly<Record<string, LegacyValues>>>> = {
    SHUTTER_VIRTUAL_RECEIVER: {
        DISPLAY_INPUT_TRANSMITTER: SHUTTER,
        DISPLAY_LEVEL_INPUT_TRANSMITTER: SHUTTER,
        KEY_TRANSCEIVER: SHUTTER,
        MULTI_MODE_INPUT_TRANSMITTER_1: SHUTTER,
        MULTI_MODE_INPUT_TRANSMITTER_3: SHUTTER,
        MULTI_MODE_INPUT_TRANSMITTER_4: SHUTTER,
    },
    BLIND_VIRTUAL_RECEIVER: {
        DISPLAY_INPUT_TRANSMITTER: BLIND,
        DISPLAY_LEVEL_INPUT_TRANSMITTER: BLIND,
        KEY_TRANSCEIVER: BLIND,
        MULTI_MODE_INPUT_TRANSMITTER_1: BLIND,
        MULTI_MODE_INPUT_TRANSMITTER_3: BLIND,
        MULTI_MODE_INPUT_TRANSMITTER_4: BLIND,
        ROTARY_CONTROL_TRANSCEIVER_2: BLIND,
        ROTARY_CONTROL_TRANSCEIVER_3: BLIND,
        SWITCH_TRANSCEIVER: BLIND,
    },
};

/** The profiles of one receiver folder and sender file, with what the older WebUI wrote as `legacy`. */
export function withLegacyValues(
    receiverFolder: string,
    senderFile: string,
    profiles: readonly LinkProfile[],
): LinkProfile[] {
    const table = LEGACY_PROFILE_VALUES[receiverFolder]?.[senderFile];
    if (!table) {
        return [...profiles];
    }
    return profiles.map((profile) => {
        const legacy = table[profile.id];
        if (!legacy) {
            return profile;
        }
        const entries = Object.entries(legacy).filter(([param]) => param in profile.params);
        return entries.length === 0
            ? profile
            : {...profile, legacy: Object.fromEntries(entries.map(([param, values]) => [param, [...values]]))};
    });
}

/** A profile whose constraints also hold for its `legacy` values; the current value stays the default. */
export function legacyProfile(profile: LinkProfile): LinkProfile {
    if (!profile.legacy) {
        return profile;
    }
    const params: Record<string, ProfileConstraint> = {...profile.params};
    for (const [param, values] of Object.entries(profile.legacy)) {
        const constraint = params[param];
        if (constraint) {
            params[param] = widened(constraint, values);
        }
    }
    return {...profile, params};
}

/** A constraint that also holds for the older WebUI's values; the current value stays the default. */
function widened(constraint: ProfileConstraint, legacy: ReadonlyArray<number | string | boolean>): ProfileConstraint {
    switch (constraint.kind) {
        case 'fixed': {
            const values = [constraint.value, ...legacy.filter((value) => value !== constraint.value)];
            return {kind: 'list', values, default: constraint.value};
        }
        case 'list': {
            const extra = legacy.filter((value) => !constraint.values.includes(value));
            return extra.length === 0 ? constraint : {...constraint, values: [...constraint.values, ...extra]};
        }
        case 'range':
            return constraint;
    }
}
