<script lang="ts">
    import Dialog from '../lib/components/Dialog.svelte';
    import {getStores} from '../lib/stores/context.js';

    interface Props {
        open?: boolean;
    }

    let {open = $bindable(false)}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const version = $derived(stores.app.config?.version ?? '');
</script>

<Dialog bind:open title={t('about Homematic Manager')} width="480px" testId="about-dialog">
    <h3>Homematic Manager {version}</h3>
    <p>
        <a href="https://github.com/hobbyquaker/homematic-manager" target="_blank" rel="noreferrer noopener"
            >github.com/hobbyquaker/homematic-manager</a
        >
    </p>
    <p>Copyright (c) 2014-2026 Sebastian "Hobbyquaker" Raff, André "Anli" Litfin — GPLv3</p>
    <p class="hmm-about-note">HomeMatic und BidCoS sind eingetragene Warenzeichen der eQ-3 AG.</p>
    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
    {/snippet}
</Dialog>

<style>
    h3 {
        margin-top: 0;
    }

    .hmm-about-note {
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }
</style>
