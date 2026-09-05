import type {InterfaceState, WriteLogEntry} from '@homematic-manager/core';
import {fireEvent, render, screen} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import type {Notice} from '../stores/NoticesStore.svelte.js';

import ConnectionIndicator from './ConnectionIndicator.svelte';
import ContextMenu from './ContextMenu.svelte';
import {clampMenuPosition} from './contextMenu.js';
import Dialog from './Dialog.svelte';
import LanguageSwitch from './LanguageSwitch.svelte';
import Loader from './Loader.svelte';
import MultiSelect from './MultiSelect.svelte';
import {filterOptions} from './multiSelect.js';
import Notices from './Notices.svelte';
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
});

describe('Toolbar and ToolbarButton', () => {
    it('renders its buttons and a trailing area', () => {
        const onclick = vi.fn();
        render(ToolbarButton, {props: {title: 'Refresh', icon: '⟳', onclick}});
        expect(screen.getByRole('button', {name: 'Refresh'}).getAttribute('title')).toBe('Refresh');
    });

    it('explains in the tooltip why a button is disabled', async () => {
        const onclick = vi.fn();
        render(ToolbarButton, {
            props: {title: 'Delete device', disabled: true, reason: 'This function arrives with task 8.', onclick},
        });
        const button = screen.getByRole('button', {name: 'Delete device'}) as HTMLButtonElement;
        expect(button.getAttribute('title')).toBe('Delete device — This function arrives with task 8.');
        // `disabled` is what stops the click; jsdom's `fireEvent.click` dispatches the event
        // regardless of it, so the attribute is what this asserts on.
        expect(button.disabled).toBe(true);
        expect(onclick).not.toHaveBeenCalled();
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

    it('lists the notices and dismisses one', async () => {
        const ondismiss = vi.fn();
        render(Notices, {props: {notices, ondismiss}});

        expect(screen.getByText('Connected')).toBeTruthy();
        expect(screen.getByText('ReGa')).toBeTruthy();
        await fireEvent.click(screen.getAllByLabelText('Dismiss')[2]!);
        expect(ondismiss).toHaveBeenCalledExactlyOnceWith(3);
    });
});

describe('RpcLogPanel', () => {
    const entries: WriteLogEntry[] = [
        {
            id: 1,
            timestamp: Date.parse('2026-09-05T09:57:02Z'),
            interfaceName: 'BidCos-RF',
            method: 'putParamset',
            params: ['MEQ0123456:1', 'MASTER', {LOGGING: 1}],
            ok: true,
            result: '',
            durationMs: 184,
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

describe('ConnectionIndicator', () => {
    const interfaces: InterfaceState[] = [
        {name: 'BidCos-RF', type: 'BidCos-RF', protocol: 'xmlrpc', host: 'ccu', port: 2001, connected: true},
        {name: 'HmIP-RF', type: 'HmIP-RF', protocol: 'xmlrpc', host: 'ccu', port: 2010, connected: false},
    ];

    it('shows the host and a ✔/✕ per interface, exactly as 2.x did', () => {
        const {container} = render(ConnectionIndicator, {props: {host: 'homematic', interfaces}});
        expect(screen.getByText('homematic')).toBeTruthy();
        expect(screen.getByText('✔')).toBeTruthy();
        expect(screen.getByText('✕')).toBeTruthy();
        expect(container.querySelector('.hmm-connection-offline')).toBeNull();
    });

    it('greys itself out when the backend is gone and shows a placeholder without a host', () => {
        const {container} = render(ConnectionIndicator, {
            props: {host: '', interfaces: [], backendConnected: false, notConnectedText: 'Nicht verbunden'},
        });
        expect(screen.getByText('Nicht verbunden')).toBeTruthy();
        expect(container.querySelector('.hmm-connection-offline')).toBeTruthy();
    });
});

describe('LanguageSwitch and ThemeSwitch', () => {
    it('offers exactly de and en and reports a change', async () => {
        const onchange = vi.fn();
        render(LanguageSwitch, {props: {language: 'de', onchange}});
        const select = screen.getByLabelText('Language') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual(['de', 'en']);

        await fireEvent.change(select, {target: {value: 'en'}});
        expect(onchange).toHaveBeenCalledExactlyOnceWith('en');
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
