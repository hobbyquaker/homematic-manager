/**
 * The library entry of `@homematic-manager/ui`.
 *
 * The Electron renderer (task 11) imports the app shell and the stores from here and supplies its
 * own `Transport` - the IPC bridge the preload put on `window.__HMM_TRANSPORT__`. Nothing in this
 * package reaches for Node, a socket or a global: everything goes through the injected transport.
 *
 * The static bundle (`npm run build -w @homematic-manager/ui`) is a separate output built from
 * `index.html` and `src/main.ts`; both consume the same components.
 */

/** Name of this package; the workspace smoke tests and the About dialog use it. */
export const PACKAGE = '@homematic-manager/ui';

export {default as App} from './App.svelte';

export * from './lib/host/index.js';
export * from './lib/transport/index.js';
export * from './lib/stores/index.js';
export * from './lib/i18n/index.js';
export * from './lib/components/index.js';
export * from './lib/util/format.js';

export {default as AboutDialog} from './routes/AboutDialog.svelte';
export {default as ConfigDialog} from './routes/ConfigDialog.svelte';
export {default as ConsolePage} from './routes/ConsolePage.svelte';
export {default as DevicesPage} from './routes/DevicesPage.svelte';
export {default as EventsPage} from './routes/EventsPage.svelte';
export {default as LinksPage} from './routes/LinksPage.svelte';
export {default as RadioPage} from './routes/RadioPage.svelte';
export {default as ServiceMessagesPage} from './routes/ServiceMessagesPage.svelte';
