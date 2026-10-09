import {describe, expect, it} from 'vitest';

import {stubHost as host} from '../../testHarness.js';
import {MockTransport} from '../transport/MockTransport.js';
import {LOCAL_NETWORK_HINT} from '../util/localNetwork.js';

import {NoticesStore} from './NoticesStore.svelte.js';
import {createStores} from './Stores.svelte.js';

/** B-91 (#169): the Local Network hint on macOS, once per session, after the notice that called for it. */

const BLOCKED = 'BidCos-RF: init failed: connect EHOSTUNREACH 192.168.131.9:42001';

describe('NoticesStore: hintFor (B-91)', () => {
    it('adds the hint once, after the first warning or error that calls for it', () => {
        const transport = new MockTransport();
        const asked: string[] = [];
        const notices = new NoticesStore(transport, {
            hintFor: (message) => {
                asked.push(message);
                return message.includes('EHOSTUNREACH') ? 'the hint' : undefined;
            },
        });
        transport.emit('notice', {level: 'info', message: 'EHOSTUNREACH in an info'});
        expect(notices.items.map((notice) => notice.message)).toEqual(['EHOSTUNREACH in an info']);
        expect(asked).toEqual([]);

        transport.emit('notice', {level: 'warn', message: BLOCKED, interfaceName: 'BidCos-RF'});
        transport.emit('notice', {level: 'error', message: 'HmIP-RF: connect EHOSTUNREACH 192.168.131.9:42010'});
        notices.fromError(new Error('connect EHOSTUNREACH 192.168.131.9:2001'), 'connection.test');
        expect(notices.items.map((notice) => notice.message)).toEqual([
            'EHOSTUNREACH in an info',
            BLOCKED,
            'the hint',
            'HmIP-RF: connect EHOSTUNREACH 192.168.131.9:42010',
            'connection.test: connect EHOSTUNREACH 192.168.131.9:2001',
        ]);
        // an error: it stays until it is dismissed, and dismissing it does not bring it back
        const hint = notices.items.find((notice) => notice.message === 'the hint')!;
        expect(hint.level).toBe('error');
        notices.dismiss(hint.id);
        transport.emit('notice', {level: 'warn', message: BLOCKED});
        expect(notices.items.filter((notice) => notice.message === 'the hint')).toEqual([]);
        notices.dispose();
    });

    it('adds nothing without hintFor', () => {
        const transport = new MockTransport();
        const notices = new NoticesStore(transport);
        transport.emit('notice', {level: 'warn', message: BLOCKED});
        expect(notices.items.map((notice) => notice.message)).toEqual([BLOCKED]);
        notices.dispose();
    });
});

describe('Stores: the Local Network hint (B-91)', () => {
    it('on macOS, in the UI language', async () => {
        const transport = new MockTransport();
        const stores = createStores(transport, {hostBridge: host('darwin')});
        await stores.host.load();
        stores.i18n.language = 'de';
        transport.emit('notice', {level: 'warn', message: BLOCKED, interfaceName: 'BidCos-RF'});
        expect(stores.notices.items.map((notice) => notice.message)).toEqual([
            BLOCKED,
            'macOS blockiert womöglich das lokale Netzwerk: Homematic Manager unter Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk erlauben, dann die App beenden und neu starten',
        ]);

        const english = createStores(new MockTransport(), {hostBridge: host('darwin')});
        await english.host.load();
        english.i18n.language = 'en';
        english.notices.push('error', 'connect EHOSTDOWN 10.0.0.9:2001');
        expect(english.notices.items.map((notice) => notice.message)).toEqual([
            'connect EHOSTDOWN 10.0.0.9:2001',
            LOCAL_NETWORK_HINT,
        ]);
    });

    it.each(['linux', 'win32'])('not on %s', async (platform) => {
        const transport = new MockTransport();
        const stores = createStores(transport, {hostBridge: host(platform)});
        await stores.host.load();
        transport.emit('notice', {level: 'warn', message: BLOCKED});
        expect(stores.notices.items.map((notice) => notice.message)).toEqual([BLOCKED]);
    });

    it('not without a host (apps/web, the CCU addon)', () => {
        const transport = new MockTransport();
        const stores = createStores(transport, {hostScope: {}});
        transport.emit('notice', {level: 'warn', message: BLOCKED});
        expect(stores.notices.items.map((notice) => notice.message)).toEqual([BLOCKED]);
    });

    it('not for a refused connection on macOS', async () => {
        const transport = new MockTransport();
        const stores = createStores(transport, {hostBridge: host('darwin')});
        await stores.host.load();
        transport.emit('notice', {level: 'warn', message: 'connect ECONNREFUSED 192.168.131.9:2001'});
        expect(stores.notices.items).toHaveLength(1);
    });
});
