<script lang="ts">
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import {getStores} from '../lib/stores/context.js';

    const stores = getStores();
    const t = stores.i18n.t;
    const todo = $derived(t('Comes with task 8'));
</script>

<!--
    The 2.7 console layout, with its controls in place and inert.

    Task 8 fills it: the 51-method catalogue from core, generated argument forms including structs
    for putParamset (#27, #136), a history and the raw response. Everything it sends is a write, so
    it goes through the same write log the RPC drawer shows.
-->
<div class="hmm-page">
    <Toolbar label={t('RPC Console')}>
        <ToolbarButton title={t('Send request')} icon="▸" disabled reason={todo} />
    </Toolbar>

    <div class="hmm-console-top">
        <select class="hmm-select hmm-console-method" aria-label={t('Please select method')} disabled>
            <option>{t('Please select method')}</option>
        </select>
        <input class="hmm-input hmm-console-params" aria-label={t('Parameters')} disabled />
        <button type="button" class="hmm-button" disabled>{t('Send request')}</button>
    </div>

    <div class="hmm-console-columns">
        <section class="hmm-console-panel">
            <h3>{t('Parameters')}</h3>
            <p class="hmm-placeholder">{todo}</p>
        </section>
        <section class="hmm-console-panel">
            <h3>{t('Response')}</h3>
            <textarea class="hmm-console-response" aria-label={t('Response')} disabled></textarea>
        </section>
    </div>
</div>

<style>
    .hmm-page {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
    }

    .hmm-console-top {
        display: flex;
        gap: 6px;
        align-items: center;
    }

    .hmm-console-method {
        width: 235px;
    }

    .hmm-console-params {
        flex: 1 1 auto;
    }

    .hmm-console-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        flex: 1 1 auto;
        min-height: 0;
    }

    .hmm-console-panel h3 {
        margin: 0 0 6px;
        font-size: var(--hmm-font-size);
    }

    .hmm-console-response {
        width: 100%;
        height: 250px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg-sunken);
        font-family: var(--hmm-font-mono);
    }

    .hmm-placeholder {
        margin: 0;
        padding: 6px;
        border: 1px dashed var(--hmm-border);
        border-radius: var(--hmm-radius);
        color: var(--hmm-fg-muted);
    }
</style>
