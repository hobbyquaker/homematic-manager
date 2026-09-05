<script lang="ts">
    import type {DeviceEditorSpec, EditorChange, EditorValues} from '../../../lib/util/editors/index.js';

    import BlindCalibrationEditor from './BlindCalibrationEditor.svelte';
    import DurationPairsEditor from './DurationPairsEditor.svelte';

    /**
     * Draws the device-specific editors the registry recognised, above the generic rows.
     *
     * The dispatch is an explicit `{#if}` chain rather than a component stored in the registry: the
     * registry is pure TypeScript that the tests exercise without a DOM, and each editor takes a
     * differently shaped specification, which a typed chain checks and a component map does not.
     */
    interface Props {
        specs: readonly DeviceEditorSpec[];
        values: EditorValues;
        channelType: string;
        onchange: EditorChange;
    }

    let {specs, values, channelType, onchange}: Props = $props();
</script>

{#each specs as spec (spec.id)}
    {#if spec.kind === 'blind-calibration'}
        <BlindCalibrationEditor {spec} {values} {channelType} {onchange} />
    {:else if spec.kind === 'duration-pairs'}
        <DurationPairsEditor {spec} {values} {channelType} {onchange} />
    {/if}
{/each}
