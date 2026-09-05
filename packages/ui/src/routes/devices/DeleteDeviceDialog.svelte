<script lang="ts">
    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        address?: string;
    }

    let {open = $bindable(false), address = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /**
     * `deleteDevice` takes one flag word, and 2.7 offered it as two dropdowns whose values are
     * added: reset the device to factory defaults (1) or only unlearn it (0), and - if it does not
     * answer - delete it at the next opportunity (4) or only from the interface process (2).
     * DELETE_FLAG_RESET = 1, DELETE_FLAG_FORCE = 2, DELETE_FLAG_DEFER = 4 in the eQ-3 specification.
     */
    let reset = $state(1);
    let unreachable = $state(4);
    let deleting = $state(false);

    const flags = $derived(reset + unreachable);
    const name = $derived(stores.names.nameOf(address));

    $effect(() => {
        if (open) {
            reset = 1;
            unreachable = 4;
        }
    });

    async function remove(): Promise<void> {
        deleting = true;
        const ok = await stores.devices.remove(stores.app.selectedInterface, address, flags);
        deleting = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open title={t('Delete device')} width="560px" testId="delete-device-dialog">
    <h4>{t('Do you really want to delete the device {name}?', {name})}</h4>
    <p class="hmm-delete-address">{address}</p>

    <select class="hmm-select hmm-delete-select" bind:value={reset} aria-label={t('Delete device')}>
        <option value={1}>{t('Unlearn and reset the device to factory defaults')}</option>
        <option value={0}>{t('Unlearn only (direct links are kept)')}</option>
    </select>

    <p>{t('If the device cannot be reached:')}</p>
    <select
        class="hmm-select hmm-delete-select"
        bind:value={unreachable}
        aria-label={t('If the device cannot be reached:')}
    >
        <option value={4}>{t('Delete at the next opportunity')}</option>
        <option value={2}>{t('Delete from the interface process only')}</option>
    </select>

    <p class="hmm-delete-flags">FLAGS = {flags}</p>

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button hmm-danger"
            disabled={deleting}
            data-testid="delete-device-confirm"
            onclick={() => void remove()}>{t('Delete')}</button
        >
    {/snippet}
</Dialog>

<style>
    h4 {
        margin: 0 0 4px;
    }

    .hmm-delete-address {
        margin: 0 0 10px;
        font-family: var(--hmm-font-mono);
        color: var(--hmm-fg-muted);
    }

    .hmm-delete-select {
        width: 100%;
    }

    .hmm-delete-flags {
        margin-bottom: 0;
        color: var(--hmm-fg-muted);
        font-family: var(--hmm-font-mono);
    }

    .hmm-danger {
        color: var(--hmm-error);
    }
</style>
