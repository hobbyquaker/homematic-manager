<script lang="ts">
    import type {WriteLogEntry} from '@homematic-manager/core';

    import type {PendingWrite} from '../stores/WriteLogStore.svelte.js';
    import {formatDuration, formatParams, formatRpcValue, formatTime} from '../util/format.js';

    interface Props {
        open?: boolean;
        entries: WriteLogEntry[];
        pending?: PendingWrite[];
        title?: string;
        emptyText?: string;
        pendingText?: string;
        clearLabel?: string;
        closeLabel?: string;
        onclear?: (() => void) | undefined;
        testId?: string | undefined;
    }

    let {
        open = $bindable(false),
        entries,
        pending = [],
        title = 'RPC log',
        emptyText = 'No RPC calls yet',
        pendingText = 'in progress',
        clearLabel = 'Clear',
        closeLabel = 'Close',
        onclear = undefined,
        testId = undefined,
    }: Props = $props();
</script>

<!--
    The drawer that replaces the modal `dialog-rpc` of 2.7.

    That dialog blocked the whole window for every single RPC call, queued the next call behind
    itself (`rpcDialogShift`) and, on a fault, left a modal the user had to dismiss before they
    could look at anything. The same information - method, parameters, result or fault, duration -
    is here, non-modal, and it can stay open while work continues. Bulk writes report progress
    separately (RpcProgress), which is the only case that still deserves a modal.
-->
{#if open}
    <aside class="hmm-rpclog" aria-label={title} data-testid={testId}>
        <header class="hmm-rpclog-head">
            <strong class="hmm-rpclog-title">{title}</strong>
            <button type="button" class="hmm-button" onclick={() => onclear?.()}>{clearLabel}</button>
            <button type="button" class="hmm-rpclog-close" aria-label={closeLabel} onclick={() => (open = false)}
                >✕</button
            >
        </header>
        <ol class="hmm-rpclog-list">
            {#each pending as write (write.id)}
                <li class="hmm-rpclog-entry hmm-rpclog-pending">
                    <span class="hmm-rpclog-spinner" aria-hidden="true"></span>
                    <span class="hmm-rpclog-method hmm-mono">{write.interfaceName} {write.method}</span>
                    <span class="hmm-rpclog-params hmm-mono">{formatParams(write.params)}</span>
                    <span class="hmm-rpclog-status">{pendingText}</span>
                </li>
            {/each}
            {#each entries as entry (entry.id)}
                <li class="hmm-rpclog-entry" class:hmm-rpclog-failed={!entry.ok}>
                    <span class="hmm-rpclog-time">{formatTime(entry.timestamp)}</span>
                    <span class="hmm-rpclog-method hmm-mono">{entry.interfaceName} {entry.method}</span>
                    <span class="hmm-rpclog-params hmm-mono">{formatParams(entry.params)}</span>
                    <span class="hmm-rpclog-status">
                        {#if entry.ok}
                            {formatRpcValue(entry.result)}
                        {:else}
                            {entry.error ?? ''}
                        {/if}
                    </span>
                    <span class="hmm-rpclog-duration">{formatDuration(entry.durationMs)}</span>
                </li>
            {/each}
            {#if entries.length === 0 && pending.length === 0}
                <li class="hmm-rpclog-empty">{emptyText}</li>
            {/if}
        </ol>
    </aside>
{/if}

<style>
    .hmm-rpclog {
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-height: 240px;
        border-top: 1px solid var(--hmm-border-strong);
        background: var(--hmm-bg-sunken);
    }

    .hmm-rpclog-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-rpclog-title {
        flex: 1 1 auto;
    }

    .hmm-rpclog-close {
        border: none;
        background: none;
        cursor: pointer;
        line-height: 1;
        padding: 0 4px;
    }

    .hmm-rpclog-list {
        list-style: none;
        margin: 0;
        padding: 0;
        overflow: auto;
    }

    .hmm-rpclog-entry {
        display: grid;
        grid-template-columns: 70px 220px 1fr 200px 70px;
        gap: 6px;
        align-items: center;
        padding: 1px 6px;
        border-bottom: 1px solid var(--hmm-border-muted);
        white-space: nowrap;
    }

    .hmm-rpclog-pending {
        grid-template-columns: 70px 220px 1fr 270px;
        color: var(--hmm-fg-muted);
    }

    .hmm-rpclog-failed .hmm-rpclog-status {
        color: var(--hmm-error);
        font-weight: bold;
    }

    .hmm-rpclog-params,
    .hmm-rpclog-status,
    .hmm-rpclog-method {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-rpclog-time,
    .hmm-rpclog-duration {
        color: var(--hmm-fg-muted);
    }

    .hmm-rpclog-spinner {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-left: 4px;
        border: 2px solid var(--hmm-border);
        border-top-color: var(--hmm-accent);
        border-radius: 50%;
        animation: hmm-rpclog-spin 800ms linear infinite;
    }

    .hmm-rpclog-empty {
        padding: 6px;
        color: var(--hmm-fg-muted);
    }

    @keyframes hmm-rpclog-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
