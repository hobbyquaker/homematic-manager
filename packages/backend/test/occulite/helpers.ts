/**
 * A real `occulited` in a temporary directory, for the integration test of the `occulite` provider.
 *
 * The unit tests use a fake server and prove that the client speaks the protocol the specification
 * describes. This proves that the specification is what `occulited` actually does - which is the
 * whole point of openccu-lite's D-16, and the only way to find the difference between "the document
 * says" and "the box answers" before a user does.
 *
 * The binary is not built here and is never downloaded: `OCCULITED_BINARY` names one, and without it
 * the suite skips itself the way the hm-simulator suites do. Build it with
 *
 * ```sh
 * cd ~/repos/openccu-lite && go build -o /tmp/occulited ./cmd/occulited
 * OCCULITED_BINARY=/tmp/occulited npm test -w @homematic-manager/backend
 * ```
 *
 * Everything it touches is a temporary directory: `--root` (a fake `/` with a `/VERSION` in it),
 * `--state-dir` and `--session-dir`. It never runs a privileged operation in this mode and it is
 * bound to the loopback on a port the operating system picked.
 */

import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/** The binary, or `undefined` when the environment does not name one that exists. */
export const OCCULITED = process.env['OCCULITED_BINARY'];

export const SKIP_MESSAGE =
    'occulited is not available - build it from the openccu-lite checkout and set OCCULITED_BINARY';

/** `OCCULITED_REQUIRED=1` turns the skip into a failure, for a run that must not silently pass. */
export function occulitedRequired(): boolean {
    return process.env['OCCULITED_REQUIRED'] === '1';
}

export interface OcculiteBox {
    readonly baseUrl: string;
    /** The administrator's session id, as the box's shell would hand it to an addon page. */
    readonly sid: string;
    /** The read-only token the box writes for programs running on it. */
    readonly localToken: string;
    /** The file that token is in, so the provider can be pointed at it. */
    readonly localTokenFile: string;
    request(method: string, path: string, body?: unknown, credential?: string): Promise<Response>;
    json(method: string, path: string, body?: unknown, credential?: string): Promise<unknown>;
    stop(): Promise<void>;
}

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            server.close(() => {
                resolve(port);
            });
        });
    });
}

/** Starts a box, creates the first administrator, and answers with everything a test needs. */
export async function startOcculite(): Promise<OcculiteBox> {
    if (OCCULITED === undefined || OCCULITED === '') {
        throw new Error(SKIP_MESSAGE);
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-occulite-'));
    const root = path.join(dir, 'root');
    const state = path.join(dir, 'state');
    const sessions = path.join(dir, 'sessions');
    await fs.mkdir(root, {recursive: true});
    await fs.mkdir(state, {recursive: true});
    await fs.mkdir(sessions, {recursive: true});
    // the firmware's own file, with the extra line openccu-lite identifies itself by (their D-17)
    await fs.writeFile(
        path.join(root, 'VERSION'),
        'VERSION=3.89.8.20260719\nPRODUCT=ova\nPLATFORM=ova\nVARIANT=lite\n',
    );

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${String(port)}`;
    const child: ChildProcess = spawn(
        OCCULITED,
        [
            '--root',
            root,
            '--state-dir',
            state,
            '--session-dir',
            sessions,
            '--listen',
            `127.0.0.1:${String(port)}`,
            '--log',
            'stderr',
        ],
        {stdio: ['ignore', 'pipe', 'pipe']},
    );
    const log: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => log.push(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => log.push(chunk.toString()));

    const stop = async (): Promise<void> => {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                resolve();
            }, 3000);
            child.on('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
        await fs.rm(dir, {recursive: true, force: true});
    };

    // wait for the version endpoint, which is the one call that needs no credential
    const deadline = Date.now() + 15_000;
    for (;;) {
        try {
            const response = await fetch(`${baseUrl}/api/meta/v1/version`, {signal: AbortSignal.timeout(1000)});
            if (response.ok) {
                break;
            }
        } catch {
            // not up yet
        }
        if (Date.now() > deadline) {
            await stop();
            throw new Error(`occulited did not come up on ${baseUrl}:\n${log.join('')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const request = async (method: string, apiPath: string, body?: unknown, credential?: string): Promise<Response> =>
        fetch(`${baseUrl}${apiPath}`, {
            method,
            signal: AbortSignal.timeout(10_000),
            headers: {
                'Content-Type': 'application/json',
                ...(credential === undefined ? {} : {Authorization: `Bearer ${credential}`}),
            },
            ...(method === 'GET' ? {} : {body: JSON.stringify(body ?? {})}),
        });

    const setup = await request('POST', '/api/auth/v1/setup', {username: 'admin', password: 'hmm-integration-2026'});
    const account = (await setup.json()) as {sid?: string};
    if (typeof account.sid !== 'string') {
        await stop();
        throw new Error(`the first administrator could not be created: ${JSON.stringify(account)}`);
    }
    const localTokenFile = path.join(state, 'local-token');
    const localToken = (await fs.readFile(localTokenFile, 'utf8')).trim();

    return {
        baseUrl,
        sid: account.sid,
        localToken,
        localTokenFile,
        request,
        async json(method, apiPath, body, credential) {
            const response = await request(method, apiPath, body, credential ?? account.sid);
            return response.json() as Promise<unknown>;
        },
        stop,
    };
}
