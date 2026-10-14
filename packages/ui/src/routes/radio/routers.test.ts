import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

const BSM = '000A1B2C3D4E5F';
const PSM = '0001D709A1B2C3';

function rowOf(table: HTMLElement, address: string): HTMLElement {
    const row = table.querySelector<HTMLElement>(`[data-row-id="${address}"]`);
    if (!row) {
        throw new Error(`no row ${address}`);
    }
    return row;
}

describe('the routers of the radio tab (task 97)', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('offers the routers view on HmIP-RF only', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/rssi'});
        await waitFor(() => screen.getByTestId('radio-table'));
        expect(screen.queryByTestId('radio-views')).toBeNull();
    });

    it('lists every router-capable device with its switch, its RSSI and the count of those that route', async () => {
        await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        const table = await waitFor(() => screen.getByTestId('routers-table'));
        await waitFor(() => {
            expect(table.querySelectorAll('[data-row-id]')).toHaveLength(2);
        });
        // the BSM routes, the PSM-2 could but does not; the battery devices are not listed
        expect(rowOf(table, BSM).textContent).toContain('Schaltaktor Terrasse');
        expect(rowOf(table, PSM).textContent).toContain('Steckdose Wohnzimmer');
        expect(rowOf(table, PSM).textContent).toContain(PSM);
        expect(rowOf(table, PSM).textContent).toContain('HmIP-PSM-2');
        expect(table.querySelector('[data-row-id="0001D8A9B7C6D5"]')).toBeNull();
        expect(screen.getByTestId(`routing-switch-${BSM}`).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId(`routing-switch-${PSM}`).getAttribute('aria-checked')).toBe('false');
        expect(screen.getByTestId(`routing-switch-${BSM}`).textContent).toContain('an');
        expect(screen.getByTestId(`routing-switch-${PSM}`).textContent).toContain('aus');
        expect(table.textContent).toContain('1 von 2 routen');
        // the receive level against the access point, from the maintenance channel's values
        await waitFor(() => {
            expect(screen.getByTestId(`router-rssi-${BSM}-rx`).textContent).toBe('-55');
        });
        expect(screen.getByTestId(`router-rssi-${PSM}-tx`).textContent).toBe('-66');
    });

    it('asks before it switches, writes nothing on cancel, and the switch follows the write', async () => {
        await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        const toggle = await waitFor(() => {
            const button = screen.getByTestId(`routing-switch-${PSM}`);
            expect(button.hasAttribute('disabled')).toBe(false);
            return button;
        });

        await fireEvent.click(toggle);
        const dialog = await waitFor(() => screen.getByTestId('routing-switch-dialog'));
        expect(within(dialog).getByText('Routing einschalten?')).toBeTruthy();
        expect(within(dialog).getByTestId('routing-switch-text').textContent).toContain(
            `Steckdose Wohnzimmer (${PSM})`,
        );
        expect(dialog.textContent).toContain(`ROUTER_MODULE_ENABLED = true`);
        await fireEvent.click(within(dialog).getByTestId('routing-switch-cancel'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-switch-dialog').hasAttribute('open')).toBe(false);
        });
        expect(transport.countOf('paramset.put')).toBe(0);

        await fireEvent.click(toggle);
        await fireEvent.click(await waitFor(() => screen.getByTestId('routing-switch-confirm')));
        await waitFor(() => {
            expect(screen.getByTestId(`routing-switch-${PSM}`).getAttribute('aria-checked')).toBe('true');
        });
        expect(transport.lastCall('paramset.put')).toEqual([
            'HmIP-RF',
            [`${PSM}:0`],
            'MASTER',
            {ROUTER_MODULE_ENABLED: true},
        ]);
        expect(screen.getByTestId('routers-table').textContent).toContain('2 von 2 routen');

        // and off again: the question names what is lost
        await fireEvent.click(screen.getByTestId(`routing-switch-${BSM}`));
        const off = await waitFor(() => screen.getByTestId('routing-switch-dialog'));
        expect(within(off).getByText('Routing ausschalten?')).toBeTruthy();
        expect(off.textContent).toContain('ROUTER_MODULE_ENABLED = false');
        await fireEvent.click(within(off).getByTestId('routing-switch-confirm'));
        await waitFor(() => {
            expect(screen.getByTestId(`routing-switch-${BSM}`).getAttribute('aria-checked')).toBe('false');
        });
    });

    it('opens the routing table where the interface offers one, and only there', async () => {
        await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        const bsm = await waitFor(() => screen.getByTestId(`routing-table-${BSM}`));
        const psm = screen.getByTestId(`routing-table-${PSM}`);
        expect(psm.hasAttribute('disabled')).toBe(true);
        expect(psm.getAttribute('title')).toBe('Die Schnittstelle bietet für dieses Gerät keine Routing-Tabelle an');
        expect(bsm.hasAttribute('disabled')).toBe(false);

        transport.reset();
        await fireEvent.click(bsm);
        await waitFor(() => {
            expect(transport.lastCall('paramset.get')).toEqual(['HmIP-RF', `${BSM}:0`, 'ROUTING_TABLE']);
        });
    });

    it('reads the values again on Refresh, never by itself', async () => {
        await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        await waitFor(() => {
            expect(screen.getByTestId(`routing-switch-${PSM}`).hasAttribute('disabled')).toBe(false);
            expect(screen.getByTestId(`routing-switch-${BSM}`).hasAttribute('disabled')).toBe(false);
        });
        transport.reset();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(transport.countOf('paramset.get')).toBe(0);

        await fireEvent.click(screen.getByTestId('routers-refresh'));
        await waitFor(() => {
            expect(transport.countOf('paramset.get')).toBe(2);
        });
    });
});

