<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import {getStores} from '../../lib/stores/context.js';
    import {
        startAutoCalibration,
        type CalibrationOutcome,
        type CalibrationRun,
        type MeasuredOutcome,
    } from '../../lib/util/blindAutoCalibration.js';

    interface Props {
        interfaceName: string;
        address: string;
        /**
         * `ENDPOSITION_AUTO_DETECT` is ticked in the dialog but the device does not hold it yet: the
         * row is there, as on the CCU, and the button waits for the write.
         */
        unsaved?: boolean;
        /**
         * A run finished: the device has measured the running times, and the dialog reads them until
         * they arrive (B-106). The row shows the run as reading meanwhile, and then how that ended.
         */
        onsuccess: () => Promise<MeasuredOutcome>;
    }

    let {interfaceName, address, unsaved = false, onsuccess}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let confirmOpen = $state(false);
    let run = $state.raw<CalibrationRun | undefined>(undefined);
    let stopping = $state(false);
    let outcome = $state<CalibrationOutcome | undefined>(undefined);
    /** After a successful run: reading the measured times (`reading`), then what the reading found. */
    let measured = $state<MeasuredOutcome | 'reading' | undefined>(undefined);
    /** Bumped by every start and by the dialog moving on, so a late reading of an old run is ignored. */
    let generation = 0;

    const reading = $derived(measured === 'reading');
    const running = $derived(run !== undefined);

    /**
     * The calls of the run, on this channel. A refused write is a notice and a "no" to the
     * sequence; a read raises none - hmipserver answers -5 for a result it does not know yet (#172),
     * which the sequence takes as "unknown". The result's event ends the run as soon as it arrives.
     */
    function rpc(target: {interfaceName: string; address: string}) {
        return {
            getValue: (parameter: string) =>
                stores.paramsets.getValue(target.interfaceName, target.address, parameter, {quiet: true}),
            setValue: (parameter: string, value: string) =>
                stores.paramsets.setValue(target.interfaceName, target.address, parameter, value),
            onEvent: (parameter: string, handler: (value: unknown) => void) =>
                stores.paramsets.onChannelEvent(target.interfaceName, target.address, (datapoint, value) => {
                    if (datapoint === parameter) {
                        handler(value);
                    }
                }),
        };
    }

    function start(): void {
        confirmOpen = false;
        if (run) {
            return;
        }
        outcome = undefined;
        measured = undefined;
        const mine = (generation += 1);
        const started = startAutoCalibration(rpc({interfaceName, address}));
        run = started;
        void started.done.then((result) => {
            if (run !== started) {
                return;
            }
            run = undefined;
            stopping = false;
            outcome = result;
            if (result === 'success') {
                measured = 'reading';
                void onsuccess().then((found) => {
                    if (generation === mine) {
                        measured = found;
                    }
                });
            }
        });
    }

    function stop(): void {
        if (!run || stopping) {
            return;
        }
        stopping = true;
        void run.stop();
    }

    // The dialog closed or moved to another channel: the waiting ends here, the device finishes
    // its run by itself - what leaving the page does on the CCU. Nothing is written.
    function abandon(): void {
        const current = run;
        run = undefined;
        generation += 1;
        measured = undefined;
        stopping = false;
        current?.abandon();
    }
    $effect(() => {
        void interfaceName;
        void address;
        return () => {
            abandon();
            outcome = undefined;
        };
    });

    const status = $derived.by(() => {
        if (running) {
            return stopping ? t('Stopping the calibration…') : t('Calibration running…');
        }
        if (unsaved) {
            return t('Write the change first: the device does not detect its end positions yet.');
        }
        switch (outcome) {
            case 'success':
                return measured === 'reading'
                    ? t('Calibration finished. Waiting for the device to report the measured running times…')
                    : measured === 'unchanged'
                      ? t('Calibration finished. The device still reports the previous running times.')
                      : t('Calibration finished. The measured running times were read from the device.');
            case 'stopped':
                return t('Calibration stopped.');
            case 'timeout':
                return t('No result after 5 minutes. The calibration may have been stopped at the device.');
            case 'failed':
                return t('The calibration could not be started.');
            default:
                return '';
        }
    });
</script>

<!--
    The automatic calibration run of an HmIP blind or shutter actuator, where the CCU's WebUI has its
    "Auto Calibration" button. One button that is Start or Stop and keeps its box either way, a bar
    while the run is under way, and one line that says how it ended. The blind travels to both end
    positions, so the start asks first - in the app's own dialog.
