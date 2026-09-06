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
-->
<Dialog bind:open title={t('Settings')} width="560px" testId="config-dialog">
    {#if draft}
        <div class="hmm-config">
            <label class="hmm-config-row">
                <span>{t('CCU Address')}</span>
                <input class="hmm-input" bind:value={draft.host} data-testid="config-host" />
            </label>

            <div class="hmm-config-row">
                <span>{t('Discovered CCUs')}</span>
                <select
                    class="hmm-select"
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
                        <option value={ccu.address}>{ccu.address} {ccu.serial ?? ''} {ccu.firmware ?? ''}</option>
                    {/each}
                </select>
                <!--
                    UDP discovery on 43439, on demand. 2.x ran it once at start-up and never again,
                    so a CCU that booted afterwards never appeared in the list.
                -->
                <button
                    type="button"
                    class="hmm-button"
                    disabled={discovering}
                    data-testid="config-discover"
                    onclick={() => void discover()}>{t('Discover')}</button
                >
            </div>

            <div class="hmm-config-row">
                <span>{t('Interfaces')}</span>
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
            </div>

            <label class="hmm-config-row">
                <span>{t('Detect interfaces')}</span>
                <input type="checkbox" bind:checked={draft.autoDetect} />
            </label>

            <label class="hmm-config-row">
                <span>{t('Homematic Manager Address')}</span>
                <select class="hmm-select" bind:value={draft.callback.ip}>
                    <option value="">{t('Select')}</option>
                    {#each addressOptions as address (address)}
                        <option value={address}>{address}</option>
                    {/each}
                </select>
            </label>

            <label class="hmm-config-row">
                <span>{t('Callback XML-RPC port')}</span>
                <input class="hmm-input" type="number" min="0" bind:value={draft.callback.xmlrpcPort} />
                <small>{t('0 picks a free port')}</small>
            </label>

            <label class="hmm-config-row">
                <span>{t('Callback BIN-RPC port')}</span>
                <input class="hmm-input" type="number" min="0" bind:value={draft.callback.binrpcPort} />
            </label>

            <label class="hmm-config-row">
                <span>{t('Use TLS')}</span>
                <input type="checkbox" bind:checked={draft.tls} />
            </label>

            <!--
                No protocol choice: off the CCU every interface is XML-RPC through lighttpd, BIN-RPC
                exists on the CCU's loopback only (D-28). `local`, the contract flag for that, is
                deliberately not here: the addon sets it for its own environment and a desktop user
                toggling it would just break their connection.
            -->

            <label class="hmm-config-row">
                <span>{t('Use Auth')}</span>
                <input type="checkbox" bind:checked={useAuth} />
            </label>

            <label class="hmm-config-row">
                <span>{t('Auth User')}</span>
                <input
                    class="hmm-input"
                    disabled={!useAuth}
                    value={draft.auth?.user ?? ''}
                    oninput={(event) => setAuthField('user', event.currentTarget.value)}
                />
            </label>

            <label class="hmm-config-row">
                <span>{t('Auth Pass')}</span>
                <input
                    class="hmm-input"
                    type="password"
                    disabled={!useAuth}
                    value={draft.auth?.password ?? ''}
                    oninput={(event) => setAuthField('password', event.currentTarget.value)}
                />
            </label>

            <label class="hmm-config-row">
                <span>{t('Use ReGa')}</span>
                <input type="checkbox" bind:checked={draft.rega} />
            </label>

            <!--
                Issue #26. Off by default and never on by accident: acknowledging is a write to the
                device, and the list of what was unreachable is what a user watching it would lose.
                The unreach counter in the Funk tab is what keeps that information either way.
            -->
            <label class="hmm-config-row">
                <span>{t('Acknowledge STICKY_UNREACH automatically')}</span>
                <input
                    type="checkbox"
                    checked={draft.autoAckStickyUnreach === true}
                    data-testid="config-auto-ack-unreach"
                    onchange={(event) => setAutoAck(event.currentTarget.checked)}
                />
            </label>

            <!--
                Issue #54. Greyed out without ReGa rather than hidden: a user who wonders where the
                option went should see that it is the ReGa switch above that turns it off (D-2).
            -->
            <label class="hmm-config-row">
                <span>{t('Confirm the ReGa inbox automatically')}</span>
                <input
                    type="checkbox"
                    disabled={!draft.rega}
                    checked={draft.autoConfirmRegaInbox === true}
                    data-testid="config-auto-confirm-inbox"
                    onchange={(event) => setAutoConfirmInbox(event.currentTarget.checked)}
                />
            </label>

            <!--
                D-36, task 22: the switch left the header and is one of the settings now. The first
                entry is the default - the browser's own order with English behind it - and a
                choice made here is stored in the profile and wins over the browser.
            -->
            <label class="hmm-config-row">
                <span>{t('Language')}</span>
                <LanguageSwitch
                    language={draft.language ?? 'auto'}
                    label={t('Language')}
                    autoLabel={t('Browser language')}
                    testId="config-language"
                    onchange={setDraftLanguage}
                />
            </label>

            <label class="hmm-config-row">
                <span>{t('RPC Delay (ms)')}</span>
                <input class="hmm-input" type="number" min="0" bind:value={draft.writePaceMs} />
            </label>

            <label class="hmm-config-row">
                <span>{t('RPC Log Folder')}</span>
                <input class="hmm-input" bind:value={draft.rpcLogFolder} />
            </label>

            <label class="hmm-config-row">
                <span>{t('Clear Cache')}</span>
                <input type="checkbox" bind:checked={clearCaches} data-testid="config-clear-cache" />
            </label>

            <!--
                User-defined interfaces (#135, D-13): a CUxD on another port, a second rfd, a
                Homegear. Anything the interface table does not know is described here, and the name
                then appears in the interface list above. No protocol choice for the built-in ones
                (D-28) - only an extra interface may declare `binrpc`, because only a non-CCU peer
                can be reached that way.
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
        gap: 4px;
    }

    /*
        `minmax(0, 1fr)`, not `1fr`: a plain `1fr` track is `minmax(auto, 1fr)` and grows to the
        widest thing in it, so the interface picker's summary - every configured interface, comma
        separated - pushed the dialog into a horizontal scrollbar as soon as a CCU had more than
        two of them (task 19's rule; found with the five-interface demo of task 21).
    */
    .hmm-config-row {
        display: grid;
        grid-template-columns: 210px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
    }

    .hmm-config-row small {
        color: var(--hmm-fg-muted);
    }

    .hmm-config-extra {
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        padding: 6px;
        margin: 4px 0 0;
    }

    .hmm-config-extra-row {
        display: grid;
        grid-template-columns: 1fr 1fr 80px 90px 1fr auto;
        gap: 4px;
        margin-bottom: 4px;
    }

    .hmm-config-problem {
        grid-column: 1 / -1;
        color: var(--hmm-error);
        font-size: var(--hmm-font-size-small);
    }
</style>
