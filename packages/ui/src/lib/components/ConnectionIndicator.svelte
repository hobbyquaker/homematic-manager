<script lang="ts">
    import type {InterfaceState} from '@homematic-manager/core';

    import {MARK_GLYPH, summaryMark} from './interfacePopup.js';

    interface Props {
        interfaces: InterfaceState[];
        /** The connection to the backend, not to the CCU. */
        backendConnected?: boolean;
        allConnectedText?: string;
        someNotConnectedText?: string;
        /** Nothing but absent interfaces - and, with no backend, nothing known at all. */
        notPresentText?: string;
        /** While `init` is through and the first device sweep is still running (D-31). */
        subscribingText?: string;
        testId?: string | undefined;
    }

    let {
        interfaces,
        backendConnected = true,
        allConnectedText = 'Connected',
        someNotConnectedText = 'Not connected',
        notPresentText = 'Not present',
        subscribingText = 'Subscribing',
        testId = undefined,
    }: Props = $props();

    const mark = $derived(summaryMark(interfaces));
    const title = $derived.by(() => {
        if (!backendConnected) {
            return someNotConnectedText;
        }
        switch (mark) {
            case 'ok': {
                return allConnectedText;
            }
            case 'busy': {
                return subscribingText;
            }
            case 'absent': {
                return notPresentText;
            }
            default: {
                return someNotConnectedText;
            }
        }
    });
</script>

<!--
    Task 21: what 2.7 put into the top bar - the CCU address and one ✔/✕ per interface - is now the
    content of the interface popup, and the header keeps a single mark that says whether anything is
    wrong. The block that used to be here grew and shrank with every state change and pushed the
    tabs sideways; this is one glyph in a box of a fixed width, so nothing in the header moves.

    A backend that is gone still greys it out, because in 2.x a dead IPC channel looked exactly like
    a healthy CCU.
-->
<span
    class="hmm-connection hmm-connection-{mark}"
    class:hmm-connection-offline={!backendConnected}
    role="img"
    aria-label={title}
    {title}
    data-mark={mark}
    data-testid={testId}>{MARK_GLYPH[mark]}</span
>

<style>
    /*
        A fixed box, not a box that fits its glyph: ✔, ✕, ↻ and – are four different widths, and a
        mark that changes the width of its own box moves everything behind it in the header every
        time an interface reconnects (task 19's rule).
    */
    .hmm-connection {
        display: inline-block;
        flex: 0 0 auto;
        width: 14px;
        text-align: center;
        line-height: 1;
        overflow: hidden;
    }

    .hmm-connection-offline {
        opacity: 0.45;
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
