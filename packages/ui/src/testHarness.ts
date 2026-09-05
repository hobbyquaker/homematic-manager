import {render, waitFor} from '@testing-library/svelte';
import {expect} from 'vitest';

import App from './App.svelte';
import type {StorageLike} from './lib/stores/AppStore.svelte.js';
import type {HostBridge} from './lib/host/types.js';
import {createStores, type Stores} from './lib/stores/Stores.svelte.js';
import {MockTransport} from './lib/transport/MockTransport.js';

/**
 * Mounting the whole app against a `MockTransport` - what every tab test starts with.
 *
 * The three doubles the shell needs (`localStorage`, `location.hash`, the hash subscription) were
 * copied into App.test.ts and ConfigDialog.test.ts by task 7; task 8 adds one file per tab, so they
 * live here instead. Nothing in this module is used by the app itself.
 */

export class MemoryStorage implements StorageLike {
    readonly map = new Map<string, string>();

    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

export interface FakeRouter {
    readonly location: {hash: string};
    readonly onHashChange: (handler: () => void) => () => void;
    /** Fires a `hashchange`, as the back button would. */
    readonly navigate: (hash: string) => void;
}

export function fakeRouter(initial = ''): FakeRouter {
    const handlers = new Set<() => void>();
    const location = {
        _hash: initial,
        get hash(): string {
            return this._hash;
        },
        set hash(value: string) {
            this._hash = value;
        },
    };
    return {
        location,
        onHashChange: (handler: () => void) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        navigate: (hash: string) => {
            location.hash = hash;
            for (const handler of handlers) {
                handler();
            }
        },
    };
}

export interface MountOptions {
    readonly transport?: MockTransport;
    /** `#/HmIP-RF/links` - the route the app starts on. */
    readonly hash?: string;
    readonly hostBridge?: HostBridge;
    readonly storage?: MemoryStorage;
}

export interface MountedApp {
    readonly stores: Stores;
    readonly transport: MockTransport;
    readonly router: FakeRouter;
    readonly storage: MemoryStorage;
}

/** Renders `App`, runs the start-up sequence and waits for the loader to be gone. */
export async function mountApp(options: MountOptions = {}): Promise<MountedApp> {
    const transport = options.transport ?? new MockTransport({demo: true});
    const router = fakeRouter(options.hash ?? '');
    const storage = options.storage ?? new MemoryStorage();
    const stores = createStores(transport, {
        location: router.location,
        onHashChange: router.onHashChange,
        storage,
        ...(options.hostBridge === undefined ? {hostScope: {}} : {hostBridge: options.hostBridge}),
    });
    render(App, {props: {stores}});
    await stores.start();
    await waitFor(() => {
        expect(stores.app.loading).toBe(false);
    });
    return {stores, transport, router, storage};
}
