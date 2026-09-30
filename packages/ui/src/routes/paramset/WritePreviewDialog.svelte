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
        /** Issue #124: put this write into the change set instead of sending it now. */
        onstage?: (() => void) | undefined;
        /** The confirm button's text; "Write" for a paramset, "Apply" for task 26's suppression. */
        confirmLabel?: string | undefined;
        /** The line under the table; the paramset count by default. */
        countText?: string | undefined;
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
        onstage = undefined,
        confirmLabel = undefined,
        countText = undefined,
    }: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    const nothing = $derived(preview === undefined || preview.entries.length === 0);

    /**
     * B-88: title bar, a call line, the table's head and ten rows, the count line and the buttons -
     * measured at the default font size, with a little to spare.
     */
    const PREVIEW_MIN_HEIGHT = 520;
</script>

<!--
    Task 6 item 4: the exact parameters, values and RPC call before anything is written, and never
    a write the user has not seen. 2.x sent every enabled input of the dialog, always, and the only
    feedback was a modal that said "RPC execution" while it happened.
-->
<!--
    B-88: wide enough that a call with one or two parameters stays on one line (the width of the link
    editor, which opens it), and at least as tall as ten table rows, so the preview neither wraps its
    calls nor opens as a strip. The window bounds both: on a phone the dialog takes the screen, the
    body is still the one vertical scroller (D-34), and a call scrolls sideways in its own line
    instead of breaking inside an address.
-->
<Dialog
    bind:open
    title={t('Preview')}
    width="960px"
    minWidth={360}
    minHeight={PREVIEW_MIN_HEIGHT}
    testId="write-preview"
>
    {#if preview}
        <!--
            The exact call, with the exact struct: task 6 found that both interface processes take
            whatever they are given, so "what is really going out" is the only thing worth showing.
        -->
        {#if preview.calls}
            <!-- task 26: a preview whose calls are not putParamset lists them as they are -->
            {#each preview.calls as call, index (call)}
                <p class="hmm-preview-call" data-testid={`preview-call-${String(index)}`}>{call}</p>
            {/each}
        {:else}
            {#each preview.targets as target (target)}
                <p class="hmm-preview-call" data-testid={`preview-call-${target}`}>
                    putParamset(<span class="hmm-mono">{target}</span>, <span class="hmm-mono">{paramset}</span>,
                    <span class="hmm-mono">{JSON.stringify(preview.values)}</span>)
                </p>
            {/each}
        {/if}

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
                    {#each preview.entries as entry (`${entry.side ?? ''}:${entry.param}`)}
                        <tr
                            data-testid={entry.side === 'sender'
                                ? `preview-sender-${entry.param}`
                                : `preview-${entry.param}`}
                        >
                            <td class="hmm-mono"
                                >{entry.param}{#if entry.side}<span class="hmm-preview-side"
                                        >{entry.side === 'sender' ? t('Sender') : t('Receiver')}</span
                                    >{/if}</td
                            >
                            <td>{entry.from}</td>
                            <td class="hmm-preview-new">{entry.to}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
            <p class="hmm-preview-count">
                {#if countText !== undefined}
                    {countText}
                {:else}
                    {t('{count} parameters will be written', {}, preview.entries.length)} ×
                    {preview.targets.length}
                {/if}
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
                    {#each readBack as entry (`${entry.side ?? ''}:${entry.param}`)}
                        <tr
                            class:hmm-preview-differs={entry.differs}
                            data-testid={entry.side === 'sender'
                                ? `readback-sender-${entry.param}`
                                : `readback-${entry.param}`}
                        >
                            <td class="hmm-mono"
                                >{entry.param}{#if entry.side}<span class="hmm-preview-side"
                                        >{entry.side === 'sender' ? t('Sender') : t('Receiver')}</span
                                    >{/if}</td
                            >
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
                {#each results as result (`${result.address}-${result.peer ?? ''}-${result.paramset}`)}
                    <li class:hmm-preview-failed={!result.ok}>
                        <span class="hmm-mono"
                            >{result.address}{result.peer === undefined ? '' : `←${result.peer}`}</span
                        >
                        {result.ok ? '✔' : `✕ ${result.faultString ?? ''}`}
                    </li>
                {/each}
            </ul>
        {/if}
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
        {#if onstage}
            <!--
                Issue #124: the same payload, not sent but remembered. Everything the user has read
                here goes into the change set unchanged, so the review there is this preview again.
            -->
            <button
                type="button"
                class="hmm-button"
                disabled={writing || nothing}
                data-testid="write-stage"
                onclick={() => onstage()}>{t('Add to pending changes')}</button
            >
        {/if}
        <button
            type="button"
            class="hmm-button"
            disabled={writing || nothing}
            data-testid="write-confirm"
            onclick={() => onconfirm()}>{confirmLabel ?? t('Write')}</button
        >
    {/snippet}
</Dialog>

<style>
    /* B-88: one line per call; one that is wider than the dialog (a phone, a long struct) scrolls
       sideways in its own line rather than breaking in the middle of an address */
    .hmm-preview-call {
        margin-top: 0;
        font-family: var(--hmm-font-mono);
        color: var(--hmm-fg-muted);
        white-space: nowrap;
        overflow-x: auto;
        overflow-y: hidden;
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

    /* B-87: which end of a link a parameter belongs to */
    .hmm-preview-side {
        margin-left: 6px;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
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
