import {render} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import DevicesPage from '../../routes/DevicesPage.svelte';

describe('the stores context', () => {
    it('tells a component clearly when it is used outside the app shell', () => {
        // No `setStores` anywhere above it: the page must say what is missing rather than fail
        // somewhere deep inside with "cannot read properties of undefined".
        expect(() => render(DevicesPage)).toThrow(/no stores in context/);
    });
});
