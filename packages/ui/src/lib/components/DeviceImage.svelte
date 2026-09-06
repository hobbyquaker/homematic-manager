<script lang="ts">
    interface Props {
        /** `HmIP-BSM`, `HM-LC-Sw1-Pl-CT-R1`, ... - empty for a channel row. */
        deviceType?: string;
        /** `hmm-image://device/<TYPE>` from the host bridge, or `undefined` in a plain browser. */
        src?: string | undefined;
        size?: number;
        title?: string | undefined;
        testId?: string | undefined;
    }

    let {deviceType = '', src = undefined, size = 16, title = undefined, testId = undefined}: Props = $props();

    /** The image failed to load - a type the CCU has no picture for, or no cache yet (D-10). */
    let broken = $state(false);

    $effect(() => {
        void src;
        broken = false;
    });

    const showImage = $derived(src !== undefined && src !== '' && !broken);
    /** Two letters of the type, so the placeholder still tells devices apart at 16 px. */
    const initials = $derived(
        deviceType
            .replace(/^(HmIPW?|HM|HMW)-/i, '')
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 2)
            .toUpperCase(),
    );
</script>

<!--
    D-10: the picture comes from the connected CCU through the host's `hmm-image://` protocol in
    Electron, or through the web host's `images/<type>` route on the addon and the server
    installs; both cache on disk and fall back to the bundled webp subset. Where neither answers
    (demo mode, a type the CCU has no picture for) the cell degrades to a labelled placeholder
    instead of a broken-image icon; 2.x's bundled 20 000-line `deviceImages.json` is not coming
    back.
-->
{#if showImage}
    <img
        class="hmm-device-image"
        {src}
        alt={deviceType}
        title={title ?? deviceType}
        width={size}
        height={size}
        data-testid={testId}
        onerror={() => (broken = true)}
    />
{:else}
    <span
        class="hmm-device-image hmm-device-image-fallback"
        title={title ?? deviceType}
        aria-label={deviceType === '' ? undefined : deviceType}
        role={deviceType === '' ? undefined : 'img'}
        data-testid={testId}
        style:width={`${size}px`}
        style:height={`${size}px`}
        style:font-size={`${Math.max(6, Math.round(size * 0.5))}px`}>{initials}</span
    >
{/if}

<style>
    .hmm-device-image {
        display: inline-block;
        vertical-align: middle;
        object-fit: contain;
    }

    .hmm-device-image-fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--hmm-border-muted);
        border-radius: 2px;
        background: var(--hmm-bg-sunken);
        color: var(--hmm-fg-faint);
        line-height: 1;
        overflow: hidden;
    }
</style>
