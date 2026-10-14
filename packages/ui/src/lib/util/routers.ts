import type {DeviceDescription, Paramset, ParamsetDescription} from '@homematic-manager/core';
import {asStringList} from '@homematic-manager/core';

/**
 * Task 97: HmIP routers. A device with a router module has `ROUTER_MODULE_ENABLED` ("Device serves
 * as router") in the MASTER paramset of its maintenance channel; whether it routes is that
 * parameter's value.
 *
 * Not to be confused with `ENABLE_ROUTING` ("Routing active"), which nearly every HmIP device has,
 * battery devices too: it lets the device itself talk through a router when it cannot reach the
 * access point. It says nothing about forwarding for others and is not looked at here.
 *
 * Measured in the lab (2026-10-14): hmipserver answers `getParamset(<device>:0, MASTER)` from its
 * configuration cache (`RESPONSE_CONFIG_DATA`, no frame on air), so reading the values of the
 * router-capable devices costs no duty cycle. The routing table (`ROUTING_TABLE`) is a different
 * matter: that one is read from the device over the air, see `routingTable.ts`.
 */
export const ROUTER_PARAMETER = 'ROUTER_MODULE_ENABLED';

/** The paramset task 26 draws, offered by a router whose server lists it. */
export const ROUTING_TABLE_PARAMSET = 'ROUTING_TABLE';

/** Does this MASTER description of channel 0 belong to a device that can route? */
export function isRouterCapable(description: ParamsetDescription | undefined): boolean {
    return description !== undefined && Object.hasOwn(description, ROUTER_PARAMETER);
}

/** The value of the parameter, `undefined` when the paramset does not carry it. */
export function routingEnabled(values: Paramset | undefined): boolean | undefined {
    const value = values?.[ROUTER_PARAMETER];
    if (value === undefined) {
        return undefined;
    }
    return value === true || value === 1 || value === '1' || value === 'true';
}

/** The maintenance channel of a device, whose MASTER carries the router switch. */
export function maintenanceAddress(deviceAddress: string): string {
    return `${deviceAddress}:0`;
}

/**
 * Where the routing table of a router is read: the first of the device and its channel 0 whose
 * `PARAMSETS` lists `ROUTING_TABLE`. `undefined` when neither does - then the server does not
 * offer the table for this device, and asking anyway would send a frame the device does not
 * answer (seen in the lab: retried for about 40 s, then `UNREACH`).
 */
export function routingTableAddress(
    device: DeviceDescription,
    maintenance: DeviceDescription | undefined,
): string | undefined {
    for (const candidate of [device, maintenance]) {
        if (candidate !== undefined && (asStringList(candidate.PARAMSETS) ?? []).includes(ROUTING_TABLE_PARAMSET)) {
            return candidate.ADDRESS;
        }
    }
    return undefined;
}

/** One router-capable device as the Routers view lists it. */
export interface RouterState {
    readonly address: string;
    /** `undefined` while the MASTER values have not been read (or the read failed). */
    readonly enabled: boolean | undefined;
}

/** "n of m route": how many capable devices have the router module switched on. */
export function routerCount(states: readonly RouterState[]): {routing: number; capable: number} {
    return {routing: states.filter((state) => state.enabled === true).length, capable: states.length};
}
