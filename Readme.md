# HomeMatic-Manager

[English language Readme](Readme.en.md)

## Dokumentation

Der HomeMatic-Manager ist ein Web-Interface für [HomeMatic](http://www.homematic.com)-Schnittstellenprozesse 
(rfd, hs485d, CUxD, [Homegear](http://www.homegear.eu)). 

Mit dem HomeMatic-Manager ist es möglich Geräte an- und abzumelden, Geräte-Konfigurationen und Direktverknüpfungen zu 
Verwalten, Funk-Geräte zu bestimmten Interfaces zuzuordnen sowie das Roaming an- und auszuschalten und vieles mehr.


### Installation

* homematic-manager benötigt eine [Node.js](http://nodejs.org/download/) Installation
* Repository clonen oder [Zip-File](https://github.com/hobbyquaker/homematic-manager/archive/master.zip) herunterladen und auspacken
* In das homematic-manager Verzeichnis wechseln
* Node-Module installieren: ``npm install``

### Konfiguration

#### config.json (bzw. vor dem ersten Start config-default.json) bearbeiten:

IP Adressen auf der die Schnttstellenprozesse rfd/hs485d erreichbar sind (CCU- bzw. BidCoS®-Service IP-Adresse) anpassen. 
Falls es sich um eine CCU handelt kann der Parameter ````isCcu```` auf ````true```` gesetzt werden, dann werden die Namen 
von Geräten und Kanälen aus der CCU-Logikschicht "ReGaHSS" ausgelesen und das binäre RPC Protokoll anstatt XML-RPC genutzt. 

Ausserdem muss, falls bei einem Schnittstellenprozess der Parameter ````init```` auf ````true```` gesetzt wurde (notwendig 
um den Reiter "Ereignisse" zu nutzen), die IP-Adresse auf der der HomeMatic-Manager selbst erreichbar ist unter 
````rpcListenIp```` eingetragen werden.


### HomeMatic Manager starten

* ```node hm-manager.js start``` 
* [http://127.0.0.1:8081](http://127.0.0.1:8081) aufrufen

## Todo

* Direktverknüpfungen Easymodes
* Direktverknüpfungen Profilvorlagen
* Direktverknüpfungen kopieren
* alle Direktverknüpfungen für Backup/Dokumentation exportieren/importieren
* Geräte tauschen
* Firmware Updates
* Alle Servicemeldungen auf einmal bestätigen
* statt config.json bearbeiten Config-Dialog im UI
* Konsole: dynamische Eingabefelder für putParamset
* Geräte deaktiveren/aktivieren (Ablernen mit speichern aller Paramsets und Links - schwierig in Verbindung mit Rega...)
* Doku, Doku, Doku

## Changelog

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

Copyright (c) 2014 Anli, Hobbyquaker

[CC BY-NC-SA 4.0](http://creativecommons.org/licenses/by-nc-sa/4.0/)


Der obige Urheberrechtsvermerk ist in allen Kopien oder Teilkopien der Software beizulegen.

DIE SOFTWARE WIRD OHNE JEDE AUSDRÜCKLICHE ODER IMPLIZIERTE GARANTIE BEREITGESTELLT, EINSCHLIESSLICH DER GARANTIE ZUR BENUTZUNG FÜR DEN VORGESEHENEN ODER EINEM BESTIMMTEN ZWECK SOWIE JEGLICHER RECHTSVERLETZUNG, JEDOCH NICHT DARAUF BESCHRÄNKT. IN KEINEM FALL SIND DIE AUTOREN ODER COPYRIGHTINHABER FÜR JEGLICHEN SCHADEN ODER SONSTIGE ANSPRÜCHE HAFTBAR ZU MACHEN, OB INFOLGE DER ERFÜLLUNG EINES VERTRAGES, EINES DELIKTES ODER ANDERS IM ZUSAMMENHANG MIT DER SOFTWARE ODER SONSTIGER VERWENDUNG DER SOFTWARE ENTSTANDEN.

HomeMatic und BidCoS sind eingetragene Warenzeichen der [eQ-3 AG](http://eq-3.de)
