import type {
    DeviceDescription,
    InstallModeOptions,
    RepairConfigOptions,
    RepairConfigResult,
    Transport,
} from '@homematic-manager/core';
import {DeviceIndex} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * The devices of every interface that has been visited, as core's immutable `DeviceIndex`.
 *
 * 2.x kept `listDevices`, `indexChannels`, `indexSourceRoles` and `indexTargetRoles` as globals and
 * rebuilt them while rendering the grid; switching interfaces mid-request could mix two interfaces'
 * devices into one index. Here every interface has its own index, and a late answer for an
 * interface is still stored under that interface - never under the one that happens to be selected.
 */
export class DevicesStore {
    /** Interface name -> index. Reassigned on every change so the components re-render. */
    indexes = $state<Record<string, DeviceIndex>>({});
    loading = $state<Record<string, boolean>>({});
    /** Addresses whose firmware update was asked for and has not finished; the grid marks them. */
    firmwareBusy = $state<string[]>([]);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe.push(
            transport.on('devices.changed', (change) => {
                if (this.indexes[change.interfaceName]) {
                    void this.load(change.interfaceName, {refresh: false});
                }
            }),
        );
    }

    index(interfaceName: string): DeviceIndex | undefined {
        return this.indexes[interfaceName];
    }

    /** The devices of an interface, sorted by address; empty while nothing is loaded. */
    devices(interfaceName: string): DeviceDescription[] {
        return this.indexes[interfaceName]?.devices() ?? [];
    }

    channels(interfaceName: string, deviceAddress: string): DeviceDescription[] {
        return this.indexes[interfaceName]?.childrenOf(deviceAddress) ?? [];
    }

    isLoading(interfaceName: string): boolean {
        return this.loading[interfaceName] === true;
    }

    /** Loads (or reloads) one interface. `refresh` bypasses the backend's device cache. */
    async load(interfaceName: string, options: {refresh?: boolean} = {}): Promise<void> {
        if (interfaceName === '') {
            return;
        }
        this.loading = {...this.loading, [interfaceName]: true};
        try {
            const descriptions = await this.#transport.request('devices.list', interfaceName, {
                refresh: options.refresh ?? false,
            });
            this.indexes = {...this.indexes, [interfaceName]: new DeviceIndex(interfaceName, descriptions)};
            this.settleFirmware(interfaceName);
        } catch (error) {
            this.#notices.fromError(error, `devices.list ${interfaceName}`);
        } finally {
            this.loading = {...this.loading, [interfaceName]: false};
        }
    }

    /**
     * Issue #97: the teams this interface process knows. A BidCos smoke detector is not linked to
     * the others - it belongs to a team, a pseudo device the interface creates and deletes itself.
     */
    async teams(interfaceName: string): Promise<DeviceDescription[]> {
        try {
            return await this.#transport.request('teams.list', interfaceName);
        } catch (error) {
            this.#notices.fromError(error, `listTeams ${interfaceName}`);
            return [];
        }
    }

    /** `setTeam`: puts a channel into a team, or back into its own with an empty address. */
    async setTeam(interfaceName: string, address: string, teamAddress: string): Promise<boolean> {
        try {
            await this.#transport.request('teams.set', interfaceName, address, teamAddress);
            await this.load(interfaceName, {refresh: true});
            return true;
        } catch (error) {
            this.#notices.fromError(error, `setTeam ${address}`);
            return false;
        }
    }

    /**
     * Issue #54: confirm every device that is still in the CCU's inbox. Answers with the addresses,
     * and with nothing at all when ReGa is off (D-2) - which is not an error, just a system that
     * has no inbox.
     */
    async confirmRegaInbox(): Promise<string[]> {
        try {
            return await this.#transport.request('rega.confirmInbox');
        } catch (error) {
            this.#notices.fromError(error, 'rega.confirmInbox');
            return [];
        }
    }

    /** Ensures an interface is loaded once; a second call while it is present does nothing. */
    async ensure(interfaceName: string): Promise<void> {
        if (interfaceName === '' || this.indexes[interfaceName] || this.isLoading(interfaceName)) {
            return;
        }
        await this.load(interfaceName);
    }

    /**
     * The firmware states that mean "something is still happening": hmipserver reports its progress
     * in `FIRMWARE_UPDATE_STATE`, rfd only sets `AVAILABLE_FIRMWARE` and clears it when the device
     * has taken the image. While one of them is true the page polls (issues #95 and #113: 2.x
     * showed the state it had read at start-up until the user switched interfaces and back).
     */
    firmwarePending(interfaceName: string): boolean {
        if (this.firmwareBusy.length > 0) {
            return true;
        }
        return this.devices(interfaceName).some((device) =>
            ['DELIVER_FIRMWARE_IMAGE', 'PERFORMING_UPDATE', 'READY_FOR_UPDATE'].includes(
                device.FIRMWARE_UPDATE_STATE ?? '',
            ),
        );
    }

    /**
     * `updateFirmware` on BidCos: the interface fetches the image and sends it at the device's next
     * wake-up, so the answer says only "accepted". The addresses stay in {@link firmwareBusy} until
     * a `devices.list` shows the new `FIRMWARE`, which is what makes the button live (#95, #113).
     */
    async updateFirmware(interfaceName: string, addresses: string[]): Promise<boolean[]> {
        if (addresses.length === 0) {
            return [];
        }
        this.firmwareBusy = [...this.firmwareBusy, ...addresses.filter((busy) => !this.firmwareBusy.includes(busy))];
        try {
            const accepted = await this.#transport.request('devices.updateFirmware', interfaceName, addresses);
            await this.load(interfaceName, {refresh: true});
            return accepted;
        } catch (error) {
            this.#notices.fromError(error, `devices.updateFirmware ${addresses.join(' ')}`);
            this.firmwareBusy = this.firmwareBusy.filter((address) => !addresses.includes(address));
            return [];
        }
    }

    /** `installFirmware` on HmIP: the image is already on the access point, this starts the flash. */
    async installFirmware(interfaceName: string, address: string): Promise<boolean> {
        this.firmwareBusy = this.firmwareBusy.includes(address) ? this.firmwareBusy : [...this.firmwareBusy, address];
        try {
            const started = await this.#transport.request('devices.installFirmware', interfaceName, address);
            await this.load(interfaceName, {refresh: true});
            return started;
        } catch (error) {
            this.#notices.fromError(error, `devices.installFirmware ${address}`);
            this.firmwareBusy = this.firmwareBusy.filter((busy) => busy !== address);
            return false;
        }
    }

    /** Forgets the "busy" mark of every address whose firmware is now the available one. */
    settleFirmware(interfaceName: string): void {
        const index = this.indexes[interfaceName];
        if (!index) {
            return;
        }
        const done = this.firmwareBusy.filter((address) => {
            const device = index.get(address);
            return (
                device !== undefined &&
                (device.AVAILABLE_FIRMWARE === undefined || device.AVAILABLE_FIRMWARE === device.FIRMWARE)
            );
        });
        if (done.length > 0) {
            this.firmwareBusy = this.firmwareBusy.filter((address) => !done.includes(address));
        }
    }

    /**
     * `deleteDevice`. The flags are the two dropdowns of the 2.x dialog added together: 1 reset to
     * factory defaults or 0 unlearn only, plus 4 "delete at the next opportunity" or 2 "delete from
     * the interface process only".
     */
    async remove(interfaceName: string, address: string, flags: number): Promise<boolean> {
        try {
            await this.#transport.request('devices.delete', interfaceName, address, flags);
            await this.load(interfaceName, {refresh: true});
            return true;
        } catch (error) {
            this.#notices.fromError(error, `deleteDevice ${address}`);
            return false;
        }
    }

    /** The devices a `replaceDevice` may put in place of this one - same type, already unreachable. */
    async replaceable(interfaceName: string, address: string): Promise<DeviceDescription[]> {
        try {
            return await this.#transport.request('devices.replaceable', interfaceName, address);
        } catch (error) {
            this.#notices.fromError(error, `devices.replaceable ${address}`);
            return [];
        }
    }

    async replace(interfaceName: string, oldAddress: string, newAddress: string): Promise<boolean> {
        try {
            const ok = await this.#transport.request('devices.replace', interfaceName, oldAddress, newAddress);
            await this.load(interfaceName, {refresh: true});
            return ok;
        } catch (error) {
            this.#notices.fromError(error, `replaceDevice ${oldAddress} ${newAddress}`);
            return false;
        }
    }

    /**
     * The recovery of task 6.7: a valid full MASTER re-write built from the channel's own
     * description. `dryRun` works the repair out without sending anything, which is what the dialog
     * shows before it asks.
     */
    async repairConfig(
        interfaceName: string,
        address: string,
        options?: RepairConfigOptions,
    ): Promise<RepairConfigResult | undefined> {
        try {
            return await this.#transport.request('devices.repairConfig', interfaceName, address, options);
        } catch (error) {
            this.#notices.fromError(error, `devices.repairConfig ${address}`);
            return undefined;
        }
    }

    async restoreConfig(interfaceName: string, address: string): Promise<boolean> {
        try {
            await this.#transport.request('devices.restoreConfig', interfaceName, address);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `restoreConfigToDevice ${address}`);
            return false;
        }
    }

    async clearConfigCache(interfaceName: string, address: string): Promise<boolean> {
        try {
            await this.#transport.request('devices.clearConfigCache', interfaceName, address);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `clearConfigCache ${address}`);
            return false;
        }
    }

    /**
     * `reportValueUsage` for every parameter of a channel's VALUES paramset, on any number of
     * channels (issue #18, PR #138 - 2.x could only do the one selected channel).
     *
     * Returns how many calls succeeded. The first failure per channel stops that channel and
     * becomes a notice; the other channels are still done, which is what a bulk action has to do.
     */
    async reportValueUsage(interfaceName: string, addresses: readonly string[], refCounter: number): Promise<number> {
        let done = 0;
        for (const address of addresses) {
            let description;
            try {
                description = await this.#transport.request('paramset.description', interfaceName, address, 'VALUES');
            } catch (error) {
                this.#notices.fromError(error, `getParamsetDescription ${address} VALUES`);
                continue;
            }
            for (const parameter of Object.keys(description)) {
                try {
                    await this.#transport.request(
                        'devices.reportValueUsage',
                        interfaceName,
                        address,
                        parameter,
                        refCounter,
                    );
                    done += 1;
                } catch (error) {
                    this.#notices.fromError(error, `reportValueUsage ${address} ${parameter}`);
                    break;
                }
            }
        }
        return done;
    }

    /** `setInstallMode`, with the BidCos temporary key and the HmIP key of the contract. */
    async setInstallMode(interfaceName: string, on: boolean, options?: InstallModeOptions): Promise<boolean> {
        try {
            await this.#transport.request('devices.installMode.set', interfaceName, on, options);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'setInstallMode');
            return false;
        }
    }

    /** Seconds left of the install mode; 0 when it is off. */
    async installModeSeconds(interfaceName: string): Promise<number> {
        try {
            return await this.#transport.request('devices.installMode.get', interfaceName);
        } catch (error) {
            this.#notices.fromError(error, 'getInstallMode');
            return 0;
        }
    }

    /** Drops one interface's index, or all of them. */
    forget(interfaceName?: string): void {
        if (interfaceName === undefined) {
            this.indexes = {};
            return;
        }
        this.indexes = Object.fromEntries(Object.entries(this.indexes).filter(([name]) => name !== interfaceName));
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
