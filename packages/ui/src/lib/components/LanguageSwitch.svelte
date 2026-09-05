<script lang="ts">
    import type {Language} from '@homematic-manager/core';

    import {LANGUAGE_LABELS, UI_LANGUAGES} from '../i18n/i18n.svelte.js';

    interface Props {
        language?: Language;
        label?: string;
        onchange?: ((language: Language) => void) | undefined;
        testId?: string | undefined;
    }

    let {language = $bindable('de'), label = 'Language', onchange = undefined, testId = undefined}: Props = $props();
</script>

<select
    class="hmm-select hmm-language"
    aria-label={label}
    title={label}
    data-testid={testId}
    value={language}
    onchange={(event) => {
        language = event.currentTarget.value as Language;
        onchange?.(language);
    }}
>
    {#each UI_LANGUAGES as candidate (candidate)}
        <option value={candidate}>{LANGUAGE_LABELS[candidate]}</option>
    {/each}
</select>

<style>
    .hmm-language {
        width: 96px;
    }
</style>
