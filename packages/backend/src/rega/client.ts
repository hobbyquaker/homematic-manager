/**
 * ReGa: friendly names, and renaming them on the CCU. Optional by D-2.
 *
 * Nothing here ever throws into the API. 2.x called `throw err` from inside the `getChannels`
 * callback (`main.js:853`) and from the "empty result" branch (`:862`), which is the crash of issue
 * #127 when the CCU asks for authentication - an unhandled exception in an async callback takes the
 * Electron main process with it. Here every failure becomes a `RegaState.error` plus a notice, and
 * the names fall back to the local store, which is what makes Homegear and a bare rfd usable at all.
 *
 * 2.x also had `config.useTLS` for the interfaces and `config.useTls` for ReGa (`main.js:187` vs
 * `:207`), so ReGa never used TLS at all; the port comes from the core's `regaPort()` here.
 *
 * The rename script addresses ReGa objects by their numeric id, which is why `NameStore` keeps the
 * id `getChannels` reported; an address ReGa has never reported can only be renamed locally.
 *
 * Every script this module sends lives in `scripts.ts` - one file, reviewable in one go, because a
 * ReGa script is code sent to someone else's interpreter.
 */

import {Rega, type RegaChannel} from 'homematic-rega';

import {regaPort, type Language, type RegaState} from '@homematic-manager/core';

import {errorMessage} from '../errors.js';
import type {NameEntry, NameStore} from '../cache/names.js';
import {
    acknowledgeAlarmScript,
    CONFIRM_INBOX_SCRIPT,
    escapeRegaString,
    parseConfirmedDevices,
    renameObjectsScript,
    type ConfirmedDevice,
} from './scripts.js';

export {escapeRegaString};

/** The part of `homematic-rega` this module uses; a test passes its own. */
export interface RegaLike {
    getChannels(): Promise<RegaChannel[]>;
    exec(script: string): Promise<{output: string; objects: Record<string, string>}>;
}

export interface RegaServiceOptions {
    readonly host: string;
    /** D-2: when this is off, `state.enabled` is false and nothing is ever called. */
    readonly enabled: boolean;
    readonly tls?: boolean;
    readonly auth?: {readonly user: string; readonly password: string} | undefined;
    readonly language?: Language;
    /** Names go in here, and the object ids for the rename script come out of it. */
    readonly names: NameStore;
    readonly onStateChanged: (state: RegaState) => void;
    readonly onNotice: (level: 'info' | 'warn' | 'error', message: string) => void;
    readonly timeoutMs?: number;
    /** Overrides the port; the integration tests point at an hm-simulator on an ephemeral one. */
    readonly port?: number;
    readonly createClient?: (options: RegaServiceOptions) => RegaLike;
}

/**
 * The script that renames a set of objects, or `undefined` when none of the addresses has a ReGa
 * id - in which case there is nothing to send and the local store has already done the work.
 */
export function renameScript(
    entries: readonly NameEntry[],
    idOf: (address: string) => number | undefined,
): string | undefined {
    const renames = entries
        .map((entry) => ({id: idOf(entry.address), name: entry.name}))
        .filter((entry): entry is {id: number; name: string} => entry.id !== undefined);
    return renameObjectsScript(renames);
}

function createClient(options: RegaServiceOptions): RegaLike {
    return new Rega({
        host: options.host,
        port: options.port ?? regaPort({tls: options.tls === true}),
        tls: options.tls === true,
        // a CCU's certificate is self-signed
        insecure: true,
        username: options.auth?.user,
        password: options.auth?.password,
        language: options.language ?? 'de',
        // the placeholder translations need the CCU's web UI; names do not, and a web UI that does
        // not answer must not make `getChannels()` fail
        translate: false,
        ...(options.timeoutMs === undefined ? {} : {timeout: options.timeoutMs}),
    });
}

/** Names from ReGa, with every failure turned into a state the UI can show. */
export class RegaService {
    readonly #options: RegaServiceOptions;
    readonly #client: RegaLike | undefined;
    #state: RegaState;

    constructor(options: RegaServiceOptions) {
        this.#options = options;
        this.#state = {enabled: options.enabled, reachable: false, names: 0};
        this.#client = options.enabled ? (options.createClient ?? createClient)(options) : undefined;
    }

