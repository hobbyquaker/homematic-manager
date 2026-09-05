/**
 * Ambient declarations for the two RPC libraries and the ReGa client, none of which ships types.
 *
 * They cover exactly what `rpc/client.ts`, `rpc/server.ts` and `rega/client.ts` use - not the whole
 * surface - so a change in one of the packages shows up as a compile error here rather than as a
 * runtime surprise. `binrpc` ships an `index.d.ts` of its own and is not declared here.
 */

declare module 'homematic-xmlrpc' {
    type XmlRpcValue = boolean | number | string | XmlRpcValue[] | {[key: string]: XmlRpcValue};

    interface ClientOptions {
        host?: string;
        port?: number;
        path?: string;
        url?: string;
        headers?: Record<string, string>;
        basic_auth?: {user: string; pass: string};
        /**
         * Node encoding the response stream is read with. The interface processes answer in
         * ISO-8859-1, so this is `latin1` for every client the backend creates; the library
         * defaults it to `utf8`, which is where the `°C` mojibake of 2.x came from.
         */
        responseEncoding?: string;
        /** Passed straight to `https.request`; a CCU's certificate is self-signed. */
        rejectUnauthorized?: boolean;
        cookies?: boolean;
    }

    interface ServerOptions {
        host?: string;
        port?: number;
        key?: string | Buffer;
        cert?: string | Buffer;
    }

    class Client {
        constructor(options: ClientOptions | string, isSecure?: boolean);
        options: ClientOptions;
        methodCall(
            method: string,
            params: XmlRpcValue[],
            callback: (error: Error | null | undefined, value?: XmlRpcValue) => void,
        ): void;
    }

    class Server {
        constructor(options: ServerOptions | string, isSecure?: boolean, onListening?: () => void);
        httpServer: import('node:http').Server;
        on(event: 'listening', listener: () => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'NotFound', listener: (method: string, params: XmlRpcValue[]) => void): this;
        on(
            event: string,
            listener: (
                error: null,
                params: XmlRpcValue[],
                callback: (error: Error | null, value?: XmlRpcValue) => void,
            ) => void,
        ): this;
        close(callback?: () => void): Promise<void>;
    }

    export function createClient(options: ClientOptions | string): Client;
    export function createSecureClient(options: ClientOptions | string): Client;
    export function createServer(options: ServerOptions | string, onListening?: () => void): Server;
    export function createSecureServer(options: ServerOptions | string, onListening?: () => void): Server;
}

declare module 'homematic-rega' {
    export interface RegaOptions {
        host: string;
        port?: number;
        tls?: boolean;
        insecure?: boolean;
        username?: string | undefined;
        password?: string | undefined;
        language?: string;
        translate?: boolean;
        timeout?: number;
        timeZone?: string;
    }

    export interface RegaChannel {
        id: number;
        address: string;
        name: string;
    }

    export class Rega {
        constructor(options: RegaOptions);
        host: string;
        port: number;
        url: string;
        exec(script: string): Promise<{output: string; objects: Record<string, string>}>;
        getChannels(): Promise<RegaChannel[]>;
    }

    export default Rega;
}
