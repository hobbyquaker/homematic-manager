<script lang="ts">
    import type {ThemeChoice} from '../stores/AppStore.svelte.js';

    interface Props {
        theme?: ThemeChoice;
        /** `t('Theme: light')` etc.; the caller translates. */
        labelFor?: ((theme: ThemeChoice) => string) | undefined;
        onclick?: (() => void) | undefined;
        testId?: string | undefined;
    }

    let {theme = 'system', labelFor = undefined, onclick = undefined, testId = undefined}: Props = $props();

    const ICONS: Record<ThemeChoice, string> = {system: '◐', light: '☀', dark: '☾'};
    const label = $derived(labelFor?.(theme) ?? `Theme: ${theme}`);
</script>

<button
    type="button"
    class="hmm-theme-switch"
    aria-label={label}
    title={label}
    data-testid={testId}
    onclick={() => onclick?.()}
>
    <span aria-hidden="true">{ICONS[theme]}</span>
</button>

<style>
    .hmm-theme-switch {
        width: 26px;
        height: 24px;
        padding: 0;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        cursor: pointer;
        line-height: 1;
    }

    .hmm-theme-switch:hover {
        border-color: var(--hmm-border-strong);
        background: var(--hmm-accent-bg);
    }
</style>
