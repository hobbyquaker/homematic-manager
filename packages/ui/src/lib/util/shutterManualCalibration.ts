import type {ParamsetDescription, ParamsetWrite} from '@homematic-manager/core';

/**
 * The manual calibration of the end positions of an HmIP tubular motor (task 122), as the CCU's WebUI offers it on
 * the channel's operating page (`shutterSelfCalibration.js`, the control in `esp/controls/blind.fn`): the user moves
 * the shutter in small steps, saves the upper end position, then the lower one. Until both are saved the motor
 * cannot be used at all.
 *
 * The devices: the HmIP-M-TD15 and its OEM twin RM-110-45/15 (TEXINO), the two types the WebUI names wherever it
 * treats this motor specially (`iseBlindShutter.js`, `hmipChannelConfigDialogs.tcl`, `HmIPWeeklyProgram.js`).
 * Whether the dialog appears is decided by the datapoint, as on the CCU, not by the type.
 *
 * Everything is one ENUM datapoint of the `SHUTTER_TRANSMITTER` channel, qualified by three more and written together
 * in one `putParamset VALUES` - exactly as the WebUI writes them:
 *
 *   MANUAL_SELF_CALIBRATION                  ENUM, the step (see {@link ManualCalibration})
 *   MANUAL_SELF_CALIBRATION_LEVEL            FLOAT, the direction: 1.0 up, 0.0 down
 *   MANUAL_SELF_CALIBRATION_DURATION_VALUE   INTEGER, the movement time of the "with duration" step
 *   MANUAL_SELF_CALIBRATION_DURATION_UNIT    ENUM, its unit; the WebUI always sends 0 (seconds)
 *
 * and two flags on the maintenance channel `:0`, `MANUAL_SELF_CALIBRATION_TOP_POS_SET` and `…_BOTTOM_POS_SET`, which
 * say which end position the device holds. hmipserver may answer them with fault -5 until the device reported them
 * (B-105): such a flag is "not known", and the dialog treats it as not set - it offers the whole calibration, which
 * is harmless, where the WebUI (whose `null == 0` is false) would offer only "Delete end positions".
 *
 * Nothing here touches a store or the DOM: the calls are handed in, so the sequence is tested with a mocked RPC.
 */

/** The step datapoint of the shutter channel; its presence in VALUES is what offers the dialog. */
export const MANUAL_CALIBRATION_PARAM = 'MANUAL_SELF_CALIBRATION';
export const MANUAL_LEVEL_PARAM = 'MANUAL_SELF_CALIBRATION_LEVEL';
export const MANUAL_DURATION_VALUE_PARAM = 'MANUAL_SELF_CALIBRATION_DURATION_VALUE';
export const MANUAL_DURATION_UNIT_PARAM = 'MANUAL_SELF_CALIBRATION_DURATION_UNIT';
/** The flags on channel `:0`. */
export const TOP_SET_PARAM = 'MANUAL_SELF_CALIBRATION_TOP_POS_SET';
export const BOTTOM_SET_PARAM = 'MANUAL_SELF_CALIBRATION_BOTTOM_POS_SET';

/** The values of `MANUAL_SELF_CALIBRATION`, the WebUI's `ManualSelfCalibration` - sent as numbers, as there. */
export const ManualCalibration = {
    CLEAR_SAVED_POSITIONS: 0,
    SAVE_TOP_POSITION: 1,
    SAVE_BOTTOM_POSITION: 2,
    REVERSE_MOTION: 3,
    START_MOTION_WITH_LEVEL_SHORT: 4,
    START_MOTION_WITH_LEVEL_LONG: 5,
    START_MOTION_WITH_LEVEL_AND_DURATION: 6,
    STOP_MOTION: 7,
} as const;

/** The WebUI's limit of the movement time field (`checkVal`): 0 to 30 seconds. */
export const MAX_DURATION_S = 30;
/** How long the WebUI waits after "Delete end positions" before it reads the flags again. */
export const CLEAR_SETTLE_MS = 500;

export type Direction = 'up' | 'down';
/** The three moves of the dialog: a short step (the WebUI's "100 ms"), a long one ("400 ms"), or seconds. */
export type Motion = {kind: 'short'} | {kind: 'long'} | {kind: 'duration'; seconds: number};
/** The writes without a direction. */
export type PlainStep = 'clear' | 'saveTop' | 'saveBottom' | 'reverse' | 'stop';
/** What the last command was, for the status line. */
export type ManualAction = PlainStep | `${Direction}-${Motion['kind']}`;

/**
 * Where the calibration stands:
 * - `top`: the upper end position is not saved (or not known) - move up, save it; the motor's direction can be
 *   reversed here;
 * - `bottom`: the upper one is saved - move down, save the lower one;
 * - `calibrated`: the device holds both - only "Delete end positions" is offered;
 * - `saved`: the lower one was saved in this dialog - done.
 */
export type ManualStep = 'top' | 'bottom' | 'calibrated' | 'saved';

