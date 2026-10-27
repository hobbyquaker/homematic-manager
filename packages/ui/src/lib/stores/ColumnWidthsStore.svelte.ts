import {LocalColumnWidths} from 'occulite-ui/table';

import type {StorageLike} from './AppStore.svelte.js';

/** Task 40: where the column widths of every grid are kept. */
export const COLUMN_WIDTHS_STORAGE_KEY = 'hmm.columnWidths';

/**
 * The connection profile a width belongs to: its host, written the way the backend names the
 * profile's cache directory (`hostKey` in `packages/backend/src/config/store.ts`). 2.x kept its grid
 * state per CCU the same way, with the `_<ccuAddress>` suffix on every persisted key.
 */
export function profileKey(host: string): string {
    const key = host
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_');
    return key === '' ? 'unconfigured' : key;
}

/**
 * The column widths a user gave the grids (task 40, #157), per connection profile and per table:
 * occulite-ui's `LocalColumnWidths` under `hmm.columnWidths`, scoped by the profile's host.
 */
export class ColumnWidthsStore extends LocalColumnWidths {
    /** `profile` is read on every access, so a configuration that arrives later switches the widths. */
    constructor(storage: StorageLike | undefined, profile: () => string) {
        super({storage, storageKey: COLUMN_WIDTHS_STORAGE_KEY, scope: profile});
    }
}
