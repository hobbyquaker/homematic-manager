import {describe, expect, it} from 'vitest';

import * as web from './index.js';

describe('homematic-manager', () => {
    it('exports its package name', () => {
        expect(web.PACKAGE).toBe('homematic-manager');
    });

    it('exports what a host, the CLI and the e2e suites need', () => {
        for (const name of [
            'createWebHost',
            'runCli',
            'parseOptions',
            'helpText',
            'startForTest',
            'DeviceImageService',
        ]) {
            expect(web, name).toHaveProperty(name);
        }
    });
});
