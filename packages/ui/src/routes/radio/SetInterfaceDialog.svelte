<script lang="ts">
    import {bidcosInterfaceLabel, isRoaming} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import RssiCell from '../../lib/components/RssiCell.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        address?: string;
        /** The gateway to open on - the marker that was clicked in the grid; `''` for the current one. */
        preset?: string;
    }

    let {open = $bindable(false), address = '', preset = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let gateway = $state('');
    let roaming = $state(false);
    let busy = $state(false);

    const interfaceName = $derived(stores.app.selectedInterface);
    const device = $derived(stores.devices.index(interfaceName)?.get(address));
    const gateways = $derived(stores.radio.gateways(interfaceName));
    const best = $derived(stores.radio.bestGatewayFor(interfaceName, address));
    /** What the device is configured for right now - the row the table marks (B-2, #142). */
    const configured = $derived(device?.INTERFACE ?? '');

    $effect(() => {
        if (!open) {
            return;
        }
        // The assignment the interface process reports right now, not the one read at start-up
        // (#122): 2.x kept its first `listDevices` answer and showed that for the rest of the
        // session, so an interface changed here looked unchanged until the app was restarted.
        const known = gateways.some((entry) => entry.ADDRESS === preset);
        gateway = known ? preset : (device?.INTERFACE ?? gateways[0]?.ADDRESS ?? '');
        roaming = device === undefined ? false : isRoaming(device);
    });

    async function apply(): Promise<void> {
        busy = true;
        const ok = await stores.radio.setBidcosInterface(interfaceName, address, gateway, roaming);
        if (ok) {
            await stores.devices.load(interfaceName, {refresh: true});
        }
        busy = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open title="setBidcosInterface" width="560px" testId="set-interface-dialog">
    <p class="hmm-set-interface-device">{stores.nameOf(address)} <span class="hmm-mono">{address}</span></p>
    <p class="hmm-set-interface-current">
        {t('Configured')}:
        <span class="hmm-mono" data-testid="set-interface-current">{configured === '' ? '—' : configured}</span>
    </p>

    <label class="hmm-set-interface-row">
        <span>{t('Interface')}</span>
        <select class="hmm-select" bind:value={gateway} data-testid="set-interface-select">
            {#each gateways as entry (entry.ADDRESS)}
                <option value={entry.ADDRESS}>
                    {entry.ADDRESS}
                    {entry.DESCRIPTION ?? entry.TYPE}
                </option>
            {/each}
        </select>
    </label>

    <label class="hmm-set-interface-row">
        <span>ROAMING</span>
        <input type="checkbox" bind:checked={roaming} data-testid="set-interface-roaming" />
    </label>

    {#if gateways.length > 0}
        <!--
            Bold marks the receiver the device is configured for, not the one that hears it best:
            a tester read the bold row as the configuration and was misled (#142). The best one
            is named under the table.
        -->
        <table class="hmm-set-interface-table">
            <thead>
                <tr><th></th><th>{t('Interface')}</th><th>← dBm</th><th>→ dBm</th></tr>
            </thead>
            <tbody>
                {#each gateways as entry (entry.ADDRESS)}
                    {@const measured = stores.radio.pair(interfaceName, address, entry.ADDRESS)}
                    <tr
                        class:hmm-set-interface-configured={configured === entry.ADDRESS}
                        data-testid={`set-interface-row-${entry.ADDRESS}`}
                        aria-current={configured === entry.ADDRESS ? 'true' : undefined}
                    >
                        <td
                            class="hmm-set-interface-mark"
                            title={configured === entry.ADDRESS ? t('Configured') : undefined}
                            >{configured === entry.ADDRESS ? '◉' : ''}</td
                        >
                        <td>
                            <span class="hmm-mono">{entry.ADDRESS}</span>
                            {#if bidcosInterfaceLabel(entry) !== entry.ADDRESS}
                                <span class="hmm-set-interface-name">{bidcosInterfaceLabel(entry)}</span>
                            {/if}
                        </td>
                        <td><RssiCell value={measured?.rx} labelOf={(band) => t(band.label)} /></td>
                        <td>
                            <RssiCell
                                value={measured?.tx}
                                labelOf={(band) => t(band.label)}
                                testId={`set-interface-tx-${entry.ADDRESS}`}
                            />
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
        {#if best}
            <p class="hmm-set-interface-best-note" data-testid="set-interface-best">
                {t('Heard best by {address}', {address: best.address})}
            </p>
        {/if}
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || gateway === ''}
            data-testid="set-interface-confirm"
            onclick={() => void apply()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-set-interface-device {
        margin-top: 0;
    }

    .hmm-set-interface-current {
        color: var(--hmm-fg-muted);
    }

    .hmm-set-interface-row {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 8px;
        align-items: center;
        margin-bottom: 6px;
    }

    .hmm-set-interface-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
    }

    .hmm-set-interface-table th,
    .hmm-set-interface-table td {
        text-align: left;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-set-interface-configured {
        font-weight: bold;
    }

    .hmm-set-interface-mark {
        width: 18px;
    }

    .hmm-set-interface-name {
        padding-left: 6px;
        color: var(--hmm-fg-muted);
    }

    .hmm-set-interface-best-note {
        color: var(--hmm-fg-muted);
    }
</style>
