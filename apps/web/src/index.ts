/**
 * `@homematic-manager/web` - the backend as a local HTTP + WebSocket server serving the built UI.
 *
 * Three jobs, one process: development with hot reload, the fast e2e target of task 14 (a browser
 * and hm-simulator, no Electron), and the process the CCU addon of task 13 runs behind lighttpd.
 * What makes the third one work is the base path and the token: the same build serves at `/` and
 * under `/addons/hmm/`, and a client without a token never reaches the socket.
 *
 * See `README.md` for the options, the auth mechanism and how the addon mounts this.
 */

/** Name of this package; the workspace smoke tests use it. */
export const PACKAGE = '@homematic-manager/web';

export * from './server.js';
export * from './options.js';
export * from './auth.js';
export * from './images.js';
export * from './static.js';
export * from './proxy.js';
export * from './paths.js';
export * from './log.js';
export * from './cli.js';
export * from './install.js';
export * from './testSupport.js';
