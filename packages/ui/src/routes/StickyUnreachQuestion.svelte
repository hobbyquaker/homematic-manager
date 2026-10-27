<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import {getStores} from '../lib/stores/context.js';

    interface Props {
        open?: boolean;
        /** How many `STICKY_UNREACH` messages the question is about; never 0 - then nobody asks. */
        count: number;
        /** "Acknowledge existing": the listed messages are acknowledged when the settings are saved. */
        onacknowledge: () => void;
        /** "Only new ones": what the option always did - nothing is written for these. */
        onlynew: () => void;
        /** Closed without an answer (ESC or the close button): the switch goes back off. */
        oncancel: () => void;
    }

    let {open = $bindable(false), count, onacknowledge, onlynew, oncancel}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    function answer(choice: () => void): void {
        open = false;
        choice();
    }
</script>

<!--
    Task 34 (#147, D-42). The auto-acknowledge hangs on the edge of a STICKY_UNREACH, so a message
    that was in the list before the option was switched on - the reporter's case, his messages were
    older than his first connection - stayed there for good. Whether those go too is the user's
    call, because acknowledging is a write and the list is what shows which devices were away; so
    this asks, once, when the switch goes on with such messages present, and says what is lost and
    where it is kept. The app's own dialog, stacked over the settings (never `window.confirm`).
-->
<Dialog
    bind:open
    title={t('Acknowledge the messages already in the list?')}
    width="480px"
    onclose={oncancel}
    testId="auto-ack-question"
>
    <p class="hmm-autoack-question" data-testid="auto-ack-question-text">
        {t(
            '{count} STICKY_UNREACH messages are already listed. New ones are acknowledged automatically from now on.',
            {},
            count,
        )}
    </p>
    <p class="hmm-autoack-help">
        {t(
            'Each acknowledgement is a write to the device. Afterwards the list no longer shows which devices were away; the unreach counter in the RSSI tab keeps that.',
        )}
    </p>

    {#snippet buttons()}
        <button type="button" class="hmm-button" data-testid="auto-ack-only-new" onclick={() => answer(onlynew)}
            >{t('Only new ones')}</button
        >
        <button type="button" class="hmm-button" data-testid="auto-ack-existing" onclick={() => answer(onacknowledge)}
            >{t('Acknowledge existing')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-autoack-question {
        margin: 0 0 8px;
        font-weight: 600;
    }

    .hmm-autoack-help {
        margin: 0;
        color: var(--hmm-fg-muted);
    }
</style>
