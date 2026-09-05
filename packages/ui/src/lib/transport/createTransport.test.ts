import {afterEach, describe, expect, it, vi} from 'vitest';

import {apiUrl, createTransport, HOST_TRANSPORT_GLOBAL, isDemoRequested} from './createTransport.js';
import {MockTransport} from './MockTransport.js';
import {WebSocketTransport} from './WebSocketTransport.js';

const at = (pathname: string, search = '', protocol = 'http:', host = 'ccu:8080') => ({
    protocol,
    host,
    pathname,
    search,
});

describe('apiUrl', () => {
    it('appends the endpoint to the directory of the page', () => {
        expect(apiUrl(at('/'))).toBe('ws://ccu:8080/api');
        expect(apiUrl(at('/index.html'))).toBe('ws://ccu:8080/api');
        expect(apiUrl(at('/addons/hmm/'))).toBe('ws://ccu:8080/addons/hmm/api');
        expect(apiUrl(at('/addons/hmm/index.html'))).toBe('ws://ccu:8080/addons/hmm/api');
    });

    it('uses wss for an https page and honours a custom path', () => {
        expect(apiUrl(at('/', '', 'https:'), 'socket')).toBe('wss://ccu:8080/socket');
    });
});

describe('isDemoRequested', () => {
    it('sees ?demo in the query string', () => {
        expect(isDemoRequested(at('/', '?demo'))).toBe(true);
        expect(isDemoRequested(at('/', '?demo=1&lang=en'))).toBe(true);
        expect(isDemoRequested(at('/', '?lang=en'))).toBe(false);
        expect(isDemoRequested(undefined)).toBe(false);
    });
});

describe('createTransport', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('prefers a transport the host injected', () => {
        const injected = new MockTransport();
        const host = {[HOST_TRANSPORT_GLOBAL]: injected};
        expect(createTransport({host, location: at('/')})).toBe(injected);
    });

    it('ignores a global that is not a transport', () => {
        const host = {[HOST_TRANSPORT_GLOBAL]: {request: 'nope'}};
        expect(createTransport({host, location: at('/')})).toBeInstanceOf(WebSocketTransport);
        expect(createTransport({host: {}, location: at('/')})).toBeInstanceOf(WebSocketTransport);
    });

    it('returns the demo transport for ?demo and for the explicit option', async () => {
        const fromUrl = createTransport({host: {}, location: at('/', '?demo')});
        expect(fromUrl).toBeInstanceOf(MockTransport);
        await expect(fromUrl.request('config.get')).resolves.toMatchObject({connection: {host: 'demo.local'}});

        expect(createTransport({host: {}, location: at('/'), demo: true})).toBeInstanceOf(MockTransport);
    });

    it('returns the demo transport when the bundle was built with VITE_HMM_DEMO', () => {
        vi.stubEnv('VITE_HMM_DEMO', 'true');
        expect(createTransport({host: {}, location: at('/')})).toBeInstanceOf(MockTransport);
    });

    it('builds a WebSocket transport for the page location', () => {
        const transport = createTransport({host: {}, location: at('/addons/hmm/index.html')});
        expect(transport).toBeInstanceOf(WebSocketTransport);
        expect((transport as WebSocketTransport).url).toBe('ws://ccu:8080/addons/hmm/api');
        (transport as WebSocketTransport).close();
    });

    it('falls back to window.location when none is given', () => {
        const transport = createTransport({host: {}});
        expect(transport).toBeInstanceOf(WebSocketTransport);
        expect((transport as WebSocketTransport).url).toMatch(/^ws:\/\//);
        (transport as WebSocketTransport).close();
    });
});
