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
    const host = $derived(stores.host.info);
    const manifest = $derived(stores.meta.manifest);
    const update = $derived(stores.host.update);

    /**
     * The host's own numbers, where there is a host. `apps/web`, the CCU addon and demo mode have
     * no `window.__HMM_HOST__`, and then the dialog simply shows what the API knows - which is the
     * version, and that is what 2.x showed too.
     */
    const rows = $derived(
        host === undefined
            ? []
            : [
                  ['Electron', host.electron],
                  ['Chromium', host.chrome],
                  ['Node', host.node],
                  ['Platform', `${host.platform} ${host.arch}`],
                  ['Packaged', String(host.packaged)],
                  ['userData', host.userData],
                  ['Log', host.logFile],
              ],
    );
</script>

<Dialog bind:open title={t('about Homematic Manager')} width="560px" testId="about-dialog">
    <h3>Homematic Manager {version}</h3>
    <p>
        <a href="https://github.com/hobbyquaker/homematic-manager" target="_blank" rel="noreferrer noopener"
            >github.com/hobbyquaker/homematic-manager</a
        >
    </p>
    <p>Copyright (c) 2014-2026 Sebastian "Hobbyquaker" Raff, André "Anli" Litfin — AGPLv3</p>

    {#if rows.length > 0}
        <table class="hmm-about-table" data-testid="about-host">
            <tbody>
                {#each rows as [label, value] (label)}
                    <tr>
                        <th>{label}</th>
                        <td class="hmm-mono">{value}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}

    {#if update && update.phase !== 'disabled'}
        <p data-testid="about-update">
            {t('Update')}: {update.phase}{update.version === undefined ? '' : ` ${update.version}`}
            <button
                type="button"
                class="hmm-button"
                disabled={update.phase === 'checking'}
                data-testid="about-check-update"
                onclick={() => void stores.host.checkForUpdate()}>{t('Check for updates')}</button
            >
        </p>
    {/if}

    {#if manifest}
        <p class="hmm-about-note" data-testid="about-data">
            {t('Device data')}:
            {manifest.sources.map((source) => `${source.name} ${source.version}`).join(', ')}
            ({manifest.generatedAt.slice(0, 10)})
        </p>
    {/if}

    <p class="hmm-about-note">HomeMatic und BidCoS sind eingetragene Warenzeichen der eQ-3 AG.</p>
    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
    {/snippet}
</Dialog>

<style>
    h3 {
        margin-top: 0;
    }

    .hmm-about-table {
        border-collapse: collapse;
        margin: 8px 0;
    }

    .hmm-about-table th {
        text-align: left;
        padding-right: 12px;
        font-weight: normal;
        color: var(--hmm-fg-muted);
    }

    .hmm-about-note {
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }
</style>
