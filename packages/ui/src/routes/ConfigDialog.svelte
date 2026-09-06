<script lang="ts">
    import type {ConnectionConfig, LanguageChoice, UserDefinedInterface} from '@homematic-manager/core';
    import {DEFAULT_INTERFACES, INTERFACE_NAMES, validateUserDefinedInterface} from '@homematic-manager/core';

    import Dialog from '../lib/components/Dialog.svelte';
    import LanguageSwitch from '../lib/components/LanguageSwitch.svelte';
    import MultiSelect from '../lib/components/MultiSelect.svelte';
    import {getStores} from '../lib/stores/context.js';

    interface Props {
        open?: boolean;
    }

    let {open = $bindable(false)}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /** A working copy: nothing is written until "Save & Restart", exactly as 2.7 behaved. */
    let draft = $state<ConnectionConfig | undefined>(undefined);
    let useAuth = $state(false);
    let clearCaches = $state(false);
    let saving = $state(false);
    let discovering = $state(false);

    $effect(() => {
        if (open && draft === undefined) {
            const connection = stores.app.config?.connection;
            draft = connection
                ? structuredClone($state.snapshot(connection))
                : {
                      host: '',
                      interfaces: [...DEFAULT_INTERFACES],
                      autoDetect: true,
                      extraInterfaces: [],
                      tls: false,
                      rega: true,
                      callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0},
                      // The stored *choice*, not the resolved language: a profile that has never
                      // been saved must not turn "the browser decides" into a fixed German (D-36).
                      language: stores.app.languageChoice,
                      writePaceMs: 250,
                      rpcLogFolder: '',
                  };
            useAuth = draft.auth !== undefined;
        }
        if (!open) {
            draft = undefined;
        }
    });

    const interfaceOptions = $derived(
        [...new Set([...INTERFACE_NAMES, ...(draft?.interfaces ?? [])])].map((name) => ({value: name, label: name})),
    );
    const addressOptions = $derived(stores.app.config?.localAddresses ?? []);
    const discovered = $derived(stores.app.config?.discovered ?? []);

    async function save(): Promise<void> {
        if (!draft) {
            return;
        }
        saving = true;
        const connection: ConnectionConfig = {
            ...structuredClone($state.snapshot(draft)),
            ...(useAuth && draft.auth ? {auth: {...draft.auth}} : {}),
        };
        if (!useAuth) {
            delete (connection as {auth?: unknown}).auth;
        }
        const ok = await stores.app.save(connection);
        if (ok && clearCaches) {
            await stores.app.clearCaches();
            clearCaches = false;
        }
        saving = false;
        if (ok) {
            stores.app.setLanguage(connection.language ?? 'auto');
            stores.i18n.language = stores.app.language;
            open = false;
            await stores.start();
        }
    }

    async function discover(): Promise<void> {
        discovering = true;
        await stores.app.discover();
        discovering = false;
    }

    function addExtra(): void {
        if (!draft) {
            return;
        }
        const extra: UserDefinedInterface = {name: '', host: '', port: 2001, protocol: 'xmlrpc', path: ''};
        draft.extraInterfaces = [...draft.extraInterfaces, extra];
    }

    function removeExtra(index: number): void {
        if (!draft) {
            return;
        }
        const removed = draft.extraInterfaces[index]?.name;
        draft.extraInterfaces = draft.extraInterfaces.filter((_entry, at) => at !== index);
        if (removed !== undefined && removed !== '') {
            draft.interfaces = draft.interfaces.filter((name) => name !== removed);
        }
    }

    /** #26: the auto-acknowledge switch, guarded the way every other draft field is. */
    function setAutoAck(value: boolean): void {
        if (draft) {
            draft.autoAckStickyUnreach = value;
        }
    }

    /** #54: the same for the ReGa inbox, which only means anything while ReGa is on (D-2). */
    function setAutoConfirmInbox(value: boolean): void {
        if (draft) {
            draft.autoConfirmRegaInbox = value;
        }
    }

    /** D-36: `auto` is a value the profile stores, not the absence of one. */
    function setDraftLanguage(choice: LanguageChoice): void {
        if (draft) {
            draft.language = choice;
        }
    }

    function setAuthField(field: 'user' | 'password', value: string): void {
        if (!draft) {
            return;
        }
        const auth = draft.auth ?? {user: '', password: ''};
        draft.auth = {...auth, [field]: value};
    }