/** Whether the channel offers the manual calibration: its VALUES describe `MANUAL_SELF_CALIBRATION` (the WebUI's test). */
export function offersManualCalibration(valuesDescription: ParamsetDescription | undefined): boolean {
    return valuesDescription?.[MANUAL_CALIBRATION_PARAM] !== undefined;
}

/** The maintenance channel of a channel's device, where the two flags live. */
export function maintenanceAddress(address: string): string {
    return `${address.split(':')[0] ?? address}:0`;
}

/** A flag as the interface answers it: `true`/`1` set, `false`/`0` not set, anything else not known. */
export function flagOf(value: unknown): boolean | undefined {
    if (value === true || value === 1 || value === '1' || value === 'true') {
        return true;
    }
    if (value === false || value === 0 || value === '0' || value === 'false') {
        return false;
    }
    return undefined;
}

/** The step the flags put the dialog in; a flag not known counts as not set. */
export function stepOf(top: boolean | undefined, bottom: boolean | undefined): Exclude<ManualStep, 'saved'> {
    if (top !== true) {
        return 'top';
    }
    return bottom === true ? 'calibrated' : 'bottom';
}

/** The movement time as the WebUI's field takes it: a whole number of seconds, 0 to 30; anything else is 0. */
export function clampDuration(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Math.min(Math.trunc(parsed), MAX_DURATION_S);
}

/** The `putParamset VALUES` of a move, the datapoints the WebUI writes for it and no others. */
export function motionCommand(direction: Direction, motion: Motion): ParamsetWrite {
    const level = direction === 'up' ? 1 : 0;
    switch (motion.kind) {
        case 'short':
            return {
                [MANUAL_CALIBRATION_PARAM]: ManualCalibration.START_MOTION_WITH_LEVEL_SHORT,
                [MANUAL_LEVEL_PARAM]: level,
            };
        case 'long':
            return {
                [MANUAL_CALIBRATION_PARAM]: ManualCalibration.START_MOTION_WITH_LEVEL_LONG,
                [MANUAL_LEVEL_PARAM]: level,
            };
        case 'duration':
            return {
                [MANUAL_CALIBRATION_PARAM]: ManualCalibration.START_MOTION_WITH_LEVEL_AND_DURATION,
                [MANUAL_LEVEL_PARAM]: level,
                [MANUAL_DURATION_VALUE_PARAM]: clampDuration(motion.seconds),
                // 0 = seconds, the only unit the WebUI sends
                [MANUAL_DURATION_UNIT_PARAM]: 0,
            };
    }
}

const PLAIN: Record<PlainStep, number> = {
    clear: ManualCalibration.CLEAR_SAVED_POSITIONS,
    saveTop: ManualCalibration.SAVE_TOP_POSITION,
    saveBottom: ManualCalibration.SAVE_BOTTOM_POSITION,
    reverse: ManualCalibration.REVERSE_MOTION,
    stop: ManualCalibration.STOP_MOTION,
};

/** The `putParamset VALUES` of a step without a direction: `MANUAL_SELF_CALIBRATION` alone. */
export function plainCommand(step: PlainStep): ParamsetWrite {
    return {[MANUAL_CALIBRATION_PARAM]: PLAIN[step]};
}

/** What the session needs from the interface. */
export interface ManualCalibrationRpc {
    /** `getValue` of a flag on channel `:0`; `undefined` when unreadable (hmipserver's -5). Raises no notice. */
    readonly getFlag: (parameter: string) => Promise<unknown>;
    /** One `putParamset VALUES` on the shutter channel, as given; `false` when it failed. */
    readonly command: (values: ParamsetWrite) => Promise<boolean>;
    /** The events of channel `:0`; answers the function that ends the subscription. Optional. */
    readonly onFlag?: (handler: (parameter: string, value: unknown) => void) => () => void;
}

export interface ManualCalibrationState {
    readonly top: boolean | undefined;
    readonly bottom: boolean | undefined;
    readonly step: ManualStep;
    /** The flags have been read once. */
    readonly loaded: boolean;
    /** Writes under way; the save and delete buttons wait for them, the moves and Stop do not. */
    readonly pending: number;
    /** The shutter was told to move since the last Stop: closing the dialog stops it. */
    readonly moved: boolean;
    readonly last?: {action: ManualAction; ok: boolean};
}

/**
 * One calibration dialog, open on one channel. Every change of its state goes to `onchange` (the component mirrors it
 * into its own state). The steps follow the WebUI: a saved upper end position leads to the lower one, a saved lower
 * one ends the calibration, deleting starts it again; the flags' events move it along as well.
 */
