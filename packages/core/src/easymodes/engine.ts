/**
 * The easy-mode and MASTER-metadata engine.
 *
 * The CCU's WebUI hides the 40-odd parameters of a link paramset behind a handful of profiles
 * ("switch on", "staircase light", ...) and shows the raw parameters only in the expert view.
 * 2.x carried 28 hand-converted receiver types in `www/easymodes/`, which is why every HmIP
 * receiver is missing (issue #50). Here the profiles come from the data pipeline (task 9,
 * openccu-data, D-6) through the `DataSource` contract and the engine is pure logic.
 *
 * The same data set also knows what the paramset descriptions do not: the display order of MASTER
 * parameters, which of them only make sense with a certain value of another one, the typical
 * values for a delay or a level, and rules between parameters.
 */

import type {
    CrossValidationRule,
    DataSource,
    LinkProfile,
    LinkSenderMetadata,
    MasterMetadata,
    OptionPreset,
    ProfileConstraint,
} from '../data/types.js';
import {parameterOrder, type ParameterDescription, type ParamsetDescription} from '../paramset/description.js';
import type {Paramset, ParamsetValue} from '../rpc/values.js';

/** The parameter the CCU stores the chosen profile in, inside the receiver's LINK paramset. */
export const UI_HINT = 'UI_HINT';

/** Profile 0 is the expert view: no constraints, every parameter editable. */
export const EXPERT_PROFILE_ID = 0;

const EXPERT_PROFILE: LinkProfile = {
    id: EXPERT_PROFILE_ID,
    key: 'expert',
    name: {de: 'Experte', en: 'Expert'},
    description: {de: 'Alle Parameter des Verknuepfungs-Parametersatzes', en: 'All link paramset parameters'},
    params: {},
};

/** Why a profile could not be applied in full. */
export type ProfileProblemCode =
    /** The profile constrains a parameter this firmware's description does not have. */
    | 'unknown-parameter'
    /** A `list` constraint with no values at all. */
    | 'empty-list';

export interface ProfileProblem {
    readonly param: string;
    readonly code: ProfileProblemCode;
    readonly message: string;
}

export interface AppliedProfile {
    /** The complete new link paramset: the current values with the profile's applied on top. */
    readonly values: Record<string, ParamsetValue>;
    /** Parameters the profile named that could not be set. */
    readonly problems: readonly ProfileProblem[];
}

/** One MASTER parameter as the dialog should show it. */
export interface MasterParameterView {
    readonly name: string;
    readonly description: ParameterDescription;
    /** False when a `conditionalVisibility` rule hides it at the current values. */
    readonly visible: boolean;
    /** The dropdown of typical values, where the metadata names one that exists. */
    readonly preset?: OptionPreset;
}

/** A failed cross-validation rule. */
export interface CrossValidationProblem {
    readonly id: string;
    /** Key into `Translations.uiLabels`. */
    readonly errorKey: string;
    /** The parameters the rule looked at, so the dialog can mark them. */
    readonly params: readonly string[];
}

export interface MasterView {
    readonly channelType: string;
    /** In display order: the metadata's order first, then the rest by `TAB_ORDER`. */
    readonly parameters: readonly MasterParameterView[];
    readonly problems: readonly CrossValidationProblem[];
}

/** Reads the easy-mode data through a `DataSource` and answers the dialogs' questions. */
export class EasyModeEngine {
    readonly #source: DataSource;

    constructor(source: DataSource) {
        this.#source = source;
    }

    /**
     * The profiles a receiver channel type offers for a given sender channel type, expert first.
     * Aliases are followed (`OPTICAL_SIGNAL_RECEIVER` -> `DIMMER_VIRTUAL_RECEIVER` -> `DIMMER`),
     * and the expert profile is always present even when the data does not carry it.
     */
    async profilesFor(receiverType: string, senderType: string): Promise<LinkProfile[]> {
        const aliases = await this.#source.receiverTypeAliases();
        const resolved = resolveAlias(receiverType, aliases);
        const profiles = await this.#source.receiverProfiles(resolved);
        const list = [...(profiles?.senders[senderType] ?? [])];
        if (!list.some((profile) => profile.id === EXPERT_PROFILE_ID)) {
            list.push(EXPERT_PROFILE);
        }
        return list.sort((a, b) => a.id - b.id);
    }

