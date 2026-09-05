<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        /** The channel whose team is being changed; always a channel, never a device. */
        address?: string;
    }

    let {open = $bindable(false), address = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let teams = $state<DeviceDescription[]>([]);
    let chosen = $state('');
    let busy = $state(false);

    const interfaceName = $derived(stores.app.selectedInterface);
    const index = $derived(stores.devices.index(interfaceName));
    const channel = $derived(index?.get(address));
    /** Which family of team this channel fits; a channel without one cannot be in a team at all. */
    const tag = $derived(channel?.TEAM_TAG ?? '');
    const current = $derived(channel?.TEAM ?? '');

    /**
     * The teams this channel may join: the ones whose own `TEAM_TAG` matches. A smoke detector
     * cannot join a shutter contact's team, and the interface process would refuse it anyway.
     */
    const candidates = $derived(teams.filter((team) => (team.TEAM_TAG ?? '') === tag));

    $effect(() => {
        if (!open || interfaceName === '' || address === '') {
            return;
        }
        chosen = current;
        void stores.devices.teams(interfaceName).then((list) => {
            teams = list;
        });
    });

    /** The members of a team, so the dialog can say what joining one means. */
    function membersOf(team: DeviceDescription): string {
        const members = team.TEAM_CHANNELS ?? [];
        return members.length === 0 ? t('No data') : members.map((entry) => stores.nameOf(entry)).join(', ');
    }

    async function apply(): Promise<void> {
        busy = true;
        const ok = await stores.devices.setTeam(interfaceName, address, chosen);
        busy = false;
        if (ok) {
            open = false;
        }
    }
</script>

<!--
    Issue #97: "Gibt es einen weg Sec-SD-2 Gruppen zu stellen? Im Moment hat jeder Melder seine
    eigene Gruppe. Die Rauchmelder sind ja nicht direkt verknüpft wie sonst üblich."

    They are not: a BidCos smoke detector belongs to a *team*, a pseudo device the interface process
    creates and deletes by itself, and `setTeam` is the only call involved. Every detector starts in
    a team of its own - exactly what the report describes - and putting them in one team is choosing
    one of those and moving the others into it.
-->
<Dialog bind:open title={t('Team')} width="560px" testId="team-dialog">
    {#if tag === ''}
        <p data-testid="team-none">{t('This channel does not belong to a team')}</p>
    {:else}
        <p>
            <span class="hmm-mono">{address}</span>
            — TEAM_TAG <span class="hmm-mono">{tag}</span>
        </p>
        <label class="hmm-team-row">
            <span>{t('Team')}</span>
            <select class="hmm-select" bind:value={chosen} data-testid="team-select">
                <!--
                    The empty string is `setTeam(address, "")`: back into a team of its own. It is
                    the documented way to leave one, not a placeholder.
                -->
                <option value="">{t('Own team')}</option>
                {#each candidates as team (team.ADDRESS)}
                    <option value={team.ADDRESS}>
                        {stores.nameOf(team.ADDRESS)} ({team.ADDRESS})
                    </option>
                {/each}
            </select>
        </label>

        {#if chosen !== ''}
            {@const team = candidates.find((entry) => entry.ADDRESS === chosen)}
            {#if team}
                <p class="hmm-team-members" data-testid="team-members">
                    {t('Members')}: {membersOf(team)}
                </p>
            {/if}
        {/if}

        {#if candidates.length === 0}
            <p class="hmm-team-empty" data-testid="team-empty">{t('The interface knows no other team yet')}</p>
        {/if}
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || tag === '' || chosen === current}
            data-testid="team-apply"
            onclick={() => void apply()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-team-row {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 8px;
        align-items: center;
    }

    .hmm-team-members {
        color: var(--hmm-fg-muted);
    }

    .hmm-team-empty {
        color: var(--hmm-warn);
    }
</style>