export class ManualCalibrationSession {
    #state: ManualCalibrationState = {
        top: undefined,
        bottom: undefined,
        step: 'top',
        loaded: false,
        pending: 0,
        moved: false,
    };
    readonly #rpc: ManualCalibrationRpc;
    readonly #onchange: (state: ManualCalibrationState) => void;
    readonly #settleMs: number;
    #unsubscribe: (() => void) | undefined;
    #settle: ReturnType<typeof setTimeout> | undefined;
    #closed = false;

    constructor(
        rpc: ManualCalibrationRpc,
        onchange: (state: ManualCalibrationState) => void,
        options: {settleMs?: number} = {},
    ) {
        this.#rpc = rpc;
        this.#onchange = onchange;
        this.#settleMs = options.settleMs ?? CLEAR_SETTLE_MS;
        // events first: a flag the device reports while the first read is under way is not lost
        this.#unsubscribe = rpc.onFlag?.((parameter, value) => {
            if (parameter === TOP_SET_PARAM || parameter === BOTTOM_SET_PARAM) {
                const flag = flagOf(value);
                if (flag !== undefined) {
                    this.#flags(parameter === TOP_SET_PARAM ? {top: flag} : {bottom: flag});
                }
            }
        });
    }

    get state(): ManualCalibrationState {
        return this.#state;
    }

    /** Reads both flags; one that cannot be read keeps what is known (an event, a write of this dialog). */
    async load(): Promise<void> {
        const [top, bottom] = await Promise.all([
            this.#rpc.getFlag(TOP_SET_PARAM),
            this.#rpc.getFlag(BOTTOM_SET_PARAM),
        ]);
        if (this.#closed) {
            return;
        }
        const flags: {top?: boolean; bottom?: boolean} = {};
        const topFlag = flagOf(top);
        const bottomFlag = flagOf(bottom);
        if (topFlag !== undefined) {
            flags.top = topFlag;
        }
        if (bottomFlag !== undefined) {
            flags.bottom = bottomFlag;
        }
        this.#set({loaded: true});
        this.#flags(flags);
    }

    move(direction: Direction, motion: Motion): Promise<boolean> {
        return this.#send(`${direction}-${motion.kind}`, motionCommand(direction, motion), {moved: true});
    }

    reverse(): Promise<boolean> {
        return this.#send('reverse', plainCommand('reverse'));
    }

    /** Stop is never refused and never waits: it goes out whatever else is under way. */
    stop(): Promise<boolean> {
        return this.#send('stop', plainCommand('stop'), {moved: false});
    }

    async saveTop(): Promise<boolean> {
        const ok = await this.#send('saveTop', plainCommand('saveTop'));
        if (ok) {
            this.#flags({top: true});
        }
        return ok;
    }

    async saveBottom(): Promise<boolean> {
        const ok = await this.#send('saveBottom', plainCommand('saveBottom'));
        if (ok) {
            this.#flags({bottom: true}, true);
        }
        return ok;
    }

    /** Deletes both end positions; the flags are read again after a moment, as the WebUI does. */
    async clear(): Promise<boolean> {
        const ok = await this.#send('clear', plainCommand('clear'));
        if (ok && !this.#closed) {
            this.#set({top: false, bottom: false, step: 'top'});
            clearTimeout(this.#settle);
            this.#settle = setTimeout(() => void this.load(), this.#settleMs);
        }
        return ok;
    }

    /**
     * The dialog goes away: a shutter that was told to move is stopped (the WebUI sends STOP_MOTION on Cancel), and the
     * session ends. Answers whether a Stop went out.
     */
    async close(): Promise<boolean> {
        const stopping = this.#state.moved && !this.#closed;
        this.#closed = true;
        clearTimeout(this.#settle);
        this.#unsubscribe?.();
        this.#unsubscribe = undefined;
        if (stopping) {
            await this.#rpc.command(plainCommand('stop'));
        }
        return stopping;
    }

    async #send(action: ManualAction, values: ParamsetWrite, after: {moved?: boolean} = {}): Promise<boolean> {
        if (this.#closed) {
            return false;
        }
        this.#set({pending: this.#state.pending + 1});
        const ok = await this.#rpc.command(values);
        if (this.#isClosed()) {
            return ok;
        }
        this.#set({
            pending: this.#state.pending - 1,
            last: {action, ok},
            ...(ok && after.moved !== undefined ? {moved: after.moved} : {}),
        });
        return ok;
    }

    /** Asked after an await: the dialog may have closed meanwhile, which the compiler's narrowing cannot see. */
    #isClosed(): boolean {
        return this.#closed;
    }

    #flags(flags: {top?: boolean; bottom?: boolean}, saved = false): void {
        const top = flags.top ?? this.#state.top;
        const bottom = flags.bottom ?? this.#state.bottom;
        // a lower end position saved here ends the calibration; only a delete (or the device) takes that back
        const done = saved || (this.#state.step === 'saved' && top === true && bottom === true);
        this.#set({top, bottom, step: done ? 'saved' : stepOf(top, bottom)});
    }

    #set(patch: Partial<ManualCalibrationState>): void {
        if (this.#closed) {
            return;
        }
        this.#state = {...this.#state, ...patch};
        this.#onchange(this.#state);
    }
}
