import type {InterfaceState} from '@homematic-manager/core';
import {fireEvent, render, screen} from '@testing-library/svelte';
import type {Component} from 'svelte';
import {afterEach, describe, expect, it} from 'vitest';

import appCss from './app.css?raw';
// Applied, not only read: the picture filter below is the one theme decision that has to be
// measured as a computed style, because a token nothing reaches is a token that does nothing.
import './app.css';
import ConnectionIndicator from './lib/components/ConnectionIndicator.svelte';
import DeviceImage from './lib/components/DeviceImage.svelte';
import InterfacePopup from './lib/components/InterfacePopup.svelte';
import DataTableComponent from './lib/components/DataTable.svelte';
import Notices from './lib/components/Notices.svelte';
import ToolbarButton from './lib/components/ToolbarButton.svelte';
import type {Notice} from './lib/stores/NoticesStore.svelte.js';

/**
 * D-22: light and dark are both requirements, not a nicety.
 *
 * jsdom resolves neither `var()` nor a stylesheet's cascade, so asserting a computed colour would
 * only work in browser mode and the suite has to be the same in both (see vitest.browser.config.ts).
 * What is asserted instead is the contract that makes the two themes work at all, and it catches
 * the regressions that actually happen:
 *
 * 1. every colour token is defined three times - `:root`, the `prefers-color-scheme: dark` block
 *    guarded against an explicit light choice, and `[data-theme='dark']` - and the dark value
 *    really differs from the light one;
 * 2. no component hard-codes a colour, so switching a token switches the whole app;
 * 3. the elements whose colour carries meaning keep their semantic class in both themes, i.e. the
 *    theme changes tokens and never structure.
 */

/** A generic component resolves its type parameter to `unknown` when `render()` gets it. */
const DataTable = DataTableComponent as unknown as Component<Record<string, unknown>>;

/**
 * jsdom resolves neither `var()` nor a cascade, so a computed style is only meaningful in browser
 * mode; the assertions that need one skip themselves there, as everywhere else in this suite.
 */
const hasLayout = document.body.getBoundingClientRect().width > 0;

/** One transparent pixel - enough for an `<img>` that loads and can be measured. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The tokens where the colour means something rather than just decorating. */
const MEANINGFUL_TOKENS = [
    '--hmm-ok',
    '--hmm-error',
    '--hmm-warn',
    '--hmm-accent',
    '--hmm-row-selected',
    '--hmm-row-selected-text',
    '--hmm-fg',
    '--hmm-bg',
    '--hmm-border',
    // D-34: the flat surfaces that replaced the 2.x gradients. A bar, a button face and an input
    // field have to be legible in both themes exactly like the text on them.
    '--hmm-header-bg',
    '--hmm-control-bg',
    '--hmm-input-bg',
    '--hmm-overlay',
    '--hmm-backdrop',
    '--hmm-shadow-menu',
    '--hmm-shadow-toast',
    '--hmm-rssi-good',
    '--hmm-rssi-medium',
    '--hmm-rssi-bad',
    '--hmm-rssi-text',
];

