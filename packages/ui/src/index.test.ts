import {describe, expect, it} from 'vitest';

import {PACKAGE} from './index.js';

describe('@homematic-manager/ui', () => {
    it('exports its package name', () => {
        expect(PACKAGE).toBe('@homematic-manager/ui');
    });
});
