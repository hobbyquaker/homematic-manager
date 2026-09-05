import {describe, expect, it} from 'vitest';

import {
    DEFAULT_WRITE_PACE_MS,
    defaultConnection,
    interfaceTargets,
    normaliseConnection,
    validateConnection,
    writePaceFor,
} from './defaults.js';

describe('defaultConnection', () => {
    it('is the four default interfaces, ReGa on, nothing configured', () => {
        const connection = defaultConnection();
        expect(connection.host).toBe('');
        expect(connection.interfaces).toEqual(['BidCos-RF', 'HmIP-RF', 'VirtualDevices', 'BidCos-Wired']);
        expect(connection.rega).toBe(true);
        expect(connection.autoDetect).toBe(true);
        expect(connection.callback).toEqual({ip: '', xmlrpcPort: 0, binrpcPort: 0});
        expect(connection.writePaceMs).toBe(DEFAULT_WRITE_PACE_MS);
        expect(connection.auth).toBeUndefined();
    });
});

describe('writePaceFor', () => {
    it('doubles the pace for HmIP and keeps it everywhere else', () => {
        expect(writePaceFor('BidCos-RF', 200)).toBe(200);
        expect(writePaceFor('HmIP-RF', 200)).toBe(400);
    });

    it('falls back to the default for nonsense', () => {
        expect(writePaceFor('BidCos-RF', Number.NaN)).toBe(DEFAULT_WRITE_PACE_MS);
        expect(writePaceFor('BidCos-RF', -5)).toBe(DEFAULT_WRITE_PACE_MS);
    });
});

describe('normaliseConnection', () => {
    it('fills a partial object with the defaults', () => {
        const connection = normaliseConnection({host: ' ccu.lan ', tls: true});
        expect(connection.host).toBe('ccu.lan');
        expect(connection.tls).toBe(true);
        expect(connection.language).toBe('de');
        expect(connection.interfaces).toEqual(defaultConnection().interfaces);
    });

    it('returns the defaults for anything that is not an object', () => {
        expect(normaliseConnection(undefined)).toEqual(defaultConnection());
        expect(normaliseConnection('nope')).toEqual(defaultConnection());
    });

    it('drops interface names nothing knows and de-duplicates the rest', () => {
        const connection = normaliseConnection({interfaces: ['BidCos-RF', 'BidCos-RF', 'Wireless', 42]});
        expect(connection.interfaces).toEqual(['BidCos-RF']);
    });

    it('keeps a user-defined interface and lets it be selected', () => {
        const extra = {name: 'CCU-Jack', host: '10.0.0.5', port: 2121, protocol: 'xmlrpc'};
        const connection = normaliseConnection({interfaces: ['CCU-Jack'], extraInterfaces: [extra, {name: 'broken'}]});
        expect(connection.extraInterfaces).toEqual([extra]);
        expect(connection.interfaces).toEqual(['CCU-Jack']);
    });

    it('repairs invalid ports, paces and languages', () => {
        const connection = normaliseConnection({
            callback: {ip: ' 192.168.1.5 ', xmlrpcPort: 70_000, binrpcPort: 2042},
            writePaceMs: 'fast',
            language: 'kl',
        });
        expect(connection.callback).toEqual({ip: '192.168.1.5', xmlrpcPort: 0, binrpcPort: 2042});
        expect(connection.writePaceMs).toBe(DEFAULT_WRITE_PACE_MS);
        expect(connection.language).toBe('de');
    });

    it('keeps auth only when there is a user', () => {
        expect(normaliseConnection({auth: {user: 'Admin', password: 'secret'}}).auth).toEqual({
            user: 'Admin',
            password: 'secret',
        });
        expect(normaliseConnection({auth: {user: 'Admin'}}).auth).toEqual({user: 'Admin', password: ''});
        expect(normaliseConnection({auth: {user: ''}}).auth).toBeUndefined();
        expect(normaliseConnection({auth: 'yes'}).auth).toBeUndefined();
    });

    it('keeps an explicitly empty interface list out of the way of the defaults', () => {
        expect(normaliseConnection({interfaces: []}).interfaces).toEqual(defaultConnection().interfaces);
    });
});

