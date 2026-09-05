<script lang="ts">
    import type {Snippet} from 'svelte';

    interface Props {
        label?: string;
        children?: Snippet | undefined;
        /** Right-hand side, where the 2.x pager put its record count. */
        trailing?: Snippet | undefined;
        testId?: string | undefined;
    }

    let {label = 'Toolbar', children = undefined, trailing = undefined, testId = undefined}: Props = $props();
</script>

<div class="hmm-toolbar" role="toolbar" aria-label={label} data-testid={testId}>
    <div class="hmm-toolbar-group">
        {#if children}{@render children()}{/if}
    </div>
    {#if trailing}
        <div class="hmm-toolbar-trailing">{@render trailing()}</div>
    {/if}
</div>

<style>
    /* D-34: no framed grey box around the buttons any more - the toolbar is a row of controls on
       the page, and the grid below it brings its own frame. */
    .hmm-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0 0 6px;
    }

    .hmm-toolbar-group {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 1 1 auto;
        flex-wrap: wrap;
    }

    .hmm-toolbar-trailing {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--hmm-fg-muted);
        white-space: nowrap;
    }
</style>
