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

/**
 * What an answer looks like when the interface process does not have the method.
 *
 * There is no single shape for it. The CCU's group process (VirtualDevices) answers
 * `getServiceMessages` with a body that is not an XML-RPC method response at all, which
 * `homematic-xmlrpc`'s deserializer reports as `Invalid XML-RPC message`; hmipserver refuses an
 * unknown method at the HTTP level with no fault code; something that does speak XML-RPC properly
 * answers a fault, with either the eq-3 wording or the standard `-32601`.
 *
 * Only the *class* matters here: a call that will never work on this interface, so asking again is
 * pointless. It is deliberately not the same thing as an error - the interface is fine, it simply
 * cannot do this - which is why the caller remembers it instead of logging it.
 */
const UNSUPPORTED_METHOD_PATTERNS: readonly RegExp[] = [
    // homematic-xmlrpc's deserializer, when the answer is not an XML-RPC method response
    /invalid xml-rpc message/i,
    /not a method response/i,
    /invalid method response/i,
    /unknown xml-rpc tag/i,
    // binrpc's own parser
    /malformed response/i,
    // an interface that answers XML-RPC properly but has no handler for the method
    /unknown method/i,
    /method not found/i,
];

/** The standard XML-RPC fault code for a method the server does not have. */
const FAULT_METHOD_NOT_FOUND = -32601;

/**
 * Does this say "this interface process does not have that method"?
 *
 * Task 17 found it on all three lab boxes: `VirtualDevices` answers `getServiceMessages` with
 * invalid XML-RPC on every re-`init`, so the service-message sweep wrote one INFO line a minute -
 * on an idle CCU addon the only thing in the log. The built-in table now says which interfaces have
 * the method (`serviceMessages`); this is what a *user-defined* interface is judged by, once.
 */
export function isMethodUnsupported(value: unknown): boolean {
    const error = toApiError(value);
    if (error.faultCode === FAULT_METHOD_NOT_FOUND) {
        return true;
    }
    const text = `${error.faultString ?? ''} ${error.message}`;
    return UNSUPPORTED_METHOD_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Did nothing answer at all on that port?
 *
 * A CCU without a wired gateway runs no `hs485d`, so BidCos-Wired - which is in the default
 * interface list - refuses the TCP connection. That is neither a fault of the interface process nor
 * a transient error: the process is not there, and retrying it every 15 s produced one ERROR line
 * per quarter minute for as long as the app ran (found by task 13 on hardware). The interface
 * manager treats it as "not present" and backs off instead.
 *
 * The code is looked for along the whole `cause` chain, because the RPC libraries wrap it, and in
 * the message text as well, because `connectionError()` composes its text before the cause is set.
 */
export function isConnectionRefused(value: unknown): boolean {
    let current: unknown = value;
    for (let depth = 0; current !== undefined && current !== null && depth < 10; depth += 1) {
        const candidate = current as {code?: unknown; errors?: unknown; cause?: unknown};
        if (candidate.code === 'ECONNREFUSED') {
            return true;
        }
        // node's happy-eyeballs connect aggregates the per-address failures in `errors`
        if (Array.isArray(candidate.errors) && candidate.errors.some((entry) => isConnectionRefused(entry))) {
            return true;
        }
        current = candidate.cause;
    }
    return /\bECONNREFUSED\b/.test(errorMessage(value));
}
