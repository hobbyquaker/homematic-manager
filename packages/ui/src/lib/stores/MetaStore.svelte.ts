import type {
    DataManifest,
    DataSource,
    Language,
    LinkProfile,
    LinkSenderMetadata,
    MasterView,
    Paramset,
    ParamsetDescription,
    Transport,
} from '@homematic-manager/core';
import {EasyModeEngine, TranslationLookup} from '@homematic-manager/core';

import {TransportDataSource} from './dataSource.js';

export interface MetaStoreOptions {
    /** Injected by the tests; defaults to a {@link TransportDataSource} over the transport. */
    readonly source?: DataSource | undefined;
}

/**
 * The metadata layer of the paramset and link dialogs: labels, help texts, MASTER order and
 * visibility, option presets, cross-validation and the easy-mode profiles.
 *
 * 2.x had three sources for this - `stringtable.json` (90 kB, German only), `helpLinkParamset.json`
 * and the hand-converted `www/easymodes/` - and none of them covered HmIP (#22, #50, #119). All of
 * it now comes from the pipeline of task 9 through core's `EasyModeEngine` and `TranslationLookup`.
 * Everything degrades: without the data the labels are the CCU's identifiers, which is what the
 * dialog showed for an untranslated parameter before.
 */
export class MetaStore {
    /** The lookup for the current language; replaced (not mutated) when translations arrive. */
    lookup = $state(new TranslationLookup());
    /** True once the manifest answered - the About dialog shows what the data set is. */
    manifest = $state<DataManifest | undefined>(undefined);
    /** False when the host serves no `data/` root at all. */
    available = $state(false);

    readonly source: DataSource;
    readonly engine: EasyModeEngine;

    #language: Language | undefined;
    #loading: Promise<void> | undefined;

    constructor(transport: Transport, options: MetaStoreOptions = {}) {
        this.source = options.source ?? new TransportDataSource(transport);
        this.engine = new EasyModeEngine(this.source);
    }

    /**
     * Loads the translations for a language, with `en` and `de` behind it so a missing German
     * string shows the English one rather than the raw identifier (D-15, #119).
     */
    async setLanguage(language: Language): Promise<void> {
        if (this.#language === language) {
            await this.#loading;
            return;
        }
        this.#language = language;
        const pending = (async () => {
            const fallbacks: Language[] = ['en', 'de'];
            const wanted: Language[] = [language, ...fallbacks.filter((code) => code !== language)];
            const loaded = await Promise.all(wanted.map((code) => this.source.translations(code)));
            const [primary, ...rest] = loaded;
            this.lookup = new TranslationLookup(primary, ...rest);
            this.available = loaded.some((entry) => entry !== undefined);
            this.manifest = await this.source.manifest();
        })();
        this.#loading = pending;
        await pending;
    }

    /** The MASTER view of a channel type: order, visibility, presets and the failing rules. */
    masterView(channelType: string, description: ParamsetDescription, values: Paramset = {}): Promise<MasterView> {
        return this.engine.masterMetadataFor(channelType, description, values);
    }

    profilesFor(receiverType: string, senderType: string): Promise<LinkProfile[]> {
        return this.engine.profilesFor(receiverType, senderType);
    }

    linkMetadataFor(receiverType: string, senderType: string): Promise<LinkSenderMetadata | undefined> {
        return this.engine.linkMetadataFor(receiverType, senderType);
    }

    /** The label of a parameter, `CHANNEL_TYPE|PARAM` first, then the bare name, then the name. */
    parameterLabel(param: string, channelType?: string): string {
        return this.lookup.parameter(param, channelType);
    }

    parameterHelp(param: string, channelType?: string): string | undefined {
        return this.lookup.parameterHelp(param, channelType);
    }

    /** The label of one enum value; falls back to the `VALUE_LIST` name itself. */
    valueLabel(param: string, value: string, channelType?: string): string {
        return this.lookup.parameterValue(param, value, channelType);
    }

    channelTypeLabel(channelType: string): string {
        return this.lookup.channelType(channelType);
    }

    deviceModelLabel(deviceType: string): string {
        return this.lookup.deviceModel(deviceType);
    }

    /** A WebUI label by its own key - what `OptionPresetEntry.labelKey` and `errorKey` point at. */
    uiLabel(key: string): string {
        return this.lookup.uiLabel(key);
    }
}