</script>

<!--
    The 2.7 settings dialog, plus what the rebuild made explicit: the interface list (#135, D-13),
    the ReGa switch (D-2) and the two callback ports. "Show unhandled exceptions" and "Hide name
    columns" are gone - unhandled errors are reported by the host (task 11) and the name column is
    a per-grid setting now.

    Task 23, the maintainer on beta.1: it read as one undifferentiated list of eighteen rows, so it
    is five titled sections now, each one a two-column form grid with its labels right-aligned
    against its fields, help under a field rather than beside it, and a width per field type. The
    sections stand in two columns because five of them in one column are taller than a 800 px
    window, and a settings dialog the user has to scroll - or navigate - is what was wrong with it
    in the first place. Only the two things that are lists span the full width: the user-defined
    interfaces and the info line that took the About dialog's place.
-->
<Dialog bind:open title={t('Settings')} width="960px" testId="config-dialog">
    {#if draft}
        <div class="hmm-config">
            <div class="hmm-config-columns">
                <div class="hmm-config-column">
                    <section class="hmm-config-section">
                        <h3 class="hmm-config-title">{t('Connection')}</h3>
                        <div class="hmm-config-grid">
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('CCU Address')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-wide"
                                        bind:value={draft.host}
                                        data-testid="config-host"
                                    />
                                    <small class="hmm-config-help">{t('Host name or address of the CCU')}</small>
                                </span>
                            </label>

                            <div class="hmm-config-row">
                                <span class="hmm-config-label">{t('Discovered CCUs')}</span>
                                <span class="hmm-config-field">
                                    <span class="hmm-config-inline">
                                        <select
                                            class="hmm-select hmm-config-wide"
                                            aria-label={t('Discovered CCUs')}
                                            disabled={discovered.length === 0}
                                            data-testid="config-discovered"
                                            onchange={(event) => {
                                                if (draft && event.currentTarget.value !== '') {
                                                    draft.host = event.currentTarget.value;
                                                }
                                            }}
                                        >
                                            <option value="">{discovering ? t('Searching...') : t('Select')}</option>
                                            {#each discovered as ccu (ccu.address)}
                                                <option value={ccu.address}
                                                    >{ccu.address} {ccu.serial ?? ''} {ccu.firmware ?? ''}</option
                                                >
                                            {/each}
                                        </select>
                                        <!--
                                            UDP discovery on 43439, on demand. 2.x ran it once at
                                            start-up and never again, so a CCU that booted
                                            afterwards never appeared in the list.
                                        -->
                                        <button
                                            type="button"
                                            class="hmm-button"
                                            disabled={discovering}
                                            data-testid="config-discover"
                                            onclick={() => void discover()}>{t('Discover')}</button
                                        >
                                    </span>
                                    <small class="hmm-config-help">{t('Searches the network for CCUs over UDP')}</small>
                                </span>
                            </div>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Use TLS')}</span>
                                <span class="hmm-config-field">
                                    <input type="checkbox" bind:checked={draft.tls} />
                                    <small class="hmm-config-help">{t('The encrypted ports of the CCU')}</small>
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Use Auth')}</span>
                                <span class="hmm-config-field">
                                    <input type="checkbox" bind:checked={useAuth} />
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Auth User')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-wide"
                                        disabled={!useAuth}
                                        value={draft.auth?.user ?? ''}
                                        oninput={(event) => setAuthField('user', event.currentTarget.value)}
                                    />
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Auth Pass')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-wide"
                                        type="password"
                                        disabled={!useAuth}
                                        value={draft.auth?.password ?? ''}
                                        oninput={(event) => setAuthField('password', event.currentTarget.value)}
                                    />
                                </span>
                            </label>
                        </div>
                    </section>

                    <section class="hmm-config-section">
                        <h3 class="hmm-config-title">{t('Callback')}</h3>
                        <div class="hmm-config-grid">
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Homematic Manager Address')}</span>
                                <span class="hmm-config-field">
                                    <select class="hmm-select hmm-config-wide" bind:value={draft.callback.ip}>
                                        <option value="">{t('Select')}</option>
                                        {#each addressOptions as address (address)}
                                            <option value={address}>{address}</option>
                                        {/each}
                                    </select>
                                    <small class="hmm-config-help"
                                        >{t('The address the interface processes call back to')}</small
                                    >
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Callback XML-RPC port')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-narrow"
                                        type="number"
                                        min="0"
                                        bind:value={draft.callback.xmlrpcPort}
                                    />
                                    <small class="hmm-config-help">{t('0 picks a free port')}</small>
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Callback BIN-RPC port')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-narrow"
                                        type="number"
                                        min="0"
                                        bind:value={draft.callback.binrpcPort}
                                    />
                                    <small class="hmm-config-help">{t('0 picks a free port')}</small>
                                </span>
                            </label>
                        </div>
                    </section>
                </div>

                <div class="hmm-config-column">
                    <section class="hmm-config-section">
                        <h3 class="hmm-config-title">{t('Interfaces')}</h3>
                        <div class="hmm-config-grid">
                            <div class="hmm-config-row">
                                <span class="hmm-config-label">{t('Configured interfaces')}</span>
                                <span class="hmm-config-field">
                                    <MultiSelect
                                        options={interfaceOptions}
                                        bind:selected={draft.interfaces}
                                        label={t('Interfaces')}
                                        filterLabel={t('Filter')}
                                        checkAllLabel={t('Check all')}
                                        uncheckAllLabel={t('Uncheck all')}
                                        summary={(selected) => selected.join(', ')}
                                        placeholder={t('Select')}
                                    />
                                </span>
                            </div>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Detect interfaces')}</span>
                                <span class="hmm-config-field">
                                    <input type="checkbox" bind:checked={draft.autoDetect} />
                                    <small class="hmm-config-help"
                                        >{t('Probes the known ports in the background')}</small
                                    >
                                </span>
                            </label>
                        </div>
                        <!--
                            No protocol choice: off the CCU every interface is XML-RPC through
                            lighttpd, BIN-RPC exists on the CCU's loopback only (D-28). `local`, the
                            contract flag for that, is deliberately not here: the addon sets it for
                            its own environment and a desktop user toggling it would just break
                            their connection.
                        -->
                    </section>

                    <section class="hmm-config-section">
                        <h3 class="hmm-config-title">ReGa</h3>
                        <div class="hmm-config-grid">
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Use ReGa')}</span>
                                <span class="hmm-config-field">
                                    <input type="checkbox" bind:checked={draft.rega} />
                                    <small class="hmm-config-help">{t('ReGa supplies the friendly names')}</small>
                                </span>
                            </label>

                            <!--
                                Issue #54. Greyed out without ReGa rather than hidden: a user who
                                wonders where the option went should see that it is the ReGa switch
                                above that turns it off (D-2).
                            -->
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Confirm the ReGa inbox automatically')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        type="checkbox"
                                        disabled={!draft.rega}
                                        checked={draft.autoConfirmRegaInbox === true}
                                        data-testid="config-auto-confirm-inbox"
                                        onchange={(event) => setAutoConfirmInbox(event.currentTarget.checked)}
                                    />
                                    <small class="hmm-config-help">{t('Only possible with ReGa')}</small>
                                </span>
                            </label>
                        </div>
                    </section>

                    <section class="hmm-config-section">
                        <h3 class="hmm-config-title">{t('Behaviour')}</h3>
                        <div class="hmm-config-grid">
                            <!--
                                D-36, task 22: the switch left the header and is one of the settings
                                now. The first entry is the default - the browser's own order with
                                English behind it - and a choice made here is stored in the profile
                                and wins over the browser.
                            -->
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Language')}</span>
                                <span class="hmm-config-field">
                                    <LanguageSwitch
                                        language={draft.language ?? 'auto'}
                                        label={t('Language')}
                                        autoLabel={t('Browser language')}
                                        testId="config-language"
                                        onchange={setDraftLanguage}
                                    />
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('RPC Delay (ms)')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-narrow"
                                        type="number"
                                        min="0"
                                        bind:value={draft.writePaceMs}
                                    />
                                    <small class="hmm-config-help">{t('Shortest pause between two writes')}</small>
                                </span>
                            </label>

                            <!--
                                Issue #26. Off by default and never on by accident: acknowledging is
                                a write to the device, and the list of what was unreachable is what
                                a user watching it would lose. The unreach counter in the Funk tab
                                is what keeps that information either way.
                            -->
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Acknowledge STICKY_UNREACH automatically')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        type="checkbox"
                                        checked={draft.autoAckStickyUnreach === true}
                                        data-testid="config-auto-ack-unreach"
                                        onchange={(event) => setAutoAck(event.currentTarget.checked)}
                                    />
                                    <small class="hmm-config-help">{t('Acknowledging is a write to the device')}</small>
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('RPC Log Folder')}</span>
                                <span class="hmm-config-field">
                                    <input class="hmm-input hmm-config-wide" bind:value={draft.rpcLogFolder} />
                                    <small class="hmm-config-help">{t('Empty switches the dumps off')}</small>
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Clear Cache')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        type="checkbox"
                                        bind:checked={clearCaches}
                                        data-testid="config-clear-cache"
                                    />
                                    <small class="hmm-config-help">{t('Discards the caches when this is saved')}</small>
                                </span>
                            </label>
                        </div>
                    </section>
                </div>
            </div>

            <!--
                User-defined interfaces (#135, D-13): a CUxD on another port, a second rfd, a
                Homegear. Anything the interface table does not know is described here, and the name
                then appears in the interface list above. No protocol choice for the built-in ones
                (D-28) - only an extra interface may declare `binrpc`, because only a non-CCU peer
                can be reached that way. Full width because it is a table, not a form row.
            -->
            <fieldset class="hmm-config-extra">
                <legend>{t('Extra interfaces')}</legend>
                {#each draft.extraInterfaces as extra, index (index)}
                    {@const problems = validateUserDefinedInterface(extra)}
                    <div class="hmm-config-extra-row" data-testid={`config-extra-${String(index)}`}>
                        <input
                            class="hmm-input"
                            placeholder={t('Name')}
                            aria-label={`${t('Name')} ${String(index)}`}
                            bind:value={extra.name}
                        />
                        <input
                            class="hmm-input"
                            placeholder={t('Host')}
                            aria-label={`${t('Host')} ${String(index)}`}
                            bind:value={extra.host}
                        />
                        <input
                            class="hmm-input"
                            type="number"
                            placeholder={t('Port')}
                            aria-label={`${t('Port')} ${String(index)}`}
                            bind:value={extra.port}
                        />
                        <select
                            class="hmm-select"
                            aria-label={`${t('Protocol')} ${String(index)}`}
                            bind:value={extra.protocol}
                        >
                            <option value="xmlrpc">xmlrpc</option>
                            <option value="binrpc">binrpc</option>
                        </select>
                        <input
                            class="hmm-input"
                            placeholder={t('Path')}
                            aria-label={`${t('Path')} ${String(index)}`}
                            bind:value={extra.path}
                        />
                        <button
                            type="button"
                            class="hmm-button"
                            aria-label={`${t('Remove')} ${String(index)}`}
                            onclick={() => removeExtra(index)}>✕</button
                        >
                        {#if problems.length > 0}
                            <span class="hmm-config-problem" data-testid={`config-extra-problem-${String(index)}`}
                                >{problems.join(', ')}</span
                            >
                        {/if}
                    </div>
                {/each}
                <button type="button" class="hmm-button" data-testid="config-extra-add" onclick={addExtra}
                    >{t('Add interface')}</button
                >
            </fieldset>
        </div>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button type="button" class="hmm-button" disabled={saving} data-testid="config-save" onclick={() => void save()}
            >{t('Save & Restart')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-config {
        display: flex;
        flex-direction: column;
        gap: var(--hmm-form-section-gap);
    }

    /* The five sections in two columns: one column of them is taller than an 800 px window, and
       the settings dialog is the one dialog that should not have to be scrolled. */
    .hmm-config-columns {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--hmm-form-section-gap) 28px;
        align-items: start;
    }

    .hmm-config-column {
        display: flex;
        flex-direction: column;
        gap: var(--hmm-form-section-gap);
        min-width: 0;
    }

    .hmm-config-title {
        margin: 0 0 6px;
        padding-bottom: 3px;
        border-bottom: 1px solid var(--hmm-border-muted);
        font-size: var(--hmm-font-size);
        font-weight: 600;
        color: var(--hmm-fg);
    }

    .hmm-config-grid {
        display: flex;
        flex-direction: column;
        gap: var(--hmm-form-row-gap);
    }

    /*
        `minmax(0, 1fr)`, not `1fr`: a plain `1fr` track is `minmax(auto, 1fr)` and grows to the
        widest thing in it, so the interface picker's summary - every configured interface, comma
        separated - pushed the dialog into a horizontal scrollbar as soon as a CCU had more than
        two of them (task 19's rule; found with the five-interface demo of task 21).
    */
    .hmm-config-row {
        display: grid;
        grid-template-columns: var(--hmm-form-label-width) minmax(0, 1fr);
        gap: var(--hmm-form-column-gap);
        align-items: start;
    }

    /* Right-aligned against the field it belongs to, and allowed to wrap: the German labels of the
       two auto-confirm switches are longer than any label column worth having. */
    .hmm-config-label {
        text-align: right;
        padding-top: 4px;
        overflow-wrap: break-word;
    }

    /* The field and its help text, one under the other - never beside each other (task 23). */
    .hmm-config-field {
        display: flex;
        flex-direction: column;
        gap: var(--hmm-form-help-gap);
        align-items: flex-start;
        min-width: 0;
    }

    /* A field that carries a button of its own, such as the discovery picker. */
    .hmm-config-inline {
        display: flex;
        gap: 6px;
        align-items: center;
        width: 100%;
        min-width: 0;
    }

    .hmm-config-help {
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    /* Widths by type: a host, a folder and a picker fill their row, a port is four digits. */
    .hmm-config-wide {
        width: 100%;
        min-width: 0;
    }

    .hmm-config-narrow {
        width: var(--hmm-field-narrow);
    }

    .hmm-config-field :global(.hmm-language) {
        width: var(--hmm-field-medium);
    }

    .hmm-config-field :global(.hmm-multiselect) {
        width: 100%;
    }

    .hmm-config-extra {
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        padding: 6px;
        margin: 0;
    }

    .hmm-config-extra legend {
        font-weight: 600;
    }

    .hmm-config-extra-row {
        display: grid;
        grid-template-columns: 1fr 1fr 90px 100px 1fr auto;
        gap: 4px;
        margin-bottom: 4px;
    }

    .hmm-config-problem {
        grid-column: 1 / -1;
        color: var(--hmm-error);
        font-size: var(--hmm-font-size-small);
    }
</style>
