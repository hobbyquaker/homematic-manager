import {describe, expect, it} from 'vitest';

import {
    DEFAULT_INTERFACES,
    DEFAULT_PING_TIMEOUT_SECONDS,
    INTERFACE_NAMES,
    INTERFACES,
    interfaceDefinition,
    interfaceIdent,
    interfaceNameFromIdent,
    interfacePort,
    interfaceProtocol,
    isKnownInterface,
    type InterfaceDefinition,
    REGA_LOCAL_PORT,
    REGA_PORT,
    REGA_TLS_PORT,
    regaPort,
    resolveInterface,
    resolveUserDefinedInterface,
    validateUserDefinedInterface,
} from './table.js';

describe('the interface table', () => {
    it('lists the five interfaces the CCU offers, in table order', () => {
        expect(INTERFACE_NAMES).toEqual(['BidCos-RF', 'BidCos-Wired', 'HmIP-RF', 'VirtualDevices', 'CUxD']);
    });

    it('subscribes to everything but CUxD by default', () => {
        expect(DEFAULT_INTERFACES).toEqual(['BidCos-RF', 'HmIP-RF', 'VirtualDevices', 'BidCos-Wired']);
    });

    it('names every definition after its key', () => {
        for (const name of INTERFACE_NAMES) {
            expect(INTERFACES[name].name).toBe(name);
        }
    });

    it('puts the TLS port 40000 above the plain one', () => {
        for (const name of INTERFACE_NAMES) {
            const definition: InterfaceDefinition = INTERFACES[name];
            if (definition.tlsPort !== undefined) {
                expect(definition.tlsPort).toBe(definition.port + 40000);
            }
        }
    });

    it('knows built-in names and rejects others', () => {
        expect(isKnownInterface('HmIP-RF')).toBe(true);
        expect(isKnownInterface('Homegear')).toBe(false);
        // not fooled by prototype properties
        expect(isKnownInterface('toString')).toBe(false);
    });

    it('returns a definition only for known names', () => {
        expect(interfaceDefinition('CUxD')?.port).toBe(8701);
        expect(interfaceDefinition('nope')).toBeUndefined();
    });
});

describe('interface identity strings', () => {
    it('prefixes every interface but CUxD with hmm_', () => {
        expect(interfaceIdent('BidCos-RF')).toBe('hmm_BidCos-RF');
        expect(interfaceIdent('HmIP-RF')).toBe('hmm_HmIP-RF');
        expect(interfaceIdent('CUxD')).toBe('CUxD');
    });

    it('uses hmm_ for user-defined names too', () => {
        expect(interfaceIdent('my-rfd')).toBe('hmm_my-rfd');
    });

    it('maps an identity back to its interface', () => {
        expect(interfaceNameFromIdent('hmm_BidCos-Wired')).toBe('BidCos-Wired');
        expect(interfaceNameFromIdent('CUxD')).toBe('CUxD');
        expect(interfaceNameFromIdent('hmm_my-rfd')).toBe('my-rfd');
    });

    it('rejects an identity that is not ours', () => {
        expect(interfaceNameFromIdent('hm2mqtt')).toBeUndefined();
        expect(interfaceNameFromIdent('hmm_')).toBeUndefined();
    });
});

describe('port and protocol resolution', () => {
    it('uses the public port by default', () => {
        expect(interfacePort(INTERFACES['BidCos-RF'])).toBe(2001);
        expect(interfaceProtocol(INTERFACES['BidCos-RF'])).toBe('xmlrpc');
    });

    it('adds 40000 for TLS', () => {
        expect(interfacePort(INTERFACES['HmIP-RF'], {tls: true})).toBe(42010);
    });

    it('prefers the process port over TLS when running on the CCU', () => {
        expect(interfacePort(INTERFACES['BidCos-RF'], {local: true, tls: true})).toBe(32001);
        expect(interfaceProtocol(INTERFACES['BidCos-RF'], {local: true, tls: true})).toBe('binrpc');
    });

    it('keeps the public port for an interface without a process port', () => {
        expect(interfacePort(INTERFACES.CUxD, {local: true})).toBe(8701);
        expect(interfacePort(INTERFACES.CUxD, {tls: true})).toBe(8701);
    });

    it('speaks xmlrpc to hmipserver even on the process port', () => {
        expect(interfaceProtocol(INTERFACES['HmIP-RF'], {local: true})).toBe('xmlrpc');
    });

    it('speaks binrpc to CUxD always', () => {
        expect(interfaceProtocol(INTERFACES.CUxD, {tls: true, local: true})).toBe('binrpc');
    });

    it('never speaks binrpc to a public port: those are lighttpd XML-RPC proxies (D-28)', () => {
        expect(interfaceProtocol(INTERFACES['BidCos-RF'])).toBe('xmlrpc');
        expect(interfaceProtocol(INTERFACES['BidCos-RF'], {tls: true})).toBe('xmlrpc');
        expect(interfaceProtocol(INTERFACES['BidCos-Wired'])).toBe('xmlrpc');
        expect(interfaceProtocol(INTERFACES['HmIP-RF'])).toBe('xmlrpc');
    });
});

