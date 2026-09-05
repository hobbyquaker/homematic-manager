<script lang="ts">
    import type {RepairConfigOptions, RepairConfigResult} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';
    import {displayValue} from '../../lib/util/paramsetForm.js';

    interface Props {
        open?: boolean;
        address?: string;
    }

    let {open = $bindable(false), address = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let plan = $state<RepairConfigResult | undefined>(undefined);
    let done = $state<RepairConfigResult | undefined>(undefined);
    let loading = $state(false);
    let running = $state(false);
    let bidcosRecovery = $state<NonNullable<RepairConfigOptions['bidcosRecovery']>>('none');
    let loadToken = 0;

    const interfaceName = $derived(stores.app.selectedInterface);
    const hmip = $derived(!stores.interfaces.typeOf(interfaceName).startsWith('BidCos'));
    const result = $derived(done ?? plan);
    const corrections = $derived(
        result?.channels.flatMap((channel) => channel.corrected.map((c) => ({channel, c}))) ?? [],
    );

    $effect(() => {
        if (!open || address === '' || interfaceName === '') {
            return;
        }
        const token = (loadToken += 1);
        loading = true;
        done = undefined;
        bidcosRecovery = 'none';
        void stores.devices.repairConfig(interfaceName, address, {dryRun: true}).then((answer) => {
            if (token === loadToken) {
                plan = answer;
                loading = false;
            }
        });
    });

    async function repair(): Promise<void> {
        running = true;
        done = await stores.devices.repairConfig(interfaceName, address, {
            ...(hmip || bidcosRecovery === 'none' ? {} : {bidcosRecovery}),
        });
        running = false;
        if (done) {
            await stores.devices.load(interfaceName, {refresh: true});
            await stores.serviceMessages.load();
        }
    }
</script>

<!--
    Task 6.7, built on what the lab measured (docs/config-pending.md): the only recovery that works
    on hmipserver is a valid full MASTER write of the channel, made from the channel's own
    description. It clears a sticky CONFIG_PENDING; it cannot remove a parameter the channel does
    not have, because that lives in the interface process' own store - and the dialog says so
    plainly rather than pretending the device is fixed.
-->
<Dialog bind:open title={t('Repair configuration')} width="720px" testId="repair-dialog">
    <p class="hmm-repair-address">{stores.nameOf(address)} <span class="hmm-mono">{address}</span></p>

    {#if !hmip}
        <p class="hmm-repair-note" data-testid="repair-bidcos-note">
            {t(
                'On BidCos a pending configuration is normal: it is queued and the device takes it when it next wakes up.',
            )}
        </p>
    {/if}

    {#if loading}
        <p>{t('Loading Homematic Manager...')}</p>
    {:else if !result}
        <p data-testid="repair-failed">{t('No data')}</p>
    {:else}
        <p>
            CONFIG_PENDING:
            <span class="hmm-mono">{String(result.configPendingBefore ?? '—')}</span>
            {#if done}→ <span class="hmm-mono" data-testid="repair-pending-after"
                    >{String(done.configPendingAfter ?? '—')}</span
                >{/if}
        </p>

        {#if result.unrepairable.length > 0}
            <div class="hmm-repair-unrepairable" data-testid="repair-unrepairable">
                <p>
                    {t(
                        'These channels store a parameter their description does not have. No RPC method removes it: the device has to be deleted and paired again, or a CCU backup from before the bad write restored.',
                    )}
                </p>
                <ul>
                    {#each result.unrepairable as channel (channel)}
                        <li class="hmm-mono">{channel}</li>
                    {/each}
                </ul>
            </div>
        {/if}

        {#if corrections.length > 0}
            <table class="hmm-repair-table" data-testid="repair-corrections">
                <thead>
                    <tr>
                        <th>{t('Channel')}</th>
                        <th>{t('Parameter')}</th>
                        <th>{t('Current value')}</th>
                        <th>{t('New value')}</th>
                        <th>{t('Message')}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each corrections as entry (`${entry.channel.address}-${entry.c.parameter}`)}
                        <tr>
                            <td class="hmm-mono">{entry.channel.address}</td>
                            <td class="hmm-mono">{entry.c.parameter}</td>
                            <td>{displayValue(entry.c.stored, undefined)}</td>
                            <td>{displayValue(entry.c.replacement, undefined)}</td>
                            <td>{entry.c.reason}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {:else}
            <p data-testid="repair-nothing">{t('Nothing has to be corrected')}</p>
        {/if}

        {#if !hmip}
            <label class="hmm-repair-recovery">
                <span>{t('Additional BidCos recovery')}</span>
                <select class="hmm-select" bind:value={bidcosRecovery} data-testid="repair-recovery">
                    <option value="none">—</option>
                    <option value="clearConfigCache">clearConfigCache</option>
                    <option value="restoreConfigToDevice">restoreConfigToDevice</option>
                </select>
            </label>
        {/if}

        {#if done}
            <ul class="hmm-repair-results" data-testid="repair-results">
                {#each done.channels as channel (channel.address)}
                    <li class:hmm-repair-failed={!channel.write.ok}>
                        <span class="hmm-mono">{channel.address}</span>
                        {channel.write.ok ? '✔' : `✕ ${channel.write.faultString ?? ''}`}
                    </li>
                {/each}
            </ul>
        {/if}
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={running || result === undefined || done !== undefined}
            data-testid="repair-confirm"
            onclick={() => void repair()}>{t('Repair configuration')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-repair-address {
        margin-top: 0;
    }

    .hmm-repair-note {
        color: var(--hmm-fg-muted);
    }

    .hmm-repair-unrepairable {
        color: var(--hmm-error);
    }

    .hmm-repair-unrepairable ul {
        margin: 2px 0;
        padding-left: 18px;
    }

    .hmm-repair-table {
        width: 100%;
        border-collapse: collapse;
    }

    .hmm-repair-table th,
    .hmm-repair-table td {
        text-align: left;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-repair-recovery {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
    }

    .hmm-repair-results {
        margin: 8px 0 0;
        padding-left: 18px;
        color: var(--hmm-ok);
    }

    .hmm-repair-failed {
        color: var(--hmm-error);
    }
</style>
