<script lang="ts">
    import type {HostUpdateState} from '../host/types.js';
    import {followExternalLink, type OpenExternal} from '../util/externalLink.js';
    import {fullUpdateReason, shortUpdateReason} from '../util/updateReason.js';

    interface Props {
        state?: HostUpdateState | undefined;
        labels: {
            available: string;
            downloading: string;
            downloaded: string;
            installOnQuit: string;
            download: string;
            install: string;
            dismiss: string;
            /** B-47: the `error` phase, by the step that failed. */
            checkFailed: string;
            downloadFailed: string;
            failed: string;
            /** The link to {@link Props.releasesUrl}. */
            releases: string;
        };
        /** Where a failed check or download sends the user; no link without it. */
        releasesUrl?: string | undefined;
        /** Opens the link through the host (Electron); without it the browser follows the link. */
        openExternal?: OpenExternal | undefined;
        ondownload: () => void;
        oninstall: () => void;
        ondismiss: () => void;
        testId?: string | undefined;
    }

    let {
        state = undefined,
        labels,
        releasesUrl = undefined,
        openExternal = undefined,
        ondownload,
        oninstall,
        ondismiss,
        testId = undefined,
    }: Props = $props();

    const text = $derived.by(() => {
        if (!state) {
            return '';
        }
        switch (state.phase) {
            case 'available':
                return labels.available;
            case 'downloading':
                return `${labels.downloading} ${state.percent === undefined ? '' : `${String(Math.round(state.percent))} %`}`;
            case 'downloaded':
                return labels.downloaded;
            case 'installOnQuit':
                return labels.installOnQuit;
            case 'error':
                return state.failed === 'check'
                    ? labels.checkFailed
                    : state.failed === 'download'
                      ? labels.downloadFailed
                      : labels.failed;
            default:
                return '';
        }
    });

    const failed = $derived(state?.phase === 'error');
    const reason = $derived(failed ? shortUpdateReason(state?.message) : '');
</script>

<!--
    D-16: the updater never downloads and never installs without the user. The notice is a strip
    under the header rather than a modal, so it cannot interrupt anything, and it disappears for
    good once it is dismissed for that version. Without a host bridge (apps/web, the CCU addon,
    demo mode) `state` is undefined and nothing is drawn at all.

    B-47 (#163): a failed check or download says so here, with the reason and the way to the
    release list, instead of taking the strip away without a word.
-->
{#if state && text !== ''}
    <div
        class="hmm-update"
        class:hmm-update-failed={failed}
        role={failed ? 'alert' : 'status'}
        data-testid={testId}
        data-phase={state.phase}
    >
        {#if failed}
            <span class="hmm-update-text" title={fullUpdateReason(state.message) || undefined}
                >{text}{state.version === undefined ? '' : ` (${state.version})`}{#if reason !== ''}:
                    <span data-testid="update-error-reason">{reason}</span>{/if}</span
            >
            {#if releasesUrl}
                <a
                    class="hmm-update-link"
                    href={releasesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="update-releases"
                    onclick={(event) => followExternalLink(event, releasesUrl, openExternal)}>{labels.releases}</a
                >
            {/if}
        {:else}
            <span class="hmm-update-text">{text}{state.version === undefined ? '' : ` ${state.version}`}</span>
        {/if}
        {#if state.phase === 'available'}
            <button type="button" class="hmm-button" data-testid="update-download" onclick={() => ondownload()}
                >{labels.download}</button
            >
        {:else if state.phase === 'downloaded'}
            <button type="button" class="hmm-button" data-testid="update-install" onclick={() => oninstall()}
                >{labels.install}</button
            >
        {/if}
        <button type="button" class="hmm-button" data-testid="update-dismiss" onclick={() => ondismiss()}
            >{labels.dismiss}</button
        >
    </div>
{/if}

<style>
    .hmm-update {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        background: var(--hmm-accent-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    /* The error colour as a bar, not as the text's: the text keeps the strip's contrast in both themes. */
    .hmm-update-failed {
        border-left: 4px solid var(--hmm-error);
        padding-left: 4px;
    }

    .hmm-update-text {
        flex: 1 1 auto;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .hmm-update-link {
        color: inherit;
        text-decoration: underline;
        white-space: nowrap;
    }
</style>
