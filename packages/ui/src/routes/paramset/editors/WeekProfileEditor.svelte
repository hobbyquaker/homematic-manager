<script lang="ts">
    import {numericBound, toDisplayValue, unitLabel} from '@homematic-manager/core';

    import {
        copyWeekDay,
        copyWeekProfile,
        formatMinutes,
        parseMinutes,
        readSlot,
        slotParam,
        validateWeekProfile,
        WEEKDAY_LABELS,
        WEEKDAYS,
        type EditorChange,
        type EditorValues,
        type WeekProfileProblem,
        type WeekProfileSpec,
    } from '../../../lib/util/editors/index.js';
    import {getStores} from '../../../lib/stores/context.js';

    interface Props {
        spec: WeekProfileSpec;
        values: EditorValues;
        channelType: string;
        onchange: EditorChange;
    }

    let {spec, values, channelType, onchange}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let profileIndex = $state(0);
    let day = $state<string>(WEEKDAYS[0] ?? 'MONDAY');
    let copyDayTarget = $state('*');
    let copyProfileTarget = $state('');

    const profile = $derived(spec.profiles[profileIndex] ?? spec.profiles[0]);
    const unit = $derived(unitLabel(spec.valueDescription));
    const problems = $derived(validateWeekProfile(spec, values));
    const valueMin = $derived(toDisplayValue(numericBound(spec.valueDescription, 'MIN'), spec.valueDescription));
    const valueMax = $derived(toDisplayValue(numericBound(spec.valueDescription, 'MAX'), spec.valueDescription));
    /** `Temperatur` - the string table names the bare field, not `P1_TEMPERATURE_MONDAY_1`. */
    const valueHeader = $derived(stores.meta.parameterLabel(spec.valueField, channelType));
    const dayProblems = $derived(problems.filter((problem) => problem.profile === (profile?.id ?? '')));

    function dayLabel(name: string): string {
        const index = spec.days.indexOf(name);
        const key = WEEKDAY_LABELS[index];
        return key === undefined ? name : t(key);
    }

    function profileLabel(id: string): string {
        return id === '' ? t('Week programme') : `${t('Profile')} ${id.slice(1)}`;
    }

    /** The slot before this one ends where this one starts; the first one starts at midnight. */
    function startOf(slot: number): string {
        if (!profile || slot === 1) {
            return formatMinutes(0);
        }
        return formatMinutes(readSlot(spec, values, profile, day, slot - 1).endTime ?? 0);
    }

    function changeEndTime(slot: number, text: string): void {
        const minutes = parseMinutes(text);
        if (minutes === undefined || !profile) {
            return;
        }
        onchange({[slotParam(profile.endTimePrefix, day, slot)]: minutes});
    }

    function changeValue(slot: number, text: string): void {
        const shown = Number(text);
        if (text === '' || !Number.isFinite(shown) || !profile) {
            return;
        }
        onchange({[slotParam(profile.valuePrefix, day, slot)]: shown});
    }

    function applyCopyDay(): void {
        if (!profile) {
            return;
        }
        const targets = copyDayTarget === '*' ? spec.days : [copyDayTarget];
        onchange(copyWeekDay(spec, values, profile, day, targets));
    }

    function applyCopyProfile(): void {
        const to = spec.profiles.find((entry) => entry.id === copyProfileTarget);
        if (!profile || !to) {
            return;
        }
        onchange(copyWeekProfile(spec, values, profile, [to]));
    }

    function problemText(problem: WeekProfileProblem): string {
        const params = {day: dayLabel(problem.day), slot: String(problem.slot), end: formatMinutes(spec.dayEnd)};
        switch (problem.code) {
            case 'not-increasing':
                return t('{day}: end time {slot} is not after the one before it', params);
            case 'after-day-end':
                return t('{day}: end time {slot} comes after the day has ended', params);
            case 'day-not-closed':
                return t('{day}: the last end time must be {end}', params);
        }
    }
</script>

