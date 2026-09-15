import type {InterfaceState, RpcLogEntry} from '@homematic-manager/core';
import {fireEvent, render, screen, waitFor} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import type {Notice} from '../stores/NoticesStore.svelte.js';

import ConnectionIndicator from './ConnectionIndicator.svelte';
import ContextMenu from './ContextMenu.svelte';
import {clampMenuPosition} from './contextMenu.js';
import Dialog from './Dialog.svelte';
import LanguageSwitch from './LanguageSwitch.svelte';
import Loader from './Loader.svelte';
import MultiSelect from './MultiSelect.svelte';
import {filterOptions, step} from './multiSelect.js';
import Notices from './Notices.svelte';
import PrimaryToolbarButton from './PrimaryToolbarButton.svelte';
import RpcLogPanel from './RpcLogPanel.svelte';
import RpcProgress from './RpcProgress.svelte';
import Tabs from './Tabs.svelte';
import ThemeSwitch from './ThemeSwitch.svelte';
import Toolbar from './Toolbar.svelte';
import ToolbarButton from './ToolbarButton.svelte';

describe('Dialog', () => {
    it('opens as a modal, closes with the button and restores focus', async () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();

        const onclose = vi.fn();
        const {rerender} = render(Dialog, {props: {open: false, title: 'Settings', onclose}});
        const dialog = document.querySelector('dialog');
        expect(dialog?.open).toBe(false);

        await rerender({open: true, title: 'Settings', onclose});
        expect(dialog?.open).toBe(true);
        expect(screen.getByText('Settings')).toBeTruthy();

        await fireEvent.click(screen.getByLabelText('Close'));
        expect(dialog?.open).toBe(false);
        expect(onclose).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(trigger);
        trigger.remove();
    });

    it('closes on ESC only when it may be closed', async () => {
        const {rerender} = render(Dialog, {props: {open: true, title: 'RPC execution', closable: false}});
        const dialog = document.querySelector('dialog');
        await fireEvent(dialog!, new Event('cancel', {cancelable: true}));
        expect(dialog?.open).toBe(true);
        expect(screen.queryByLabelText('Close')).toBeNull();

        await rerender({open: true, title: 'RPC execution', closable: true});
        await fireEvent(dialog!, new Event('cancel', {cancelable: true}));
        expect(dialog?.open).toBe(false);
    });

    it('stacks two dialogs without either of them losing its element', async () => {
        // jQuery UI's `_focusTabbable` walked into a dialog that had already gone away when the
        // paramset dialog was opened out of the link dialog; the native top layer does not.
        render(Dialog, {props: {open: true, title: 'Link'}});
        render(Dialog, {props: {open: true, title: 'Paramset'}});
        const dialogs = document.querySelectorAll('dialog');
        expect(dialogs).toHaveLength(2);
        expect([...dialogs].every((dialog) => dialog.open)).toBe(true);
    });

    it('can be non-modal', () => {
        render(Dialog, {props: {open: true, modal: false, title: 'Log'}});
        expect(document.querySelector('dialog')?.open).toBe(true);
    });
});