    /**
     * What the easy-mode dialog shows besides the profile itself: the display order of the
     * editable link parameters, their option presets and the WebUI's value subsets, for one
     * sender channel type. `undefined` where the data has none - the dialog then falls back to
     * `TAB_ORDER`.
     */
    async linkMetadataFor(receiverType: string, senderType: string): Promise<LinkSenderMetadata | undefined> {
        const aliases = await this.#source.receiverTypeAliases();
        const profiles = await this.#source.receiverProfiles(resolveAlias(receiverType, aliases));
        return profiles?.senderMetadata?.[senderType];
    }

    /**
     * The link paramset after choosing a profile: the current values with the profile's
     * constraints applied and `UI_HINT` set to the profile id, so that the CCU's own WebUI
     * recognises the profile afterwards.
     *
     * A parameter the profile names but the description does not have is reported instead of
     * written - openccu-data describes a channel type, a description belongs to one firmware.
     */
    applyProfile(profile: LinkProfile, current: Paramset, description: ParamsetDescription): AppliedProfile {
        const values: Record<string, ParamsetValue> = {...current};
        const problems: ProfileProblem[] = [];

        for (const [param, constraint] of Object.entries(profile.params)) {
            if (!(param in description)) {
                problems.push({
                    param,
                    code: 'unknown-parameter',
                    message: `profile ${profile.key} sets ${param}, which this description does not have`,
                });
                continue;
            }
            const applied = applyConstraint(constraint, current[param]);
            if (applied === undefined) {
                problems.push({
                    param,
                    code: 'empty-list',
                    message: `profile ${profile.key} offers no value for ${param}`,
                });
                continue;
            }
            values[param] = applied;
        }

        if (UI_HINT in description) {
            values[UI_HINT] = String(profile.id);
        }

        return {values, problems};
    }

    /**
     * Which profile a link paramset currently follows: by `UI_HINT` when the CCU wrote one,
     * otherwise by matching the profiles' `fixed` parameters against the current values - the more
     * fixed parameters a profile matches, the better the fit.
     *
     * `undefined` means "none of them"; the caller then shows the expert view.
     */
    detectProfile(linkParamset: Paramset, profiles: readonly LinkProfile[]): LinkProfile | undefined {
        const hint = linkParamset[UI_HINT];
        if (hint !== undefined && hint !== '') {
            const byHint = profiles.find((profile) => String(profile.id) === String(hint));
            if (byHint) {
                return byHint;
            }
        }

        let best: LinkProfile | undefined;
        let bestScore = 0;
        for (const profile of profiles) {
            const fixed = Object.entries(profile.params).filter(
                (entry): entry is [string, Extract<ProfileConstraint, {kind: 'fixed'}>] => entry[1].kind === 'fixed',
            );
            if (fixed.length === 0) {
                continue;
            }
            if (!fixed.every(([param, constraint]) => sameProfileValue(linkParamset[param], constraint.value))) {
                continue;
            }
            if (fixed.length > bestScore) {
                bestScore = fixed.length;
                best = profile;
            }
        }
        return best;
    }

