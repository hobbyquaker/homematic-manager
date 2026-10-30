/**
 * Task 109: the forms the CCU's WebUI draws for the *sender* side of a link.
 *
 * `ic_setprofiles.cgi` sources `easymodes/<paramid>.tcl` for the sender part of a link, the id being
 * `getParamsetId(<sender>, LINK)`. For almost every sender that file does not exist, or is only a
 * receiver folder's dispatcher, and the sender's LINK parameters - where it has any - are shown raw.
 * Three old BidCos sensors have a form of their own:
 *
 * - `ks550_ch_link` (KS550, HM-WDS100-C6-O) and `wds100_ch_link` (HM-WDS100-C6-O-2): the weather
 *   station's storm thresholds, a profile "Sturmschwelle" with the switch-on and switch-off threshold
 *   as a Beaufort scale; the HM-WDS100-C6-O-2 copies them into the receiver's `SHORT_COND_VALUE_HI` /
 *   `SHORT_COND_VALUE_LO`. Hidden when the receiver is a combination sensor (`WS_CS`).
 * - `wa_od_ch_link` (HM-Sen-Wa-Od, the capacitive filling level sensor): no profile, the upper and
 *   lower fill level as a percentage (the raw value is twice it), each switchable off (255).
 *
 * The tables are the WebUI's (`www/config/easymodes`); `data/extracted/easymode_links.json`'s
 * `senders` and `weatherTexts` are extracted from it by `data/scripts/easymode-links.mjs`, and
 * `senderForms.test.ts` fails where this module differs from the extract.
 */

import type {Paramset, ParamsetValue} from '../rpc/values.js';

/** A localised text of the forms: German and English, as the WebUI has them. */
export interface SenderText {
    readonly de: string;
    readonly en: string;
}

/** One entry of a threshold select: the raw value and its Beaufort grade. */
export interface StormOption {
    readonly value: number;
    /** The Beaufort grade, 0-12 - the index into {@link WIND_FORCE} and {@link WIND_DESCRIPTION}. */
    readonly force: number;
}

export interface StormForm {
    readonly kind: 'storm';
    readonly paramsetId: string;
    /** The values the profile "Sturmschwelle" takes for both thresholds (`set range {…}`). */
    readonly range: readonly number[];
    /** What the selects offer, by device type (the HM-WDS100-C6-O-2 has 20 where the others have 25). */
    readonly options: (senderDeviceType: string) => readonly StormOption[];
    /** The receiver parameters the thresholds are copied into, for this sender device type. */
    readonly mirrors: (senderDeviceType: string) => Readonly<Record<string, string>>;
}

export interface FillLevelForm {
    readonly kind: 'fillLevel';
    readonly paramsetId: string;
    /** The raw value of a threshold that is switched off. */
    readonly inactive: number;
    /** Raw value per percent: the WebUI shows `100 / (200 / raw)`. */
    readonly perPercent: number;
}

export type SenderForm = StormForm | FillLevelForm;

/** The profile ids of the storm form: the expert view and "Sturmschwelle". */
export const STORM_EXPERT = 0;
export const STORM_THRESHOLD = 1;

const STORM_THRESHOLDS = ['STORM_UPPER_THRESHOLD', 'STORM_LOWER_THRESHOLD'] as const;

/** The Beaufort options of the KS550 form: raw value -> grade. */
const KS550_OPTIONS: readonly StormOption[] = [
    [1, 0],
    [2, 1],
    [5, 2],
    [12, 3],
    [25, 4],
    [29, 5],
    [39, 6],
    [50, 7],
    [62, 8],
    [75, 9],
    [89, 10],
    [103, 11],
    [118, 12],
].map(([value, force]) => ({value: value ?? 0, force: force ?? 0}));

const WDS100_2 = 'HM-WDS100-C6-O-2';

export const SENDER_FORMS: Readonly<Record<string, SenderForm>> = {
    ks550_ch_link: {
        kind: 'storm',
        paramsetId: 'ks550_ch_link',
        range: [1, 2, 5, 12, 15, 25, 29, 39, 50, 62, 75, 89, 103, 118],
        options: () => KS550_OPTIONS,
        mirrors: () => ({}),
    },
    wds100_ch_link: {
        kind: 'storm',
        paramsetId: 'wds100_ch_link',
        range: [1, 2, 5, 12, 15, 20, 25, 29, 39, 50, 62, 75, 89, 103, 118],
        // `[string first "HM-WDS100-C6-O-2" $SENDER] == 0`: grade 4 is 20 on that one, 25 otherwise
        options: (deviceType) =>
            deviceType.startsWith(WDS100_2)
                ? KS550_OPTIONS.map((option) => (option.value === 25 ? {value: 20, force: option.force} : option))
                : KS550_OPTIONS,
        mirrors: (deviceType) =>
            deviceType === WDS100_2
                ? {STORM_UPPER_THRESHOLD: 'SHORT_COND_VALUE_HI', STORM_LOWER_THRESHOLD: 'SHORT_COND_VALUE_LO'}
                : {},
    },
    wa_od_ch_link: {kind: 'fillLevel', paramsetId: 'wa_od_ch_link', inactive: 255, perPercent: 2},
};

