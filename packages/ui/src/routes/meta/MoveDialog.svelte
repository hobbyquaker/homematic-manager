<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import type {Translate} from '../../lib/util/metaTree.js';
    import {indentedLabel, type NodeOption} from '../../lib/util/taxonomy.js';

    /**
     * The new parent of a node: the top level of its taxonomy, or one of the nodes the caller
     * offers - which is every node of the same taxonomy that is not the node or below it
     * (`moveTargets` in `metaTree.ts`).
     */
    interface Props {
        open?: boolean;
        title: string;
        /** The name of the node being moved, for the title line. */
        subject: string;
        targets: readonly NodeOption[];
        /** The parent it has today; `''` for the top level. */
        current?: string;
        t: Translate;
        /** `null` is the top level. Answers whether the move was accepted. */
        onapply: (parent: string | null) => Promise<boolean>;
        testId?: string;
    }

    let {
        open = $bindable(false),
        title,
        subject,
        targets,
        current = '',
        t,
        onapply,
        testId = 'meta-move',
    }: Props = $props();

    let parent = $state('');
    let busy = $state(false);

    $effect(() => {
        if (open) {
            parent = current;
            busy = false;
        }
    });

    async function apply(): Promise<void> {
        if (busy) {
            return;
        }
        busy = true;
        const ok = await onapply(parent === '' ? null : parent);
        busy = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open {title} width="440px" testId={`${testId}-dialog`}>
    <p class="hmm-meta-move-subject">{subject}</p>
    <label class="hmm-meta-move-row">
        <span>{t('Move to')}</span>
        <!--
            A plain select with the depth drawn as indentation, the `size` turning it into a list
            so the tree is visible at a glance - the same control the assign dialog uses.
        -->
        <select
            class="hmm-select hmm-meta-move-select"
            size={Math.min(12, Math.max(4, targets.length + 1))}
            bind:value={parent}
            aria-label={t('Move to')}
            data-testid={`${testId}-parent`}
        >
            <option value="">{t('Top level')}</option>
            {#each targets as option (option.path)}
                <option value={option.path}>{indentedLabel(option, ' ')}</option>
            {/each}
        </select>
    </label>

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy}
            data-testid={`${testId}-apply`}
            onclick={() => void apply()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-meta-move-subject {
        margin: 0 0 6px;
        font-weight: 600;
    }

    .hmm-meta-move-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .hmm-meta-move-select {
        width: 100%;
    }
</style>
