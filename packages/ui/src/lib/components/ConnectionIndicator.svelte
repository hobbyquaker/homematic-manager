<script lang="ts">
    import type {InterfaceState} from '@homematic-manager/core';

    interface Props {
        host: string;
        interfaces: InterfaceState[];
        /** The connection to the backend, not to the CCU. */
        backendConnected?: boolean;
        notConnectedText?: string;
        /** Title for an interface whose port refuses the connection - nothing runs there. */
        notPresentText?: string;
        /** Title while `init` has been sent and the first device sweep is still running (D-31). */
        subscribingText?: string;
        testId?: string | undefined;
    }

    let {
        host,
        interfaces,
        backendConnected = true,
        notConnectedText = 'Not connected',
        notPresentText = 'Not present',
        subscribingText = 'Subscribing',
        testId = undefined,
    }: Props = $props();

    /**
     * Three states, not two. 2.7 knew ✔ and ✕ only, so BidCos-Wired on a CCU without a wired
     * gateway - which is in the default interface list - sat there as a red ✕ forever and looked
     * like a fault. A refused port means the interface process does not exist on this system
     * (task 13 measured it), which the backend reports as `absent`; that gets a grey dash.
     */
    function mark(state: InterfaceState): {glyph: string; className: string; title: string} {
        // D-31: `init` is through but the interface is still re-sending its devices; the grids are
        // incomplete until the sweep ends, so this is neither "connected" nor "broken"
        if (state.subscribing === true) {
            return {glyph: '↻', className: 'hmm-connection-busy', title: subscribingText};
        }
        if (state.connected) {
            return {glyph: '✔', className: 'hmm-connection-ok', title: ''};
        }
        if (state.absent === true) {
            return {glyph: '–', className: 'hmm-connection-absent', title: notPresentText};
        }
        return {glyph: '✕', className: 'hmm-connection-bad', title: state.error ?? ''};
    }
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
            {@const shown = mark(state)}
            <span class="hmm-connection-interface" title={shown.title}>
                {state.name}
                <span class="hmm-connection-mark {shown.className}">{shown.glyph}</span>
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

    /* "not there" is not "broken": the same muted grey the surrounding text uses. */
    .hmm-connection-absent {
        color: var(--hmm-fg-muted);
    }

    /* subscribing: on its way to green, and not an error either */
    .hmm-connection-busy {
        color: var(--hmm-warn);
    }
</style>
