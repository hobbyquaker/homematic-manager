import type {RpcValue} from '@homematic-manager/core';

/**
 * An RPC value as the grids print it. Scalars stay scalars - `true`, `21.5`, `OFF` - and structs
 * and arrays become compact JSON, which is what the 2.x events and console grids did.
 */
export function formatRpcValue(value: RpcValue | undefined): string {
    if (value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}

/** `14:22:41` - the time column of the events grid and the RPC log. */
export function formatTime(timestamp: number, locale?: string): string {
    return new Date(timestamp).toLocaleTimeString(locale, {hour12: false});
}

/** `2026-09-05 14:22:41` - used where the day matters, as in the service-message list. */
export function formatDateTime(timestamp: number, locale?: string): string {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString(locale)} ${date.toLocaleTimeString(locale, {hour12: false})}`;
}

/** `184 ms`, `1.20 s` - the duration column of the RPC log. */
export function formatDuration(durationMs: number): string {
    if (durationMs < 1000) {
        return `${Math.round(durationMs)} ms`;
    }
    return `${(durationMs / 1000).toFixed(2)} s`;
}

/** The parameter list of an RPC call, as the 2.x `#rpc-command` line printed it. */
export function formatParams(params: readonly RpcValue[]): string {
    return params.map((param) => (typeof param === 'string' ? param : JSON.stringify(param))).join(', ');
}
