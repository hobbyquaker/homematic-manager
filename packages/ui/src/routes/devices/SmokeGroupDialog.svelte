<script lang="ts">
    import type {DeviceDescription, SmokeGroup} from '@homematic-manager/core';
    import {isSmokeDetectorChannel, smokeGroupChanges, teamDeviceOf} from '@homematic-manager/core';

    import {untrack} from 'svelte';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        /** The group whose members are edited; a new HmIP group has no members yet. */
        group?: SmokeGroup | undefined;
        /** The group does not exist yet - *New* on an HmIP interface took the lowest free number. */
        isNew?: boolean;
    }

    let {open = $bindable(false), group = undefined, isNew = false}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /** The members as ticked in the dialog. */
    let selected = $state<string[]>([]);
    let busy = $state(false);

    const interfaceName = $derived(stores.app.selectedInterface);
    const index = $derived(stores.devices.index(interfaceName));
    const memberships = $derived(stores.smokeGroups.of(interfaceName));
    const loading = $derived(group?.kind === 'hmip' && stores.smokeGroups.isLoading(interfaceName));

    /**
     * The channels the group can hold. BidCos: every channel with the team's `TEAM_TAG` that is a
     * detector and not a team's own channel. HmIP: every smoke channel; the ones whose MASTER has no
     * `GROUP_n` (the older channel type) are listed, but cannot be ticked - the interface would
     * refuse the write, and the row should say why rather than fail.
     */
    const candidates = $derived.by((): DeviceDescription[] => {
        if (group === undefined || index === undefined) {
            return [];
        }
        const current = group;
        return index.channels().filter((channel) => {
            if ((channel.TEAM_CHANNELS ?? []).length > 0) {
                return false;
            }
            return current.kind === 'team'
                ? (channel.TEAM_TAG ?? '') !== '' && channel.TEAM_TAG === current.teamTag
                : isSmokeDetectorChannel(channel);
        });
    });

    function groupable(address: string): boolean {
        return group?.kind === 'team' || (memberships[address] ?? null) !== null;
    }

    /** Where a candidate is right now, when that is somewhere else: its team, or its other groups. */
    function elsewhere(address: string): string {
        if (group === undefined) {
            return '';
        }
        if (group.kind === 'team') {
            const team = index === undefined ? undefined : teamDeviceOf(index, address);
            if (team === undefined || team === group.address) {
                return '';
            }
            // a team of one is the detector's own; only another team with members is worth a word
            const members = index?.get(index.get(address)?.TEAM ?? '')?.TEAM_CHANNELS ?? [];
            return members.length < 2 ? '' : t('in {team}', {team: stores.nameOf(team)});
        }
        const groups = (memberships[address] ?? []).filter((number) => number !== group.number);
        return groups.length === 0
            ? ''
            : t('also in {groups}', {groups: groups.map((number) => t('Smoke group {n}', {n: number})).join(', ')});
    }

    // the ticks start as the members are when the dialog opens - and only then: the group's members
    // change under an open dialog when the interface reports (after an apply, a refresh), and that
    // must not throw the user's ticks away
    $effect(() => {
        if (!open) {
            return;
        }
        untrack(() => {
            selected = [...(group?.members ?? [])];
        });
    });

    function toggle(address: string, on: boolean): void {
        selected = on ? [...selected, address] : selected.filter((entry) => entry !== address);
    }

    const changes = $derived(smokeGroupChanges(group?.members ?? [], selected));
    const changed = $derived(changes.added.length > 0 || changes.removed.length > 0);

    const title = $derived(
        group === undefined
            ? ''
            : group.kind === 'team'
              ? `${t('Team')}: ${stores.nameOf(group.address)}`
              : t('Smoke group {n}', {n: group.number ?? 0}),
    );

    async function apply(): Promise<void> {
        if (group === undefined || !changed) {
            return;
        }
        // taken now: the group's members follow the interface while the writes run, and with them
        // what counts as a change
        const {added, removed} = changes;
        busy = true;
        try {
            if (group.kind === 'team') {
                const teamChannel = group.teamChannel ?? '';
                const done = await stores.devices.setTeams(interfaceName, [
                    ...added.map((address) => ({address, teamAddress: teamChannel})),
                    // back into a team of its own: the documented way to leave one
                    ...removed.map((address) => ({address, teamAddress: ''})),
                ]);
                if (done === added.length + removed.length) {
                    open = false;
                }
                return;
            }
            const results = await stores.smokeGroups.setMembers(interfaceName, group.number ?? 0, added, removed);
            const refused = results.filter((result) => !result.ok);
            for (const result of refused) {
                stores.notices.push(
                    'error',
                    `${stores.nameOf(result.address)}: ${
                        result.problems.map((problem) => problem.message).join('; ') || (result.faultString ?? '')
                    }`,
                    interfaceName,
                );
            }
            if (refused.length === 0 && results.length === added.length + removed.length) {
                open = false;
            }
        } finally {
            busy = false;
        }
    }
