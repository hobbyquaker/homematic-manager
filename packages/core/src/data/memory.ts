/**
 * An in-memory `DataSource`.
 *
 * The core never reads a file. Tests use this implementation, the Electron host and the web host
 * bring their own (IPC and fetch), and the pipeline of task 9 writes the files all three read.
 */

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
    Translations,
} from './types.js';

/** Everything a {@link MemoryDataSource} can hold; every part is optional and defaults to empty. */
export interface MemoryData {
    readonly manifest?: DataManifest;
    /** Keyed by receiver channel type, as `profiles/<RECEIVER_TYPE>.json`. */
    readonly profiles?: Readonly<Record<string, ReceiverProfiles>>;
    readonly receiverTypeAliases?: ReceiverTypeAliases;
    readonly masterMetadata?: Readonly<Record<string, MasterMetadata>>;
    readonly optionPresets?: Readonly<Record<string, OptionPreset>>;
    readonly crossValidations?: readonly CrossValidationRule[];
    readonly translations?: Partial<Record<Language, Translations>>;
    readonly deviceIcons?: DeviceIcons;
}

/** A `DataSource` over data that is already in memory. */
export class MemoryDataSource implements DataSource {
    readonly #data: MemoryData;

    constructor(data: MemoryData = {}) {
        this.#data = data;
    }

    manifest(): Promise<DataManifest | undefined> {
        return Promise.resolve(this.#data.manifest);
    }

    receiverProfiles(receiverType: string): Promise<ReceiverProfiles | undefined> {
        return Promise.resolve(this.#data.profiles?.[receiverType]);
    }

    receiverTypeAliases(): Promise<ReceiverTypeAliases> {
        return Promise.resolve(this.#data.receiverTypeAliases ?? {});
    }

    masterMetadata(): Promise<Record<string, MasterMetadata>> {
        return Promise.resolve({...this.#data.masterMetadata});
    }

    optionPresets(): Promise<Record<string, OptionPreset>> {
        return Promise.resolve({...this.#data.optionPresets});
    }

    crossValidations(): Promise<CrossValidationRule[]> {
        return Promise.resolve([...(this.#data.crossValidations ?? [])]);
    }

    translations(language: Language): Promise<Translations | undefined> {
        return Promise.resolve(this.#data.translations?.[language]);
    }

    deviceIcons(): Promise<DeviceIcons> {
        return Promise.resolve({...this.#data.deviceIcons});
    }
}
