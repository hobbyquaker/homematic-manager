<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {untrack} from 'svelte';

    import {getStores} from '../../lib/stores/context.js';
    import {formatDateTime} from '../../lib/util/format.js';
    import {
        layoutNetwork,
        routingNetwork,
        routingResolver,
        type NetworkEdge,
        type NetworkNode,
    } from '../../lib/util/routingNetwork.js';

    import RouterTableDialog from './RouterTableDialog.svelte';

    interface Props {
        interfaceName: string;
    }

    let {interfaceName}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let dialogOpen = $state(false);
    let dialogRouter = $state('');
    /** The node whose routes the table beside the graph shows first, `''` for none. */
    let focused = $state('');

    const SIZE = 640;

    // which routers route: known from the device table or the list already, read here otherwise
    const indexed = $derived(stores.devices.index(interfaceName) !== undefined);
    $effect(() => {
        const name = interfaceName;
        if (name !== '' && indexed) {
            untrack(() => void stores.routers.ensure(name));
        }
    });

    /** The access point's own devices: the central's virtual remote and the radio module. */
    const devices = $derived(stores.devices.devices(interfaceName));
    const central = $derived(devices.find((device) => device.TYPE === 'HmIP-RCV-50'));
    const isOwnPart = (device: DeviceDescription): boolean =>
        device.TYPE === 'HmIP-RCV-50' ||
        (central?.RF_ADDRESS !== undefined && device.RF_ADDRESS === central.RF_ADDRESS);
    const isAccessPoint = (device: DeviceDescription): boolean => /^HmIPW?-(HAP|DRAP)/i.test(device.TYPE);

    const gateway = $derived.by(() => {
        const gateways = stores.radio.gateways(interfaceName);
        return gateways.find((entry) => entry.DEFAULT === true) ?? gateways[0];
    });
    /** The centre: the default access point, or - before the gateway list is there - the central's address. */
    const accessPoint = $derived(gateway?.ADDRESS ?? central?.ADDRESS ?? 'AP');

    const stored = $derived(stores.routers.tablesOf(interfaceName));
    const progress = $derived(stores.routers.tableProgress[interfaceName]);
    const targets = $derived(stores.routers.tableTargets(interfaceName));
    const routers = $derived(
        stores.routers
            .routers(interfaceName)
            .filter((state) => state.enabled === true)
            .map((state) => state.address),
    );

    const network = $derived.by(() => {
        const own = devices.filter((device) => isOwnPart(device));
        const resolve = routingResolver(devices, {
            id: accessPoint,
            radioAddresses: own.flatMap((device) => (device.RF_ADDRESS === undefined ? [] : [device.RF_ADDRESS])),
        });
        const tables = Object.entries(stored?.tables ?? {}).flatMap(([router, table]) =>
            table.entries ? [{router, entries: table.entries}] : [],
        );
        return routingNetwork({
            accessPoint,
            tables,
            devices: devices.filter((device) => !isOwnPart(device)).map((device) => device.ADDRESS),
            accessPoints: devices.filter((device) => isAccessPoint(device)).map((device) => device.ADDRESS),
            routers,
            resolve,
        });
    });
    const positions = $derived(layoutNetwork(network, SIZE));
    const at = (id: string): {x: number; y: number} => positions.get(id) ?? {x: SIZE / 2, y: SIZE / 2};

    function label(id: string): string {
        if (id === accessPoint) {
            return gateway?.TYPE ?? t('Access point');
        }
        const name = stores.nameOf(id);
        return name === '' ? id : name;
    }

    function short(text: string): string {
        return text.length > 18 ? `${text.slice(0, 17)}…` : text;
    }

    /** Short, so it fits between two nodes: the link's RSSI, and the hops only where there are more than one. */
    function edgeText(edge: NetworkEdge): string {
        const parts: string[] = [];
        if (edge.distance !== undefined && edge.distance > 1) {
            parts.push(`${String(edge.distance)} ${t('hops', {}, edge.distance)}`);
        }
        if (edge.rssi !== undefined) {
            parts.push(`${String(edge.rssi)} dBm`);
        }
        return parts.join(', ');
    }

    function kindText(node: NetworkNode): string {
        return node.kind === 'access-point' ? t('Access point') : node.kind === 'router' ? t('Router') : t('Device');
    }

    /** A router whose table was read opens it; anything else puts its routes first in the table. */
    function activate(node: NetworkNode): void {
        if (stored?.tables[node.id] !== undefined) {
            dialogRouter = node.id;
            dialogOpen = true;
            return;
        }
        focused = focused === node.id ? '' : node.id;
    }

    const routes = $derived(
        [...network.routes].sort((a, b) => {
            const fa = focused !== '' && (a.destination === focused || a.router === focused) ? 0 : 1;
            const fb = focused !== '' && (b.destination === focused || b.router === focused) ? 0 : 1;
            return fa - fb || label(a.destination).localeCompare(label(b.destination)) || a.distance - b.distance;
        }),
    );
    const failures = $derived(Object.entries(stored?.tables ?? {}).filter(([, table]) => table.error !== undefined));