describe('MultiSelect', () => {
    const options = [
        {value: 'BidCos-RF', label: 'BidCos-RF'},
        {value: 'HmIP-RF', label: 'HmIP-RF'},
        {value: 'CUxD', label: 'CUxD', disabled: true},
    ];

    it('filters the options', () => {
        expect(filterOptions(options, 'hmip').map((option) => option.value)).toEqual(['HmIP-RF']);
        expect(filterOptions(options, '  ')).toHaveLength(3);
    });

    it('steps the highlight over disabled entries and stops at the ends', () => {
        expect(step(options, 0, 1)).toBe(1);
        expect(step(options, 1, 1)).toBe(1); // CUxD is disabled, and it is the last entry
        expect(step(options, 0, -1)).toBe(0);
    });

    it('walks the list with the arrow keys, chooses with Enter and closes on Escape', async () => {
        const onchange = vi.fn();
        render(MultiSelect, {props: {options, selected: [], multiple: false, placeholder: 'Select', onchange}});
        const trigger = screen.getByRole('button', {name: /Select/});
        await fireEvent.click(trigger);
        const filter = screen.getByLabelText('Filter');
        expect(document.activeElement).toBe(filter);
        await fireEvent.keyDown(filter, {key: 'ArrowDown'});
        expect(filter.getAttribute('aria-activedescendant')).toMatch(/-1$/);
        await fireEvent.keyDown(filter, {key: 'Enter'});
        expect(onchange).toHaveBeenCalledWith(['HmIP-RF']);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(document.activeElement).toBe(trigger);

        await fireEvent.click(trigger);
        await fireEvent.keyDown(screen.getByLabelText('Filter'), {key: 'Escape'});
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onchange).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(trigger);
    });

    it('opens, filters, checks and unchecks all', async () => {
        const onchange = vi.fn();
        render(MultiSelect, {props: {options, selected: [], placeholder: 'Select', onchange}});

        await fireEvent.click(screen.getByRole('button', {name: /Select/}));
        expect(screen.getAllByRole('option')).toHaveLength(3);

        await fireEvent.input(screen.getByLabelText('Filter'), {target: {value: 'Bid'}});
        expect(screen.getAllByRole('option')).toHaveLength(1);

        await fireEvent.click(screen.getByText('Check all'));
        expect(onchange).toHaveBeenCalledWith(['BidCos-RF']);

        await fireEvent.click(screen.getByText('Uncheck all'));
        expect(onchange).toHaveBeenLastCalledWith([]);
    });

    it('toggles an option and refuses a disabled one', async () => {
        const onchange = vi.fn();
        render(MultiSelect, {props: {options, selected: [], onchange}});
        await fireEvent.click(screen.getByRole('button', {name: /^$|▾/}));

        await fireEvent.click(screen.getByRole('option', {name: /BidCos-RF/}));
        expect(onchange).toHaveBeenLastCalledWith(['BidCos-RF']);
        await fireEvent.click(screen.getByRole('option', {name: /CUxD/}));
        expect(onchange).toHaveBeenCalledOnce();
    });

    it('closes after a single-select pick and shows the label', async () => {
        render(MultiSelect, {props: {options, selected: ['HmIP-RF'], multiple: false}});
        const button = screen.getByRole('button', {name: /HmIP-RF/});
        await fireEvent.click(button);
        expect(screen.queryByText('Check all')).toBeNull();

        await fireEvent.click(screen.getByRole('option', {name: 'BidCos-RF'}));
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.getByRole('button', {name: /BidCos-RF/})).toBeTruthy();
    });

    it('summarises a multi selection and reports an empty filter result', async () => {
        render(MultiSelect, {
            props: {
                options,
                selected: ['BidCos-RF', 'HmIP-RF'],
                summary: (selected: string[]) => `${selected.length} selected`,
            },
        });
        await fireEvent.click(screen.getByRole('button', {name: /2 selected/}));
        await fireEvent.input(screen.getByLabelText('Filter'), {target: {value: 'nothing'}});
        expect(screen.queryAllByRole('option')).toHaveLength(0);
        expect(screen.getByText('—')).toBeTruthy();
    });

    it('closes when the pointer goes down outside', async () => {
        render(MultiSelect, {props: {options, selected: [], placeholder: 'Select'}});
        await fireEvent.click(screen.getByRole('button', {name: /Select/}));
        expect(screen.getByRole('listbox')).toBeTruthy();

        await fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('falls back to the raw value when nothing carries that label', () => {
        render(MultiSelect, {props: {options, selected: ['gone'], multiple: false}});
        expect(screen.getByRole('button', {name: /gone/})).toBeTruthy();
    });

    /** Task 31: the link dialog's entries - channel name, device name, `index: TYPE`, no address. */
    const channels = [
        {
            value: '000A1B2C3D4E5F:3',
            label: 'Living room light',
            hint: 'Wall switch',
            description: '3: VIRTUAL_SWITCH_TRANSMITTER',
        },
        {value: 'MEQ0123456:1', label: 'Kitchen', hint: 'Socket', description: '1: SWITCH'},
    ];

    it('filters by label, hint, description and value', () => {
        const found = (filter: string): string[] => filterOptions(channels, filter).map((option) => option.value);
        expect(found('living')).toEqual(['000A1B2C3D4E5F:3']);
        expect(found('SOCKET')).toEqual(['MEQ0123456:1']);
        expect(found('virtual_switch')).toEqual(['000A1B2C3D4E5F:3']);
        // the address is not printed any more, and is still found
        expect(found('meq0123')).toEqual(['MEQ0123456:1']);
        expect(found('5F:3')).toEqual(['000A1B2C3D4E5F:3']);
        expect(found('nothing like it')).toEqual([]);
        // and a plain entry is still found by its label only when that is all it has
        expect(filterOptions(options, 'hmip').map((option) => option.value)).toEqual(['HmIP-RF']);
    });

    it('steps over entries with a hint as over any other', () => {
        expect(step(channels, 0, 1)).toBe(1);
        expect(step(channels, 1, 1)).toBe(1);
    });

    it('draws an entry with a hint or a description on two lines, and a plain one on one', async () => {
        render(MultiSelect, {
            props: {options: [...channels, {value: 'plain', label: 'Plain'}], selected: [], placeholder: 'Select'},
        });
        await fireEvent.click(screen.getByRole('button', {name: /Select/}));
        const [first, , plain] = screen.getAllByRole('option');

        expect(first!.classList.contains('hmm-multiselect-two-lines')).toBe(true);
        expect(first!.querySelector('.hmm-multiselect-label')?.textContent).toBe('Living room light');
        expect(first!.querySelector('.hmm-multiselect-hint')?.textContent).toBe('Wall switch');
        expect(first!.querySelector('.hmm-multiselect-description')?.textContent).toBe('3: VIRTUAL_SWITCH_TRANSMITTER');
        expect(first!.querySelector('.hmm-multiselect-line')?.getAttribute('title')).toBe(
            'Living room light Wall switch',
        );
        expect(first!.querySelector('.hmm-multiselect-description')?.getAttribute('title')).toBe(
            '3: VIRTUAL_SWITCH_TRANSMITTER',
        );
        // label and hint share the first line, the description is the line under it
        const label = first!.querySelector('.hmm-multiselect-label')!.getBoundingClientRect();
        const hint = first!.querySelector('.hmm-multiselect-hint')!.getBoundingClientRect();
        const description = first!.querySelector('.hmm-multiselect-description')!.getBoundingClientRect();
        expect(hint.left).toBeGreaterThanOrEqual(label.right);
        expect(Math.round(hint.bottom)).toBeLessThanOrEqual(Math.round(description.top) + 1);

        expect(plain!.classList.contains('hmm-multiselect-two-lines')).toBe(false);
        expect(plain!.querySelector('.hmm-multiselect-lines')).toBeNull();
        expect(plain!.textContent).toContain('Plain');
        expect(plain!.getBoundingClientRect().height).toBeLessThan(first!.getBoundingClientRect().height);
    });

    it('cuts a long first line with an ellipsis rather than wrapping it', async () => {
        const long = {
            value: 'x:1',
            label: 'A channel name far longer than any list is wide '.repeat(4),
            hint: 'and a device name that is longer still '.repeat(4),
            description: '1: SWITCH',
        };
        render(MultiSelect, {props: {options: [long], selected: [], placeholder: 'Select'}});
        await fireEvent.click(screen.getByRole('button', {name: /Select/}));
        const option = screen.getByRole('option');
        const label = option.querySelector<HTMLElement>('.hmm-multiselect-label')!;

        expect(getComputedStyle(label).textOverflow).toBe('ellipsis');
        expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
        expect(label.clientWidth).toBeGreaterThan(0);
        // still two lines: the first one did not wrap
        const lineHeight = option.querySelector<HTMLElement>('.hmm-multiselect-line')!.getBoundingClientRect().height;
        expect(lineHeight).toBeLessThan(24);
    });

    it('cuts the device name before the channel name', async () => {
        render(MultiSelect, {
            props: {
                options: [
                    {
                        value: 'x:1',
                        label: 'Living room light',
                        hint: 'and a device name that is far longer than the list is wide '.repeat(3),
                        description: '1: SWITCH',
                    },
                ],
                selected: [],
                placeholder: 'Select',
            },
        });
        await fireEvent.click(screen.getByRole('button', {name: /Select/}));
        const option = screen.getByRole('option');
        const label = option.querySelector<HTMLElement>('.hmm-multiselect-label')!;
        const hint = option.querySelector<HTMLElement>('.hmm-multiselect-hint')!;

        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
        expect(hint.scrollWidth).toBeGreaterThan(hint.clientWidth);
        expect(getComputedStyle(hint).textOverflow).toBe('ellipsis');
    });
});

