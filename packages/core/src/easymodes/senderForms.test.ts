import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
    SENDER_FORMS,
    STORM_EXPERT,
    STORM_HIDDEN_FOR_RECEIVER,
    STORM_TEXTS,
    STORM_THRESHOLD,
    WIND_DESCRIPTION,
    WIND_FORCE,
    adjustFillLevels,
    applyStormProfile,
    fillLevelPercent,
    fillLevelRaw,
    senderFormFor,
    stormProfile,
    type FillLevelForm,
    type StormForm,
} from './senderForms.js';

interface ExtractedSender {
    profiles: Record<string, string>;
    presets: Record<string, Record<string, number[] | string>>;
    options?: Record<string, string>;
    variantOptions?: Record<string, {add: number; remove: number}>;
    hiddenForReceiver?: string;
    hidesProfileSelect?: boolean;
    mirrors?: {deviceType: string} & Record<string, string>;
    percentOf?: {divisor: number; inactive: number};
}

/** Task 109: the WebUI's sender forms, extracted by `data/scripts/easymode-links.mjs`. */
const extract = JSON.parse(
    readFileSync(new URL('../../../../data/extracted/easymode_links.json', import.meta.url), 'utf8'),
) as {senders: Record<string, ExtractedSender>; weatherTexts: Record<string, {de: string; en: string}>};

const storm = (id: string): StormForm => SENDER_FORMS[id] as StormForm;
const fill = SENDER_FORMS['wa_od_ch_link'] as FillLevelForm;

describe('the sender forms against the WebUI (task 109)', () => {
    it('has exactly the WebUI sender forms', () => {
        expect(Object.keys(SENDER_FORMS).sort()).toEqual(Object.keys(extract.senders).sort());
    });

    it.each(Object.entries(extract.senders))('%s follows the WebUI file', (id, webui) => {
        const form = SENDER_FORMS[id];
        if (webui.percentOf) {
            expect(form).toMatchObject({
                kind: 'fillLevel',
                inactive: webui.percentOf.inactive,
                perPercent: webui.percentOf.divisor,
            });
            expect(webui.hidesProfileSelect).toBe(true);
            return;
        }
        expect(form?.kind).toBe('storm');
        const stormForm = form as StormForm;
        expect(Object.keys(webui.profiles).map(Number)).toEqual([STORM_EXPERT, STORM_THRESHOLD]);
        expect(webui.presets[String(STORM_THRESHOLD)]?.['STORM_UPPER_THRESHOLD']).toEqual(stormForm.range);
        expect(webui.presets[String(STORM_THRESHOLD)]?.['STORM_LOWER_THRESHOLD']).toEqual(stormForm.range);
        expect(webui.hiddenForReceiver).toBe(STORM_HIDDEN_FOR_RECEIVER);
        const expected = (deviceType: string): Array<{value: number; force: number}> => {
            const variant = webui.variantOptions?.[deviceType];
            return Object.entries(webui.options ?? {})
                .map(([value, label]) => ({value: Number(value), force: Number(label.replace('windForce', ''))}))
                .map((option) =>
                    variant && option.value === variant.remove ? {...option, value: variant.add} : option,
                )
                .sort((a, b) => a.force - b.force);
        };
        for (const deviceType of ['KS550', 'HM-WDS100-C6-O', 'HM-WDS100-C6-O-2']) {
            expect(stormForm.options(deviceType), `${id} ${deviceType}`).toEqual(expected(deviceType));
            const mirrors = webui.mirrors?.deviceType === deviceType ? webui.mirrors : undefined;
            const wanted = mirrors
                ? Object.fromEntries(
                      Object.entries(mirrors).filter(([key, value]) => key !== 'deviceType' && value !== ''),
                  )
                : {};
            expect(stormForm.mirrors(deviceType), `${id} ${deviceType}`).toEqual(wanted);
        }
    });

    it('has the texts of the weather forms', () => {
        for (const [key, text] of Object.entries(STORM_TEXTS)) {
            expect(text, key).toEqual(extract.weatherTexts[key]);
        }
        for (const [force, text] of WIND_FORCE.entries()) {
            expect(text).toEqual(extract.weatherTexts[`windForce${String(force)}`]);
        }
        for (const [force, text] of WIND_DESCRIPTION.entries()) {
            expect(text).toEqual(extract.weatherTexts[`windDesc${String(force)}`]);
        }
        expect(WIND_FORCE).toHaveLength(13);
    });
});

