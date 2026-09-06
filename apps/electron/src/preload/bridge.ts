/**
 * The renderer's half of the IPC transport - written against interfaces, not against Electron, so
 * that the tests can drive it with a fake `ipcRenderer`.
 *
 * This is the only code in the app that runs in the isolated preload world. It bundles no Node and
 * no backend: it parses `ApiFrame` JSON itself instead of importing the strict codec of
 * `@homematic-manager/backend`, because importing that would pull `fs` and `net` into a sandboxed
 * context that must not have them. The strictness belongs on the receiving end anyway, and that is
 * main (`src/main/ipcBridge.ts`), which does use the codec.
 *
 * Rejections are the plain `ApiError` object of the contract, not an `Error`: `contextBridge`
 * copies an `Error` across the isolation boundary as message plus stack and drops every custom
 * property, which would lose `kind`, `faultCode` and `problems`. The UI's `toApiRequestError()`
 * accepts the plain shape and turns it back into its `ApiRequestError`.
 */

import type {
    ApiError,
    ApiEventName,
    ApiEvents,
    ApiFrame,
    ApiMethodName,
    ApiParams,
    ApiResult,
    Transport,
} from '@homematic-manager/core';

import {
    API_CHANNEL,
    API_CONNECTED_CHANNEL,
    HOST_EVENT_CHANNEL,
    HOST_INVOKE_CHANNEL,
    deviceImageUrl,
    type HostBridge,
    type HostCommandName,
    type HostCommands,
    type HostInfo,
    type MenuAction,
    type ThemeSource,
    type UpdateState,
} from '../shared/ipc.js';

/** The part of `ipcRenderer` the bridge uses. */
export interface IpcRendererLike {
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
    send(channel: string, ...args: unknown[]): void;
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export interface IpcTransportOptions {
    readonly ipcRenderer: IpcRendererLike;
    /** How long a request may wait for main. 60 s - a CCU that is asleep is slow, not broken. */
    readonly requestTimeoutMs?: number;
}

interface Pending {
    readonly method: ApiMethodName;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: ApiError) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * `Transport` over Electron IPC. The same four frames as the WebSocket transport, minus the
 * reconnect logic: an IPC channel to our own main process does not come and go, it is there until
 * main says the backend is stopping.
 */
export class IpcTransport implements Transport {
    readonly #ipc: IpcRendererLike;
    readonly #timeoutMs: number;
    readonly #pending = new Map<number, Pending>();
    readonly #listeners = new Map<ApiEventName, Set<(payload: never) => void>>();
    readonly #connectionListeners = new Set<(connected: boolean) => void>();

    #connected = true;
    #nextId = 1;

    constructor(options: IpcTransportOptions) {
        this.#ipc = options.ipcRenderer;
        this.#timeoutMs = options.requestTimeoutMs ?? 60_000;

        this.#ipc.on(API_CHANNEL, (_event, ...args) => {
            this.#receive(args[0]);
        });
        this.#ipc.on(API_CONNECTED_CHANNEL, (_event, ...args) => {
            this.#setConnected(args[0] === true);
        });
    }

    get connected(): boolean {
        return this.#connected;
    }

    request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        if (!this.#connected) {
            return Promise.reject<ApiResult<M>>({
                message: `${method}: the backend is not available any more`,
                kind: 'connection',
            } satisfies ApiError);
        }
        const id = this.#nextId;
        this.#nextId += 1;
        const frame: ApiFrame = {t: 'req', id, m: method, p: params};
        return new Promise<ApiResult<M>>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject({message: `${method} timed out after ${this.#timeoutMs} ms`, kind: 'connection'});
            }, this.#timeoutMs);
            this.#pending.set(id, {
                method,
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            try {
                this.#ipc.send(API_CHANNEL, JSON.stringify(frame));
            } catch (error) {
                this.#settle(id, undefined, {
                    message: error instanceof Error ? error.message : String(error),
                    kind: 'internal',
                });
            }
        });
    }

    on<E extends ApiEventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void {
        const handlers = this.#listeners.get(event) ?? new Set<(payload: never) => void>();
        handlers.add(handler as (payload: never) => void);
        this.#listeners.set(event, handlers);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    onConnectionChange(handler: (connected: boolean) => void): () => void {
        this.#connectionListeners.add(handler);
        return () => {
            this.#connectionListeners.delete(handler);
        };
    }

    #receive(data: unknown): void {
        if (typeof data !== 'string') {
            return;
        }
        let frame: ApiFrame;
        try {
            frame = JSON.parse(data) as ApiFrame;
        } catch {
            return;
        }
        if (typeof frame !== 'object' || frame === null) {
            return;
        }
        switch (frame.t) {
            case 'res':
                this.#settle(frame.id, frame.r, undefined);
                break;
            case 'err':
                this.#settle(frame.id, undefined, asApiError(frame.e));
                break;
            case 'ev': {
                for (const handler of [...(this.#listeners.get(frame.n) ?? [])]) {
                    (handler as (payload: unknown) => void)(frame.d);
                }
                break;
            }
            default:
                break;
        }
    }

    #settle(id: number, result: unknown, error: ApiError | undefined): void {
        const pending = this.#pending.get(id);
        if (!pending) {
            return;
        }
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        if (error) {
            pending.reject(error);
        } else {
            pending.resolve(result);
        }
    }

    #setConnected(connected: boolean): void {
        if (this.#connected === connected) {
            return;
        }
        this.#connected = connected;
        if (!connected) {
            for (const [id] of [...this.#pending]) {
                this.#settle(id, undefined, {message: 'the backend was stopped', kind: 'connection'});
            }
        }
        for (const handler of [...this.#connectionListeners]) {
            handler(connected);
        }
    }
}

