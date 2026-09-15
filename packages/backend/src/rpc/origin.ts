/**
 * Who asked for an RPC call: the console, a UI action, or the backend on its own.
 *
 * Task 48: the RPC log shows every outgoing call, and the background ones - `init`, `ping`, the
 * service-message poll, the sweeps after an event - can be frequent, so every entry carries where
 * it came from and the drawer can hide them. The origin is a property of the call chain, not of a
 * function: `#refreshDevices` runs for the Devices tab's refresh button and for a `newDevices`
 * callback alike. Threading a parameter through the forty call sites of `#read`/`#write` and every
 * helper between them would change signatures for nothing, so the origin travels in Node's
 * `AsyncLocalStorage`: `Backend.request` opens a `ui` (or `console`) context, and whatever is
 * awaited inside it inherits that.
 *
 * Two things must be explicit, and the tests hold them:
 * - Anything long-lived that is *created* inside a request would inherit its context forever - the
 *   watchdog interval, the callback servers, the polling timers after a `config.set`. The places
 *   that create such things run under `background` on purpose (`Backend.#connect`, the timers, the
 *   manager's callbacks), and the manager's own calls name their origin outright.
 * - A queued write runs from the timer that drained the queue, which is the *previous* task's
 *   context; `Backend.#write` therefore captures the origin at enqueue time.
 *
 * The RPC client itself does not read this module: it takes a resolver (`originOf`) and an
 * explicit origin per call, so the logging layer stays free of Node (task 52 wants the same engine
 * in a browser host one day, where an explicit parameter would replace the storage).
 */

import {AsyncLocalStorage} from 'node:async_hooks';

import type {RpcOrigin} from '@homematic-manager/core';

const storage = new AsyncLocalStorage<RpcOrigin>();

/** The origin of the current call chain; `background` outside of any request. */
export function currentOrigin(): RpcOrigin {
    return storage.getStore() ?? 'background';
}

/** Runs `fn` with `origin` as the answer of {@link currentOrigin} for everything it awaits. */
export function runWithOrigin<T>(origin: RpcOrigin, fn: () => T): T {
    return storage.run(origin, fn);
}
