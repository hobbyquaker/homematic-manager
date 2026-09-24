<script lang="ts">
    import {
        isDeviceKey,
        isSgtin,
        normaliseKeyText,
        parseHmipCode,
        renameEntries,
        type InstallModeOptions,
        type MetaHmipPairing,
    } from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';

    import QrScanner from './QrScanner.svelte';
    import type {CreateQrReader} from './qrReader.js';

    interface Props {
        open?: boolean;
        /** Injected by the tests in place of `@zxing/browser`. */
        createReader?: CreateQrReader | undefined;
    }

    let {open = $bindable(false), createReader = undefined}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /** How often the countdown asks the interface how much install time is left. */
    const COUNTDOWN_MS = 1000;

    let seconds = $state(60);
    let bidcosMode = $state(1);
    let serial = $state('');
    let tempKey = $state('');
    /**
     * The three ways an HmIP device is admitted. Task 28 added `ANY`: no SGTIN at all, for the
     * device whose sticker is unreadable, glued to a wall or simply gone - what the CCU WebUI has
     * always offered.
     */
    let hmipMode = $state<'KEY' | 'SGTIN' | 'ANY'>('KEY');
    /**
     * Task 66: what the system says about HmIP pairing - asked when the dialog opens on an HmIP
     * interface, `undefined` wherever nothing says anything (a CCU, an older system, no answer),
     * and then the three ways stay as they always were.
     */
    let pairing = $state<MetaHmipPairing | undefined>(undefined);
    let sgtin = $state('');
    let deviceKey = $state('');
    let scanning = $state(false);
    let scanError = $state('');
    let remaining = $state(0);
    let busy = $state(false);
    /** Devices that arrived while this dialog was open - the ones #24 wants named straight away. */
    let paired = $state<string[]>([]);
    let names = $state<Record<string, string>>({});
    /** Task 65: one box for the whole *New* section, ticked at every opening, as in the rename dialog. */
    let renameChannels = $state(true);
    /** #54: what the last inbox confirmation did, as one line under the button. */
    let inboxConfirmed = $state('');
    /**
     * Task 28: the window ran out and nothing joined. The interface reports nothing about a device
     * that never asked - and one that is still paired with another central sends no inclusion
     * request at all - so the dialog says it once the window has closed, instead of just going quiet.
     */
    let nothingJoined = $state(false);
    /**
     * Bumped by every start and every stop: a countdown answer that arrives after the user pressed
     * Stop belongs to a window that is already closed and must not report on it.
     */
    let installWindow = 0;

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const isHmip = $derived(!interfaceType.startsWith('BidCos') && interfaceType !== 'CUxD');
    const isWired = $derived(interfaceType === 'BidCos-Wired');
    const keyReady = $derived(
        hmipMode === 'ANY' ? true : hmipMode === 'SGTIN' ? isSgtin(sgtin) : isSgtin(sgtin) && isDeviceKey(deviceKey),
    );
    /**
     * Task 66: on a system whose key mode is `LOCAL` the key server is never asked, so "SGTIN only"
     * cannot work there and is not offered - hidden, not disabled. `KEY` is never touched: the
     * printed key is what the interface gets, key server or not.
     */
    const localKeysOnly = $derived(pairing?.keyserver_mode === 'LOCAL');
    /**
     * Task 28: the one practical difference between the three ways is whether the box needs the
     * internet - only SGTIN and key works offline, the other two take the key from eQ-3's key server.
     * Task 66: on a `LOCAL` system the third way pairs only a device whose key is stored there, and
     * the line says how many keys that is.
     */
    const hmipHint = $derived(
        hmipMode === 'KEY'
            ? t('Works offline: the key from the sticker is all the interface needs.')
            : hmipMode === 'SGTIN'
              ? t("The key comes from eQ-3's key server: the box needs internet access.")
              : localKeysOnly
                ? t(
                      "Pairs the next device in factory state that asks to join, if its key is on the system: the system's key mode never asks eQ-3's key server. {count} device keys are stored on the system.",
                      {},
                      pairing?.device_keys ?? 0,
                  )
                : t(
                      "Pairs the next device in factory state that asks to join. Without a key the interface asks eQ-3's key server, so the box needs internet access unless a local key mapping is configured.",
                  ),
    );

    /** Task 66: the system's answer, fresh on every open - a key-mode switch there shows at the next one. */
    $effect(() => {
        if (!open || !isHmip) {
            return;
        }
        let current = true;
        void stores.devices.hmipPairing().then((answer) => {
            if (current) {
                pairing = answer;
            }
        });
        return () => {
            current = false;
        };
    });

    /** Task 66: a choice the system cannot do falls back to the one that always works. */
    $effect(() => {
        if (localKeysOnly && hmipMode === 'SGTIN') {
            hmipMode = 'KEY';
        }
    });

    $effect(() => {
        if (open) {
            return;
        }
        scanning = false;
        remaining = 0;
        paired = [];
        names = {};
        renameChannels = true;
        inboxConfirmed = '';
        nothingJoined = false;
    });

    /** There is nothing to scan without an SGTIN; a running camera is switched off with the fields. */
    $effect(() => {
        if (hmipMode === 'ANY') {
            scanning = false;
        }
    });

    /** New devices while the dialog is open: #24 asks for them by name before they are forgotten. */
    $effect(() => {
        if (!open) {
            return;
        }
        return stores.transport.on('devices.changed', (change) => {
            if (change.interfaceName !== interfaceName || change.kind !== 'new') {
                return;
            }
            const fresh = change.addresses.filter((address) => !address.includes(':') && !paired.includes(address));
            if (fresh.length > 0) {
                paired = [...paired, ...fresh];
            }
        });
    });

    /** The countdown of the 2.x "Anlernmodus aktiv" dialog, driven by `getInstallMode`. */
    $effect(() => {
        if (!open || remaining <= 0) {
            return;
        }
        const current = installWindow;
        const timer = setInterval(() => {
            void stores.devices.installModeSeconds(interfaceName).then((left) => {
                if (current !== installWindow) {
                    return;
                }
                remaining = left;
                // task 28: the window closed by itself and nobody came
                if (left <= 0 && isHmip && paired.length === 0) {
                    nothingJoined = true;
                }
            });
        }, COUNTDOWN_MS);
        return () => {
            clearInterval(timer);
        };
    });

    /**
     * The two BidCos actions of 2.7, kept apart on purpose.
     *
     * `homematic-manager.js:1215` had two buttons: one next to the serial field, which sent
     * `addDevice(serial, mode)` and nothing else, and one next to the duration, which sent
     * `setInstallMode(true, time, mode)` and opened the countdown. `addDevice` pairs one known
     * device straight away - no install mode is opened, so there is no countdown to show and the
     * duration means nothing. One button that did both would have to lie about one of them.
     */
    async function start(options: InstallModeOptions): Promise<void> {
        busy = true;
        nothingJoined = false;
        installWindow += 1;
        const ok = await stores.devices.setInstallMode(interfaceName, true, {seconds, ...options});
        busy = false;
        // `addDevice` opens no install mode, so nothing counts down (checked against 2.7)
        if (ok && options.address === undefined) {
            remaining = seconds;
        }
    }

    async function stop(): Promise<void> {
        installWindow += 1;
        await stores.devices.setInstallMode(interfaceName, false);
        remaining = 0;
    }

    /** BidCos-Wired has no install mode; `searchDevices` is what 2.x sent there. */
    async function searchWired(): Promise<void> {
        busy = true;
        await stores.console.call(interfaceName, 'searchDevices', ['']);
        busy = false;
        await stores.devices.load(interfaceName, {refresh: true});
    }

    function applyScan(text: string): void {
        const parsed = parseHmipCode(text);
        if (!parsed) {
            scanError = t('That is not a HomematicIP device code');
            return;
        }
        scanError = '';
        sgtin = parsed.sgtin;
        if (parsed.key !== '') {
            deviceKey = parsed.key;
        }
        scanning = false;
    }

    /** #54: confirm the CCU's inbox by hand, and say what it confirmed. */
    async function confirmInbox(): Promise<void> {
        busy = true;
        const confirmed = await stores.devices.confirmRegaInbox();
        busy = false;
        inboxConfirmed =
            confirmed.length === 0 ? t('The ReGa inbox is empty') : `${t('Confirmed')}: ${confirmed.join(', ')}`;
    }

    /**
     * Task 65: the rename dialog's rule (core's `renameEntries`) for every named device - its `:0`
     * always, its other channels with the box. The channel list is read now, at Apply, so a device
     * whose channels have not arrived gets its name and `:0` and nothing half-done.
     */
    async function saveNames(): Promise<void> {
        const entries = paired.flatMap((address) =>
            renameEntries(
                address,
                names[address] ?? '',
                stores.devices.channels(interfaceName, address).map((channel) => channel.ADDRESS),
                {channels: renameChannels},
            ),
        );
        if (entries.length === 0) {
            return;
        }
        if (await stores.names.rename(entries)) {
            paired = paired.filter((address) => (names[address] ?? '').trim() === '');
        }
    }
