/**
 * The API contract over Electron IPC: `ApiFrame` in, `ApiFrame` out.
 *
 * The backend runs in this very process, so the bridge could hand the renderer a direct call - but
 * the renderer is a browser context behind context isolation and must not hold a reference to
 * anything of ours. So main serialises the same four frames the WebSocket transport uses, which
 * has the pleasant side effect that a value which is not JSON fails here exactly as it would fail
 * in `apps/web`.
 *
 * Nothing in this module imports Electron: it takes the two objects it needs as interfaces, which
 * is what lets the tests drive the whole bridge with a pair of fakes.
 */

import type {ApiError, ApiEventName, ApiFrame, ApiMethodName, Transport} from '@homematic-manager/core';
import {decodeFrame, encodeFrame, errorFrame, responseFrame} from '@homematic-manager/backend';

import {API_CHANNEL, API_CONNECTED_CHANNEL} from '../shared/ipc.js';

/**
 * Every event of the contract, because `ApiEvents` is a type and has no runtime shape. The
 * `satisfies` keeps it honest in one direction (no invented names) and {@link ALL_EVENTS_LISTED}
 * in the other: adding an event to the contract without adding it here fails `tsc`.
 */
export const API_EVENT_NAMES = [
    'interfaces.changed',
    'rega.changed',
    'devices.changed',
    'names.changed',
    'rpc.event',
    'serviceMessages.changed',
    'writeLog.appended',
    'write.progress',
    'config.changed',
    'notice',
] as const satisfies readonly ApiEventName[];

const ALL_EVENTS_LISTED: Exclude<ApiEventName, (typeof API_EVENT_NAMES)[number]> extends never ? true : never = true;
void ALL_EVENTS_LISTED;

/** The part of `WebContents` the bridge uses. */
export interface WebContentsLike {
    readonly id: number;
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
}

/** The part of an `IpcMainEvent` the bridge uses. */
export interface IpcMainEventLike {
    readonly sender: WebContentsLike;
}

/** The part of `ipcMain` the bridge uses. */
export interface IpcMainLike {
    on(channel: string, listener: (event: IpcMainEventLike, ...args: unknown[]) => void): unknown;
    removeAllListeners(channel: string): unknown;
}

export interface IpcBridgeOptions {
    readonly ipcMain: IpcMainLike;
    readonly transport: Transport;
    /** Defaults to {@link API_EVENT_NAMES}; a test subscribes to two names instead of ten. */
    readonly events?: readonly ApiEventName[];
    /** A frame that could not be handled at all; main logs it. */
    readonly onProtocolError?: (message: string) => void;
}

/**
 * Serves one backend to any number of renderers.
 *
 * Requests are answered to the sender that made them, events go to every attached renderer, and a
 * renderer that has gone away is dropped rather than thrown at - `webContents.send()` on a
 * destroyed frame is the classic "Object has been destroyed" crash of an Electron main process on
 * quit, and this bridge is the one place that could produce it.
 */
export class IpcBridge {
    readonly #transport: Transport;
    readonly #ipcMain: IpcMainLike;
    readonly #onProtocolError: (message: string) => void;
    readonly #renderers = new Map<number, WebContentsLike>();
    readonly #unsubscribe: Array<() => void> = [];

    #disposed = false;

    constructor(options: IpcBridgeOptions) {
        this.#transport = options.transport;
        this.#ipcMain = options.ipcMain;
        this.#onProtocolError = options.onProtocolError ?? (() => undefined);

        this.#ipcMain.on(API_CHANNEL, (event, ...args) => {
            this.#handle(event.sender, args[0]);
        });

        for (const name of options.events ?? API_EVENT_NAMES) {
            this.#unsubscribe.push(
                this.#transport.on(name, (payload) => {
                    this.broadcast({t: 'ev', n: name, d: payload});
                }),
            );
        }
        this.#unsubscribe.push(
            this.#transport.onConnectionChange((connected) => {
                this.#send(API_CONNECTED_CHANNEL, connected);
            }),
        );
    }

    /** The renderers that currently receive events. */
    get renderers(): WebContentsLike[] {
        return [...this.#renderers.values()];
    }

    /**
     * Attaches a window. Called once per `BrowserWindow`; a second call for the same one replaces
     * the entry, so a reloaded renderer does not get its events twice.
     */
    attach(contents: WebContentsLike): void {
        this.#renderers.set(contents.id, contents);
        contents.send(API_CONNECTED_CHANNEL, this.#transport.connected);
    }

    detach(contents: WebContentsLike): void {
        this.#renderers.delete(contents.id);
    }

    /** Sends one frame to every attached renderer. */
    broadcast(frame: ApiFrame): void {
        this.#send(API_CHANNEL, encodeFrame(frame));
    }

    /** Unsubscribes from the backend and forgets the renderers. Idempotent. */
    dispose(): void {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        for (const off of this.#unsubscribe.splice(0)) {
            off();
        }
        this.#ipcMain.removeAllListeners(API_CHANNEL);
        this.#renderers.clear();
    }

    #send(channel: string, payload: unknown): void {
        for (const [id, contents] of [...this.#renderers]) {
            if (contents.isDestroyed()) {
                this.#renderers.delete(id);
                continue;
            }
            try {
                contents.send(channel, payload);
            } catch {
                // The window went away between the check and the send; nothing to do about it.
                this.#renderers.delete(id);
            }
        }
    }

    #handle(sender: WebContentsLike, data: unknown): void {
        const frame = decodeFrame(data);
        if (frame === undefined) {
            this.#onProtocolError('a renderer sent something that is not an ApiFrame');
            return;
        }
        if (frame.t !== 'req') {
            this.#onProtocolError(`a renderer sent a "${frame.t}" frame, which only main may send`);
            return;
        }
        void this.#request(sender, frame.id, frame.m, frame.p);
    }

    async #request(sender: WebContentsLike, id: number, method: ApiMethodName, params: unknown[]): Promise<void> {
        let answer: ApiFrame;
        try {
            // The contract types the params per method; a frame off the wire is `unknown[]`, and
            // the backend validates what it gets. One cast, in the one place that needs it.
            const call = this.#transport.request.bind(this.#transport) as (
                method: string,
                ...params: unknown[]
            ) => Promise<unknown>;
            answer = responseFrame(id, await call(method, ...params));
        } catch (error) {
            answer = errorFrame(id, toApiError(error));
        }
        if (sender.isDestroyed()) {
            return;
        }
        try {
            sender.send(API_CHANNEL, encodeFrame(answer));
        } catch {
            // Same race as in #send: the window closed while its request was running.
        }
    }
}

/**
 * Anything that was thrown, as the `ApiError` the contract promises. The backend rejects with one
 * already; this only has to survive the case where it does not.
 */
function toApiError(error: unknown): ApiError {
    if (typeof error === 'object' && error !== null) {
        const candidate = error as Partial<ApiError>;
        if (typeof candidate.message === 'string' && typeof candidate.kind === 'string') {
            return {
                message: candidate.message,
                kind: candidate.kind,
                ...(candidate.faultCode === undefined ? {} : {faultCode: candidate.faultCode}),
                ...(candidate.faultString === undefined ? {} : {faultString: candidate.faultString}),
                ...(candidate.problems === undefined ? {} : {problems: candidate.problems}),
            };
        }
    }
    return {message: error instanceof Error ? error.message : String(error), kind: 'internal'};
}
