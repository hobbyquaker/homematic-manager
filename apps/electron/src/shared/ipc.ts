/**
 * What main, preload and renderer agree on.
 *
 * Three of the four modules of this app run in three different JavaScript contexts, and this file
 * is the only thing all of them import. It holds no logic and touches neither Electron nor Node,
 * so the preload can bundle it without dragging anything else along.
 *
 * The API itself is the contract of `packages/core/src/api/types.ts`: `ApiFrame` JSON over the
 * channel {@link API_CHANNEL}, in both directions, exactly as the WebSocket transport carries it.
 * Everything that is *not* the API - the theme source, the updater, the device images - lives on
 * {@link HOST_INVOKE_CHANNEL} instead, so that a host feature can never be mistaken for a method
 * of the contract.
 */

/** The one channel the `ApiFrame`s travel on, renderer -> main and main -> renderer. */
export const API_CHANNEL = 'api';

/**
 * Transport-level connection state, main -> renderer, as a single boolean.
 *
 * `Transport.connected` is not part of `ApiFrame` - the WebSocket transport reads it off its own
 * socket, and an IPC bridge has no socket to read. Rather than inventing a fifth frame type (which
 * the strict codec would reject) the bridge sends the flag on its own channel. It goes false once,
 * when main starts shutting the backend down, so the UI greys out instead of waiting for answers
 * that will not come.
 */
export const API_CONNECTED_CHANNEL = 'api:connected';

/** Request/response for everything that is not the API contract: `ipcRenderer.invoke`. */
export const HOST_INVOKE_CHANNEL = 'hmm-host';

/** Push channel for the same: main -> renderer, `[name, payload]`. */
export const HOST_EVENT_CHANNEL = 'hmm-host-event';

/** The global the preload puts the transport on; `createTransport()` of the UI looks for it. */
export const TRANSPORT_GLOBAL = '__HMM_TRANSPORT__';

/**
 * The global the preload puts the host bridge on - everything the UI can only get from Electron.
 * The UI has no hook for it yet (task 8); until then the renderer entry is its only consumer.
 */
export const HOST_GLOBAL = '__HMM_HOST__';

/** Custom scheme for device images (D-10), so a `<img src>` needs no base64 round trip. */
export const IMAGE_SCHEME = 'hmm-image';

/**
 * The URL of a device image. `hmm-image://device/HmIP-PSM` - the type is a path segment and not
 * the host, because a URL host is lower-cased and would lose `HmIP-BSM` vs `HMIP-BSM`.
 */
export function deviceImageUrl(deviceType: string): string {
    return `${IMAGE_SCHEME}://device/${encodeURIComponent(deviceType)}`;
}

/** The device type of a {@link deviceImageUrl}, or `undefined` for anything else. */
export function deviceTypeFromImageUrl(url: string): string | undefined {
    const match = /^hmm-image:\/\/device\/([^/?#]+)\/?$/.exec(url);
    if (!match?.[1]) {
        return undefined;
    }
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return undefined;
    }
}

/** What the user picked in the UI's theme switch; `system` follows the OS (D-22). */
export type ThemeSource = 'system' | 'light' | 'dark';

/** Where the update flow stands (D-16). Never installs anything without a confirmation. */
export type UpdatePhase =
    'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installOnQuit' | 'error';

export interface UpdateState {
    phase: UpdatePhase;
    /** The version that is available, being downloaded or ready. */
    version?: string;
    /** 0-100 while downloading. */
    percent?: number;
    /** Why the updater is disabled, or what went wrong. */
    message?: string;
    /** The user dismissed the notification for {@link UpdateState.version}. */
    dismissed: boolean;
}

/** What the About dialog and the window title want to know about their host. */
export interface HostInfo {
    version: string;
    electron: string;
    chrome: string;
    node: string;
    platform: string;
    arch: string;
    packaged: boolean;
    /** `app.getPath('userData')`, so a bug report can name the directory. */
    userData: string;
    logFile: string;
}

/** Commands of {@link HOST_INVOKE_CHANNEL}: positional params in, one result out. */
export interface HostCommands {
    'app.info': {params: []; result: HostInfo};
    'theme.set': {params: [source: ThemeSource]; result: null};
    'update.state': {params: []; result: UpdateState};
    'update.check': {params: []; result: UpdateState};
    'update.download': {params: []; result: UpdateState};
    /** The explicit confirmation of D-16: install when the user quits, never before. */
    'update.installOnQuit': {params: []; result: UpdateState};
    'update.dismiss': {params: []; result: UpdateState};
}

export type HostCommandName = keyof HostCommands;

/** Events of {@link HOST_EVENT_CHANNEL}. */
export interface HostEvents {
    'update.state': UpdateState;
    /** The OS switched between light and dark while `system` is selected (D-22). */
    'theme.system': {dark: boolean};
}

export type HostEventName = keyof HostEvents;

/** What the preload exposes as `window.__HMM_HOST__`. */
export interface HostBridge {
    /** Asynchronous on purpose: a sandboxed preload has no synchronous IPC worth having. */
    info(): Promise<HostInfo>;
    /** `hmm-image://device/<type>`; the UI puts it straight into an `<img src>`. */
    deviceImageUrl(deviceType: string): string;
    setTheme(source: ThemeSource): Promise<void>;
    /** The OS theme, for `system`; fires whenever the OS switches (D-22). */
    onSystemTheme(handler: (dark: boolean) => void): () => void;
    update: {
        state(): Promise<UpdateState>;
        check(): Promise<UpdateState>;
        download(): Promise<UpdateState>;
        installOnQuit(): Promise<UpdateState>;
        dismiss(): Promise<UpdateState>;
        on(handler: (state: UpdateState) => void): () => void;
    };
}
