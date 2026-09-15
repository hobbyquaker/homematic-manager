<script lang="ts">
    import type {RssiBand} from '@homematic-manager/core';
    import {rssiBand} from '@homematic-manager/core';

    interface Props {
        /** dBm, or `undefined` where the interface reported 65536 ("not known"). */
        value?: number | undefined;
        /** The band's name in the UI language, for the tooltip; the English label without it. */
        labelOf?: (band: RssiBand) => string;
        testId?: string | undefined;
    }

    let {value = undefined, labelOf = (band: RssiBand) => band.label, testId = undefined}: Props = $props();

    const band = $derived(rssiBand(value));
    /** The unit is not in the pill, only in the column head - but a tooltip stands on its own. */
    const description = $derived(band === undefined ? undefined : `${String(value)} dBm · ${labelOf(band)}`);

    /** The four bars, weakest first. */
    const BARS = [1, 2, 3, 4] as const;
</script>

<!--
    #161, arrangement B: the value without its unit, then four signal bars, on the fill of one of
    the eight steps of core's `RSSI_BANDS`. The bars carry the step for someone who cannot tell the
    greens apart; bars and value are drawn in the step's ink, light or dark, never in a colour. The
    fill and the ink are theme tokens (`--hmm-rssi-<step>`, D-22), and a reading the interface does
    not know is a faint dash with neither.
-->
{#if band === undefined}
    <span class="hmm-rssi hmm-rssi-unknown" data-rssi="unknown" data-testid={testId}>—</span>
{:else}
    <span
        class="hmm-rssi hmm-rssi-{band.step}"
        role="img"
        title={description}
        aria-label={description}
        data-rssi={band.step}
        data-bars={band.bars}
        data-testid={testId}
        ><span class="hmm-rssi-value">{value}</span><span class="hmm-rssi-bars" aria-hidden="true"
            >{#each BARS as bar (bar)}<span class="hmm-rssi-bar" class:hmm-rssi-bar-off={bar > band.bars}
                ></span>{/each}</span
        ></span
    >
{/if}

<style>
    .hmm-rssi {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 5px;
        box-sizing: border-box;
        min-width: 56px;
        height: 18px;
        padding: 0 5px;
        border-radius: 2px;
        font-family: var(--hmm-font-mono);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        white-space: nowrap;
        vertical-align: middle;
    }

    .hmm-rssi-bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 1px;
        height: 11px;
    }

    .hmm-rssi-bar {
        display: block;
        width: 3px;
        border-radius: 0.5px;
        background: currentColor;
    }

    .hmm-rssi-bar:nth-child(1) {
        height: 4px;
    }

    .hmm-rssi-bar:nth-child(2) {
        height: 6px;
    }

    .hmm-rssi-bar:nth-child(3) {
        height: 8.5px;
    }

    .hmm-rssi-bar:nth-child(4) {
        height: 11px;
    }

    .hmm-rssi-bar-off {
        opacity: 0.28;
    }

    .hmm-rssi-1 {
        background: var(--hmm-rssi-1);
        color: var(--hmm-rssi-1-text);
    }

    .hmm-rssi-2 {
        background: var(--hmm-rssi-2);
        color: var(--hmm-rssi-2-text);
    }

    .hmm-rssi-3 {
        background: var(--hmm-rssi-3);
        color: var(--hmm-rssi-3-text);
    }

    .hmm-rssi-4 {
        background: var(--hmm-rssi-4);
        color: var(--hmm-rssi-4-text);
    }

    .hmm-rssi-5 {
        background: var(--hmm-rssi-5);
        color: var(--hmm-rssi-5-text);
    }

    .hmm-rssi-6 {
        background: var(--hmm-rssi-6);
        color: var(--hmm-rssi-6-text);
    }

    .hmm-rssi-7 {
        background: var(--hmm-rssi-7);
        color: var(--hmm-rssi-7-text);
    }

    .hmm-rssi-8 {
        background: var(--hmm-rssi-8);
        color: var(--hmm-rssi-8-text);
    }

    .hmm-rssi-unknown {
        color: var(--hmm-fg-faint);
    }
</style>
