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
    /*
        D-34: flat tab buttons in the `she` idiom, and - the maintainer's addition - a tab that is
        exactly as wide when it is active as when it is not, so the bar never moves when the user
        switches. That rules out the bold-on-active of the 2.x look: the active tab is marked by a
        background, the text colour and an inset underline, none of which changes a layout box.
    */
    .hmm-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        height: var(--hmm-header-height);
    }

    .hmm-tab {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 12px;
        border: none;
        border-radius: var(--hmm-radius);
        background: none;
        color: var(--hmm-fg-muted);
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
    }

    .hmm-tab:hover:not(.hmm-tab-active) {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }

    .hmm-tab-active {
        background: var(--hmm-accent-bg);
        color: var(--hmm-fg);
        /* An inset shadow, not a border: a border would make the active tab a pixel taller. */
        box-shadow: inset 0 -2px 0 var(--hmm-accent);
    }

    .hmm-tab-badge {
        color: var(--hmm-fg-muted);
    }
</style>
