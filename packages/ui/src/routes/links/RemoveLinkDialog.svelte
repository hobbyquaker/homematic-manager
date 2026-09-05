<script lang="ts">
    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        links?: ReadonlyArray<{sender: string; receiver: string}>;
    }

    let {open = $bindable(false), links = []}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let busy = $state(false);

    /** Issue #124: remove them with the rest of the change set rather than one by one now. */
    function stage(): void {
        const pairs = links.map((link) => ({...link}));
        stores.changeSet.stage({
            kind: 'linkRemove',
            interfaceName: stores.app.selectedInterface,
            title: t('{count} links', {}, pairs.length),
            pairs,
            calls: pairs.map((pair) => `removeLink(${pair.sender}, ${pair.receiver})`),
            lines: [],
        });
        open = false;
    }

    async function remove(): Promise<void> {
        busy = true;
        const removed = await stores.links.remove(stores.app.selectedInterface, links);
        busy = false;
        if (removed === links.length) {
            open = false;
        }
    }
</script>

<!--
    Issue #80: 2.x removed the one selected row, so cleaning up after a device swap meant opening
    this dialog once per link. The whole grid selection is listed here and removed in one go.
-->
<Dialog bind:open title={t('Delete link')} width="620px" testId="remove-link-dialog">
    <p>{t('{count} links', {}, links.length)}</p>
    <ul class="hmm-remove-links">
        {#each links as link (`${link.sender}->${link.receiver}`)}
            <li>
                <span class="hmm-mono">{link.sender}</span>
                →
                <span class="hmm-mono">{link.receiver}</span>
                <span class="hmm-remove-names">
                    {stores.nameOf(link.sender)} → {stores.nameOf(link.receiver)}
                </span>
            </li>
        {/each}
    </ul>

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || links.length === 0}
            data-testid="remove-link-stage"
            onclick={stage}>{t('Add to pending changes')}</button
        >
        <button
            type="button"
            class="hmm-button hmm-danger"
            disabled={busy || links.length === 0}
            data-testid="remove-link-confirm"
            onclick={() => void remove()}>{t('Delete')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-remove-links {
        margin: 0;
        padding-left: 18px;
        max-height: 40vh;
        overflow: auto;
    }

    .hmm-remove-names {
        color: var(--hmm-fg-muted);
    }

    .hmm-danger {
        color: var(--hmm-error);
    }
</style>
