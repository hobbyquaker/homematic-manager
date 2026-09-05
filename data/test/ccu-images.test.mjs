/**
 * The candidate URLs `scripts/icons-from-ccu.mjs` walks. They have to stay identical to the
 * backend's `ccuImagePaths()` - task 13 measured which of them a CCU really answers, and this tool
 * used to ask the thumbnail directory for names that only exist in `250/`.
 */
import {describe, expect, it} from 'vitest';

import {CCU_IMAGE_BASE, ccuImageUrls} from '../scripts/lib/ccu-images.mjs';

describe('ccuImageUrls', () => {
    it('asks 250 first, then coupling, then the _thumb of the 50 directory', () => {
        expect(ccuImageUrls('http://ccu', '134_hmip-pdt.png')).toEqual([
            'http://ccu/config/img/devices/250/134_hmip-pdt.png',
            'http://ccu/config/img/devices/250/coupling/134_hmip-pdt.png',
            'http://ccu/config/img/devices/50/134_hmip-pdt_thumb.png',
            'http://ccu/config/img/devices/50/134_hmip-pdt.png',
        ]);
    });

    it('assumes .png for an entry without an extension', () => {
        expect(ccuImageUrls('http://ccu', 'weird')).toContain('http://ccu/config/img/devices/50/weird_thumb.png');
    });

    it('keeps a name with dots in it intact', () => {
        expect(ccuImageUrls('http://ccu', 'a.b.png')[0]).toBe(`http://ccu${CCU_IMAGE_BASE}/250/a.b.png`);
        expect(ccuImageUrls('http://ccu', 'a.b.png')[2]).toBe(`http://ccu${CCU_IMAGE_BASE}/50/a.b_thumb.png`);
    });
});