function block(css: string, selector: string): string {
    const start = css.indexOf(selector);
    expect(start, `${selector} is missing from app.css`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const end = css.indexOf('\n}', open);
    return css.slice(open, end);
}

function tokenValue(source: string, token: string): string | undefined {
    const match = new RegExp(`${token}:\\s*([^;]+);`).exec(source);
    return match?.[1]?.trim();
}

const lightBlock = block(appCss, ':root {');
const mediaBlock = block(appCss, "@media (prefers-color-scheme: dark) {\n    :root:not([data-theme='light'])");
const darkBlock = block(appCss, ":root[data-theme='dark'] {");

describe('the theme tokens', () => {
    it('defines every meaningful colour in light, in the media query and under [data-theme=dark]', () => {
        for (const token of MEANINGFUL_TOKENS) {
            const light = tokenValue(lightBlock, token);
            const media = tokenValue(mediaBlock, token);
            const dark = tokenValue(darkBlock, token);

            expect(light, `${token} has no light value`).toBeDefined();
            expect(media, `${token} is not redefined for prefers-color-scheme: dark`).toBeDefined();
            expect(dark, `${token} is not redefined for the manual dark theme`).toBeDefined();
            expect(dark, `${token} is the same in both themes`).not.toBe(light);
            expect(media, `${token} differs between the media query and the manual dark theme`).toBe(dark);
        }
    });

    it('guards the media query so an explicit light choice still wins', () => {
        expect(appCss).toContain('@media (prefers-color-scheme: dark)');
        expect(appCss).toContain(":root:not([data-theme='light'])");
    });

    it('sets color-scheme in both themes, so form controls follow', () => {
        expect(lightBlock).toContain('color-scheme: light');
        expect(mediaBlock).toContain('color-scheme: dark');
        expect(darkBlock).toContain('color-scheme: dark');
    });

    /**
     * D-34: the look no longer imitates 2.x. The jQuery UI "smoothness" idiom was one vertical
     * gradient per bar and per button; `she` and Svelte's own defaults are flat surfaces, so a
     * gradient coming back anywhere in the theme is a regression, not a decision.
     */
    it('has no gradient left anywhere', () => {
        expect(appCss).not.toContain('gradient(');
    });

    it('paints the body explicitly rather than inheriting the host background', () => {
        expect(appCss).toMatch(/\nbody \{[^}]*background: var\(--hmm-bg\)/);
        expect(appCss).toMatch(/\nbody \{[^}]*color: var\(--hmm-fg\)/);
    });

    /**
     * Task 22, the maintainer's third look: the CCU's device pictures are black line art on white
     * paper and stood in the dark window as white stamps. The inversion is a token like every
     * other theme decision - `none` in light, the filter in both dark blocks - so the component
     * only applies it and nothing has to know which theme is on.
     *
     * The hue rotation is the half that keeps a coloured picture recognisable, and the contrast
     * and brightness are the half that stops white paper from turning into a black rectangle that
     * is darker than the surface it sits on: measured, white lands on #1d1d1d against a #1e1e1e
     * surface and black on #c9c9c9 against a #cccccc text colour.
     */
    it('inverts the device pictures in dark and leaves them alone in light', () => {
        expect(tokenValue(lightBlock, '--hmm-device-image-filter')).toBe('none');
        for (const [name, source] of [
            ['prefers-color-scheme: dark', mediaBlock],
            ["[data-theme='dark']", darkBlock],
        ] as const) {
            const filter = tokenValue(source, '--hmm-device-image-filter');
            expect(filter, `${name} does not invert the device pictures`).toBeDefined();
            expect(filter).toContain('invert(1)');
            expect(filter).toContain('hue-rotate(180deg)');
            expect(filter).toContain('contrast(');
            expect(filter).toContain('brightness(');
        }
        expect(tokenValue(mediaBlock, '--hmm-device-image-filter')).toBe(
            tokenValue(darkBlock, '--hmm-device-image-filter'),
        );
    });
});

describe('the components', () => {
    /** Every `.svelte` file of this package, as source, so the styles can be inspected. */
    const sources = import.meta.glob('./**/*.svelte', {query: '?raw', import: 'default', eager: true}) as Record<
        string,
        string
    >;

    it('has more than a handful of components to check', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(15);
    });

    it('hard-codes no colour anywhere - every colour comes from a token', () => {
        const offenders: string[] = [];
        for (const [path, source] of Object.entries(sources)) {
            const styles = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';
            for (const line of styles.split('\n')) {
                if (/^\s*\/\*/.test(line)) {
                    continue;
                }
                if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(white|black|red|green|blue|gray|grey)\b/.test(line)) {
                    offenders.push(`${path}: ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('colours that carry meaning', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('data-theme');
    });

    const interfaces: InterfaceState[] = [
        {name: 'BidCos-RF', type: 'BidCos-RF', protocol: 'xmlrpc', host: 'ccu', port: 2001, connected: true},
        {name: 'HmIP-RF', type: 'HmIP-RF', protocol: 'xmlrpc', host: 'ccu', port: 2010, connected: false},
    ];

    /** Task 21: one interface per mark, which is what the popup has to keep apart in both themes. */
    const allStates: InterfaceState[] = [
        ...interfaces,
        {
            name: 'BidCos-Wired',
            type: 'BidCos-Wired',
            protocol: 'xmlrpc',
            host: 'ccu',
            port: 2000,
            connected: false,
            absent: true,
        },
        {name: 'CUxD', type: 'CUxD', protocol: 'binrpc', host: 'ccu', port: 8701, connected: true, subscribing: true},
    ];

    const notices: Notice[] = [
        {id: 1, level: 'info', message: 'info', timestamp: 0},
        {id: 2, level: 'warn', message: 'warn', timestamp: 0},
        {id: 3, level: 'error', message: 'error', timestamp: 0},
    ];

    for (const theme of ['light', 'dark'] as const) {
        it(`keeps the header's summary mark distinguishable in the ${theme} theme`, () => {
            document.documentElement.setAttribute('data-theme', theme);
            // ✕ uses --hmm-error, ✔ uses --hmm-ok; both are redefined for dark above.
            const bad = render(ConnectionIndicator, {props: {interfaces}});
            expect(bad.container.querySelectorAll('.hmm-connection-bad')).toHaveLength(1);
            expect(screen.getByText('✕')).toBeTruthy();

            const ok = render(ConnectionIndicator, {props: {interfaces: [interfaces[0]!]}});
            expect(ok.container.querySelectorAll('.hmm-connection-ok')).toHaveLength(1);
            expect(screen.getByText('✔')).toBeTruthy();
        });

        /**
         * Task 21: the popup carries four marks at once, and "not there" (muted) has to stay
         * apart from "broken" (red) and from "subscribing" (warn) in a dark window too. The
         * colours are tokens - what is asserted is that each state keeps its own class, which is
         * what makes the token switch reach it.
         */
        it(`gives every interface of the popup its own mark in the ${theme} theme`, async () => {
            document.documentElement.setAttribute('data-theme', theme);
            const {container} = render(InterfacePopup, {props: {interfaces: allStates, selected: 'BidCos-RF'}});
            await fireEvent.click(container.querySelector('.hmm-interface-trigger')!);

            const marks = [...container.querySelectorAll('.hmm-interface-mark')].map((mark) =>
                mark.getAttribute('data-mark'),
            );
            expect(marks).toEqual(['ok', 'bad', 'absent', 'busy']);
            for (const mark of marks) {
                expect(container.querySelectorAll(`.hmm-interface-mark-${String(mark)}`)).toHaveLength(1);
            }
            // and the selection is marked by a class, in both themes, not by a colour in the markup
            expect(container.querySelectorAll('.hmm-interface-item-current')).toHaveLength(1);
        });

        it(`marks the service-message severities in the ${theme} theme`, () => {
            document.documentElement.setAttribute('data-theme', theme);
            const {container} = render(Notices, {props: {notices}});

            expect(container.querySelectorAll('.hmm-notice')).toHaveLength(3);
            expect(container.querySelectorAll('.hmm-notice-warn')).toHaveLength(1);
            expect(container.querySelectorAll('.hmm-notice-error')).toHaveLength(1);
        });

        it(`marks the selected row in the ${theme} theme`, async () => {
            document.documentElement.setAttribute('data-theme', theme);
            const {container} = render(DataTable, {
                props: {
                    rows: [
                        {address: 'A', name: 'A'},
                        {address: 'B', name: 'B'},
                    ],
                    columns: [{key: 'name', label: 'Name'}],
                    getId: (row: {address: string}) => row.address,
                    height: 100,
                },
            });

            const row = container.querySelectorAll('.hmm-tr')[1];
            await fireEvent.click(row!);
            expect(row?.classList.contains('hmm-tr-selected')).toBe(true);
        });

        it(`marks a disabled toolbar button in the ${theme} theme`, () => {
            document.documentElement.setAttribute('data-theme', theme);
            render(ToolbarButton, {props: {title: 'Delete device', disabled: true}});
            expect(screen.getByRole<HTMLButtonElement>('button', {name: 'Delete device'}).disabled).toBe(true);
        });
    }

    /**
     * Task 22: the picture really carries the filter, and only in dark. The token test above says
     * the theme declares it; this says it arrives at the element - a rule that stopped matching
     * (a renamed class, a `<style>` block Svelte scoped away) would pass the first and fail here.
     */
    it.skipIf(!hasLayout)('filters the device picture in dark and leaves it alone in light', () => {
        const {container} = render(DeviceImage, {props: {deviceType: 'HmIP-PDT', src: PIXEL}});
        const image = container.querySelector('img')!;

        document.documentElement.setAttribute('data-theme', 'light');
        expect(getComputedStyle(image).filter).toBe('none');

        document.documentElement.setAttribute('data-theme', 'dark');
        const filter = getComputedStyle(image).filter;
        expect(filter).toContain('invert(1)');
        expect(filter).toContain('hue-rotate(180deg)');
    });

    /** The placeholder is drawn from tokens that already follow the theme; inverting it twice. */
    it.skipIf(!hasLayout)('never filters the placeholder that stands in for a missing picture', () => {
        const {container} = render(DeviceImage, {props: {deviceType: 'HmIP-PDT'}});
        const placeholder = container.querySelector('span.hmm-device-image')!;

        document.documentElement.setAttribute('data-theme', 'dark');
        expect(getComputedStyle(placeholder).filter).toBe('none');
    });
});
