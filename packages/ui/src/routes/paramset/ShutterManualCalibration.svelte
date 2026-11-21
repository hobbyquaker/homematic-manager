<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import type {ParamsetWrite} from '@homematic-manager/core';

    import {getStores} from '../../lib/stores/context.js';
    import {
        MANUAL_CALIBRATION_PARAM,
        MAX_DURATION_S,
        ManualCalibrationSession,
        clampDuration,
        maintenanceAddress,
        type Direction,
        type ManualCalibrationState,
        type Motion,
    } from '../../lib/util/shutterManualCalibration.js';

    interface Props {
        interfaceName: string;
        /** The `SHUTTER_TRANSMITTER` channel. */
        address: string;
    }

    let {interfaceName, address}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /**
     * The calls of a session on this channel: the flags from `:0`, read quietly (hmipserver answers -5 for a flag it
     * does not know yet), their events, and the commands as one `putParamset VALUES` each.
     */
    function rpc(target: {interfaceName: string; address: string}) {
        const maintenance = maintenanceAddress(target.address);
        return {
            getFlag: (parameter: string) =>
                stores.paramsets.getValue(target.interfaceName, maintenance, parameter, {quiet: true}),
            command: (values: ParamsetWrite) => stores.paramsets.command(target.interfaceName, target.address, values),
            onFlag: (handler: (parameter: string, value: unknown) => void) =>
                stores.paramsets.onChannelEvent(target.interfaceName, maintenance, handler),
        };
    }

    /** The row's view of the flags: read when the row appears, kept by the events, read again after the dialog. */
    let flags = $state.raw<ManualCalibrationState | undefined>(undefined);
    let flagsRead = $state(0);
    $effect(() => {
        void flagsRead;
        const watcher = new ManualCalibrationSession(rpc({interfaceName, address}), (next) => (flags = next));
        void watcher.load();
        return () => {
            void watcher.close();
            flags = undefined;
        };
    });

    let open = $state(false);
    let confirmClear = $state(false);
    let seconds = $state(0);
    /** The seconds of the last timed move, for its status line. */
    let lastSeconds = $state(0);
    let current = $state.raw<ManualCalibrationState | undefined>(undefined);
    let session: ManualCalibrationSession | undefined;

    // One session per opening: it ends when the dialog closes however it closes (its buttons, ESC, the paramset
    // dialog going away), and a shutter it set moving is stopped then - the WebUI sends STOP_MOTION on Cancel.
    $effect(() => {
        if (!open) {
            return;
        }
        const started = new ManualCalibrationSession(rpc({interfaceName, address}), (next) => {
            if (session === started) {
                current = next;
            }
        });
        session = started;
        current = started.state;
        seconds = 0;
        void started.load();
        return () => {
            session = undefined;
            current = undefined;
            confirmClear = false;
            void started.close().then(() => (flagsRead += 1));
        };
    });

    const busy = $derived((current?.pending ?? 0) > 0);
    const step = $derived(current?.step ?? 'top');
    const moving = $derived(step === 'top' || step === 'bottom');

    const rowStatus = $derived.by(() => {
        if (!flags?.loaded) {
            return '';
        }
        if (flags.top === true && flags.bottom === true) {
            return t('The end positions are calibrated');
        }
        if (flags.top === false || flags.bottom === false) {
            return t('The end positions have not been saved. The tubular motor therefore cannot be used.');
        }
        return t('Not known yet whether the device holds its end positions.');
    });
    const rowState = $derived(
        !flags?.loaded
            ? 'loading'
            : flags.top === true && flags.bottom === true
              ? 'calibrated'
              : flags.top === false || flags.bottom === false
                ? 'uncalibrated'
                : 'unknown',
    );

    function flagText(value: boolean | undefined, set: string, unset: string, unknown: string): string {
        return value === undefined ? unknown : value ? set : unset;
    }

    const hint = $derived.by(() => {
        switch (step) {
            case 'top':
                return t(
                    'Move the shutter to its upper end position and save it. If it moves the wrong way, change the direction of rotation of the motor first.',
                );
            case 'bottom':
                return t('Move the shutter to its lower end position and save it.');
            case 'calibrated':
                return t('The end positions are calibrated. To calibrate them again, delete them first.');
            case 'saved':
                return t('The end positions have been saved. The tubular motor can be used.');
        }
    });

    const lastText = $derived.by(() => {
        const last = current?.last;
        if (!last) {
            return '';
        }
        if (!last.ok) {
            return t('The device did not take the command.');
        }
        switch (last.action) {
            case 'up-short':
                return t('Up for 100 ms.');
            case 'down-short':
                return t('Down for 100 ms.');
            case 'up-long':
                return t('Up for 400 ms.');
            case 'down-long':
                return t('Down for 400 ms.');
            case 'up-duration':
                return t('Up for {seconds} s.', {seconds: String(lastSeconds)});
            case 'down-duration':
                return t('Down for {seconds} s.', {seconds: String(lastSeconds)});
            case 'reverse':
                return t('The direction of rotation was changed.');
            case 'stop':
                return t('Stopped.');
            case 'saveTop':
                return t('The upper end position was saved.');
            case 'saveBottom':
                return t('The lower end position was saved.');
            case 'clear':
                return t('The end positions were deleted.');
        }
    });

    function move(direction: Direction, motion: Motion): void {
        if (motion.kind === 'duration') {
            lastSeconds = motion.seconds;
        }
        void session?.move(direction, motion);
    }

    function timed(direction: Direction): void {
        seconds = clampDuration(seconds);
        move(direction, {kind: 'duration', seconds});
    }

    function clear(): void {
        confirmClear = false;
        void session?.clear();
    }

    const target = $derived(stores.nameOf(address) === address ? address : `${stores.nameOf(address)} (${address})`);
