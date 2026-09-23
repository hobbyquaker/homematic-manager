/**
 * What renaming a device or a channel writes: one rule for every dialog that renames (task 65).
 *
 * The rule is 2.x's with the maintainer's `:0` convention of 2026-09-20 on top:
 *
 * - a device renames its maintenance channel with it, always, as `<name>:0` - ReGa never let
 *   anybody name `:0` on its own, and the app keeps that whichever store holds the names;
 * - with `channels` every other channel of the device becomes `<name>:<index>`, the index the
 *   channel carries itself (2.x took the position in `CHILDREN`, which is the same number until
 *   the list has a gap);
 * - a channel other than `:0` is renamed alone;
 * - `:0` on its own is never renamed, and neither is anything with an empty name.
 *
 * The channel list is the device's as the caller has it right now. A device whose channels have
 * not arrived yet still gets its name and its `:0`, never half of the other channels - they come
 * with the list or not at all.
 */

import {tryParseAddress} from './address.js';

/** One name to write. */
export interface RenameEntry {
    readonly address: string;
    readonly name: string;
}

export interface RenameOptions {
    /** Name every channel but `:0` after the device as well ("Overwrite channel names"). */
    readonly channels: boolean;
}

export function renameEntries(
    address: string,
    name: string,
    channels: readonly string[],
    options: RenameOptions,
): RenameEntry[] {
    const trimmed = name.trim();
    const parsed = tryParseAddress(address);
    if (trimmed === '' || parsed === undefined || parsed.isMaintenance) {
        return [];
    }
    if (!parsed.isDevice) {
        return [{address, name: trimmed}];
    }
    const list: RenameEntry[] = [
        {address, name: trimmed},
        {address: `${address}:0`, name: `${trimmed}:0`},
    ];
    if (!options.channels) {
        return list;
    }
    const seen = new Set<number>([0]);
    for (const channel of channels) {
        const child = tryParseAddress(channel);
        if (child?.index === undefined || child.device !== address || seen.has(child.index)) {
            continue;
        }
        seen.add(child.index);
        list.push({address: channel, name: `${trimmed}:${String(child.index)}`});
    }
    return list;
}
