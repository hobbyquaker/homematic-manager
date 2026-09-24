import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

/**
 * The openccu-lite manifest (files/openccu-lite.json): build.sh puts it at the root of the package,
 * beside update_script, where openccu-lite reads it before update_script runs; the CCU3 and OpenCCU
 * ignore it. Checked here is what the platform refuses or applies: the format, the id (the rc.d
 * name), the release source, the settings page and the runtime block.
 */
describe('the openccu-lite manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../files/openccu-lite.json', import.meta.url), 'utf8'));
    const updateScript = readFileSync(new URL('../files/update_script', import.meta.url), 'utf8');

    it('names this addon and its release source', () => {
        expect(manifest.format).toBe(1);
        expect(manifest.id).toBe(/^ADDON=(\S+)/m.exec(updateScript)?.[1]);
        expect(manifest.release).toEqual({
            github: 'hobbyquaker/homematic-manager',
            asset: 'hmm-ccu-{arch}-{version}.tar.gz',
            prerelease: true,
        });
    });

    it('declares the settings page, the session header and the runtime facts', () => {
        expect(manifest.ui.settings_url).toBe('/addons/hmm/settings.cgi?cmd=config');
        expect(manifest.ui.session_header).toBe(true);
        expect(manifest.runtime.needs).toEqual(['rfd', 'hmipserver']);
        expect(manifest.runtime.start).toBe('early');
        // the server keeps running after the rc.d start: an empty unit is a server that ended
        expect(manifest.runtime.daemon).toBe(true);
        expect(manifest.runtime.data_dirs).toEqual(['/usr/local/hmm']);
        expect(manifest.runtime.root).toBeUndefined();
        // user-facing text carries no internal ids
        for (const text of Object.values(manifest.runtime.note as Record<string, string>)) {
            expect(text).not.toMatch(/\b[A-Z]-\d+\b|\btask \d+/);
        }
    });
});
