<script lang="ts">
    import type {InstallModeOptions} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';
    import {isDeviceKey, isSgtin, normaliseKeyText, parseHmipCode} from '../../lib/util/hmipKey.js';

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
    let hmipMode = $state<'KEY' | 'SGTIN'>('KEY');
    let sgtin = $state('');
    let deviceKey = $state('');
    let scanning = $state(false);
    let scanError = $state('');
    let remaining = $state(0);
    let busy = $state(false);
    /** Devices that arrived while this dialog was open - the ones #24 wants named straight away. */
    let paired = $state<string[]>([]);
    let names = $state<Record<string, string>>({});

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const isHmip = $derived(!interfaceType.startsWith('BidCos') && interfaceType !== 'CUxD');
    const isWired = $derived(interfaceType === 'BidCos-Wired');
    const keyReady = $derived(hmipMode === 'SGTIN' ? isSgtin(sgtin) : isSgtin(sgtin) && isDeviceKey(deviceKey));

    $effect(() => {
        if (open) {
            return;
        }
        scanning = false;
        remaining = 0;
        paired = [];
        names = {};
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
        const timer = setInterval(() => {
            void stores.devices.installModeSeconds(interfaceName).then((left) => {
                remaining = left;
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
        const ok = await stores.devices.setInstallMode(interfaceName, true, {seconds, ...options});
        busy = false;
        // `addDevice` opens no install mode, so nothing counts down (checked against 2.7)
        if (ok && options.address === undefined) {
            remaining = seconds;
        }
    }

    async function stop(): Promise<void> {
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

    async function saveNames(): Promise<void> {
        const entries = paired
            .filter((address) => (names[address] ?? '').trim() !== '')
            .map((address) => ({address, name: (names[address] ?? '').trim()}));
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
                <option value="SGTIN">{t('With SGTIN only (key server)')}</option>
            </select>
        </label>

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
                {#if scanError !== ''}<span class="hmm-add-error" data-testid="add-device-scan-error">{scanError}</span
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
                            ? {
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
        grid-template-columns: 190px 1fr;
        gap: 8px;
        align-items: center;
        margin-bottom: 6px;
    }

    .hmm-add-seconds {
        width: 80px;
    }

    .hmm-add-inline {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .hmm-add-actions {
        display: flex;
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

    .hmm-add-paired {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--hmm-border);
    }

    .hmm-add-paired h4 {
        margin: 0 0 6px;
    }
</style>
