<script lang="ts">
    import {onDestroy} from 'svelte';

    import type {CreateQrReader, QrReader} from './qrReader.js';

    interface Props {
        /** Off by default; the camera is only opened when the user asks for it. */
        active?: boolean;
        onscan: (text: string) => void;
        onerror?: ((message: string) => void) | undefined;
        /**
         * Injected by the tests: a reader that yields decoded texts. Without it the component
         * loads `@zxing/browser` the first time it is switched on.
         */
        createReader?: CreateQrReader | undefined;
        testId?: string | undefined;
    }

    let {active = false, onscan, onerror = undefined, createReader = undefined, testId = undefined}: Props = $props();

    let video = $state<HTMLVideoElement | undefined>(undefined);
    let controls: {stop(): void} | undefined;

    /**
     * Issue #112: 2.x embedded the scanner unconditionally and had it running whenever the dialog
     * was open. The camera is a permission prompt and a battery drain, so it is started on request
     * and stopped the moment the switch goes off, the dialog closes or the component is destroyed.
     */
    $effect(() => {
        if (!active) {
            stop();
            return;
        }
        const element = video;
        if (!element) {
            return;
        }
        // An object and not a `let`: TypeScript's control flow analysis does not follow a local
        // variable that a callback assigns, so `if (cancelled)` below would read as always false.
        const run = {cancelled: false};
        void (async () => {
            try {
                const reader = createReader ? await createReader() : await defaultReader();
                const started = await reader.decodeFromVideoDevice(undefined, element, (result) => {
                    if (result) {
                        onscan(result.getText());
                    }
                });
                if (run.cancelled) {
                    started.stop();
                } else {
                    controls = started;
                }
            } catch (error) {
                onerror?.(error instanceof Error ? error.message : String(error));
            }
        })();
        return () => {
            run.cancelled = true;
            stop();
        };
    });

    /** Loaded lazily, so a page that never scans never pays for the decoder. */
    async function defaultReader(): Promise<QrReader> {
        const {BrowserQRCodeReader} = await import('@zxing/browser');
        return new BrowserQRCodeReader() as unknown as QrReader;
    }

    function stop(): void {
        controls?.stop();
        controls = undefined;
    }

    onDestroy(stop);
</script>

{#if active}
    <video bind:this={video} class="hmm-qr" data-testid={testId} autoplay muted playsinline></video>
{/if}

<style>
    .hmm-qr {
        width: 100%;
        max-height: 240px;
        background: var(--hmm-bg-sunken);
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
    }
</style>
