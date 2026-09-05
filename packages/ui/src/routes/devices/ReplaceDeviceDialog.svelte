<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        /** The device that is to take another one's place - the row the action was started on. */
        address?: string;
    }

    let {open = $bindable(false), address = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let candidates = $state<DeviceDescription[]>([]);
    let oldAddress = $state('');
    let loading = $state(false);
    let replacing = $state(false);

    /**
     * `listReplaceableDevices` answers with the devices the new one may take over - same type, and
     * for BidCos the old one has to be unreachable. 2.7 filtered the channels out of the answer and
     * showed a name plus address per device; the same here.
     */
    const devicesOnly = $derived(candidates.filter((device) => !device.ADDRESS.includes(':')));

    $effect(() => {
        if (!open || address === '') {
            return;
        }
        const target = address;
        loading = true;
        oldAddress = '';
        void stores.devices.replaceable(stores.app.selectedInterface, target).then((list) => {
            candidates = list;
            oldAddress = list.find((device) => !device.ADDRESS.includes(':'))?.ADDRESS ?? '';
            loading = false;
        });
    });

    async function replace(): Promise<void> {
        replacing = true;
        const ok = await stores.devices.replace(stores.app.selectedInterface, oldAddress, address);
        replacing = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open title={t('Replace device')} width="560px" testId="replace-device-dialog">
    <h4>{t('Which device do you want to replace?')}</h4>
    <p class="hmm-replace-new">{t('New device')}: <span class="hmm-mono">{address}</span></p>

    {#if loading}
        <p>{t('Loading Homematic Manager...')}</p>
    {:else if devicesOnly.length === 0}
        <p data-testid="replace-none">{t('No suitable device available')}</p>
    {:else}
        <select class="hmm-select hmm-replace-select" bind:value={oldAddress} aria-label={t('Replace device')}>
            {#each devicesOnly as device (device.ADDRESS)}
                <option value={device.ADDRESS}>{stores.nameOf(device.ADDRESS)} ({device.ADDRESS})</option>
            {/each}
        </select>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={replacing || oldAddress === ''}
            data-testid="replace-device-confirm"
            onclick={() => void replace()}>{t('Replace')}</button
        >
    {/snippet}
</Dialog>

<style>
    h4 {
        margin: 0 0 4px;
    }

    .hmm-replace-new {
        color: var(--hmm-fg-muted);
    }

    .hmm-replace-select {
        width: 100%;
    }
</style>
