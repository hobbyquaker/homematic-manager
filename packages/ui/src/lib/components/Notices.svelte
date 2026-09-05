<script lang="ts">
    import type {Notice} from '../stores/NoticesStore.svelte.js';

    interface Props {
        notices: Notice[];
        ondismiss?: ((id: number) => void) | undefined;
        dismissLabel?: string;
        testId?: string | undefined;
    }

    let {notices, ondismiss = undefined, dismissLabel = 'Dismiss', testId = undefined}: Props = $props();
</script>

<!--
    The toasts that replace 2.x's `dialogAlert()`. That one was modal and closed every other dialog
    on the way in, so an error while a paramset dialog was open threw the edit away (#77).
-->
<div class="hmm-notices" role="log" aria-live="polite" data-testid={testId}>
    {#each notices as notice (notice.id)}
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
        gap: 6px;
        max-width: 460px;
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
        box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
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
