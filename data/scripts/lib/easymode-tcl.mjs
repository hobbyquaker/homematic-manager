/**
 * Task 62 (D-54): what the CCU's own easy mode shows for each link profile, read from the WebUI's
 * easymode TCL (`/www/config/easymodes/<RECEIVER_TYPE>/<SENDER_TYPE>.tcl`).
 *
 * openccu-data keeps the profiles' constraints but not which parameters the WebUI puts on the
 * form: that lives only in `set_htmlParams`, which builds one form per profile by hand. This reads
 * that procedure the way the WebUI runs it, closely enough to list the form's controls in order:
 *
 * - `set prn N` / `incr prn` start the form of profile N (0 is the expert form, skipped);
 * - `getTimeSelector DESCR ps PROFILE_$prn <type> $prn $special_input_id <PREFIX> ...` is one duration
 *   selector over `<PREFIX>_BASE` / `<PREFIX>_FACTOR`, its presets chosen by `<type>`;
 * - `get_ComboBox options <PARAM> ...` is a combo box, with the option set of the last `option X`;
 * - `subset2combobox {SUBSET_1 SUBSET_2} ...` is one choice that sets several parameters;
 * - the colour, behaviour, effect, sound and repetition selectors name `$param`, resolved from the
 *   last `set param X`; any other command that names a `SHORT_*` / `LONG_*` parameter literally is
 *   taken as a plain control for it.
 *
 * A control inside `if {[info exists ps(X)]}` carries `requires: [X]`, so the app shows it only
 * where the device has X - the colour and repetition selectors of an optical-signal device, say.
 * Other branches (`$longKeypressAvailable`, device-type tests) are not evaluated: the form gets
 * every control they can show, and the app drops what the device's description lacks. Everything
 * here is pure; the script around it does the file walking.
 */

/** A form control, in the order the WebUI draws it. */
/**
 * `requires`: the parameters an enclosing `if {[info exists ps(X)]}` asks for - the control is
 * only on the form of a device whose description has all of them. `also`: a combo box named
 * `SHORT_ON_LEVEL|LONG_ON_LEVEL` shows the first and writes its value to both.
 *
 * @typedef {{kind: 'time', prefix: string, selector: string, labelKey?: string, requires?: string[]}
 *   | {kind: 'param', param: string, also?: string[], option?: string, labelKey?: string, requires?: string[]}
 *   | {kind: 'subset', subsets: number[], labelKey?: string, requires?: string[]}} EasyControl
 */

const PARAM = /\b((?:SHORT|LONG)_[A-Z0-9_]+)\b/gu;

/** Commands whose `$param` argument is the parameter the control edits. */
const PARAM_ELEMENTS = new Set([
    'getSelectColorElement',
    'getSelectBehaviourElement',
    'getSelectEffectElement',
    'getRepetitionSelector',
    'getOutputBehaviourElement',
    'getSoundSelector',
]);

/** Commands that only accompany a control named elsewhere (the free entry of a combo box). */
const COMPANIONS = new Set(['EnterTime_h_m_s', 'EnterPercent', 'EnterTimeBase', 'EnterTime', 'cmd_link_paramset2']);

/** The body of `proc set_htmlParams`, or `undefined` when the file has none. */
export function htmlParamsBody(source) {
    const start = source.search(/^proc set_htmlParams\b/mu);
    if (start < 0) {
        return undefined;
    }
    const rest = source.slice(start + 1);
    const next = rest.search(/^proc \w/mu);
    return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/** Strips a TCL comment line and the trailing `;# ...` comment of a command. */
function stripComment(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
        return '';
    }
    const at = line.indexOf(';#');
    return at < 0 ? line : line.slice(0, at);
}

