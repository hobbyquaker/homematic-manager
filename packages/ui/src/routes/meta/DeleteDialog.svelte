<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import type {Translate} from '../../lib/util/metaTree.js';

    /**
     * The question before a taxonomy or a node goes: what is still assigned there. The store
     * refuses the deletion while anything is (`has-members`), so a subtree with members is
     * deleted *and detached* in one revision, and the dialog says so with its button - the user
     * never sees a refusal for something the dialog could have told them first.
     */
    interface Props {
        open?: boolean;
        title: string;
        /** The name of what is about to go. */
        subject: string;
        /** The refs still assigned in the subtree, sorted. */
        members: readonly string[];
        /** A member's name for the list; the ref itself when unknown. */
        labelOf?: ((ref: string) => string) | undefined;
        t: Translate;
        /** `detach` is true when members exist. Answers whether the deletion was accepted. */
        onapply: (detach: boolean) => Promise<boolean>;
        testId?: string;
    }

    let {
        open = $bindable(false),
        title,
        subject,
        members,
        labelOf = undefined,
        t,
        onapply,
        testId = 'meta-delete',
    }: Props = $props();

    let busy = $state(false);

    $effect(() => {
        if (open) {
            busy = false;
        }
    });

    async function apply(): Promise<void> {
        if (busy) {
            return;
        }
        busy = true;
        const ok = await onapply(members.length > 0);
        busy = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open {title} width="480px" testId={`${testId}-dialog`}>
    <p class="hmm-meta-delete-subject">{subject}</p>
    {#if members.length === 0}
        <p class="hmm-meta-delete-empty">{t('Nothing is assigned here')}</p>
    {:else}
        <p class="hmm-meta-delete-title">{t('Still assigned here - the assignments are removed with the node:')}</p>
        <ul class="hmm-meta-delete-members" data-testid={`${testId}-members`}>
            {#each members as ref (ref)}
                <li>{labelOf === undefined ? ref : labelOf(ref)}</li>
            {/each}
        </ul>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button hmm-meta-delete-danger"
            disabled={busy}
            data-testid={`${testId}-apply`}
            onclick={() => void apply()}>{members.length === 0 ? t('Delete') : t('Delete and detach')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-meta-delete-subject {
        margin: 0 0 6px;
        font-weight: 600;
    }

    .hmm-meta-delete-title,
    .hmm-meta-delete-empty {
        margin: 0;
    }

    .hmm-meta-delete-empty {
        color: var(--hmm-fg-muted);
    }

    .hmm-meta-delete-members {
        margin: 6px 0 0;
        padding-left: 20px;
        max-height: 160px;
        overflow: auto;
    }

    .hmm-meta-delete-danger {
        color: var(--hmm-error);
    }
</style>