describe('ContextMenu', () => {
    const items = [
        {id: 'rename', label: 'Rename'},
        {id: 'sep', separator: true},
        {id: 'delete', label: 'Delete', danger: true},
        {id: 'replace', label: 'Replace', disabled: true},
    ];

    it('clamps itself into the viewport', () => {
        expect(clampMenuPosition(10, 10, {width: 100, height: 80}, {width: 800, height: 600})).toEqual({x: 10, y: 10});
        expect(clampMenuPosition(790, 590, {width: 100, height: 80}, {width: 800, height: 600})).toEqual({
            x: 696,
            y: 516,
        });
        expect(clampMenuPosition(-50, -50, {width: 100, height: 80}, {width: 60, height: 40})).toEqual({x: 4, y: 4});
    });

    it('selects an entry, ignores a disabled one and closes on ESC', async () => {
        const onselect = vi.fn();
        const onclose = vi.fn();
        render(ContextMenu, {props: {items, open: true, x: 20, y: 20, onselect, onclose}});

        expect(screen.getByRole('separator')).toBeTruthy();
        await fireEvent.click(screen.getByRole('menuitem', {name: 'Replace'}));
        expect(onselect).not.toHaveBeenCalled();

        await fireEvent.click(screen.getByRole('menuitem', {name: 'Rename'}));
        expect(onselect).toHaveBeenCalledExactlyOnceWith('rename');
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes on ESC and on a click outside', async () => {
        const onclose = vi.fn();
        const {rerender} = render(ContextMenu, {props: {items, open: true, onclose}});
        await fireEvent.keyDown(window, {key: 'Escape'});
        expect(onclose).toHaveBeenCalledOnce();

        await rerender({items, open: true, onclose});
        await fireEvent.mouseDown(document.body);
        expect(onclose).toHaveBeenCalledTimes(2);
    });

    it('draws nothing while closed', () => {
        render(ContextMenu, {props: {items, open: false}});
        expect(screen.queryByRole('menu')).toBeNull();
    });
});

