<script lang="ts">
    import {clampMenuPosition, type ContextMenuItem} from './contextMenu.js';

    interface Props {
        items: ContextMenuItem[];
        open?: boolean;
        x?: number;
        y?: number;
        onselect?: ((id: string) => void) | undefined;
        onclose?: (() => void) | undefined;
        label?: string;
        testId?: string | undefined;
    }

    let {
        items,
        open = $bindable(false),
        x = 0,
        y = 0,
        onselect = undefined,
        onclose = undefined,
        label = 'Menu',
        testId = undefined,
    }: Props = $props();

    let menu = $state<HTMLDivElement | undefined>(undefined);
    let position = $state({x: 0, y: 0});

    /**
     * The per-row menu the 2.x grids reached through the pager buttons only. Everything it offers
     * is also on the toolbar, so a browser that swallows the context menu loses nothing.
     */
    $effect(() => {
        if (!open || !menu) {
            return;
        }
        const rect = menu.getBoundingClientRect();
        position = clampMenuPosition(
            x,
            y,
            {width: rect.width || 180, height: rect.height || 0},
            {width: window.innerWidth, height: window.innerHeight},
        );
        const first = menu.querySelector<HTMLButtonElement>('button:not(:disabled)');
        first?.focus();
    });

    function close(): void {
        open = false;
        onclose?.();
    }

    function choose(item: ContextMenuItem): void {
        if (item.disabled === true || item.separator === true) {
            return;
        }
        close();
        onselect?.(item.id);
    }

    function onKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    }
</script>

<svelte:window
    onkeydown={onKeyDown}
    onmousedown={(event) => {
        if (open && menu && event.target instanceof Node && !menu.contains(event.target)) {
            close();
        }
    }}
/>

{#if open}
    <div
        class="hmm-context-menu"
        bind:this={menu}
        role="menu"
        aria-label={label}
        data-testid={testId}
        style:left={`${position.x}px`}
        style:top={`${position.y}px`}
    >
        {#each items as item (item.id)}
            {#if item.separator === true}
                <div class="hmm-context-separator" role="separator"></div>
            {:else}
                <button
                    type="button"
                    class="hmm-context-item"
                    class:hmm-context-danger={item.danger === true}
                    role="menuitem"
                    disabled={item.disabled === true}
                    onclick={() => choose(item)}
                >
                    {item.label ?? item.id}
                </button>
            {/if}
        {/each}
    </div>
{/if}

<style>
    .hmm-context-menu {
        position: fixed;
        z-index: 100;
        min-width: 180px;
        padding: 2px 0;
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        box-shadow: var(--hmm-shadow-menu);
    }

    .hmm-context-item {
        display: block;
        width: 100%;
        padding: 3px 10px;
        border: none;
        background: none;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    .hmm-context-item:hover:not(:disabled) {
        background: var(--hmm-row-selected);
        color: var(--hmm-row-selected-text);
    }

    .hmm-context-item:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .hmm-context-danger {
        color: var(--hmm-error);
    }

    .hmm-context-separator {
        height: 1px;
        margin: 2px 0;
        background: var(--hmm-border-muted);
    }
</style>
