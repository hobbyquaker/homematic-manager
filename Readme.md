# Homematic Manager

[![Dependency Status](https://david-dm.org/hobbyquaker/homematic-manager/status.svg)](https://david-dm.org/hobbyquaker/homematic-manager)
[![macOS and Linux Build Status](https://travis-ci.org/hobbyquaker/homematic-manager.svg?branch=master)](https://travis-ci.org/hobbyquaker/homematic-manager)
[![Windows Build Status](https://ci.appveyor.com/api/projects/status/github/hobbyquaker/homematic-manager?branch=master&svg=true)](https://ci.appveyor.com/project/hobbyquaker/homematic-manager)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-blue.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

> Version 2: alpha - work in progress, unfertig und voller Bugs. Umbau als Electron-App.


## Dokumentation

Der Homematic Manager ist ein Konfigurationswerkzeug für [HomeMatic](http://www.homematic.com)-Schnittstellenprozesse
(rfd, hs485d, hmipserver/crRFD und [Homegear](http://www.homegear.eu)).

Mit dem Homematic Manager ist es möglich Geräte an- und abzulernen, Geräte-Konfigurationen und Direktverknüpfungen zu
verwalten und vieles mehr.


### Installation

Unter [latest releases](https://github.com/hobbyquaker/homematic-manager/releases/latest) sind Downloads für macOS, 
Linux und Windows zu finden.


## FAQ

#### Wie kann ich den Status eines Aktors sehen oder einen Aktor schalten?

Im Reiter Geräte das Gerät "aufklappen" (+ Icon links) und beim gewünschten Kanal auf den Button "Values" klicken.

#### Wie kopiere ich (Link-)Paramsets von einem Gerät/Kanal auf einen oder mehrere andere?

Öffne das Paramset bzw. die Verknüpfung die Du als Vorlage nutzen willst, wähle im Dropdown oben die Ziel-Geräte/Kanäle/Verknüpfungen
und klicke auf putParamset.


## Changelog

### 2.0.0
* (hobbyquaker) Umbau in Electron App, HmIP Anpassungen, diverse Fixes

### 1.0.13
* (hobbyquaker) Mehrere (Link-)Paramsets auf einmal bearbeiten
* (hobbyquaker) Geräte Thumbnails
* (hobbyquaker) Fix mehrfache Einträge im Daemon-Dropdown nach Verbindungsabbruch
* (hobbyquaker) Fix Easymode UI_HINT
* (hobbyquaker) Sonderbehandlung Anlernen von Wired Geräten (RPC searchDevices statt addDevice)
* (hobbyquaker) Easymodes ergänzt, Sonderbehandlung Wired Verknüpfungen (PUSH_BUTTON vs SWITCH)
* (hobbyquaker) Diverse Fixes und Korrekturen

### 1.0.12
* (hobbyquaker) Service-Message Popup für RSSI_* Nachrichten unterbunden Fix https://github.com/hobbyquaker/homematic-manager/issues/34
* (hobbyquaker) neue Config-Option disableServiceMsgPopup
* (hobbyquaker) Easymodes für Empfängertypen RGBW_AUTOMATIC, RGBW_COLOR und SWITCH_VIRTUAL_RECEIVER (ungetestet)
* (hobbyquaker) Fehler abgefangen beim erzeugen der Easymode Formulare

### 1.0.11
* (hobbyquaker) Fix https://github.com/hobbyquaker/homematic-manager/issues/33 (hoffentlich)
* (hobbyquaker) Umbenennen eines Geräts und aller Kanäle gleichzeitig
* (hobbyquaker) reportValueUsage auf allen Datenpunkten eines Kanals

### 1.0.10
* (hobbyquaker) diverse Fixes und Verbesserungen
* (hobbyquaker) Easymodes für Empfängertyp SIGNAL_LED und SIGNAL_CHIME vervollständigt

### 1.0.8
* (hobbyquaker) diverse Fixes und Verbesserungen
* (hobbyquaker) Geräte tauschen
* (hobbyquaker) reportValueUsage
* (hobbyquaker) BINRPC wieder hinzugefügt

### 1.0.4
* (hobbyquaker) Config-Datei nun in ~/.homematic-manager/hm-manager.json
* (hobbyquaker) cleanup, refactoring
* (hobbyquaker) Direktverknüpfungen Easymodes
* (hobbyquaker) Kontext-Menüs
* (hobbyquaker) CUxD/BIN-RPC Unterstützung rausgeworfen
* (hobbyquaker) Rega Unterstützung rausgeworfen (Geräte-/Kanal-Namen können manuell über tools/import_rega_names.js importiert werden)
* (hobbyquaker) RSSI-Tabelle Hintergrundfarben je nach RSSI-Wert
* (hobbyquaker) Installation als Node-Modul
* (hobbyquaker) diverse Fixes und Verbesserungen

### 0.9.4
* (Anli) Alle Servicemeldungen auf einmal bestätigen
* (Anli) Hilfe ergänzt, Hilfs-Popups auch bei MASTER-Paramsets
* (Anli) diverse Fixes

### 0.9.3
* (hobbyquaker) working on english translation

### 0.9.2
* (hfedcba) Don't convert boolean values to string (Homegear compatibility)
* (Hobbyquaker) added CUxD support
* (Hobbyquaker) added binary rpc support (you have to set listenPortBin in config.json!)
* (Hobbyquaker) changed xmlrpc module source
* (Hobbyquaker) RPC Console now uses system.listMethods to fill method select
* (Hobbyquaker) prepared english translation

### 0.9.1
* (Anli) Modul node-iconv entfernt

### 0.9.0
* (Anli) Direktverknüpfung anlegen
* (Anli) Direktverknüpfung löschen
* (Anli) Benennung Geräte edit-link-dialog angepasst
* (Hobbyquaker) Aufgeräumt
* (Hobbyquaker) einzelne Service-Meldung bestätigen
* (Hobbyquaker) Geräte löschen, Geräte anlernen
* (Hobbyquaker) Tabellen refreshen

### 0.3.1
* (Hobbyquaker) Zuordnung von Geräten zu Interfaces, Roaming aktivieren/deaktivieren

### 0.3.0
* (Anli) Hilfe-Popup im Direktverknüpfungsdialog
* (Anli) activateLinkParamset korrigiert
* (Anli) Name/Beschreibung von Direktverknüpfungen kann editiert werden
* (Hobbyquaker) Event-Tabelle ohne jqGrid
* (Hobbyquaker) Geräte und Kanäle können (um)benannnt werden

### 0.2.1
* (Hobbyquaker) RPC Double auch wenn keine Nachkommastellen vorhanden sind
* (Hobbyquaker) Nur geänderte Werte in putParamset übernehmen

### 0.2.0
* (Hobbyquaker) RPC init
* (Hobbyquaker) Tabelle "Ereignisse"


### 0.1.0
* (Hobbyquaker) RSSI Tabelle überarbeitet, dynamische Spalten für Interfaces
* (Hobbyquaker) Interfaces-Tabelle in Tab Funk verschoben
* (Hobbyquaker) Spalte Aktionen aus Verknüpfungs-Tabelle entfernt, Buttons unten Links eingebaut
* (Hobbyquaker) Erster daemon wird automatisch selektiert
* (Hobbyquaker) Daemon-Dropdown wird ausgeblendet falls nur ein daemon vorhanden ist

### 0.0.8
* (Hobbyquaker) Konsole überarbeitet, fast fertig...

### 0.0.7
* (Hobbyquaker) RSSI und Interfaces
* (Hobbyquaker) Geräte-Tabelle überarbeiten: Spalten-Sortierung, Spalten-Breite, ...

### 0.0.6
* (Hobbyquaker) Hilfe- und Einstellungs-Dialog
* (Hobbyquaker) Style überarbeitet, bessere Platzausnutzung

### 0.0.5
* (Hobbyquaker) Button und Select Styles, Lade-Anzeigen
* (Hobbyquaker) jqGrid Update, Spalten ausblenden
* (Hobbyquaker) Vorbereitung Grid-Buttons

### 0.0.4
* (Hobbyquaker) RPC-Konsole überarbeitet, Dropdown für Methoden

### 0.0.3

* (Anli) Buttons für Linkaktionen, Löschen-Dialog

### 0.0.2

* (Anli) rudimentäre RPC Konsole
* (Anli) Direktverknüpfungen werden angezeigt
* (Hobbyquaker) Geräte/Kanal-Paramsets können editiert werden


## Lizenz

Copyright (c) 2014-2017 Sebastian 'hobbyquaker' Raff, Anli

[CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/)


Der obige Urheberrechtsvermerk ist in allen Kopien oder Teilkopien der Software beizulegen.

DIE SOFTWARE WIRD OHNE JEDE AUSDRÜCKLICHE ODER IMPLIZIERTE GARANTIE BEREITGESTELLT, EINSCHLIESSLICH DER GARANTIE ZUR BENUTZUNG FÜR DEN VORGESEHENEN ODER EINEM BESTIMMTEN ZWECK SOWIE JEGLICHER RECHTSVERLETZUNG, JEDOCH NICHT DARAUF BESCHRÄNKT. IN KEINEM FALL SIND DIE AUTOREN ODER COPYRIGHTINHABER FÜR JEGLICHEN SCHADEN ODER SONSTIGE ANSPRÜCHE HAFTBAR ZU MACHEN, OB INFOLGE DER ERFÜLLUNG EINES VERTRAGES, EINES DELIKTES ODER ANDERS IM ZUSAMMENHANG MIT DER SOFTWARE ODER SONSTIGER VERWENDUNG DER SOFTWARE ENTSTANDEN.

HomeMatic und BidCoS sind eingetragene Warenzeichen der [eQ-3 AG](http://eq-3.de)