describe('Tabs', () => {
    const tabs = [
        {id: 'devices', label: 'Geräte'},
        {id: 'links', label: 'Verknüpfungen'},
        {id: 'messages', label: 'Servicemeldungen', badge: 9},
    ];

    it('marks the active tab and shows the 2.x count in brackets', () => {
        render(Tabs, {props: {tabs, active: 'links'}});
        expect(screen.getByRole('tab', {name: /Verknüpfungen/}).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByText('(9)')).toBeTruthy();
    });

    it('selects by click and by arrow key, wrapping around', async () => {
        const onselect = vi.fn();
        render(Tabs, {props: {tabs, active: 'devices', onselect}});

        await fireEvent.click(screen.getByRole('tab', {name: 'Verknüpfungen'}));
        expect(onselect).toHaveBeenLastCalledWith('links');

        await fireEvent.keyDown(screen.getByRole('tab', {name: 'Verknüpfungen'}), {key: 'ArrowRight'});
        expect(onselect).toHaveBeenLastCalledWith('messages');

        await fireEvent.keyDown(screen.getByRole('tab', {name: 'Geräte'}), {key: 'ArrowLeft'});
        expect(onselect).toHaveBeenLastCalledWith('messages');

        await fireEvent.keyDown(screen.getByRole('tab', {name: 'Geräte'}), {key: 'Enter'});
        expect(onselect).toHaveBeenCalledTimes(3);
    });

    /**
     * D-34, the maintainer's addition: nothing may change size when its state changes. A tab that
     * turns bold when it is selected is a tab bar that jumps every time the user switches, so the
     * active tab is marked by colour and an inset underline and by nothing that has a width.
     */
    it.skipIf(document.body.getBoundingClientRect().width === 0)(
        'gives a tab the same width whether it is active or not',
        async () => {
            const six = [
                {id: 'devices', label: 'Geräte'},
                {id: 'links', label: 'Verknüpfungen'},
                {id: 'rssi', label: 'Funk'},
                {id: 'console', label: 'RPC Konsole'},
                {id: 'messages', label: 'Servicemeldungen', badge: 2},
                {id: 'events', label: 'Ereignisse'},
            ];
            const {rerender} = render(Tabs, {props: {tabs: six, active: 'devices'}});

            const widthsOf = (): number[] =>
                screen.getAllByRole('tab').map((tab) => Math.round(tab.getBoundingClientRect().width));
            const lefts = (): number[] =>
                screen.getAllByRole('tab').map((tab) => Math.round(tab.getBoundingClientRect().left));

            const widths = widthsOf();
            const positions = lefts();
            expect(widths).toHaveLength(6);

            for (const tab of six) {
                await rerender({tabs: six, active: tab.id});
                expect(widthsOf(), `activating ${tab.id} changed a tab's width`).toEqual(widths);
                expect(lefts(), `activating ${tab.id} moved the tab bar`).toEqual(positions);
            }
        },
    );
});

