<script lang="ts">
    import Dialog from 'occulite-ui/components/Dialog';
    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        open?: boolean;
        /** The device's name, as the list shows it. */
        name: string;
        address: string;
        /** What the switch is to become: `true` switches the router module on. */
        on: boolean;
        onconfirm: () => void;
    }

    let {open = $bindable(false), name, address, on, onconfirm}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    function confirm(): void {
        open = false;
        onconfirm();
    }
</script>

<!--
    Task 97. Switching a router changes how the HmIP network routes, so the switch in the list
    asks first - in the app's own dialog, never `window.confirm`. Nothing is written until the
    second button; closing the dialog leaves the device as it was.
-->
<Dialog
    bind:open
    title={on ? t('Switch routing on?') : t('Switch routing off?')}
    width="460px"
    testId="routing-switch-dialog"
>
    <p class="hmm-routing-question" data-testid="routing-switch-text">
        {name === address ? address : `${name} (${address})`}
    </p>
    <p class="hmm-routing-help">
        {on
            ? t(
                  'The device then forwards frames for other HmIP devices that cannot reach the access point directly. The routes of the network change over the next minutes.',
              )
            : t(
                  'Devices that reach the access point through this one have to find another route; until they do they may be unreachable.',
              )}
    </p>
    <p class="hmm-routing-help">
        {t('Writes ROUTER_MODULE_ENABLED = {value} to the MASTER paramset of {address}.', {
            value: on ? 'true' : 'false',
            address: `${address}:0`,
        })}
    </p>

    {#snippet buttons()}
        <button type="button" class="hmm-button" data-testid="routing-switch-cancel" onclick={() => (open = false)}
            >{t('Cancel')}</button
        >
        <button type="button" class="hmm-button" data-testid="routing-switch-confirm" onclick={confirm}
            >{on ? t('Switch on') : t('Switch off')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-routing-question {
        margin: 0 0 8px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }

    .hmm-routing-help {
        margin: 0 0 6px;
        color: var(--hmm-fg-muted);
    }
</style>
