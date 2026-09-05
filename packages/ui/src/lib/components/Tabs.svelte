<script lang="ts">
    interface Tab {
        readonly id: string;
        readonly label: string;
        /** Drawn after the label in the 2.x way: "Servicemeldungen (9)". */
        readonly badge?: string | number;
    }

    interface Props {
        tabs: Tab[];
        active?: string;
        onselect?: ((id: string) => void) | undefined;
        label?: string;
        testId?: string | undefined;
    }

    let {tabs, active = $bindable(''), onselect = undefined, label = 'Tabs', testId = undefined}: Props = $props();

    function select(id: string): void {
        active = id;
        onselect?.(id);
    }

    /** Left/right arrows move between tabs, which jQuery UI's tab widget also did. */
    function onKeyDown(event: KeyboardEvent, index: number): void {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        if (next) {
            select(next.id);
        }
    }
</script>

<div class="hmm-tabs" role="tablist" aria-label={label} data-testid={testId}>
    {#each tabs as tab, index (tab.id)}
        <button
            type="button"
            class="hmm-tab"
            class:hmm-tab-active={tab.id === active}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={tab.id === active}
            aria-controls={`panel-${tab.id}`}
            tabindex={tab.id === active ? 0 : -1}
            onclick={() => select(tab.id)}
            onkeydown={(event) => onKeyDown(event, index)}
        >
            <span>{tab.label}</span>
            {#if tab.badge !== undefined && tab.badge !== ''}<span class="hmm-tab-badge">({tab.badge})</span>{/if}
        </button>
    {/each}
</div>

<style>
    .hmm-tabs {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: var(--hmm-header-height);
    }

    .hmm-tab {
        padding: 4px 12px;
        border: 1px solid var(--hmm-border);
        border-bottom: none;
        border-radius: var(--hmm-radius) var(--hmm-radius) 0 0;
        background: var(--hmm-header-bg);
        color: var(--hmm-fg-muted);
        cursor: pointer;
        white-space: nowrap;
    }

    .hmm-tab-active {
        background: var(--hmm-bg);
        color: var(--hmm-fg);
        font-weight: bold;
    }

    .hmm-tab-badge {
        margin-left: 4px;
    }
</style>
