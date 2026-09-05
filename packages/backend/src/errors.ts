/**
 * Every rejection the API hands out is an `ApiError` (`packages/core/src/api/types.ts`).
 *
 * The class below is that contract shape as a real `Error` so it keeps a stack on the way through
 * the backend, and `toApiError()` turns whatever an RPC library threw into it. XML-RPC faults keep
 * their `faultCode`/`faultString`: the UI shows them verbatim, and task 6 calibrates the fault
 * table of the simulator against them.
 */

import type {ApiError, WriteProblem} from '@homematic-manager/core';

/** The `ApiError` of the contract as a throwable error. */
export class BackendError extends Error implements ApiError {
    readonly kind: ApiError['kind'];
    readonly faultCode?: number;
    readonly faultString?: string;
    readonly problems?: WriteProblem[];

    constructor(error: ApiError, options: {cause?: unknown} = {}) {
        super(error.message, options.cause === undefined ? {} : {cause: options.cause});
        this.name = 'BackendError';
        this.kind = error.kind;
        if (error.faultCode !== undefined) {
            this.faultCode = error.faultCode;
        }
        if (error.faultString !== undefined) {
            this.faultString = error.faultString;
        }
        if (error.problems !== undefined) {
            this.problems = error.problems;
        }
    }

    /** The plain contract shape a transport puts on the wire. */
    toApiError(): ApiError {
        return {
            message: this.message,
            kind: this.kind,
            ...(this.faultCode === undefined ? {} : {faultCode: this.faultCode}),
            ...(this.faultString === undefined ? {} : {faultString: this.faultString}),
            ...(this.problems === undefined ? {} : {problems: this.problems}),
        };
    }
}

/** `kind: 'config'` - the request cannot be answered with the configuration as it is. */
export function configError(message: string): BackendError {
    return new BackendError({message, kind: 'config'});
}

/** `kind: 'connection'` - no interface process answered, or not in time. */
export function connectionError(message: string, cause?: unknown): BackendError {
    return new BackendError({message, kind: 'connection'}, cause === undefined ? {} : {cause});
}

/** `kind: 'validation'` - the values would not have survived the device (task 6). */
export function validationError(message: string, problems?: readonly WriteProblem[]): BackendError {
    return new BackendError({message, kind: 'validation', ...(problems ? {problems: [...problems]} : {})});
}

/** `kind: 'internal'` - a bug on our side; the UI shows it as a notice. */
export function internalError(message: string, cause?: unknown): BackendError {
    return new BackendError({message, kind: 'internal'}, cause === undefined ? {} : {cause});
}

/** What an interface process answers when it refuses a call. */
export interface RpcFault {
    readonly faultCode: number;
    readonly faultString: string;
}

/**
 * Does this look like an interface process' fault?
 *
 * `homematic-xmlrpc` turns a `<fault>` into an `Error` carrying `faultCode`/`faultString`, and
 * `binrpc` returns the fault struct of a type `0xff` message as an ordinary result - so both a
 * thrown error and a plain result have to be checked (see `rpc/client.ts`).
 */
export function isRpcFault(value: unknown): value is RpcFault {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {faultCode?: unknown; faultString?: unknown};
    return typeof candidate.faultCode === 'number' && typeof candidate.faultString === 'string';
}

/** An interface fault as a `BackendError` with `kind: 'rpc'`. */
export function rpcFaultError(context: string, fault: RpcFault): BackendError {
    return new BackendError({
        message: `${context}: ${fault.faultString} (${String(fault.faultCode)})`,
        kind: 'rpc',
        faultCode: fault.faultCode,
        faultString: fault.faultString,
    });
}

/** Does this value already have the contract shape? */
export function isApiError(value: unknown): value is ApiError {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {message?: unknown; kind?: unknown};
    return typeof candidate.message === 'string' && typeof candidate.kind === 'string';
}

/**
 * Anything that was thrown, as an `ApiError`. Nothing may leave the backend that the UI cannot
 * classify, so a `TypeError` from a broken frame becomes `kind: 'internal'` rather than escaping.
 */
export function toApiError(value: unknown, fallbackKind: ApiError['kind'] = 'internal'): ApiError {
    if (value instanceof BackendError) {
        return value.toApiError();
    }
    if (isRpcFault(value)) {
        return {
            message: value instanceof Error ? value.message : `${value.faultString} (${String(value.faultCode)})`,
            kind: 'rpc',
            faultCode: value.faultCode,
            faultString: value.faultString,
        };
    }
    if (isApiError(value)) {
        return value;
    }
    if (value instanceof Error) {
        return {message: value.message, kind: fallbackKind};
    }
    return {message: String(value), kind: fallbackKind};
}

/** The message of anything that was thrown, for a notice or a log line. */
export function errorMessage(value: unknown): string {
    return toApiError(value).message;
}
