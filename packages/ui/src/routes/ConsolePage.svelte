<script lang="ts">
    import type {RpcValue} from '@homematic-manager/core';

    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import {getStores} from '../lib/stores/context.js';
    import type {ConsoleCall, ConsoleRecall} from '../lib/stores/ConsoleStore.svelte.js';
    import {
        argFields,
        buildParams,
        emptyValue,
        isAddressArgument,
        isValidJson,
        type ArgField,
        type ArgValue,
        type StructEntry,
    } from '../lib/util/rpcForm.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let method = $state('');
    let values = $state<ArgValue[]>([]);
    let answer = $state<ConsoleCall | undefined>(undefined);

    const interfaceName = $derived(stores.app.selectedInterface);
    const methods = $derived(stores.console.of(interfaceName));
    const fields = $derived<ArgField[]>(method === '' ? [] : argFields(method));
    const info = $derived(stores.console.method(interfaceName, method));
    /** The addresses of the interface, offered as a datalist on every address argument. */
    const addresses = $derived(
        stores.devices
            .index(interfaceName)
            ?.all()
            .map((entry) => entry.ADDRESS) ?? [],
    );
    const params = $derived<RpcValue[]>(buildParams(fields, values));

    $effect(() => {
        void stores.console.load(interfaceName);
    });

    // Task 48: an RPC log entry "opened in console" - taken once, for this interface, and put
    // into the form. The page is re-created on every interface or tab switch, which is why the
    // store holds the recall until a console for the right interface is there to take it.
    $effect(() => {
        const recalled = stores.console.takeRecall(interfaceName);
        if (recalled !== undefined) {
            replay(recalled);
        }
    });

    function choose(name: string): void {
        method = name;
        values = argFields(name).map((field) => emptyValue(field));
        answer = undefined;
    }

    function set(index: number, value: ArgValue): void {
        values = values.map((entry, position) => (position === index ? value : entry));
    }

    function structOf(index: number): StructEntry[] {
        const value = values[index];
        return Array.isArray(value) ? value : [];
    }

    function variantOf(index: number): {type: StructEntry['type']; value: string} {
        const value = values[index];
        return typeof value === 'object' && !Array.isArray(value) ? value : {type: 'string', value: ''};
    }

    function addStructEntry(index: number): void {
        set(index, [...structOf(index), {key: '', type: 'string', value: ''}]);
    }

    function updateStructEntry(index: number, position: number, patch: Partial<StructEntry>): void {
        set(
            index,
            structOf(index).map((entry, at) => (at === position ? {...entry, ...patch} : entry)),
        );
    }

    function removeStructEntry(index: number, position: number): void {
        set(
            index,
            structOf(index).filter((_entry, at) => at !== position),
        );
    }

    /** Bit fields are edited as their flags; the value stays the number that goes on the wire. */
    function toggleFlag(index: number, bit: number, on: boolean): void {
        const current = typeof values[index] === 'number' ? (values[index] as number) : 0;
        set(index, on ? current | bit : current & ~bit);
    }

    async function send(): Promise<void> {
        if (method === '') {
            return;
        }
        answer = await stores.console.call(interfaceName, method, params);
    }

    /** A struct parameter, as opposed to an array or a scalar - `typeof null` is `'object'`. */
    function isStruct(value: unknown): value is Record<string, RpcValue> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /** Puts a logged call back into the form; the user sends it, or changes it first. */
    function replay(call: ConsoleRecall): void {
        method = call.method;
        // The recorded parameters are what went out; the form is rebuilt around them where the
        // shapes match, and left empty where they do not - a replay is a starting point.
        const rebuilt = argFields(call.method);
        values = rebuilt.map((field, index) => {
            const recorded = call.params[index];
            if (field.kind === 'struct' && isStruct(recorded)) {
                return Object.entries(recorded).map(([key, value]) => ({
                    key,
                    type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'double' : 'string',
                    value: String(value),
                })) as StructEntry[];
            }
            if (field.kind === 'json') {
                return JSON.stringify(recorded ?? []);
            }
            if (field.kind === 'bool') {
                return recorded === true;
            }
            if (field.kind === 'number' || field.kind === 'flags') {
                return typeof recorded === 'number' ? recorded : 0;
            }
            return recorded === undefined ? emptyValue(field) : String(recorded);
        });
        answer = undefined;
    }
