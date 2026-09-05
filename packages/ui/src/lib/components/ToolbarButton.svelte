<script lang="ts">
    interface Props {
        /** The tooltip and the accessible name; the 2.x buttons were icon-only with a title. */
        title: string;
        /** A single character standing in for the jQuery UI icon, until task 8 brings real icons. */
        icon?: string;
        disabled?: boolean;
        /** Why the button is disabled - shown in the tooltip so "greyed out" is never a mystery. */
        reason?: string | undefined;
        pressed?: boolean | undefined;
        onclick?: (() => void) | undefined;
        testId?: string | undefined;
    }

    let {
        title,
        icon = '•',
        disabled = false,
        reason = undefined,
        pressed = undefined,
        onclick = undefined,
        testId = undefined,
    }: Props = $props();
</script>

<button
    type="button"
    class="hmm-toolbar-button"
    class:hmm-toolbar-button-pressed={pressed === true}
    title={disabled && reason !== undefined ? `${title} — ${reason}` : title}
    aria-label={title}
    aria-pressed={pressed}
    data-testid={testId}
    {disabled}
    onclick={() => onclick?.()}
>
    <span aria-hidden="true">{icon}</span>
</button>

<style>
    /* The icon buttons of the she UI: no frame until the pointer is on them. */
    .hmm-toolbar-button {
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--hmm-radius);
        background: none;
        color: var(--hmm-fg-muted);
        cursor: pointer;
        line-height: 1;
    }

    .hmm-toolbar-button:hover:not(:disabled) {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }

    .hmm-toolbar-button:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .hmm-toolbar-button-pressed {
        background: var(--hmm-accent-bg);
        border-color: var(--hmm-accent);
        color: var(--hmm-fg);
    }
</style>
