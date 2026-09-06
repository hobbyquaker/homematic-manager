<script lang="ts">
    import type {Snippet} from 'svelte';

    import {
        DEFAULT_LIMITS,
        moveDialog,
        recallDialog,
        rememberDialog,
        resizeDialog,
        type DialogBox,
        type ResizeEdge,
    } from './dialogGeometry.js';

    interface Props {
        open?: boolean;
        title?: string;
        /** Modal by default, as every jQuery UI dialog of 2.7 was. */
        modal?: boolean;
        width?: string;
        /**
         * Fixed height. Without one a dialog is as tall as its content, up to the viewport; with
         * one its box does not change while it is open, whatever the content does (D-34: nothing
         * may change size when its content or state changes). Give one to every dialog whose
         * content can grow after it opened - the paramset and link editors.
         */
        height?: string | undefined;
        /** ESC and the close button close the dialog. Off for a dialog that must be answered. */
        closable?: boolean;
        onclose?: (() => void) | undefined;
        children?: Snippet | undefined;
        /** The button row at the bottom right. */
        buttons?: Snippet | undefined;
        closeLabel?: string;
        /**
         * The narrowest and the shortest the user may drag this dialog class (task 20).
         *
         * Without a `minWidth` the minimum *is* the designed `width`: a form that was laid out for
         * 560 px does not reflow, and dragging it narrower would give its content area a horizontal
         * scrollbar - which task 19 forbade and task 20 keeps forbidding after a resize. A dialog
         * whose content really does reflow says how far down it goes; the paramset and link editors
         * do, their parameter rows are two columns that shrink.
         */
        minWidth?: number | undefined;
        minHeight?: number;
        /** Draggable by the title bar, resizable by the edges and the bottom-right corner. */
        movable?: boolean;
        testId?: string | undefined;
    }

    let {
        open = $bindable(false),
        title = '',
        modal = true,
        width = '640px',
        height = undefined,
        closable = true,
        onclose = undefined,
        children = undefined,
        buttons = undefined,
        closeLabel = 'Close',
        minWidth = undefined,
        minHeight = DEFAULT_LIMITS.minHeight,
        movable = true,
        testId = undefined,
    }: Props = $props();

    let element = $state<HTMLDialogElement | undefined>(undefined);
    let previouslyFocused: HTMLElement | undefined;

    /**
     * The box the user dragged this dialog to, or `undefined` while it is still where it was
     * designed to be. Set, it wins over `width`/`height` and over the browser's centring; unset,
     * nothing about the dialog changes from what task 19 laid out.
     */
    let geometry = $state<DialogBox | undefined>(undefined);
    /** The dialog *class*, not the dialog: what a remembered geometry is keyed by. */
    const geometryKey = $derived(testId ?? title);
    /** `640px` -> 640; anything else (a `min()`, a percentage) falls back to the floor. */
    const designedWidth = $derived(Number(/^(\d+)px$/.exec(width)?.[1] ?? Number.NaN));
    const limits = $derived({
        minWidth:
            minWidth ??
            (Number.isNaN(designedWidth) ? DEFAULT_LIMITS.minWidth : Math.max(DEFAULT_LIMITS.minWidth, designedWidth)),
        minHeight,
    });

    /**
     * Native `<dialog>` instead of jQuery UI.
     *
     * 2.7 stacked its dialogs by hand and jQuery UI's `_focusTabbable` then walked into a dialog
     * that was already gone - opening a paramset dialog out of the link dialog could throw and
     * leave the app with a modal overlay and no dialog under it (#77 and friends). `showModal()`
     * maintains the browser's own top layer, so two dialogs stack correctly, ESC is handled by the
     * platform, and focus is restored by this component to whatever had it before.
     */
    $effect(() => {
        const dialog = element;
        if (!dialog) {
            return;
        }
        if (open && !dialog.open) {
            previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
            // Where the user left this dialog class last time, before it is shown, so it never
            // appears centred and then jumps.
            geometry = geometryKey === '' ? undefined : recallDialog(geometryKey);
            if (modal) {
                dialog.showModal();
            } else {
                dialog.show();
            }
        } else if (!open && dialog.open) {
            dialog.close();
        }
    });

    function close(): void {
        open = false;
        onclose?.();
        previouslyFocused?.focus();
        previouslyFocused = undefined;
    }

    function viewport(): {width: number; height: number} {
        return {width: window.innerWidth, height: window.innerHeight};
    }

    /**
     * One pointer gesture, for the title bar and for every resize handle.
     *
     * Plain pointer events on `window` rather than a library: a drag has to keep working when the
     * pointer leaves the handle - which it does immediately - and `window` sees the moves wherever
     * they happen, including over the modal backdrop. The listeners live exactly as long as the
     * gesture. Nothing here touches focus or the tab order, so the native dialog's focus trap and
     * its ESC are exactly what they were, and the handles are `aria-hidden` divs the keyboard
     * never reaches.
     */
    function startGesture(event: PointerEvent, edge: ResizeEdge | 'move'): void {
        const dialog = element;
        if (!dialog || !movable || event.button !== 0) {
            return;
        }
        const rect = dialog.getBoundingClientRect();
        const start: DialogBox = {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
        const originX = event.clientX;
        const originY = event.clientY;
        event.preventDefault();

        const onMove = (move: PointerEvent): void => {
            const dx = move.clientX - originX;
            const dy = move.clientY - originY;
            geometry =
                edge === 'move'
                    ? moveDialog(start, dx, dy, viewport())
                    : resizeDialog(start, edge, dx, dy, viewport(), limits);
        };
        const onEnd = (): void => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onEnd);
            window.removeEventListener('pointercancel', onEnd);
            if (geometry && geometryKey !== '') {
                rememberDialog(geometryKey, geometry);
            }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
    }

    /** The close button is inside the title bar and must not start a drag. */
    function onTitleBarPointerDown(event: PointerEvent): void {
        if ((event.target as HTMLElement).closest('button') !== null) {
            return;
        }
        startGesture(event, 'move');
    }

    const EDGES: readonly ResizeEdge[] = ['n', 'e', 's', 'w', 'se'];

    function onCancel(event: Event): void {
        // ESC. A dialog that is not closable stays open, which is what the 2.x "RPC execution"
        // dialog did while a call was running.
        event.preventDefault();
        if (closable) {
            close();
        }
    }
