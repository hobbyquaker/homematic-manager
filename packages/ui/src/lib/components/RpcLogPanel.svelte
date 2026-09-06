<script lang="ts">
    import type {WriteLogEntry} from '@homematic-manager/core';

    import type {PendingWrite} from '../stores/WriteLogStore.svelte.js';
    import {formatDuration, formatParams, formatRpcValue, formatTime} from '../util/format.js';
    import {
        PANEL_MIN_HEIGHT,
        defaultPanelHeight,
        panelLimits,
        recallPanelHeight,
        rememberPanelHeight,
        resizePanel,
    } from './dialogGeometry.js';

    interface Props {
        open?: boolean;
        entries: WriteLogEntry[];
        pending?: PendingWrite[];
        title?: string;
        emptyText?: string;
        pendingText?: string;
        clearLabel?: string;
        closeLabel?: string;
        /** The drag handle's accessible name; it is a `separator`, so it needs one. */
        resizeLabel?: string;
        /**
         * What stays above the drawer and bounds its height - the application header.
         *
         * Measured from `--hmm-header-height` when it is not given, so the drawer follows the theme
         * rather than a number copied out of it; a test passes it to assert the clamp exactly.
         */
        reservedHeight?: number | undefined;
        onclear?: (() => void) | undefined;
        testId?: string | undefined;
    }

    let {
        open = $bindable(false),
        entries,
        pending = [],
        title = 'RPC log',
        emptyText = 'No RPC calls yet',
        pendingText = 'in progress',
        clearLabel = 'Clear',
        closeLabel = 'Close',
        resizeLabel = 'Resize the RPC log',
        reservedHeight = undefined,
        onclear = undefined,
        testId = undefined,
    }: Props = $props();

    /**
     * Task 22, the maintainer's third look: the drawer was a fixed 240 px box, which is two rows of
     * a real RPC log, and there was no way to make it bigger. It opens at half the window now and
     * is dragged by its upper edge.
     *
     * The height is remembered for the session, exactly like a dialog's box (task 20) and for the
     * same reason: a size that outlived the page would follow a user onto a smaller screen.
     */
    const GEOMETRY_KEY = 'rpclog';

    let height = $state(recallPanelHeight(GEOMETRY_KEY));

    /** How much of the window is not the drawer: the header, from the theme's own token. */
    function reserved(): number {
        if (reservedHeight !== undefined) {
            return reservedHeight;
        }
        const token = getComputedStyle(document.documentElement).getPropertyValue('--hmm-header-height');
        const measured = Number.parseFloat(token);
        return Number.isFinite(measured) ? measured : 36;
    }

    // Opening is what sizes it: half the window the first time, and what the user left it at
    // afterwards. `untrack` is not needed - nothing here reads a signal the effect should follow
    // except `open` itself.
    $effect(() => {
        if (open && height === undefined) {
            height = defaultPanelHeight(window.innerHeight, reserved());
        }
    });

    /**
     * The top edge, dragged.
     *
     * The same shape as `Dialog`'s gesture and for the same reason: the pointer leaves the six
     * pixels of the handle immediately, so the moves are listened for on `window` and the
     * listeners live exactly as long as the gesture.
     */
    function startResize(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        const start = height ?? defaultPanelHeight(window.innerHeight, reserved());
        const originY = event.clientY;
        event.preventDefault();

        const onMove = (move: PointerEvent): void => {
            height = resizePanel(start, move.clientY - originY, window.innerHeight, reserved());
        };
        const onEnd = (): void => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
            if (height !== undefined) {
                rememberPanelHeight(GEOMETRY_KEY, height);
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    }

    /** What the handle reports as its upper bound; recomputed when the drawer's height changes. */
    const maximum = $derived(
        open && height !== undefined ? panelLimits(window.innerHeight, reserved()).max : PANEL_MIN_HEIGHT,
    );

    /** A separator that only a pointer can move is a separator half the users cannot move. */
    function onHandleKeyDown(event: KeyboardEvent): void {
        const step = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0;
        if (step === 0) {
            return;
        }
        event.preventDefault();
        const start = height ?? defaultPanelHeight(window.innerHeight, reserved());
        height = resizePanel(start, step, window.innerHeight, reserved());
        rememberPanelHeight(GEOMETRY_KEY, height);
    }
</script>

<!--
    The drawer that replaces the modal `dialog-rpc` of 2.7.

    That dialog blocked the whole window for every single RPC call, queued the next call behind
    itself (`rpcDialogShift`) and, on a fault, left a modal the user had to dismiss before they
    could look at anything. The same information - method, parameters, result or fault, duration -
    is here, non-modal, and it can stay open while work continues. Bulk writes report progress
    separately (RpcProgress), which is the only case that still deserves a modal.
-->
{#if open}
    <aside
        class="hmm-rpclog"
        aria-label={title}
        data-testid={testId}
        style:height={height === undefined ? undefined : `${height}px`}
    >
        <!--
            The grip. Six pixels tall and inside the drawer, like the dialog's edges: a handle that
            hung over the top edge would sit on the last row of the grid above it. It is a
            `separator` rather than an `aria-hidden` div, because unlike a dialog - which can be
            resized or simply reopened - this drawer has no other way to be made bigger.
        -->
        <!--
            A `separator` is only non-interactive while it is not focusable; a focusable one is the
            window-splitter widget of the ARIA specification, which is exactly what this is, and it
            carries `aria-valuenow`/`min`/`max` to say so. Svelte's checker does not make that
            distinction, so the two warnings are answered below rather than by dropping the keyboard
            support that makes the drawer resizable without a pointer.
        -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
            class="hmm-rpclog-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label={resizeLabel}
            aria-valuenow={height ?? 0}
            aria-valuemin={PANEL_MIN_HEIGHT}
            aria-valuemax={maximum}
            tabindex="0"
            data-resize="n"
            data-testid={testId === undefined ? undefined : `${testId}-resize`}
            onpointerdown={startResize}
            onkeydown={onHandleKeyDown}
        ></div>
        <header class="hmm-rpclog-head">
            <strong class="hmm-rpclog-title">{title}</strong>
            <button type="button" class="hmm-button" onclick={() => onclear?.()}>{clearLabel}</button>
            <button type="button" class="hmm-rpclog-close" aria-label={closeLabel} onclick={() => (open = false)}
                >✕</button
            >
        </header>
        <ol class="hmm-rpclog-list">
            {#each pending as write (write.id)}
                <li class="hmm-rpclog-entry hmm-rpclog-pending">
                    <span class="hmm-rpclog-spinner" aria-hidden="true"></span>
                    <span class="hmm-rpclog-method hmm-mono">{write.interfaceName} {write.method}</span>
                    <span class="hmm-rpclog-params hmm-mono">{formatParams(write.params)}</span>
                    <span class="hmm-rpclog-status">{pendingText}</span>
                </li>
            {/each}
            {#each entries as entry (entry.id)}
                <li class="hmm-rpclog-entry" class:hmm-rpclog-failed={!entry.ok}>
                    <span class="hmm-rpclog-time">{formatTime(entry.timestamp)}</span>
                    <span class="hmm-rpclog-method hmm-mono">{entry.interfaceName} {entry.method}</span>
                    <span class="hmm-rpclog-params hmm-mono">{formatParams(entry.params)}</span>
                    <span class="hmm-rpclog-status">
                        {#if entry.ok}
                            {formatRpcValue(entry.result)}
                        {:else}
                            {entry.error ?? ''}
                        {/if}
                    </span>
                    <span class="hmm-rpclog-duration">{formatDuration(entry.durationMs)}</span>
                </li>
            {/each}
            {#if entries.length === 0 && pending.length === 0}
                <li class="hmm-rpclog-empty">{emptyText}</li>
            {/if}
        </ol>
    </aside>
{/if}

<style>
    /*
        Task 22: a sized drawer, not a 240 px box. `flex: 0 0 auto` so the inline height is what
        decides and the flex container does not stretch or shrink it, `min-width: 0` and
        `overflow: hidden` so nothing inside can push the drawer - and with it the window - sideways
        (task 19's rule for dialogs, which the maintainer asked to apply here too).
    */
    .hmm-rpclog {
        display: flex;
        flex-direction: column;
        position: relative;
        flex: 0 0 auto;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        border-top: 1px solid var(--hmm-border-strong);
        background: var(--hmm-bg-sunken);
    }

    .hmm-rpclog-handle {
        height: 6px;
        flex: 0 0 auto;
        cursor: ns-resize;
    }

    .hmm-rpclog-handle:focus-visible {
        outline-offset: -2px;
    }

    .hmm-rpclog-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        padding: 3px 6px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-rpclog-title {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-rpclog-close {
        border: none;
        background: none;
        cursor: pointer;
        line-height: 1;
        padding: 0 4px;
    }

    /* The one thing that scrolls: the entries, vertically. */
    .hmm-rpclog-list {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
    }

    /*
        `minmax(0, 1fr)`, not `1fr`: a plain `1fr` track is `minmax(auto, 1fr)` and grows to the
        widest thing in it, so one `putParamset` with twenty parameters in it would push the drawer
        sideways instead of being ellipsised (the same defect task 21 found in the settings dialog).
    */
    .hmm-rpclog-entry {
        display: grid;
        grid-template-columns: 70px 220px minmax(0, 1fr) 200px 70px;
        gap: 6px;
        align-items: center;
        padding: 1px 6px;
        border-bottom: 1px solid var(--hmm-border-muted);
        white-space: nowrap;
    }

    .hmm-rpclog-pending {
        grid-template-columns: 70px 220px minmax(0, 1fr) 270px;
        color: var(--hmm-fg-muted);
    }

    .hmm-rpclog-failed .hmm-rpclog-status {
        color: var(--hmm-error);
        font-weight: bold;
    }

    .hmm-rpclog-params,
    .hmm-rpclog-status,
    .hmm-rpclog-method {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-rpclog-time,
    .hmm-rpclog-duration {
        color: var(--hmm-fg-muted);
    }

    .hmm-rpclog-spinner {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-left: 4px;
        border: 2px solid var(--hmm-border);
        border-top-color: var(--hmm-accent);
        border-radius: 50%;
        animation: hmm-rpclog-spin 800ms linear infinite;
    }

    .hmm-rpclog-empty {
        padding: 6px;
        color: var(--hmm-fg-muted);
    }

    @keyframes hmm-rpclog-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