</script>

<!--
    Task 58: the members of one smoke group, from its row in the device list. A BidCos team's
    members move with `setTeam`; an HmIP group's with one MASTER write of `GROUP_n` per detector,
    which stays *configuration pending* until the detector wakes up or is pressed - the row's Msgs
    column shows that, and the members shown afterwards are what the interface reports.
-->
<Dialog bind:open {title} width="600px" testId="smoke-group-dialog">
    {#if group !== undefined}
        <div class="hmm-smoke-form">
            {#if group.kind === 'team'}
                <p class="hmm-smoke-muted">
                    <span class="hmm-mono">{group.address}</span>
                    {#if group.teamTag}
                        — TEAM_TAG <span class="hmm-mono">{group.teamTag}</span>
                    {/if}
                </p>
            {:else}
                <p class="hmm-smoke-muted">
                    {isNew ? t('A new group takes the lowest free number.') : ''}
                    {t('Changes are written to the detectors and take effect once each detector has picked them up.')}
                </p>
            {/if}

            <p class="hmm-smoke-heading">{t('Members')}</p>
            {#if loading && candidates.some((channel) => !(channel.ADDRESS in memberships))}
                <p class="hmm-smoke-muted">{t('Loading')}</p>
            {:else if candidates.length === 0}
                <p class="hmm-smoke-muted" data-testid="smoke-group-none">
                    {t('This interface has no smoke detector')}
                </p>
            {:else}
                <ul class="hmm-smoke-list" data-testid="smoke-group-candidates">
                    {#each candidates as channel (channel.ADDRESS)}
                        {@const can = groupable(channel.ADDRESS)}
                        <li>
                            <label class="hmm-smoke-member" class:hmm-smoke-member-off={!can}>
                                <input
                                    type="checkbox"
                                    disabled={!can}
                                    checked={selected.includes(channel.ADDRESS)}
                                    data-testid={`smoke-group-member-${channel.ADDRESS}`}
                                    onchange={(event) => toggle(channel.ADDRESS, event.currentTarget.checked)}
                                />
                                <span class="hmm-smoke-member-name">{stores.nameOf(channel.ADDRESS)}</span>
                                <span class="hmm-mono hmm-smoke-member-id">{channel.ADDRESS}</span>
                                <span class="hmm-smoke-member-note">
                                    {can ? elsewhere(channel.ADDRESS) : t('cannot be grouped - no GROUP parameters')}
                                </span>
                            </label>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || !changed}
            data-testid="smoke-group-apply"
            onclick={() => void apply()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-smoke-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .hmm-smoke-heading {
        margin: 6px 0 0;
        font-weight: 600;
    }

    .hmm-smoke-muted {
        margin: 0;
        color: var(--hmm-fg-muted);
    }

    .hmm-smoke-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 300px;
        overflow: auto;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
    }

    .hmm-smoke-list li {
        border-top: 1px solid var(--hmm-border);
    }

    .hmm-smoke-list li:first-child {
        border-top: 0;
    }

    .hmm-smoke-member {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        gap: 10px;
        align-items: center;
        padding: 4px 8px;
    }

    .hmm-smoke-member-off {
        color: var(--hmm-fg-muted);
    }

    .hmm-smoke-member-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-smoke-member-id,
    .hmm-smoke-member-note {
        color: var(--hmm-fg-muted);
        white-space: nowrap;
        font-size: var(--hmm-font-size-small);
    }
</style>