</script>

<!--
    The 2.7 console layout, with the one thing it never had: a generated argument form. 2.x parsed a
    single free-text field with JSON.parse, which made putParamset unusable from the console
    (#27, #136). Here the catalogue in packages/core decides which control each argument gets, and
    the exact tuple that will be sent is always visible under the form.
-->
<div class="hmm-page">
    <Toolbar label={t('RPC Console')}>
        <ToolbarButton
            title={t('Send request')}
            icon="▸"
            disabled={method === '' || stores.console.running}
            reason={t('Please select method')}
            testId="console-send"
            onclick={() => void send()}
        />
        <ToolbarButton
            title={t('Clear')}
            icon="⌫"
            testId="console-clear"
            onclick={() => {
                answer = undefined;
            }}
        />
        {#snippet trailing()}
            <span>{methods.length} {t('Method')}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-console-top">
        <select
            class="hmm-select hmm-console-method"
            aria-label={t('Please select method')}
            data-testid="console-method"
            value={method}
            onchange={(event) => choose(event.currentTarget.value)}
        >
            <option value="">{t('Please select method')}</option>
            {#each methods as entry (entry.name)}
                <option value={entry.name}>{entry.name}</option>
            {/each}
        </select>
        <output class="hmm-console-params hmm-mono" data-testid="console-params"
            >{method}({JSON.stringify(params).slice(1, -1)})</output
        >
        <button
            type="button"
            class="hmm-button"
            disabled={method === '' || stores.console.running}
            data-testid="console-send-button"
            onclick={() => void send()}>{t('Send request')}</button
        >
    </div>

    <div class="hmm-console-columns">
        <section class="hmm-console-panel">
            <h3>{t('Parameters')}</h3>
            {#if fields.length === 0}
                <p class="hmm-console-hint">{method === '' ? t('Please select method') : t('No data')}</p>
            {/if}
            {#each fields as field, index (field.name)}
                <div class="hmm-console-arg" data-testid={`arg-${field.name}`}>
                    <label class="hmm-console-arg-label" for={`arg-input-${field.name}`}>
                        {field.name}
                        <span class="hmm-console-arg-type">{field.type}</span>
                    </label>

                    {#if field.kind === 'bool'}
                        <input
                            id={`arg-input-${field.name}`}
                            type="checkbox"
                            checked={values[index] === true}
                            onchange={(event) => set(index, event.currentTarget.checked)}
                        />
                    {:else if field.kind === 'number'}
                        <input
                            id={`arg-input-${field.name}`}
                            class="hmm-input"
                            type="number"
                            value={String(values[index] ?? 0)}
                            oninput={(event) => set(index, Number(event.currentTarget.value))}
                        />
                    {:else if field.kind === 'select'}
                        <select
                            id={`arg-input-${field.name}`}
                            class="hmm-select"
                            value={String(values[index] ?? '')}
                            onchange={(event) => set(index, event.currentTarget.value)}
                        >
                            {#each Object.entries(field.options ?? {}) as [value, label] (value)}
                                <option {value}>{label} ({value})</option>
                            {/each}
                        </select>
                    {:else if field.kind === 'flags'}
                        <div class="hmm-console-flags">
                            {#each Object.entries(field.options ?? {}) as [bit, label] (bit)}
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={((values[index] as number) & Number(bit)) !== 0}
                                        onchange={(event) =>
                                            toggleFlag(index, Number(bit), event.currentTarget.checked)}
                                    />
                                    <span>{label}</span>
                                </label>
                            {/each}
                            <span class="hmm-console-arg-type">= {String(values[index] ?? 0)}</span>
                        </div>
                    {:else if field.kind === 'struct'}
                        <div class="hmm-console-struct">
                            {#each structOf(index) as entry, position (position)}
                                <div class="hmm-console-struct-row">
                                    <input
                                        class="hmm-input"
                                        aria-label={`${field.name} ${String(position)} key`}
                                        value={entry.key}
                                        oninput={(event) =>
                                            updateStructEntry(index, position, {key: event.currentTarget.value})}
                                    />
                                    <select
                                        class="hmm-select"
                                        aria-label={`${field.name} ${String(position)} type`}
                                        value={entry.type}
                                        onchange={(event) =>
                                            updateStructEntry(index, position, {
                                                type: event.currentTarget.value as StructEntry['type'],
                                            })}
                                    >
                                        <option value="string">string</option>
                                        <option value="integer">integer</option>
                                        <option value="double">double</option>
                                        <option value="bool">bool</option>
                                    </select>
                                    <input
                                        class="hmm-input"
                                        aria-label={`${field.name} ${String(position)} value`}
                                        value={entry.value}
                                        oninput={(event) =>
                                            updateStructEntry(index, position, {value: event.currentTarget.value})}
                                    />
                                    <button
                                        type="button"
                                        class="hmm-button"
                                        aria-label={`${field.name} ${String(position)} remove`}
                                        onclick={() => removeStructEntry(index, position)}>✕</button
                                    >
                                </div>
                            {/each}
                            <button
                                type="button"
                                class="hmm-button"
                                data-testid={`arg-${field.name}-add`}
                                onclick={() => addStructEntry(index)}>+</button
                            >
                        </div>
                    {:else if field.kind === 'variant'}
                        <div class="hmm-console-struct-row">
                            <select
                                class="hmm-select"
                                aria-label={`${field.name} type`}
                                value={variantOf(index).type}
                                onchange={(event) =>
                                    set(index, {
                                        ...variantOf(index),
                                        type: event.currentTarget.value as StructEntry['type'],
                                    })}
                            >
                                <option value="string">string</option>
                                <option value="integer">integer</option>
                                <option value="double">double</option>
                                <option value="bool">bool</option>
                            </select>
                            <input
                                id={`arg-input-${field.name}`}
                                class="hmm-input"
                                value={variantOf(index).value}
                                oninput={(event) => set(index, {...variantOf(index), value: event.currentTarget.value})}
                            />
                        </div>
                    {:else if field.kind === 'json'}
                        <textarea
                            id={`arg-input-${field.name}`}
                            class="hmm-input hmm-console-json"
                            class:hmm-console-invalid={!isValidJson(String(values[index] ?? ''))}
                            value={String(values[index] ?? '')}
                            oninput={(event) => set(index, event.currentTarget.value)}></textarea>
                    {:else}
                        <input
                            id={`arg-input-${field.name}`}
                            class="hmm-input"
                            list={isAddressArgument(field) ? 'hmm-console-addresses' : undefined}
                            value={String(values[index] ?? '')}
                            oninput={(event) => set(index, event.currentTarget.value)}
                        />
                    {/if}

                    {#if field.optional.length > 0}
                        <span class="hmm-console-arg-type">{t('optional')}: {field.optional.join(', ')}</span>
                    {/if}
                </div>
            {/each}

            <datalist id="hmm-console-addresses">
                {#each addresses as address (address)}
                    <option value={address}></option>
                {/each}
            </datalist>
        </section>

        <!--
            Task 37: the response takes what the column has left. It used to be a 220 px box with
            the history under it, which left the lower half of a normal window empty while a
            `listDevices` answer scrolled inside those 220 px. Task 48: the history is gone too -
            every call is in the global RPC log, and an entry there opens in this form - so the
            response has the whole column.
        -->
        <section class="hmm-console-panel hmm-console-output" data-testid="console-output">
            <h3>
                {t('Response')}
                {#if answer && !answer.ok}
                    <span class="hmm-console-error" data-testid="console-error">{answer.error}</span>
                {/if}
            </h3>
            <textarea
                class="hmm-console-response hmm-mono"
                aria-label={t('Response')}
                data-testid="console-response"
                readonly
                value={answer === undefined
                    ? ''
                    : answer.ok
                      ? JSON.stringify(answer.result, undefined, 2)
                      : `${answer.error ?? ''}${answer.faultCode === undefined ? '' : ` (${answer.faultCode})`}`}
            ></textarea>
        </section>
    </div>

    {#if info?.help}
        <section class="hmm-console-help" data-testid="console-help-section">
            <h3>{info.name}</h3>
            <p data-testid="console-help">
                {info.help
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()}
            </p>
        </section>
    {/if}
</div>

<style>
    .hmm-page {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
        overflow: auto;
    }

    .hmm-console-top {
        display: flex;
        gap: 6px;
        align-items: center;
    }

    .hmm-console-method {
        width: 235px;
        flex: 0 0 auto;
    }

    .hmm-console-params {
        flex: 1 1 auto;
        min-width: 0;
        padding: 2px 4px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg-sunken);
        overflow-x: auto;
        white-space: nowrap;
    }

    /*
        Task 37: the columns get what the toolbar, the method row and the help leave over (a basis
        of 0, not `auto`, so their content never decides their height), and the one row is
        `minmax(0, 1fr)` so a long argument list scrolls inside its column instead of growing it.
    */
    .hmm-console-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: minmax(0, 1fr);
        gap: 12px;
        flex: 1 1 0;
        min-height: 0;
    }

    .hmm-console-panel {
        min-width: 0;
        min-height: 0;
        overflow: auto;
    }

    .hmm-console-panel h3 {
        margin: 0 0 6px;
        font-size: var(--hmm-font-size);
    }

    /* The right column: the response takes the height (task 37; the whole of it since task 48). */
    .hmm-console-output {
        display: flex;
        flex-direction: column;
    }

    .hmm-console-output h3 {
        flex: 0 0 auto;
    }

    .hmm-console-arg {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 6px;
        align-items: start;
        padding: 3px 0;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-console-arg-label {
        display: flex;
        flex-direction: column;
    }

    .hmm-console-arg-type {
        color: var(--hmm-fg-faint);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-console-flags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }

    .hmm-console-struct {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .hmm-console-struct-row {
        display: grid;
        grid-template-columns: 1fr 90px 1fr auto;
        gap: 4px;
    }

    .hmm-console-json {
        width: 100%;
        height: 80px;
        font-family: var(--hmm-font-mono);
    }

    .hmm-console-invalid {
        border-color: var(--hmm-error);
    }

    /*
        Task 37: no fixed height. It grows into the column and shrinks with the window down to a
        floor that still shows a dozen lines; below that the column scrolls. No resize grip: the
        field follows the window, and a dragged height would fight the flex layout.
    */
    .hmm-console-response {
        flex: 1 1 auto;
        width: 100%;
        min-height: 120px;
        resize: none;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg-sunken);
    }

    .hmm-console-error {
        color: var(--hmm-error);
    }

    /* Task 37: a long help text scrolls inside a quarter of the window rather than pushing the
       columns - and the response with them - off the bottom. */
    .hmm-console-help {
        flex: 0 1 auto;
        max-height: 25vh;
        min-height: 0;
        overflow: auto;
        border-top: 1px solid var(--hmm-border);
        padding-top: 6px;
    }

    .hmm-console-help h3 {
        margin: 0 0 4px;
        font-size: var(--hmm-font-size);
    }

    .hmm-console-hint {
        color: var(--hmm-fg-muted);
    }
</style>
