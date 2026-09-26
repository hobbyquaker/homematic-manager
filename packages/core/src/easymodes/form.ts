import type {EasyControl, LinkParameterSubset, LinkProfile, Localized} from '../data/types.js';
import type {ParamsetDescription} from '../paramset/description.js';
import {findDurationPairs, type DurationPair} from '../paramset/time.js';

/**
 * Tasks 62 and 63 (D-54, D-55): the CCU easy mode's form, for one device.
 *
 * The extracted controls - a link profile's (`LinkProfile.controls`) or a channel type's MASTER
 * form (`MasterMetadata.controls`) - are the union of every branch the WebUI's Tcl can take. What
 * a device actually shows depends on its description: a control whose parameter, time pair or
 * `requires` the description lacks is not on its form - the colour selector of an optical-signal
 * device on a plain dimmer, say.
 */
export type EasyFormControl =
    | {kind: 'time'; pair: DurationPair; selector: string; label?: Localized}
    | {kind: 'param'; param: string; also: string[]; option?: string; label?: Localized}
    | {kind: 'subset'; subsets: number[]; names?: Array<Localized | null>; label?: Localized};

function withLabel<T extends object>(control: T, label: Localized | undefined): T & {label?: Localized} {
    return label === undefined ? control : {...control, label};
}

/**
 * The form of a list of controls on this device, in the WebUI's order; `undefined` when there are
 * none or nothing of them applies, which is the dialogs' cue to show every parameter.
 */
export function easyFormOf(
    controls: readonly EasyControl[] | undefined,
    description: ParamsetDescription,
): EasyFormControl[] | undefined {
    // a time control names the pair by its prefix: `SHORT_ON_TIME` for `SHORT_ON_TIME_BASE`, and
    // `EVENT_DELAY` for `EVENT_DELAY_UNIT` - both are among the description's duration pairs
    const pairs = new Map(findDurationPairs(description).map((pair) => [pair.unitParam, pair]));
    const form: EasyFormControl[] = [];
    // The controls are the union of every branch the WebUI's Tcl can take, and a branch it decides
    // on something other than the description - `hmip/BLIND_VIRTUAL_RECEIVER.tcl` asks the
    // channel's `channelMode` metadata - lists the same control again. A form draws each control
    // once, from its first branch (B-73, #168): the dialogs key their rows by it.
    const drawn = new Set<string>();
    const push = (identity: string, entry: EasyFormControl): void => {
        if (drawn.has(identity)) return;
        drawn.add(identity);
        form.push(entry);
    };
    for (const control of controls ?? []) {
        if (!(control.requires ?? []).every((param) => param in description)) {
            continue;
        }
        switch (control.kind) {
            case 'time': {
                const pair = pairs.get(`${control.prefix}_BASE`) ?? pairs.get(`${control.prefix}_UNIT`);
                if (pair) {
                    push(
                        `time:${pair.name}`,
                        withLabel({kind: 'time' as const, pair, selector: control.selector}, control.label),
                    );
                }
                break;
            }
            case 'param': {
                if (control.param in description) {
                    const also = (control.also ?? []).filter((param) => param in description);
                    const entry = {
                        kind: 'param' as const,
                        param: control.param,
                        also,
                        ...(control.option === undefined ? {} : {option: control.option}),
                    };
                    push(`param:${control.param}`, withLabel(entry, control.label));
                }
                break;
            }
            case 'subset': {
                const entry = {
                    kind: 'subset' as const,
                    subsets: control.subsets,
                    ...(control.names === undefined ? {} : {names: control.names}),
                };
                push(`subset:${control.subsets.join(',')}`, withLabel(entry, control.label));
                break;
            }
        }
    }
    return form.length > 0 ? form : undefined;
}

/** A link profile's form on this device (task 62). */
export function easyForm(
    profile: LinkProfile | undefined,
    description: ParamsetDescription,
): EasyFormControl[] | undefined {
    return easyFormOf(profile?.controls, description);
}

/**
 * Every parameter the form edits: both halves of each time pair, each combo box's parameter and
 * the ones it writes along, and the members of the offered subsets. The expert view highlights
 * exactly these rows.
 */
export function easyFormParams(
    form: readonly EasyFormControl[] | undefined,
    subsets: readonly LinkParameterSubset[] = [],
): Set<string> {
    const params = new Set<string>();
    for (const control of form ?? []) {
        if (control.kind === 'time') {
            params.add(control.pair.unitParam);
            params.add(control.pair.countParam);
        } else if (control.kind === 'param') {
            params.add(control.param);
            for (const param of control.also) params.add(param);
        } else {
            for (const subset of subsets) {
                if (control.subsets.includes(subset.id)) {
                    for (const param of subset.params) params.add(param);
                }
            }
        }
    }
    return params;
}
