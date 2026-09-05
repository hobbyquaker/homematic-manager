import {render, screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import Placeholder from './Placeholder.svelte';

describe('Placeholder', () => {
    it('renders the default name', () => {
        render(Placeholder);
        expect(screen.getByText('Homematic Manager')).toBeTruthy();
    });

    it('renders the name it is given', () => {
        render(Placeholder, {name: 'BidCos-RF'});
        expect(screen.getByText('BidCos-RF')).toBeTruthy();
    });
});