</script>

<div class="hmm-network" data-testid="routing-network">
    <div class="hmm-network-bar">
        <button
            type="button"
            class="hmm-button"
            disabled={progress !== undefined || targets.length === 0}
            title={targets.length === 0
                ? t('No router that routes offers its routing table')
                : t('Each table is read from its router over the air, one after the other')}
            data-testid="routing-read"
            onclick={() => void stores.routers.readTables(interfaceName)}>{t('Read routing tables')}</button
        >
        <span class="hmm-network-status" data-testid="routing-read-status" aria-live="polite">
            {#if progress !== undefined}
                {t('Reading {done} of {total}…', {done: progress.done + 1, total: progress.total})}
            {:else if stored !== undefined}
                {t('Last read {time}', {time: formatDateTime(stored.readAt, stores.i18n.language)})}
            {:else}
                {t('Not read yet: the graph shows every device directly at the access point.')}
            {/if}
        </span>
    </div>
    <p class="hmm-network-hint">
        {t(
            'Each router is asked once per read, over the air, with a pause between them; the result is kept until the next read. Entries of battery devices are what the router last heard and may be stale.',
        )}
    </p>
    {#if failures.length > 0}
        <p class="hmm-network-failures" data-testid="routing-read-failures">
            {t('Not answered')}: {failures.map(([router]) => label(router)).join(', ')}
        </p>
    {/if}

    <div class="hmm-network-body">
        <figure class="hmm-network-figure">
            <svg
                class="hmm-network-graph"
                viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
                role="img"
                aria-label={t('Routing graph')}
                data-testid="routing-graph"
            >
                {#each network.edges as edge (`${edge.from}|${edge.to}`)}
                    {@const a = at(edge.from)}
                    {@const b = at(edge.to)}
                    <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        class="hmm-network-edge"
                        class:hmm-network-assumed={edge.assumed}
                        class:hmm-network-static={edge.isStatic}
                        class:hmm-network-focus={focused !== '' && (edge.from === focused || edge.to === focused)}
                        data-testid={`edge-${edge.from}-${edge.to}`}
                    />
                    {#if !edge.assumed && edgeText(edge) !== ''}
                        <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} class="hmm-network-edge-text"
                            >{edgeText(edge)}</text
                        >
                    {/if}
                {/each}
                {#each network.nodes as node (node.id)}
                    {@const p = at(node.id)}
                    <g
                        class="hmm-network-node hmm-network-{node.kind}"
                        class:hmm-network-focus={focused === node.id}
                        role="button"
                        tabindex="0"
                        aria-label={`${kindText(node)} ${label(node.id)}`}
                        data-testid={`node-${node.id}`}
                        onclick={() => activate(node)}
                        onkeydown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                activate(node);
                            }
                        }}
                    >
                        <title>{`${label(node.id)} (${node.id})`}</title>
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={node.kind === 'access-point' ? 20 : node.kind === 'router' ? 15 : 10}
                        />
                        {#if node.kind !== 'device'}
                            <text x={p.x} y={p.y + 4} text-anchor="middle" class="hmm-network-mark"
                                >{node.kind === 'access-point' ? 'AP' : 'R'}</text
                            >
                        {/if}
                        <text
                            x={p.x}
                            y={p.y + (node.kind === 'access-point' ? 34 : node.kind === 'router' ? 28 : 22)}
                            text-anchor="middle"
                            class="hmm-network-label">{short(label(node.id))}</text
                        >
                    </g>
                {/each}
            </svg>
            <figcaption class="hmm-network-legend" data-testid="routing-legend">
                <span><span class="hmm-legend-dot hmm-legend-ap"></span>{t('Access point')}</span>
                <span><span class="hmm-legend-dot hmm-legend-router"></span>{t('Router')}</span>
                <span><span class="hmm-legend-dot hmm-legend-device"></span>{t('Device')}</span>
                <span><span class="hmm-legend-line"></span>{t('Route from a table')}</span>
                <span><span class="hmm-legend-line hmm-legend-assumed"></span>{t('Assumed: no table lists it')}</span>
            </figcaption>
        </figure>

        <div class="hmm-network-table-wrap">
            <table class="hmm-network-table" data-testid="routing-routes">
                <caption>{t('Routes')}</caption>
                <thead>
                    <tr>
                        <th scope="col">{t('Destination')}</th>
                        <th scope="col">{t('Router')}</th>
                        <th scope="col">{t('Next hop')}</th>
                        <th scope="col">{t('Hops')}</th>
                        <th scope="col">RSSI</th>
                    </tr>
                </thead>
                <tbody>
                    {#each routes as route, index (`${route.router}|${route.destination}|${String(index)}`)}
                        <tr
                            class:hmm-network-row-focus={focused !== '' &&
                                (route.destination === focused || route.router === focused)}
                            data-testid={`route-row-${route.router}-${route.destination}`}
                        >
                            <td title={route.destination}>{label(route.destination)}</td>
                            <td title={route.router}>{label(route.router)}</td>
                            <td title={route.nextHop}>{route.neighbour ? '—' : label(route.nextHop)}</td>
                            <td class="hmm-network-num">{route.distance}</td>
                            <td class="hmm-network-num"
                                >{route.rssi === undefined ? '' : `${String(route.rssi)} dBm`}</td
                            >
                        </tr>
                    {:else}
                        <tr>
                            <td colspan="5" class="hmm-network-empty">{t('No routes read yet')}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    </div>
</div>

<RouterTableDialog bind:open={dialogOpen} router={dialogRouter} table={stored?.tables[dialogRouter]} />

<style>
    .hmm-network {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
        overflow: auto;
        padding: 6px;
        box-sizing: border-box;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
    }

    .hmm-network-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .hmm-network-status {
        color: var(--hmm-fg-muted);
    }

    .hmm-network-hint,
    .hmm-network-failures {
        margin: 0;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-network-failures {
        color: var(--hmm-warn);
    }

    /* the graph and the table side by side; below each other where the room is narrow */
    .hmm-network-body {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-start;
    }

    .hmm-network-figure {
        flex: 2 1 320px;
        min-width: 0;
        max-width: 720px;
        margin: 0;
    }

    .hmm-network-graph {
        display: block;
        width: 100%;
        height: auto;
        font-size: 11px;
    }

    .hmm-network-edge {
        stroke: var(--hmm-fg-muted);
        stroke-width: 1.5;
    }

    .hmm-network-assumed {
        stroke: var(--hmm-border-strong);
        stroke-dasharray: 2 4;
    }

    .hmm-network-static {
        stroke-dasharray: 6 3;
    }

    .hmm-network-edge.hmm-network-focus {
        stroke: var(--hmm-accent);
        stroke-width: 2.5;
    }

    /* a halo in the page's colour keeps a label readable where it crosses a line */
    .hmm-network-edge-text,
    .hmm-network-label {
        paint-order: stroke;
        stroke: var(--hmm-bg);
        stroke-width: 3px;
        stroke-linejoin: round;
    }

    .hmm-network-edge-text {
        fill: var(--hmm-fg-muted);
        font-size: 10px;
        text-anchor: middle;
    }

    .hmm-network-node {
        cursor: pointer;
    }

    .hmm-network-node:focus {
        outline: none;
    }

    .hmm-network-node:focus-visible circle,
    .hmm-network-node.hmm-network-focus circle {
        stroke: var(--hmm-focus);
        stroke-width: 3;
    }

    .hmm-network-node circle {
        fill: var(--hmm-bg-sunken);
        stroke: var(--hmm-fg-muted);
        stroke-width: 1.5;
    }

    .hmm-network-router circle {
        fill: var(--hmm-accent-bg);
        stroke: var(--hmm-accent);
    }

    .hmm-network-access-point circle {
        fill: var(--hmm-accent);
        stroke: var(--hmm-accent);
    }

    .hmm-network-label {
        fill: var(--hmm-fg);
    }

    .hmm-network-mark {
        fill: var(--hmm-accent);
        font-size: 11px;
        font-weight: 600;
    }

    .hmm-network-access-point .hmm-network-mark {
        fill: var(--hmm-bg);
    }

    .hmm-network-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-network-legend > span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
    }

    .hmm-legend-dot {
        display: inline-block;
        box-sizing: border-box;
        width: 12px;
        height: 12px;
        border: 1.5px solid var(--hmm-fg-muted);
        border-radius: 50%;
        background: var(--hmm-bg-sunken);
    }

    .hmm-legend-ap {
        border-color: var(--hmm-accent);
        background: var(--hmm-accent);
    }

    .hmm-legend-router {
        border-color: var(--hmm-accent);
        background: var(--hmm-accent-bg);
    }

    .hmm-legend-line {
        display: inline-block;
        width: 22px;
        border-top: 1.5px solid var(--hmm-fg-muted);
    }

    .hmm-legend-assumed {
        border-top: 1.5px dotted var(--hmm-border-strong);
    }

    .hmm-network-table-wrap {
        flex: 1 1 280px;
        min-width: 0;
        overflow-x: auto;
    }

    .hmm-network-table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--hmm-font-size-grid);
    }

    .hmm-network-table caption {
        padding-bottom: 4px;
        font-weight: 600;
        text-align: left;
    }

    .hmm-network-table th,
    .hmm-network-table td {
        padding: 3px 6px;
        border-bottom: 1px solid var(--hmm-border-muted);
        text-align: left;
        white-space: nowrap;
    }

    .hmm-network-table th {
        color: var(--hmm-fg-muted);
        font-weight: 600;
    }

    .hmm-network-num {
        text-align: right;
    }

    .hmm-network-row-focus td {
        background: var(--hmm-row-selected);
        color: var(--hmm-row-selected-text);
    }

    .hmm-network-empty {
        color: var(--hmm-fg-muted);
    }
</style>
