/**
 * Issue #21: "Direktverknüpfungen Profilvorlagen anlegen und anwenden".
 *
 * A link paramset is the one place where the same handful of values is typed in again and again: a
 * wall switch against six blinds is six links whose easy-mode profile and whose short/long press
 * timings are meant to be identical. 2.7 had the profiles of the metadata but no way to keep a
 * *tuned* one, so the tuning was done six times.
 *
 * A template is the profile plus the values it was tuned to, under a name. It is stored in the
 * **profile directory** (`<dataDir>/link-templates.json`), not in the per-CCU cache: a template is
 * the user's own work, it is not derived from any CCU, and moving the profile to another install
 * (`docs/moving-between-installs.md`) has to take it along.
 *
 * The `identity` is the guard rail. It is the paramset identity of the receiver's `LINK` paramset
 * and of the sender's, joined - so device type, firmware, version and channel type on both sides.
 * A template can only be applied where the description is literally the same, for the same reason
 * multi-apply is limited that way (task 6, item 3): a value that means one thing on one firmware
 * can mean something else on another, and `putParamset` accepts both without a word.
 */

import type {LinkTemplate, ParamsetWrite} from '@homematic-manager/core';

import {validationError} from '../errors.js';
import {readJsonFile, writeJsonFile} from '../util/jsonFile.js';

/** How many templates are kept; a guard against a runaway UI, not a design limit. */
export const MAX_LINK_TEMPLATES = 500;

/** The longest name that is stored; anything longer is refused rather than silently cut. */
export const MAX_TEMPLATE_NAME = 120;

export interface LinkTemplateStoreOptions {
    /** `<dataDir>/link-templates.json`. */
    readonly file: string;
    readonly now?: () => number;
}

/** The templates of one profile directory. */
export class LinkTemplateStore {
    #templates: LinkTemplate[] = [];
    readonly #file: string;
    readonly #now: () => number;

    constructor(options: LinkTemplateStoreOptions) {
        this.#file = options.file;
        this.#now = options.now ?? (() => Date.now());
    }

    /** Reads the file. A missing or broken one means "no templates", never an error. */
    async load(): Promise<void> {
        this.#templates = normaliseTemplates(await readJsonFile<unknown>(this.#file));
    }

    /** All of them, or the ones that fit a link's identity, newest first. */
    list(identity?: string): LinkTemplate[] {
        const all = [...this.#templates].sort((a, b) => b.createdAt - a.createdAt);
        return identity === undefined ? all : all.filter((template) => template.identity === identity);
    }

    /**
     * Saves a template. A name that already exists is replaced - the user pressed "save" with the
     * same name on purpose, and a second entry with the same label would be worse than an
     * overwrite. Rejects with `kind: 'validation'` for an empty name or an empty template.
     */
    async save(input: unknown): Promise<LinkTemplate[]> {
        const template = normaliseTemplate(input, this.#now());
        if (template === undefined) {
            throw validationError('a link template needs a name, an identity and at least one value');
        }
        this.#templates = [...this.#templates.filter((entry) => entry.name !== template.name), template].slice(
            -MAX_LINK_TEMPLATES,
        );
        await this.#write();
        return this.list();
    }

    /** Removes one by name; a name that is not there is not an error. */
    async remove(name: string): Promise<LinkTemplate[]> {
        this.#templates = this.#templates.filter((entry) => entry.name !== name);
        await this.#write();
        return this.list();
    }

    async #write(): Promise<void> {
        await writeJsonFile(this.#file, this.#templates);
    }
}

function normaliseValues(value: unknown): ParamsetWrite | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    const result: Record<string, boolean | number | string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
            result[key] = entry;
        }
    }
    return Object.keys(result).length === 0 ? undefined : result;
}

/** One template, or `undefined` when it is not one. */
export function normaliseTemplate(input: unknown, now: number): LinkTemplate | undefined {
    if (typeof input !== 'object' || input === null) {
        return undefined;
    }
    const raw = input as Partial<Record<keyof LinkTemplate, unknown>>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const identity = typeof raw.identity === 'string' ? raw.identity.trim() : '';
    if (name === '' || name.length > MAX_TEMPLATE_NAME || identity === '') {
        return undefined;
    }
    const receiver = normaliseValues(raw.receiver);
    const sender = normaliseValues(raw.sender);
    if (receiver === undefined && sender === undefined) {
        return undefined;
    }
    return {
        name,
        identity,
        ...(typeof raw.profileId === 'number' && Number.isFinite(raw.profileId) ? {profileId: raw.profileId} : {}),
        ...(typeof raw.profileName === 'string' && raw.profileName !== '' ? {profileName: raw.profileName} : {}),
        receiver: receiver ?? {},
        ...(sender === undefined ? {} : {sender}),
        createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    };
}

function normaliseTemplates(input: unknown): LinkTemplate[] {
    if (!Array.isArray(input)) {
        return [];
    }
    const result: LinkTemplate[] = [];
    for (const item of input) {
        const template = normaliseTemplate(item, 0);
        if (template !== undefined && !result.some((entry) => entry.name === template.name)) {
            result.push(template);
        }
    }
    return result.slice(-MAX_LINK_TEMPLATES);
}
