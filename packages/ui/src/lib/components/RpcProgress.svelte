<script lang="ts">
    import type {ApiEvents} from '@homematic-manager/core';

    import Dialog from './Dialog.svelte';

    interface Props {
        progress?: ApiEvents['write.progress'] | undefined;
        title?: string;
        cancelLabel?: string | undefined;
        oncancel?: (() => void) | undefined;
        testId?: string | undefined;
    }

    let {
        progress = undefined,
        title = 'RPC execution',
        cancelLabel = undefined,
        oncancel = undefined,
        testId = undefined,
    }: Props = $props();

    // A writable derived: it follows `progress`, and `Dialog` may still write to it on close.
    let open = $derived(progress !== undefined);
</script>

<!--
    The one place a modal is still right: a bulk write in progress, where clicking somewhere else
    would start a second one. Single calls go to the non-modal RpcLogPanel instead - task 6 item 4
    wants progress and a cancel for bulk operations, and this is where that lands.
-->
<Dialog bind:open {title} modal closable={false} width="420px" {testId}>
    {#if progress}
        <p class="hmm-progress-line">{progress.done} / {progress.total}</p>
        <progress class="hmm-progress" max={progress.total} value={progress.done}></progress>
        {#if progress.last}
            <p class="hmm-progress-last hmm-mono">
                {progress.last.address}
                {progress.last.paramset}
                {progress.last.ok ? '✔' : '✕'}
            </p>
        {/if}
    {/if}
    {#snippet buttons()}
        {#if cancelLabel !== undefined}
            <button type="button" class="hmm-button" onclick={() => oncancel?.()}>{cancelLabel}</button>
        {/if}
    {/snippet}
</Dialog>

<style>
    .hmm-progress {
        width: 100%;
    }

    .hmm-progress-line {
        margin: 0 0 6px;
    }

    .hmm-progress-last {
        margin: 6px 0 0;
        color: var(--hmm-fg-muted);
    }
</style>
