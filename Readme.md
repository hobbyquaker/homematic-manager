# Homematic Manager

[English language Readme](Readme.en.md)

## Dokumentation

Der Homematic Manager ist ein Web-Interface für [HomeMatic](http://www.homematic.com)-Schnittstellenprozesse
(rfd, hs485d, [Homegear](http://www.homegear.eu)).

Mit dem Homematic Manager ist es möglich Geräte an- und abzumelden, Geräte-Konfigurationen und Direktverknüpfungen zu
Verwalten und vieles mehr.


### Installation

* Homematic Manager setzt eine [Node.js](http://nodejs.org/download/) Installation inkl. npm voraus.
* Installation: ````sudo npm install -g homematic-manager````

### Konfiguration

Konfigurationsdatei `~/.hm-manager/hm-manager.json` (bzw. vor dem ersten Start `/usr/local/lib/node_modules/homematic-manager/settings-default.json`) bearbeiten:

IP Adressen auf der die Schnttstellenprozesse rfd/hs485d erreichbar sind (CCU- bzw. BidCoS®-Service IP-Adresse) anpassen. 

Ausserdem muss die IP-Adresse auf der der HomeMatic-Manager selbst erreichbar ist unter ````rpcListenIp```` eingetragen werden.

Es können beliebig viele Schnittstellenprozesse konfiguriert werden.

#### Beispielkonfiguration

* HomeMatic CCU mit Funk und Wired, IP-Adresse 192.168.1.100
* RaspberryPi auf dem (u.A.) der Homematic Manager läuft: 192.168.1.50
* zweite HomeMatic CCU nur mit Funk im Büro (per VPN an Heimnetz angebunden), IP-Adresse 10.23.42.200

```javascript
{
  "webServerPort": 8081,
  "rpcListenIp": "192.168.1.50",
  "daemons": {
    "RF-Zuhause": {
      "type": "BidCos-RF",
      "ip": "192.168.100",
      "port": 2001,
      "init": true
    },
    "Wired-Zuhause": {
      "type": "BidCos-Wired",
      "ip": "192.168.100",
      "port": 2000,
      "init": true
    },
    "Funk-Büro": {
      "type": "BidCos-RF",
      "ip": "10.23.42.200",
      "port": 2001,
      "init": true
    }
  },
  "language": "de"
}
```

### Homematic Manager starten

* ```hm-manager start```

## Todo

* Anlernen mit temporären Key
* Übersetzungen vervollständigen (fehlende Texte werden in Browser-Console gelistet)
* stringtable und .js-Sprachfiles aus OCCU importieren, Übersetzung Servicemeldungen, Übersetzung Params aus MASTER-Paramsets
* Direktverknüpfungen Profilvorlagen anlegen und anwenden
* Direktverknüpfungen Easymodes vervollständigen (WINMATIC)
* Direktverknüpfungen Easymodes Sonderbehandlung Wired (HMW_*)
* Direktverknüpfungen Easymodes testen
* Nach dem Anlernen im Dialog "new Device" direkt Name vergeben
* Geräte tauschen
* Geräte deaktiveren/aktivieren (Ablernen mit speichern aller Paramsets und Links für spätere Wiederherstellung?)
* Mehrere (Link-)Paramsets auf einmal bearbeiten
* STICKY_UNREACH automatisch bestätigen und für jedes Gerät einen Unreach-Counter speichern (Anzeige im Tab Funk)
* RPC-Konsole: dynamische Eingabefelder für putParamset
* Namen ändern direkt in den Grids ("inline-edit")?
* i18n überarbeiten. Sprachfiles nach Sprachen auftrennen und nur notwendige Übersetzung laden
* Übersetzungsmethode _() erweitern: Singular/Plural, printf-like string-insertion
* Anderes Konzept ausdenken für Texte die in .html Datei stecken
* Styles komplett aus index.html entfernen und in homematic-manager.css packen
* index.html/homematic-manager.css - Refactoring Klassen und IDs
* Config-Dialog im UI
#### Integration in [Hmcon](https://github.com/hobbyquaker/hmcon)
* Auftrennen Webserver und hm-manager, Plugin-Konzept
* rfd/hs485d Konfiguration über UI (Interfaces hinzufügen/entfernen, Loglevel)
* Sicherheitsschlüssel setzen
* Prozessmanager integrieren für rfd/hs485d
* Backup/Restore
* Upload Firmwareupdate Dateien über UI


## Changelog

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

Copyright (c) 2014, 2015 Anli, Hobbyquaker

[CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/)


Der obige Urheberrechtsvermerk ist in allen Kopien oder Teilkopien der Software beizulegen.

DIE SOFTWARE WIRD OHNE JEDE AUSDRÜCKLICHE ODER IMPLIZIERTE GARANTIE BEREITGESTELLT, EINSCHLIESSLICH DER GARANTIE ZUR BENUTZUNG FÜR DEN VORGESEHENEN ODER EINEM BESTIMMTEN ZWECK SOWIE JEGLICHER RECHTSVERLETZUNG, JEDOCH NICHT DARAUF BESCHRÄNKT. IN KEINEM FALL SIND DIE AUTOREN ODER COPYRIGHTINHABER FÜR JEGLICHEN SCHADEN ODER SONSTIGE ANSPRÜCHE HAFTBAR ZU MACHEN, OB INFOLGE DER ERFÜLLUNG EINES VERTRAGES, EINES DELIKTES ODER ANDERS IM ZUSAMMENHANG MIT DER SOFTWARE ODER SONSTIGER VERWENDUNG DER SOFTWARE ENTSTANDEN.

HomeMatic und BidCoS sind eingetragene Warenzeichen der [eQ-3 AG](http://eq-3.de)