</script>

<!--
    Task 122: the manual calibration of the end positions of an HmIP tubular motor, where the CCU's WebUI has its
    "Calibration of the end positions" button - on the channel's operating page, which is this VALUES dialog here.
    The row says whether the device holds its end positions; the button opens the steps.
-->
<div class="hmm-manualcal" data-testid="shutter-manual-calibration" data-state={rowState}>
    <div class="hmm-manualcal-label">
        <span>{t('Calibration of the end positions')}</span>
        <span class="hmm-manualcal-id">{MANUAL_CALIBRATION_PARAM}</span>
    </div>
    <div class="hmm-manualcal-control">
        <button
            type="button"
            class="hmm-button hmm-manualcal-open"
            data-testid="shutter-manual-calibration-open"
            onclick={() => (open = true)}>{t('Calibrate…')}</button
        >
    </div>
    <div
        class="hmm-manualcal-status"
        class:hmm-manualcal-attention={rowState === 'uncalibrated'}
        role="status"
        data-testid="shutter-manual-calibration-status"
        title={rowStatus}
    >
        {rowStatus}
    </div>
</div>

<Dialog
    bind:open
    title={t('Calibration of the end positions')}
    width="680px"
    height="min(620px, calc(100vh - 32px))"
    testId="shutter-manual-calibration-dialog"
