<script lang="ts">
    import type {ConnectionConfig, Language} from '@homematic-manager/core';
    import {DEFAULT_INTERFACES, INTERFACE_NAMES} from '@homematic-manager/core';

    import Dialog from '../lib/components/Dialog.svelte';
    import MultiSelect from '../lib/components/MultiSelect.svelte';
    import {UI_LANGUAGES, LANGUAGE_LABELS} from '../lib/i18n/i18n.svelte.js';
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
                      language: stores.app.language,
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
            stores.app.setLanguage(connection.language);
            stores.i18n.language = connection.language;
            open = false;
            await stores.start();
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

            {#if discovered.length > 0}
                <label class="hmm-config-row">
                    <span>{t('Discovered CCUs')}</span>
                    <select
                        class="hmm-select"
                        onchange={(event) => {
                            if (draft && event.currentTarget.value !== '') {
                                draft.host = event.currentTarget.value;
                            }
                        }}
                    >
                        <option value="">{t('Select')}</option>
                        {#each discovered as ccu (ccu.address)}
                            <option value={ccu.address}>{ccu.address} {ccu.serial ?? ''}</option>
                        {/each}
                    </select>
                </label>
            {/if}

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

            <label class="hmm-config-row">
                <span>{t('Language')}</span>
                <select class="hmm-select" bind:value={draft.language}>
                    {#each UI_LANGUAGES as language (language)}
                        <option value={language}>{LANGUAGE_LABELS[language as Language]}</option>
                    {/each}
                </select>
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
                <input type="checkbox" bind:checked={clearCaches} />
            </label>
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

    .hmm-config-row {
        display: grid;
        grid-template-columns: 210px 1fr auto;
        gap: 8px;
        align-items: center;
    }

    .hmm-config-row small {
        color: var(--hmm-fg-muted);
    }
</style>
