import {describe, expect, it} from 'vitest';

import {ApiRequestError, isApiError, toApiRequestError} from './error.js';

describe('ApiRequestError', () => {
    it('is an Error and carries the contract fields', () => {
        const error = new ApiRequestError({
            message: 'Unknown parameter',
            kind: 'rpc',
            faultCode: -5,
            faultString: 'Unknown parameter',
            problems: [{parameter: 'PROFILE_MODE', message: 'unknown'}],
        });

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiRequestError');
        expect(error.message).toBe('Unknown parameter');
        expect(error.toApiError()).toEqual({
            message: 'Unknown parameter',
            kind: 'rpc',
            faultCode: -5,
            faultString: 'Unknown parameter',
            problems: [{parameter: 'PROFILE_MODE', message: 'unknown'}],
        });
    });

    it('omits the optional fields it was not given', () => {
        const error = new ApiRequestError({message: 'nope', kind: 'internal'});
        expect(error.faultCode).toBeUndefined();
        expect(error.toApiError()).toEqual({message: 'nope', kind: 'internal'});
    });
});

describe('isApiError', () => {
    it('accepts the contract shape and rejects everything else', () => {
        expect(isApiError({message: 'x', kind: 'rpc'})).toBe(true);
        expect(isApiError({message: 'x'})).toBe(false);
        expect(isApiError('x')).toBe(false);
        expect(isApiError(null)).toBe(false);
    });
});

describe('toApiRequestError', () => {
    it('passes an ApiRequestError through', () => {
        const error = new ApiRequestError({message: 'x', kind: 'rpc'});
        expect(toApiRequestError(error)).toBe(error);
    });

    it('wraps a contract-shaped object, an Error and anything else', () => {
        expect(toApiRequestError({message: 'x', kind: 'validation'})).toMatchObject({kind: 'validation'});
        expect(toApiRequestError(new TypeError('bad'), 'connection')).toMatchObject({
            kind: 'connection',
            message: 'bad',
        });
        expect(toApiRequestError('plain string')).toMatchObject({kind: 'internal', message: 'plain string'});
    });
});
