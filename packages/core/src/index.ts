/**
 * `@homematic-manager/core` - the domain logic of the Homematic Manager.
 *
 * Pure TypeScript: no I/O, no DOM, no timers, no clock. Everything that talks to a CCU lives in
 * `packages/backend`, everything that draws lives in `packages/ui`; both use only what is exported
 * here, and both can be tested against it without a device.
 */

/** Name of this package; the workspace smoke tests and the About dialog use it. */
export const PACKAGE = '@homematic-manager/core';

// The contract between backend and UI (task 4/7), and the data contract with the pipeline (task 9)
export * from './api/types.js';
export * from './data/types.js';
export * from './data/memory.js';

// The CCU model
export * from './interfaces/table.js';
export * from './address/address.js';
export * from './devices/index.js';
export * from './links/roles.js';

// Values and the write path (task 6)
export * from './rpc/values.js';
export * from './rpc/methods.js';
export * from './paramset/description.js';
export * from './paramset/units.js';
export * from './paramset/time.js';
export * from './paramset/cast.js';
export * from './paramset/validate.js';
export * from './paramset/diff.js';
export * from './paramset/multiApply.js';

// Easy modes and the MASTER metadata layer
export * from './easymodes/engine.js';

// State the tabs show
export * from './serviceMessages/index.js';
export * from './rssi/index.js';
export * from './events/ringBuffer.js';

// The openccu-lite metadata store (task 24): names, rooms and functions as data
export * from './meta/index.js';

// Texts
export * from './i18n/messages.js';
export * from './i18n/translate.js';
export * from './i18n/lookup.js';
