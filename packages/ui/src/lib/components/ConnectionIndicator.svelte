<script lang="ts">
    import type {InterfaceState} from '@homematic-manager/core';

    interface Props {
        host: string;
        interfaces: InterfaceState[];
        /** The connection to the backend, not to the CCU. */
        backendConnected?: boolean;
        notConnectedText?: string;
        testId?: string | undefined;
    }

    let {
        host,
        interfaces,
        backendConnected = true,
        notConnectedText = 'Not connected',
        testId = undefined,
    }: Props = $props();
</script>

<!--
    The header block of 2.7: the CCU address in bold, and under it every interface with a green ✔
    or a red ✕ (`ipcRpc.on('connection')`). The only addition is that a backend that is gone greys
    the whole block out, because in 2.x a dead IPC channel looked exactly like a healthy CCU.
-->
<div class="hmm-connection" class:hmm-connection-offline={!backendConnected} data-testid={testId}>
    <div class="hmm-connection-host">{host === '' ? notConnectedText : host}</div>
    <div class="hmm-connection-interfaces">
        {#each interfaces as state (state.name)}
            <span class="hmm-connection-interface" title={state.error ?? ''}>
                {state.name}
                <span
                    class="hmm-connection-mark"
                    class:hmm-connection-ok={state.connected}
                    class:hmm-connection-bad={!state.connected}>{state.connected ? '✔' : '✕'}</span
                >
            </span>
        {/each}
    </div>
</div>

<style>
    .hmm-connection {
        display: flex;
        flex-direction: column;
        justify-content: center;
        line-height: 1.15;
        padding: 0 8px;
        min-width: 0;
    }

    .hmm-connection-offline {
        opacity: 0.45;
    }

    .hmm-connection-host {
        font-size: var(--hmm-font-size-small);
        font-weight: bold;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-connection-interfaces {
        display: flex;
        gap: 6px;
        font-size: var(--hmm-font-size-tiny);
        color: var(--hmm-fg-muted);
        white-space: nowrap;
    }

    .hmm-connection-ok {
        color: var(--hmm-ok);
    }

    .hmm-connection-bad {
        color: var(--hmm-error);
    }
</style>
