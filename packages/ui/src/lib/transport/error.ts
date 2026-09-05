import type {ApiError, WriteProblem} from '@homematic-manager/core';

/**
 * The `ApiError` of the contract as a real `Error`.
 *
 * The contract says every request rejects with an `ApiError`; a plain object would lose the stack
 * and would not survive `instanceof Error` checks in the components, so the class carries both
 * shapes. Nothing in the UI ever constructs one except a transport - the stores turn them into
 * notices, they are never thrown at the user.
 */
export class ApiRequestError extends Error implements ApiError {
    readonly kind: ApiError['kind'];
    readonly faultCode?: number;
    readonly faultString?: string;
    readonly problems?: WriteProblem[];

    constructor(error: ApiError) {
        super(error.message);
        this.name = 'ApiRequestError';
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

    /** The plain contract shape, for a transport that has to put it on a wire. */
    toApiError(): ApiError {
        const error: ApiError = {message: this.message, kind: this.kind};
        return {
            ...error,
            ...(this.faultCode === undefined ? {} : {faultCode: this.faultCode}),
            ...(this.faultString === undefined ? {} : {faultString: this.faultString}),
            ...(this.problems === undefined ? {} : {problems: this.problems}),
        };
    }
}

/** Does this value have the shape the contract promises? */
export function isApiError(value: unknown): value is ApiError {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<ApiError>;
    return typeof candidate.message === 'string' && typeof candidate.kind === 'string';
}

/**
 * Anything that was thrown, as an `ApiRequestError`. A transport must never let a `TypeError` from
 * a broken frame reach the stores as something they cannot classify.
 */
export function toApiRequestError(value: unknown, fallbackKind: ApiError['kind'] = 'internal'): ApiRequestError {
    if (value instanceof ApiRequestError) {
        return value;
    }
    if (isApiError(value)) {
        return new ApiRequestError(value);
    }
    if (value instanceof Error) {
        return new ApiRequestError({message: value.message, kind: fallbackKind});
    }
    return new ApiRequestError({message: String(value), kind: fallbackKind});
}
