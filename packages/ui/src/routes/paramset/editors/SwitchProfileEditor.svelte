<script lang="ts">
    import type {ParamsetValue} from '@homematic-manager/core';
    import {enumList, numericBound, readDurationPair, unitLabel, writeDurationPair} from '@homematic-manager/core';

    import {
        formatSeconds,
        hasWeekdayBit,
        isSlotUnused,
        parseSwitchTime,
        switchParam,
        switchTime,
        toggleWeekdayBit,
        WEEKDAY_BIT_LABELS,
        type EditorChange,
        type EditorValues,
        type SwitchColumn,
        type SwitchProfileSpec,
    } from '../../../lib/util/editors/index.js';
    import {getStores} from '../../../lib/stores/context.js';

    interface Props {
        spec: SwitchProfileSpec;
        values: EditorValues;
        channelType: string;
        onchange: EditorChange;
    }

    let {spec, values, channelType, onchange}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /** Only the slots that do something, unless the user asks for the empty ones as well. */
    let showUnused = $state(false);

    const shown = $derived(spec.slots.filter((slot) => showUnused || !isSlotUnused(values, slot)));

    function columnLabel(column: SwitchColumn): string {
        if (column.id === 'TIME') {
            return t('Time');
        }
        if (column.id === 'WEEKDAY') {
            return t('Weekdays');
        }
        // The string table names the bare field, not `01_WP_LEVEL`.
        return stores.meta.parameterLabel(column.id, channelType);
    }

    function valueOf(slot: string, field: string): ParamsetValue | undefined {
        return values[switchParam(slot, field)];
    }

    function set(slot: string, field: string, value: ParamsetValue): void {
        onchange({[switchParam(slot, field)]: value});
    }

    function changeTime(slot: string, text: string): void {
        const update = parseSwitchTime(slot, text);
        if (update) {
            onchange(update);
        }
    }

    function durationSeconds(slot: string, column: SwitchColumn): number | undefined {
        const pair = spec.durations[`${slot}:${column.id}`];
        return pair === undefined ? undefined : readDurationPair(values, pair)?.seconds;
    }

    function changeDuration(slot: string, column: SwitchColumn, raw: string): void {
        const pair = spec.durations[`${slot}:${column.id}`];
        const seconds = Number(raw);
        if (pair === undefined || raw === '' || !Number.isFinite(seconds)) {
            return;
        }
        const update = writeDurationPair(seconds, pair);
        if (update) {
            onchange(update);
        }
    }

    function changeNumber(slot: string, field: string, raw: string): void {
        const value = Number(raw);
        if (raw === '' || !Number.isFinite(value)) {
            return;
        }
        set(slot, field, value);
    }
</script>

