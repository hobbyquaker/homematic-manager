import type {HostBridge} from './types.js';

/** The global the Electron preload puts the host bridge on. */
export const HOST_BRIDGE_GLOBAL = '__HMM_HOST__';

/**
 * Is this really the bridge? Only the members the UI calls are checked, and `update` is checked as
 * a whole: a preload from an older build that has `info()` but no updater must not make
 * `host.update.state()` throw halfway through a dialog.
 */
export function isHostBridge(value: unknown): value is HostBridge {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<HostBridge>;
    const update = candidate.update as Partial<HostBridge['update']> | undefined;
    return (
        typeof candidate.info === 'function' &&
        typeof candidate.deviceImageUrl === 'function' &&
        typeof candidate.setTheme === 'function' &&
        typeof candidate.onSystemTheme === 'function' &&
        typeof candidate.onMenuAction === 'function' &&
        typeof update === 'object' &&
        // `typeof null === 'object'`, and this value crossed the preload boundary: its declared
        // type is what the host promised, not what the page actually got.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
        update !== null &&
        typeof update.state === 'function' &&
        typeof update.check === 'function' &&
        typeof update.download === 'function' &&
        typeof update.installOnQuit === 'function' &&
        typeof update.dismiss === 'function' &&
        typeof update.on === 'function'
    );
}

/**
 * The host bridge, or `undefined` in a plain browser.
 *
 * Everything that uses it degrades silently: the settings dialog shows what the API knows instead of
 * the Electron versions, the update notice never appears, and a device image falls back to the
 * placeholder. `apps/web` and the CCU addon run through that path (D-24, D-5), so "no host" is the
 * normal case, not an error.
 */
export function getHostBridge(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): HostBridge | undefined {
    const candidate = scope[HOST_BRIDGE_GLOBAL];
    return isHostBridge(candidate) ? candidate : undefined;
}
