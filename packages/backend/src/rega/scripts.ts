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
 * Issue #94, B-61: acknowledge a service message in ReGa as well.
 *
 * The interface process is where the datapoint is written - that is the acknowledgement that
 * matters, and it happens whether ReGa exists or not. This is the CCU's own bookkeeping on top: the
 * WebUI keeps its service-message list in ReGa alarms and clears one with `AlReceipt()`.
 *
 * B-61 (#166): the alarm is found the way the WebUI's service-message page finds it - over
 * `dom.GetObject(ID_SERVICES)`, one `OT_ALARMDP` per message, whose `AlTriggerDP()` is the
 * datapoint `<interface>.<channel>.<datapoint>` (read from `/www/rega/pages/tabs/statusviews/
 * serviceMessages.htm` and `esp/functions.fn::ReceiptAlarm` of OpenCCU 3.89.8). The script before
 * it called `AlReceipt()` on `dom.GetObject("<interface>.<channel>.<datapoint>")`, which is the
 * datapoint itself and not its alarm, so nothing was receipted and nothing said so. The answer is
 * how many alarms were receipted.
 */
export function acknowledgeAlarmScript(interfaceName: string, address: string, datapoint: string): string | undefined {
    if (!isPlainRegaName(interfaceName) || !isPlainRegaName(address) || !isPlainRegaName(datapoint)) {
        return undefined;
    }
    return `integer iDone = 0;
string sId;
foreach (sId, dom.GetObject(ID_SERVICES).EnumIDs()) {
    object oAlarm = dom.GetObject(sId);
    if (oAlarm) {
        object oTrigger = dom.GetObject(oAlarm.AlTriggerDP());
        if (oTrigger) {
            if (oTrigger.Name() == "${interfaceName}.${address}.${datapoint}") {
                oAlarm.AlReceipt();
                iDone = iDone + 1;
            }
        }
    }
}
Write(iDone);
`;
}

/**
 * Task 36: the CCU's pending service messages with their times, as the WebUI's service-message page
 * reads them: every `OT_ALARMDP` of `ID_SERVICES` that is `asOncoming`, one line per alarm with the
 * trigger datapoint's name, `AlOccurrenceTime()` (the WebUI's *Erste Meldung*) and `Timestamp()`
 * (*Letzte Meldung*), both as Unix seconds (`ToInteger()`, checked against `date +%s` on the lab's
 * OpenCCU). Read-only.
 */
export const REGA_ALARMS_SCRIPT = `string sId;
foreach (sId, dom.GetObject(ID_SERVICES).EnumIDs()) {
    object oAlarm = dom.GetObject(sId);
    if (oAlarm) {
        if (oAlarm.IsTypeOf(OT_ALARMDP) && (oAlarm.AlState() == asOncoming)) {
            object oTrigger = dom.GetObject(oAlarm.AlTriggerDP());
            if (oTrigger) {
                Write(oTrigger.Name() # "\\t" # oAlarm.AlOccurrenceTime().ToInteger() # "\\t" # oAlarm.Timestamp().ToInteger() # "\\n");
            }
        }
    }
}
`;

/** One pending ReGa service message: whose datapoint, first and last reported (epoch ms). */
export interface RegaAlarm {
    readonly interfaceName: string;
    readonly address: string;
    readonly datapoint: string;
    readonly first: number;
    readonly last: number;
}

/**
 * Reads what {@link REGA_ALARMS_SCRIPT} wrote. A line whose name is not `<interface>.<channel>.<datapoint>`
 * (a system alarm, a CUxD name with more dots) or whose time is no positive number is skipped.
 */
export function parseRegaAlarms(output: string): RegaAlarm[] {
    const alarms: RegaAlarm[] = [];
    for (const line of output.split('\n')) {
        const [name, first, last] = line.split('\t');
        const match = /^([^.\s]+)\.([^.\s]+)\.([^.\s]+)$/u.exec(name?.trim() ?? '');
        const firstSeconds = Number(first);
        const lastSeconds = Number(last);
        if (!match || !Number.isFinite(firstSeconds) || firstSeconds <= 0) {
            continue;
        }
        alarms.push({
            interfaceName: match[1] ?? '',
            address: match[2] ?? '',
            datapoint: match[3] ?? '',
            first: firstSeconds * 1000,
            last: Number.isFinite(lastSeconds) && lastSeconds > 0 ? lastSeconds * 1000 : firstSeconds * 1000,
        });
    }
    return alarms;
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

/*
 * Task 27: rooms and functions through ReGa's own objects.
 *
 * ReGa keeps rooms and functions as enum objects under `ID_ROOMS` and `ID_FUNCTIONS`, each holding
 * the ids of the channels in it (`EnumUsedIDs()`), and a channel is put in or taken out with
 * `Add(id)` / `Remove(id)` on the enum - which is what the WebUI does when a room is edited. The
 * read script is `homematic-rega`'s `channels.rega`, `rooms.rega` and `functions.rega` in one
 * round trip, plus the interface name of every device, because the metadata store keys objects by
 * `<interface>.<address>` and the address alone is not a ref.
 */

/** Everything the ReGa metadata provider reads, in one script and one JSON document. */
export const META_READ_SCRIPT = `string sDevId;
string sChnId;
string sEnumId;
string sMember;
string sIface;
object oIface;
boolean bFirst = true;
boolean bFirstMember = true;
Write('{"objects":[');
foreach (sDevId, root.Devices().EnumUsedIDs()) {
    object oDevice = dom.GetObject(sDevId);
    if (oDevice.ReadyConfig()) {
        sIface = "";
        oIface = dom.GetObject(oDevice.Interface());
        if (oIface) { sIface = oIface.Name(); }
        if (bFirst) { bFirst = false; } else { Write(','); }
        Write('{"id":' # sDevId # ',"address":"' # oDevice.Address() # '","interface":"' # sIface # '","name":"');
        WriteURL(oDevice.Name());
        Write('"}');
        foreach (sChnId, oDevice.Channels()) {
            object oChannel = dom.GetObject(sChnId);
            Write(',{"id":' # sChnId # ',"address":"' # oChannel.Address() # '","interface":"' # sIface # '","name":"');
            WriteURL(oChannel.Name());
            Write('"}');
        }
    }
}
Write('],"rooms":[');
bFirst = true;
foreach (sEnumId, dom.GetObject(ID_ROOMS).EnumUsedIDs()) {
    object oRoom = dom.GetObject(sEnumId);
    if (bFirst) { bFirst = false; } else { Write(','); }
    Write('{"id":' # sEnumId # ',"name":"');
    WriteURL(oRoom.Name());
    Write('","channels":[');
    bFirstMember = true;
    foreach (sMember, oRoom.EnumUsedIDs()) {
        if (bFirstMember) { bFirstMember = false; } else { Write(','); }
        Write(sMember);
    }
    Write(']}');
}
Write('],"functions":[');
bFirst = true;
foreach (sEnumId, dom.GetObject(ID_FUNCTIONS).EnumUsedIDs()) {
    object oFunction = dom.GetObject(sEnumId);
    if (bFirst) { bFirst = false; } else { Write(','); }
    Write('{"id":' # sEnumId # ',"name":"');
    WriteURL(oFunction.Name());
    Write('","channels":[');
    bFirstMember = true;
    foreach (sMember, oFunction.EnumUsedIDs()) {
        if (bFirstMember) { bFirstMember = false; } else { Write(','); }
        Write(sMember);
    }
    Write(']}');
}
Write(']}');
`;

/** One device or channel as ReGa lists it. */
export interface RegaMetaObject {
    readonly id: number;
    readonly address: string;
    /** `BidCos-RF`, `HmIP-RF`, … - empty when ReGa does not name the interface. */
    readonly interfaceName: string;
    readonly name: string;
}

/** One room or one function: its ReGa id, its name and the channel ids in it. */
export interface RegaMetaEnum {
    readonly id: number;
    readonly name: string;
    readonly channels: readonly number[];
}

export interface RegaMetaSnapshot {
    readonly objects: readonly RegaMetaObject[];
    readonly rooms: readonly RegaMetaEnum[];
    readonly functions: readonly RegaMetaEnum[];
}

/**
 * Decodes what ReGa's `WriteURL()` produces: `%XX` and `%uXXXX` escapes whose bytes are ISO-8859-1
 * characters, not UTF-8 sequences - which is why `decodeURIComponent` would throw on `K%FCche`.
 * The same rule `homematic-rega` applies to its own scripts' output.
 */
export function unescapeRegaUrl(value: string): string {
    return value.replace(
        /%u([0-9a-f]{4})|%([0-9a-f]{2})/gi,
        (_match, long: string | undefined, short: string | undefined) =>
            String.fromCharCode(Number.parseInt(long ?? short ?? '0', 16)),
    );
}

/** Reads what {@link META_READ_SCRIPT} wrote. Throws on anything that is not the expected shape. */
export function parseMetaSnapshot(output: string): RegaMetaSnapshot {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('the ReGa metadata script answered with no document');
    }
    const raw = parsed as {objects?: unknown; rooms?: unknown; functions?: unknown};
    return {
        objects: parseObjects(raw.objects),
        rooms: parseEnums(raw.rooms, 'rooms'),
        functions: parseEnums(raw.functions, 'functions'),
    };
}

function parseObjects(value: unknown): RegaMetaObject[] {
    if (!Array.isArray(value)) {
        throw new Error('the ReGa metadata script answered without an object list');
    }
    const objects: RegaMetaObject[] = [];
    for (const item of value as unknown[]) {
        if (typeof item !== 'object' || item === null) {
            continue;
        }
        const entry = item as {id?: unknown; address?: unknown; interface?: unknown; name?: unknown};
        if (typeof entry.id !== 'number' || typeof entry.address !== 'string' || entry.address === '') {
            continue;
        }
        objects.push({
            id: entry.id,
            address: entry.address,
            interfaceName: typeof entry.interface === 'string' ? entry.interface : '',
            name: typeof entry.name === 'string' ? unescapeRegaUrl(entry.name) : '',
        });
    }
    return objects;
}

function parseEnums(value: unknown, what: string): RegaMetaEnum[] {
    if (!Array.isArray(value)) {
        throw new Error(`the ReGa metadata script answered without the ${what}`);
    }
    const enums: RegaMetaEnum[] = [];
    for (const item of value as unknown[]) {
        if (typeof item !== 'object' || item === null) {
            continue;
        }
        const entry = item as {id?: unknown; name?: unknown; channels?: unknown};
        if (typeof entry.id !== 'number') {
            continue;
        }
        const channels = Array.isArray(entry.channels)
            ? (entry.channels as unknown[]).filter((id): id is number => typeof id === 'number')
            : [];
        enums.push({id: entry.id, name: typeof entry.name === 'string' ? unescapeRegaUrl(entry.name) : '', channels});
    }
    return enums;
}

/** Which of ReGa's two lists a node belongs to. */
export type RegaEnumKind = 'room' | 'function';

const ENUM_ROOT: Readonly<Record<RegaEnumKind, string>> = {room: 'ID_ROOMS', function: 'ID_FUNCTIONS'};

/**
 * A new room or function: an enum object, named, and put into ReGa's list of them. The script
 * writes the new id, which is the only thing the caller needs to address it from then on.
 */
export function createEnumNodeScript(kind: RegaEnumKind, name: string): string {
    return [
        'object oNew = dom.CreateObject(OT_ENUM);',
        `oNew.Name("${escapeRegaString(name)}");`,
        `dom.GetObject(${ENUM_ROOT[kind]}).Add(oNew.ID());`,
        'Write(oNew.ID());',
        '',
    ].join('\n');
}

/** Reads the id {@link createEnumNodeScript} wrote, or `undefined` when ReGa wrote something else. */
export function parseCreatedId(output: string): number | undefined {
    const trimmed = output.trim();
    return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Removes a room or function: out of ReGa's list first, then the object itself. The memberships go
 * with it, which is what the caller has already confirmed with the user (`has-members`).
 */
export function deleteEnumNodeScript(kind: RegaEnumKind, id: number): string {
    return [
        `object oGone = dom.GetObject(${String(id)});`,
        `if (oGone) { dom.GetObject(${ENUM_ROOT[kind]}).Remove(${String(id)}); dom.DeleteObject(${String(id)}); }`,
        '',
    ].join('\n');
}

/** One membership change: a channel into or out of one room or function. */
export interface RegaMembershipChange {
    readonly enumId: number;
    readonly channelId: number;
    readonly on: boolean;
}

/** `Add` / `Remove` on the enum, one statement per change; `undefined` when there is none. */
export function membershipScript(changes: readonly RegaMembershipChange[]): string | undefined {
    if (changes.length === 0) {
        return undefined;
    }
    const lines = changes.map(
        (change) =>
            `dom.GetObject(${String(change.enumId)}).${change.on ? 'Add' : 'Remove'}(${String(change.channelId)});`,
    );
    return `${lines.join('\n')}\n`;
}

/**
 * D-32: does this user exist, and what is their level?
 *
 * The one script the addon's optional login sends (`rega/auth.ts`). It is RedMatic's, unchanged in
 * substance (`addon_files/redmatic/lib/rega-auth.js`), because that is the form which has been
 * proving itself against real ReGaHSS versions for years: `ID_USERS` is the CCU's user list,
 * `Get()` looks one up by name, and an object variable comes back in the response as the object's
 * `Name()` - so `user` equalling the name that was asked for *is* the answer "this user exists".
 *
 * `UserLevel()` is 8 for an admin, 2 for a user and 1 for a guest. The login stores it in the
 * session and shows it; it does not gate anything yet (D-32: everyone who may log in may write, as
 * in the WebUI).
 *
 * The name comes from a login form, so it is escaped rather than concatenated, and a name that has
 * no representation at all is refused. `escapeRegaString` also folds newlines away, which is what
 * keeps a name from appending a second statement to the script.
 */
export function userLookupScript(name: string): string | undefined {
    if (name === '' || name.length > 64) {
        return undefined;
    }
    // written out rather than as a character class: a control character inside a regex literal is
    // exactly what `no-control-regex` is about, and a loop needs no exception to a lint rule
    for (let index = 0; index < name.length; index += 1) {
        if (name.charCodeAt(index) < 32) {
            return undefined;
        }
    }
    return [
        `var user = dom.GetObject(ID_USERS).Get("${escapeRegaString(name)}");`,
        'var level;',
        'if (user) {',
        '    level = user.UserLevel();',
        '}',
        '',
    ].join('\n');
}
