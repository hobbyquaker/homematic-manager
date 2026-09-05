<script lang="ts">
    import {VISIBLE_NOTICES, type Notice} from '../stores/NoticesStore.svelte.js';

    interface Props {
        /** Every notice the store holds, oldest first. */
        notices: Notice[];
        ondismiss?: ((id: number) => void) | undefined;
        dismissLabel?: string;
        /** How many are drawn before the rest collapse into the counter. */
        visibleCount?: number;
        /** `(n) => '3 more'`; the caller formats it, so plurals stay with the translator. */
        moreLabel?: (count: number) => string;
        lessLabel?: string;
        testId?: string | undefined;
    }

    let {
        notices,
        ondismiss = undefined,
        dismissLabel = 'Dismiss',
        visibleCount = VISIBLE_NOTICES,
        moreLabel = (count: number) => `${count} more`,
        lessLabel = 'Show fewer',
        testId = undefined,
    }: Props = $props();

    let expanded = $state(false);

    const hidden = $derived(Math.max(0, notices.length - visibleCount));
    const shown = $derived(expanded ? notices : notices.slice(notices.length - Math.min(notices.length, visibleCount)));

    // Nothing left to expand: fold the stack back rather than leaving an empty toggle behind.
    $effect(() => {
        if (hidden === 0 && expanded) {
            expanded = false;
        }
    });
</script>

<!--
    The toasts that replace 2.x's `dialogAlert()`. That one was modal and closed every other dialog
    on the way in, so an error while a paramset dialog was open threw the edit away (#77).

    D-34: at most `visibleCount` of them are on screen. The older ones are not thrown away - an
    error never expires and must not be able to disappear behind five status messages - they
    collapse into a counter that opens the whole stack.
-->
<div class="hmm-notices" role="log" aria-live="polite" data-testid={testId}>
    {#if hidden > 0}
        <button
            type="button"
            class="hmm-notices-more"
            data-testid={testId === undefined ? undefined : `${testId}-more`}
            aria-expanded={expanded}
            onclick={() => (expanded = !expanded)}
        >
            {expanded ? lessLabel : moreLabel(hidden)}
        </button>
    {/if}
    {#each shown as notice (notice.id)}
        <div
            class="hmm-notice"
            class:hmm-notice-warn={notice.level === 'warn'}
            class:hmm-notice-error={notice.level === 'error'}
        >
            <span class="hmm-notice-text">
                {#if notice.interfaceName !== undefined}<strong>{notice.interfaceName}</strong>{/if}
                {notice.message}
            </span>
            <button
                type="button"
                class="hmm-notice-close"
                aria-label={dismissLabel}
                onclick={() => ondismiss?.(notice.id)}>✕</button
            >
        </div>
    {/each}
</div>

<style>
    .hmm-notices {
        position: fixed;
        right: 10px;
        bottom: 10px;
        z-index: 400;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        max-width: 460px;
        /* An expanded stack must not grow past the window; the oldest scroll out of reach instead. */
        max-height: calc(100vh - 20px);
        overflow-y: auto;
    }

    .hmm-notices-more {
        align-self: flex-end;
        padding: 2px 8px;
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        color: var(--hmm-fg-muted);
        font: inherit;
        font-size: var(--hmm-font-size-small);
        cursor: pointer;
    }

    .hmm-notice {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        padding: 6px 8px;
        border: 1px solid var(--hmm-border-strong);
        border-left-width: 4px;
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        box-shadow: var(--hmm-shadow-toast);
    }

    .hmm-notice-warn {
        border-left-color: var(--hmm-warn);
    }

    .hmm-notice-error {
        border-left-color: var(--hmm-error);
    }

    .hmm-notice-text {
        flex: 1 1 auto;
        overflow-wrap: anywhere;
    }

    .hmm-notice-close {
        border: none;
        background: none;
        cursor: pointer;
        line-height: 1;
        padding: 0 2px;
    }
</style>
