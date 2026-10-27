<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import type {Translate} from '../../lib/util/metaTree.js';

    /**
     * One name, asked for: a new taxonomy, a new node, a rename. Self-contained on purpose - it is
     * part of the editor that is going to be ported into occulited's own web UI, so it takes its
     * translator and reports through a callback instead of reaching for a store.
     */
    interface Props {
        open?: boolean;
        title: string;
        /** What the input asks for: "Name", "New name", "Add below: Kitchen". */
        label: string;
        /** The name to start from; empty for a new node. */
        initial?: string;
        t: Translate;
        /** Answers whether the write was accepted; the dialog closes only then. */
        onapply: (name: string) => Promise<boolean>;
        testId?: string;
    }

    let {open = $bindable(false), title, label, initial = '', t, onapply, testId = 'meta-name'}: Props = $props();

    let name = $state('');
    let busy = $state(false);
    let input = $state<HTMLInputElement | undefined>(undefined);

    $effect(() => {
        if (open) {
            name = initial;
            busy = false;
            // after the dialog is shown, so the focus lands in it and not in the page behind
            queueMicrotask(() => {
                input?.focus();
                input?.select();
            });
        }
    });

    async function apply(): Promise<void> {
        const trimmed = name.trim();
        if (trimmed === '' || busy) {
            return;
        }
        busy = true;
        const ok = await onapply(trimmed);
        busy = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open {title} width="440px" testId={`${testId}-dialog`}>
    <label class="hmm-meta-name-row">
        <span>{label}</span>
        <input
            class="hmm-input hmm-meta-name-input"
            bind:this={input}
            bind:value={name}
            aria-label={label}
            data-testid={`${testId}-input`}
            onkeydown={(event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    void apply();
                }
            }}
        />
    </label>

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || name.trim() === ''}
            data-testid={`${testId}-apply`}
            onclick={() => void apply()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-meta-name-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .hmm-meta-name-input {
        width: 100%;
    }
</style>
