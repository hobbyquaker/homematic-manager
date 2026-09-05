import type {
    LinkProfile,
    LinkSenderMetadata,
    OptionPreset,
    ParamsetDescription,
    ProfileConstraint,
} from '@homematic-manager/core';
import {UI_HINT} from '@homematic-manager/core';

import {formFields, type FormField} from './paramsetForm.js';

/**
 * The link paramset editor's own rules.
 *
 * 2.x carried a hand-converted `options` block per profile in `www/easymodes/`, which is why every
 * HmIP receiver was missing (#50) and why the editors were driven by an `input` hint rather than by
 * the description. Task 9 flattened that per sender channel type into `senderMetadata`, so the
 * dialog shows the sender's **full** option list and marks what the chosen profile fixes - the
 * user can see what a profile does instead of the parameters simply vanishing.
 */

/** One row of the link editor: a normal form field plus what the profile does to it. */
export interface LinkField extends FormField {
    /** The profile pins this parameter; the control is drawn but disabled. */
    readonly fixedByProfile: boolean;
    /** The profile narrows it to these values (a `list` constraint). */
    readonly allowed?: ReadonlyArray<number | string | boolean>;
    /** The profile narrows it to this range. */
    readonly range?: {readonly min: number; readonly max: number};
}

/**
 * `UI_HINT` and `UI_TEMPLATE` are the CCU's own bookkeeping - the profile the WebUI will show. The
 * writer sends `UI_HINT` itself (task 6, item 5a); the dialog never offers them as parameters.
 */
export const LINK_INTERNAL_PARAMS: readonly string[] = [UI_HINT, 'UI_TEMPLATE'];

export interface LinkFieldOptions {
    readonly metadata?: LinkSenderMetadata | undefined;
    readonly presets?: Readonly<Record<string, OptionPreset>>;
    readonly profile?: LinkProfile | undefined;
    /** Expert view: every parameter of the description, in `TAB_ORDER`, nothing greyed out. */
    readonly expert?: boolean;
}

/**
 * The rows of the receiver's LINK paramset.
 *
 * In easy mode the order and the option presets come from `senderMetadata`, everything the metadata
 * does not name follows behind it, and the parameters the profile fixes are disabled. In expert
 * mode it is the plain description order and nothing is disabled - which is what profile 0 means.
 */
export function linkFields(description: ParamsetDescription, options: LinkFieldOptions = {}): LinkField[] {
    const expert = options.expert === true;
    const constraints: Record<string, ProfileConstraint> = expert ? {} : (options.profile?.params ?? {});
    const order = expert ? [] : (options.metadata?.parameterOrder ?? []);
    const presetIds = expert ? {} : (options.metadata?.optionPresets ?? {});
    const presets = options.presets ?? {};

    const base = formFields(description).filter((field) => !LINK_INTERNAL_PARAMS.includes(field.name));
    const rank = new Map(order.map((name, index) => [name, index]));
    base.sort((a, b) => (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER));

    return base.map((field) => {
        const constraint = constraints[field.name];
        const preset = presets[presetIds[field.name] ?? ''];
        return {
            ...field,
            ...(preset === undefined ? {} : {preset}),
            fixedByProfile: constraint?.kind === 'fixed',
            ...(constraint?.kind === 'list' ? {allowed: constraint.values} : {}),
            ...(constraint?.kind === 'range' ? {range: {min: constraint.min, max: constraint.max}} : {}),
        };
    });
}

/**
 * The label of a profile in the user's language, with English and German behind it - the same
 * fallback chain the translations use (D-15).
 */
export function profileLabel(profile: LinkProfile, language: string): string {
    const name = profile.name as Record<string, string | undefined>;
    return name[language] ?? name['en'] ?? name['de'] ?? profile.key;
}

export function profileDescription(profile: LinkProfile, language: string): string {
    const text = profile.description as Record<string, string | undefined>;
    return text[language] ?? text['en'] ?? text['de'] ?? '';
}
