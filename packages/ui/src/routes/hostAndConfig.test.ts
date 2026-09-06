import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import type {HostBridge, HostInfo, HostMenuAction, HostUpdateState} from '../lib/host/types.js';
import {DEMO_CONFIG} from '../lib/transport/demoData.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

const info: HostInfo = {
    version: '3.0.0-dev.0',
    electron: '44.2.0',
    chrome: '140.0.0',
    node: '22.20.0',
    platform: 'linux',
    arch: 'x64',
    packaged: true,
    userData: '/home/u/.config/homematic-manager',
    logFile: '/home/u/.config/homematic-manager/error.log',
};

interface Fake extends HostBridge {
    fireUpdate(state: HostUpdateState): void;
    fireMenu(action: HostMenuAction): void;
    themes(): string[];
    calls(): string[];
    opened(): string[];
}

function fakeHost(initial: HostUpdateState = {phase: 'idle', dismissed: false}): Fake {
    const updateHandlers = new Set<(state: HostUpdateState) => void>();
    const menuHandlers = new Set<(action: HostMenuAction) => void>();
    const themes: string[] = [];
    const calls: string[] = [];
    const opened: string[] = [];
    let state = initial;
    const record = (name: string, next: HostUpdateState): Promise<HostUpdateState> => {
        calls.push(name);
        state = next;
        for (const handler of updateHandlers) {
            handler(state);
        }
        return Promise.resolve(state);
    };
    const bridge = {
        info: () => Promise.resolve(info),
        deviceImageUrl: (type: string) => `hmm-image://device/${type}`,
        setTheme: (source: string) => {
            themes.push(source);
            return Promise.resolve();
        },
        onSystemTheme: () => () => {},
        openExternal: (url: string) => {
            opened.push(url);
            return Promise.resolve();
        },
        onMenuAction(handler: (action: HostMenuAction) => void) {
            menuHandlers.add(handler);
            return () => menuHandlers.delete(handler);
        },
        update: {
            state: () => Promise.resolve(state),
            check: () => record('check', {phase: 'available', version: '3.1.0', dismissed: false}),
            download: () => record('download', {phase: 'downloading', version: '3.1.0', percent: 40, dismissed: false}),
            installOnQuit: () => record('installOnQuit', {phase: 'installOnQuit', version: '3.1.0', dismissed: false}),
            dismiss: () => record('dismiss', {...state, dismissed: true}),
            on(handler: (next: HostUpdateState) => void) {
                updateHandlers.add(handler);
                return () => updateHandlers.delete(handler);
            },
        },
    } as HostBridge;
    return Object.assign(bridge, {
        fireUpdate: (next: HostUpdateState) => {
            state = next;
            for (const handler of updateHandlers) {
                handler(next);
            }
        },
        fireMenu: (action: HostMenuAction) => {
            for (const handler of menuHandlers) {
                handler(action);
            }
        },
        themes: () => themes,
        calls: () => calls,
        opened: () => opened,
    }) as Fake;
}

describe("the settings dialog's info line", () => {
    /**
     * Task 23: the About dialog is gone and this is where what it said now lives - the version, the
     * device data set it was built with and the licence. Without a host that is all there is, which
     * is `apps/web`, the CCU addon and demo mode.
     */
    it('shows the version, the data set and the licence, and nothing about Electron', async () => {
        await mountApp();
        await fireEvent.click(screen.getByTestId('settings-button'));

        const info = await waitFor(() => screen.getByTestId('config-info'));
        expect(info.textContent).toContain('3.0.0-dev.0');
        expect(info.textContent).toContain('AGPL-3.0-or-later');
        expect(screen.queryByTestId('config-host-info')).toBeNull();
        await waitFor(() => {
            expect(screen.getByTestId('config-info').textContent).toContain('openccu-data 2026.7.2');
        });
    });

    it('adds what the host bridge reports when there is one', async () => {
        await mountApp({hostBridge: fakeHost()});
        await fireEvent.click(screen.getByTestId('settings-button'));

        const host = await waitFor(() => screen.getByTestId('config-host-info'));
        expect(host.textContent).toContain('44.2.0');
        expect(host.textContent).toContain('140.0.0');
        expect(host.textContent).toContain('linux x64');
        expect(host.textContent).toContain('/home/u/.config/homematic-manager/error.log');
    });
});

describe('the update notice', () => {
    it('is absent without a host bridge - apps/web and the addon never see it', async () => {
        await mountApp();
        expect(screen.queryByTestId('update-notice')).toBeNull();
    });

    it('offers a download, then an install on quit, and never does either by itself (D-16)', async () => {
        const bridge = fakeHost();
        await mountApp({hostBridge: bridge});

        bridge.fireUpdate({phase: 'available', version: '3.1.0', dismissed: false});
        const notice = await waitFor(() => screen.getByTestId('update-notice'));
        expect(notice.textContent).toContain('3.1.0');
        expect(bridge.calls()).not.toContain('download');

        await fireEvent.click(screen.getByTestId('update-download'));
        await waitFor(() => {
            expect(screen.getByTestId('update-notice').textContent).toContain('40 %');
        });

        bridge.fireUpdate({phase: 'downloaded', version: '3.1.0', dismissed: false});
        await fireEvent.click(await waitFor(() => screen.getByTestId('update-install')));
        await waitFor(() => {
            expect(bridge.calls()).toContain('installOnQuit');
        });
    });

    it('disappears once it is dismissed', async () => {
        const bridge = fakeHost();
        await mountApp({hostBridge: bridge});
        bridge.fireUpdate({phase: 'available', version: '3.1.0', dismissed: false});
        await waitFor(() => {
            expect(screen.getByTestId('update-notice')).toBeTruthy();
        });

        await fireEvent.click(screen.getByTestId('update-dismiss'));
        await waitFor(() => {
            expect(screen.queryByTestId('update-notice')).toBeNull();
        });
    });
});

