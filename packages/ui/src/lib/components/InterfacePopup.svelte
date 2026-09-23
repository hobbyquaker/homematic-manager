<script lang="ts">
    import type {CallbackWarning, InterfaceState} from '@homematic-manager/core';

    import ConnectionIndicator from './ConnectionIndicator.svelte';
    import {
        callbackLine,
        callbackWarningOf,
        detailParts,
        MARK_GLYPH,
        markOf,
        notAnsweringNames,
        type InterfaceDetails,
        type InterfaceMark,
        type StoreEntry,
    } from './interfacePopup.js';

    interface Props {
        /** Every configured interface, in configuration order - the backend answers in that order. */
        interfaces: InterfaceState[];
        selected?: string;
        /** Host name or address of the CCU, from the connection configuration. */
        host?: string;
        /** The connection to the backend, not to the CCU. */
        backendConnected?: boolean;
        /** Per interface name, what the rest of the UI knows: device count, duty cycle. */
        details?: Record<string, InterfaceDetails>;
        label?: string;
        listLabel?: string;
        connectedText?: string;
        notConnectedText?: string;
        notPresentText?: string;
        /** B-28: a `bad` interface whose `init` or probe timed out says this instead of "not connected". */
        notAnsweringText?: string;
        /** B-28: the button under the list that tries every interface that is not answering at once. */
        retryText?: string;
        /** B-28: without it there is no retry button; called with the names of the interfaces not answering. */
        onretry?: ((interfaceNames: string[]) => void) | undefined;
        subscribingText?: string;
        /** Task 56: a `busy` interface that is waiting for its process at the start says this. */
        waitingText?: string;
        allConnectedText?: string;
        someNotConnectedText?: string;
        portLabel?: string;
        tlsLabel?: string;
        devicesLabel?: (count: number) => string;
        dutyCycleLabel?: (value: number) => string;
        /**
         * Task 38: the host runs in a container and its callback servers listen beyond the loopback
         * (`AppConfig.publishCallbackPorts`), so every callback URL says its port must be published.
         */
        publishCallbackPorts?: boolean;
        callbackPortInUseLabel?: (port: number) => string;
        callbackPortFailedLabel?: (port: number) => string;
        publishPortText?: string;
        /** B-53: what the popup says about a set callback address that does not fit. */
        callbackWarningLabel?: (warning: CallbackWarning) => string;
        useAutomaticText?: string;
        /** B-53: without it there is no "use automatic" button. */
        onuseautomatic?: (() => void) | undefined;
        onselect?: ((interfaceName: string) => void) | undefined;
        /**
         * The metadata store as an entry of its own, under the host and above the interfaces
         * (the maintainer, 2026-09-10: "mach ReGaHSS doch zu einem eigenen interface"). Absent
         * where there is no store at all; selected, moved to and reported like an interface.
         */
        store?: StoreEntry | undefined;
        storeTestId?: string | undefined;
        testId?: string | undefined;
    }

    let {
        interfaces,
        selected = '',
        host = '',
        backendConnected = true,
        details = {},
        label = 'Select an interface',
        listLabel = 'Interfaces',
        connectedText = 'Connected',
        notConnectedText = 'Not connected',
        notPresentText = 'Not present',
        notAnsweringText = 'Not answering',
        retryText = 'Retry now',
        onretry = undefined,
        subscribingText = 'Subscribing',
        waitingText = 'Waiting',
        allConnectedText = 'All interfaces are connected',
        someNotConnectedText = 'Not every interface is connected',
        portLabel = 'Port',
        tlsLabel = 'TLS',
        devicesLabel = (count: number) => `${String(count)} devices`,
        dutyCycleLabel = (value: number) => `Duty cycle ${String(value)} %`,
        publishCallbackPorts = false,
        callbackPortInUseLabel = (port: number) => `Callback port ${String(port)} is in use`,
        callbackPortFailedLabel = (port: number) => `Callback port ${String(port)} cannot be opened`,
        publishPortText = 'Publish this port unchanged',
        callbackWarningLabel = (warning: CallbackWarning) =>
            warning.reason === 'notLocal'
                ? `The callback address ${warning.address} is not an address of this machine; ${warning.auto} is used instead`
                : `The callback address ${warning.address} is not in the CCU's network; the CCU may not reach it and send no events`,
        useAutomaticText = 'Use automatic',
        onuseautomatic = undefined,
        onselect = undefined,
        store = undefined,
        storeTestId = undefined,
        testId = undefined,
    }: Props = $props();

    let open = $state(false);
    let activeIndex = $state(0);
    let root = $state<HTMLDivElement | undefined>(undefined);
    let trigger = $state<HTMLButtonElement | undefined>(undefined);
    let retryButton = $state<HTMLButtonElement | undefined>(undefined);
    let autoButton = $state<HTMLButtonElement | undefined>(undefined);
    /** B-53: the set callback address that does not fit, if any. */
    const callbackWarning = $derived(callbackWarningOf(interfaces));
    /** The buttons under the list, in tab order: "use automatic", then "retry now". */
    const footButtons = $derived([autoButton, retryButton].filter((button) => button !== undefined));
    /** B-28: what the retry button tries; the button is only there while this is not empty. */
    const retryNames = $derived(onretry === undefined ? [] : notAnsweringNames(interfaces));
    /** The option buttons, by index; `bind:this` fills and clears them. */
    let items = $state<Array<HTMLButtonElement | undefined>>([]);

    /**
     * What the arrow keys move over, in the order the rows are drawn: the store first when it can
     * be chosen at all, then every interface. A store that does not answer is drawn but skipped.
     */
    const optionIds = $derived([
        ...(store !== undefined && store.selectable ? [store.id] : []),
        ...interfaces.map((state) => state.name),
    ]);
    const selectedIndex = $derived(optionIds.indexOf(selected));
    /** The trigger says the store's name, not the reserved id it is selected under. */
    const selectedLabel = $derived(store !== undefined && store.id === selected ? store.label : selected);
    const storeIndex = $derived(store !== undefined && store.selectable ? 0 : -1);

    /**
     * The words beside the glyph; every state says what it is, not only the broken ones. B-28: of
     * the broken ones, an interface that did not answer in time says so - it is neither missing nor
     * refusing, and trying again is what helps.
     */
    function markText(mark: InterfaceMark, state: InterfaceState): string {
        if (mark === 'bad' && state.unreachable === true) {
            return notAnsweringText;
        }
        switch (mark) {
            case 'ok': {
                return connectedText;
            }
            case 'busy': {
                return state.subscribing === true ? subscribingText : waitingText;
            }
            case 'absent': {
                return notPresentText;
            }
            default: {
                return notConnectedText;
            }
        }
    }

    function lineOf(state: InterfaceState): string {
        return detailParts(state, details[state.name], {
            port: portLabel,
            tls: tlsLabel,
            devices: devicesLabel,
            dutyCycle: dutyCycleLabel,
        }).join(' · ');
    }

    /** The keyboard opens on the current selection, so the first arrow key moves from there. */
    function openList(): void {
        activeIndex = selectedIndex < 0 ? 0 : selectedIndex;
        open = true;
    }

    function close(refocus: boolean): void {
        open = false;
        if (refocus) {
            trigger?.focus();
        }
    }

    function choose(interfaceName: string): void {
        close(true);
        if (interfaceName !== selected) {
            onselect?.(interfaceName);
        }
    }

    function move(delta: number): void {
        if (optionIds.length === 0) {
            return;
        }
        activeIndex = (activeIndex + delta + optionIds.length) % optionIds.length;
    }

    /**
     * Focus follows the active item, so the browser reads it out and `Tab` leaves the popup at the
     * place the user is looking at. It runs after the DOM update, which is when `bind:this` has
     * handed the buttons over.
     */
    $effect(() => {
        if (open) {
            items[activeIndex]?.focus();
        }
    });

    function onTriggerKeyDown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (open) {
                move(event.key === 'ArrowDown' ? 1 : -1);
            } else {
                openList();
            }
            return;
        }
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            close(true);
        }
        // Enter and Space are the button's own activation and end up in `onclick`.
    }

    function onItemKeyDown(event: KeyboardEvent, index: number): void {
        switch (event.key) {
            case 'ArrowDown': {
                event.preventDefault();
                move(1);
                break;
            }
            case 'ArrowUp': {
                event.preventDefault();
                move(-1);
                break;
            }
            case 'Home': {
                event.preventDefault();
                activeIndex = 0;
                break;
            }
            case 'End': {
                event.preventDefault();
                activeIndex = optionIds.length - 1;
                break;
            }
            case 'Enter':
            case ' ': {
                // `preventDefault` first: without it the browser turns the key into a click on the
                // button and the item would be chosen twice.
                event.preventDefault();
                choose(optionIds[index] ?? '');
                break;
            }
            case 'Escape': {
                event.preventDefault();
                close(true);
                break;
            }
            case 'Tab': {
                // B-28, B-53: forwards, the buttons under the list are the stops left inside
                const first = footButtons[0];
                if (!event.shiftKey && first !== undefined) {
                    event.preventDefault();
                    first.focus();
                    break;
                }
                // Leaving by keyboard closes it, but the focus goes where the user sent it.
                close(false);
                break;
            }
            default: {
                break;
            }
        }
    }

    function onFootKeyDown(event: KeyboardEvent): void {
        const index = footButtons.findIndex((button) => button === event.currentTarget);
        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
        } else if (event.key === 'Tab' && event.shiftKey) {
            event.preventDefault();
            (footButtons[index - 1] ?? items[activeIndex])?.focus();
        } else if (event.key === 'Tab') {
            const next = footButtons[index + 1];
            if (next === undefined) {
                close(false);
            } else {
                event.preventDefault();
                next.focus();
            }
        }
    }

    /** A click anywhere else closes it and leaves the focus where the click put it. */
    function onWindowPointerDown(event: MouseEvent): void {
        if (open && root && event.target instanceof Node && !root.contains(event.target)) {
            close(false);
        }
    }
