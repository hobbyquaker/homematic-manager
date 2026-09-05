/**
 * The wire format of every transport: `ApiFrame` as JSON.
 *
 * The same four frames travel over the Electron IPC channel and over the WebSocket, so the codec
 * lives here rather than in either host. It is deliberately strict about what it accepts: a frame
 * from a socket is input from outside the process, and a malformed one has to be a rejected frame,
 * never an exception in the event loop.
 */

import type {ApiError, ApiFrame, ApiMethodName} from '@homematic-manager/core';

import {isApiError} from '../errors.js';

/** Serialises a frame. */
export function encodeFrame(frame: ApiFrame): string {
    return JSON.stringify(frame);
}

/** Parses a frame; `undefined` for anything that is not one. */
export function decodeFrame(data: unknown): ApiFrame | undefined {
    const text = typeof data === 'string' ? data : bufferToString(data);
    if (text === undefined) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return undefined;
    }
    const frame = parsed as Record<string, unknown>;
    switch (frame['t']) {
        case 'req':
            return typeof frame['id'] === 'number' && typeof frame['m'] === 'string' && Array.isArray(frame['p'])
                ? {t: 'req', id: frame['id'], m: frame['m'] as ApiMethodName, p: frame['p']}
                : undefined;
        case 'res':
            return typeof frame['id'] === 'number' ? {t: 'res', id: frame['id'], r: frame['r']} : undefined;
        case 'err':
            return typeof frame['id'] === 'number' && isApiError(frame['e'])
                ? {t: 'err', id: frame['id'], e: frame['e']}
                : undefined;
        case 'ev':
            return typeof frame['n'] === 'string'
                ? {t: 'ev', n: frame['n'] as ApiFrame extends {t: 'ev'; n: infer N} ? N : never, d: frame['d']}
                : undefined;
        default:
            return undefined;
    }
}

/** A response frame. */
export function responseFrame(id: number, result: unknown): ApiFrame {
    return {t: 'res', id, r: result ?? null};
}

/** An error frame. */
export function errorFrame(id: number, error: ApiError): ApiFrame {
    return {t: 'err', id, e: error};
}

function bufferToString(data: unknown): string | undefined {
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString('utf8');
    }
    if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    }
    if (Array.isArray(data) && data.every((entry) => Buffer.isBuffer(entry))) {
        return Buffer.concat(data).toString('utf8');
    }
    return undefined;
}
