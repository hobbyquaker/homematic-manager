import type {ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import {
    HM_BLIND_MASTER,
    HM_CC_RT_DN_MASTER,
    HMIP_BLIND_TRANSMITTER_MASTER,
    HMIP_HEATING_MASTER,
    HMIPW_DRS8_SWITCH_MASTER,
} from '../../../test/fixtures/deviceDescriptions.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

/**
 * B-106 (#172): a row of the paramset dialog is a title over a small second line with the raw name. Where nobody
 * translated the parameter the title *is* the raw name, and the row read "REFERENCE_RUNNING_TIME_TOP_BOTTOM" twice. A
 * row either has a real label over the raw name, or shows the raw name once.
 */
const CASES: Record<string, ParamsetDescription> = {
    HMIP_BLIND_TRANSMITTER_MASTER,
    HM_BLIND_MASTER,
    HM_CC_RT_DN_MASTER,
    HMIP_HEATING_MASTER,
    HMIPW_DRS8_SWITCH_MASTER,
};

/** Every label cell of the dialog whose title and second line say the same. */
function doubled(): {labels: number; same: string[]} {
    const dialog = screen.getByTestId('paramset-dialog');
    const all = [...dialog.querySelectorAll<HTMLElement>('[class*="-label"]')].filter(
        (cell) => cell.children.length >= 1 && [...cell.children].every((child) => child.tagName === 'SPAN'),
    );
    const cells = all.filter((cell) => cell.children.length >= 2);
    const same = cells
        .map((cell) => [...cell.children].map((child) => child.textContent.trim()))
        .filter(([title, second]) => title === second)
        .map(([title]) => title ?? '');
    return {labels: all.length, same};
}

describe('the rows of the paramset dialog', () => {
    for (const [name, description] of Object.entries(CASES)) {
        it(`never print the same text as title and second line (${name})`, async () => {
            const transport = new MockTransport({demo: true});
            transport.respond('paramset.description', () => description);
            transport.respond('paramset.get', () => ({}));
            await mountApp({transport, hash: '#/BidCos-RF/devices'});
            await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
            await waitFor(() => {
                expect(doubled().labels).toBeGreaterThan(0);
            });
            expect(doubled().same).toEqual([]);
        });
    }
});
