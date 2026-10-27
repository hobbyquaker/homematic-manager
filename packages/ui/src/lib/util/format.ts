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

export {formatDateTime, formatDuration, formatTime} from 'occulite-ui/format';

/** The parameter list of an RPC call, as the 2.x `#rpc-command` line printed it. */
export function formatParams(params: readonly RpcValue[]): string {
    return params.map((param) => (typeof param === 'string' ? param : JSON.stringify(param))).join(', ');
}
