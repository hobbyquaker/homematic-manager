<script lang="ts">
    import type {EditorChange, EditorValues, EnumField, EnumOptionsSpec} from '../../../lib/util/editors/index.js';
    import {getStores} from '../../../lib/stores/context.js';

    interface Props {
        spec: EnumOptionsSpec;
        values: EditorValues;
        channelType: string;
        onchange: EditorChange;
    }

    let {spec, values, channelType, onchange}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    function label(param: string): string {
        return stores.meta.parameterLabel(param, channelType);
    }

    function current(field: EnumField): number {
        const value = values[field.param];
        if (typeof value === 'number') {
            return value;
        }
        // HmIP answers an enum with its name on some firmware; resolve it against the raw list.
        return field.options.find((option) => option.raw === value)?.value ?? -1;
    }

    /**
     * The value the device holds but the list does not offer - a preset narrows the choices, and
     * whatever a device was configured with before must stay visible and selected.
     */
    function foreign(field: EnumField): number | undefined {
        const value = current(field);
        return value >= 0 && !field.options.some((option) => option.value === value) ? value : undefined;
    }

    function rawOf(field: EnumField, value: number): string {
        return field.description.VALUE_LIST?.[value] ?? String(value);
    }
</script>

<div class="hmm-editor" data-testid="editor-enum-options">
    <h3>{t('Named options')}</h3>
    <p class="hmm-editor-hint">
        {t('These values have names in the CCU string table that the description does not carry.')}
    </p>

    {#each spec.fields as field (field.param)}
        {@const value = current(field)}
        {@const extra = foreign(field)}
        <div class="hmm-enum-row" data-testid={`enum-${field.param}`}>
            <div class="hmm-enum-label">
                <span>{label(field.param)}</span>
                <span class="hmm-enum-id">{field.param}</span>
            </div>
            <div class="hmm-enum-control">
                <select
                    class="hmm-select"
                    disabled={!field.writable}
                    aria-label={label(field.param)}
                    data-testid={`enum-${field.param}-select`}
                    value={String(value)}
                    onchange={(event) => onchange({[field.param]: Number(event.currentTarget.value)})}
                >
                    {#if extra !== undefined}
                        <option value={String(extra)}>{rawOf(field, extra)} ({extra})</option>
                    {/if}
                    {#each field.options as option (option.value)}
                        <option value={String(option.value)}>{option.label}</option>
                    {/each}
                </select>
                <span class="hmm-enum-raw" data-testid={`enum-${field.param}-raw`}>
                    {value < 0 ? '—' : `${rawOf(field, value)} (${value})`}
                </span>
            </div>
            <div class="hmm-enum-meta">
                {#if field.presetId !== undefined}
                    <span data-testid={`enum-${field.param}-preset`}>{field.presetId}</span>
                {/if}
            </div>
        </div>
    {/each}
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

    .hmm-enum-row {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 200px;
        gap: 8px;
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-enum-label {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-enum-id,
    .hmm-enum-raw {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-enum-control {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }

    .hmm-enum-meta {
        display: flex;
        justify-content: flex-end;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
