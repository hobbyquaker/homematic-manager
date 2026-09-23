<script lang="ts">
    import type {HeatingGroup, HeatingGroupMember, HeatingGroupType} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    /**
     * Task 57: one group - a new one, or an existing one's name and members.
     *
     * The WebUI's editor, as far as it goes: a name, a type (chosen once, when the group is made -
     * the system offers no way to change it afterwards, and neither did the WebUI), and the
     * devices. The devices are what the system says a group of this type could take right now,
     * plus the members it already has; a device that fits the type but is already connected
     * elsewhere is listed below them and cannot be ticked, exactly as the WebUI listed it. The
     * WebUI's "deactivate single device operation" switch is hidden in its own page and is not
     * offered here either; the system keeps the value.
     *
     * Saving sends the members as a whole - adding and removing is the same call with the new list.
     */
    interface Props {
        open?: boolean;
        /** The group to edit; `undefined` makes a new one. */
        group?: HeatingGroup | undefined;
    }

    let {open = $bindable(false), group = undefined}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let name = $state('');
    let typeId = $state('');
    let selected = $state<string[]>([]);
    let types = $state<HeatingGroupType[]>([]);
    /** In edit mode: what the system said the group could take, beside its members. */
    let assignable = $state<HeatingGroupMember[]>([]);
    let leftover = $state<HeatingGroupMember[]>([]);
    let members = $state<HeatingGroupMember[]>([]);
    let loading = $state(false);
    let busy = $state(false);
    /** The members as the group had them when the dialog opened, sorted, for the "changed" check. */
    let initialMembers = $state<string[]>([]);

    const isNew = $derived(group === undefined);
    const chosenType = $derived(types.find((type) => type.id === typeId));

    /**
     * What can be ticked: in a new group the chosen type's candidates, in an existing one its
     * members followed by what it could take. Members first, so a person sees what is there.
     */
    const candidates = $derived.by((): HeatingGroupMember[] => {
        if (isNew) {
            return chosenType?.assignable ?? [];
        }
        const ids = new Set(members.map((member) => member.id));
        return [...members, ...assignable.filter((member) => !ids.has(member.id))];
    });

    const connected = $derived(isNew ? (chosenType?.leftover ?? []) : leftover);

    const nameChanged = $derived(group !== undefined && name.trim() !== group.name);
    const membersChanged = $derived(!isNew && [...selected].sort().join('\n') !== initialMembers.join('\n'));
    const canSave = $derived(
        !busy && !loading && name.trim() !== '' && (isNew ? typeId !== '' : nameChanged || membersChanged),
    );

    $effect(() => {
        if (!open) {
            return;
        }
        // every open starts afresh from what the system says now - the candidates change with
        // every other group that is made
        busy = false;
        void load(group);
    });

    async function load(current: HeatingGroup | undefined): Promise<void> {
        loading = true;
        name = current?.name ?? '';
        selected = [];
        types = [];
        assignable = [];
        leftover = [];
        members = [];
        initialMembers = [];
        try {
            if (current === undefined) {
                types = await stores.groups.types();
                typeId = types[0]?.id ?? '';
                return;
            }
            const detail = await stores.groups.detail(current.id);
            if (detail === undefined) {
                open = false;
                return;
            }
            name = detail.name;
            typeId = detail.type;
            types = detail.types.map((type) => ({...type, assignable: [], leftover: []}));
            members = detail.members;
            assignable = detail.assignable;
            leftover = detail.leftover;
            selected = detail.members.map((member) => member.id);
            initialMembers = [...selected].sort();
        } finally {
            loading = false;
        }
    }

    /** When the type changes in a new group, the ticks of the old type's candidates go with it. */
    function chooseType(id: string): void {
        typeId = id;
        selected = [];
    }

    function toggle(id: string, on: boolean): void {
        selected = on ? [...selected.filter((entry) => entry !== id), id] : selected.filter((entry) => entry !== id);
    }

    /** A device as a person reads it: the name where one is known, the address always. */
    function label(member: HeatingGroupMember): string {
        const known = stores.names.name(member.id);
        return known === undefined ? member.id : known;
    }

    async function save(): Promise<void> {
        if (!canSave) {
            return;
        }
        busy = true;
        const trimmed = name.trim();
        const answer =
            group === undefined
                ? await stores.groups.create(trimmed, typeId, selected)
                : await stores.groups.update(
                      group.id,
                      nameChanged ? trimmed : undefined,
                      membersChanged ? selected : undefined,
                  );
        busy = false;
        if (answer !== undefined) {
            open = false;
        }
    }
