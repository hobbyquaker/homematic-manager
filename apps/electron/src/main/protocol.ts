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
 * resolution and the origin behave, `secure` so a page under a strict CSP may load it, and
 * `supportFetchAPI` so the UI could also `fetch()` one later.
 */

import {deviceTypeFromImageUrl, IMAGE_SCHEME} from '../shared/ipc.js';

import type {DeviceImageCache} from './images.js';

/** What `protocol.registerSchemesAsPrivileged()` is given, before `app.whenReady()`. */
export const PRIVILEGED_SCHEMES = [
    {
        scheme: IMAGE_SCHEME,
        privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: false},
    },
] as const;

/**
 * The handler for {@link IMAGE_SCHEME}. Answers with the image, a 404 when no device type has one,
 * or a 400 for a URL that is not `hmm-image://device/<type>`.
 */
export function createImageProtocolHandler(images: DeviceImageCache): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        const deviceType = deviceTypeFromImageUrl(request.url);
        if (deviceType === undefined) {
            return new Response('not an image URL', {status: 400, headers: {'content-type': 'text/plain'}});
        }
        const image = await images.get(deviceType);
        if (image === undefined) {
            return new Response('no image for this device type', {
                status: 404,
                headers: {'content-type': 'text/plain'},
            });
        }
        return new Response(new Uint8Array(image.body), {
            status: 200,
            headers: {
                'content-type': image.mime,
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
 * `connect-src 'self'` is there so that a mistake in the UI cannot phone home - everything it
 * needs comes over IPC, which no CSP covers.
 */
export const RENDERER_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${IMAGE_SCHEME}:`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');