describe('resolveInterface', () => {
    it('resolves BidCos-RF for a remote CCU', () => {
        expect(resolveInterface('BidCos-RF')).toEqual({
            name: 'BidCos-RF',
            port: 2001,
            protocol: 'xmlrpc',
            path: '/',
            tls: false,
            init: true,
            ident: 'hmm_BidCos-RF',
            ping: true,
            pingTimeoutSeconds: 60,
            dutyCycle: true,
        });
    });

    it('gives HmIP-RF the 600 s ping timeout, TLS keeps it', () => {
        const resolved = resolveInterface('HmIP-RF', {tls: true});
        expect(resolved.port).toBe(42010);
        expect(resolved.tls).toBe(true);
        expect(resolved.pingTimeoutSeconds).toBe(600);
        expect(resolved.dutyCycle).toBe(true);
    });

    it('keeps the /groups path and the missing ping of VirtualDevices', () => {
        const resolved = resolveInterface('VirtualDevices');
        expect(resolved.path).toBe('/groups');
        expect(resolved.ping).toBe(false);
        expect(resolved.dutyCycle).toBe(false);
        expect(resolved.pingTimeoutSeconds).toBe(DEFAULT_PING_TIMEOUT_SECONDS);
    });

    it('drops TLS when talking to the process directly', () => {
        const resolved = resolveInterface('BidCos-Wired', {local: true, tls: true});
        expect(resolved).toMatchObject({port: 32000, protocol: 'binrpc', tls: false});
    });

    it('reports TLS as off for an interface that has no TLS port', () => {
        expect(resolveInterface('CUxD', {tls: true}).tls).toBe(false);
    });

    it('throws for an unknown interface and says which ones exist', () => {
        expect(() => resolveInterface('Homegear')).toThrow(/unknown interface "Homegear".*BidCos-RF/s);
    });
});

describe('user-defined interfaces (D-13)', () => {
    it('takes host, port, protocol and path as configured', () => {
        expect(
            resolveUserDefinedInterface({
                name: 'second-rfd',
                host: '10.0.0.9',
                port: 2001,
                protocol: 'binrpc',
                path: '/rfd',
                tls: true,
            }),
        ).toEqual({
            name: 'second-rfd',
            port: 2001,
            protocol: 'binrpc',
            path: '/rfd',
            tls: true,
            init: true,
            ident: 'hmm_second-rfd',
            ping: true,
            pingTimeoutSeconds: 60,
            dutyCycle: false,
        });
    });

    it('defaults path to / and TLS to off', () => {
        const resolved = resolveUserDefinedInterface({
            name: 'x',
            host: 'ccu',
            port: 1234,
            protocol: 'xmlrpc',
        });
        expect(resolved.path).toBe('/');
        expect(resolved.tls).toBe(false);
    });

    it('accepts a complete definition', () => {
        expect(validateUserDefinedInterface({name: 'extra', host: 'ccu', port: 2001, protocol: 'xmlrpc'})).toEqual([]);
    });

    it('rejects an empty name, an empty host and an impossible port', () => {
        expect(validateUserDefinedInterface({name: '  ', host: '', port: 0, protocol: 'xmlrpc'})).toEqual([
            {code: 'empty-name'},
            {code: 'empty-host'},
            {code: 'invalid-port', port: 0},
        ]);
    });

    it('rejects a name that shadows a built-in interface', () => {
        expect(validateUserDefinedInterface({name: 'CUxD', host: 'ccu', port: 8701, protocol: 'binrpc'})).toEqual([
            {code: 'reserved-name', name: 'CUxD'},
        ]);
    });

    it('rejects a port above the range and a non-integer port', () => {
        expect(validateUserDefinedInterface({name: 'a', host: 'h', port: 70000, protocol: 'xmlrpc'})).toEqual([
            {code: 'invalid-port', port: 70000},
        ]);
        expect(validateUserDefinedInterface({name: 'a', host: 'h', port: 1.5, protocol: 'xmlrpc'})).toEqual([
            {code: 'invalid-port', port: 1.5},
        ]);
    });
});

describe('regaPort', () => {
    it('is 8181 through lighttpd, 48181 with TLS and 8183 on the CCU itself', () => {
        expect(regaPort()).toBe(REGA_PORT);
        expect(regaPort({tls: true})).toBe(REGA_TLS_PORT);
        expect(regaPort({local: true})).toBe(REGA_LOCAL_PORT);
        expect(regaPort({local: true, tls: true})).toBe(REGA_LOCAL_PORT);
    });
});
