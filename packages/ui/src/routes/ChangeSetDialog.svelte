<script lang="ts">
    import Dialog from '../lib/components/Dialog.svelte';
    import RpcProgress from '../lib/components/RpcProgress.svelte';
    import {getStores} from '../lib/stores/context.js';
    import type {StagedChange} from '../lib/stores/ChangeSetStore.svelte.js';

    interface Props {
        open?: boolean;
    }

    let {open = $bindable(false)}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const set = stores.changeSet;

    const total = $derived(set.count);

    function outcomeOf(change: StagedChange): {ok: boolean; error?: string} | undefined {
        const outcome = set.outcome(change.id);
        return outcome === undefined ? undefined : {ok: outcome.ok, ...(outcome.error ? {error: outcome.error} : {})};
    }

    /**
     * Apply, then reload what the changes touched: a staged link creation only shows up in the
     * grid once `getLinks` has been asked again, and a paramset write does not change any list.
     * The dialog closes when nothing is left; what failed stays, with its reason.
     */
    async function apply(): Promise<void> {
        const touched = set.interfaces;
        await set.apply();
        for (const name of touched) {
            await stores.links.load(name);
        }
        if (set.empty) {
            open = false;
        }
    }
</script>

<!--
    Issue #124: everything that was staged, in one list, with one Apply.

    The review is the write preview of task 6, once per staged change: the exact RPC call and the
    parameters that change, so nothing is written that the user has not read. Apply then runs them
    in order through the same paced queue a single multi-apply uses, which is why the progress bar
    and the cancel button here are the ordinary `write.progress` / `write.cancel` ones.
-->
<Dialog bind:open title={t('Pending changes')} width="820px" testId="change-set-dialog">
    {#if set.empty}
        <p data-testid="change-set-empty">{t('Nothing is staged')}</p>
    {:else}
        <ol class="hmm-changes" data-testid="change-set-list">
            {#each set.changes as change (change.id)}
                {@const outcome = outcomeOf(change)}
                <li class="hmm-change" data-testid={`change-${change.id}`}>
                    <div class="hmm-change-head">
                        <span class="hmm-change-title">{change.title}</span>
                        <button
                            type="button"
                            class="hmm-button"
                            disabled={set.applying}
                            data-testid={`change-remove-${change.id}`}
                            onclick={() => set.remove(change.id)}>{t('Remove')}</button
                        >
                    </div>
                    {#each change.calls as call (call)}
                        <p class="hmm-change-call">{call}</p>
                    {/each}
                    {#if change.lines.length > 0}
                        <table class="hmm-change-table">
                            <tbody>
                                {#each change.lines as line (line.label)}
                                    <tr>
                                        <td class="hmm-mono">{line.label}</td>
                                        <td>{line.from ?? ''}</td>
                                        <td class="hmm-change-new">{line.to ?? ''}</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    {/if}
                    {#if outcome && !outcome.ok}
                        <p class="hmm-change-error" data-testid={`change-error-${change.id}`}>{outcome.error}</p>
                    {/if}
                </li>
            {/each}
        </ol>

        <p class="hmm-change-count" data-testid="change-set-count">
            {t('{count} changes staged', {}, total)}
        </p>
    {/if}

    {#if set.applying}
        <RpcProgress
            progress={stores.writeLog.progress ?? {done: set.applied, total}}
            cancelLabel={t('Cancel')}
            oncancel={() => void set.cancel()}
        />
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={set.empty || set.applying}
            data-testid="change-set-clear"
            onclick={() => set.clear()}>{t('Discard all')}</button
        >
        <button
            type="button"
            class="hmm-button"
            disabled={set.empty || set.applying}
            data-testid="change-set-apply"
            onclick={() => void apply()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-changes {
        margin: 0;
        padding-left: 20px;
    }

    .hmm-change {
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-change-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .hmm-change-title {
        font-weight: bold;
    }

    .hmm-change-call {
        margin: 2px 0;
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
        word-break: break-all;
    }

    .hmm-change-table {
        width: 100%;
        border-collapse: collapse;
    }

    .hmm-change-table td {
        text-align: left;
        padding: 1px 4px;
    }

    .hmm-change-new {
        font-weight: bold;
    }

    .hmm-change-error {
        color: var(--hmm-error);
        margin: 4px 0 0;
    }

    .hmm-change-count {
        color: var(--hmm-fg-muted);
    }
</style>
