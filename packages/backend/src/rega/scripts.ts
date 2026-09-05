/**
 * Every ReGa script this application sends, in one file.
 *
 * They are here and not spread over the callers for two reasons. A ReGa script is *code sent to
 * someone else's interpreter*: it has to be reviewable in one place, and none of it may be built by
 * string concatenation at a call site where the escaping is easy to forget. And they are the part
 * that cannot be typechecked, so they are the part that needs a test each - which is what
 * `scripts.test.ts` and the integration tests against hm-simulator's ReGa mock are for.
 *
 * The idioms are eQ-3's own, not invented here:
 *
 * - `root.Devices().EnumUsedIDs()`, `oDevice.ReadyConfig()` and `oDevice.Address()` are what
 *   `homematic-rega`'s `channels.rega` uses to list the devices (the maintainer's own script).
 * - `dom.GetObject(<id>).ReadyConfig(true)` is how the CCU's own `WebUI/bin/hm_autoconf` confirms
 *   a device out of the inbox.
 * - `dom.GetObject(<id>).AlReceipt()` is how an alarm - a service message - is acknowledged;
 *   ioBroker's hm-rega adapter sends exactly that.
 *
 * D-2: none of this is ever required. Everything a script does here has already been done through
 * the interface process, or is a convenience; a system without ReGa loses nothing but the CCU-side
 * bookkeeping.
 */

/** Escapes a string for the ReGa string literal it is written into. */
export function escapeRegaString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/[\r\n]+/g, ' ');
}

/** One entry of a rename: the ReGa object id and the name it should carry. */
export interface RegaRename {
    readonly id: number;
    readonly name: string;
}

/**
 * Renames objects by their ReGa id.
 *
 * One `dom.GetObject(<id>).Name("<name>");` statement per line rather than the
 * `var hmm_o; hmm_o = dom.GetObject(<id>); hmm_o.Name(...)` form of 2.x. The two are the same thing
 * for ReGa, and the single-statement form is the one hm-simulator's ReGa mock recognises - which is
 * the only way the rename can be tested without a CCU.
 */
export function renameObjectsScript(entries: readonly RegaRename[]): string | undefined {
    const lines = entries.map((entry) => `dom.GetObject(${String(entry.id)}).Name("${escapeRegaString(entry.name)}");`);
    return lines.length === 0 ? undefined : `${lines.join('\n')}\n`;
}

/**
 * Issue #54: confirm every device that is still sitting in the CCU's inbox.
 *
 * A device that has just been paired has `ReadyConfig() == false` until somebody presses "fertig"
 * in the WebUI's Posteingang, and until then the CCU's own lists ignore it - which is confusing
 * when the device is plainly there in this application, because this application talks to the
 * interface process and never looked at the inbox.
 *
 * The script confirms them and reports what it confirmed, as JSON, so the caller can say which
 * devices it was rather than "something happened".
 */
export const CONFIRM_INBOX_SCRIPT = `string sDevId;
boolean bFirst = true;
Write('[');
foreach (sDevId, root.Devices().EnumUsedIDs()) {
    object oDevice = dom.GetObject(sDevId);
    if (oDevice.ReadyConfig() == false) {
        oDevice.ReadyConfig(true);
        if (bFirst) { bFirst = false; } else { Write(','); }
        Write('{"id": ' # sDevId # ', "address": "' # oDevice.Address() # '"}');
    }
}
Write(']');
`;

/** A device the inbox script confirmed. */
export interface ConfirmedDevice {
    readonly id: number;
    readonly address: string;
}

/** Reads what {@link CONFIRM_INBOX_SCRIPT} wrote. Anything unexpected means "nothing confirmed". */
export function parseConfirmedDevices(output: string): ConfirmedDevice[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output.trim() === '' ? '[]' : output);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    const result: ConfirmedDevice[] = [];
    for (const item of parsed) {
        if (typeof item !== 'object' || item === null) {
            continue;
        }
        const entry = item as {id?: unknown; address?: unknown};
        if (typeof entry.id === 'number' && typeof entry.address === 'string' && entry.address !== '') {
            result.push({id: entry.id, address: entry.address});
        }
    }
    return result;
}

/**
 * Issue #94: acknowledge a service message in ReGa as well.
 *
 * The interface process is where the datapoint is written - that is the acknowledgement that
 * matters, and it happens whether ReGa exists or not. This is the CCU's own bookkeeping on top: the
 * WebUI keeps its service-message list in ReGa alarms, and an alarm is cleared with `AlReceipt()`.
 * Without it the WebUI keeps showing a message the user has already dealt with here.
 *
 * The datapoint is addressed by its ReGa name, `<interface>.<channel>.<datapoint>`, which is the
 * form the CCU uses everywhere. `if (oAlarm)` guards the case where ReGa does not know it - a
 * device that is not in the CCU's lists at all, a CUxD datapoint, or a message the WebUI has
 * already taken care of.
 */
export function acknowledgeAlarmScript(interfaceName: string, address: string, datapoint: string): string | undefined {
    if (!isPlainRegaName(interfaceName) || !isPlainRegaName(address) || !isPlainRegaName(datapoint)) {
        return undefined;
    }
    return `object oAlarm = dom.GetObject("${interfaceName}.${address}.${datapoint}");\nif (oAlarm) { oAlarm.AlReceipt(); }\n`;
}

/**
 * Is this safe to put inside a ReGa string literal *unescaped*?
 *
 * Interface names, device addresses and datapoint names come from the interface process, not from
 * the user - but they end up in a script, so they are treated as input. Anything but the characters
 * those three really use is refused rather than escaped: a refusal loses one acknowledgement, a
 * clever escape that turns out to be wrong loses control of the interpreter.
 */
export function isPlainRegaName(value: string): boolean {
    return /^[A-Za-z0-9_.:-]+$/.test(value);
}
