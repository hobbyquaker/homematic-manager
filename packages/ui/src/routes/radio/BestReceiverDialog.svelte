<script lang="ts">
    import type {ReceiverProposal} from '@homematic-manager/core';
    import {bidcosInterfaceLabel, DEFAULT_RECEIVER_MARGIN_DB} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import RssiCell from '../../lib/components/RssiCell.svelte';
    import {getStores} from '../../lib/stores/context.js';

    /**
     * Issue #69: "set the interface of every device to the one with the best RSSI values" - as a
     * dry run the user confirms, never as a button that writes on its own. The list is core's
     * `proposeReceivers`; a clear switch is ticked, a marginal one (better, but by less than the
     * margin) and a device whose configured receiver has no measurement are listed unticked with
     * their reason, everything else is one line of counts. Each ticked device is one
     * `setBidcosInterface` with roaming off, and a device that roams is never in the list.
     */

    interface Props {
        open?: boolean;
    }

    let {open = $bindable(false)}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let marginDb = $state(DEFAULT_RECEIVER_MARGIN_DB);
    /** The user's own ticks and unticks, over the default of "every clear switch". */
    let overrides = $state<Record<string, boolean>>({});
    let busy = $state(false);
    let progress = $state({done: 0, total: 0});

    const interfaceName = $derived(stores.app.selectedInterface);
    const devices = $derived(stores.devices.devices(interfaceName));
    const gateways = $derived(stores.radio.gateways(interfaceName));
    const proposals = $derived(stores.radio.proposeReceivers(interfaceName, devices, marginDb));
    const listed = $derived(
        proposals.filter((row) => row.verdict === 'switch' || row.verdict === 'marginal' || row.verdict === 'unheard'),
    );
    const rest = $derived({
        keep: proposals.filter((row) => row.verdict === 'keep').length,
        unmeasured: proposals.filter((row) => row.verdict === 'unmeasured').length,
        roaming: proposals.filter((row) => row.verdict === 'roaming').length,
    });
    const chosen = $derived(listed.filter((row) => isChosen(row)));

    function isChosen(row: ReceiverProposal): boolean {
        return overrides[row.address] ?? row.verdict === 'switch';
    }

    function labelOf(serial: string | undefined): string {
        if (serial === undefined || serial === '') {
            return '—';
        }
        const gateway = gateways.find((entry) => entry.ADDRESS === serial);
        return gateway ? bidcosInterfaceLabel(gateway) : serial;
    }

    function setMargin(value: string): void {
        const parsed = Number.parseInt(value, 10);
        marginDb = Number.isFinite(parsed) ? Math.max(0, parsed) : DEFAULT_RECEIVER_MARGIN_DB;
        // a new margin is a new default; the ticks made against the old one do not carry over
        overrides = {};
    }

    $effect(() => {
        if (open) {
            overrides = {};
            progress = {done: 0, total: 0};
        }
    });

    async function apply(): Promise<void> {
        const rows = chosen.filter((row) => row.best !== undefined);
        busy = true;
        progress = {done: 0, total: rows.length};
        let failed = 0;
        for (const row of rows) {
            const ok = await stores.radio.setBidcosInterface(interfaceName, row.address, row.best ?? '', false);
            if (!ok) {
                failed += 1;
            }
            progress = {done: progress.done + 1, total: rows.length};
        }
        // The assignment is visible only in the device descriptions (#122), and the levels the
        // interfaces hold move with it: both are re-read, so a failed device stays in the list
        // and a written one drops out of it.
        await stores.devices.load(interfaceName, {refresh: true});
        await stores.radio.load(interfaceName);
        overrides = {};
        busy = false;
        if (failed === 0) {
            open = false;
        }
    }
</script>

