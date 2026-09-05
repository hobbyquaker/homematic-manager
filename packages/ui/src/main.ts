import {mount} from 'svelte';

import App from './App.svelte';
import {createStores} from './lib/stores/Stores.svelte.js';
import {createTransport} from './lib/transport/createTransport.js';
import {startDemoEvents} from './lib/transport/demoEvents.js';
import {MockTransport} from './lib/transport/MockTransport.js';

/**
 * The browser entry: `apps/web` (task 12) and the CCU addon (task 13) serve this bundle, and
 * `npm run dev -w @homematic-manager/ui` opens it against the demo fixture. The Electron renderer
 * (task 11) has its own entry and imports the components from `src/index.ts` instead.
 */
const transport = createTransport();
const stores = createStores(transport);

if (transport instanceof MockTransport) {
    startDemoEvents(transport);
}

const target = document.querySelector('#app');
if (!target) {
    throw new Error('no #app element to mount into');
}

mount(App, {target, props: {stores}});
void stores.start();
