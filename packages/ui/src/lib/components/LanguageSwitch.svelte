<script lang="ts">
    import type {LanguageChoice} from '@homematic-manager/core';

    import {LANGUAGE_LABELS, UI_LANGUAGES} from '../i18n/i18n.svelte.js';

    interface Props {
        /** The stored choice, not the resolved language: `auto` is one of the entries. */
        language?: LanguageChoice;
        label?: string;
        /** The first entry - "Browser language", or whatever the caller's catalogue calls it. */
        autoLabel?: string;
        onchange?: ((language: LanguageChoice) => void) | undefined;
        testId?: string | undefined;
    }

    let {
        language = $bindable('auto'),
        label = 'Language',
        autoLabel = 'Browser language',
        onchange = undefined,
        testId = undefined,
    }: Props = $props();
</script>

<!--
    D-36, task 22: this used to sit in the header, next to the theme switch, where it was one of
    the two controls a user touches once and never again. It lives in the settings dialog now, and
    the entry above the languages is the default - the browser's own order, with English behind it -
    so "I never chose" and "I chose German" stay two different answers.
-->
<select
    class="hmm-select hmm-language"
    aria-label={label}
    title={label}
    data-testid={testId}
    value={language}
    onchange={(event) => {
        language = event.currentTarget.value as LanguageChoice;
        onchange?.(language);
    }}
>
    <option value="auto">{autoLabel}</option>
    {#each UI_LANGUAGES as candidate (candidate)}
        <option value={candidate}>{LANGUAGE_LABELS[candidate]}</option>
    {/each}
</select>

<style>
    /*
        No width of its own any more: in the settings dialog it is one of the rows, and every other
        control there fills the row's `minmax(0, 1fr)` track (task 21's overflow).
    */
    .hmm-language {
        min-width: 0;
    }
</style>