</script>

<Dialog bind:open title={t('Add device')} width="680px" testId="add-device-dialog">
    {#if isWired}
        <p>{t('BidCos-Wired has no install mode; the interface searches its bus for new devices.')}</p>
        <button
            type="button"
            class="hmm-button"
            disabled={busy}
            data-testid="add-device-search"
            onclick={() => void searchWired()}>searchDevices</button
        >
    {:else if isHmip}
        <label class="hmm-add-row">
            <span>{t('Mode')}</span>
            <select class="hmm-select" bind:value={hmipMode} data-testid="add-device-hmip-mode">
                <option value="KEY">{t('With SGTIN and key')}</option>
                {#if !localKeysOnly}
                    <option value="SGTIN">{t('With SGTIN only (key server)')}</option>
                {/if}
                <option value="ANY">{t('Any device (no SGTIN)')}</option>
            </select>
        </label>
        <div class="hmm-add-row">
            <span></span>
            <p class="hmm-add-hint" data-testid="add-device-hmip-hint">{hmipHint}</p>
        </div>
        <!-- openccu-lite task 217: an access point (HAP, DRAP) is paired through the same install mode -->
        <div class="hmm-add-row">
            <span></span>
            <p class="hmm-add-hint" data-testid="add-device-ap-hint">
                {t(
                    'An access point (HAP, DRAP) is paired like a device: factory-reset it, start the install mode, then power it. System and access point must be in the same network.',
                )}
            </p>
        </div>

        {#if hmipMode !== 'ANY'}
            <label class="hmm-add-row">
                <span>SGTIN</span>
                <input
                    class="hmm-input hmm-mono"
                    class:hmm-add-invalid={sgtin !== '' && !isSgtin(sgtin)}
                    value={sgtin}
                    data-testid="add-device-sgtin"
                    oninput={(event) => (sgtin = normaliseKeyText(event.currentTarget.value))}
                />
            </label>

            {#if hmipMode === 'KEY'}
                <label class="hmm-add-row">
                    <span>KEY</span>
                    <input
                        class="hmm-input hmm-mono"
                        class:hmm-add-invalid={deviceKey !== '' && !isDeviceKey(deviceKey)}
                        value={deviceKey}
                        data-testid="add-device-key"
                        oninput={(event) => (deviceKey = normaliseKeyText(event.currentTarget.value))}
                    />
                </label>
                <div class="hmm-add-row">
                    <span></span>
                    <p class="hmm-add-hint" data-testid="add-device-key-hint">
                        {t('The key from the sticker (26 characters, dashes optional), or scan the QR code.')}
                    </p>
                </div>
            {/if}

            <div class="hmm-add-row">
                <span>{t('QR scanner')}</span>
                <div>
                    <button
                        type="button"
                        class="hmm-button"
                        data-testid="add-device-scan"
                        onclick={() => {
                            scanError = '';
                            scanning = !scanning;
                        }}>{scanning ? t('Stop') : t('Scan')}</button
                    >
                    {#if scanError !== ''}<span class="hmm-add-error" data-testid="add-device-scan-error"
                            >{scanError}</span
                        >{/if}
                </div>
            </div>

            <QrScanner
                active={scanning}
                {createReader}
                insecureContextMessage={t(
                    'The camera is only available over https or on localhost. Open the page with its https address (the CCU serves it on its https port too, with a certificate warning) or type the key in by hand.',
                )}
                onscan={applyScan}
                onerror={(message) => {
                    scanError = message;
                    scanning = false;
                }}
                testId="add-device-video"
            />
        {/if}
    {:else}
        <label class="hmm-add-row">
            <span>{t('Mode')}</span>
            <select class="hmm-select" bind:value={bidcosMode} data-testid="add-device-mode">
                <option value={1}>{t('Normal install mode')}</option>
                <option value={2}>{t('Write the MASTER defaults and delete the existing links')}</option>
            </select>
        </label>

        <!--
            `addDevice` is not the install mode: it tells the interface to fetch one device it
            already knows the serial of. 2.7 had its own button for it, and so does this.
        -->
        <label class="hmm-add-row">
            <span>{t('Serial number')}</span>
            <span class="hmm-add-inline">
                <input class="hmm-input hmm-mono" bind:value={serial} data-testid="add-device-serial" />
                <button
                    type="button"
                    class="hmm-button"
                    disabled={busy || serial.trim() === ''}
                    data-testid="add-device-serial-start"
                    onclick={() =>
                        void start({
                            mode: bidcosMode,
                            address: serial.trim(),
                            ...(tempKey.trim() === '' ? {} : {tempKey: tempKey.trim()}),
                        })}>{t('Add by serial number')}</button
                >
            </span>
        </label>

        <!--
            Issue #20: a device that was taught in with a temporary key can only be paired again
            when the same key is offered. 2.x had no field for it at all.
        -->
        <label class="hmm-add-row">
            <span>{t('Temporary key')}</span>
            <input class="hmm-input hmm-mono" bind:value={tempKey} data-testid="add-device-temp-key" />
        </label>
    {/if}

    {#if !isWired}
        <label class="hmm-add-row">
            <span>{t('Duration')}</span>
            <span>
                <input class="hmm-input hmm-add-seconds" type="number" min="10" max="300" bind:value={seconds} /> s
            </span>
        </label>

        <div class="hmm-add-actions">
            <button
                type="button"
                class="hmm-button"
                disabled={busy || (isHmip && !keyReady)}
                data-testid="add-device-start"
                onclick={() =>
                    void start(
                        isHmip
                            ? hmipMode === 'ANY'
                                ? // task 28: no SGTIN, no key - the backend sends two arguments
                                  {hmipKeyMode: 'ANY'}
                                : {
                                      hmipKeyMode: hmipMode,
                                      hmipKey: {sgtin, key: hmipMode === 'SGTIN' ? '' : deviceKey},
                                  }
                            : {
                                  mode: bidcosMode,
                                  ...(tempKey.trim() === '' ? {} : {tempKey: tempKey.trim()}),
                              },
                    )}>{t('Start install mode')}</button
            >
            {#if remaining > 0}
                <span data-testid="add-device-countdown">{t('{count} seconds left', {}, remaining)}</span>
                <button type="button" class="hmm-button" data-testid="add-device-stop" onclick={() => void stop()}
                    >{t('Stop')}</button
                >
            {/if}
        </div>
        {#if nothingJoined}
            <p class="hmm-add-notice" role="status" data-testid="add-device-nothing-joined">
                {t(
                    'The install mode has ended and no device has joined. A device that is still paired with another central sends no inclusion request: reset it to factory state and start again.',
                )}
            </p>
        {/if}
    {/if}

    <!--
        Issue #54: a device that has just been paired stays in the CCU's inbox until somebody
        confirms it there. Shown only where there is an inbox at all (D-2).
    -->
    {#if stores.interfaces.rega?.enabled === true}
        <div class="hmm-add-actions">
            <button
                type="button"
                class="hmm-button"
                disabled={busy}
                data-testid="add-device-confirm-inbox"
                onclick={() => void confirmInbox()}>{t('Confirm the ReGa inbox')}</button
            >
            {#if inboxConfirmed !== ''}
                <span data-testid="add-device-inbox-result">{inboxConfirmed}</span>
            {/if}
        </div>
        <!-- B-64: names given to a device still in the inbox are this application's until it is confirmed -->
        {#if (stores.interfaces.rega.pendingNames?.length ?? 0) > 0}
            <p class="hmm-add-notice" role="status" data-testid="add-device-names-waiting">
                {t('The names reach the CCU once the device is confirmed in the ReGa inbox.')}
            </p>
        {/if}
    {/if}

    {#if paired.length > 0}
        <!--
            Issue #24: 2.x pulled the new device into the grid and left the user to find it and
            rename it afterwards. Here it is named where it appeared.
        -->
        <section class="hmm-add-paired" data-testid="add-device-paired">
            <h4>{t('New')}</h4>
            {#each paired as address (address)}
                <label class="hmm-add-row">
                    <span class="hmm-mono">{address}</span>
                    <input
                        class="hmm-input"
                        placeholder={t('Name')}
                        aria-label={`${t('Name')} ${address}`}
                        value={names[address] ?? ''}
                        oninput={(event) => (names = {...names, [address]: event.currentTarget.value})}
                    />
                </label>
            {/each}
            <label class="hmm-add-channels">
                <input type="checkbox" bind:checked={renameChannels} data-testid="add-device-rename-children" />
                <span>{t('Overwrite channel names')}</span>
            </label>
            <button type="button" class="hmm-button" data-testid="add-device-name-save" onclick={() => void saveNames()}
                >{t('Apply')}</button
            >
        </section>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
    {/snippet}
</Dialog>

<style>
    .hmm-add-row {
        display: grid;
        grid-template-columns: 190px minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        margin-bottom: 6px;
    }

    /* D-34: nothing leaves the dialog sideways. A grid cell whose content is wider than its track
       would push the whole row out, so every cell may shrink and the controls inside wrap. */
    .hmm-add-row > * {
        min-width: 0;
    }

    .hmm-add-row input,
    .hmm-add-row select {
        max-width: 100%;
    }

    .hmm-add-seconds {
        width: 80px;
    }

    .hmm-add-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        min-width: 0;
    }

    .hmm-add-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
    }

    .hmm-add-invalid {
        border-color: var(--hmm-error);
    }

    .hmm-add-error {
        color: var(--hmm-error);
        margin-left: 8px;
    }

    /* Task 28: what the chosen way needs, under the mode it belongs to. */
    .hmm-add-hint {
        margin: -2px 0 4px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        line-height: 1.35;
    }

    /* Task 28: said once the window has run out - a warning, not an error, since nothing broke. */
    .hmm-add-notice {
        margin: 8px 0 0;
        color: var(--hmm-warn);
    }

    .hmm-add-paired {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--hmm-border);
    }

    .hmm-add-paired h4 {
        margin: 0 0 6px;
    }

    .hmm-add-channels {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
    }
</style>
