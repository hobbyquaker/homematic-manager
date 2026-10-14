<script lang="ts" module>
    import type {ServiceMarkIcon} from '../util/deviceGrid.js';

    /**
     * Task 92: the icons of the service-message badges. The 24x24 line paths of openccu-lite's shell
     * (occulited's `Icon.svelte`, D-21's shared look; its circles and rectangles written as paths),
     * copied rather than shared: the two UIs build
     * apart, and these eight are all the device table needs. Stroke only, `currentColor`, round joins.
     */
    const PATHS: Readonly<Record<ServiceMarkIcon, readonly string[]>> = {
        // a broken link: communication disturbed
        unlink: ['M9 17H7a5 5 0 0 1 0-10h2', 'M15 7h2a5 5 0 0 1 4 8', 'M8 12h3', 'M3 3l18 18'],
        // a clock turned back: it was disturbed
        history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
        battery: ['M4 7h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z', 'M22 10v4', 'M5 10v4'],
        alert: ['M12 4l9 16H3l9-16z', 'M12 10v4M12 17.2h.01'],
        shield: ['M12 3l7 3v5.5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6z'],
        'x-circle': ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6'],
        settings: [
            'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
            'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
        ],
        'arrow-up': ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 16V8', 'M8.5 11.5L12 8l3.5 3.5'],
    };
</script>

<script lang="ts">
    import type {ServiceMark} from '../util/deviceGrid.js';

    interface Props {
        mark: ServiceMark;
        /** The tooltip: the message's name, the channel, and what it means where that needs saying. */
        title: string;
        /** The message's name for a screen reader. */
        label: string;
    }

    let {mark, title, label}: Props = $props();
</script>

<!-- One badge of one size for every message (task 92): a circle with the icon in the tone's colour.
     UNREACH is filled - the device is away now - and STICKY_UNREACH only outlined in grey: it was. -->
<span
    class="hmm-service-badge hmm-service-badge-{mark.tone}"
    class:hmm-service-badge-solid={mark.datapoint === 'UNREACH'}
    data-datapoint={mark.datapoint}
    data-tone={mark.tone}
    {title}
    aria-label={label}
    role="img"
>
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
        {#each PATHS[mark.icon] as d (d)}
            <path {d} />
        {/each}
    </svg>
</span>

<style>
    .hmm-service-badge {
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
        vertical-align: middle;
    }

    .hmm-service-badge-red {
        color: var(--hmm-error);
    }

    .hmm-service-badge-orange {
        color: var(--hmm-warn);
    }

    .hmm-service-badge-blue {
        color: var(--hmm-accent);
    }

    .hmm-service-badge-grey {
        color: var(--hmm-fg-muted);
        background: transparent;
    }

    /* the device is unreachable now: the one badge that is filled, its icon in the page's colour */
    .hmm-service-badge-solid {
        background: var(--hmm-error);
        border-color: var(--hmm-error);
    }

    .hmm-service-badge-solid svg {
        color: var(--hmm-bg);
    }
</style>