>
    <div class="hmm-manualcal-dialog" data-step={step} data-testid="shutter-manual-calibration-step">
        <p class="hmm-manualcal-target" data-testid="shutter-manual-calibration-target">{target}</p>
        <p class="hmm-manualcal-warning" role="alert">
            {t(
                'The motor moves as soon as a movement button is pressed. Make sure nothing and nobody is in the way of the shutter. STOP stops it at any time; closing this dialog stops it too.',
            )}
        </p>

        <div class="hmm-manualcal-stopbar">
            <button
                type="button"
                class="hmm-button hmm-manualcal-stop"
                data-testid="shutter-manual-calibration-stop"
                onclick={() => void session?.stop()}>{t('S T O P')}</button
            >
            <div class="hmm-manualcal-flags">
                <span data-testid="shutter-manual-calibration-top"
                    >{flagText(
                        current?.top,
                        t('Upper end position set: Yes'),
                        t('Upper end position set: No'),
                        t('Upper end position set: not known'),
                    )}</span
                >
                <span data-testid="shutter-manual-calibration-bottom"
                    >{flagText(
                        current?.bottom,
                        t('Lower end position set: Yes'),
                        t('Lower end position set: No'),
                        t('Lower end position set: not known'),
                    )}</span
                >
            </div>
        </div>

        <p class="hmm-manualcal-hint" data-testid="shutter-manual-calibration-hint">{hint}</p>

        {#if moving}
            <div class="hmm-manualcal-moves">
                <label class="hmm-manualcal-movelabel" for="hmm-manualcal-seconds">{t('Movement time')}</label>
                <span class="hmm-manualcal-seconds">
                    <input
                        id="hmm-manualcal-seconds"
                        type="number"
                        min="0"
                        max={MAX_DURATION_S}
                        step="1"
                        bind:value={seconds}
                        onblur={() => (seconds = clampDuration(seconds))}
                        data-testid="shutter-manual-calibration-seconds"
                    />
                    <span>{t('Seconds')}</span>
                </span>
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-move"
                    data-testid="shutter-manual-calibration-up-duration"
                    disabled={clampDuration(seconds) === 0}
                    onclick={() => timed('up')}>{t('Up')}</button
                >
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-move"
                    data-testid="shutter-manual-calibration-down-duration"
                    disabled={clampDuration(seconds) === 0}
                    onclick={() => timed('down')}>{t('Down')}</button
                >

                <span class="hmm-manualcal-movelabel">100 ms</span>
                <span></span>
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-move"
                    data-testid="shutter-manual-calibration-up-short"
                    onclick={() => move('up', {kind: 'short'})}>{t('Up')}</button
                >
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-move"
                    data-testid="shutter-manual-calibration-down-short"
                    onclick={() => move('down', {kind: 'short'})}>{t('Down')}</button
                >

                <span class="hmm-manualcal-movelabel">400 ms</span>
                <span></span>
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-move"
                    data-testid="shutter-manual-calibration-up-long"
                    onclick={() => move('up', {kind: 'long'})}>{t('Up')}</button
                >
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-move"
                    data-testid="shutter-manual-calibration-down-long"
                    onclick={() => move('down', {kind: 'long'})}>{t('Down')}</button
                >
            </div>

            <div class="hmm-manualcal-actions">
                {#if step === 'top'}
                    <button
                        type="button"
                        class="hmm-button hmm-manualcal-action"
                        data-testid="shutter-manual-calibration-reverse"
                        disabled={busy}
                        onclick={() => void session?.reverse()}
                        title={t('Change the direction of rotation of the motor')}
                        >{t('Change the direction of rotation of the motor')}</button
                    >
                    <button
                        type="button"
                        class="hmm-button hmm-manualcal-action"
                        data-testid="shutter-manual-calibration-save-top"
                        disabled={busy}
                        onclick={() => void session?.saveTop()}>{t('Save upper end position')}</button
                    >
                {:else}
                    <button
                        type="button"
                        class="hmm-button hmm-manualcal-action"
                        data-testid="shutter-manual-calibration-save-bottom"
                        disabled={busy}
                        onclick={() => void session?.saveBottom()}>{t('Save lower end position')}</button
                    >
                {/if}
            </div>
        {/if}

        {#if step !== 'saved'}
            <div class="hmm-manualcal-actions">
                <button
                    type="button"
                    class="hmm-button hmm-manualcal-action hmm-danger"
                    data-testid="shutter-manual-calibration-clear"
                    disabled={busy}
                    onclick={() => (confirmClear = true)}>{t('Delete end positions')}</button
                >
            </div>
        {/if}

        <p class="hmm-manualcal-last" role="status" data-testid="shutter-manual-calibration-last" title={lastText}>
            {lastText}
        </p>
    </div>

    {#snippet buttons()}
        <button
            type="button"
            class="hmm-button hmm-manualcal-close"
            data-testid="shutter-manual-calibration-close"
            onclick={() => (open = false)}>{step === 'saved' ? t('Done') : t('Close')}</button
        >
    {/snippet}
</Dialog>

<Dialog
    bind:open={confirmClear}
    title={t('Delete end positions?')}
    width="440px"
    testId="shutter-manual-calibration-confirm"
>
    <p class="hmm-manualcal-target">{target}</p>
    <p class="hmm-manualcal-help">
        {t('The device forgets both end positions. The tubular motor cannot be used until they are calibrated again.')}
    </p>
    {#snippet buttons()}
        <button
            type="button"
            class="hmm-button"
            data-testid="shutter-manual-calibration-confirm-cancel"
            onclick={() => (confirmClear = false)}>{t('Cancel')}</button
        >
        <button
            type="button"
            class="hmm-button hmm-danger"
            data-testid="shutter-manual-calibration-confirm-delete"
            onclick={clear}>{t('Delete end positions')}</button
        >
    {/snippet}
</Dialog>

<style>
    /* the grid of the calibration rows above it (BlindAutoCalibration), so the columns line up */
    .hmm-manualcal {
        display: grid;
        grid-template-columns: 240px auto minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        padding: 6px 8px;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-manualcal-label {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-manualcal-id {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
    }

    .hmm-manualcal-control {
        display: flex;
        align-items: center;
    }

    .hmm-manualcal-open {
        width: 190px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* two lines reserved, so the answer of the flags does not change the row's height */
    .hmm-manualcal-status,
    .hmm-manualcal-last,
    .hmm-manualcal-hint {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        min-height: 2.6em;
        line-height: 1.3;
        margin: 0;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-manualcal-hint {
        -webkit-line-clamp: 3;
        line-clamp: 3;
        min-height: 3.9em;
        color: var(--hmm-fg);
        font-size: inherit;
    }

    .hmm-manualcal-attention {
        color: var(--hmm-warn);
    }

    .hmm-manualcal-dialog {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .hmm-manualcal-target {
        margin: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
    }

    .hmm-manualcal-warning {
        margin: 0;
        padding: 8px 10px;
        border: 1px solid var(--hmm-warn);
        border-radius: var(--hmm-radius);
        color: var(--hmm-warn);
    }

    .hmm-manualcal-stopbar {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    /* the one button that must always be there and always hit: wide, and the same box in every step */
    .hmm-manualcal-stop {
        flex: none;
        width: 200px;
        height: 40px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: var(--hmm-error);
        border-color: var(--hmm-error);
    }

    .hmm-manualcal-flags {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-manualcal-moves {
        display: grid;
        grid-template-columns: 120px 110px 96px 96px;
        gap: 6px 8px;
        align-items: center;
    }

    .hmm-manualcal-movelabel {
        color: var(--hmm-fg-muted);
    }

    .hmm-manualcal-seconds {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .hmm-manualcal-seconds input {
        width: 52px;
        text-align: center;
    }

    .hmm-manualcal-move {
        width: 96px;
    }

    .hmm-manualcal-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .hmm-manualcal-action {
        width: 310px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-manualcal-close {
        min-width: 110px;
    }

    .hmm-manualcal-help {
        margin: 0;
        color: var(--hmm-fg-muted);
    }

    .hmm-danger {
        color: var(--hmm-error);
    }
</style>
