<script lang="ts">
    import type {Paramset} from '@homematic-manager/core';
    import {SvelteMap} from 'svelte/reactivity';
    import {getStores} from '../../lib/stores/context.js';
    import {formatDateTime} from '../../lib/util/format.js';
    import {parseRoutingTable, routingGraph, type RoutingEntry} from '../../lib/util/routingTable.js';

    /**
     * Task 26 (openccu-lite 28.9): the ROUTING_TABLE paramset of an HmIP router, as the table
     * eQ-3 documents and as a graph seen from the router - it in the middle, its neighbours and
     * next hops on a ring, everything routed through them on an outer ring.
     */
    interface Props {
        values?: Paramset;
        /** Task 98: the entries of a table read earlier, instead of `values`. */
        cached?: readonly RoutingEntry[] | undefined;
        /** Task 98: when `cached` was read; the hint then says so instead of "read when this opens". */
        readAt?: number | undefined;
        /** The device address (the channel's device part). */
        self: string;
    }
    let {values = {}, cached = undefined, readAt = undefined, self}: Props = $props();
    const stores = getStores();
    const t = stores.i18n.t;
    const entries = $derived(cached === undefined ? parseRoutingTable(values) : [...cached]);
    const graph = $derived(routingGraph(self, entries));
    const name = (address: string): string => {
        const label = stores.nameOf(address);
        return label && label !== address ? label : address;
    };

    // layout: the router at the centre, its direct edges on the inner ring, the rest outside
    const SIZE = 560;
    const positions = $derived.by(() => {
        const map = new SvelteMap<string, {x: number; y: number}>();
        const cx = SIZE / 2;
        const cy = SIZE / 2;
        map.set(graph.self, {x: cx, y: cy});
        const inner = graph.edges.filter((edge) => edge.from === graph.self).map((edge) => edge.to);
        const outer = graph.nodes.map((node) => node.id).filter((id) => id !== graph.self && !inner.includes(id));
        const ring = (ids: string[], radius: number, offset: number): void => {
            ids.forEach((id, i) => {
                const angle = offset + (2 * Math.PI * i) / Math.max(ids.length, 1);
                map.set(id, {x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle)});
            });
        };
        ring(inner, SIZE * 0.26, -Math.PI / 2);
        ring(outer, SIZE * 0.44, -Math.PI / 2 + Math.PI / Math.max(outer.length, 1));
        return map;
    });
    const at = (id: string): {x: number; y: number} => positions.get(id) ?? {x: SIZE / 2, y: SIZE / 2};
</script>

<div class="hmm-routing" data-testid="routing-table">
    <p class="hmm-routing-hint">
        {readAt === undefined
            ? t('Read from the device itself; every read costs duty cycle, so it is read once when this opens.')
            : t('Read from the device at {time}; not read again here.', {
                  time: formatDateTime(readAt, stores.i18n.language),
              })}
    </p>
    {#if entries.length === 0}
        <p>{t('No routes: the device reported an empty table.')}</p>
    {:else}
        <svg
            class="hmm-routing-graph"
            viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
            role="img"
            aria-label={t('Routing table')}
        >
            {#each graph.edges as edge (`${edge.from}>${edge.to}`)}
                {@const a = at(edge.from)}
                {@const b = at(edge.to)}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class:hmm-routing-static={edge.isStatic} />
                {#if edge.distance !== undefined}
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} class="hmm-routing-edge">
                        {edge.distance}
                        {t('hops', {}, edge.distance)}{#if edge.rssi !== undefined}, {edge.rssi} dBm{/if}
                    </text>
                {/if}
            {/each}
            {#each graph.nodes as node (node.id)}
                {@const p = at(node.id)}
                <g
                    class="hmm-routing-node"
                    class:hmm-routing-self={node.id === graph.self}
                    class:hmm-routing-router={node.router}
                >
                    <circle cx={p.x} cy={p.y} r={node.id === graph.self ? 22 : 16} />
                    <text x={p.x} y={p.y + 30} text-anchor="middle">{name(node.id)}</text>
                    {#if node.accessController}<text x={p.x} y={p.y + 4} text-anchor="middle" class="hmm-routing-mark"
                            >AC</text
                        >{:else if node.router}<text x={p.x} y={p.y + 4} text-anchor="middle" class="hmm-routing-mark"
                            >R</text
                        >{:else if node.portable}<text x={p.x} y={p.y + 4} text-anchor="middle" class="hmm-routing-mark"
                            >P</text
                        >{/if}
                </g>
            {/each}
        </svg>
        <table class="hmm-table hmm-routing-list">
            <thead>
                <tr>
                    <th>#</th>
                    <th>{t('Destination')}</th>
                    <th>{t('Next hop')}</th>
                    <th>{t('Hops')}</th>
                    <th>RSSI</th>
                    <th>{t('Neighbour')}</th>
                    <th>{t('Static')}</th>
                    <th>{t('Router')}</th>
                    <th>{t('Access controller')}</th>
                    <th>{t('Portable')}</th>
                    <th>{t('Listener mode')}</th>
                    <th>{t('Valid')}</th>
                </tr>
            </thead>
            <tbody>
                {#each entries as entry (entry.index)}
                    <tr data-testid={`route-${String(entry.index)}`}>
                        <td>{entry.index}</td>
                        <td
                            ><span class="hmm-mono">{entry.destination}</span>
                            {name(entry.destination) !== entry.destination ? name(entry.destination) : ''}</td
                        >
                        <td><span class="hmm-mono">{entry.nextHop}</span></td>
                        <td>{entry.distance}</td>
                        <td>{entry.rssi === undefined ? '' : `${String(entry.rssi)} dBm`}</td>
                        <td>{entry.isNeighbour ? '✔' : ''}</td>
                        <td>{entry.isStatic ? '✔' : ''}</td>
                        <td>{entry.router ? '✔' : ''}</td>
                        <td>{entry.accessController ? '✔' : ''}</td>
                        <td>{entry.portable ? '✔' : ''}</td>
                        <td>{entry.listenerMode}</td>
                        <td>{entry.omValid ? '✔' : ''}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
</div>

<style>
    .hmm-routing {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .hmm-routing-hint {
        margin: 0;
        color: var(--hmm-fg-muted, inherit);
        font-size: 0.9em;
    }
    .hmm-routing-graph {
        width: 100%;
        max-width: 560px;
        align-self: center;
        font-size: 12px;
    }
    .hmm-routing-graph line {
        stroke: var(--hmm-fg-muted);
        stroke-width: 1.5;
    }
    .hmm-routing-graph line.hmm-routing-static {
        stroke-dasharray: 5 4;
    }
    .hmm-routing-edge {
        fill: var(--hmm-fg-muted);
        font-size: 10px;
        text-anchor: middle;
    }
    .hmm-routing-node circle {
        fill: var(--hmm-bg-sunken);
        stroke: var(--hmm-fg-muted);
        stroke-width: 1.5;
    }
    .hmm-routing-node.hmm-routing-router circle {
        stroke: var(--hmm-accent);
    }
    .hmm-routing-node.hmm-routing-self circle {
        fill: var(--hmm-accent);
        stroke: var(--hmm-accent);
    }
    .hmm-routing-node text {
        fill: var(--hmm-fg);
    }
    .hmm-routing-node.hmm-routing-self .hmm-routing-mark {
        fill: var(--hmm-bg);
    }
    .hmm-routing-mark {
        font-size: 11px;
        font-weight: 600;
    }
    .hmm-routing-list td,
    .hmm-routing-list th {
        white-space: nowrap;
    }
</style>
