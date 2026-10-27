<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import {getStores} from '../../lib/stores/context.js';
    import type {RouterTable} from '../../lib/stores/RoutersStore.svelte.js';

    import RoutingTable from '../paramset/RoutingTable.svelte';

    interface Props {
        open?: boolean;
        /** The router's device address. */
        router: string;
        table: RouterTable | undefined;
    }

    let {open = $bindable(false), router, table}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const name = $derived(stores.nameOf(router));
</script>

<!--
    Task 98: a router's own table from the network graph - task 26's graph and list, drawn from the
    entries the last "Read routing tables" brought, so opening it costs no second read on air.
-->
<Dialog
    bind:open
    title={`${t('Routing table')}: ${name === router ? router : `${name} (${router})`}`}
    width="720px"
    height="80vh"
    minWidth={320}
    movable
    testId="router-table-dialog"
>
    {#if table?.entries}
        <RoutingTable self={router} cached={table.entries} readAt={table.readAt} />
    {:else if table?.error !== undefined}
        <p class="hmm-router-table-error" data-testid="router-table-error">
            {t('The router did not answer: {error}', {error: table.error})}
        </p>
    {/if}
</Dialog>

<style>
    .hmm-router-table-error {
        margin: 0;
        color: var(--hmm-error);
        overflow-wrap: anywhere;
    }
</style>