/** Receivers for which the storm form hides itself ("bei Verknüpfung Wetterstation - Kombisensor sinnlos"). */
export const STORM_HIDDEN_FOR_RECEIVER = 'WS_CS';

/**
 * The sender form of a link: the one the sender's LINK paramset id names, unless that form hides
 * itself for this receiver. `undefined` shows the sender's parameters raw, as before.
 */
export function senderFormFor(paramsetId: string, receiverType: string): SenderForm | undefined {
    const form = SENDER_FORMS[paramsetId];
    if (form?.kind === 'storm' && receiverType === STORM_HIDDEN_FOR_RECEIVER) {
        return undefined;
    }
    return form;
}

const asNumber = (value: ParamsetValue | undefined): number => (typeof value === 'number' ? value : Number(value));

/**
 * The profile of a storm form a link follows, as `get_cur_profile2` decides it: "Sturmschwelle"
 * when both thresholds hold one of its values (`PEER_NEEDS_BURST` takes either), the expert view
 * otherwise - a fresh link's thresholds are 0.
 */
export function stormProfile(form: StormForm, values: Paramset): number {
    const fits = STORM_THRESHOLDS.every((name) => form.range.includes(asNumber(values[name])));
    return fits ? STORM_THRESHOLD : STORM_EXPERT;
}

/**
 * What choosing "Sturmschwelle" writes: the thresholds stay where they already hold a value of the
 * profile, otherwise the first one (the WebUI's select starts on it).
 */
export function applyStormProfile(form: StormForm, values: Paramset): Record<string, number> {
    const result: Record<string, number> = {};
    for (const name of STORM_THRESHOLDS) {
        if (!(name in values)) continue;
        const current = asNumber(values[name]);
        result[name] = form.range.includes(current) ? current : (form.range[0] ?? 0);
    }
    return result;
}

/**
 * The fill level of a raw threshold as the WebUI shows it: `100 / (200 / raw)` rounded to .0 or .5
 * (`setDecimalPlaces`), and whether the threshold is on at all.
 */
export function fillLevelPercent(
    form: FillLevelForm,
    raw: ParamsetValue | undefined,
): {percent: number; active: boolean} {
    const value = asNumber(raw);
    if (value === form.inactive) {
        return {percent: 0, active: false};
    }
    if (!Number.isFinite(value) || value <= 0) {
        return {percent: 0, active: true};
    }
    return {percent: roundHalf(value / form.perPercent), active: true};
}

/** The raw threshold of a percentage (0-100, to .0 or .5), or the inactive value. */
export function fillLevelRaw(form: FillLevelForm, percent: number, active: boolean): number {
    if (!active) {
        return form.inactive;
    }
    const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    return Math.round(roundHalf(clamped) * form.perPercent);
}

/** `setDecimalPlaces`: one decimal, then .1-.2 down to .0, .3-.7 to .5, .8-.9 up to the next whole. */
function roundHalf(value: number): number {
    const tenths = Math.round(value * 10);
    const whole = Math.floor(tenths / 10);
    const decimal = tenths - whole * 10;
    if (decimal === 0) return whole;
    if (decimal <= 2) return whole;
    if (decimal <= 7) return whole + 0.5;
    return whole + 1;
}

/**
 * `isLowerGTUpper` of the WebUI's fill level form: the lower threshold stays 5 % below the upper
 * one. A lower one at or above the upper pushes the upper up (unless that is off); an upper one at
 * or below the lower pulls the lower down; the lower never below 0, the upper never above 100.
 * Percentages; `undefined` for a threshold that is off.
 */
export function adjustFillLevels(
    changed: 'upper' | 'lower',
    upper: number | undefined,
    lower: number | undefined,
): {upper: number | undefined; lower: number | undefined} {
    let up = upper;
    let low = lower;
    if (changed === 'lower') {
        if (low !== undefined && up !== undefined && low >= up) {
            up = low + 5;
        }
    } else {
        if (up !== undefined && low !== undefined && up <= low) {
            low = up - 5;
        }
        if (low !== undefined && low < 0) {
            low = 0;
            if (up !== undefined) up = 5;
        }
        if (up !== undefined && up > 100) {
            up = 100;
            if (low !== undefined) low = 95;
        }
    }
    return {upper: up, lower: low};
}

/** The weather forms' texts (`WEATHER/localization/lang.js`). */
export const STORM_TEXTS: Readonly<Record<string, SenderText>> = {
    weatherProfile1: {de: 'Sturmschwelle', en: 'Storm threshold'},
    windInBeaufort: {de: 'Windstärke in Beaufort', en: 'Wind strength in Beaufort scale'},
    upperStormThreshold: {de: 'Einschaltschwelle', en: 'Switch-on threshold'},
    lowerStormThreshold: {de: 'Ausschaltschwelle', en: 'Switch-off threshold'},
    toolTip0: {
        de: 'Schaltbefehl bei überschreiten der eingestellten Schaltschwelle',
        en: 'Switching command on exceeding the set threshold',
    },
    toolTip1: {
        de: 'Schaltbefehl bei Unterschreiten der eingestellten Schaltschwelle',
        en: 'Switching command on fall below the set threshold',
    },
};

