<script lang="ts">
    interface Props {
        /** Where the icon goes. One URL, and main's allow-list holds the same one. */
        href: string;
        /** The accessible name; there is no visible text, only the mark. */
        label: string;
        /**
         * Hands the URL to the host, and says whether the host took it. `false` - no host, or a
         * preload that predates the command - lets the browser follow the link itself.
         */
        openExternal?: ((url: string) => Promise<boolean>) | undefined;
        testId?: string | undefined;
    }

    let {href, label, openExternal = undefined, testId = undefined}: Props = $props();

    /**
     * A real link, even in Electron.
     *
     * The browser case is the plain one the roadmap asks for - `target="_blank"` with
     * `rel="noopener noreferrer"`, so the new tab gets no handle on this one. In Electron the click
     * is answered by the host bridge instead and the default is prevented, because a renderer that
     * opened a window itself would be a window nobody wanted; the anchor stays an anchor so that
     * the middle button, the context menu and a screen reader all still see a link.
     */
    function open(event: MouseEvent): void {
        if (!openExternal || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
            return;
        }
        event.preventDefault();
        void openExternal(href).then((handled) => {
            if (!handled) {
                window.open(href, '_blank', 'noopener,noreferrer');
            }
        });
    }
</script>

<a
    class="hmm-github"
    {href}
    target="_blank"
    rel="noopener noreferrer"
    title={label}
    aria-label={label}
    data-testid={testId}
    onclick={open}
>
    <!--
        The GitHub mark, inline and monochrome: it takes its colour from the header's own tokens
        like every other control up there (D-22, both themes), and an inline path needs no network
        and no CSP exception. 16 px, the size of the icons beside it.
    -->
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
               0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
               1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
               0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27
               2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82
               2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0
               .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
    </svg>
</a>

<style>
    /* The same box and the same hover as `ToolbarButton`, so the header's controls line up. */
    .hmm-github {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border: 1px solid transparent;
        border-radius: var(--hmm-radius);
        color: var(--hmm-fg-muted);
    }

    .hmm-github:hover {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }
</style>
