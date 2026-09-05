<script lang="ts">
    import type {Snippet} from 'svelte';

    interface Props {
        open?: boolean;
        title?: string;
        /** Modal by default, as every jQuery UI dialog of 2.7 was. */
        modal?: boolean;
        width?: string;
        /** ESC and the close button close the dialog. Off for a dialog that must be answered. */
        closable?: boolean;
        onclose?: (() => void) | undefined;
        children?: Snippet | undefined;
        /** The button row at the bottom right. */
        buttons?: Snippet | undefined;
        closeLabel?: string;
        testId?: string | undefined;
    }

    let {
        open = $bindable(false),
        title = '',
        modal = true,
        width = '640px',
        closable = true,
        onclose = undefined,
        children = undefined,
        buttons = undefined,
        closeLabel = 'Close',
        testId = undefined,
    }: Props = $props();

    let element = $state<HTMLDialogElement | undefined>(undefined);
    let previouslyFocused: HTMLElement | undefined;

    /**
     * Native `<dialog>` instead of jQuery UI.
     *
     * 2.7 stacked its dialogs by hand and jQuery UI's `_focusTabbable` then walked into a dialog
     * that was already gone - opening a paramset dialog out of the link dialog could throw and
     * leave the app with a modal overlay and no dialog under it (#77 and friends). `showModal()`
     * maintains the browser's own top layer, so two dialogs stack correctly, ESC is handled by the
     * platform, and focus is restored by this component to whatever had it before.
     */
    $effect(() => {
        const dialog = element;
        if (!dialog) {
            return;
        }
        if (open && !dialog.open) {
            previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
            if (modal) {
                dialog.showModal();
            } else {
                dialog.show();
            }
        } else if (!open && dialog.open) {
            dialog.close();
        }
    });

    function close(): void {
        open = false;
        onclose?.();
        previouslyFocused?.focus();
        previouslyFocused = undefined;
    }

    function onCancel(event: Event): void {
        // ESC. A dialog that is not closable stays open, which is what the 2.x "RPC execution"
        // dialog did while a call was running.
        event.preventDefault();
        if (closable) {
            close();
        }
    }
</script>

<dialog
    bind:this={element}
    class="hmm-dialog"
    style:width
    data-testid={testId}
    aria-label={title === '' ? undefined : title}
    oncancel={onCancel}
    onclose={() => {
        if (open) {
            close();
        }
    }}
>
    <div class="hmm-dialog-titlebar">
        <span class="hmm-dialog-title">{title}</span>
        {#if closable}
            <button type="button" class="hmm-dialog-close" aria-label={closeLabel} onclick={close}>✕</button>
        {/if}
    </div>
    <div class="hmm-dialog-body">
        {#if children}{@render children()}{/if}
    </div>
    {#if buttons}
        <div class="hmm-dialog-buttons">{@render buttons()}</div>
    {/if}
</dialog>

<style>
    .hmm-dialog {
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        padding: 0;
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        color: var(--hmm-fg);
        font-family: var(--hmm-font);
        font-size: var(--hmm-font-size);
    }

    .hmm-dialog::backdrop {
        background: var(--hmm-backdrop);
    }

    .hmm-dialog-titlebar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-dialog-title {
        font-weight: bold;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-dialog-close {
        border: 1px solid transparent;
        border-radius: var(--hmm-radius);
        background: none;
        cursor: pointer;
        line-height: 1;
        padding: 2px 6px;
    }

    .hmm-dialog-close:hover {
        border-color: var(--hmm-border);
        background: var(--hmm-accent-bg);
    }

    .hmm-dialog-body {
        padding: 10px;
        overflow: auto;
        max-height: calc(100vh - 140px);
    }

    .hmm-dialog-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        padding: 6px 10px;
        border-top: 1px solid var(--hmm-border-muted);
        background: var(--hmm-bg-sunken);
    }
</style>
