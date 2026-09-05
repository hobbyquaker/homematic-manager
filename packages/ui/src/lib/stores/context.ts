import {getContext, hasContext, setContext} from 'svelte';

import type {Stores} from './Stores.svelte.js';

const STORES_KEY = Symbol('homematic-manager.stores');

/** Puts the stores into the component context. Call once, in `App.svelte` or in a test wrapper. */
export function setStores(stores: Stores): Stores {
    setContext(STORES_KEY, stores);
    return stores;
}

/** The stores of the surrounding app. Throws when a component is used outside it. */
export function getStores(): Stores {
    if (!hasContext(STORES_KEY)) {
        throw new Error('no stores in context - wrap the component in App.svelte or call setStores() in a parent');
    }
    return getContext<Stores>(STORES_KEY);
}

/** The stores if there are any - for components that can also stand on their own. */
export function tryGetStores(): Stores | undefined {
    return hasContext(STORES_KEY) ? getContext<Stores>(STORES_KEY) : undefined;
}
