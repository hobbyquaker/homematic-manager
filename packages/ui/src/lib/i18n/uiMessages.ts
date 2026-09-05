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
    'Not present': {de: 'Nicht vorhanden', en: 'Not present'},
    Subscribing: {de: 'Anmeldung läuft', en: 'Subscribing'},
    'Add by serial number': {de: 'Per Seriennummer anlernen', en: 'Add by serial number'},
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
    'No devices - the interface has not reported any yet': {
        de: 'Keine Geräte - die Schnittstelle hat noch keine gemeldet',
        en: 'No devices - the interface has not reported any yet',
    },
    install: {de: 'installieren', en: 'install'},
    'Install firmware {version}': {de: 'Firmware {version} installieren', en: 'Install firmware {version}'},

    // The device actions. 2.x had these as German literals that its own translator mapped to
    // themselves in English (#119); here English is the key and German the translation.
    'Overwrite channel names': {de: 'Kanalnamen überschreiben', en: 'Overwrite channel names'},
    'Do you really want to delete the device {name}?': {
        de: 'Wollen Sie das Gerät {name} wirklich löschen?',
        en: 'Do you really want to delete the device {name}?',
    },
    'Unlearn and reset the device to factory defaults': {
        de: 'Ablernen und Gerät auf Werkseinstellungen zurücksetzen',
        en: 'Unlearn and reset the device to factory defaults',
    },
    'Unlearn only (direct links are kept)': {
        de: 'Nur ablernen (Direktverknüpfungen bleiben erhalten)',
        en: 'Unlearn only (direct links are kept)',
    },
    'If the device cannot be reached:': {
        de: 'Falls Gerät nicht erreichbar:',
        en: 'If the device cannot be reached:',
    },
    'Delete at the next opportunity': {
        de: 'Bei nächster Gelegenheit löschen',
        en: 'Delete at the next opportunity',
    },
    'Delete from the interface process only': {
        de: 'Nur aus dem Schnittstellenprozess löschen',
        en: 'Delete from the interface process only',
    },
    'New device': {de: 'Neues Gerät', en: 'New device'},
    'No suitable device available': {de: 'Kein passendes Gerät vorhanden', en: 'No suitable device available'},
    'Select a device': {de: 'Ein Gerät auswählen', en: 'Select a device'},
    'Select one or more channels': {de: 'Einen oder mehrere Kanäle auswählen', en: 'Select one or more channels'},
    'This device carries the DontDelete flag': {
        de: 'Dieses Gerät trägt das Flag DontDelete',
        en: 'This device carries the DontDelete flag',
    },
    'Only available on BidCos interfaces': {
        de: 'Nur bei BidCos-Schnittstellen verfügbar',
        en: 'Only available on BidCos interfaces',
    },
    'reportValueUsage {value}: {count} datapoints on {channels} channels': {
        de: 'reportValueUsage {value}: {count} Datenpunkte auf {channels} Kanälen',
        en: 'reportValueUsage {value}: {count} datapoints on {channels} channels',
    },

    // The paramset editor.
    'SERVICE Paramset': {de: 'SERVICE Parametersatz', en: 'SERVICE Paramset'},
    Preview: {de: 'Vorschau', en: 'Preview'},
    Write: {de: 'Schreiben', en: 'Write'},
    Parameter: {de: 'Parameter', en: 'Parameter'},
    'Current value': {de: 'Aktueller Wert', en: 'Current value'},
    'New value': {de: 'Neuer Wert', en: 'New value'},
    'Nothing has changed - nothing will be written': {
        de: 'Nichts geändert - es wird nichts geschrieben',
        en: 'Nothing has changed - nothing will be written',
    },
    'Write every parameter, not only the changed ones': {
        de: 'Alle Parameter schreiben, nicht nur die geänderten',
        en: 'Write every parameter, not only the changed ones',
    },
    'Show hidden parameters': {de: 'Ausgeblendete Parameter zeigen', en: 'Show hidden parameters'},
    'other firmware or device type': {
        de: 'andere Firmware oder anderer Gerätetyp',
        en: 'other firmware or device type',
    },

    // The links tab.
    'Select one link': {de: 'Eine Verknüpfung auswählen', en: 'Select one link'},
    'No channel can receive from this sender': {
        de: 'Kein Kanal kann von diesem Sender empfangen',
        en: 'No channel can receive from this sender',
    },
    '{count} defective links': {
        de: {one: '{count} defekte Verknüpfung', other: '{count} defekte Verknüpfungen'},
        en: {one: '{count} defective link', other: '{count} defective links'},
    },
    'Defective link': {de: 'Defekte Verknüpfung', en: 'Defective link'},
    Profile: {de: 'Profil', en: 'Profile'},
    'Expert view': {de: 'Expertenansicht', en: 'Expert view'},

    // What the lab measured about CONFIG_PENDING and the repair (task 6, docs/config-pending.md).
    'Repair configuration': {de: 'Konfiguration reparieren', en: 'Repair configuration'},
    'The configuration could not be transferred to the device': {
        de: 'Die Konfiguration konnte nicht zum Gerät übertragen werden',
        en: 'The configuration could not be transferred to the device',
    },
    'A configuration is queued; the device takes it when it next wakes up': {
        de: 'Eine Konfiguration ist eingereiht; das Gerät übernimmt sie beim nächsten Aufwachen',
        en: 'A configuration is queued; the device takes it when it next wakes up',
    },
    'On BidCos a pending configuration is normal: it is queued and the device takes it when it next wakes up.': {
        de: 'Bei BidCos ist eine ausstehende Konfiguration normal: sie ist eingereiht und das Gerät übernimmt sie beim nächsten Aufwachen.',
        en: 'On BidCos a pending configuration is normal: it is queued and the device takes it when it next wakes up.',
    },
    'These channels store a parameter their description does not have. No RPC method removes it: the device has to be deleted and paired again, or a CCU backup from before the bad write restored.':
        {
            de: 'Diese Kanäle speichern einen Parameter, den ihre Beschreibung nicht kennt. Keine RPC-Methode entfernt ihn: das Gerät muss gelöscht und neu angelernt werden, oder ein CCU-Backup von vor dem fehlerhaften Schreibvorgang eingespielt werden.',
            en: 'These channels store a parameter their description does not have. No RPC method removes it: the device has to be deleted and paired again, or a CCU backup from before the bad write restored.',
        },
    'Nothing has to be corrected': {de: 'Es muss nichts korrigiert werden', en: 'Nothing has to be corrected'},
    'Additional BidCos recovery': {de: 'Zusätzliche BidCos-Reparatur', en: 'Additional BidCos recovery'},
    Channel: {de: 'Kanal', en: 'Channel'},
    'Read back': {de: 'Rückgelesen', en: 'Read back'},
    'The interface answered ok but stored something else': {
        de: 'Die Schnittstelle hat ok geantwortet, aber etwas anderes gespeichert',
        en: 'The interface answered ok but stored something else',
    },
    'What was sent': {de: 'Gesendet', en: 'What was sent'},

    // The service messages tab.
    'Quiet mode': {de: 'Ruhemodus', en: 'Quiet mode'},
    'Only STICKY_UNREACH and SABOTAGE can be acknowledged': {
        de: 'Nur STICKY_UNREACH und SABOTAGE lassen sich bestätigen',
        en: 'Only STICKY_UNREACH and SABOTAGE can be acknowledged',
    },

    // The events tab.
    Pause: {de: 'Anhalten', en: 'Pause'},
    'Events per device': {de: 'Ereignisse je Gerät', en: 'Events per device'},

    // The radio tab.
    Peer: {de: 'Gegenstelle', en: 'Peer'},
    'Heard best by {address}': {de: 'Am besten empfangen von {address}', en: 'Heard best by {address}'},

    // The RPC console.
    History: {de: 'Verlauf', en: 'History'},
    optional: {de: 'optional', en: 'optional'},

    // Pairing a device.
    Mode: {de: 'Modus', en: 'Mode'},
    'Serial number': {de: 'Seriennummer', en: 'Serial number'},
    'Temporary key': {de: 'Temporärer Schlüssel', en: 'Temporary key'},
    'Normal install mode': {de: 'Normaler Anlernmodus', en: 'Normal install mode'},
    'Write the MASTER defaults and delete the existing links': {
        de: 'Default-Parameter in Paramset MASTER schreiben, bestehende Verknüpfungen löschen',
        en: 'Write the MASTER defaults and delete the existing links',
    },
    'With SGTIN and key': {de: 'Mit SGTIN und Schlüssel', en: 'With SGTIN and key'},
    'With SGTIN only (key server)': {de: 'Nur mit SGTIN (Key Server)', en: 'With SGTIN only (key server)'},
    'QR scanner': {de: 'QR-Scanner', en: 'QR scanner'},
    Scan: {de: 'Scannen', en: 'Scan'},
    Stop: {de: 'Stoppen', en: 'Stop'},
    'That is not a HomematicIP device code': {
        de: 'Das ist kein HomematicIP-Gerätecode',
        en: 'That is not a HomematicIP device code',
    },
    'Start install mode': {de: 'Anlernmodus aktivieren', en: 'Start install mode'},
    '{count} seconds left': {
        de: {one: 'Noch {count} Sekunde', other: 'Noch {count} Sekunden'},
        en: {one: '{count} second left', other: '{count} seconds left'},
    },
    'BidCos-Wired has no install mode; the interface searches its bus for new devices.': {
        de: 'BidCos-Wired hat keinen Anlernmodus; die Schnittstelle durchsucht ihren Bus nach neuen Geräten.',
        en: 'BidCos-Wired has no install mode; the interface searches its bus for new devices.',
    },

    // The update notice and the About dialog (D-16); all of it is silent without a host bridge.
    Update: {de: 'Aktualisierung', en: 'Update'},
    'A new version is available': {de: 'Eine neue Version ist verfügbar', en: 'A new version is available'},
    Downloading: {de: 'Wird geladen', en: 'Downloading'},
    'The update is ready and will be installed when you quit': {
        de: 'Die Aktualisierung ist bereit und wird beim Beenden installiert',
        en: 'The update is ready and will be installed when you quit',
    },
    'The update will be installed when you quit': {
        de: 'Die Aktualisierung wird beim Beenden installiert',
        en: 'The update will be installed when you quit',
    },
    Download: {de: 'Herunterladen', en: 'Download'},
    'Install on quit': {de: 'Beim Beenden installieren', en: 'Install on quit'},
    'Check for updates': {de: 'Nach Aktualisierungen suchen', en: 'Check for updates'},
    'Device data': {de: 'Gerätedaten', en: 'Device data'},

    // The settings dialog.
    'Extra interfaces': {de: 'Zusätzliche Schnittstellen', en: 'Extra interfaces'},
    'Add interface': {de: 'Schnittstelle hinzufügen', en: 'Add interface'},
    Remove: {de: 'Entfernen', en: 'Remove'},
    Host: {de: 'Host', en: 'Host'},
    Port: {de: 'Port', en: 'Port'},
    Path: {de: 'Pfad', en: 'Path'},
    Protocol: {de: 'Protokoll', en: 'Protocol'},
    'Searching...': {de: 'Suche läuft...', en: 'Searching...'},

    // The device-specific editors of task 10. The weekday names are the CCU's own parameter
    // segments (MONDAY..SUNDAY) turned into something readable.
    'Show the raw parameters as well': {
        de: 'Rohe Parameter zusätzlich anzeigen',
        en: 'Show the raw parameters as well',
    },
    Durations: {de: 'Zeitdauern', en: 'Durations'},
    'A duration is stored as a unit and a count; both are shown next to the seconds.': {
        de: 'Eine Zeitdauer wird als Einheit und Faktor gespeichert; beides steht neben den Sekunden.',
        en: 'A duration is stored as a unit and a count; both are shown next to the seconds.',
    },
    seconds: {de: 'Sekunden', en: 'seconds'},
    unit: {de: 'Einheit', en: 'unit'},
    count: {de: 'Faktor', en: 'count'},
    'Not used / for ever': {de: 'Nicht benutzt / dauerhaft', en: 'Not used / for ever'},
    'The device holds a value this pair cannot express': {
        de: 'Das Gerät hält einen Wert, den dieses Paar nicht ausdrücken kann',
        en: 'The device holds a value this pair cannot express',
    },
    'The device can only do {seconds}': {
        de: 'Das Gerät kann nur {seconds}',
        en: 'The device can only do {seconds}',
    },

    'Week programme': {de: 'Wochenprogramm', en: 'Week programme'},
    'Switching programme': {de: 'Schaltprogramm', en: 'Switching programme'},
    Weekday: {de: 'Wochentag', en: 'Weekday'},
    Weekdays: {de: 'Wochentage', en: 'Weekdays'},
    Slot: {de: 'Abschnitt', en: 'Slot'},
    until: {de: 'bis', en: 'until'},
    Copy: {de: 'Kopieren', en: 'Copy'},
    'Copy day to': {de: 'Tag kopieren nach', en: 'Copy day to'},
    'Copy profile to': {de: 'Profil kopieren nach', en: 'Copy profile to'},
    Monday: {de: 'Montag', en: 'Monday'},
    Tuesday: {de: 'Dienstag', en: 'Tuesday'},
    Wednesday: {de: 'Mittwoch', en: 'Wednesday'},
    Thursday: {de: 'Donnerstag', en: 'Thursday'},
    Friday: {de: 'Freitag', en: 'Friday'},
    Saturday: {de: 'Samstag', en: 'Saturday'},
    Sunday: {de: 'Sonntag', en: 'Sunday'},
    'The end times of a day rise until {end}, and the last one is {end}': {
        de: 'Die Endzeiten eines Tages steigen bis {end}, und die letzte ist {end}',
        en: 'The end times of a day rise until {end}, and the last one is {end}',
    },
    '{day}: end time {slot} is not after the one before it': {
        de: '{day}: Endzeit {slot} liegt nicht nach der vorherigen',
        en: '{day}: end time {slot} is not after the one before it',
    },
    '{day}: end time {slot} comes after the day has ended': {
        de: '{day}: Endzeit {slot} liegt hinter dem Ende des Tages',
        en: '{day}: end time {slot} comes after the day has ended',
    },
    '{day}: the last end time must be {end}': {
        de: '{day}: die letzte Endzeit muss {end} sein',
        en: '{day}: the last end time must be {end}',
    },
    'A time between 00:00 and {end}': {de: 'Eine Zeit zwischen 00:00 und {end}', en: 'A time between 00:00 and {end}'},
    Time: {de: 'Zeit', en: 'Time'},
    Level: {de: 'Stufe', en: 'Level'},
    Condition: {de: 'Bedingung', en: 'Condition'},
    'Astro offset': {de: 'Astro-Versatz', en: 'Astro offset'},
    'Target channels': {de: 'Zielkanäle', en: 'Target channels'},
    Unused: {de: 'Unbenutzt', en: 'Unused'},
    'No weekday chosen - the slot does nothing': {
        de: 'Kein Wochentag gewählt - der Abschnitt tut nichts',
        en: 'No weekday chosen - the slot does nothing',
    },

    'Blind calibration': {de: 'Jalousie-Kalibrierung', en: 'Blind calibration'},
    'The running times of a reference run, in plain seconds next to the value the device stores.': {
        de: 'Die Laufzeiten einer Referenzfahrt, in Sekunden neben dem Wert, den das Gerät speichert.',
        en: 'The running times of a reference run, in plain seconds next to the value the device stores.',
    },

    'Named options': {de: 'Benannte Auswahlen', en: 'Named options'},
    'These values have names in the CCU string table that the description does not carry.': {
        de: 'Diese Werte haben Namen in der CCU-Zeichenkettentabelle, die die Beschreibung nicht mitliefert.',
        en: 'These values have names in the CCU string table that the description does not carry.',
    },
};

/** Core's catalogue plus the UI's own keys; the UI's entries win on a collision. */
export const CATALOGUE: MessageCatalogue = {...MESSAGES, ...UI_MESSAGES};