-->
<div
    class="hmm-autocal"
    data-testid="blind-auto-calibration"
    data-state={running ? 'running' : reading ? 'reading' : (outcome ?? 'idle')}
>
    <div class="hmm-autocal-label">
        <span>{t('Automatic calibration')}</span>
        <span class="hmm-autocal-id">SELF_CALIBRATION</span>
    </div>
    <div class="hmm-autocal-control">
        {#if running}
            <button
                type="button"
                class="hmm-button hmm-autocal-button"
                data-testid="blind-auto-calibration-stop"
                disabled={stopping}
                onclick={stop}>{t('Stop calibration')}</button
            >
        {:else}
            <button
                type="button"
                class="hmm-button hmm-autocal-button"
                data-testid="blind-auto-calibration-start"
                disabled={unsaved || reading}
                onclick={() => (confirmOpen = true)}>{t('Start calibration')}</button
            >
        {/if}
    </div>
    <div class="hmm-autocal-progress">
        <div class="hmm-autocal-status" role="status" data-testid="blind-auto-calibration-status" title={status}>
            {status}
        </div>
        <span class="hmm-autocal-bar" class:hmm-autocal-active={running || reading} aria-hidden="true"
            ><span></span></span
        >
    </div>
</div>

<Dialog
    bind:open={confirmOpen}
    title={t('Start the automatic calibration?')}
    width="480px"
    testId="blind-auto-calibration-dialog"
>
    <p class="hmm-autocal-question" data-testid="blind-auto-calibration-target">
        {stores.nameOf(address) === address ? address : `${stores.nameOf(address)} (${address})`}
    </p>
    <p class="hmm-autocal-help">
        {t(
            'The blind travels all the way to both end positions, and the device measures the running times and stores them. Make sure nothing is in its way. The slat time is not measured. The run can be stopped at any time.',
        )}
    </p>

    {#snippet buttons()}
        <button
            type="button"
            class="hmm-button"
            data-testid="blind-auto-calibration-cancel"
            onclick={() => (confirmOpen = false)}>{t('Cancel')}</button
        >
        <button type="button" class="hmm-button" data-testid="blind-auto-calibration-confirm" onclick={start}
            >{t('Start calibration')}</button
        >
    {/snippet}
</Dialog>

<style>
    /* the grid of the calibration block above it (BlindCalibrationEditor), so the columns line up */
    .hmm-autocal {
        display: grid;
        grid-template-columns: 240px auto minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        padding: 6px 8px;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-autocal-label {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-autocal-id {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
    }

    .hmm-autocal-control {
        display: flex;
        align-items: center;
        min-width: 0;
    }

    .hmm-autocal-progress {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
    }

    /* Start and Stop share one box: the longer of the labels in either language fits */
    .hmm-autocal-button {
        flex: none;
        width: 190px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* always there, so the row does not move when a run starts; only the stripe is shown then */
    .hmm-autocal-bar {
        flex: none;
        width: 160px;
        max-width: 100%;
        height: 4px;
        border-radius: 3px;
        overflow: hidden;
        visibility: hidden;
        background: var(--hmm-border-muted);
    }

    .hmm-autocal-bar.hmm-autocal-active {
        visibility: visible;
    }

    .hmm-autocal-bar span {
        display: block;
        width: 40%;
        height: 100%;
        border-radius: 3px;
        background: var(--hmm-accent, var(--hmm-fg-muted));
    }

    .hmm-autocal-active span {
        animation: hmm-autocal-slide 1.4s ease-in-out infinite alternate;
    }

    @keyframes hmm-autocal-slide {
        from {
            transform: translateX(0);
        }
        to {
            transform: translateX(150%);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .hmm-autocal-active span {
            animation: none;
            width: 100%;
        }
    }

    /* two lines reserved, so a result does not change the row's height */
    .hmm-autocal-status {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        min-height: 2.6em;
        line-height: 1.3;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-autocal-question {
        margin: 0 0 8px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }

    .hmm-autocal-help {
        margin: 0;
        color: var(--hmm-fg-muted);
    }
    /* B-106: on a phone the label goes over the button, the button and the status share the line below */
    @media (max-width: 599px) {
        .hmm-autocal {
            grid-template-columns: auto minmax(0, 1fr);
            gap: 4px 8px;
        }

        .hmm-autocal-label {
            grid-column: 1 / -1;
        }
    }
</style>
