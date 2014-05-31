# HomeMatic-Manager

## Dokumentation

Der HomeMatic-Manager ist ein Web-Interface für die [HomeMatic](http://www.homematic.com)-Schnittstellenprozesse "rfd"
und "hs485d". Mit dem HomeMatic-Manager ist es möglich Geräte an- und abzumelden, Geräte-Konfigurationen und
Direktverknüpfungen zu Verwalten, Funk-Geräte zu bestimmten Interfaces zuzuordnen sowie das Roaming an- und
auszuschalten und vieles mehr.


### Installation

* homematic-manager benötigt eine Node.js Installation
* Repository clonen oder Zip-File herunterladen und auspacken
* Node-Module installieren: ``npm install``
* IP Adressen auf der die rfd/hs485d erreichbar sind in config-default.json anpassen

**Hinweis für Installation auf Windows:**
 Die Installation des iconv-moduls bedingt, das python installiert wird.
 Version muss kleiner als 3.0 sein, aktuell ist 2.7.6,
 nach der Installation Umgebungsvariable setzen (in cmd-Shell z.B.:
     ````set PYTHON=C:\Python27\python.exe````)
 und erst dann ````npm install```` aufrufen

### Starten

* ```node hm-manager.js start```
* http://&lt;ip&gt;:8081 aufrufen

## Todo

* Direktverknüpfungen Easymodes
* Direktverknüpfungen Profilvorlagen
* Direktverknüpfungen kopieren
* alle Direktverknüpfungen für Backup/Dokumentation exportieren/importieren
* Geräte tauschen
* Alle Servicemeldungen auf einmal bestätigen
* statt config.json bearbeiten Config-Dialog im UI
* Konsole: dynamische Eingabefelder für putParamset
* Geräte deaktiveren/aktivieren (Ablernen mit speichern aller Paramsets und Links - schwierig in Verbindung mit Rega...)
* Doku, Doku, Doku

## Changelog

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

Copyright (c) 2014 Anli, Hobbyquaker

[CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/)


Der obige Urheberrechtsvermerk ist in allen Kopien oder Teilkopien der Software beizulegen.

DIE SOFTWARE WIRD OHNE JEDE AUSDRÜCKLICHE ODER IMPLIZIERTE GARANTIE BEREITGESTELLT, EINSCHLIESSLICH DER GARANTIE ZUR BENUTZUNG FÜR DEN VORGESEHENEN ODER EINEM BESTIMMTEN ZWECK SOWIE JEGLICHER RECHTSVERLETZUNG, JEDOCH NICHT DARAUF BESCHRÄNKT. IN KEINEM FALL SIND DIE AUTOREN ODER COPYRIGHTINHABER FÜR JEGLICHEN SCHADEN ODER SONSTIGE ANSPRÜCHE HAFTBAR ZU MACHEN, OB INFOLGE DER ERFÜLLUNG EINES VERTRAGES, EINES DELIKTES ODER ANDERS IM ZUSAMMENHANG MIT DER SOFTWARE ODER SONSTIGER VERWENDUNG DER SOFTWARE ENTSTANDEN.