function asApiError(value: unknown): ApiError {
    if (typeof value === 'object' && value !== null) {
        const candidate = value as Partial<ApiError>;
        if (typeof candidate.message === 'string' && typeof candidate.kind === 'string') {
            return candidate as ApiError;
        }
    }
    return {message: 'malformed error frame', kind: 'internal'};
}

/** Everything the UI can only get from Electron: the images, the theme source, the updater. */
export function createHostBridge(ipc: IpcRendererLike): HostBridge {
    const invoke = async <C extends HostCommandName>(
        command: C,
        ...params: HostCommands[C]['params']
    ): Promise<HostCommands[C]['result']> =>
        (await ipc.invoke(HOST_INVOKE_CHANNEL, command, params)) as HostCommands[C]['result'];

    const updateListeners = new Set<(state: UpdateState) => void>();
    const systemThemeListeners = new Set<(dark: boolean) => void>();
    const menuListeners = new Set<(action: MenuAction) => void>();
    ipc.on(HOST_EVENT_CHANNEL, (_event, ...args) => {
        const [name, payload] = args;
        if (name === 'update.state') {
            for (const handler of [...updateListeners]) {
                handler(payload as UpdateState);
            }
        } else if (name === 'theme.system') {
            const dark = (payload as {dark?: unknown} | undefined)?.dark === true;
            for (const handler of [...systemThemeListeners]) {
                handler(dark);
            }
        } else if (name === 'menu.action') {
            const action = (payload as {action?: unknown} | undefined)?.action;
            if (typeof action === 'string') {
                for (const handler of [...menuListeners]) {
                    handler(action as MenuAction);
                }
            }
        }
    });

    return {
        info: (): Promise<HostInfo> => invoke('app.info'),
        deviceImageUrl,
        setTheme: async (source: ThemeSource): Promise<void> => {
            await invoke('theme.set', source);
        },
        onSystemTheme(handler: (dark: boolean) => void): () => void {
            systemThemeListeners.add(handler);
            return () => systemThemeListeners.delete(handler);
        },
        onMenuAction(handler: (action: MenuAction) => void): () => void {
            menuListeners.add(handler);
            return () => menuListeners.delete(handler);
        },
        openExternal: async (url: string): Promise<void> => {
            await invoke('shell.openExternal', url);
        },
        update: {
            state: (): Promise<UpdateState> => invoke('update.state'),
            check: (): Promise<UpdateState> => invoke('update.check'),
            download: (): Promise<UpdateState> => invoke('update.download'),
            installOnQuit: (): Promise<UpdateState> => invoke('update.installOnQuit'),
            dismiss: (): Promise<UpdateState> => invoke('update.dismiss'),
            on(handler: (state: UpdateState) => void): () => void {
                updateListeners.add(handler);
                return () => updateListeners.delete(handler);
            },
        },
    };
}
