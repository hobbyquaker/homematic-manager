<script lang="ts">
    interface Props {
        /** The tooltip. */
        title: string;
        /** The name for a screen reader. */
        label: string;
        testId?: string | undefined;
    }

    let {title, label, testId = undefined}: Props = $props();

    /**
     * Task 97: a router - a box with two waves above its antenna, in the 24x24 line style of the
     * service badges (task 92, occulited's shell icons). Stroke only, `currentColor`.
     */
    const PATHS = [
        'M4 14h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z',
        'M6 17h.01M10 17h.01',
        'M15 10v4',
        'M17.8 7.2a4 4 0 0 0-5.6 0',
        'M20.7 4.3a8 8 0 0 0-11.4 0',
    ];
</script>

<!-- The badge of task 92 in the accent colour: one size, a circle, outlined. -->
<span class="hmm-router-badge" {title} aria-label={label} role="img" data-testid={testId}>
    <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        {#each PATHS as d (d)}
            <path {d} />
        {/each}
    </svg>
</span>

<style>
    .hmm-router-badge {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 20px;
        height: 20px;
        border: 1px solid currentColor;
        border-radius: 50%;
        background: color-mix(in srgb, currentColor 14%, transparent);
        color: var(--hmm-accent);
        vertical-align: middle;
    }
</style>