</script>

<svelte:window onmousedown={onWindowPointerDown} />

<!--
    Task 21: the interface picker of the header, a popup rather than a dropdown.

    2.7 had a jQuery multiselect here and the connection block beside it; the maintainer asked for
    one control that says which interface is selected, whether anything is wrong, and - when it is
    opened - what every interface is doing, in items big enough to carry a second line.
-->
<div class="hmm-interface" bind:this={root} data-testid={testId}>
    <button
        type="button"
        class="hmm-interface-trigger"
        bind:this={trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={testId === undefined ? undefined : `${testId}-trigger`}
        onclick={() => (open ? close(false) : openList())}
        onkeydown={onTriggerKeyDown}
    >
        <!--
            The mark leads, the arrow closes: a red ✕ sitting next to the arrow of a picker looks
            like a button that clears the selection, and it is the opposite - a status light.
        -->
        <ConnectionIndicator
            {interfaces}
            {backendConnected}
            {allConnectedText}
            {someNotConnectedText}
            {notPresentText}
            {subscribingText}
            {waitingText}
            testId={testId === undefined ? undefined : `${testId}-summary`}
        />
        {#if callbackWarning !== undefined}
            <!-- B-53: seen without opening anything; the popup says what and offers the way out -->
            <span
                class="hmm-interface-warn"
                title={callbackWarningLabel(callbackWarning)}
                data-testid={testId === undefined ? undefined : `${testId}-callback-warning`}
                aria-hidden="true">⚠</span
            >
        {/if}
        <span class="hmm-interface-trigger-name">{selectedLabel}</span>
        <span class="hmm-interface-arrow" aria-hidden="true">▾</span>
    </button>

    {#if open}
        <div class="hmm-interface-menu">
            <!--
                The CCU this is all about, and the state of the connection to our own backend -
                which is a different thing from an interface that does not answer, and 2.x showed
                the two as one.
            -->
            <div class="hmm-interface-head">
                <span class="hmm-interface-host" data-testid="interface-host">{host === '' ? '—' : host}</span>
                <span class="hmm-interface-backend" data-testid="interface-backend"
                    >{backendConnected ? connectedText : notConnectedText}</span
                >
            </div>

            <div class="hmm-interface-list" role="listbox" aria-label={listLabel}>
                {#if store !== undefined}
                    <!--
                        The store the names, rooms and functions come from: its own row, half the
                        height of an interface item and with a rule under it - it is not an
                        interface process, but it is selected like one and has tabs of its own.
                        One that does not answer stays visible, greyed, with the reason in its
                        title; it is out of the keyboard's way because it is no button.
                    -->
                    {#if store.selectable}
                        <button
                            type="button"
                            role="option"
                            class="hmm-interface-store hmm-meta-{store.mark}"
                            class:hmm-interface-item-current={store.id === selected}
                            aria-selected={store.id === selected}
                            tabindex={storeIndex === activeIndex ? 0 : -1}
                            bind:this={items[storeIndex]}
                            title={store.title}
                            data-mark={store.mark}
                            data-provider={store.provider}
                            data-testid={storeTestId}
                            onclick={() => choose(store.id)}
                            onkeydown={(event) => onItemKeyDown(event, storeIndex)}
                        >
                            <span class="hmm-interface-store-dot" aria-hidden="true"></span>
                            <span class="hmm-interface-store-label">{store.label}</span>
                        </button>
                    {:else}
                        <div
                            role="option"
                            class="hmm-interface-store hmm-interface-store-off hmm-meta-{store.mark}"
                            aria-selected="false"
                            aria-disabled="true"
                            title={store.title}
                            data-mark={store.mark}
                            data-provider={store.provider}
                            data-testid={storeTestId}
                        >
                            <span class="hmm-interface-store-dot" aria-hidden="true"></span>
                            <span class="hmm-interface-store-label">{store.label}</span>
                        </div>
                    {/if}
                {/if}
                {#each interfaces as state, offset (state.name)}
                    {@const mark = markOf(state)}
                    {@const index = storeIndex + 1 + offset}
                    {@const callback = callbackLine(state, publishCallbackPorts, {
                        portInUse: callbackPortInUseLabel,
                        portFailed: callbackPortFailedLabel,
                        publish: publishPortText,
                    })}
                    <button
                        type="button"
                        role="option"
                        class="hmm-interface-item"
                        class:hmm-interface-item-current={state.name === selected}
                        aria-selected={state.name === selected}
                        tabindex={index === activeIndex ? 0 : -1}
                        bind:this={items[index]}
                        title={mark === 'bad' ? (state.error ?? notConnectedText) : undefined}
                        data-testid={`interface-item-${state.name}`}
                        onclick={() => choose(state.name)}
                        onkeydown={(event) => onItemKeyDown(event, index)}
                    >
                        <span class="hmm-interface-item-head">
                            <span class="hmm-interface-item-name">{state.name}</span>
                            <span class="hmm-interface-mark hmm-interface-mark-{mark}" data-mark={mark}>
                                <span class="hmm-interface-glyph" aria-hidden="true">{MARK_GLYPH[mark]}</span>
                                {markText(mark, state)}
                            </span>
                        </span>
                        <span class="hmm-interface-item-line">{lineOf(state)}</span>
                        {#if callback !== undefined}
                            <!-- Task 38: the URL the CCU was told, or why it was told none -->
                            <span
                                class="hmm-interface-item-callback"
                                class:hmm-interface-item-callback-bad={callback.bad}
                                data-testid={`interface-callback-${state.name}`}>{callback.text}</span
                            >
                        {/if}
                    </button>
                {/each}
            </div>

            {#if callbackWarning !== undefined}
                <div class="hmm-interface-warning" role="alert" data-testid="interface-callback-warning">
                    <span>{callbackWarningLabel(callbackWarning)}</span>
                    {#if onuseautomatic !== undefined}
                        <button
                            type="button"
                            class="hmm-interface-retry"
                            bind:this={autoButton}
                            data-testid="interface-callback-use-auto"
                            onclick={() => {
                                close(false);
                                onuseautomatic();
                            }}
                            onkeydown={onFootKeyDown}>{useAutomaticText}</button
                        >
                    {/if}
                </div>
            {/if}

            {#if retryNames.length > 0}
                <!--
                    B-28: an interface that does not answer is retried by the watchdog, with a wait
                    that grows to five minutes. The button tries now. It sits under the list, not in
                    an item: an option that holds a second button is not an option any more.
                -->
                <div class="hmm-interface-foot">
                    <button
                        type="button"
                        class="hmm-interface-retry"
                        bind:this={retryButton}
                        data-testid={testId === undefined ? undefined : `${testId}-retry`}
                        onclick={() => onretry?.(retryNames)}
                        onkeydown={onFootKeyDown}>{retryText}</button
                    >
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .hmm-interface {
        position: relative;
        display: flex;
        align-items: center;
        flex: 0 0 auto;
    }

    /*
        A fixed width, not one that fits the name: the tabs sit right behind this, and a trigger
        that is as wide as "BidCos-Wired" one moment and as wide as "CUxD" the next would move the
        whole tab bar with every interface switch (task 19). The name ellipsises instead.
    */
    .hmm-interface-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 170px;
        height: 24px;
        padding: 0 6px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-control-bg);
        color: inherit;
        font: inherit;
        cursor: pointer;
    }

    .hmm-interface-trigger:hover {
        background: var(--hmm-control-bg-hover);
    }

    .hmm-interface-trigger-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
    }

    .hmm-interface-arrow {
        flex: 0 0 auto;
        color: var(--hmm-fg-muted);
    }

    .hmm-interface-menu {
        position: absolute;
        z-index: 50;
        top: calc(100% + 4px);
        left: 0;
        min-width: 280px;
        max-width: 380px;
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        box-shadow: var(--hmm-shadow-menu);
        overflow: hidden;
    }

    .hmm-interface-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--hmm-border-muted);
        background: var(--hmm-header-bg);
    }

    .hmm-interface-host {
        font-weight: bold;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-interface-backend {
        flex: 0 0 auto;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-interface-list {
        display: flex;
        flex-direction: column;
        padding: 4px;
        gap: 2px;
        max-height: 60vh;
        overflow-y: auto;
    }

    /*
        D-34: the same flat hover and the same active marking as the tab bar - the accent
        background and an inset accent line, nothing that changes a box. The line is on the left
        here because the items are stacked.
    */
    .hmm-interface-item {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 5px 8px;
        border: none;
        border-radius: var(--hmm-radius);
        background: none;
        color: var(--hmm-fg-muted);
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .hmm-interface-item:hover:not(.hmm-interface-item-current) {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }

    .hmm-interface-item-current {
        background: var(--hmm-accent-bg);
        color: var(--hmm-fg);
        box-shadow: inset 2px 0 0 var(--hmm-accent);
    }

    /*
        The store's row: one line where an interface item has two, the full width of the list with
        a rule under it, and the same current-marking as the items - it is a selection like them,
        only a different kind of thing.
    */
    .hmm-interface-store {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 22px;
        margin: 0 0 3px;
        padding: 0 8px;
        border: none;
        border-bottom: 1px solid var(--hmm-border-muted);
        border-radius: var(--hmm-radius) var(--hmm-radius) 0 0;
        background: none;
        color: var(--hmm-fg-muted);
        font: inherit;
        font-size: var(--hmm-font-size-small);
        text-align: left;
        cursor: pointer;
    }

    .hmm-interface-store:hover:not(.hmm-interface-item-current):not(.hmm-interface-store-off) {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }

    .hmm-interface-store-off {
        cursor: default;
        opacity: 0.6;
    }

    .hmm-interface-store-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-interface-store-dot {
        flex: 0 0 auto;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--hmm-fg-muted);
    }

    .hmm-meta-ok .hmm-interface-store-dot {
        background: var(--hmm-ok);
    }

    .hmm-meta-readonly .hmm-interface-store-dot {
        background: var(--hmm-warn);
    }

    .hmm-meta-bad .hmm-interface-store-dot {
        background: var(--hmm-error);
    }

    .hmm-interface-item-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
    }

    .hmm-interface-item-name {
        font-weight: 500;
        color: var(--hmm-fg);
    }

    .hmm-interface-mark {
        flex: 0 0 auto;
        font-size: var(--hmm-font-size-small);
        white-space: nowrap;
    }

    .hmm-interface-glyph {
        display: inline-block;
        width: 12px;
        text-align: center;
    }

    .hmm-interface-item-line {
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    /* Task 38: a URL is long and has no spaces; it wraps rather than widening the menu */
    .hmm-interface-item-callback {
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        overflow-wrap: anywhere;
    }

    .hmm-interface-item-callback-bad {
        color: var(--hmm-error);
    }

    .hmm-interface-mark-ok {
        color: var(--hmm-ok);
    }

    .hmm-interface-mark-bad {
        color: var(--hmm-error);
    }

    .hmm-interface-mark-absent {
        color: var(--hmm-fg-muted);
    }

    .hmm-interface-mark-busy {
        color: var(--hmm-warn);
    }

    .hmm-interface-warn {
        flex: 0 0 auto;
        color: var(--hmm-warn);
    }

    /* B-53: the callback address that does not fit, between the list and its buttons */
    .hmm-interface-warning {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        padding: 6px 10px;
        border-top: 1px solid var(--hmm-border-muted);
        color: var(--hmm-warn);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-interface-warning > span {
        align-self: stretch;
    }

    .hmm-interface-foot {
        display: flex;
        justify-content: flex-end;
        padding: 4px 8px 6px;
        border-top: 1px solid var(--hmm-border-muted);
    }

    .hmm-interface-retry {
        height: 22px;
        padding: 0 10px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-control-bg);
        color: inherit;
        font: inherit;
        font-size: var(--hmm-font-size-small);
        cursor: pointer;
    }

    .hmm-interface-retry:hover {
        background: var(--hmm-control-bg-hover);
    }
</style>
