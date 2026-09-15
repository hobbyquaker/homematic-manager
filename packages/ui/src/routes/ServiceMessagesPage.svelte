<script lang="ts">
    import type {ServiceMessage} from '@homematic-manager/core';
    import {deviceAddress, isAcknowledgeable} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import {ICON_COLUMN_WIDTH} from '../lib/components/metrics.js';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import Tooltip from '../lib/components/Tooltip.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {isHmipInterface} from '../lib/stores/suppression.js';
    import {serviceMessageExplanation, SUPPRESS_COLUMN_WIDTH} from '../lib/util/deviceGrid.js';
    import {formatDateTime, formatRpcValue} from '../lib/util/format.js';
    import {serviceMessageTotal} from '../lib/util/serviceMessageTotal.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);
    let busy = $state(false);

    const interfaceName = $derived(stores.app.selectedInterface);
    const isBidcos = $derived(stores.interfaces.typeOf(interfaceName).startsWith('BidCos'));
    /** Task 26: eQ-3's suppression exists on the HmIP interface only; the action is hidden elsewhere. */
    const hmip = $derived(!isBidcos && isHmipInterface(interfaceName, stores.interfaces.typeOf(interfaceName)));
    const messages = $derived(stores.serviceMessages.of(interfaceName));
    const acknowledgeable = $derived(stores.serviceMessages.acknowledgeable(interfaceName));
    const selectedMessages = $derived(messages.filter((message) => selected.includes(idOf(message))));
    const selectedAckable = $derived(selectedMessages.filter((message) => isAcknowledgeable(message.datapoint)));

    /**
     * Task 36 (#150, D-44): the list stays per interface and the band counts the box - "4 of 7 on
     * this box" - from the messages the app already holds for every interface. The tab badge stays
     * the selected interface's count.
     */
    const total = $derived(
        serviceMessageTotal(
            stores.serviceMessages.messages,
            interfaceName,
            stores.interfaces.states.map((state) => state.name),
        ),
    );
    const totalTooltip = $derived(
        total.next === undefined
            ? ''
            : t('Also on this box: {list}. Click to switch to {next}.', {
                  list: total.others.map((entry) => `${entry.interfaceName} (${String(entry.count)})`).join(', '),
                  next: total.next,
              }),
    );

    function idOf(message: ServiceMessage): string {
        return `${message.address}/${message.datapoint}`;
    }

    function deviceTypeOf(address: string): string {
        return stores.devices.index(interfaceName)?.get(deviceAddress(address))?.TYPE ?? '';
    }

    /** The suppressed lists of the channels in view, read once per channel (`getSuppressedServiceMessages`). */
    $effect(() => {
        if (hmip && messages.length > 0) {
            void stores.serviceMessages.loadSuppressed(interfaceName);
        }
    });

    /** B-24: the descriptions that turn an ENUM index into a name, read once per channel. */
    $effect(() => {
        if (messages.some((message) => typeof message.value === 'number')) {
            void stores.serviceMessages.loadDescriptions(interfaceName);
        }
    });

    /**
     * B-24: what the Value column shows. An ENUM message reads as the CCU's own label -
     * "Kommunikationsstörung" rather than `4` - looked up by channel type, parameter and name the
     * way the WebUI's service-message page does it; anything else as the raw value.
     */
    function valueText(message: ServiceMessage): string {
        const name = stores.serviceMessages.valueName(message);
        if (name === undefined) {
            return formatRpcValue(message.value);
        }
        const channelType = stores.devices.index(interfaceName)?.get(message.address)?.TYPE ?? '';
        return stores.meta.valueLabel(message.datapoint, name, channelType);
    }

    /** The name and the raw value behind a label, for the tooltip of the cell. */
    function valueTitle(message: ServiceMessage): string | undefined {
        const name = stores.serviceMessages.valueName(message);
        return name === undefined ? undefined : `${name} (${formatRpcValue(message.value)})`;
    }

    async function suppress(message: ServiceMessage, value: boolean): Promise<void> {
        busy = true;
        const ok = await stores.serviceMessages.suppress(interfaceName, message.address, message.datapoint, value);
        busy = false;
        if (ok) {
            stores.notices.push(
                'info',
                `suppressServiceMessages ${message.address} ${message.datapoint} = ${value ? 'true' : 'false'}`,
            );
        }
    }

    const columns = $derived<DataTableColumn<ServiceMessage>[]>([
        {
            key: 'icon',
            label: '',
            width: ICON_COLUMN_WIDTH,
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {key: 'name', label: t('Name'), width: 220, value: (message) => stores.nameOf(message.address)},
        {key: 'address', label: 'ADDRESS', width: 160, mono: true},
        {
            key: 'device',
            label: `${t('Device')} ADDRESS`,
            width: 140,
            mono: true,
            value: (message) => deviceAddress(message.address),
        },
        {key: 'datapoint', label: t('Message'), width: 180},
        {key: 'value', label: t('Value'), width: 160, value: valueText},
        {
            key: 'explanation',
            label: '',
            sortable: false,
            value: (message) => {
                const key = serviceMessageExplanation(message.datapoint, !isBidcos);
                return key === undefined ? '' : t(key);
            },
        },
        {key: 'since', label: t('Since'), width: 170, value: (message) => formatDateTime(message.since)},
        ...(hmip
            ? [
                  {
                      // B-35: a button, so resizable down to the button and not below it
                      key: 'suppress',
                      label: '',
                      width: SUPPRESS_COLUMN_WIDTH,
                      minWidth: SUPPRESS_COLUMN_WIDTH,
                      keepMinWidth: true,
                      sortable: false,
                      filterable: false,
                      value: (message: ServiceMessage) =>
                          stores.serviceMessages.isSuppressed(message) ? t('suppressed') : '',
                  },
              ]
            : []),
    ]);

    async function acknowledge(list: readonly ServiceMessage[]): Promise<void> {
        busy = true;
        const done = await stores.serviceMessages.acknowledgeMany(list);
        busy = false;
        stores.notices.push('info', t('{count} service messages', {}, done));
    }
</script>

<div class="hmm-page">
    <div class="hmm-page-grid">
        <DataTable
            rows={messages}
            scope={interfaceName}
            {columns}
            getId={idOf}
            bind:selected
            caption={t('Service messages')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            toolbarLabel={t('Service messages')}
            countText={total.next === undefined ? t('{count} service messages', {}, messages.length) : undefined}
            tableId="messages"
            testId="messages-table"
        >
            {#snippet status()}
                {#if total.next !== undefined}
                    {@const next = total.next}
                    <!--
                        Task 36: the total leads to the next interface that has messages, wrapping
                        round, and its tooltip lists them all - the WebUI shows them in one list.
                    -->
                    <Tooltip text={totalTooltip} testId="messages-total-tooltip">
                        <button
                            type="button"
                            class="hmm-total-button"
                            data-testid="messages-total"
                            onclick={() => void stores.selectInterface(next)}
                            >{t('{count} of {total} on this box', {total: total.total}, total.own)}</button
                        >
                    </Tooltip>
                {/if}
            {/snippet}

            {#snippet toolbar()}
                <!--
                    #146: `load()` answers from the backend's cache - the button has to make the
                    round trip to the interface processes, and has to show that it is making it.
                -->
                <ToolbarButton
                    title={t('Refresh')}
                    icon="⟳"
                    busy={stores.serviceMessages.loading}
                    testId="messages-refresh"
                    onclick={() => void stores.serviceMessages.refresh(interfaceName)}
                />
                <ToolbarButton
                    title={t('Acknowledge service messages')}
                    icon="✔"
                    disabled={busy || selectedAckable.length === 0}
                    reason={t('Only STICKY_UNREACH and SABOTAGE can be acknowledged')}
                    testId="messages-ack"
                    onclick={() => void acknowledge(selectedAckable)}
                />
                <ToolbarButton
                    title={t('Acknowledge all service messages')}
                    icon="✔✔"
                    disabled={busy || acknowledgeable.length === 0}
                    reason={t('Only STICKY_UNREACH and SABOTAGE can be acknowledged')}
                    testId="messages-ack-all"
                    onclick={() => void acknowledge(acknowledgeable)}
                />
            {/snippet}

            {#snippet cell(row, column)}
                {#if column.key === 'icon'}
                    <DeviceImage
                        deviceType={deviceTypeOf(row.address)}
                        src={stores.host.deviceImageUrl(deviceTypeOf(row.address))}
                    />
                {:else if column.key === 'datapoint'}
                    <span
                        class="hmm-msg-name"
                        class:hmm-msg-ackable={isAcknowledgeable(row.datapoint)}
                        data-testid={`message-${row.address}-${row.datapoint}`}>{row.datapoint}</span
                    >
                {:else if column.key === 'value'}
                    <span title={valueTitle(row)} data-testid={`message-value-${row.address}-${row.datapoint}`}
                        >{valueText(row)}</span
                    >
                {:else if column.key === 'suppress'}
                    {@const suppressed = stores.serviceMessages.isSuppressed(row)}
                    <!-- task 26: the suppression of this one parameter on its channel, HmIP only -->
                    <button
                        type="button"
                        class="hmm-inline-button"
                        disabled={busy}
                        title={t(
                            'A suppressed one reports a value that raises no message; the CCU shows it as inactive.',
                        )}
                        data-testid={`suppress-${row.address}-${row.datapoint}`}
                        onclick={(event) => {
                            event.stopPropagation();
                            void suppress(row, !suppressed);
                        }}>{suppressed ? t('Unsuppress') : t('Suppress')}</button
                    >
                {:else}
                    {column.value
                        ? (column.value(row) ?? '')
                        : ((row as unknown as Record<string, string>)[column.key] ?? '')}
                {/if}
            {/snippet}
        </DataTable>
    </div>
</div>

<style>
    .hmm-page {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
    }

    .hmm-page-grid {
        flex: 1 1 auto;
        min-height: 0;
    }

    .hmm-msg-name {
        font-family: var(--hmm-font-mono);
    }

    /* The two the CCU lets an application clear; the rest go away when their cause does. */
    .hmm-msg-ackable {
        color: var(--hmm-accent);
    }

    /* Task 36: the box's total reads as the count it replaces, and shows that it can be clicked. */
    .hmm-total-button {
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
        text-decoration: underline dotted;
        text-underline-offset: 2px;
    }

    .hmm-total-button:hover {
        color: var(--hmm-fg);
    }

    .hmm-total-button:focus-visible {
        outline: 1px solid var(--hmm-accent);
        outline-offset: 1px;
    }

    /* The row action of task 26, styled like the PARAMSETS buttons of the devices grid. */
    .hmm-inline-button {
        height: 18px;
        padding: 0 4px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-control-bg);
        color: var(--hmm-fg-muted);
        cursor: pointer;
        font-size: var(--hmm-font-size-small);
        line-height: 1;
        vertical-align: middle;
    }

    .hmm-inline-button:hover:not(:disabled) {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }
</style>
