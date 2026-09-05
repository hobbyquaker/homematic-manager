/**
 * The UI message catalogue.
 *
 * Seeded from the 2.x `www/js/language.json`: 74 strings whose key is the English text, with a
 * German translation and nothing else - English came out of the key by falling through, which is
 * why 2.x had no language setting at all (#119, PR #130). The keys are kept so the strings stay
 * greppable against the old renderer; the English text is now explicit.
 *
 * Added on top: the counters the grids and dialogs show. 2.x built those by concatenating a number
 * and a noun ("(" + n + ") Kanaele"), which is issues #28 and #29 - a plural form and an
 * interpolation are needed, not string concatenation.
 *
 * Generated once from the 2.x file and maintained here by hand.
 */

import type {Language} from '../data/types.js';

/** A message: one string, or the two plural forms German and English need. */
export type MessageEntry = string | {readonly one: string; readonly other: string};

/** message key -> language -> text. */
export type MessageCatalogue = Readonly<Record<string, Readonly<Partial<Record<Language, MessageEntry>>>>>;

export const MESSAGES: MessageCatalogue = {
    'Homematic Manager Address': {
        de: 'Homematic Manager Adresse',
        en: 'Homematic Manager Address',
    },
    'CCU Address': {
        de: 'CCU Adresse',
        en: 'CCU Address',
    },
    Select: {
        de: 'Auswählen',
        en: 'Select',
    },
    'Save & Restart': {
        de: 'Speichern und Neustarten',
        en: 'Save & Restart',
    },
    Error: {
        de: 'Fehler',
        en: 'Error',
    },
    Devices: {
        de: 'Geräte',
        en: 'Devices',
    },
    Device: {
        de: 'Gerät',
        en: 'Device',
    },
    introduced: {
        de: 'gefunden',
        en: 'introduced',
    },
    New: {
        de: 'Neue',
        en: 'New',
    },
    Events: {
        de: 'Ereignisse',
        en: 'Events',
    },
    Cancel: {
        de: 'Abbrechen',
        en: 'Cancel',
    },
    OK: {
        de: 'OK',
        en: 'OK',
    },
    Delete: {
        de: 'Löschen',
        en: 'Delete',
    },
    Save: {
        de: 'Speichern',
        en: 'Save',
    },
    'Create and edit': {
        de: 'Anlegen und Bearbeiten',
        en: 'Create and edit',
    },
    Create: {
        de: 'Anlegen',
        en: 'Create',
    },
    'Please choose one or more channels': {
        de: 'Bitte einen oder mehrere Kanäle auswählen',
        en: 'Please choose one or more channels',
    },
    Refresh: {
        de: 'Aktualisieren',
        en: 'Refresh',
    },
    'Delete device': {
        de: 'Gerät löschen',
        en: 'Delete device',
    },
    'Rename device': {
        de: 'Gerät umbenennen',
        en: 'Rename device',
    },
    'Pair devices': {
        de: 'Geräte anlernen',
        en: 'Pair devices',
    },
    Links: {
        de: 'Verknüpfungen',
        en: 'Links',
    },
    'Delete link': {
        de: 'Verknüpfung löschen',
        en: 'Delete link',
    },
    'Edit link': {
        de: 'Verknüpfung bearbeiten',
        en: 'Edit link',
    },
    'Test link': {
        de: 'Verknüpfung testen',
        en: 'Test link',
    },
    'Create link': {
        de: 'Verknüpfung anlegen',
        en: 'Create link',
    },
    RSSI: {
        de: 'Funk',
        en: 'RSSI',
    },
    'RPC Console': {
        de: 'RPC Konsole',
        en: 'RPC Console',
    },
    'Service messages': {
        de: 'Servicemeldungen',
        en: 'Service messages',
    },
    'Send request': {
        de: 'Befehl senden',
        en: 'Send request',
    },
    Parameters: {
        de: 'Parameter',
        en: 'Parameters',
    },
    Response: {
        de: 'Antwort',
        en: 'Response',
    },
    Help: {
        de: 'Hilfe',
        en: 'Help',
    },
    Settings: {
        de: 'Einstellungen',
        en: 'Settings',
    },
    'Please choose one or more links': {
        de: 'mehrere Verknüpfungen bearbeiten',
        en: 'Please choose one or more links',
    },
    'Kanäle überschreiben': {
        de: 'Kanäle überschreiben',
        en: 'Kanäle überschreiben',
    },
    'Normaler Anlernmodus': {
        de: 'Normaler Anlernmodus',
        en: 'Normaler Anlernmodus',
    },
    'Default-Parameter in Paramset MASTER schreiben, bestehende Verknüpfungen löschen': {
        de: 'Default-Parameter in Paramset MASTER schreiben, bestehende Verknüpfungen löschen',
        en: 'Default-Parameter in Paramset MASTER schreiben, bestehende Verknüpfungen löschen',
    },
    Sender: {
        de: 'Sender',
        en: 'Sender',
    },
    Receiver: {
        de: 'Empfänger',
        en: 'Receiver',
    },
    'Ablernen und Gerät auf Werkseinstellungen zurücksetzen': {
        de: 'Ablernen und Gerät auf Werkseinstellungen zurücksetzen',
        en: 'Ablernen und Gerät auf Werkseinstellungen zurücksetzen',
    },
    'Nur ablernen (Direktverknüpfungen bleiben erhalten)': {
        de: 'Nur ablernen (Direktverknüpfungen bleiben erhalten)',
        en: 'Nur ablernen (Direktverknüpfungen bleiben erhalten)',
    },
    'Falls Gerät nicht erreichbar:': {
        de: 'Falls Gerät nicht erreichbar:',
        en: 'Falls Gerät nicht erreichbar:',
    },
    'bei nächster Gelegenheit löschen': {
        de: 'bei nächster Gelegenheit löschen',
        en: 'bei nächster Gelegenheit löschen',
    },
    'Nur aus Schnittstellenprozess löschen': {
        de: 'Nur aus Schnittstellenprozess löschen',
        en: 'Nur aus Schnittstellenprozess löschen',
    },
    Disconnected: {
        de: 'Verbindung unterbrochen',
        en: 'Disconnected',
    },
    'Which device do you want to replace?': {
        de: 'Welches Gerät wollen sie ersetzen?',
        en: 'Which device do you want to replace?',
    },
    'Gerät löschen': {
        de: 'Gerät löschen',
        en: 'Gerät löschen',
    },
    'Acknowledge service messages': {
        de: 'Servicemeldung bestätigen',
        en: 'Acknowledge service messages',
    },
    'Acknowledge all service messages': {
        de: 'Alle Servicemeldungen bestätigen',
        en: 'Acknowledge all service messages',
    },
    Interfaces: {
        de: 'Interfaces',
        en: 'Interfaces',
    },
    'Edit device': {
        de: 'Gerät bearbeiten',
        en: 'Edit device',
    },
    undefined: {
        de: 'undefined',
        en: 'undefined',
    },
    'Please select method': {
        de: 'Bitte eine Methode auswählen',
        en: 'Please select method',
    },
    saveAsNewTemplate: {
        de: 'als neue Profilvorlage speichern',
        en: 'saveAsNewTemplate',
    },
    'Replace device': {
        de: 'Gerät tauschen',
        en: 'Replace device',
    },
    'Update firmware': {
        de: 'Firmware aktualisieren',
        en: 'Update firmware',
    },
    clearConfigCache: {
        de: 'clearConfigCache',
        en: 'clearConfigCache',
    },
    restoreConfigToDevice: {
        de: 'restoreConfigToDevice',
        en: 'restoreConfigToDevice',
    },
    Rename: {
        de: 'Umbenennen',
        en: 'Rename',
    },
    'MASTER Paramset': {
        de: 'MASTER Paramset',
        en: 'MASTER Paramset',
    },
    updateFirmware: {
        de: 'Firmware aktualisieren',
        en: 'updateFirmware',
    },
    Replace: {
        de: 'Gerät tauschen',
        en: 'Replace',
    },
    'VALUES Paramset': {
        de: 'VALUES Paramset',
        en: 'VALUES Paramset',
    },
    'Activate long': {
        de: 'Empfägnerprofil testen (langer Tastendruck)',
        en: 'Activate long',
    },
    'Activate short': {
        de: 'Empfängerprofil testen (kurzer Tastendruck)',
        en: 'Activate short',
    },
    putParamset: {
        de: 'Parameter übernehmen',
        en: 'putParamset',
    },
    putParamsetClose: {
        de: 'Parameter übernehmen und schließen',
        en: 'putParamsetClose',
    },
    'New service message': {
        de: 'Neue Servicemeldung',
        en: 'New service message',
    },
    'RPC execution': {
        de: 'RPC wird ausgeführt',
        en: 'RPC execution',
    },
    'about Homematic Manager': {
        de: 'Über Homematic Manager',
        en: 'about Homematic Manager',
    },
    'Loading Homematic Manager...': {
        de: 'Lade Homematic Manager...',
        en: 'Loading Homematic Manager...',
    },
    'Check all': {
        de: 'Alle auswählen',
        en: 'Check all',
    },
    'Uncheck all': {
        de: 'Auswahl entfernen',
        en: 'Uncheck all',
    },
    '{count} devices': {
        de: {
            one: '{count} Gerät',
            other: '{count} Geräte',
        },
        en: {
            one: '{count} device',
            other: '{count} devices',
        },
    },
    '{count} channels': {
        de: {
            one: '{count} Kanal',
            other: '{count} Kanäle',
        },
        en: {
            one: '{count} channel',
            other: '{count} channels',
        },
    },
    '{count} links': {
        de: {
            one: '{count} Verknüpfung',
            other: '{count} Verknüpfungen',
        },
        en: {
            one: '{count} link',
            other: '{count} links',
        },
    },
    '{count} service messages': {
        de: {
            one: '{count} Servicemeldung',
            other: '{count} Servicemeldungen',
        },
        en: {
            one: '{count} service message',
            other: '{count} service messages',
        },
    },
    '{count} events': {
        de: {
            one: '{count} Ereignis',
            other: '{count} Ereignisse',
        },
        en: {
            one: '{count} event',
            other: '{count} events',
        },
    },
    '{count} parameters will be written': {
        de: {
            one: '{count} Parameter wird geschrieben',
            other: '{count} Parameter werden geschrieben',
        },
        en: {
            one: '{count} parameter will be written',
            other: '{count} parameters will be written',
        },
    },
    '{count} channels selected': {
        de: {
            one: '{count} Kanal ausgewählt',
            other: '{count} Kanäle ausgewählt',
        },
        en: {
            one: '{count} channel selected',
            other: '{count} channels selected',
        },
    },
    'Connected to {host}': {
        de: 'Verbunden mit {host}',
        en: 'Connected to {host}',
    },
    'Interface {interface} is not answering': {
        de: 'Schnittstelle {interface} antwortet nicht',
        en: 'Interface {interface} is not answering',
    },
    'Writing {paramset} of {address}': {
        de: 'Schreibe {paramset} von {address}',
        en: 'Writing {paramset} of {address}',
    },
};

/** The keys the catalogue knows, for the completeness test and for tooling. */
export const MESSAGE_KEYS: readonly string[] = Object.keys(MESSAGES);
