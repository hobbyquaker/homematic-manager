import type {InterfaceState} from '@homematic-manager/core';
import {fireEvent, render, screen} from '@testing-library/svelte';
import type {Component} from 'svelte';
import {afterEach, describe, expect, it} from 'vitest';

import appCss from './app.css?raw';
import ConnectionIndicator from './lib/components/ConnectionIndicator.svelte';
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
    '--hmm-overlay',
    '--hmm-backdrop',
    '--hmm-shadow-menu',
    '--hmm-shadow-toast',
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

    it('paints the body explicitly rather than inheriting the host background', () => {
        expect(appCss).toMatch(/\nbody \{[^}]*background: var\(--hmm-bg\)/);
        expect(appCss).toMatch(/\nbody \{[^}]*color: var\(--hmm-fg\)/);
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

    const notices: Notice[] = [
        {id: 1, level: 'info', message: 'info', timestamp: 0},
        {id: 2, level: 'warn', message: 'warn', timestamp: 0},
        {id: 3, level: 'error', message: 'error', timestamp: 0},
    ];

    for (const theme of ['light', 'dark'] as const) {
        it(`keeps the connection marks distinguishable in the ${theme} theme`, () => {
            document.documentElement.setAttribute('data-theme', theme);
            const {container} = render(ConnectionIndicator, {props: {host: 'ccu', interfaces}});

            // ✔ uses --hmm-ok, ✕ uses --hmm-error; both are redefined for dark above.
            expect(container.querySelectorAll('.hmm-connection-ok')).toHaveLength(1);
            expect(container.querySelectorAll('.hmm-connection-bad')).toHaveLength(1);
            expect(screen.getByText('✔')).toBeTruthy();
            expect(screen.getByText('✕')).toBeTruthy();
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
            expect((screen.getByRole('button', {name: 'Delete device'}) as HTMLButtonElement).disabled).toBe(true);
        });
    }
});
