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
        /**
         * What to report when the browser will not hand out a camera because the page is not a
         * secure context. Passed in translated; this component holds no strings.
         */
        insecureContextMessage?: string;
        testId?: string | undefined;
    }

    let {
        active = false,
        onscan,
        onerror = undefined,
        createReader = undefined,
        insecureContextMessage = 'The camera needs https or localhost.',
        testId = undefined,
    }: Props = $props();

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
        if (!cameraIsReachable()) {
            onerror?.(insecureContextMessage);
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

    /**
     * Will the browser even offer a camera?
     *
     * `navigator.mediaDevices` exists only in a secure context - https, `localhost` or a file URL.
     * The addon is reached as `http://<ccu>/addons/hmm/`, and an LXC or Docker install over plain
     * http is the same case, so on exactly the installs where scanning a HomematicIP sticker is
     * most useful the object is simply not there and `@zxing/browser` fails with something like
     * "Cannot read properties of undefined". Checking first turns that into a sentence that says
     * what to do; the SGTIN and key can always be typed in instead.
     */
    function cameraIsReachable(): boolean {
        // the DOM typings promise `mediaDevices` unconditionally; the browsers this is about do not
        const media = (globalThis.navigator as {mediaDevices?: MediaDevices} | undefined)?.mediaDevices;
        return media !== undefined && globalThis.isSecureContext;
    }

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