</script>

<dialog
    bind:this={element}
    class="hmm-dialog"
    class:hmm-dialog-placed={geometry !== undefined}
    style:width={geometry === undefined ? width : `${geometry.width}px`}
    style:height={geometry === undefined ? height : `${geometry.height}px`}
    style:left={geometry === undefined ? undefined : `${geometry.left}px`}
    style:top={geometry === undefined ? undefined : `${geometry.top}px`}
    data-testid={testId}
    aria-label={title === '' ? undefined : title}
    oncancel={onCancel}
    onclose={() => {
        if (open) {
            close();
        }
    }}
>
    <!-- The title bar is the drag handle. It carries no keyboard behaviour of its own, so the
         dialog's focus order is the close button and then the content, as before. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="hmm-dialog-titlebar" class:hmm-dialog-titlebar-movable={movable} onpointerdown={onTitleBarPointerDown}>
        <span class="hmm-dialog-title">{title}</span>
        {#if closable}
            <button type="button" class="hmm-dialog-close" aria-label={closeLabel} onclick={close}>✕</button>
        {/if}
    </div>
    <div class="hmm-dialog-body">
        {#if children}{@render children()}{/if}
    </div>
    {#if buttons}
        <div class="hmm-dialog-buttons">{@render buttons()}</div>
    {/if}
    {#if movable}
        {#each EDGES as edge (edge)}
            <div
                class="hmm-dialog-resize hmm-dialog-resize-{edge}"
                data-resize={edge}
                aria-hidden="true"
                onpointerdown={(event) => startGesture(event, edge)}
            ></div>
        {/each}
    {/if}
</dialog>

<style>
    .hmm-dialog {
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
        padding: 0;
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        color: var(--hmm-fg);
        font-family: var(--hmm-font);
        font-size: var(--hmm-font-size);
    }

    /* Only while it is open: an unconditional flex display would beat the browser's own rule for a
       closed dialog and show every one of them inside the page.
       The title bar and the button row keep their size; the body is what scrolls, so a dialog
       never grows a second scrollbar around a list that already has one. */
    .hmm-dialog[open] {
        display: flex;
        flex-direction: column;
    }

    /* Once the user has placed it, the box is the geometry and nothing else: no centring margin,
       and no `max-width`/`max-height` second-guessing a size that was already clamped to the
       viewport when it was dragged. */
    .hmm-dialog-placed {
        margin: 0;
        inset-inline-end: auto;
        inset-block-end: auto;
        max-width: none;
        max-height: none;
    }

    .hmm-dialog::backdrop {
        background: var(--hmm-backdrop);
    }

    .hmm-dialog-titlebar {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-dialog-titlebar-movable {
        cursor: move;
        /* A drag that selects the title instead of moving the dialog is the classic annoyance. */
        user-select: none;
    }

    .hmm-dialog-title {
        font-weight: bold;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-dialog-close {
        border: 1px solid transparent;
        border-radius: var(--hmm-radius);
        background: none;
        cursor: pointer;
        line-height: 1;
        padding: 2px 6px;
    }

    .hmm-dialog-close:hover {
        border-color: var(--hmm-border);
        background: var(--hmm-accent-bg);
    }

    .hmm-dialog-body {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
        padding: 10px;
        overflow: auto;
    }

    /* The body is a column, so a block of the dialog's content keeps its natural height and the
       one part that is meant to scroll (a parameter list) claims the rest with its own flex. */
    .hmm-dialog-body > :global(*) {
        flex-shrink: 0;
    }

    .hmm-dialog-buttons {
        display: flex;
        flex: 0 0 auto;
        justify-content: flex-end;
        gap: 6px;
        padding: 6px 10px;
        border-top: 1px solid var(--hmm-border-muted);
        background: var(--hmm-bg-sunken);
    }

    /* Invisible grips, six pixels wide, inside the frame: a handle that hangs over the edge would
       make the dialog itself scrollable, which is exactly what task 19 forbade. */
    .hmm-dialog-resize {
        position: absolute;
    }

    .hmm-dialog-resize-n,
    .hmm-dialog-resize-s {
        left: 0;
        right: 0;
        height: 6px;
        cursor: ns-resize;
    }

    .hmm-dialog-resize-n {
        top: 0;
    }

    .hmm-dialog-resize-s {
        bottom: 0;
    }

    .hmm-dialog-resize-e,
    .hmm-dialog-resize-w {
        top: 0;
        bottom: 0;
        width: 6px;
        cursor: ew-resize;
    }

    .hmm-dialog-resize-e {
        right: 0;
    }

    .hmm-dialog-resize-w {
        left: 0;
    }

    /* Last in the source, so the corner wins over the two edges it overlaps. */
    .hmm-dialog-resize-se {
        right: 0;
        bottom: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
    }
</style>