describe('the GitHub icon in the header', () => {
    /**
     * Task 23: a link, not a menu. In a browser it is the browser's own - a new tab with
     * `rel="noopener noreferrer"` - and there is no host to ask, so nothing prevents the default.
     */
    it('is a plain link to the project without a host', async () => {
        await mountApp();
        const link = screen.getByTestId<HTMLAnchorElement>('github-link');

        expect(link.getAttribute('href')).toBe('https://github.com/hobbyquaker/homematic-manager');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link.getAttribute('aria-label')).toBe('Homematic Manager auf GitHub');
        // and the "?" it replaced is gone
        expect(screen.queryByTestId('about-button')).toBeNull();
    });

    it('hands the URL to the host instead of opening a window, when there is a host', async () => {
        const bridge = fakeHost();
        await mountApp({hostBridge: bridge});

        const link = screen.getByTestId('github-link');
        const click = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0});
        link.dispatchEvent(click);

        await waitFor(() => {
            expect(bridge.opened()).toEqual(['https://github.com/hobbyquaker/homematic-manager']);
        });
        // the renderer does not navigate anywhere itself
        expect(click.defaultPrevented).toBe(true);
    });
});

describe('the host bridge in the shell', () => {
    it('tells the host which theme the user picked', async () => {
        const bridge = fakeHost();
        await mountApp({hostBridge: bridge});
        await fireEvent.click(screen.getByTestId('theme-switch'));

        await waitFor(() => {
            expect(bridge.themes()).toContain('light');
        });
    });

    it('opens the settings dialog when the application menu asks for it', async () => {
        const bridge = fakeHost();
        await mountApp({hostBridge: bridge});
        expect(screen.queryByTestId('config-dialog')?.hasAttribute('open')).not.toBe(true);

        bridge.fireMenu('settings');
        await waitFor(() => {
            expect(screen.getByTestId('config-dialog').hasAttribute('open')).toBe(true);
        });
    });
});

describe('the settings dialog', () => {
    let transport: MockTransport;

    async function openSettings(): Promise<void> {
        await mountApp({transport});
        await fireEvent.click(screen.getByTestId('settings-button'));
        await waitFor(() => {
            expect(screen.getByTestId('config-dialog')).toBeTruthy();
        });
    }

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('runs the UDP discovery on demand and takes the answer into the host field', async () => {
        transport.result('config.discover', [
            {address: '192.168.1.99', serial: 'KEQ0000002', firmware: '3.89.8', interfaces: ['BidCos-RF']},
        ]);
        await openSettings();

        await fireEvent.click(screen.getByTestId('config-discover'));
        await waitFor(() => {
            expect(transport.countOf('config.discover')).toBe(1);
        });

        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('config-discovered'));
        await waitFor(() => {
            expect([...select.options].map((option) => option.value)).toContain('192.168.1.99');
        });
        await fireEvent.change(select, {target: {value: '192.168.1.99'}});
        expect(screen.getByTestId<HTMLInputElement>('config-host').value).toBe('192.168.1.99');
    });

    it('adds, validates and removes a user-defined interface (#135, D-13)', async () => {
        await openSettings();

        await fireEvent.click(screen.getByTestId('config-extra-add'));
        const row = await waitFor(() => screen.getByTestId('config-extra-0'));

        // An entry without a name and host is reported rather than saved.
        await waitFor(() => {
            expect(screen.getByTestId('config-extra-problem-0')).toBeTruthy();
        });

        await fireEvent.input(within(row).getByLabelText('Name 0'), {target: {value: 'CUxD-2'}});
        await fireEvent.input(within(row).getByLabelText('Host 0'), {target: {value: '192.168.1.10'}});
        await fireEvent.input(within(row).getByLabelText('Port 0'), {target: {value: '8701'}});
        await fireEvent.change(within(row).getByLabelText('Protokoll 0'), {target: {value: 'binrpc'}});

        await waitFor(() => {
            expect(screen.queryByTestId('config-extra-problem-0')).toBeNull();
        });

        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => {
            expect(transport.lastCall('config.set')?.[0].extraInterfaces).toEqual([
                {name: 'CUxD-2', host: '192.168.1.10', port: 8701, protocol: 'binrpc', path: ''},
            ]);
        });
    });

    it('removes an extra interface from the interface list as well', async () => {
        transport.result('config.get', {
            ...DEMO_CONFIG,
            connection: {
                ...DEMO_CONFIG.connection,
                interfaces: ['BidCos-RF', 'CUxD-2'],
                extraInterfaces: [
                    {name: 'CUxD-2', host: '192.168.1.10', port: 8701, protocol: 'binrpc' as const, path: ''},
                ],
            },
        });
        await openSettings();

        await fireEvent.click(within(screen.getByTestId('config-extra-0')).getByLabelText('Entfernen 0'));
        await fireEvent.click(screen.getByTestId('config-save'));

        await waitFor(() => {
            const connection = transport.lastCall('config.set')?.[0];
            expect(connection?.extraInterfaces).toEqual([]);
            expect(connection?.interfaces).toEqual(['BidCos-RF']);
        });
    });

    it('offers no protocol choice for the built-in interfaces (D-28)', async () => {
        await openSettings();
        const dialog = screen.getByTestId('config-dialog');
        // The only protocol select in the dialog belongs to an extra interface, and there is none.
        expect(within(dialog).queryByLabelText('Protokoll 0')).toBeNull();
        expect(dialog.textContent).not.toContain('BIN-RPC bevorzugen');
    });
});