describe('Toolbar and ToolbarButton', () => {
    it('renders its buttons and a trailing area', () => {
        const onclick = vi.fn();
        render(ToolbarButton, {props: {title: 'Refresh', icon: '⟳', onclick, testId: 'refresh'}});
        expect(screen.getByRole('button', {name: 'Refresh'})).toBeTruthy();
        expect(screen.getByTestId('refresh-tooltip').getAttribute('data-tooltip')).toBe('Refresh');
        // #145: the browser's own tooltip is gone, or the two would fight over the same pointer.
        expect(screen.getByRole('button', {name: 'Refresh'}).getAttribute('title')).toBeNull();
    });

    it('explains in the tooltip why a button is disabled', async () => {
        const onclick = vi.fn();
        render(ToolbarButton, {
            props: {
                title: 'Delete device',
                disabled: true,
                reason: 'This function arrives with task 8.',
                onclick,
                testId: 'delete',
            },
        });
        const button = screen.getByRole<HTMLButtonElement>('button', {name: 'Delete device'});
        expect(screen.getByTestId('delete-tooltip').getAttribute('data-tooltip')).toBe(
            'Delete device — This function arrives with task 8.',
        );
        // `disabled` is what stops the click; `fireEvent.click` dispatches the event regardless of
        // it, so the attribute is what this asserts on.
        expect(button.disabled).toBe(true);
        expect(onclick).not.toHaveBeenCalled();
    });

    /**
     * Issue #145: 4 to 5 seconds for a `title` tooltip on macOS, and none at all on a disabled
     * button - a disabled control dispatches no pointer events, so the very text that says why it
     * is disabled was the one that never showed. The tooltip is the app's own now: the anchor
     * around the button takes the pointer, and the wait is a fixed short one.
     */
    it('shows its own tooltip after a short delay, on a disabled button as well', async () => {
        render(ToolbarButton, {
            props: {
                title: 'Delete device',
                disabled: true,
                reason: 'Select a device',
                testId: 'delete',
            },
        });
        expect(screen.queryByRole('tooltip')).toBeNull();

        await fireEvent.pointerEnter(screen.getByTestId('delete-tooltip'));
        const tip = await screen.findByRole('tooltip');
        expect(tip.textContent).toBe('Delete device — Select a device');

        await fireEvent.pointerLeave(screen.getByTestId('delete-tooltip'));
        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).toBeNull();
        });
    });

    it('shows the tooltip at once when the button is reached with the keyboard', async () => {
        render(ToolbarButton, {props: {title: 'RPC log', testId: 'rpclog'}});

        screen.getByRole('button', {name: 'RPC log'}).focus();
        await fireEvent.focusIn(screen.getByTestId('rpclog-tooltip'));
        expect((await screen.findByRole('tooltip')).textContent).toBe('RPC log');

        await fireEvent.focusOut(screen.getByTestId('rpclog-tooltip'));
        await waitFor(() => {
            expect(screen.queryByRole('tooltip')).toBeNull();
        });
    });

    it('can be a toggle', () => {
        render(ToolbarButton, {props: {title: 'RPC log', pressed: true}});
        expect(screen.getByRole('button', {name: 'RPC log'}).getAttribute('aria-pressed')).toBe('true');
    });

    it('renders a toolbar with a label', () => {
        render(Toolbar, {props: {label: 'Devices toolbar'}});
        expect(screen.getByRole('toolbar', {name: 'Devices toolbar'})).toBeTruthy();
    });
});

/**
 * Tasks 28 and 33: "Pair device" and "Add link" were a bare `+` among the toolbar icons. The main
 * action of a tab has an icon and a caption now, and only a band without room for the caption
 * takes it away again.
 */