    get state(): RegaState {
        return this.#state;
    }

    /** True when ReGa is on and has answered at least once. */
    get available(): boolean {
        return this.#state.enabled && this.#state.reachable;
    }

    /**
     * Fetches the names. Returns true when anything changed. Never rejects: a failure lands in the
     * state and in a notice, and the local names stay as they are.
     */
    async refreshNames(): Promise<boolean> {
        if (!this.#client) {
            this.#setState({enabled: false, reachable: false, names: 0});
            return false;
        }
        try {
            const channels = await this.#client.getChannels();
            if (channels.length === 0) {
                // 2.x threw here; an empty CCU is unusual but not a reason to lose the app
                this.#setState({
                    enabled: true,
                    reachable: true,
                    names: this.#options.names.size,
                    error: 'ReGa returned no channels',
                });
                this.#options.onNotice('warn', 'ReGa returned no channels');
                return false;
            }
            const changed = this.#options.names.applyRega(channels);
            this.#setState({enabled: true, reachable: true, names: channels.length});
            return changed;
        } catch (error) {
            this.#fail(`ReGa is not answering: ${errorMessage(error)}`);
            return false;
        }
    }

    /**
     * Renames on the CCU. The local store has already been updated by the caller, so a failure here
     * only means that the CCU still shows the old name - reported, never thrown.
     */
    async rename(entries: readonly NameEntry[]): Promise<void> {
        if (!this.#client || entries.length === 0) {
            return;
        }
        const script = renameScript(entries, (address) => this.#options.names.regaId(address));
        if (script === undefined) {
            return;
        }
        try {
            await this.#client.exec(script);
            if (this.#state.error !== undefined) {
                this.#setState({enabled: true, reachable: true, names: this.#state.names});
            }
        } catch (error) {
            this.#fail(`renaming through ReGa failed: ${errorMessage(error)}`);
        }
    }

    /**
     * Issue #54: confirm every device that is still in the CCU's inbox, and say which ones.
     *
     * D-2: without ReGa there is no inbox, so this answers with an empty list and nothing else
     * happens. A failure is a notice, never an exception - a device that could not be confirmed on
     * the CCU is still perfectly usable from here.
     */
    async confirmInbox(): Promise<ConfirmedDevice[]> {
        if (!this.#client) {
            return [];
        }
        try {
            const answer = await this.#client.exec(CONFIRM_INBOX_SCRIPT);
            const confirmed = parseConfirmedDevices(answer.output);
            if (confirmed.length > 0) {
                this.#options.onNotice(
                    'info',
                    `confirmed ${String(confirmed.length)} device(s) in the ReGa inbox: ${confirmed
                        .map((entry) => entry.address)
                        .join(', ')}`,
                );
            }
            return confirmed;
        } catch (error) {
            this.#fail(`confirming the ReGa inbox failed: ${errorMessage(error)}`);
            return [];
        }
    }

    /**
     * Issue #94: acknowledge a service message in ReGa as well.
     *
     * The datapoint write through the interface process is the acknowledgement that matters and has
     * already happened; this clears the CCU's own alarm so the WebUI stops showing a message the
     * user has dealt with here. Returns false when there is no ReGa, when the name is not one that
     * may go into a script, or when the CCU refused - none of which is worth an error.
     */
    async acknowledgeAlarm(interfaceName: string, address: string, datapoint: string): Promise<boolean> {
        if (!this.#client) {
            return false;
        }
        const script = acknowledgeAlarmScript(interfaceName, address, datapoint);
        if (script === undefined) {
            return false;
        }
        try {
            await this.#client.exec(script);
            return true;
        } catch (error) {
            this.#options.onNotice(
                'info',
                `${address}: the service message was acknowledged on the interface but not in ReGa: ${errorMessage(error)}`,
            );
            return false;
        }
    }

    #fail(message: string): void {
        this.#setState({enabled: true, reachable: false, names: this.#options.names.size, error: message});
        this.#options.onNotice('warn', message);
    }

    #setState(state: RegaState): void {
        this.#state = state;
        this.#options.onStateChanged(state);
    }
}
