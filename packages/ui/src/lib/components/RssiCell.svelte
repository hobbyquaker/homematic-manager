<script lang="ts">
    import {rssiClass} from '@homematic-manager/core';

    interface Props {
        /** dBm, or `undefined` where the interface reported 65536 ("not known"). */
        value?: number | undefined;
        testId?: string | undefined;
    }

    let {value = undefined, testId = undefined}: Props = $props();

    const level = $derived(rssiClass(value));
</script>

<!--
    The colour of an RSSI value carries its meaning, so it is a semantic class over a theme token
    rather than the inline `#rrgg00` gradient of 2.x (`rssiColor()`, homematic-manager.js:4649).
    The gradient looked the same in both themes, and in the dark one "good" was unreadable green on
    near-black. The four classes are the ones core's `rssiClass()` produces and they are asserted in
    both themes (D-22).
-->
<span
    class="hmm-rssi"
    class:hmm-rssi-good={level === 'good'}
    class:hmm-rssi-medium={level === 'medium'}
    class:hmm-rssi-bad={level === 'bad'}
    class:hmm-rssi-unknown={level === 'unknown'}
    data-rssi={level}
    data-testid={testId}>{value === undefined ? '—' : `${value} dBm`}</span
>

<style>
    .hmm-rssi {
        display: inline-block;
        min-width: 62px;
        padding: 0 4px;
        border-radius: 2px;
        text-align: right;
        font-family: var(--hmm-font-mono);
    }

    .hmm-rssi-good {
        background: var(--hmm-rssi-good);
        color: var(--hmm-rssi-text);
    }

    .hmm-rssi-medium {
        background: var(--hmm-rssi-medium);
        color: var(--hmm-rssi-text);
    }

    .hmm-rssi-bad {
        background: var(--hmm-rssi-bad);
        color: var(--hmm-rssi-text);
    }

    .hmm-rssi-unknown {
        color: var(--hmm-fg-faint);
    }
</style>