describe('the storm form', () => {
    it('is the sender form of its paramset id unless the receiver is a combination sensor', () => {
        expect(senderFormFor('ks550_ch_link', 'SWITCH')?.kind).toBe('storm');
        expect(senderFormFor('ks550_ch_link', 'WS_CS')).toBeUndefined();
        expect(senderFormFor('wa_od_ch_link', 'WS_CS')?.kind).toBe('fillLevel');
        expect(senderFormFor('switch_ch_link', 'SWITCH')).toBeUndefined();
        expect(senderFormFor('', 'SWITCH')).toBeUndefined();
    });

    it('follows "Sturmschwelle" when both thresholds hold one of its values', () => {
        const form = storm('ks550_ch_link');
        expect(stormProfile(form, {STORM_UPPER_THRESHOLD: 0, STORM_LOWER_THRESHOLD: 0})).toBe(STORM_EXPERT);
        expect(stormProfile(form, {STORM_UPPER_THRESHOLD: 50, STORM_LOWER_THRESHOLD: 39})).toBe(STORM_THRESHOLD);
        expect(stormProfile(form, {STORM_UPPER_THRESHOLD: 50, STORM_LOWER_THRESHOLD: 40})).toBe(STORM_EXPERT);
        expect(stormProfile(form, {STORM_UPPER_THRESHOLD: '15', STORM_LOWER_THRESHOLD: 15})).toBe(STORM_THRESHOLD);
        // 20 is the HM-WDS100-C6-O-2's grade 4, not the KS550's
        expect(stormProfile(form, {STORM_UPPER_THRESHOLD: 20, STORM_LOWER_THRESHOLD: 20})).toBe(STORM_EXPERT);
        expect(stormProfile(storm('wds100_ch_link'), {STORM_UPPER_THRESHOLD: 20, STORM_LOWER_THRESHOLD: 20})).toBe(
            STORM_THRESHOLD,
        );
    });

    it('keeps the thresholds that hold a value of the profile and starts the others on the first', () => {
        const form = storm('wds100_ch_link');
        expect(
            applyStormProfile(form, {STORM_UPPER_THRESHOLD: 62, STORM_LOWER_THRESHOLD: 0, PEER_NEEDS_BURST: true}),
        ).toEqual({
            STORM_UPPER_THRESHOLD: 62,
            STORM_LOWER_THRESHOLD: 1,
        });
        expect(applyStormProfile(form, {})).toEqual({});
    });
});

describe('the fill level form', () => {
    it('shows the raw value as a percentage, 255 as off', () => {
        expect(fillLevelPercent(fill, 255)).toEqual({percent: 0, active: false});
        expect(fillLevelPercent(fill, 0)).toEqual({percent: 0, active: true});
        expect(fillLevelPercent(fill, 100)).toEqual({percent: 50, active: true});
        expect(fillLevelPercent(fill, 101)).toEqual({percent: 50.5, active: true});
        expect(fillLevelPercent(fill, 103)).toEqual({percent: 51.5, active: true});
        // 51.0 + the WebUI's rounding of .1/.2 down, .8/.9 up
        expect(fillLevelPercent(fill, 102)).toEqual({percent: 51, active: true});
        expect(fillLevelPercent(fill, 200)).toEqual({percent: 100, active: true});
    });

    it('writes twice the percentage, or 255 for off', () => {
        expect(fillLevelRaw(fill, 50, true)).toBe(100);
        expect(fillLevelRaw(fill, 50.5, true)).toBe(101);
        expect(fillLevelRaw(fill, 50.2, true)).toBe(100);
        expect(fillLevelRaw(fill, 50.8, true)).toBe(102);
        expect(fillLevelRaw(fill, 140, true)).toBe(200);
        expect(fillLevelRaw(fill, -3, true)).toBe(0);
        expect(fillLevelRaw(fill, Number.NaN, true)).toBe(0);
        expect(fillLevelRaw(fill, 50, false)).toBe(255);
    });

    it('keeps the lower threshold 5 % below the upper one, as isLowerGTUpper does', () => {
        expect(adjustFillLevels('lower', 50, 60)).toEqual({upper: 65, lower: 60});
        expect(adjustFillLevels('lower', undefined, 60)).toEqual({upper: undefined, lower: 60});
        expect(adjustFillLevels('upper', 40, 60)).toEqual({upper: 40, lower: 35});
        expect(adjustFillLevels('upper', 3, 10)).toEqual({upper: 5, lower: 0});
        expect(adjustFillLevels('upper', 120, 50)).toEqual({upper: 100, lower: 95});
        expect(adjustFillLevels('upper', 80, undefined)).toEqual({upper: 80, lower: undefined});
        expect(adjustFillLevels('upper', 80, 20)).toEqual({upper: 80, lower: 20});
    });
});
