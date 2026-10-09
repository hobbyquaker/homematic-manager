/**
 * B-91 (#169): macOS's Local Network privacy.
 *
 * Since macOS 15 an app needs the user's permission for every connection into the local network
 * (Apple's TN3179). Without it the kernel refuses the connection before a packet leaves the Mac,
 * and Node reports `EHOSTUNREACH` ("no route to host") for every address in the LAN - which reads
 * like a network fault, not like a missing permission. occulite-client folds `EHOSTUNREACH` into
 * its `timeout`, so the connection test of an openccu-lite system says "(timeout)" for the same
 * cause.
 *
 * These helpers decide when the UI adds a hint naming the setting. Only on macOS (the Electron
 * host says `darwin`); the browser UI of `apps/web` and the CCU addon has no host and never shows
 * it. On every other platform nothing changes.
 */

/** The hint's catalogue key (de/en in `uiMessages.ts`). */
export const LOCAL_NETWORK_HINT =
    'macOS may be blocking the local network: allow Homematic Manager under System Settings → Privacy & Security → Local Network, then quit and restart it';

/** The OS errors macOS's Local Network privacy produces for a blocked connection. */
const BLOCKED_CODES = /\b(EHOSTUNREACH|EHOSTDOWN)\b/;

/** The connection test's reasons that a blocked connection ends in (occulite-client's words). */
const BLOCKED_REASONS: ReadonlySet<string> = new Set(['timeout', 'EHOSTUNREACH', 'EHOSTDOWN']);

/** True when a message (a toast, an interface error) names an error a blocked connection gives, on macOS. */
export function looksLikeLocalNetworkBlock(platform: string | undefined, message: string | undefined): boolean {
    return platform === 'darwin' && message !== undefined && BLOCKED_CODES.test(message);
}

/**
 * True when the connection test's "nothing answers" may be macOS blocking the connection: a
 * timeout or a host without a route, never a refused connection, a DNS failure or a certificate
 * (those got an answer, or never reached the network).
 */
export function testMayBeLocalNetworkBlock(platform: string | undefined, reason: string | undefined): boolean {
    return platform === 'darwin' && reason !== undefined && BLOCKED_REASONS.has(reason);
}