</script>

<Dialog bind:open title={isNew ? t('New group') : t('Edit group')} width="620px" minHeight={360} testId="group-dialog">
    <div class="hmm-group-form">
        <label class="hmm-group-row">
            <span>{t('Group name')}</span>
            <input
                class="hmm-input"
                bind:value={name}
                maxlength="64"
                disabled={loading}
                data-testid="group-name"
                onkeydown={(event) => {
                    if (event.key === 'Enter') {
                        void save();
                    }
                }}
            />
        </label>
        <label class="hmm-group-row">
            <span>{t('Group type')}</span>
            {#if isNew}
                <select
                    class="hmm-select"
                    value={typeId}
                    disabled={loading || types.length === 0}
                    data-testid="group-type"
                    onchange={(event) => chooseType(event.currentTarget.value)}
                >
                    {#each types as type (type.id)}
                        <option value={type.id}>{t(type.label)}</option>
                    {/each}
                </select>
            {:else}
                <span data-testid="group-type">{t(chosenType?.label ?? typeId)}</span>
            {/if}
        </label>
        {#if group !== undefined}
            <div class="hmm-group-row">
                <span>{t('Virtual device')}</span>
                <span class="hmm-mono" data-testid="group-device">{group.device}</span>
            </div>
        {/if}

        <p class="hmm-group-heading">{t('Addable devices')}</p>
        {#if loading}
            <p class="hmm-group-muted">{t('Loading')}</p>
        {:else if candidates.length === 0}
            <p class="hmm-group-muted" data-testid="group-no-candidates">{t('There are no other devices available')}</p>
        {:else}
            <ul class="hmm-group-list" data-testid="group-candidates">
                {#each candidates as member (member.id)}
                    <li>
                        <label class="hmm-group-member">
                            <input
                                type="checkbox"
                                checked={selected.includes(member.id)}
                                data-testid={`group-member-${member.id}`}
                                onchange={(event) => toggle(member.id, event.currentTarget.checked)}
                            />
                            <span class="hmm-group-member-name">{label(member)}</span>
                            <span class="hmm-mono hmm-group-member-id">{member.id}</span>
                            <span class="hmm-group-member-type">{member.type}</span>
                        </label>
                    </li>
                {/each}
            </ul>
        {/if}

        {#if !loading && connected.length > 0}
            <!-- the WebUI's third table: they fit the type, and they are already connected elsewhere -->
            <p class="hmm-group-heading">{t('Already connected devices')}</p>
            <ul class="hmm-group-list hmm-group-list-muted" data-testid="group-connected">
                {#each connected as member (member.id)}
                    <li class="hmm-group-member">
                        <span class="hmm-group-member-name">{label(member)}</span>
                        <span class="hmm-mono hmm-group-member-id">{member.id}</span>
                        <span class="hmm-group-member-type">{member.type}</span>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={!canSave}
            data-testid="group-save"
            onclick={() => void save()}>{isNew ? t('Create') : t('Save')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-group-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .hmm-group-row {
        display: grid;
        grid-template-columns: 140px 1fr;
        gap: 8px;
        align-items: center;
    }

    .hmm-group-heading {
        margin: 10px 0 0;
        font-weight: 600;
    }

    .hmm-group-muted {
        margin: 0;
        color: var(--hmm-fg-muted);
    }

    .hmm-group-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 260px;
        overflow: auto;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
    }

    .hmm-group-list li {
        border-top: 1px solid var(--hmm-border);
    }

    .hmm-group-list li:first-child {
        border-top: 0;
    }

    .hmm-group-list-muted {
        color: var(--hmm-fg-muted);
    }

    .hmm-group-member {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        gap: 10px;
        align-items: center;
        padding: 4px 8px;
    }

    .hmm-group-list-muted .hmm-group-member {
        grid-template-columns: 1fr auto auto;
    }

    .hmm-group-member-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-group-member-id,
    .hmm-group-member-type {
        color: var(--hmm-fg-muted);
        white-space: nowrap;
    }
</style>