describe('PrimaryToolbarButton', () => {
    const hasLayout = document.body.getBoundingClientRect().width > 0;

    it('shows its icon and its caption, and is named by the caption', async () => {
        const onclick = vi.fn();
        render(PrimaryToolbarButton, {
            props: {caption: 'Pair device', icon: '+', compact: false, onclick, testId: 'pair'},
        });
        const button = screen.getByRole('button', {name: 'Pair device'});
        expect(button.querySelector('.hmm-primary-icon')?.textContent).toBe('+');
        expect(screen.getByTestId('pair-caption').textContent).toBe('Pair device');
        expect(button.getAttribute('data-compact')).toBe('false');
        // the caption is on the button already; a tooltip saying it again would only be in the way
        expect(screen.getByTestId('pair-tooltip').getAttribute('data-tooltip')).toBeNull();

        await fireEvent.click(button);
        expect(onclick).toHaveBeenCalledOnce();
    });

    it('is the icon alone in its compact form, and keeps the caption as name and tooltip', () => {
        render(PrimaryToolbarButton, {props: {caption: 'Add link', icon: '+', compact: true, testId: 'add'}});
        const button = screen.getByRole('button', {name: 'Add link'});
        expect(button.textContent.trim()).toBe('+');
        expect(button.getAttribute('data-compact')).toBe('true');
        expect(screen.queryByTestId('add-caption')).toBeNull();
        expect(screen.getByTestId('add-tooltip').getAttribute('data-tooltip')).toBe('Add link');
    });

    it('explains in the tooltip why it is disabled', () => {
        const onclick = vi.fn();
        render(PrimaryToolbarButton, {
            props: {
                caption: 'Pair device',
                disabled: true,
                reason: 'This interface cannot pair devices',
                compact: false,
                onclick,
                testId: 'pair',
            },
        });
        expect(screen.getByRole<HTMLButtonElement>('button', {name: 'Pair device'}).disabled).toBe(true);
        expect(screen.getByTestId('pair-tooltip').getAttribute('data-tooltip')).toBe(
            'Pair device — This interface cannot pair devices',
        );
    });

    it.skipIf(!hasLayout)('gives up the caption when the row has no room for it, and takes it back', async () => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.width = '400px';
        document.body.append(row);
        render(PrimaryToolbarButton, {target: row, props: {caption: 'Pair device', testId: 'auto'}});

        const button = screen.getByTestId('auto');
        await waitFor(() => {
            expect(button.getAttribute('data-compact')).toBe('false');
        });
        expect(screen.getByTestId('auto-caption')).toBeTruthy();

        row.style.width = '40px';
        await waitFor(() => {
            expect(button.getAttribute('data-compact')).toBe('true');
        });
        // never gone: the icon keeps its size
        expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(28);

        row.style.width = '400px';
        await waitFor(() => {
            expect(button.getAttribute('data-compact')).toBe('false');
        });
        row.remove();
    });
});

