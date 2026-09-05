import type {
    CrossValidationRule,
    DataManifest,
    DataSource,
    DeviceIcons,
    Language,
    MasterMetadata,
    OptionPreset,
    ReceiverProfiles,
    ReceiverTypeAliases,
    Transport,
    Translations,
} from '@homematic-manager/core';
import {DATA_FILES} from '@homematic-manager/core';

/**
 * The device metadata of task 9, read through the one method the contract has for files.
 *
 * `data/dist/` is 9.2 MB of JSON; nothing loads it eagerly. Every file is fetched the first time
 * something asks for it and then kept, and a file the host does not serve resolves `undefined`
 * rather than rejecting - a backend without the data directory (a bare rfd, a stripped addon) must
 * still open every dialog, only without the pretty labels and the easy modes.
 */
export class TransportDataSource implements DataSource {
    readonly #transport: Transport;
    readonly #cache = new Map<string, Promise<unknown>>();

    constructor(transport: Transport) {
        this.#transport = transport;
    }

    /** Which files were asked for; the tests assert that nothing is fetched twice. */
    get requested(): string[] {
        return [...this.#cache.keys()];
    }

    async #file<T>(path: string): Promise<T | undefined> {
        let pending = this.#cache.get(path);
        if (pending === undefined) {
            pending = this.#transport.request('data.file', `data/${path}`).catch(() => undefined);
            this.#cache.set(path, pending);
        }
        return (await pending) as T | undefined;
    }

    manifest(): Promise<DataManifest | undefined> {
        return this.#file<DataManifest>(DATA_FILES.manifest);
    }

    receiverProfiles(receiverType: string): Promise<ReceiverProfiles | undefined> {
        return this.#file<ReceiverProfiles>(DATA_FILES.profiles(receiverType));
    }

    async receiverTypeAliases(): Promise<ReceiverTypeAliases> {
        return (await this.#file<ReceiverTypeAliases>(DATA_FILES.receiverTypeAliases)) ?? {};
    }

    async masterMetadata(): Promise<Record<string, MasterMetadata>> {
        return (await this.#file<Record<string, MasterMetadata>>(DATA_FILES.masterMetadata)) ?? {};
    }

    async optionPresets(): Promise<Record<string, OptionPreset>> {
        return (await this.#file<Record<string, OptionPreset>>(DATA_FILES.optionPresets)) ?? {};
    }

    async crossValidations(): Promise<CrossValidationRule[]> {
        return (await this.#file<CrossValidationRule[]>(DATA_FILES.crossValidations)) ?? [];
    }

    translations(language: Language): Promise<Translations | undefined> {
        return this.#file<Translations>(DATA_FILES.translations(language));
    }

    async deviceIcons(): Promise<DeviceIcons> {
        return (await this.#file<DeviceIcons>(DATA_FILES.deviceIcons)) ?? {};
    }
}
