import type {EasyControl, LinkParameterSubset, LinkProfile, Localized} from '../data/types.js';
import type {ParamsetDescription} from '../paramset/description.js';
import type {TimeParameterPair} from '../paramset/time.js';

/**
 * Task 62 (D-54): the CCU easy mode's form of a profile, for one device.
 *
 * The extracted controls (`LinkProfile.controls`) are the union of every branch the WebUI's TCL can
 * take. What a device actually shows depends on its LINK description: a control whose parameter,
 * time pair or `requires` the description lacks is not on its form - the colour selector of an
 * optical-signal device on a plain dimmer, say.
 */
export type EasyFormControl =
    | {kind: 'time'; pair: TimeParameterPair; selector: string; label?: Localized}
    | {kind: 'param'; param: string; also: string[]; option?: string; label?: Localized}
    | {kind: 'subset'; subsets: number[]; names?: Array<Localized | null>; label?: Localized};

/** `SHORT_ON_TIME` -> the pair `SHORT_ON_TIME_BASE` / `SHORT_ON_TIME_FACTOR`, named `SHORT_ON`. */
function pairOf(prefix: string): TimeParameterPair {
    return {
        name: prefix.endsWith('_TIME') ? prefix.slice(0, -'_TIME'.length) : prefix,
        baseParam: `${prefix}_BASE`,
        factorParam: `${prefix}_FACTOR`,
    };
}

function withLabel<T extends object>(control: T, label: Localized | undefined): T & {label?: Localized} {
    return label === undefined ? control : {...control, label};
}

/**
 * The profile's form on this device, in the WebUI's order; `undefined` when the profile has no
 * extracted form or nothing of it applies, which is the dialog's cue to show every parameter.
 */
export function easyForm(
    profile: LinkProfile | undefined,
    description: ParamsetDescription,
): EasyFormControl[] | undefined {
    const controls: readonly EasyControl[] = profile?.controls ?? [];
    const form: EasyFormControl[] = [];
    for (const control of controls) {
        if (!(control.requires ?? []).every((param) => param in description)) {
            continue;
        }
        switch (control.kind) {
            case 'time': {
                const pair = pairOf(control.prefix);
                if (pair.baseParam in description && pair.factorParam in description) {
                    form.push(withLabel({kind: 'time' as const, pair, selector: control.selector}, control.label));
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
                    form.push(withLabel(entry, control.label));
                }
                break;
            }
            case 'subset': {
                const entry = {
                    kind: 'subset' as const,
                    subsets: control.subsets,
                    ...(control.names === undefined ? {} : {names: control.names}),
                };
                form.push(withLabel(entry, control.label));
                break;
            }
        }
    }
    return form.length > 0 ? form : undefined;
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
            params.add(control.pair.baseParam);
            params.add(control.pair.factorParam);
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
