import type {DeviceDescription} from '@homematic-manager/core';

import type {MultiSelectOption} from 'occulite-ui';

/**
 * One entry of the link dialog's sender or receiver list (task 31).
 *
 * The maintainer, 2026-09-12: "nur der kanal und der gerätenamen im dropdown [...] zweizeilig
 * angelegten items, kanalname gross, device name klein dahinter in der zeile darunter noch der
 * kanalindex und der kanaltyp in klein". The entry used to be `<name> — <address>`, and a CCU's
 * default channel name already contains the device type and the address, so the list read as a
 * column of addresses.
 *
 * - `label`: the channel's name, or its address when it has none;
 * - `hint`: the device's name, or the device address when it has none;
 * - `description`: `<INDEX>: <TYPE>`.
 *
 * The address itself is not printed any more. It stays the `value`, and the filter searches it.
 *
 * `PARENT` and `INDEX` are optional in a description, so both fall back to the two halves of the
 * channel address - `ABC0000001:3` is channel 3 of `ABC0000001` on every interface process.
 */
export function channelOption(
    channel: DeviceDescription,
    name: (address: string) => string | undefined,
): MultiSelectOption {
    const separator = channel.ADDRESS.lastIndexOf(':');
    const device = channel.PARENT ?? (separator < 0 ? channel.ADDRESS : channel.ADDRESS.slice(0, separator));
    const index = channel.INDEX === undefined ? channel.ADDRESS.slice(separator + 1) : String(channel.INDEX);
    return {
        value: channel.ADDRESS,
        label: name(channel.ADDRESS) ?? channel.ADDRESS,
        hint: name(device) ?? device,
        description: `${index}: ${channel.TYPE}`,
    };
}