<div class="hmm-editor" data-testid="editor-switch-week-profile">
    <h3>{t('Switching programme')}</h3>
    <p class="hmm-editor-hint">{t('No weekday chosen - the slot does nothing')}</p>

    <label class="hmm-switch-option">
        <input type="checkbox" bind:checked={showUnused} data-testid="switch-show-unused" />
        <span>{t('Unused')}</span>
    </label>

    <div class="hmm-switch-scroll">
        <table class="hmm-switch-table">
            <thead>
                <tr>
                    <th>{t('Slot')}</th>
                    {#each spec.columns as column (column.id)}
                        <th>{columnLabel(column)}</th>
                    {/each}
                </tr>
            </thead>
            <tbody>
                {#each shown as slot (slot)}
                    <tr data-testid={`switch-slot-${slot}`}>
                        <td class="hmm-switch-index">{slot}</td>
                        {#each spec.columns as column (column.id)}
                            <td>
                                {#if column.kind === 'weekday'}
                                    <div class="hmm-switch-days">
                                        {#each WEEKDAY_BIT_LABELS as label, bit (label)}
                                            <label title={t(label)}>
                                                <input
                                                    type="checkbox"
                                                    disabled={!spec.writable}
                                                    aria-label={t(label)}
                                                    data-testid={`switch-${slot}-day-${bit}`}
                                                    checked={hasWeekdayBit(valueOf(slot, 'WEEKDAY'), bit)}
                                                    onchange={(event) =>
                                                        set(
                                                            slot,
                                                            'WEEKDAY',
                                                            toggleWeekdayBit(
                                                                valueOf(slot, 'WEEKDAY'),
                                                                bit,
                                                                event.currentTarget.checked,
                                                            ),
                                                        )}
                                                />
                                                <span>{t(label).slice(0, 2)}</span>
                                            </label>
                                        {/each}
                                        <span class="hmm-switch-raw" data-testid={`switch-${slot}-mask`}
                                            >{String(valueOf(slot, 'WEEKDAY') ?? '—')}</span
                                        >
                                    </div>
                                {:else if column.kind === 'time'}
                                    <input
                                        class="hmm-input hmm-switch-time"
                                        type="text"
                                        inputmode="numeric"
                                        disabled={!spec.writable}
                                        aria-label={`${t('Time')} ${slot}`}
                                        data-testid={`switch-${slot}-time`}
                                        value={switchTime(values, slot)}
                                        onchange={(event) => changeTime(slot, event.currentTarget.value)}
                                    />
                                {:else if column.kind === 'duration'}
                                    <input
                                        class="hmm-input hmm-switch-number"
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        disabled={!spec.writable}
                                        aria-label={`${columnLabel(column)} ${slot}`}
                                        data-testid={`switch-${slot}-${column.id}`}
                                        value={durationSeconds(slot, column) ?? ''}
                                        oninput={(event) => changeDuration(slot, column, event.currentTarget.value)}
                                    />
                                    <span class="hmm-switch-raw" data-testid={`switch-${slot}-${column.id}-result`}
                                        >{formatSeconds(durationSeconds(slot, column) ?? Number.NaN)}</span
                                    >
                                {:else if column.kind === 'enum'}
                                    <select
                                        class="hmm-select"
                                        disabled={!spec.writable}
                                        aria-label={`${columnLabel(column)} ${slot}`}
                                        data-testid={`switch-${slot}-${column.id}`}
                                        value={String(valueOf(slot, column.id) ?? '')}
                                        onchange={(event) => set(slot, column.id, Number(event.currentTarget.value))}
                                    >
                                        {#each enumList(column.description) ?? [] as entry, index (entry)}
                                            <option value={String(index)}
                                                >{stores.meta.valueLabel(column.id, entry, channelType)}</option
                                            >
                                        {/each}
                                    </select>
                                {:else}
                                    <input
                                        class="hmm-input hmm-switch-number"
                                        type="number"
                                        min={numericBound(column.description, 'MIN')}
                                        max={numericBound(column.description, 'MAX')}
                                        step={column.description.TYPE === 'FLOAT' ? 0.01 : 1}
                                        disabled={!spec.writable}
                                        aria-label={`${columnLabel(column)} ${slot}`}
                                        data-testid={`switch-${slot}-${column.id}`}
                                        value={valueOf(slot, column.id) ?? ''}
                                        oninput={(event) => changeNumber(slot, column.id, event.currentTarget.value)}
                                    />
                                    {#if unitLabel(column.description) !== ''}
                                        <span class="hmm-switch-raw">{unitLabel(column.description)}</span>
                                    {/if}
                                {/if}
                            </td>
                        {/each}
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
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

    .hmm-switch-option {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-bottom: 4px;
    }

    .hmm-switch-scroll {
        overflow-x: auto;
        max-height: 40vh;
    }

    .hmm-switch-table {
        border-collapse: collapse;
        white-space: nowrap;
    }

    .hmm-switch-table th {
        text-align: left;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        font-weight: normal;
        border-bottom: 1px solid var(--hmm-border);
        padding-right: 8px;
    }

    .hmm-switch-table td {
        border-bottom: 1px solid var(--hmm-border-muted);
        padding: 1px 8px 1px 0;
    }

    .hmm-switch-index {
        color: var(--hmm-fg-muted);
        font-family: var(--hmm-font-mono);
    }

    .hmm-switch-days {
        display: flex;
        align-items: center;
        gap: 2px;
    }

    .hmm-switch-days label {
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-switch-time,
    .hmm-switch-number {
        width: 80px;
    }

    .hmm-switch-raw {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
        margin-left: 4px;
    }
</style>
