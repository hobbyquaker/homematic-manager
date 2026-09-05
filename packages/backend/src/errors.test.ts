import {describe, expect, it} from 'vitest';

import {
    BackendError,
    configError,
    connectionError,
    errorMessage,
    internalError,
    isApiError,
    isConnectionRefused,
    isMethodUnsupported,
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

describe('isConnectionRefused', () => {
    it('finds the code on the error itself and along the cause chain', () => {
        expect(isConnectionRefused(Object.assign(new Error('connect'), {code: 'ECONNREFUSED'}))).toBe(true);
        const wrapped = connectionError(
            'BidCos-Wired: init failed',
            Object.assign(new Error('x'), {code: 'ECONNREFUSED'}),
        );
        expect(isConnectionRefused(wrapped)).toBe(true);
    });

    it('finds it in an aggregate of per-address failures, which is what happy eyeballs throws', () => {
        const aggregate = Object.assign(new Error('all attempts failed'), {
            errors: [
                Object.assign(new Error('v6'), {code: 'EHOSTUNREACH'}),
                Object.assign(new Error('v4'), {code: 'ECONNREFUSED'}),
            ],
        });
        expect(isConnectionRefused(aggregate)).toBe(true);
    });

    it('falls back to the text, because the message is composed before the cause is attached', () => {
        expect(isConnectionRefused(new Error('connect ECONNREFUSED 192.168.1.2:2000'))).toBe(true);
    });

    it('is false for a timeout, a fault and anything else', () => {
        expect(isConnectionRefused(connectionError('HmIP-RF: ping timed out after 5000 ms'))).toBe(false);
        expect(isConnectionRefused(rpcFaultError('x', {faultCode: -2, faultString: 'Unknown'}))).toBe(false);
        expect(isConnectionRefused(undefined)).toBe(false);
        expect(isConnectionRefused('ECONNREFUSED_LIKE')).toBe(false);
    });

    it('does not walk a cause cycle forever', () => {
        const a: {message: string; cause?: unknown} = {message: 'a'};
        a.cause = a;
        expect(isConnectionRefused(a)).toBe(false);
    });
});

describe('isMethodUnsupported', () => {
    it('recognises an answer that is not an XML-RPC method response', () => {
        // what the CCU's group process gives the service-message sweep, measured on all three lab
        // boxes in task 17; homematic-xmlrpc's deserializer words it exactly like this
        expect(
            isMethodUnsupported(
                connectionError(
                    'VirtualDevices (ccu:9292, xmlrpc): getServiceMessages failed: Invalid XML-RPC message',
                ),
            ),
        ).toBe(true);
        expect(isMethodUnsupported(new Error('Not a method response'))).toBe(true);
        // binrpc's own parser
        expect(isMethodUnsupported(new Error('malformed response'))).toBe(true);
    });

    it('recognises a fault that says the method does not exist', () => {
        expect(isMethodUnsupported(rpcFaultError('x', {faultCode: -1, faultString: 'Unknown method'}))).toBe(true);
        expect(isMethodUnsupported(rpcFaultError('x', {faultCode: -32601, faultString: 'whatever'}))).toBe(true);
    });

    it('is false for everything an interface can still be asked again about', () => {
        expect(isMethodUnsupported(connectionError('BidCos-RF: getServiceMessages timed out after 5000 ms'))).toBe(
            false,
        );
        expect(isMethodUnsupported(rpcFaultError('x', {faultCode: -2, faultString: 'Invalid device'}))).toBe(false);
        expect(isMethodUnsupported(undefined)).toBe(false);
    });
});
