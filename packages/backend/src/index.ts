/**
 * `@homematic-manager/backend` - the protocol and state layer of the Homematic Manager.
 *
 * Node only: XML-RPC and BIN-RPC clients and callback servers, the init/ping/re-init watchdog, the
 * caches with their per-CCU persistence, optional ReGa, UDP discovery, the paced write queue, and
 * one transport-agnostic API - `Backend`, which implements every method of `ApiMethods` and pushes
 * every event of `ApiEvents` from `@homematic-manager/core`.
 *
 * A host (Electron main in task 11, `apps/web` in task 12, the CCU addon in task 13) opens a
 * `Backend`, hands the UI an `InProcessTransport` or an `ApiWebSocketServer`, and does nothing else
 * with the CCU itself.
 */

/** Name of this package; the workspace smoke tests and the About dialog use it. */
export const PACKAGE = '@homematic-manager/backend';

// the API: what a host mounts
export * from './api/backend.js';
export * from './api/transport.js';
export * from './transport/codec.js';
export * from './transport/wsServer.js';

// configuration and the profile directory
export * from './config/defaults.js';
export * from './config/legacyImport.js';
export * from './config/store.js';

// the protocol layer
export * from './rpc/client.js';
export * from './rpc/server.js';
export * from './interfaces/manager.js';

// state
export * from './cache/devices.js';
export * from './cache/descriptions.js';
export * from './cache/names.js';
export * from './cache/store.js';

// the write path (task 6)
export * from './write/queue.js';
export * from './write/log.js';
export * from './write/paramset.js';

// the optional and the peripheral
export * from './rega/client.js';
export * from './discovery/discover.js';
export * from './devices/installMode.js';
export * from './images/deviceImages.js';
export * from './data/files.js';

// errors and small helpers a host needs
export * from './errors.js';
export * from './util/emitter.js';
export * from './util/net.js';
export * from './util/jsonFile.js';
