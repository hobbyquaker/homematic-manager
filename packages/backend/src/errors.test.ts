import {describe, expect, it} from 'vitest';

import {
    BackendError,
    configError,
    connectionError,
    errorMessage,
    internalError,
    isApiError,
    isRpcFault,
    rpcFaultError,
    toApiError,
    validationError,
} from './errors.js';

describe('BackendError', () => {
    it('carries the contract shape and a stack', () => {
        const error = new BackendError({message: 'boom', kind: 'rpc', faultCode: -7, faultString: 'Out of range'});
        expect(error).toBeInstanceOf(Error);
        expect(error.stack).toBeTypeOf('string');
        expect(error.toApiError()).toEqual({
            message: 'boom',
            kind: 'rpc',
            faultCode: -7,
            faultString: 'Out of range',
        });
    });

    it('omits the optional fields it was not given', () => {
        expect(new BackendError({message: 'x', kind: 'internal'}).toApiError()).toEqual({
            message: 'x',
            kind: 'internal',
        });
    });

    it('keeps write problems and the cause', () => {
        const cause = new Error('why');
        const error = new BackendError(
            {message: 'nope', kind: 'validation', problems: [{parameter: 'A', message: 'bad'}]},
            {cause},
        );
        expect(error.cause).toBe(cause);
        expect(error.toApiError().problems).toEqual([{parameter: 'A', message: 'bad'}]);
    });
});

describe('the constructors', () => {
    it('set the kind', () => {
        expect(configError('c').kind).toBe('config');
        expect(connectionError('c').kind).toBe('connection');
        expect(validationError('v').kind).toBe('validation');
        expect(internalError('i').kind).toBe('internal');
    });

    it('passes problems and causes through', () => {
        expect(validationError('v', [{message: 'm'}]).problems).toEqual([{message: 'm'}]);
        const cause = new Error('socket');
        expect(connectionError('c', cause).cause).toBe(cause);
        expect(internalError('i', cause).cause).toBe(cause);
    });
});

describe('isRpcFault', () => {
    it('accepts the fault shape of both protocols', () => {
        expect(isRpcFault({faultCode: -4, faultString: 'Unknown parameter'})).toBe(true);
        const thrown = Object.assign(new Error('XML-RPC fault'), {faultCode: -4, faultString: 'Unknown parameter'});
        expect(isRpcFault(thrown)).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isRpcFault(null)).toBe(false);
        expect(isRpcFault('fault')).toBe(false);
        expect(isRpcFault({faultCode: '-4', faultString: 'x'})).toBe(false);
        expect(isRpcFault({faultCode: -4})).toBe(false);
    });
});

describe('rpcFaultError', () => {
    it('names the call and keeps the fault', () => {
        const error = rpcFaultError('putParamset', {faultCode: -7, faultString: 'Value out of range'});
        expect(error.message).toBe('putParamset: Value out of range (-7)');
        expect(error.kind).toBe('rpc');
        expect(error.faultCode).toBe(-7);
    });
});

describe('toApiError', () => {
    it('passes a BackendError through as the contract shape', () => {
        expect(toApiError(configError('no host'))).toEqual({message: 'no host', kind: 'config'});
    });

    it('turns a thrown xml-rpc fault into kind rpc', () => {
        const thrown = Object.assign(new Error('XML-RPC fault: Unknown instance'), {
            faultCode: -2,
            faultString: 'Unknown instance',
        });
        expect(toApiError(thrown)).toEqual({
            message: 'XML-RPC fault: Unknown instance',
            kind: 'rpc',
            faultCode: -2,
            faultString: 'Unknown instance',
        });
    });

    it('turns a binrpc fault struct into kind rpc', () => {
        expect(toApiError({faultCode: -1, faultString: 'Unknown method'})).toEqual({
            message: 'Unknown method (-1)',
            kind: 'rpc',
            faultCode: -1,
            faultString: 'Unknown method',
        });
    });

    it('keeps a value that already has the contract shape', () => {
        expect(toApiError({message: 'm', kind: 'connection'})).toEqual({message: 'm', kind: 'connection'});
    });

    it('classifies an ordinary error and a non-error', () => {
        expect(toApiError(new Error('ECONNREFUSED'), 'connection')).toEqual({
            message: 'ECONNREFUSED',
            kind: 'connection',
        });
        expect(toApiError('just a string')).toEqual({message: 'just a string', kind: 'internal'});
    });
});

describe('isApiError', () => {
    it('checks message and kind', () => {
        expect(isApiError({message: 'm', kind: 'rpc'})).toBe(true);
        expect(isApiError({message: 'm'})).toBe(false);
        expect(isApiError(undefined)).toBe(false);
    });
});

describe('errorMessage', () => {
    it('is the message of whatever was thrown', () => {
        expect(errorMessage(new Error('nope'))).toBe('nope');
        expect(errorMessage(42)).toBe('42');
    });
});
