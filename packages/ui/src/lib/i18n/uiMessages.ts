import type {MessageCatalogue} from '@homematic-manager/core';
import {MESSAGES} from '@homematic-manager/core';

/**
 * The strings the 3.0 shell needs and 2.7 never had: the theme and language switches, the RPC log
 * drawer that replaces the modal RPC dialog, the table's filter row, and the placeholders for what
 * task 8 still has to build.
 *
 * They live here rather than in `packages/core/src/i18n/messages.ts` because they are UI chrome,
 * not domain vocabulary - core's catalogue is the 2.x `language.json` and the message texts the
 * backend can produce. Should any of these turn out to be needed outside the UI, moving a key over
 * is a one-line change; the merged catalogue below keeps the lookup identical either way.
 */
export const UI_MESSAGES: MessageCatalogue = {
    Filter: {de: 'Filter', en: 'Filter'},
    'Filter all columns': {de: 'Alle Spalten filtern', en: 'Filter all columns'},
    Language: {de: 'Sprache', en: 'Language'},
    Theme: {de: 'Design', en: 'Theme'},
    'Theme: light': {de: 'Design: hell', en: 'Theme: light'},
    'Theme: dark': {de: 'Design: dunkel', en: 'Theme: dark'},
    'Theme: system': {de: 'Design: System', en: 'Theme: system'},
    Close: {de: 'Schließen', en: 'Close'},
    Apply: {de: 'Übernehmen', en: 'Apply'},
    Connected: {de: 'Verbunden', en: 'Connected'},
    'Not connected': {de: 'Nicht verbunden', en: 'Not connected'},
    'RPC log': {de: 'RPC-Protokoll', en: 'RPC log'},
    'Show RPC log': {de: 'RPC-Protokoll anzeigen', en: 'Show RPC log'},
    'No RPC calls yet': {de: 'Noch keine RPC-Aufrufe', en: 'No RPC calls yet'},
    'in progress': {de: 'läuft', en: 'in progress'},
    Duration: {de: 'Dauer', en: 'Duration'},
    Method: {de: 'Methode', en: 'Method'},
    Result: {de: 'Ergebnis', en: 'Result'},
    Interface: {de: 'Schnittstelle', en: 'Interface'},
    Channels: {de: 'Kanäle', en: 'Channels'},
    Name: {de: 'Name', en: 'Name'},
    Timestamp: {de: 'Zeitstempel', en: 'Timestamp'},
    Value: {de: 'Wert', en: 'Value'},
    Message: {de: 'Meldung', en: 'Message'},
    Since: {de: 'Seit', en: 'Since'},
    Clear: {de: 'Leeren', en: 'Clear'},
    'No data': {de: 'Keine Daten', en: 'No data'},
    'Nothing selected': {de: 'Nichts ausgewählt', en: 'Nothing selected'},
    'Comes with task 8': {
        de: 'Diese Funktion kommt mit Aufgabe 8.',
        en: 'This function arrives with task 8.',
    },
    'Select an interface': {de: 'Schnittstelle auswählen', en: 'Select an interface'},
    'Use ReGa': {de: 'ReGa verwenden', en: 'Use ReGa'},
    'Detect interfaces': {de: 'Schnittstellen erkennen', en: 'Detect interfaces'},
    Interfaces: {de: 'Schnittstellen', en: 'Interfaces'},
    'Callback address': {de: 'Callback-Adresse', en: 'Callback address'},
    'Callback XML-RPC port': {de: 'Callback-Port XML-RPC', en: 'Callback XML-RPC port'},
    'Callback BIN-RPC port': {de: 'Callback-Port BIN-RPC', en: 'Callback BIN-RPC port'},
    'Use TLS': {de: 'TLS verwenden', en: 'Use TLS'},
    'Use Auth': {de: 'Authentifizierung verwenden', en: 'Use Auth'},
    'Auth User': {de: 'Benutzer', en: 'Auth User'},
    'Auth Pass': {de: 'Passwort', en: 'Auth Pass'},
    'RPC Delay (ms)': {de: 'RPC-Pause (ms)', en: 'RPC Delay (ms)'},
    'RPC Log Folder': {de: 'RPC-Log-Verzeichnis', en: 'RPC Log Folder'},
    'Clear Cache': {de: 'Cache leeren', en: 'Clear Cache'},
    'Discovered CCUs': {de: 'Gefundene CCUs', en: 'Discovered CCUs'},
    Discover: {de: 'Suchen', en: 'Discover'},
    'Free port': {de: 'freier Port', en: 'Free port'},
    '0 picks a free port': {de: '0 wählt einen freien Port', en: '0 picks a free port'},
    Dismiss: {de: 'Ausblenden', en: 'Dismiss'},
    'Add device': {de: 'Gerät anlernen', en: 'Add device'},
    'reportValueUsage 0': {de: 'reportValueUsage 0', en: 'reportValueUsage 0'},
    'reportValueUsage 1': {de: 'reportValueUsage 1', en: 'reportValueUsage 1'},
    'Expand row': {de: 'Zeile aufklappen', en: 'Expand row'},
    'Collapse row': {de: 'Zeile zuklappen', en: 'Collapse row'},
    'Sorted ascending': {de: 'Aufsteigend sortiert', en: 'Sorted ascending'},
    'Sorted descending': {de: 'Absteigend sortiert', en: 'Sorted descending'},
    'Showing {shown} of {total}': {de: 'Zeige {shown} von {total}', en: 'Showing {shown} of {total}'},
};

/** Core's catalogue plus the UI's own keys; the UI's entries win on a collision. */
export const CATALOGUE: MessageCatalogue = {...MESSAGES, ...UI_MESSAGES};
