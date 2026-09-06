/**
 * The `hmm-image://` scheme, so the UI can write `<img src={host.deviceImageUrl(type)}>` and be
 * done - no base64 through the API, no image bytes in the renderer's memory twice, and the
 * browser's own cache in front of ours.
 *
 * `protocol.handle()` wants a `Request` in and a `Response` out, both of which are standard web
 * objects in Electron's main process. That is what makes this testable without Electron: the
 * handler is a plain function and the test calls it with a URL.
 *
 * The scheme has to be declared privileged *before* the app is ready - `standard` so relative
 * resolution and the origin behave, `secure` so a page under a strict CSP may load it,
 * `supportFetchAPI` so the UI can also `fetch()` one, and `corsEnabled` because that fetch is a
 * cross-origin one however local it looks: the page is served from `file:` and the picture from
 * `hmm-image://device`, which are two origins, and Chromium refuses a cross-origin fetch of a
 * scheme that is not CORS-enabled with the same bare "Failed to fetch" it gives a blocked network
 * request. The handler answers with `access-control-allow-origin: *`, which is as wide as this
 * scheme goes: it exists only inside this app's session, and nothing outside it can ask.
 */

import {deviceTypeFromImageUrl, IMAGE_SCHEME} from '../shared/ipc.js';

import type {DeviceImageService} from './images.js';

/** What `protocol.registerSchemesAsPrivileged()` is given, before `app.whenReady()`. */
export const PRIVILEGED_SCHEMES = [
    {
        scheme: IMAGE_SCHEME,
        privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: false},
    },
] as const;

/**
 * The handler for {@link IMAGE_SCHEME}. Answers with the image, a 404 when no device type has one,
 * or a 400 for a URL that is not `hmm-image://device/<type>`.
 */
export function createImageProtocolHandler(images: DeviceImageService): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        const deviceType = deviceTypeFromImageUrl(request.url);
        if (deviceType === undefined) {
            return new Response('not an image URL', {
                status: 400,
                headers: {'content-type': 'text/plain', 'access-control-allow-origin': '*'},
            });
        }
        const image = await images.get(deviceType);
        if (image === undefined) {
            return new Response('no image for this device type', {
                status: 404,
                headers: {'content-type': 'text/plain', 'access-control-allow-origin': '*'},
            });
        }
        return new Response(new Uint8Array(image.body), {
            status: 200,
            headers: {
                'content-type': image.mime,
                // See `PRIVILEGED_SCHEMES`: `hmm-image://device` is a different origin from the
                // `file:` page, so a `fetch()` of it needs this even though nothing leaves the app.
                'access-control-allow-origin': '*',
                // The picture of a device type does not change while the app runs, and a fetched
                // one is on disk anyway; letting the renderer keep it saves the round trip.
                'cache-control': 'private, max-age=86400',
            },
        });
    };
}

/**
 * The Content-Security-Policy the renderer is served under.
 *
 * `default-src 'self'` and no `unsafe-eval`: nothing may load or run code from anywhere but the
 * bundle. `style-src` needs `'unsafe-inline'` because Svelte writes inline styles for its
 * transitions, `img-src` needs the image scheme and `data:` for the inline SVG icons, and
 * `connect-src` is there so that a mistake in the UI cannot phone home - everything it needs comes
 * over IPC, which no CSP covers.
 *
 * `connect-src` carries the image scheme as well. It is served by `protocol.handle` in this
 * process, it is declared `supportFetchAPI` two blocks up, and `'self'` alone made that
 * declaration a lie: `fetch('hmm-image://device/...')` failed with a bare "Failed to fetch", which
 * is what assertion 6 of the smoke test hit on all three runners. A request that never leaves the
 * process is not the kind of connection this directive exists to stop.
 */
export const RENDERER_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${IMAGE_SCHEME}:`,
    "font-src 'self' data:",
    `connect-src 'self' ${IMAGE_SCHEME}:`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');
