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
    // D-36: the first entry of the language setting, and the default.
    'Browser language': {de: 'Sprache des Browsers', en: 'Browser language'},
    // Task 22: the drag handle on the RPC drawer's upper edge.
    'Resize the RPC log': {de: 'Größe des RPC-Protokolls ändern', en: 'Resize the RPC log'},
    Theme: {de: 'Design', en: 'Theme'},
    'Theme: light': {de: 'Design: hell', en: 'Theme: light'},
    'Theme: dark': {de: 'Design: dunkel', en: 'Theme: dark'},
    'Theme: system': {de: 'Design: System', en: 'Theme: system'},
    Close: {de: 'Schließen', en: 'Close'},
    Apply: {de: 'Übernehmen', en: 'Apply'},
    Connected: {de: 'Verbunden', en: 'Connected'},
    'Not connected': {de: 'Nicht verbunden', en: 'Not connected'},
    'Not present': {de: 'Nicht vorhanden', en: 'Not present'},
    // B-28: an interface whose init or probe timed out, and the popup's button that tries those at once
    'Not answering': {de: 'Antwortet nicht', en: 'Not answering'},
    'Retry now': {de: 'Jetzt erneut versuchen', en: 'Retry now'},
    Subscribing: {de: 'Anmeldung läuft', en: 'Subscribing'},
    'Pending changes': {de: 'Offene Änderungen', en: 'Pending changes'},
    // D-32: shown only where the host has a login at all - the CCU addon in --auth-mode rega
    'Logged in as {user}': {de: 'Angemeldet als {user}', en: 'Logged in as {user}'},
    'Log out': {de: 'Abmelden', en: 'Log out'},
    Team: {de: 'Team', en: 'Team'},
    'Own team': {de: 'Eigenes Team', en: 'Own team'},
    Members: {de: 'Mitglieder', en: 'Members'},
    'This channel does not belong to a team': {
        de: 'Dieser Kanal gehört zu keinem Team',
        en: 'This channel does not belong to a team',
    },
    'The interface knows no other team yet': {
        de: 'Die Schnittstelle kennt noch kein anderes Team',
        en: 'The interface knows no other team yet',
    },
    'Confirm the ReGa inbox': {de: 'ReGa-Posteingang bestätigen', en: 'Confirm the ReGa inbox'},
    'Confirm the ReGa inbox automatically': {
        de: 'ReGa-Posteingang automatisch bestätigen',
        en: 'Confirm the ReGa inbox automatically',
    },
    'The ReGa inbox is empty': {de: 'Der ReGa-Posteingang ist leer', en: 'The ReGa inbox is empty'},
    Confirmed: {de: 'Bestätigt', en: 'Confirmed'},
    Template: {de: 'Vorlage', en: 'Template'},
    'Save as template': {de: 'Als Vorlage speichern', en: 'Save as template'},
    'Apply template': {de: 'Vorlage anwenden', en: 'Apply template'},
    'Delete template': {de: 'Vorlage löschen', en: 'Delete template'},
    'Template name': {de: 'Name der Vorlage', en: 'Template name'},
    'No template for this pair of channel types': {
        de: 'Keine Vorlage für diese Kanaltypen',
        en: 'No template for this pair of channel types',
    },
    'Create link as sender': {de: 'Verknüpfung als Sender anlegen', en: 'Create link as sender'},
    'Create link as receiver': {de: 'Verknüpfung als Empfänger anlegen', en: 'Create link as receiver'},
    'Show links': {de: 'Verknüpfungen anzeigen', en: 'Show links'},
    Unreach: {de: 'Ausfälle', en: 'Unreach'},
    'Reset the unreach counters': {de: 'Ausfallzähler zurücksetzen', en: 'Reset the unreach counters'},
    // #147, task 34: the label says when it acts, and switching it on asks about what is already listed
    'Acknowledge STICKY_UNREACH automatically as they occur': {
        de: 'STICKY_UNREACH automatisch bestätigen, sobald sie auftreten',
        en: 'Acknowledge STICKY_UNREACH automatically as they occur',
    },
    'Acknowledging is a write to the device. Switching this on asks once about the messages already in the list.': {
        de: 'Das Bestätigen schreibt in das Gerät. Beim Einschalten wird einmal gefragt, was mit den Meldungen geschieht, die schon in der Liste stehen.',
        en: 'Acknowledging is a write to the device. Switching this on asks once about the messages already in the list.',
    },
    'Acknowledge the messages already in the list?': {
        de: 'Die Meldungen in der Liste auch bestätigen?',
        en: 'Acknowledge the messages already in the list?',
    },
    // #147 (Herbert-Testmann, 2026-09-12): the first wording had to be read twice; the maintainer chose
    // this one - what is there, what happens from now on, and two buttons that say which messages
    '{count} STICKY_UNREACH messages are already listed. New ones are acknowledged automatically from now on.': {
        de: {
            one: 'In der Liste steht schon 1 STICKY_UNREACH-Meldung. Neue werden ab jetzt automatisch bestätigt.',
            other: 'In der Liste stehen schon {count} STICKY_UNREACH-Meldungen. Neue werden ab jetzt automatisch bestätigt.',
        },
        en: {
            one: '1 STICKY_UNREACH message is already listed. New ones are acknowledged automatically from now on.',
            other: '{count} STICKY_UNREACH messages are already listed. New ones are acknowledged automatically from now on.',
        },
    },
    'Each acknowledgement is a write to the device. Afterwards the list no longer shows which devices were away; the unreach counter in the RSSI tab keeps that.':
        {
            de: 'Jede Bestätigung schreibt in das Gerät. Danach zeigt die Liste nicht mehr, welche Geräte nicht erreichbar waren; der Ausfallzähler im Reiter Funk behält das.',
            en: 'Each acknowledgement is a write to the device. Afterwards the list no longer shows which devices were away; the unreach counter in the RSSI tab keeps that.',
        },
    'Acknowledge existing': {de: 'Vorhandene bestätigen', en: 'Acknowledge existing'},
    'Only new ones': {de: 'Nur neue', en: 'Only new ones'},
    '{count} messages in the list are acknowledged when this is saved': {
        de: {
            one: 'Die Meldung in der Liste wird beim Speichern bestätigt',
            other: 'Die {count} Meldungen in der Liste werden beim Speichern bestätigt',
        },
        en: {
            one: 'The message in the list is acknowledged when this is saved',
            other: 'The {count} messages in the list are acknowledged when this is saved',
        },
    },
    'Used for every pair without its own name': {
        de: 'Gilt für jedes Paar ohne eigenen Namen',
        en: 'Used for every pair without its own name',
    },
    'Nothing is staged': {de: 'Nichts vorgemerkt', en: 'Nothing is staged'},
    'Add to pending changes': {de: 'Zu den offenen Änderungen', en: 'Add to pending changes'},
    'Discard all': {de: 'Alle verwerfen', en: 'Discard all'},
    '{count} changes staged': {
        de: {one: 'Eine Änderung vorgemerkt', other: '{count} Änderungen vorgemerkt'},
        en: {one: 'One change staged', other: '{count} changes staged'},
    },
    'The camera is only available over https or on localhost. Open the page with its https address (the CCU serves it on its https port too, with a certificate warning) or type the key in by hand.':
        {
            de:
                'Die Kamera ist nur über https oder auf localhost verfügbar. Öffnen Sie die Seite über ihre ' +
                'https-Adresse (die CCU liefert sie auch über ihren https-Port aus, mit Zertifikatswarnung) ' +
                'oder geben Sie den Schlüssel von Hand ein.',
            en:
                'The camera is only available over https or on localhost. Open the page with its https ' +
                'address (the CCU serves it on its https port too, with a certificate warning) or type the ' +
                'key in by hand.',
        },
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
    // Task 21: the header's summary mark, and the second line under an interface in the popup.
    'All interfaces are connected': {
        de: 'Alle Schnittstellen verbunden',
        en: 'All interfaces are connected',
    },
    'Not every interface is connected': {
        de: 'Nicht jede Schnittstelle ist verbunden',
        en: 'Not every interface is connected',
    },
    // `{count} devices` is core's own plural key and is used as it is.
    'Duty cycle {value} %': {de: 'Duty Cycle {value} %', en: 'Duty cycle {value} %'},
    // Task 38: the popup's callback line - why an interface has no callback, and what a container must publish.
    'Callback port {port} is in use': {de: 'Callback-Port {port} ist belegt', en: 'Callback port {port} is in use'},
    'Callback port {port} cannot be opened': {
        de: 'Callback-Port {port} lässt sich nicht öffnen',
        en: 'Callback port {port} cannot be opened',
    },
    'Publish this port unchanged': {
        de: 'Diesen Port unverändert veröffentlichen',
        en: 'Publish this port unchanged',
    },
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
    // Task 35: in the CCU addon a 0 means the addon's fixed port, and a free one only when it is taken
    '0 uses port {port}, or a free one when it is taken': {
        de: '0 verwendet Port {port} oder, wenn er belegt ist, einen freien',
        en: '0 uses port {port}, or a free one when it is taken',
    },
    // Task 38: a callback field the host was started with; `{option}` is `HMM_CALLBACK_IP / --callback-ip`
    'Set at start ({option})': {de: 'Beim Start festgelegt ({option})', en: 'Set at start ({option})'},
    Dismiss: {de: 'Ausblenden', en: 'Dismiss'},
    // The toast stack collapses everything past the fifth into this counter (D-34).
    '{count} more': {
        de: {one: '{count} weitere', other: '{count} weitere'},
        en: {one: '{count} more', other: '{count} more'},
    },
    'Show fewer': {de: 'Weniger anzeigen', en: 'Show fewer'},
    'Add device': {de: 'Gerät anlernen', en: 'Add device'},
    // Task 28: the Devices tab's captioned main action; "Add device" stays the pairing dialog's title.
    'Pair device': {de: 'Gerät anlernen', en: 'Pair device'},
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
    // #143: the same for the room and function filter, which sits above the grid and is applied
    // before the table sees the rows.
    'No device matches the room or function filter': {
        de: 'Kein Gerät passt zum Raum- oder Gewerkefilter',
        en: 'No device matches the room or function filter',
    },
    // BUGS.md B-1: a filter that leaves nothing has to say so; the old text blamed the interface.
    'No row matches the filter': {de: 'Keine Zeile passt zum Filter', en: 'No row matches the filter'},
    'Clear filter': {de: 'Filter löschen', en: 'Clear filter'},
    // Task 40 (#157): the drag handle on a column label, and the menu of the column labels
    'Resize column {column}': {de: 'Breite der Spalte {column} ändern', en: 'Resize column {column}'},
    'Fit column to content': {de: 'Spaltenbreite an den Inhalt anpassen', en: 'Fit column to content'},
    'Reset column widths': {de: 'Spaltenbreiten zurücksetzen', en: 'Reset column widths'},
    'Column widths': {de: 'Spaltenbreiten', en: 'Column widths'},
    // Task 47: the copy button of a name or an address cell, and what it says after a click
    'Copy name': {de: 'Namen kopieren', en: 'Copy name'},
    'Copy address': {de: 'Adresse kopieren', en: 'Copy address'},
    Copied: {de: 'Kopiert', en: 'Copied'},
    'Could not copy - the text is selected': {
        de: 'Kopieren nicht möglich - der Text ist markiert',
        en: 'Could not copy - the text is selected',
    },
    // BUGS.md B-2: the receiver a BidCos-RF device is configured for, in the Funk dialog.
    Configured: {de: 'Konfiguriert', en: 'Configured'},
    'Use {interface} as receiver': {
        de: '{interface} als Empfänger verwenden',
        en: 'Use {interface} as receiver',
    },
    // Issue #69: the dry run that assigns every BidCos-RF device to the interface that hears it best.
    'Assign the best receiver': {de: 'Besten Empfänger zuweisen', en: 'Assign the best receiver'},
    'Best receiver': {de: 'Bester Empfänger', en: 'Best receiver'},
    'Only one interface': {de: 'Nur eine Schnittstelle', en: 'Only one interface'},
    'Which interface receives each device best, from the levels the interfaces last measured. Nothing is written until you confirm; every device is one setBidcosInterface.':
        {
            de: 'Welche Schnittstelle jedes Gerät am besten empfängt, aus den zuletzt gemessenen Pegeln. Geschrieben wird erst nach Bestätigung, jedes Gerät ist ein setBidcosInterface.',
            en: 'Which interface receives each device best, from the levels the interfaces last measured. Nothing is written until you confirm; every device is one setBidcosInterface.',
        },
    Margin: {de: 'Mindestabstand', en: 'Margin'},
    'A switch is proposed only when the best interface receives the device at least this much better than the configured one - two reads of the same link differ by a few dB.':
        {
            de: 'Ein Wechsel wird nur vorgeschlagen, wenn die beste Schnittstelle das Gerät um mindestens so viel besser empfängt als die konfigurierte - zwei Messungen derselben Strecke unterscheiden sich um einige dB.',
            en: 'A switch is proposed only when the best interface receives the device at least this much better than the configured one - two reads of the same link differ by a few dB.',
        },
    Proposed: {de: 'Vorgeschlagen', en: 'Proposed'},
    // #161: the bands of core's `RSSI_BANDS`, in the tooltip of an RSSI pill ("-65 dBm · Ausreichend")
    'Very good (maximum)': {de: 'Sehr gut (Maximum)', en: 'Very good (maximum)'},
    'Very good': {de: 'Sehr gut', en: 'Very good'},
    Good: {de: 'Gut', en: 'Good'},
    'Good (normal operation)': {de: 'Gut (Normalbetrieb)', en: 'Good (normal operation)'},
    Sufficient: {de: 'Ausreichend', en: 'Sufficient'},
    'Sufficient to weak': {de: 'Ausreichend bis schwach', en: 'Sufficient to weak'},
    Poor: {de: 'Schlecht', en: 'Poor'},
    Critical: {de: 'Kritisch', en: 'Critical'},
    Gain: {de: 'Gewinn', en: 'Gain'},
    'Below the margin': {de: 'Unter dem Mindestabstand', en: 'Below the margin'},
    'Not heard by the configured receiver': {
        de: 'Vom konfigurierten Empfänger nicht gehört',
        en: 'Not heard by the configured receiver',
    },
    'Every device is on the receiver that hears it best': {
        de: 'Jedes Gerät ist auf dem Empfänger, der es am besten hört',
        en: 'Every device is on the receiver that hears it best',
    },
    'Not listed: {keep} on their best receiver, {unmeasured} without a measurement, {roaming} roaming': {
        de: 'Nicht aufgeführt: {keep} auf ihrem besten Empfänger, {unmeasured} ohne Messwert, {roaming} mit Roaming',
        en: 'Not listed: {keep} on their best receiver, {unmeasured} without a measurement, {roaming} roaming',
    },
    'Assign ({count})': {de: 'Zuweisen ({count})', en: 'Assign ({count})'},
    '{done} of {total} assigned': {de: '{done} von {total} zugewiesen', en: '{done} of {total} assigned'},
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
    // Task 28: VirtualDevices and CUxD have no install mode.
    'This interface cannot pair devices': {
        de: 'Diese Schnittstelle kann keine Geräte anlernen',
        en: 'This interface cannot pair devices',
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
    // Task 26: HmIP service-message suppression - the rows in the channel-0 paramset dialog, the
    // Apply preview underneath, and the per-row action of the service-messages tab.
    'Suppress all': {de: 'Alle unterdrücken', en: 'Suppress all'},
    suppressed: {de: 'unterdrückt', en: 'suppressed'},
    'not suppressed': {de: 'nicht unterdrückt', en: 'not suppressed'},
    Suppress: {de: 'Unterdrücken', en: 'Suppress'},
    Unsuppress: {de: 'Unterdrückung aufheben', en: 'Unsuppress'},
    'Service message suppression': {de: 'Unterdrückung von Servicemeldungen', en: 'Service message suppression'},
    'Nothing is sent until Apply; the preview lists every call first.': {
        de: 'Bis „Übernehmen“ wird nichts gesendet; die Vorschau zeigt vorher jeden Aufruf.',
        en: 'Nothing is sent until Apply; the preview lists every call first.',
    },
    '{count} calls will be made': {
        de: {one: '{count} Aufruf wird gesendet', other: '{count} Aufrufe werden gesendet'},
        en: {one: '{count} call will be made', other: '{count} calls will be made'},
    },
    // Task 26: the ROUTING_TABLE paramset of an HmIP router, as a graph and a table.
    'Routing table': {de: 'Routing-Tabelle', en: 'Routing table'},
    'Read from the device itself; every read costs duty cycle, so it is read once when this opens.': {
        de: 'Direkt vom Gerät gelesen; jedes Lesen kostet Duty Cycle, deshalb einmal beim Öffnen.',
        en: 'Read from the device itself; every read costs duty cycle, so it is read once when this opens.',
    },
    'No routes: the device reported an empty table.': {
        de: 'Keine Routen: das Gerät hat eine leere Tabelle gemeldet.',
        en: 'No routes: the device reported an empty table.',
    },
    Destination: {de: 'Ziel', en: 'Destination'},
    'Next hop': {de: 'Nächster Hop', en: 'Next hop'},
    Hops: {de: 'Hops', en: 'Hops'},
    hops: {de: {one: 'Hop', other: 'Hops'}, en: {one: 'hop', other: 'hops'}},
    Neighbour: {de: 'Nachbar', en: 'Neighbour'},
    Static: {de: 'Statisch', en: 'Static'},
    Router: {de: 'Router', en: 'Router'},
    'Access controller': {de: 'Access Controller', en: 'Access controller'},
    Portable: {de: 'Tragbar', en: 'Portable'},
    'Listener mode': {de: 'Empfangsmodus', en: 'Listener mode'},
    Valid: {de: 'Gültig', en: 'Valid'},
    'Unsuppress all': {de: 'Keine unterdrücken', en: 'Unsuppress all'},
    'A suppressed one reports a value that raises no message; the CCU shows it as inactive.': {
        de: 'Eine unterdrückte meldet einen Wert, der keine Meldung auslöst; die CCU zeigt sie als inaktiv.',
        en: 'A suppressed one reports a value that raises no message; the CCU shows it as inactive.',
    },
    'other firmware or device type': {
        de: 'andere Firmware oder anderer Gerätetyp',
        en: 'other firmware or device type',
    },

    // The links tab.
    // Task 33: the captioned button; the dialog it opens keeps its title "Create link".
    'Add link': {de: 'Verknüpfung anlegen', en: 'Add link'},
    'No channel of this interface can be the sender of a link': {
        de: 'Kein Kanal dieser Schnittstelle kann Sender einer Verknüpfung sein',
        en: 'No channel of this interface can be the sender of a link',
    },
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
    'Only STICKY_UNREACH and SABOTAGE can be acknowledged': {
        de: 'Nur STICKY_UNREACH und SABOTAGE lassen sich bestätigen',
        en: 'Only STICKY_UNREACH and SABOTAGE can be acknowledged',
    },
    // Task 36 (#150): the band's total when other interfaces have messages too.
    '{count} of {total} on this box': {
        de: '{count} von {total} auf dieser Zentrale',
        en: '{count} of {total} on this box',
    },
    'Also on this box: {list}. Click to switch to {next}.': {
        de: 'Außerdem auf dieser Zentrale: {list}. Ein Klick wechselt zu {next}.',
        en: 'Also on this box: {list}. Click to switch to {next}.',
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
    // Task 28: pairing an HmIP device without its SGTIN, and what each of the three ways needs.
    'Any device (no SGTIN)': {de: 'Beliebiges Gerät (ohne SGTIN)', en: 'Any device (no SGTIN)'},
    'Works offline: the key from the sticker is all the interface needs.': {
        de: 'Funktioniert offline: Der Schlüssel vom Aufkleber ist alles, was die Schnittstelle braucht.',
        en: 'Works offline: the key from the sticker is all the interface needs.',
    },
    "The key comes from eQ-3's key server: the box needs internet access.": {
        de: 'Der Schlüssel kommt vom Key Server von eQ-3: Die Zentrale braucht Internetzugang.',
        en: "The key comes from eQ-3's key server: the box needs internet access.",
    },
    "Pairs the next device in factory state that asks to join. Without a key the interface asks eQ-3's key server, so the box needs internet access unless a local key mapping is configured.":
        {
            de: 'Lernt das nächste Gerät im Werkszustand an, das sich meldet. Ohne Schlüssel fragt die Schnittstelle den Key Server von eQ-3, die Zentrale braucht also Internetzugang, sofern keine lokale Schlüsselzuordnung eingerichtet ist.',
            en: "Pairs the next device in factory state that asks to join. Without a key the interface asks eQ-3's key server, so the box needs internet access unless a local key mapping is configured.",
        },
    'The install mode has ended and no device has joined. A device that is still paired with another central sends no inclusion request: reset it to factory state and start again.':
        {
            de: 'Der Anlernmodus ist abgelaufen, und kein Gerät hat sich angemeldet. Ein Gerät, das noch an einer anderen Zentrale angelernt ist, sendet keine Anlernanfrage: Gerät auf Werkseinstellungen zurücksetzen und erneut starten.',
            en: 'The install mode has ended and no device has joined. A device that is still paired with another central sends no inclusion request: reset it to factory state and start again.',
        },
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

    // The update notice (D-16); silent without a host bridge. The About dialog that carried the
    // other half of these strings is gone (task 23), and so are its keys.
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
    'Device data': {de: 'Gerätedaten', en: 'Device data'},
    // Task 23: the accessible name of the GitHub icon that replaced the "?" menu.
    'Homematic Manager on GitHub': {
        de: 'Homematic Manager auf GitHub',
        en: 'Homematic Manager on GitHub',
    },

    // The settings dialog. Task 23 groups it into five titled sections and puts a help line under
    // the fields that need one - the 2.x dialog was one list of eighteen unexplained rows.
    Connection: {de: 'Verbindung', en: 'Connection'},
    Callback: {de: 'Rückruf', en: 'Callback'},
    Behaviour: {de: 'Verhalten', en: 'Behaviour'},
    'Configured interfaces': {de: 'Konfigurierte Schnittstellen', en: 'Configured interfaces'},
    // B-27 (#135): an extra interface is only connected once it is ticked in the list above it
    'An extra interface is connected once it is ticked here': {
        de: 'Eine zusätzliche Schnittstelle wird verbunden, sobald sie hier angehakt ist',
        en: 'An extra interface is connected once it is ticked here',
    },
    'Host name or address of the CCU': {
        de: 'Hostname oder Adresse der CCU',
        en: 'Host name or address of the CCU',
    },
    'Searches the network for CCUs over UDP': {
        de: 'Sucht per UDP im Netz nach CCUs',
        en: 'Searches the network for CCUs over UDP',
    },
    'The encrypted ports of the CCU': {de: 'Die verschlüsselten Ports der CCU', en: 'The encrypted ports of the CCU'},
    'The address the interface processes call back to': {
        de: 'Die Adresse, an die die Schnittstellenprozesse zurückrufen',
        en: 'The address the interface processes call back to',
    },
    'Probes the known ports in the background': {
        de: 'Prüft die bekannten Ports im Hintergrund',
        en: 'Probes the known ports in the background',
    },
    'ReGa supplies the friendly names': {
        de: 'ReGa liefert die Anzeigenamen',
        en: 'ReGa supplies the friendly names',
    },
    'Only possible with ReGa': {de: 'Nur mit ReGa möglich', en: 'Only possible with ReGa'},
    'Shortest pause between two writes': {
        de: 'Kürzeste Pause zwischen zwei Schreibzugriffen',
        en: 'Shortest pause between two writes',
    },
    'Empty switches the dumps off': {de: 'Leer schaltet die Mitschrift ab', en: 'Empty switches the dumps off'},
    'Discards the caches when this is saved': {
        de: 'Verwirft die Caches beim Speichern',
        en: 'Discards the caches when this is saved',
    },
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

    // D-40, task 25: rooms and functions - the grid columns, the filter, the assign dialog, the
    // tree dialog and the store indicator beside the interface mark.
    Rooms: {de: 'Räume', en: 'Rooms'},
    Functions: {de: 'Gewerke', en: 'Functions'},
    Room: {de: 'Raum', en: 'Room'},
    Function: {de: 'Gewerk', en: 'Function'},
    'All rooms': {de: 'Alle Räume', en: 'All rooms'},
    'All functions': {de: 'Alle Gewerke', en: 'All functions'},
    'Assign to room': {de: 'Raum zuordnen', en: 'Assign to room'},
    'Assign to function': {de: 'Gewerk zuordnen', en: 'Assign to function'},
    'Rooms and functions': {de: 'Räume und Gewerke', en: 'Rooms and functions'},
    // Task 49: the assignment dialog's checkbox list
    'Filter rooms': {de: 'Räume filtern', en: 'Filter rooms'},
    'Filter functions': {de: 'Gewerke filtern', en: 'Filter functions'},
    'No match': {de: 'Kein Treffer', en: 'No match'},
    'New room…': {de: 'Neuer Raum…', en: 'New room…'},
    'New function…': {de: 'Neues Gewerk…', en: 'New function…'},
    'Name of the new room': {de: 'Name des neuen Raums', en: 'Name of the new room'},
    'Name of the new function': {de: 'Name des neuen Gewerks', en: 'Name of the new function'},
    'Not saved: {message}': {de: 'Nicht gespeichert: {message}', en: 'Not saved: {message}'},
    '{count} changes were not saved': {
        de: {
            one: 'Eine Änderung wurde nicht gespeichert. Sie ist markiert; Übernehmen versucht sie erneut.',
            other: '{count} Änderungen wurden nicht gespeichert. Sie sind markiert; Übernehmen versucht sie erneut.',
        },
        en: {
            one: 'One change was not saved. It is marked; Apply tries it again.',
            other: '{count} changes were not saved. They are marked; Apply tries them again.',
        },
    },
    '{count} rows selected': {
        de: {one: 'Eine Zeile ausgewählt', other: '{count} Zeilen ausgewählt'},
        en: {one: 'One row selected', other: '{count} rows selected'},
    },
    'Select one or more rows': {de: 'Eine oder mehrere Zeilen auswählen', en: 'Select one or more rows'},
    'The store does not take writes': {
        de: 'Der Speicher nimmt keine Änderungen an',
        en: 'The store does not take writes',
    },
    'No store connected': {de: 'Kein Speicher verbunden', en: 'No store connected'},
    'No rooms yet': {de: 'Noch keine Räume', en: 'No rooms yet'},
    'No functions yet': {de: 'Noch keine Gewerke', en: 'No functions yet'},
    Add: {de: 'Anlegen', en: 'Add'},
    'Add below': {de: 'Darunter anlegen', en: 'Add below'},
    Move: {de: 'Verschieben', en: 'Move'},
    'Move to': {de: 'Verschieben nach', en: 'Move to'},
    'Top level': {de: 'Oberste Ebene', en: 'Top level'},
    'New name': {de: 'Neuer Name', en: 'New name'},
    'Delete and detach': {de: 'Löschen und Zuordnungen entfernen', en: 'Delete and detach'},
    'Still assigned here - the assignments are removed with the node:': {
        de: 'Noch zugeordnet - die Zuordnungen werden mit dem Knoten entfernt:',
        en: 'Still assigned here - the assignments are removed with the node:',
    },
    'Nothing is assigned here': {de: 'Hier ist nichts zugeordnet', en: 'Nothing is assigned here'},
    'A floor is a room with rooms below it: add one, then add rooms below it.': {
        de: 'Eine Etage ist ein Raum mit Räumen darunter: erst die Etage anlegen, dann Räume darunter.',
        en: 'A floor is a room with rooms below it: add one, then add rooms below it.',
    },
    'Rooms are a flat list on this system: no floors, no room below another.': {
        de: 'Räume sind auf diesem System eine flache Liste: keine Etagen, kein Raum unter einem anderen.',
        en: 'Rooms are a flat list on this system: no floors, no room below another.',
    },
    // 2026-09-10: the store is an entry of the interface picker with pages of its own - two
    // lists on ReGaHSS, the tree of taxonomies on occulited.
    Metadata: {de: 'Metadaten', en: 'Metadata'},
    Taxonomy: {de: 'Taxonomie', en: 'Taxonomy'},
    'New taxonomy': {de: 'Neue Taxonomie', en: 'New taxonomy'},
    'No taxonomies yet': {de: 'Noch keine Taxonomien', en: 'No taxonomies yet'},
    '{count} taxonomies': {
        de: {one: '{count} Taxonomie', other: '{count} Taxonomien'},
        en: {one: '{count} taxonomy', other: '{count} taxonomies'},
    },
    '{count} rooms': {
        de: {one: '{count} Raum', other: '{count} Räume'},
        en: {one: '{count} room', other: '{count} rooms'},
    },
    '{count} functions': {
        de: {one: '{count} Gewerk', other: '{count} Gewerke'},
        en: {one: '{count} function', other: '{count} functions'},
    },
    'Select a row': {de: 'Eine Zeile auswählen', en: 'Select a row'},
    'Select a node': {de: 'Einen Knoten auswählen', en: 'Select a node'},
    'Select a taxonomy or a node': {
        de: 'Eine Taxonomie oder einen Knoten auswählen',
        en: 'Select a taxonomy or a node',
    },
    'Names and rooms': {de: 'Namen und Räume', en: 'Names and rooms'},
    'Where names, rooms and functions are kept': {
        de: 'Wo Namen, Räume und Gewerke gespeichert sind',
        en: 'Where names, rooms and functions are kept',
    },
    Store: {de: 'Speicher', en: 'Store'},
    Automatic: {de: 'Automatisch', en: 'Automatic'},
    'This profile': {de: 'Dieses Profil', en: 'This profile'},
    'API token': {de: 'API-Token', en: 'API token'},
    'Only needed off the box': {de: 'Nur nötig, wenn nicht auf der Box', en: 'Only needed off the box'},
    Reachable: {de: 'Erreichbar', en: 'Reachable'},
    Unreachable: {de: 'Nicht erreichbar', en: 'Unreachable'},
    'Read-only': {de: 'Nur lesen', en: 'Read-only'},
    Writable: {de: 'Schreibbar', en: 'Writable'},
    'revision {revision}, {count} objects': {
        de: 'Revision {revision}, {count} Objekte',
        en: 'revision {revision}, {count} objects',
    },
};

/** Core's catalogue plus the UI's own keys; the UI's entries win on a collision. */
export const CATALOGUE: MessageCatalogue = {...MESSAGES, ...UI_MESSAGES};
