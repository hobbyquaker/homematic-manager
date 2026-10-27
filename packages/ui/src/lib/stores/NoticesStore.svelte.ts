import type {Transport} from '@homematic-manager/core';
import {NoticesStore as KitNoticesStore, type NoticesStoreOptions} from 'occulite-ui/notices';

import {toApiRequestError} from '../transport/error.js';

export {INFO_TTL_MS, VISIBLE_NOTICES, WARN_TTL_MS} from 'occulite-ui/notices';
export type {Notice, NoticeLevel, NoticesStoreOptions} from 'occulite-ui/notices';

/**
 * occulite-ui's toast store, fed by the backend: every `notice` event becomes a toast (the
 * interface it is about as its source), `debug` stays in the host's log (task 56), and a rejected
 * request becomes an error notice through {@link fromError}.
 */
export class NoticesStore extends KitNoticesStore {
    readonly #unsubscribe: () => void;

    constructor(transport: Transport, options: NoticesStoreOptions = {}) {
        super(options);
        this.#unsubscribe = transport.on('notice', (notice) => {
            if (notice.level !== 'debug') {
                this.push(notice.level, notice.message, notice.interfaceName);
            }
        });
    }

    /**
     * Turns anything a request rejected with into an error notice. `context` prefixes the message
     * with what was being attempted, the way the 2.x alert put the daemon and method in front.
     */
    fromError(error: unknown, context?: string): number {
        const apiError = toApiRequestError(error);
        const fault =
            apiError.faultCode === undefined
                ? ''
                : ` (${apiError.faultString ?? apiError.message}, ${String(apiError.faultCode)})`;
        const message = `${context === undefined ? '' : `${context}: `}${apiError.message}${fault}`;
        return this.push('error', message);
    }

    override dispose(): void {
        super.dispose();
        this.#unsubscribe();
    }
}
