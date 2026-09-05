<script lang="ts">
    import type {HostUpdateState} from '../host/types.js';

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
        };
        ondownload: () => void;
        oninstall: () => void;
        ondismiss: () => void;
        testId?: string | undefined;
    }

    let {state = undefined, labels, ondownload, oninstall, ondismiss, testId = undefined}: Props = $props();

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
            default:
                return '';
        }
    });
</script>

<!--
    D-16: the updater never downloads and never installs without the user. The notice is a strip
    under the header rather than a modal, so it cannot interrupt anything, and it disappears for
    good once it is dismissed for that version. Without a host bridge (apps/web, the CCU addon,
    demo mode) `state` is undefined and nothing is drawn at all.
-->
{#if state && text !== ''}
    <div class="hmm-update" role="status" data-testid={testId}>
        <span class="hmm-update-text">{text}{state.version === undefined ? '' : ` ${state.version}`}</span>
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

    .hmm-update-text {
        flex: 1 1 auto;
    }
</style>