describe('Loader', () => {
    it('shows and hides the 2.x loading overlay', () => {
        const {rerender} = render(Loader, {props: {visible: true, text: 'Loading Homematic Manager...'}});
        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('Loading Homematic Manager...')).toBeTruthy();

        void rerender({visible: false});
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('Notices', () => {
    const notices: Notice[] = [
        {id: 1, level: 'info', message: 'Connected', timestamp: 0},
        {id: 2, level: 'warn', message: 'ReGa is not answering', interfaceName: 'ReGa', timestamp: 0},
        {id: 3, level: 'error', message: 'putParamset failed', timestamp: 0},
    ];

    /** Seven toasts, oldest first - two more than the stack draws. */
    const many: Notice[] = Array.from({length: 7}, (_, index) => ({
        id: index + 1,
        level: 'error' as const,
        message: `failure ${index + 1}`,
        timestamp: 0,
    }));

    it('lists the notices and dismisses one', async () => {
        const ondismiss = vi.fn();
        render(Notices, {props: {notices, ondismiss}});

        expect(screen.getByText('Connected')).toBeTruthy();
        expect(screen.getByText('ReGa')).toBeTruthy();
        await fireEvent.click(screen.getAllByLabelText('Dismiss')[2]!);
        expect(ondismiss).toHaveBeenCalledExactlyOnceWith(3);
    });

    it('draws no counter while the stack fits', () => {
        render(Notices, {props: {notices, testId: 'notices'}});
        expect(screen.queryByTestId('notices-more')).toBeNull();
        expect(screen.getAllByLabelText('Dismiss')).toHaveLength(3);
    });

    // D-34: at most five on screen, the oldest fall behind a counter rather than off a cliff.
    it('shows the newest five and counts the older ones', () => {
        render(Notices, {props: {notices: many, testId: 'notices'}});

        expect(screen.getAllByLabelText('Dismiss')).toHaveLength(5);
        expect(screen.queryByText('failure 1')).toBeNull();
        expect(screen.queryByText('failure 2')).toBeNull();
        expect(screen.getByText('failure 3')).toBeTruthy();
        expect(screen.getByText('failure 7')).toBeTruthy();
        expect(screen.getByTestId('notices-more').textContent.trim()).toBe('2 more');
    });

    it('opens the whole stack and folds it again', async () => {
        render(Notices, {props: {notices: many, testId: 'notices'}});

        const toggle = screen.getByTestId('notices-more');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await fireEvent.click(toggle);

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getAllByLabelText('Dismiss')).toHaveLength(7);
        expect(screen.getByText('failure 1')).toBeTruthy();
        expect(toggle.textContent.trim()).toBe('Show fewer');

        await fireEvent.click(toggle);
        expect(screen.getAllByLabelText('Dismiss')).toHaveLength(5);
    });

    it('takes the labels from the caller, so the plural stays with the translator', () => {
        render(Notices, {
            props: {notices: many, testId: 'notices', moreLabel: (count: number) => `${count} weitere`},
        });
        expect(screen.getByTestId('notices-more').textContent.trim()).toBe('2 weitere');
    });
});

describe('RpcLogPanel', () => {
    const entries: RpcLogEntry[] = [
        {
            id: 1,
            timestamp: Date.parse('2026-09-05T09:57:02Z'),
            interfaceName: 'BidCos-RF',
            method: 'putParamset',
            params: ['MEQ0123456:1', 'MASTER', {LOGGING: 1}],
            ok: true,
            result: '',
            durationMs: 184,
            origin: 'ui',
        },
        {
            id: 2,
            timestamp: Date.parse('2026-09-05T09:57:44Z'),
            interfaceName: 'HmIP-RF',
            method: 'putParamset',
            params: ['000A:4', 'MASTER', {}],
            ok: false,
            error: 'Unknown parameter',
            durationMs: 1902,
            origin: 'ui',
        },
    ];

    it('lists finished calls with their duration and marks the failed one', () => {
        render(RpcLogPanel, {props: {open: true, entries, title: 'RPC log'}});
        expect(screen.getByText('184 ms')).toBeTruthy();
        expect(screen.getByText('1.90 s')).toBeTruthy();
        expect(screen.getByText('Unknown parameter')).toBeTruthy();
    });

    it('shows a spinner line for a write that is still running', () => {
        const {container} = render(RpcLogPanel, {
            props: {
                open: true,
                entries: [],
                pending: [{id: 1, interfaceName: 'BidCos-RF', method: 'putParamset', params: ['A:1'], startedAt: 0}],
                pendingText: 'in progress',
            },
        });
        expect(screen.getByText('in progress')).toBeTruthy();
        expect(container.querySelector('.hmm-rpclog-spinner')).toBeTruthy();
    });

    it('shows the empty text, clears and closes', async () => {
        const onclear = vi.fn();
        render(RpcLogPanel, {props: {open: true, entries: [], emptyText: 'No RPC calls yet', onclear}});
        expect(screen.getByText('No RPC calls yet')).toBeTruthy();

        await fireEvent.click(screen.getByText('Clear'));
        expect(onclear).toHaveBeenCalledOnce();

        await fireEvent.click(screen.getByLabelText('Close'));
        expect(screen.queryByText('No RPC calls yet')).toBeNull();
    });

    it('draws nothing while closed', () => {
        render(RpcLogPanel, {props: {open: false, entries}});
        expect(screen.queryByText('184 ms')).toBeNull();
    });
});

describe('RpcProgress', () => {
    it('is open exactly while a bulk write is running', async () => {
        const {rerender} = render(RpcProgress, {props: {progress: undefined}});
        expect(document.querySelector('dialog')?.open).toBe(false);

        await rerender({
            progress: {
                done: 2,
                total: 5,
                last: {
                    interfaceName: 'BidCos-RF',
                    address: 'MEQ0123456:1',
                    paramset: 'MASTER',
                    sent: {},
                    ok: true,
                    problems: [],
                },
            },
        });
        expect(document.querySelector('dialog')?.open).toBe(true);
        expect(screen.getByText('2 / 5')).toBeTruthy();
        expect(screen.getByText(/MEQ0123456:1/)).toBeTruthy();
    });

    it('offers a cancel button when the caller supplies one', async () => {
        const oncancel = vi.fn();
        render(RpcProgress, {props: {progress: {done: 1, total: 3}, cancelLabel: 'Abbrechen', oncancel}});
        await fireEvent.click(screen.getByText('Abbrechen'));
        expect(oncancel).toHaveBeenCalledOnce();
    });
});

/**
 * Task 21: the block of 2.7 - the CCU address and one ✔/✕ per interface - moved into the interface
 * popup, and what is left in the header is a single mark for the whole CCU. Its rules are
 * `summaryMark`'s (tested in `interfacePopup.test.ts`); what is tested here is that the component
 * paints them and keeps the header still.
 */
describe('ConnectionIndicator', () => {
    const state = (name: string, extra: Partial<InterfaceState> = {}): InterfaceState => ({
        name,
        type: name,
        protocol: 'xmlrpc',
        host: 'ccu',
        port: 2001,
        connected: true,
        ...extra,
    });

    it('is green with a title when every interface answers', () => {
        const {container} = render(ConnectionIndicator, {
            props: {interfaces: [state('BidCos-RF'), state('HmIP-RF')], allConnectedText: 'Alle verbunden'},
        });
        const mark = container.querySelector('.hmm-connection');
        expect(mark?.classList.contains('hmm-connection-ok')).toBe(true);
        expect(mark?.textContent).toBe('✔');
        expect(mark?.getAttribute('title')).toBe('Alle verbunden');
        expect(container.querySelector('.hmm-connection-offline')).toBeNull();
    });

    it('is red as soon as one interface does not answer', () => {
        const {container} = render(ConnectionIndicator, {
            props: {
                interfaces: [state('BidCos-RF'), state('HmIP-RF', {connected: false})],
                someNotConnectedText: 'Nicht jede Schnittstelle ist verbunden',
            },
        });
        const mark = container.querySelector('.hmm-connection');
        expect(mark?.classList.contains('hmm-connection-bad')).toBe(true);
        expect(mark?.getAttribute('title')).toBe('Nicht jede Schnittstelle ist verbunden');
    });

    it('greys itself out and says so when the backend is gone', () => {
        const {container} = render(ConnectionIndicator, {
            props: {interfaces: [], backendConnected: false, someNotConnectedText: 'Nicht verbunden'},
        });
        expect(container.querySelector('.hmm-connection-offline')).toBeTruthy();
        expect(container.querySelector('.hmm-connection')?.getAttribute('title')).toBe('Nicht verbunden');
    });

    /** Task 19's rule: four glyphs of four widths must not move what stands behind them. */
    it.skipIf(document.body.getBoundingClientRect().width === 0)(
        'keeps the same box whatever the state is',
        async () => {
            const {container, rerender} = render(ConnectionIndicator, {props: {interfaces: [state('BidCos-RF')]}});
            const width = (): number => container.querySelector('.hmm-connection')!.getBoundingClientRect().width;
            const first = width();
            expect(first).toBeGreaterThan(0);

            for (const extra of [{connected: false}, {connected: false, absent: true}, {subscribing: true}]) {
                await rerender({interfaces: [state('BidCos-RF', extra)]});
                expect(width(), `the ${JSON.stringify(extra)} mark has another width`).toBe(first);
            }
        },
    );
});

describe('LanguageSwitch and ThemeSwitch', () => {
    /** D-36: the browser is the default and is an entry of its own, above the two languages. */
    it('offers the browser default and exactly de and en, and reports a change', async () => {
        const onchange = vi.fn();
        render(LanguageSwitch, {props: {language: 'de', onchange}});
        const select = screen.getByLabelText<HTMLSelectElement>('Language');
        expect([...select.options].map((option) => option.value)).toEqual(['auto', 'de', 'en']);
        expect(select.value).toBe('de');

        await fireEvent.change(select, {target: {value: 'en'}});
        expect(onchange).toHaveBeenCalledExactlyOnceWith('en');
    });

    it('reports going back to the browser as a choice of its own', async () => {
        const onchange = vi.fn();
        render(LanguageSwitch, {props: {language: 'de', autoLabel: 'Sprache des Browsers', onchange}});
        const select = screen.getByLabelText<HTMLSelectElement>('Language');
        expect([...select.options][0]?.textContent).toBe('Sprache des Browsers');

        await fireEvent.change(select, {target: {value: 'auto'}});
        expect(onchange).toHaveBeenCalledExactlyOnceWith('auto');
    });

    it('stands on the browser default when nothing was chosen', () => {
        render(LanguageSwitch, {});
        expect(screen.getByLabelText<HTMLSelectElement>('Language').value).toBe('auto');
    });

    it('cycles the theme and labels itself through the caller’s translator', async () => {
        const onclick = vi.fn();
        render(ThemeSwitch, {props: {theme: 'dark', labelFor: (theme: string) => `Design: ${theme}`, onclick}});
        const button = screen.getByRole('button', {name: 'Design: dark'});
        await fireEvent.click(button);
        expect(onclick).toHaveBeenCalledOnce();
    });

    it('falls back to an English label without a translator', () => {
        render(ThemeSwitch, {props: {theme: 'system'}});
        expect(screen.getByRole('button', {name: 'Theme: system'})).toBeTruthy();
    });
});