<Dialog bind:open title={t('Best receiver')} width="800px" testId="best-receiver-dialog">
    <p class="hmm-best-receiver-intro">
        {t(
            'Which interface receives each device best, from the levels the interfaces last measured. Nothing is written until you confirm; every device is one setBidcosInterface.',
        )}
    </p>

    <div class="hmm-best-receiver-margin">
        <label>
            <span>{t('Margin')}</span>
            <input
                class="hmm-input"
                type="number"
                min="0"
                max="60"
                step="1"
                value={marginDb}
                disabled={busy}
                data-testid="best-receiver-margin"
                oninput={(event) => setMargin(event.currentTarget.value)}
            />
            <span>dB</span>
        </label>
        <span class="hmm-best-receiver-hint">
            {t(
                'A switch is proposed only when the best interface receives the device at least this much better than the configured one - two reads of the same link differ by a few dB.',
            )}
        </span>
    </div>

    {#if listed.length === 0}
        <p class="hmm-best-receiver-empty" data-testid="best-receiver-empty">
            {t('Every device is on the receiver that hears it best')}
        </p>
    {:else}
        <div class="hmm-best-receiver-scroll">
            <table class="hmm-best-receiver-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>{t('Name')}</th>
                        <th>ADDRESS</th>
                        <th>{t('Configured')}</th>
                        <th>→ dBm</th>
                        <th>{t('Proposed')}</th>
                        <th>→ dBm</th>
                        <th>{t('Gain')}</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {#each listed as row (row.address)}
                        <tr data-testid={`best-receiver-row-${row.address}`} data-verdict={row.verdict}>
                            <td>
                                <input
                                    type="checkbox"
                                    checked={isChosen(row)}
                                    disabled={busy}
                                    aria-label={row.address}
                                    data-testid={`best-receiver-check-${row.address}`}
                                    onchange={(event) => {
                                        overrides = {...overrides, [row.address]: event.currentTarget.checked};
                                    }}
                                />
                            </td>
                            <td>{stores.nameOf(row.address)}</td>
                            <td class="hmm-mono">{row.address}</td>
                            <td>{labelOf(row.configured)}</td>
                            <td><RssiCell value={row.configuredTx} labelOf={(band) => t(band.label)} /></td>
                            <td>{labelOf(row.best)}</td>
                            <td><RssiCell value={row.bestTx} labelOf={(band) => t(band.label)} /></td>
                            <td class="hmm-best-receiver-gain" data-testid={`best-receiver-gain-${row.address}`}>
                                {row.gain === undefined ? '—' : `+${String(row.gain)} dB`}
                            </td>
                            <td class="hmm-best-receiver-note">
                                {#if row.verdict === 'marginal'}
                                    {t('Below the margin')}
                                {:else if row.verdict === 'unheard'}
                                    {t('Not heard by the configured receiver')}
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}

    <p class="hmm-best-receiver-rest" data-testid="best-receiver-rest">
        {t('Not listed: {keep} on their best receiver, {unmeasured} without a measurement, {roaming} roaming', rest)}
    </p>
    {#if busy}
        <p class="hmm-best-receiver-progress" data-testid="best-receiver-progress">
            {t('{done} of {total} assigned', progress)}
        </p>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" disabled={busy} onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || chosen.length === 0}
            data-testid="best-receiver-confirm"
            onclick={() => void apply()}>{t('Assign ({count})', {count: chosen.length})}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-best-receiver-intro {
        margin-top: 0;
    }

    .hmm-best-receiver-margin {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 12px;
        margin-bottom: 8px;
    }

    .hmm-best-receiver-margin label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    .hmm-best-receiver-margin input {
        width: 60px;
    }

    .hmm-best-receiver-hint,
    .hmm-best-receiver-note,
    .hmm-best-receiver-rest,
    .hmm-best-receiver-progress,
    .hmm-best-receiver-empty {
        color: var(--hmm-fg-muted);
    }

    .hmm-best-receiver-scroll {
        max-height: 50vh;
        overflow: auto;
    }

    .hmm-best-receiver-table {
        width: 100%;
        border-collapse: collapse;
    }

    .hmm-best-receiver-table th,
    .hmm-best-receiver-table td {
        text-align: left;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
        white-space: nowrap;
    }

    .hmm-best-receiver-gain {
        text-align: right;
    }
</style>
