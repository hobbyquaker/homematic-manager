<script lang="ts">
    /**
     * Task 26 (openccu-lite 28.9): one service parameter of channel 0 in the MASTER dialog, where
     * the parameter itself is not in the paramset (it is a VALUES datapoint) and only its
     * suppression is edited. The same three columns as `ParameterRow`, so the rows line up under
     * the MASTER parameters: the name on the left, the "suppressed" checkbox as the control.
     */
    interface Props {
        name: string;
        suppressed: boolean;
        /** The checkbox text, translated by the dialog. */
        label: string;
        /** The one-line explanation of what suppression does, as the tooltip. */
        title?: string | undefined;
        /** Marked when the checkbox differs from what the interface reports. */
        changed?: boolean;
        onchange: (suppressed: boolean) => void;
    }

    let {name, suppressed, label, title = undefined, changed = false, onchange}: Props = $props();
</script>

<!-- A row of the parameter table (task 77, app.css): the name in the label column, the checkbox as the control. -->
<div class="hmm-param hmm-param-table-row" class:hmm-param-changed={changed} data-testid={`suppress-row-${name}`}>
    <div class="hmm-param-label">
        <span>{name}</span>
    </div>

    <div class="hmm-param-control">
        <label class="hmm-param-suppress" {title}>
            <input
                type="checkbox"
                checked={suppressed}
                data-testid={`suppress-${name}`}
                onchange={(event) => onchange(event.currentTarget.checked)}
            />
            <span>{label}</span>
        </label>
    </div>
</div>

<style>
    .hmm-param {
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-param-changed {
        background: var(--hmm-accent-bg);
    }

    .hmm-param-label {
        display: flex;
        grid-column: 1;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-param-control {
        display: flex;
        grid-column: 2;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding-left: 8px;
    }

    .hmm-param-suppress {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    @container hmm-param-table (max-width: 599px) {
        .hmm-param-label {
            flex: 0 1 240px;
        }

        .hmm-param-control {
            flex: 1 1 160px;
        }
    }
</style>
