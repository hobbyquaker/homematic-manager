<script lang="ts">
    import type {InterfaceState} from '@homematic-manager/core';

    import ConnectionIndicator from './ConnectionIndicator.svelte';
    import {detailParts, MARK_GLYPH, markOf, type InterfaceDetails, type InterfaceMark} from './interfacePopup.js';

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
        subscribingText?: string;
        allConnectedText?: string;
        someNotConnectedText?: string;
        portLabel?: string;
        tlsLabel?: string;
        devicesLabel?: (count: number) => string;
        dutyCycleLabel?: (value: number) => string;
        onselect?: ((interfaceName: string) => void) | undefined;
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
        subscribingText = 'Subscribing',
        allConnectedText = 'All interfaces are connected',
        someNotConnectedText = 'Not every interface is connected',
        portLabel = 'Port',
        tlsLabel = 'TLS',
        devicesLabel = (count: number) => `${String(count)} devices`,
        dutyCycleLabel = (value: number) => `Duty cycle ${String(value)} %`,
        onselect = undefined,
        testId = undefined,
    }: Props = $props();

    let open = $state(false);
    let activeIndex = $state(0);
    let root = $state<HTMLDivElement | undefined>(undefined);
    let trigger = $state<HTMLButtonElement | undefined>(undefined);
    /** The option buttons, by index; `bind:this` fills and clears them. */
    let items = $state<Array<HTMLButtonElement | undefined>>([]);

    const selectedIndex = $derived(interfaces.findIndex((state) => state.name === selected));

    /** The words beside the glyph; every state says what it is, not only the broken ones. */
    function markText(mark: InterfaceMark): string {
        switch (mark) {
            case 'ok': {
                return connectedText;
            }
            case 'busy': {
                return subscribingText;
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
        if (interfaces.length === 0) {
            return;
        }
        activeIndex = (activeIndex + delta + interfaces.length) % interfaces.length;
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
                activeIndex = interfaces.length - 1;
                break;
            }
            case 'Enter':
            case ' ': {
                // `preventDefault` first: without it the browser turns the key into a click on the
                // button and the item would be chosen twice.
                event.preventDefault();
                choose(interfaces[index]?.name ?? '');
                break;
            }
            case 'Escape': {
                event.preventDefault();
                close(true);
                break;
            }
            case 'Tab': {
                // Leaving by keyboard closes it, but the focus goes where the user sent it.
                close(false);
                break;
            }
            default: {
                break;
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
        <span class="hmm-interface-trigger-name">{selected}</span>
        <ConnectionIndicator
            {interfaces}
            {backendConnected}
            {allConnectedText}
            {someNotConnectedText}
            {notPresentText}
            {subscribingText}
            testId={testId === undefined ? undefined : `${testId}-summary`}
        />
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
                {#each interfaces as state, index (state.name)}
                    {@const mark = markOf(state)}
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
                                {markText(mark)}
                            </span>
                        </span>
                        <span class="hmm-interface-item-line">{lineOf(state)}</span>
                    </button>
                {/each}
            </div>
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
</style>
