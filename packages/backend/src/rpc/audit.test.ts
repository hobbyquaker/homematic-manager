/**
 * Task 48: the one place an RPC call can leave the backend.
 *
 * The RPC log hangs off `RpcClient.call`, so every outgoing call is only in the log if every
 * outgoing call goes through that class. This pins the audit of 2026-09-15: the two RPC libraries
 * are imported by `rpc/client.ts` (sending) and `rpc/server.ts` (the callback servers, receiving)
 * and by nothing else, and only the interface manager constructs a client. A new module that
 * talks to an interface on its own fails here before it can bypass the log.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function sourceFiles(dir: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...(await sourceFiles(file)));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
            found.push(file);
        }
    }
    return found;
}

async function filesMatching(pattern: RegExp): Promise<string[]> {
    const matches: string[] = [];
    for (const file of await sourceFiles(SRC)) {
        if (pattern.test(await fs.readFile(file, 'utf8'))) {
            matches.push(path.relative(SRC, file).replaceAll(path.sep, '/'));
        }
    }
    return matches.sort();
}

describe('the RPC audit (task 48)', () => {
    it('imports the RPC libraries in the client and the callback server only', async () => {
        expect(await filesMatching(/from '(binrpc|homematic-xmlrpc)'/)).toEqual(['rpc/client.ts', 'rpc/server.ts']);
    });

    it('constructs an RpcClient in the interface manager only', async () => {
        expect(await filesMatching(/new RpcClient\(/)).toEqual(['interfaces/manager.ts']);
    });
});