/** The words after `command` on the line, split on whitespace, brackets and quotes dropped. */
function argsAfter(line, command) {
    const at = line.indexOf(command);
    return line
        .slice(at + command.length)
        .replace(/[[\]"]/gu, ' ')
        .split(/\s+/u)
        .filter((word) => word !== '');
}

/** The label key of the row a control sits in: `<td>\${KEY}</td>` or `<td>${KEY}</td>`. */
function labelKeyOf(line) {
    const match = /<td>\\?\$\{([A-Za-z0-9_]+)\}/u.exec(line);
    return match?.[1];
}

/**
 * The controls of every profile's form, keyed by profile number. A profile whose form names no
 * control is left out rather than listed empty, so the app falls back to its own view there.
 *
 * @param {string} source the whole TCL file
 * @returns {Record<string, EasyControl[]>}
 */
export function extractForms(source) {
    const body = htmlParamsBody(source);
    if (body === undefined) {
        return {};
    }
    /** @type {Record<string, EasyControl[]>} */
    const forms = {};
    let prn = -1;
    let option;
    let param;
    let labelKey;

    /** @type {Array<{depth: number, requires?: string}>} */
    const blocks = [];
    let depth = 0;

    const add = (control) => {
        if (prn <= 0) {
            return;
        }
        const list = (forms[String(prn)] ??= []);
        const same = list.some((entry) =>
            entry.kind === 'time' && control.kind === 'time'
                ? entry.prefix === control.prefix
                : entry.kind === 'param' && control.kind === 'param'
                  ? entry.param === control.param
                  : false,
        );
        if (same) {
            return;
        }
        const requires = [...new Set(blocks.map((block) => block.requires).filter((name) => name !== undefined))];
        /** @type {EasyControl} */
        let entry = control;
        if (control.kind !== 'time' && labelKey !== undefined) entry = {...entry, labelKey};
        if (requires.length > 0) entry = {...entry, requires};
        list.push(entry);
        labelKey = undefined;
    };

    for (const raw of body.split('\n')) {
        const line = stripComment(raw);
        if (line.trim() === '') {
            continue;
        }
        // blocks: `if {[info exists ps(X)] == 1} {` opens one that asks for X; `${KEY}` is text
        const braces = line.replace(/\\?\$\{[^}]*\}/gu, '').replace(/\\[{}]/gu, '');
        const opened = (braces.match(/\{/gu) ?? []).length - (braces.match(/\}/gu) ?? []).length;
        const exists = /if\s*\{\s*\[info exists ps\((\$param|(?:SHORT|LONG)_[A-Z0-9_]+)\)\]/u.exec(line);
        if (/^\s*\}/u.test(braces)) {
            // `}` or `} else {`: the block at this depth ends here
            const closing = depth - 1;
            while (blocks.length > 0 && blocks[blocks.length - 1].depth >= closing) blocks.pop();
        }
        if (opened > 0 || /\{\s*$/u.test(braces)) {
            const requires = exists ? (exists[1] === '$param' ? param : exists[1]) : undefined;
            if (/\{\s*$/u.test(braces)) {
                blocks.push(requires === undefined || /\belse\b/u.test(line) ? {depth} : {depth, requires});
            }
        }
        depth = Math.max(0, depth + opened);
        let match;
        if ((match = /^\s*set prn\s+(\d+)/u.exec(line))) {
            prn = Number(match[1]);
            continue;
        }
        if (/^\s*incr prn\b/u.test(line)) {
            prn += 1;
            continue;
        }
        if ((match = /^\s*option\s+(\w+)/u.exec(line))) {
            option = match[1];
            continue;
        }
        if ((match = /^\s*set param\s+((?:SHORT|LONG)_[A-Z0-9_]+)/u.exec(line))) {
            param = match[1];
            continue;
        }
        const rowLabel = labelKeyOf(line);
        if (rowLabel !== undefined) {
            labelKey = rowLabel;
        }
        if (line.includes('getTimeSelector')) {
            const args = argsAfter(line, 'getTimeSelector');
            // DESCR ps PROFILE_$prn <type> $prn $special_input_id <PREFIX> ...
            const prefix = args.find((word) => /^(?:SHORT|LONG)_[A-Z0-9_]+$/u.test(word));
            if (prefix !== undefined && args[3] !== undefined) {
                add({kind: 'time', prefix, selector: args[3], labelKey: args[0]});
            }
            continue;
        }
        if (line.includes('get_ComboBox options')) {
            const target = argsAfter(line, 'get_ComboBox options')[0];
            if (target !== undefined && /^(?:SHORT|LONG)_/u.test(target)) {
                const [first, ...also] = target.split('|');
                add({
                    kind: 'param',
                    param: first,
                    ...(also.length > 0 ? {also} : {}),
                    ...(option === undefined ? {} : {option}),
                });
            }
            option = undefined;
            continue;
        }
        if (line.includes('subset2combobox')) {
            const names = /subset2combobox\s+\{([^}]*)\}/u.exec(line)?.[1] ?? '';
            const subsets = [...names.matchAll(/SUBSET_(\d+)/gu)].map((entry) => Number(entry[1]));
            if (subsets.length > 0) {
                add({kind: 'subset', subsets});
            }
            continue;
        }
        // only what goes onto the form draws a control; `if {[info exists ps(X)]}` merely asks
        if (!line.includes('append HTML_PARAMS')) {
            continue;
        }
        const command = /\[\s*(\w+)/u.exec(line)?.[1];
        if (command === undefined || COMPANIONS.has(command)) {
            continue;
        }
        if (PARAM_ELEMENTS.has(command) && line.includes('$param') && param !== undefined) {
            add({kind: 'param', param});
            continue;
        }
        for (const found of line.matchAll(PARAM)) {
            const name = found[1];
            // `PROFILE_$prn` etc. never match; a time pair named literally is covered by its selector
            if (!/_TIME_(?:BASE|FACTOR)$/u.test(name) || !(forms[String(prn)] ?? []).some((c) => c.kind === 'time')) {
                add({kind: 'param', param: name});
            }
        }
    }
    return forms;
}

/**
 * The options of each `getTimeSelector` type, from `getComboBox` in `etc/hmip_helper.tcl`: the
 * `<option>` label keys of the procedure each type calls, in order.
 *
 * @param {string} helper `hmip_helper.tcl`
 * @returns {Record<string, string[]>}
 */
export function extractTimeSelectorOptions(helper) {
    const at = helper.search(/^proc getComboBox /mu);
    const after = at < 0 ? '' : helper.slice(at + 1);
    const dispatcher = at < 0 ? '' : after.slice(0, Math.max(0, after.search(/^proc \w/mu)));
    /** @type {Record<string, string>} */
    const procOf = {};
    for (const match of dispatcher.matchAll(/"(\w+)"\s*\{\s*append s \[(\w+)/gu)) {
        procOf[match[1]] = match[2];
    }
    /** @type {Record<string, string[]>} */
    const result = {};
    for (const [type, name] of Object.entries(procOf)) {
        const start = helper.search(new RegExp(`^proc ${name} \\{`, 'mu'));
        if (start < 0) {
            continue;
        }
        const rest = helper.slice(start + 1);
        const end = rest.search(/^proc \w/mu);
        const proc = end < 0 ? helper.slice(start) : helper.slice(start, start + 1 + end);
        // the <select> of the procedure, not the `setCurrent...Option` script after it
        const select = proc.slice(0, proc.indexOf('</select>') >= 0 ? proc.indexOf('</select>') : proc.length);
        const keys = [...select.matchAll(/<option value=\\"\d+\\">\\\$\{(\w+)\}<\/option>/gu)].map((m) => m[1]);
        if (keys.length > 0) {
            result[type] = keys;
        }
    }
    return result;
}

const UNIT_SECONDS = {MS: 0.001, S: 1, M: 60, H: 3600};

/**
 * What a time selector's option stands for: seconds for `optionUnit<n><MS|S|M|H>`, or a special
 * meaning. `undefined` for a key this does not know (the app then leaves the option out).
 *
 * @returns {{seconds: number} | {special: 'notActive' | 'permanent' | 'enterValue'} | undefined}
 */
export function timeOptionMeaning(key) {
    const unit = /^optionUnit(\d+)(MS|S|M|H)$/u.exec(key);
    if (unit) {
        return {seconds: Math.round(Number(unit[1]) * UNIT_SECONDS[unit[2]] * 1000) / 1000};
    }
    if (key === 'optionNotActive') return {special: 'notActive'};
    if (key === 'stringTablePermanent') return {special: 'permanent'};
    if (key === 'stringTableEnterValue') return {special: 'enterValue'};
    return undefined;
}

/**
 * The `"key" : "value",` lines of a WebUI localization file, with the HTML wrapper and the entities
 * the WebUI uses taken out.
 *
 * @returns {Record<string, string>}
 */
export function parseLocalization(text) {
    /** @type {Record<string, string>} */
    const result = {};
    for (const match of text.matchAll(/^\s*"([A-Za-z0-9_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/gmu)) {
        const value = decodeEntities(match[2].replace(/\\"/gu, '"').replace(/<[^>]+>/gu, ''))
            .replace(/\s+/gu, ' ')
            .trim();
        if (value !== '') {
            result[match[1]] = value;
        }
    }
    return result;
}

const ENTITIES = {
    '&auml;': 'ä',
    '&ouml;': 'ö',
    '&uuml;': 'ü',
    '&Auml;': 'Ä',
    '&Ouml;': 'Ö',
    '&Uuml;': 'Ü',
    '&szlig;': 'ß',
    '&quot;': '"',
    '&amp;': '&',
    '&nbsp;': ' ',
    '&deg;': '°',
    '&lt;': '<',
    '&gt;': '>',
};

function decodeEntities(text) {
    return text.replace(/&[a-zA-Z]+;/gu, (entity) => ENTITIES[entity] ?? entity);
}
