<script lang="ts">
    import type {WriteResult} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';
    import type {ReadBackEntry, WritePreview} from '../../lib/util/paramsetForm.js';

    interface Props {
        open?: boolean;
        preview?: WritePreview | undefined;
        paramset?: string;
        /** Failing cross-validation rules of the metadata, as text. */
        warnings?: readonly string[];
        writing?: boolean;
        results?: readonly WriteResult[];
        /** What the interface really stored, read back after the write (task 6, item 7). */
        readBack?: readonly ReadBackEntry[];
        onconfirm: () => void;
    }

    let {
        open = $bindable(false),
        preview = undefined,
        paramset = 'MASTER',
        warnings = [],
        writing = false,
        results = [],
        readBack = [],
        onconfirm,
    }: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    const nothing = $derived(preview === undefined || preview.entries.length === 0);
</script>

<!--
    Task 6 item 4: the exact parameters, values and RPC call before anything is written, and never
    a write the user has not seen. 2.x sent every enabled input of the dialog, always, and the only
    feedback was a modal that said "RPC execution" while it happened.
-->
<Dialog bind:open title={t('Preview')} width="640px" testId="write-preview">
    {#if preview}
        <!--
            The exact call, with the exact struct: task 6 found that both interface processes take
            whatever they are given, so "what is really going out" is the only thing worth showing.
        -->
        {#each preview.targets as target (target)}
            <p class="hmm-preview-call" data-testid={`preview-call-${target}`}>
                putParamset(<span class="hmm-mono">{target}</span>, <span class="hmm-mono">{paramset}</span>,
                <span class="hmm-mono">{JSON.stringify(preview.values)}</span>)
            </p>
        {/each}

        {#if warnings.length > 0}
            <ul class="hmm-preview-warnings" data-testid="preview-warnings">
                {#each warnings as warning (warning)}
                    <li>{warning}</li>
                {/each}
            </ul>
        {/if}

        {#if nothing}
            <p data-testid="preview-empty">{t('Nothing has changed - nothing will be written')}</p>
        {:else}
            <table class="hmm-preview-table">
                <thead>
                    <tr><th>{t('Parameter')}</th><th>{t('Current value')}</th><th>{t('New value')}</th></tr>
                </thead>
                <tbody>
                    {#each preview.entries as entry (entry.param)}
                        <tr data-testid={`preview-${entry.param}`}>
                            <td class="hmm-mono">{entry.param}</td>
                            <td>{entry.from}</td>
                            <td class="hmm-preview-new">{entry.to}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
            <p class="hmm-preview-count">
                {t('{count} parameters will be written', {}, preview.entries.length)} ×
                {preview.targets.length}
            </p>
        {/if}

        {#if preview.problems.length > 0}
            <ul class="hmm-preview-problems" data-testid="preview-problems">
                {#each preview.problems as problem (`${problem.param}-${problem.code}`)}
                    <li>{problem.param}: {problem.message}</li>
                {/each}
            </ul>
        {/if}

        {#if readBack.length > 0}
            <table class="hmm-preview-table" data-testid="preview-readback">
                <thead>
                    <tr><th>{t('Parameter')}</th><th>{t('What was sent')}</th><th>{t('Read back')}</th></tr>
                </thead>
                <tbody>
                    {#each readBack as entry (entry.param)}
                        <tr class:hmm-preview-differs={entry.differs} data-testid={`readback-${entry.param}`}>
                            <td class="hmm-mono">{entry.param}</td>
                            <td>{entry.sent}</td>
                            <td>{entry.stored}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
            {#if readBack.some((entry) => entry.differs)}
                <p class="hmm-preview-warn" data-testid="readback-warning">
                    {t('The interface answered ok but stored something else')}
                </p>
            {/if}
        {/if}

        {#if results.length > 0}
            <ul class="hmm-preview-results" data-testid="preview-results">
                {#each results as result (`${result.address}-${result.paramset}`)}
                    <li class:hmm-preview-failed={!result.ok}>
                        <span class="hmm-mono">{result.address}</span>
                        {result.ok ? '✔' : `✕ ${result.faultString ?? ''}`}
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
            disabled={writing || nothing}
            data-testid="write-confirm"
            onclick={() => onconfirm()}>{t('Write')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-preview-call {
        margin-top: 0;
        font-family: var(--hmm-font-mono);
        color: var(--hmm-fg-muted);
        word-break: break-all;
    }

    .hmm-preview-table {
        width: 100%;
        border-collapse: collapse;
    }

    .hmm-preview-table th,
    .hmm-preview-table td {
        text-align: left;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-preview-new {
        font-weight: bold;
    }

    .hmm-preview-count {
        color: var(--hmm-fg-muted);
    }

    .hmm-preview-warnings,
    .hmm-preview-problems {
        margin: 6px 0;
        padding-left: 18px;
        color: var(--hmm-warn);
    }

    .hmm-preview-problems {
        color: var(--hmm-error);
    }

    .hmm-preview-results {
        margin: 6px 0;
        padding-left: 18px;
        color: var(--hmm-ok);
    }

    .hmm-preview-failed {
        color: var(--hmm-error);
    }

    .hmm-preview-differs {
        color: var(--hmm-warn);
    }

    .hmm-preview-warn {
        color: var(--hmm-warn);
    }
</style>
