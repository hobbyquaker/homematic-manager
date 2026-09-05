/**
 * The two pieces of network plumbing the configuration needs: which addresses this machine could
 * ask the CCU to call back on, and whether a port answers at all.
 *
 * The port probe is the same TCP connect 2.x used (`main.js:149-161`), with two differences: it is
 * never awaited by anything the UI waits for (issues #121/#126/#134 - 2.x probed six ports with a
 * 5 s timeout each before the window became usable) and it destroys the socket instead of leaving
 * it to time out.
 */

import net from 'node:net';
import os from 'node:os';

/** Every non-internal IPv4 address of this machine; candidates for the callback address. */
export function localIPv4Addresses(
    interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces,
): string[] {
    const addresses: string[] = [];
    for (const entries of Object.values(interfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && !entry.internal && !addresses.includes(entry.address)) {
                addresses.push(entry.address);
            }
        }
    }
    return addresses;
}

export interface ProbeOptions {
    readonly timeoutMs?: number;
    /** Injected for the tests; defaults to `net.connect`. */
    readonly connect?: typeof net.connect;
}

/** True when a TCP connection to `host:port` is accepted within the timeout. Never throws. */
export function probePort(host: string, port: number, options: ProbeOptions = {}): Promise<boolean> {
    const timeoutMs = options.timeoutMs ?? 2000;
    const connect = options.connect ?? net.connect;
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (open: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(open);
        };
        const socket = connect({host, port, timeout: timeoutMs}, () => {
            done(true);
        });
        socket.on('error', () => {
            done(false);
        });
        socket.on('timeout', () => {
            done(false);
        });
    });
}

/** Resolves after `ms`; the timer never keeps the process alive. */
export function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
}

/**
 * Rejects with `error` when `promise` has not settled after `ms`. The underlying work is not
 * cancelled - an RPC call that answers late is simply ignored, which is what the watchdog wants.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(error());
        }, ms);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (reason: unknown) => {
                clearTimeout(timer);
                reject(reason instanceof Error ? reason : new Error(String(reason)));
            },
        );
    });
}
