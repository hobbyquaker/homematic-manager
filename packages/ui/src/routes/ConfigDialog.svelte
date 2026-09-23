<script lang="ts">
    import type {
        CallbackAddressInfo,
        CallbackPins,
        ConnectionConfig,
        LanguageChoice,
        MetaProviderChoice,
        UserDefinedInterface,
    } from '@homematic-manager/core';
    import {
        callbackPinOption,
        DEFAULT_INTERFACES,
        META_PROVIDERS,
        validateUserDefinedInterface,
    } from '@homematic-manager/core';

    import Dialog from '../lib/components/Dialog.svelte';
    import LanguageSwitch from '../lib/components/LanguageSwitch.svelte';
    import MultiSelect from '../lib/components/MultiSelect.svelte';
    import {getStores} from '../lib/stores/context.js';
    import {isHmipInterface} from '../lib/stores/suppression.js';
    import {interfaceChoices, removeExtraTick, renameExtraTick} from './extraInterfaceTicks.js';
    import StickyUnreachQuestion from './StickyUnreachQuestion.svelte';

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

    /**
     * #149: "Save & Restart" only does something when there is something to save. The button used
     * to be live on a dialog nobody had touched, so a click that changed nothing looked like a
     * button that did nothing.
     */
    const stored = $derived(stores.app.config?.connection);
    /** Task 35: the ports a `0` stands for in the CCU addon; absent everywhere else. */
    const callbackDefaults = $derived(stores.app.config?.callbackDefaultPorts);
    /**
     * Task 38: the callback fields the host was started with (`HMM_CALLBACK_*`, `--callback-*`).
     * They win over anything saved here, so they are shown read-only with the option that set them;
     * the backend would not save another value over them either.
     */
    const callbackPinned = $derived(stores.app.config?.callbackPinned);

    function pinned(field: keyof CallbackPins): boolean {
        return callbackPinned?.[field] === true;
    }

    function pinHint(field: keyof CallbackPins): string {
        return t('Set at start ({option})', {option: callbackPinOption(field)});
    }
    const dirty = $derived(
        clearCaches ||
            draft === undefined ||
            stored === undefined ||
            JSON.stringify($state.snapshot(draft)) !== JSON.stringify(stored) ||
            useAuth !== (stored.auth !== undefined),
    );

    $effect(() => {
        if (open && draft === undefined) {
            stores.app.saveError = '';
            // task 34: an answer belongs to the dialog it was given in, not to the next one
            askAboutExisting = false;
            acknowledgeExisting = false;
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
            // B-27: a saved row is ticked exactly when the profile says so, and nothing here changes that
            const {extraInterfaces, interfaces} = draft;
            heldTicks = extraInterfaces.map((extra) => interfaces.includes(extra.name));
        }
        if (!open) {
            draft = undefined;
        }
    });

    /**
     * B-27 (#135): the extra interfaces are offered as well. The list used to be the built-in names
     * and whatever was ticked already, so an extra interface added here could never be ticked - and
     * the backend connects only what is ticked.
     */
    const interfaceOptions = $derived(
        interfaceChoices(draft?.interfaces ?? [], draft?.extraInterfaces ?? []).map((name) => ({
            value: name,
            label: name,
        })),
    );
    /**
     * Each extra-interface row's tick while its name cannot carry it - empty, or the name of a
     * built-in interface or of another row (see `extraInterfaceTicks.ts`). Not rendered, so not state.
     */
    let heldTicks: boolean[] = [];
    const addressOptions = $derived(stores.app.config?.localAddresses ?? []);

    /**
     * B-53 (#162, #165): the automatic callback address for the host in the field, asked again a
     * moment after the host changes. `askedHost` is plain on purpose: the effect must not run again
     * because an answer arrived.
     */
    let askedHost: string | undefined;
    $effect(() => {
        if (!open || draft === undefined) {
            askedHost = undefined;
            return;
        }
        const host = draft.host.trim();
        if (host === askedHost) {
            return;
        }
        const wait = askedHost === undefined ? 0 : 400;
        const timer = setTimeout(() => {
            askedHost = host;
            void stores.app.loadCallbackAddresses(host);
        }, wait);
        return () => {
            clearTimeout(timer);
        };
    });
    /** The answer, only while it is about the host in the field. */
    const callbackInfo = $derived<CallbackAddressInfo | undefined>(
        stores.app.callbackAddresses !== undefined && stores.app.callbackAddresses.host === draft?.host.trim()
            ? stores.app.callbackAddresses
            : undefined,
    );
    const autoLabel = $derived.by(() => {
        if (callbackInfo === undefined) {
            return t('Automatic');
        }
        const {address, reason} = callbackInfo.auto;
        const why = {
            subnet: t("in the CCU's network"),
            route: t('on the route to the CCU'),
            loopback: t('the CCU is on this machine'),
            first: t('no better match'),
        }[reason];
        return t('Automatic ({address}, {why})', {address, why});
    });
    /** Every address with its marks; the plain list of the configuration where the backend has no answer. */
    const addressChoices = $derived(
        callbackInfo === undefined
            ? addressOptions.map((address) => ({address, label: address}))
            : callbackInfo.addresses.map((entry) => {
                  const marks = [
                      ...(callbackInfo.hostAddress !== undefined && !entry.inSubnet
                          ? [t("not in the CCU's network")]
                          : []),
                      ...(entry.linkLocal === true ? [t('link-local')] : []),
                  ];
                  return {
                      address: entry.address,
                      label: marks.length === 0 ? entry.address : `${entry.address} (${marks.join(', ')})`,
                  };
              }),
    );
    /**
     * B-53: a set address that does not fit - no address of this machine (the backend takes the
     * automatic one instead), or outside the CCU's network and not on the route to it. Nothing is
     * said where the host keeps a set address as it is (task 38) or on the CCU itself.
     */
    const callbackWarning = $derived.by(() => {
        const ip = draft?.callback.ip ?? '';
        if (ip === '' || callbackInfo === undefined || callbackInfo.keepsConfigured === true) {
            return '';
        }
        if (pinned('ip') || draft?.local === true || ip === '127.0.0.1') {
            return '';
        }
        const entry = callbackInfo.addresses.find((candidate) => candidate.address === ip);
        if (entry === undefined) {
            return t('The callback address {address} is not an address of this machine; {auto} is used instead', {
                address: ip,
                auto: callbackInfo.auto.address,
            });
        }
        if (callbackInfo.hostAddress !== undefined && !entry.inSubnet && ip !== callbackInfo.auto.address) {
            return t(
                "The callback address {address} is not in the CCU's network; the CCU may not reach it and send no events",
                {address: ip},
            );
        }
        return '';
    });
    const discovered = $derived(stores.app.config?.discovered ?? []);

    /**
     * Task 23: what the About dialog used to say, as the foot of the one dialog that is about this
     * installation. The version is the API's, which is the only one every host has; the data set is
     * what `data/` was generated from (D-10), and the licence is the project's (D-26). The host's
     * own numbers are there only where there is a host - `apps/web`, the addon and demo mode have
     * no `window.__HMM_HOST__` - and they are what a bug report needs.
     */
    const version = $derived(stores.app.config?.version ?? '');
    const manifest = $derived(stores.meta.manifest);
    const hostInfo = $derived(stores.host.info);
    const dataLine = $derived(
        manifest === undefined
            ? ''
            : `${manifest.sources.map((source) => `${source.name} ${source.version}`).join(', ')} (${manifest.generatedAt.slice(0, 10)})`,
    );
    const hostLine = $derived(
        hostInfo === undefined
            ? ''
            : `Electron ${hostInfo.electron} \u00b7 Chromium ${hostInfo.chrome} \u00b7 Node ${hostInfo.node} \u00b7 ${hostInfo.platform} ${hostInfo.arch}`,
    );

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
        // task 34: the answer to the one-time question, only while the switch is still on
        const ok = await stores.app.save(
            connection,
            connection.autoAckStickyUnreach === true && acknowledgeExisting ? {acknowledgeExisting: true} : undefined,
        );
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

    /**
     * B-27 (#135): a row added here is ticked from the start - whoever adds an interface wants it
     * connected. A row has nothing to tick without a name, so the tick is held for it and lands in
     * the interface list with the first character typed. A row loaded from the profile is never
     * ticked by the dialog: its tick is what was saved.
     */
    function addExtra(): void {
        if (!draft) {
            return;
        }
        const extra: UserDefinedInterface = {name: '', host: '', port: 2001, protocol: 'xmlrpc', path: ''};
        draft.extraInterfaces = [...draft.extraInterfaces, extra];
        heldTicks = [...heldTicks, true];
    }

    /** B-27: the tick follows the name, in its place in the list. */
    function renameExtra(index: number, name: string): void {
        const extra = draft?.extraInterfaces[index];
        if (!draft || !extra || extra.name === name) {
            return;
        }
        const next = renameExtraTick(
            draft.interfaces,
            draft.extraInterfaces,
            index,
            extra.name,
            name,
            heldTicks[index] ?? false,
        );
        heldTicks[index] = next.ticked;
        draft.extraInterfaces[index] = {...extra, name};
        draft.interfaces = next.interfaces;
    }

    function removeExtra(index: number): void {
        if (!draft) {
            return;
        }
        draft.interfaces = removeExtraTick(draft.interfaces, draft.extraInterfaces, index);
        draft.extraInterfaces = draft.extraInterfaces.filter((_entry, at) => at !== index);
        heldTicks = heldTicks.filter((_tick, at) => at !== index);
    }

    /**
     * Task 34 (#147, D-42): the STICKY_UNREACH messages in the list that switching the
     * auto-acknowledge on would leave there for good - HmIP's left out, because nothing is
     * acknowledged on HmIP. The backend applies the same rule to `acknowledgeExisting`.
     */
    const stickyCount = $derived(
        stores.serviceMessages.messages.filter(
            (message) =>
                message.datapoint === 'STICKY_UNREACH' &&
                message.value !== false &&
                !isHmipInterface(message.interfaceName, stores.interfaces.typeOf(message.interfaceName)),
        ).length,
    );
    /** The one-time question is open. */
    let askAboutExisting = $state(false);
    /** The answer was "acknowledge them": sent with the save, forgotten when the switch goes off. */
    let acknowledgeExisting = $state(false);
    /**
     * What the draft said before the click that opened the question - `undefined` included, since
     * a profile that never stored the option has no key, and putting back an explicit `false`
     * would make an untouched dialog look changed (#149's dirty check).
     */
    let autoAckBeforeQuestion: boolean | undefined;

    /**
     * #26: the auto-acknowledge switch, guarded the way every other draft field is.
     *
     * Task 34: switched on while the stored option is off and such messages are listed, it asks
     * first. The draft is on while the question is open, so the box shows what was clicked, and a
     * question closed without an answer puts it back. Nothing is written here either way - the
     * answer travels with "Save & Restart".
     */
    function setAutoAck(value: boolean): void {
        if (!draft) {
            return;
        }
        const before = draft.autoAckStickyUnreach;
        draft.autoAckStickyUnreach = value;
        acknowledgeExisting = false;
        if (value && stored?.autoAckStickyUnreach !== true && stickyCount > 0) {
            autoAckBeforeQuestion = before;
            askAboutExisting = true;
        }
    }

    function cancelAutoAck(): void {
        if (draft) {
            if (autoAckBeforeQuestion === undefined) {
                delete draft.autoAckStickyUnreach;
            } else {
                draft.autoAckStickyUnreach = autoAckBeforeQuestion;
            }
        }
        acknowledgeExisting = false;
    }

    /**
     * B-62: ReGa is off because the connected system has no ReGaHSS (it is an openccu-lite), which
     * the backend reports as the state's reason. Only while the draft still names that host: a
     * user typing another address is configuring another system.
     */
    const regaOffByHost = $derived(
        stores.interfaces.rega?.reason === 'openccu-lite' &&
            draft !== undefined &&
            draft.host.trim() === (stored?.host ?? '').trim(),
    );

    /** #54: the same for the ReGa inbox, which only means anything while ReGa is on (D-2). */
    function setAutoConfirmInbox(value: boolean): void {
        if (draft) {
            draft.autoConfirmRegaInbox = value;
        }
    }

    /**
     * D-40, task 25: the store of names, rooms and functions. The choice is one of core's
     * `META_PROVIDERS`; the token is a credential like the CCU password and is written as typed.
     */
    const metaProviderLabels: Record<MetaProviderChoice, () => string> = {
        auto: () => t('Automatic'),
        local: () => t('This profile'),
        // the programs, not the products around them (the maintainer, 2026-09-10)
        occulite: () => 'occulited',
        rega: () => 'ReGaHSS',
    };
    const metaState = $derived(stores.taxonomy.state);
    const metaStateLine = $derived.by(() => {
        if (metaState === undefined) {
            return t('No store connected');
        }
        const parts = [
            metaProviderLabels[metaState.provider](),
            metaState.reachable ? t('Reachable') : t('Unreachable'),
            metaState.reachable ? (metaState.writable ? t('Writable') : t('Read-only')) : undefined,
            t('revision {revision}, {count} objects', {revision: metaState.revision, count: metaState.objects}),
            metaState.implementation,
            metaState.error,
        ];
        return parts.filter((part): part is string => part !== undefined && part !== '').join(' · ');
    });

    function setMetaProvider(value: string): void {
        if (draft && META_PROVIDERS.some((choice) => choice === value)) {
            draft.metaProvider = value as MetaProviderChoice;
        }
    }

    function setMetaToken(value: string): void {
        if (draft) {
            draft.metaToken = value;
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
                                    <select
                                        class="hmm-select hmm-config-wide"
                                        bind:value={draft.callback.ip}
                                        disabled={pinned('ip')}
                                        title={t(
                                            "Automatic takes this machine's address in the CCU's network, else the one on the route to the CCU",
                                        )}
                                        data-testid="config-callback-ip"
                                    >
                                        <!-- B-53: the automatic choice first, then every address with its marks -->
                                        <option value="" data-testid="config-callback-ip-auto">{autoLabel}</option>
                                        {#each addressChoices as choice (choice.address)}
                                            <option value={choice.address}>{choice.label}</option>
                                        {/each}
                                        <!--
                                            Task 38: an address that is not one of this machine's - the
                                            Docker host's, seen from a container - is still what is set,
                                            so it is shown rather than an empty "Select".
                                        -->
                                        {#if draft.callback.ip !== '' && !addressChoices.some((choice) => choice.address === draft?.callback.ip)}
                                            <option value={draft.callback.ip}>{draft.callback.ip}</option>
                                        {/if}
                                    </select>
                                    <small class="hmm-config-help" data-testid="config-callback-ip-hint"
                                        >{pinned('ip')
                                            ? pinHint('ip')
                                            : t('The address the interface processes call back to')}</small
                                    >
                                    {#if callbackWarning !== ''}
                                        <span
                                            class="hmm-config-warning"
                                            role="alert"
                                            data-testid="config-callback-ip-warning"
                                        >
                                            <span>{callbackWarning}</span>
                                            <button
                                                type="button"
                                                class="hmm-button"
                                                data-testid="config-callback-ip-use-auto"
                                                onclick={() => {
                                                    if (draft) {
                                                        draft.callback.ip = '';
                                                    }
                                                }}>{t('Use automatic')}</button
                                            >
                                        </span>
                                    {/if}
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
                                        disabled={pinned('xmlrpcPort')}
                                        data-testid="config-callback-xmlrpc-port"
                                    />
                                    <small class="hmm-config-help" data-testid="config-callback-xmlrpc-port-hint"
                                        >{pinned('xmlrpcPort')
                                            ? pinHint('xmlrpcPort')
                                            : callbackDefaults && callbackDefaults.xmlrpc !== 0
                                              ? t('0 uses port {port}, or a free one when it is taken', {
                                                    port: String(callbackDefaults.xmlrpc),
                                                })
                                              : t('0 picks a free port')}</small
                                    >
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
                                        disabled={pinned('binrpcPort')}
                                        data-testid="config-callback-binrpc-port"
                                    />
                                    <small class="hmm-config-help" data-testid="config-callback-binrpc-port-hint"
                                        >{pinned('binrpcPort')
                                            ? pinHint('binrpcPort')
                                            : callbackDefaults && callbackDefaults.binrpc !== 0
                                              ? t('0 uses port {port}, or a free one when it is taken', {
                                                    port: String(callbackDefaults.binrpc),
                                                })
                                              : t('0 picks a free port')}</small
                                    >
                                </span>
                            </label>
                        </div>
                    </section>

                    <!--
                        D-40, task 25: where names, rooms and functions are kept. `auto` probes
                        the configured host for openccu-lite's metadata API once per connect and
                        keeps everything in this profile otherwise; the token is only needed off
                        the box. The state line is the same one the header's indicator carries.
                    -->
                    <section class="hmm-config-section" data-testid="config-meta">
                        <h3 class="hmm-config-title">{t('Names and rooms')}</h3>
                        <div class="hmm-config-grid">
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Store')}</span>
                                <span class="hmm-config-field">
                                    <select
                                        class="hmm-select"
                                        value={draft.metaProvider ?? 'auto'}
                                        data-testid="config-meta-provider"
                                        onchange={(event) => setMetaProvider(event.currentTarget.value)}
                                    >
                                        {#each META_PROVIDERS as choice (choice)}
                                            <option value={choice}>{metaProviderLabels[choice]()}</option>
                                        {/each}
                                    </select>
                                    <!-- the state of the store that is in use now, which the header's indicator carries too -->
                                    <small class="hmm-config-help" data-testid="config-meta-state"
                                        >{metaStateLine}</small
                                    >
                                </span>
                            </label>

                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('API token')}</span>
                                <span class="hmm-config-field">
                                    <input
                                        class="hmm-input hmm-config-wide"
                                        type="password"
                                        autocomplete="off"
                                        value={draft.metaToken ?? ''}
                                        data-testid="config-meta-token"
                                        oninput={(event) => setMetaToken(event.currentTarget.value)}
                                    />
                                    <small class="hmm-config-help">{t('Only needed off the box')}</small>
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
                                    <small class="hmm-config-help" data-testid="config-interfaces-hint"
                                        >{t('An extra interface is connected once it is ticked here')}</small
                                    >
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
                            <!--
                                B-62: on an openccu-lite system there is no ReGaHSS, and the backend
                                keeps ReGa off whatever the profile says. The switch is greyed out
                                with that reason rather than hidden (D-2's pattern, as #54's row
                                below), and the profile's own value is left alone: the same profile
                                moved to a CCU has ReGa again.
                            -->
                            <label class="hmm-config-row">
                                <span class="hmm-config-label">{t('Use ReGa')}</span>
                                <span class="hmm-config-field">
                                    {#if regaOffByHost}
                                        <input type="checkbox" disabled checked={false} data-testid="config-rega" />
                                        <small class="hmm-config-help"
                                            >{t('Switched off: the system has no ReGaHSS')}</small
                                        >
                                    {:else}
                                        <input type="checkbox" bind:checked={draft.rega} data-testid="config-rega" />
                                        <small class="hmm-config-help">{t('ReGa supplies the friendly names')}</small>
                                    {/if}
                                </span>
                            </label>

                            <!--
                                Issue #54. Greyed out without ReGa rather than hidden: a user who
                                wonders where the option went should see that it is the ReGa switch
                                above that turns it off (D-2). Not shown at all where the system has
                                no ReGa (B-62): there is no inbox there, a paired device is simply there.
                            -->
                            {#if !regaOffByHost}
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
                            {/if}
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
                                <span class="hmm-config-label"
                                    >{t('Acknowledge STICKY_UNREACH automatically as they occur')}</span
                                >
                                <span class="hmm-config-field">
                                    <input
                                        type="checkbox"
                                        checked={draft.autoAckStickyUnreach === true}
                                        data-testid="config-auto-ack-unreach"
                                        onchange={(event) => setAutoAck(event.currentTarget.checked)}
                                    />
                                    <small class="hmm-config-help"
                                        >{t(
                                            'Acknowledging is a write to the device. Switching this on asks once about the messages already in the list.',
                                        )}</small
                                    >
                                    {#if acknowledgeExisting && draft.autoAckStickyUnreach === true}
                                        <!-- task 34: the answer to the question, until it is saved -->
                                        <small class="hmm-config-note" data-testid="config-auto-ack-existing-note"
                                            >{t(
                                                '{count} messages in the list are acknowledged when this is saved',
                                                {},
                                                stickyCount,
                                            )}</small
                                        >
                                    {/if}
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
                then appears in the interface list above - ticked when the row was added here, as
                saved otherwise (B-27: it did not appear there at all). No protocol choice for the built-in ones
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
                            value={extra.name}
                            oninput={(event) => renameExtra(index, event.currentTarget.value)}
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

            <!--
                The About dialog is gone (task 23). Version, device data and licence are one small
                line here, where a user who wants to know what is running already is.
            -->
            <div class="hmm-config-info" data-testid="config-info">
                <p>
                    Homematic Manager {version}
                    {#if dataLine !== ''}&middot; {t('Device data')}: {dataLine}{/if}
                    &middot; AGPL-3.0-or-later &middot; &copy; 2014-2026 Sebastian "Hobbyquaker" Raff
                </p>
                {#if hostLine !== ''}
                    <p data-testid="config-host-info">
                        {hostLine} &middot; <span class="hmm-mono">{hostInfo?.logFile ?? ''}</span>
                    </p>
                {/if}
                <p>HomeMatic und BidCoS sind eingetragene Warenzeichen der eQ-3 AG.</p>
            </div>
        </div>
    {/if}

    {#snippet buttons()}
        {#if saving}
            <!--
                #149: "Speichern und Neustarten" rebuilds the whole connection - on the reporter's
                CCU it took eleven seconds before the dialog closed, with nothing to say that
                anything was happening. It says so now, next to the buttons, and the button itself
                is disabled while it runs.

                Task 32, the same reporter: grey text beside the buttons is easy to miss when one does
                not know it will appear. It is an accent pill with a turning ring now - the accent and
                not the warning colour, because a reconnect that takes a while is nothing to worry
                about - and a polite live region, so a screen reader says it as well.
            -->
            <span class="hmm-config-busy" role="status" aria-live="polite" data-testid="config-saving"
                ><span class="hmm-config-busy-spinner" aria-hidden="true" data-testid="config-saving-spinner"></span>{t(
                    'Saving and reconnecting…',
                )}</span
            >
        {/if}
        {#if stores.app.saveError !== ''}
            <!-- #149: a modal dialog is drawn above the notices, so the failure has to be said here. -->
            <span class="hmm-config-error" data-testid="config-error">{t('Error')}: {stores.app.saveError}</span>
        {/if}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={saving || !dirty}
            data-testid="config-save"
            onclick={() => void save()}>{t('Save & Restart')}</button
        >
    {/snippet}
</Dialog>

<!-- task 34: stacked over the settings while the auto-acknowledge is being switched on -->
<StickyUnreachQuestion
    bind:open={askAboutExisting}
    count={stickyCount}
    onacknowledge={() => (acknowledgeExisting = true)}
    onlynew={() => (acknowledgeExisting = false)}
    oncancel={cancelAutoAck}
/>

<style>
    /*
        Task 32: a pill in the accent, with the ring of the toolbar's busy icon in front. The text
        is `--hmm-fg` and not `--hmm-accent`: the accent on its own tint measures 4.4:1 in light
        and 3.9:1 in dark, under the 4.5:1 a label needs, while the foreground on the tint is
        9.5:1 and 7.2:1. The colour is carried by the tint, the border and the ring (the border
        against the button row's background: 4.8:1 light, 6.0:1 dark).
    */
    .hmm-config-busy {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: auto;
        padding: 2px 10px 2px 8px;
        border: 1px solid var(--hmm-accent);
        border-radius: 999px;
        background: var(--hmm-accent-bg);
        color: var(--hmm-fg);
        font-weight: 600;
    }

    /* The same turn as `hmm-toolbar-spin`: one revolution a second, linear. */
    .hmm-config-busy-spinner {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border: 2px solid var(--hmm-accent);
        border-top-color: transparent;
        border-radius: 50%;
        animation: hmm-config-spin 1s linear infinite;
    }

    @keyframes hmm-config-spin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    /* Standing still, as the toolbar's icon does: the pill and the text still say it. */
    @media (prefers-reduced-motion: reduce) {
        .hmm-config-busy-spinner {
            animation: none;
        }
    }

    .hmm-config-error {
        margin-right: auto;
        color: var(--hmm-error);
    }

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

    /*
        B-53: a set callback address that does not fit. The warning colour of the theme, with its
        one-click way out beside it; it wraps under the select on a narrow dialog.
    */
    .hmm-config-warning {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
        color: var(--hmm-warn);
        font-size: var(--hmm-font-size-small);
    }

    /* Task 34: what "Save & Restart" will also do, in the accent so it is not read past as help. */
    .hmm-config-note {
        color: var(--hmm-accent);
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

    .hmm-config-info {
        border-top: 1px solid var(--hmm-border-muted);
        padding-top: 6px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-config-info p {
        margin: 0;
    }
</style>