    /**
     * The MASTER paramset of a channel type as the dialog should show it: ordered, with the
     * parameters a `conditionalVisibility` rule hides at the current values marked invisible, the
     * option presets resolved, and the cross-validation rules evaluated.
     */
    async masterMetadataFor(
        channelType: string,
        description: ParamsetDescription,
        values: Paramset = {},
    ): Promise<MasterView> {
        const metadata = (await this.#source.masterMetadata())[channelType];
        const presets = await this.#source.optionPresets();
        const rules = await this.#source.crossValidations();

        const parameters = orderParameters(description, metadata).map(([name, parameter]) => {
            const preset = presets[metadata?.optionPresets?.[name] ?? ''];
            const view: MasterParameterView = {
                name,
                description: parameter,
                visible: isVisible(name, metadata, values),
            };
            return preset === undefined ? view : {...view, preset};
        });

        return {
            channelType,
            parameters,
            problems: rules
                .filter((rule) => appliesTo(rule, description))
                .filter((rule) => !holds(rule, values))
                .map((rule) => ({id: rule.id, errorKey: rule.errorKey, params: ruleParams(rule)})),
        };
    }
}

/** Follows the alias chain, stopping at the first repetition so a cyclic table cannot hang. */
export function resolveAlias(receiverType: string, aliases: Readonly<Record<string, string>>): string {
    let current = receiverType;
    const seen = new Set<string>([current]);
    let next = aliases[current];
    while (next !== undefined && !seen.has(next)) {
        current = next;
        seen.add(current);
        next = aliases[current];
    }
    return current;
}

function applyConstraint(constraint: ProfileConstraint, current: ParamsetValue | undefined): ParamsetValue | undefined {
    switch (constraint.kind) {
        case 'fixed':
            return constraint.value;
        case 'list': {
            if (current !== undefined && constraint.values.some((value) => sameProfileValue(current, value))) {
                return current;
            }
            return constraint.default ?? constraint.values[0];
        }
        case 'range': {
            const number = typeof current === 'number' ? current : Number(current);
            if (Number.isFinite(number) && number >= constraint.min && number <= constraint.max) {
                return number;
            }
            return constraint.default ?? constraint.min;
        }
    }
}

/**
 * Loose comparison, because the profile data is text ("1", "111600") while the CCU sends numbers,
 * and an enum is a name on HmIP and an index on BidCos.
 */
function sameProfileValue(a: ParamsetValue | undefined, b: ParamsetValue | undefined): boolean {
    if (a === b) {
        return true;
    }
    if (a === undefined || b === undefined) {
        return false;
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        return Boolean(a) === Boolean(b);
    }
    const left = Number(a);
    const right = Number(b);
    if (!Number.isNaN(left) && !Number.isNaN(right)) {
        return left === right;
    }
    return String(a) === String(b);
}

/**
 * Display order: the parameters the metadata names first and in its order, then everything else by
 * `TAB_ORDER`. A name the metadata carries that this firmware does not have simply does not occur.
 */
function orderParameters(
    description: ParamsetDescription,
    metadata: MasterMetadata | undefined,
): Array<[string, ParameterDescription]> {
    const byTabOrder = parameterOrder(description);
    const preferred = new Map((metadata?.parameterOrder ?? []).map((name, index) => [name, index]));
    return Object.entries(description).sort(([a], [b]) => {
        const left = preferred.get(a);
        const right = preferred.get(b);
        if (left !== undefined && right !== undefined) {
            return left - right;
        }
        if (left !== undefined) {
            return -1;
        }
        if (right !== undefined) {
            return 1;
        }
        return byTabOrder.indexOf(a) - byTabOrder.indexOf(b);
    });
}

function isVisible(name: string, metadata: MasterMetadata | undefined, values: Paramset): boolean {
    const rules = (metadata?.conditionalVisibility ?? []).filter((rule) => rule.show.includes(name));
    if (rules.length === 0) {
        return true;
    }
    return rules.some((rule) => sameProfileValue(values[rule.trigger], rule.triggerValue));
}

function ruleParams(rule: CrossValidationRule): string[] {
    return rule.rule === 'between' ? [rule.param, rule.minParam, rule.maxParam] : [rule.paramA, rule.paramB];
}

function appliesTo(rule: CrossValidationRule, description: ParamsetDescription): boolean {
    return ruleParams(rule).every((param) => param in description);
}

/** A rule whose values are not all numbers cannot be judged and counts as satisfied. */
function holds(rule: CrossValidationRule, values: Paramset): boolean {
    if (rule.rule === 'between') {
        const value = Number(values[rule.param]);
        const min = Number(values[rule.minParam]);
        const max = Number(values[rule.maxParam]);
        if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
            return true;
        }
        return value >= min && value <= max;
    }
    const left = Number(values[rule.paramA]);
    const right = Number(values[rule.paramB]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return true;
    }
    return rule.rule === 'gte' ? left >= right : left <= right;
}
