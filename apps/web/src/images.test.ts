/**
 * The chain itself is tested once, in `packages/backend/src/images/deviceImages.test.ts`; this host
 * only re-exports it, and `server.test.ts` covers the `<base>images/<deviceType>` route that uses
 * it. What is left to assert here is that the re-export really is the backend's implementation and
 * not a copy that has drifted - the mistake task 15 removed.
 */

import {DeviceImageService as fromBackend} from '@homematic-manager/backend';
import {describe, expect, it} from 'vitest';

import {ccuImagePaths, DeviceImageService, readIconMapFile} from './images.js';

describe('the device image re-export', () => {
    it('is the backend implementation itself', () => {
        expect(DeviceImageService).toBe(fromBackend);
        expect(typeof readIconMapFile).toBe('function');
    });

    it('carries the four candidate URLs task 13 measured', () => {
        expect(ccuImagePaths('134_hmip-pdt.png')).toEqual([
            '/config/img/devices/250/134_hmip-pdt.png',
            '/config/img/devices/250/coupling/134_hmip-pdt.png',
            '/config/img/devices/50/134_hmip-pdt_thumb.png',
            '/config/img/devices/50/134_hmip-pdt.png',
        ]);
    });
});