describe('the router marker in the device table (task 97)', () => {
    it('marks the devices that route, not the capable ones that do not', async () => {
        const transport = new MockTransport({demo: true});
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        const marker = await waitFor(() => screen.getByTestId(`router-${BSM}`));
        expect(marker.getAttribute('title')).toBe('Leitet für andere HmIP-Geräte weiter');
        expect(marker.getAttribute('aria-label')).toBe('Router');
        // the type is still in the cell, before the marker
        expect(marker.closest('.hmm-type-cell')?.textContent).toContain('HmIP-BSM');
        expect(screen.queryByTestId(`router-${PSM}`)).toBeNull();
    });

    it('draws no marker on BidCos', async () => {
        const transport = new MockTransport({demo: true});
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await waitFor(() => screen.getByTestId('devices-table'));
        expect(document.querySelector('[data-testid^="router-"]')).toBeNull();
        expect(transport.calls.some((call) => call.method === 'paramset.get' && call.params[2] === 'MASTER')).toBe(
            false,
        );
    });
});

describe('the routing graph of the radio tab (task 98)', () => {
    const AP = '3014F711A0000418971558';
    const SWDO = '0011D3C9A1B2C3';
    const WRC2 = '0001D8A9B7C6D5';
    const ETRV = '3014F711A0001F';

    function tableReads(transport: MockTransport): number {
        return transport.calls.filter((call) => call.method === 'paramset.get' && call.params[2] === 'ROUTING_TABLE')
            .length;
    }

    it('reads the tables only on the button, then draws the network and the routes', async () => {
        const transport = new MockTransport({demo: true});
        await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        // the List/Graph pair belongs to the Routers view only
        expect(screen.queryByTestId('routers-mode-graph')).toBeNull();
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        await fireEvent.click(screen.getByTestId('routers-mode-graph'));
        const view = await waitFor(() => screen.getByTestId('routing-network'));

        // before the click: every device straight at the access point, nothing read
        expect(screen.getByTestId('routing-read-status').textContent).toContain('Noch nicht gelesen');
        await waitFor(() => {
            expect(screen.getByTestId('routing-read').hasAttribute('disabled')).toBe(false);
        });
        expect(
            view.querySelector(`[data-testid="edge-${AP}-${SWDO}"]`)?.classList.contains('hmm-network-assumed'),
        ).toBe(true);
        expect(tableReads(transport)).toBe(0);

        await fireEvent.click(screen.getByTestId('routing-read'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-read-status').textContent).toContain('Zuletzt gelesen');
        });
        expect(tableReads(transport)).toBe(1);
        expect(transport.lastCall('paramset.get')).toEqual(['HmIP-RF', `${BSM}:0`, 'ROUTING_TABLE']);

        // the BSM's neighbours on measured edges, the eTRV behind the wall remote
        const measured = (from: string, to: string): Element | null =>
            view.querySelector(`[data-testid="edge-${from}-${to}"]:not(.hmm-network-assumed)`);
        expect(measured(BSM, AP)).not.toBeNull();
        expect(measured(BSM, SWDO)).not.toBeNull();
        expect(measured(BSM, WRC2)).not.toBeNull();
        expect(measured(WRC2, ETRV)).not.toBeNull();
        // the PSM-2 does not route and nobody lists it: assumed at the access point
        expect(view.querySelector(`[data-testid="edge-${AP}-${PSM}"]`)?.classList.contains('hmm-network-assumed')).toBe(
            true,
        );
        expect(screen.getByTestId(`node-${AP}`).classList.contains('hmm-network-access-point')).toBe(true);
        expect(screen.getByTestId(`node-${BSM}`).classList.contains('hmm-network-router')).toBe(true);
        // the routes beside it
        const routes = within(screen.getByTestId('routing-routes'));
        expect(routes.getByTestId(`route-row-${BSM}-${ETRV}`).textContent).toContain('Wandtaster Diele');
        expect(routes.getByTestId(`route-row-${BSM}-${SWDO}`).textContent).toContain('-71 dBm');
        expect(screen.getByTestId('routing-legend').textContent).toContain('Angenommen');
    });

    it('opens a router’s own table from its node without reading it again, and focuses any other node', async () => {
        const transport = new MockTransport({demo: true});
        await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        await fireEvent.click(screen.getByTestId('routers-mode-graph'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-read').hasAttribute('disabled')).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('routing-read'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-read-status').textContent).toContain('Zuletzt gelesen');
        });

        await fireEvent.click(screen.getByTestId(`node-${BSM}`));
        const dialog = await waitFor(() => screen.getByTestId('router-table-dialog'));
        await waitFor(() => {
            expect(within(dialog).getByTestId('route-3').textContent).toContain(ETRV);
        });
        expect(dialog.textContent).toContain('hier nicht erneut gelesen');
        expect(tableReads(transport)).toBe(1);

        await fireEvent.keyDown(screen.getByTestId(`node-${SWDO}`), {key: 'Enter'});
        await waitFor(() => {
            expect(screen.getByTestId(`node-${SWDO}`).classList.contains('hmm-network-focus')).toBe(true);
        });
        expect(screen.getByTestId(`route-row-${BSM}-${SWDO}`).classList.contains('hmm-network-row-focus')).toBe(true);
    });

    it('keeps the last read across a reload, with its time, and reads nothing for it', async () => {
        const first = new MockTransport({demo: true});
        const {storage} = await mountApp({transport: first, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        await fireEvent.click(screen.getByTestId('routers-mode-graph'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-read').hasAttribute('disabled')).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('routing-read'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-read-status').textContent).toContain('Zuletzt gelesen');
        });
        document.body.innerHTML = '';

        const second = new MockTransport({demo: true});
        await mountApp({transport: second, storage, hash: '#/HmIP-RF/rssi'});
        await fireEvent.click(await waitFor(() => screen.getByTestId('radio-view-routers')));
        await fireEvent.click(screen.getByTestId('routers-mode-graph'));
        await waitFor(() => {
            expect(screen.getByTestId('routing-read-status').textContent).toContain('Zuletzt gelesen');
        });
        expect(screen.getByTestId(`route-row-${BSM}-${ETRV}`)).toBeTruthy();
        expect(tableReads(second)).toBe(0);
    });
});
