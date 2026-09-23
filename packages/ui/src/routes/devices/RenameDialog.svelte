<script lang="ts">
    import {isDeviceAddress, renameEntries} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        /** The device or channel to rename; empty while the dialog is closed. */
        address?: string;
    }

    let {open = $bindable(false), address = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let name = $state('');
    /** Task 65: ticked at every opening - renaming a device names its channels too, unless unticked. */
    let renameChildren = $state(true);
    let saving = $state(false);

    const isDevice = $derived(address !== '' && isDeviceAddress(address));
    const children = $derived(
        isDevice ? stores.devices.channels(stores.app.selectedInterface, address).map((c) => c.ADDRESS) : [],
    );

    $effect(() => {
        if (open) {
            name = stores.names.name(address) ?? '';
            renameChildren = true;
        }
    });

    /**
     * The 2.x rule with the `:0` convention (task 65), in core so the inclusion dialog writes the
     * same: a device renames its `:0` with it, "overwrite channels" every other child to
     * `<name>:<channel index>`, and `:0` on its own is never renamed.
     */
    const planned = $derived(renameEntries(address, name, children, {channels: renameChildren}));

    async function save(): Promise<void> {
        const list = planned;
        if (list.length === 0) {
            return;
        }
        saving = true;
        const ok = await stores.names.rename(list);
        saving = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open title={t('Rename')} width="520px" testId="rename-dialog">
    <p class="hmm-rename-address">{address}</p>
    <input
        class="hmm-input hmm-rename-input"
        bind:value={name}
        aria-label={t('Name')}
        data-testid="rename-input"
        onkeydown={(event) => {
            if (event.key === 'Enter') {
                void save();
            }
        }}
    />
    {#if isDevice}
        <label class="hmm-rename-children">
            <input type="checkbox" bind:checked={renameChildren} data-testid="rename-children" />
            <span>{t('Overwrite channel names')}</span>
        </label>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={saving || planned.length === 0}
            data-testid="rename-save"
            onclick={() => void save()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-rename-address {
        margin: 0 0 6px;
        font-family: var(--hmm-font-mono);
        color: var(--hmm-fg-muted);
    }

    .hmm-rename-input {
        width: 100%;
    }

    .hmm-rename-children {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
    }
</style>
