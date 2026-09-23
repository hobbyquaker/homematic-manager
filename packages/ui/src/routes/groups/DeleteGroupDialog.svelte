<script lang="ts">
    import type {HeatingGroup, HeatingGroupMember} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    /**
     * Task 57: the question before a group goes. It names the members that leave it and the
     * virtual device that disappears with it - the CCU's WebUI asked the same before its delete.
     */
    interface Props {
        open?: boolean;
        group?: HeatingGroup | undefined;
    }

    let {open = $bindable(false), group = undefined}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let busy = $state(false);

    $effect(() => {
        if (open) {
            busy = false;
        }
    });

    function label(member: HeatingGroupMember): string {
        const known = stores.names.name(member.id);
        return known === undefined ? member.id : `${known} (${member.id})`;
    }

    async function apply(): Promise<void> {
        if (busy || group === undefined) {
            return;
        }
        busy = true;
        const ok = await stores.groups.remove(group.id);
        busy = false;
        if (ok) {
            open = false;
        }
    }
</script>

<Dialog bind:open title={t('Delete group')} width="480px" testId="group-delete-dialog">
    {#if group !== undefined}
        <p class="hmm-group-delete-subject" data-testid="group-delete-subject">{group.name}</p>
        <p class="hmm-group-delete-note">
            {t('The members leave the group and the virtual device {device} is removed', {device: group.device})}
        </p>
        {#if group.members.length > 0}
            <ul class="hmm-group-delete-members" data-testid="group-delete-members">
                {#each group.members as member (member.id)}
                    <li>{label(member)}</li>
                {/each}
            </ul>
        {/if}
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button hmm-group-delete-danger"
            disabled={busy || group === undefined}
            data-testid="group-delete-apply"
            onclick={() => void apply()}>{t('Delete')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-group-delete-subject {
        margin: 0 0 6px;
        font-weight: 600;
    }

    .hmm-group-delete-note {
        margin: 0 0 8px;
        color: var(--hmm-fg-muted);
    }

    .hmm-group-delete-members {
        margin: 0;
        padding-left: 20px;
        max-height: 200px;
        overflow: auto;
    }

    .hmm-group-delete-danger {
        color: var(--hmm-error);
    }
</style>