<div class="hmm-editor" data-testid="editor-week-profile">
    <h3>{t('Week programme')}</h3>
    <p class="hmm-editor-hint">
        {t('The end times of a day rise until {end}, and the last one is {end}', {end: formatMinutes(spec.dayEnd)})}
    </p>

    {#if spec.profiles.length > 1}
        <div class="hmm-week-bar">
            {#each spec.profiles as entry, index (entry.id)}
                <button
                    type="button"
                    class="hmm-button"
                    class:hmm-week-active={index === profileIndex}
                    data-testid={`week-profile-${entry.id}`}
                    onclick={() => (profileIndex = index)}>{profileLabel(entry.id)}</button
                >
            {/each}
            <span class="hmm-week-spacer"></span>
            <label class="hmm-week-copy">
                <span>{t('Copy profile to')}</span>
                <select class="hmm-select" bind:value={copyProfileTarget} data-testid="week-copy-profile-target">
                    <option value="">—</option>
                    {#each spec.profiles as entry (entry.id)}
                        {#if entry.id !== profile?.id}
                            <option value={entry.id}>{profileLabel(entry.id)}</option>
                        {/if}
                    {/each}
                </select>
            </label>
            <button
                type="button"
                class="hmm-button"
                disabled={!spec.writable || copyProfileTarget === ''}
                data-testid="week-copy-profile"
                onclick={applyCopyProfile}>{t('Copy')}</button
            >
        </div>
    {/if}

    <div class="hmm-week-bar">
        {#each spec.days as name (name)}
            <button
                type="button"
                class="hmm-button"
                class:hmm-week-active={name === day}
                data-testid={`week-day-${name}`}
                onclick={() => (day = name)}>{dayLabel(name)}</button
            >
        {/each}
        <span class="hmm-week-spacer"></span>
        <label class="hmm-week-copy">
            <span>{t('Copy day to')}</span>
            <select class="hmm-select" bind:value={copyDayTarget} data-testid="week-copy-day-target">
                <option value="*">{t('Weekdays')}</option>
                {#each spec.days as name (name)}
                    {#if name !== day}
                        <option value={name}>{dayLabel(name)}</option>
                    {/if}
                {/each}
            </select>
        </label>
        <button
            type="button"
            class="hmm-button"
            disabled={!spec.writable}
            data-testid="week-copy-day"
            onclick={applyCopyDay}>{t('Copy')}</button
        >
    </div>

    <table class="hmm-week-table">
        <thead>
            <tr>
                <th>{t('Slot')}</th>
                <th>{t('Time')}</th>
                <th>{t('until')}</th>
                <th>{valueHeader}</th>
            </tr>
        </thead>
        <tbody>
            {#each Array.from({length: spec.slots}, (_, index) => index + 1) as slot (slot)}
                {@const held = profile ? readSlot(spec, values, profile, day, slot) : undefined}
                <tr data-testid={`week-slot-${slot}`}>
                    <td class="hmm-week-index">{slot}</td>
                    <td class="hmm-week-from">{startOf(slot)}</td>
                    <td>
                        <input
                            class="hmm-input hmm-week-time"
                            type="text"
                            inputmode="numeric"
                            disabled={!spec.writable}
                            aria-label={`${t('until')} ${slot}`}
                            data-testid={`week-slot-${slot}-endtime`}
                            value={formatMinutes(held?.endTime)}
                            onchange={(event) => changeEndTime(slot, event.currentTarget.value)}
                        />
                    </td>
                    <td>
                        <input
                            class="hmm-input hmm-week-value"
                            type="number"
                            min={valueMin}
                            max={valueMax}
                            step="0.5"
                            disabled={!spec.writable}
                            aria-label={`${t('Value')} ${slot}`}
                            data-testid={`week-slot-${slot}-value`}
                            value={held?.value ?? ''}
                            oninput={(event) => changeValue(slot, event.currentTarget.value)}
                        />
                        {#if unit !== ''}<span class="hmm-week-unit">{unit}</span>{/if}
                    </td>
                </tr>
            {/each}
        </tbody>
    </table>

    {#if dayProblems.length > 0}
        <ul class="hmm-week-problems" data-testid="week-problems">
            {#each dayProblems as problem (`${problem.day}-${problem.slot}-${problem.code}`)}
                <li>{problemText(problem)}</li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .hmm-editor {
        padding: 4px;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-editor h3 {
        margin: 4px 0;
        font-size: var(--hmm-font-size);
    }

    .hmm-editor-hint {
        margin: 0 0 6px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-week-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
        padding: 4px 0;
    }

    .hmm-week-spacer {
        flex: 1 1 auto;
    }

    .hmm-week-copy {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .hmm-week-active {
        background: var(--hmm-accent-bg);
        border-color: var(--hmm-accent);
    }

    .hmm-week-table {
        width: 100%;
        border-collapse: collapse;
    }

    .hmm-week-table th {
        text-align: left;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        font-weight: normal;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-week-table td {
        border-bottom: 1px solid var(--hmm-border-muted);
        padding: 1px 4px 1px 0;
    }

    .hmm-week-index,
    .hmm-week-from {
        color: var(--hmm-fg-muted);
        font-family: var(--hmm-font-mono);
        width: 60px;
    }

    .hmm-week-time,
    .hmm-week-value {
        width: 90px;
    }

    .hmm-week-unit {
        color: var(--hmm-fg-muted);
        margin-left: 4px;
    }

    .hmm-week-problems {
        margin: 6px 0 0;
        padding-left: 18px;
        color: var(--hmm-warn);
    }
</style>