/** The names of the storm form's profiles (`PROFILES_MAP`): the expert view and "Sturmschwelle". */
export const STORM_PROFILE_NAMES: Readonly<Record<number, SenderText>> = {
    [STORM_EXPERT]: {de: 'Experte', en: 'Expert'},
    [STORM_THRESHOLD]: {de: 'Sturmschwelle', en: 'Storm threshold'},
};

/** The Beaufort grades' names, 0-12. */
export const WIND_FORCE: readonly SenderText[] = [
    {de: 'Windstärke 0 - Windstille', en: 'Wind strength 0 - Calm'},
    {de: 'Windstärke 1 - leiser Zug', en: 'Wind strength 1 - Light air'},
    {de: 'Windstärke 2 - leichte Brise', en: 'Wind strength 2 - Light breeze'},
    {de: 'Windstärke 3 - schwache Brise', en: 'Wind strength 3 - Gentle breeze'},
    {de: 'Windstärke 4 - mäßige Brise', en: 'Wind strength 4 - Moderate breeze'},
    {de: 'Windstärke 5 - frischer Wind', en: 'Wind strength 5 - Fresh breeze'},
    {de: 'Windstärke 6 - starker Wind', en: 'Wind strength 6 - Strong breeze'},
    {de: 'Windstärke 7 - steifer Wind', en: 'Wind strength 7 - High wind, moderate gale, near gale'},
    {de: 'Windstärke 8 - stürmischer Wind', en: 'Wind strength 8 - Gale, fresh gale'},
    {de: 'Windstärke 9 - Sturm', en: 'Wind strength 9 - Strong gale'},
    {de: 'Windstärke 10 - schwerer Sturm', en: 'Wind strength 10 - Strom, whole gale'},
    {de: 'Windstärke 11 - orkanartiger Sturm', en: 'Wind strength 11 - Violent storm'},
    {de: 'Windstärke 12 - Orkan', en: 'Wind strength 12 - Hurricane force'},
];

/** What each grade looks like outside, 0-12. */
export const WIND_DESCRIPTION: readonly SenderText[] = [
    {de: 'Keine Luftbewegung, Rauch steigt senkrecht empor.', en: 'Calm, smoke rises vertically.'},
    {
        de: 'Kaum merklich, Rauch treibt leicht ab, Windflügel und Windfahnen unbewegt.',
        en: 'Smoke drift indicates wind direction, still wind vanes.',
    },
    {de: 'Blätter rascheln, Wind im Gesicht spürbar.', en: 'Leaves rustle, wind felt on face.'},
    {
        de: 'Blätter und dünne Zweige bewegen sich, Wimpel werden gestreckt.',
        en: 'Leaves and small twigs constantly moving, light flags extended',
    },
    {
        de: 'Zweige bewegen sich, loses Papier wird vom Boden gehoben.',
        en: 'Leaves and loose paper lifted, small tree branches move',
    },
    {
        de: 'Größere Zweige und Bäume bewegen sich, Wind deutlich hörbar.',
        en: 'Larger tree branches and trees begin to sway, wind noticeable',
    },
    {
        de: 'Dicke Äste bewegen sich, hörbares Pfeifen an Drahtseilen und Telefonleitungen.',
        en: 'Larger tree branches moving, whistling in wires',
    },
    {
        de: 'Bäume schwanken, Widerstand beim Gehen gegen den Wind.',
        en: 'Whole trees moving, resistance felt walking against wind',
    },
    {
        de: 'Grosse Bäume werden bewegt, Zweige brechen von Bäumen, erhebliche Behinderung beim Gehen.',
        en: 'Larger tress moving, twigs breaking off trees, generally impedes progress',
    },
    {
        de: 'Äste brechen, kleinere Schäden an Häusern, Ziegel werden von Dächern abgehoben, Gartenmöbel werden umgeworfen und verweht.',
        en: 'Branches breaking off trees, slight damages on houses, slate blows off roofs',
    },
    {
        de: 'Bäume werden entwurzelt, Baumstämme brechen, grössere Schäden an Häusern.',
        en: 'Trees broken or uprooted, considerable damages on houses',
    },
    {
        de: 'Heftige Böen, schwere Sturmschäden, schwere Waldschäden, Dächer werden abgedeckt, Autos werden aus der Spur geworfen. Selten im Landesinneren.',
        en: 'Extreme destruction, forests flattened, shingles are blown off of roofs, devastation, cars thrown. Seldom experienced on inland',
    },
    {
        de: 'Schwerste Sturmschäden und Verwüstungen. Selten im Landesinneren.',
        en: 'Heavy storm damages and destructions. Seldom experienced on inland',
    },
];