describe('validateConnection', () => {
    it('accepts a configured connection', () => {
        expect(validateConnection(normaliseConnection({host: 'ccu.lan'}))).toEqual([]);
    });

    it('complains about a missing host and no interfaces', () => {
        const connection = {...defaultConnection(), interfaces: []};
        expect(validateConnection(connection)).toEqual(['no CCU address configured', 'no interface selected']);
    });

    it('reports every problem of a user-defined interface', () => {
        const connection = {
            ...defaultConnection(),
            host: 'ccu.lan',
            interfaces: ['Jack'],
            extraInterfaces: [
                {name: '', host: '', port: 0, protocol: 'xmlrpc' as const},
                {name: 'HmIP-RF', host: 'x', port: 1, protocol: 'xmlrpc' as const},
                {name: 'Jack', host: 'x', port: 1, protocol: 'xmlrpc' as const},
                {name: 'Jack', host: 'x', port: 1, protocol: 'xmlrpc' as const},
            ],
        };
        expect(validateConnection(connection)).toEqual([
            'an extra interface has no name',
            'extra interface "" has no host',
            'extra interface "" has an invalid port 0',
            '"HmIP-RF" is the name of a built-in interface',
            'extra interface "Jack" is defined twice',
        ]);
    });

    it('reports an interface name that nothing defines', () => {
        const connection = {...defaultConnection(), host: 'ccu.lan', interfaces: ['Wireless']};
        expect(validateConnection(connection)).toEqual(['unknown interface "Wireless"']);
    });

    it('reports two identical callback ports, but not two zeros', () => {
        const base = {...defaultConnection(), host: 'ccu.lan'};
        expect(validateConnection({...base, callback: {ip: '', xmlrpcPort: 2042, binrpcPort: 2042}})).toEqual([
            'the xmlrpc and binrpc callback ports must differ',
        ]);
        expect(validateConnection(base)).toEqual([]);
    });
});

describe('interfaceTargets', () => {
    it('resolves the built-in interfaces against the core table', () => {
        const connection = normaliseConnection({host: 'ccu.lan', interfaces: ['BidCos-RF', 'HmIP-RF', 'CUxD']});
        const targets = interfaceTargets(connection);
        expect(targets.map((target) => [target.resolved.name, target.resolved.port, target.resolved.protocol])).toEqual(
            [
                ['BidCos-RF', 2001, 'xmlrpc'],
                ['HmIP-RF', 2010, 'xmlrpc'],
                ['CUxD', 8701, 'binrpc'],
            ],
        );
        expect(targets.every((target) => target.host === 'ccu.lan')).toBe(true);
    });

    it('uses the TLS ports and leaves CUxD alone', () => {
        const connection = normaliseConnection({host: 'ccu', tls: true, interfaces: ['HmIP-RF', 'CUxD']});
        const targets = interfaceTargets(connection);
        expect(targets[0]?.resolved.port).toBe(42_010);
        expect(targets[0]?.resolved.tls).toBe(true);
        expect(targets[1]?.resolved.port).toBe(8701);
        expect(targets[1]?.resolved.tls).toBe(false);
    });

    it('takes a user-defined interface with its own host and auth', () => {
        const connection = normaliseConnection({
            host: 'ccu',
            interfaces: ['Jack', 'HmIP-RF'],
            auth: {user: 'a', password: 'b'},
            extraInterfaces: [
                {name: 'Jack', host: '10.0.0.9', port: 2121, protocol: 'binrpc', auth: {user: 'j', password: 'k'}},
            ],
        });
        const targets = interfaceTargets(connection);
        expect(targets[0]?.host).toBe('10.0.0.9');
        expect(targets[0]?.auth).toEqual({user: 'j', password: 'k'});
        expect(targets[0]?.resolved.ident).toBe('hmm_Jack');
        expect(targets[1]?.auth).toEqual({user: 'a', password: 'b'});
    });

    it('falls back to the connection auth for an extra interface without its own', () => {
        const connection = normaliseConnection({
            host: 'ccu',
            interfaces: ['Jack'],
            auth: {user: 'a', password: 'b'},
            extraInterfaces: [{name: 'Jack', host: '10.0.0.9', port: 2121, protocol: 'binrpc'}],
        });
        expect(interfaceTargets(connection)[0]?.auth).toEqual({user: 'a', password: 'b'});
    });

    it('skips a name that is neither built in nor defined', () => {
        const connection = {...defaultConnection(), host: 'ccu', interfaces: ['Wireless']};
        expect(interfaceTargets(connection)).toEqual([]);
    });
});
