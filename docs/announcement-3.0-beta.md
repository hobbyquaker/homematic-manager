# Forumsankündigung: Homematic Manager 3.0 Beta (Entwurf)

Entwurf für den Beitrag im [Homematic-Forum](https://homematic-forum.de/forum/viewtopic.php?f=18&t=45134),
Unterforum _Software / Sonstige_ bzw. als Antwort im bestehenden Thread zum Homematic Manager.

**Vor dem Posten anzupassen:** die Versionsnummer (`3.0.0-beta.N`), der Link auf das Release, der
npm-Paketname (OQ-14) und die Zeile zum Docker-Cookie (OQ-15), falls dann entschieden. Alles
darunter ist der Text, so wie er gepostet werden kann.

---

## Homematic Manager 3.0.0-beta.N — Beta zum Testen

Nach reichlich langer Pause gibt es wieder etwas vom Homematic Manager: **Version 3.0 ist ein
kompletter Neubau** und liegt jetzt als Beta zum Testen bereit.

Das letzte Release war 2.7.1 aus dem Januar 2023 — eine Electron-App auf Electron 4 von 2019, mit
jQuery, free-jqgrid und ohne einen einzigen Test. Genau daran lag ein Großteil der Fehler, die hier
im Thread stehen: dass 2.7.1 auf aktuellem Windows gar nicht mehr startet, das endlose "loading" an
einer langsamen CCU, der Absturz bei einer 401 von ReGa. 3.0 ist deshalb kein Update, sondern ein
Neubau auf aktuellem Electron, Svelte 5 und einem getesteten TypeScript-Kern.

**Die Oberfläche bleibt bewusst wie sie war.** Gleiche Reiter, gleiche Tabellen, gleiche Dialoge,
gleiche Arbeitsabläufe — nur neu implementiert. Wer 2.7 kennt, muss nichts neu lernen.

### Was neu dazukommt

- **Er läuft jetzt auch auf der CCU selbst**, als Addon (CCU3-Firmware ab 3.61.5, ELV-Charly,
  OpenCCU) — aufzurufen aus der _Systemsteuerung_, ohne zweiten Rechner, ohne CCU-Adresse, ohne
  offenen Port.
- **Der Schreibweg auf die Geräte ist repariert.** `putParamset` schickt nur noch die tatsächlich
  geänderten und validierten Parameter, und vor jedem Schreiben zeigt eine Vorschau den exakten
  Aufruf. Multi-Apply gilt nur noch für Kanäle mit identischer Parameterbeschreibung statt für
  alles mit gleichem Kanaltyp — das war die Ursache für die `CONFIG_PENDING`-Fälle nach dem
  Übertragen auf mehrere Kanäle.
- **Deutsch und Englisch** in der ganzen Oberfläche, zur Laufzeit umschaltbar, und ein **Dark
  Mode**, der der Systemeinstellung folgt.
- Das Addon kann auf Wunsch **nach einem CCU-Benutzer fragen**, wenn man es als Lesezeichen direkt
  aufruft statt über die Systemsteuerung. Standardmäßig aus, umschaltbar auf der Einstellungsseite
  des Addons.
- **Easy-Mode-Profile für alle HmIP-Empfänger** (3521 Profile über 725 Empfänger/Sender-Kombinationen),
  statt der von Hand gepflegten Tabelle von 2015.
- Geräte-spezifische Editoren für Heizungs-Wochenprogramme, HmIP-Schaltprogramme, Rollladen- und
  Jalousiekalibrierung.

### Installation

Alle vier Varianten führen **dasselbe Backend und dieselbe Oberfläche** aus und benutzen dieselbe
`config.json`, ein Wechsel ist also ein Kopiervorgang.

| Variante | Für | Woher |
| --- | --- | --- |
| **CCU-Addon** | CCU3, Charly, OpenCCU (`armv7l`, `aarch64`, `x86_64`) | `hmm-ccu-<arch>-<version>.tar.gz`, hochgeladen unter _Systemsteuerung → Zusatzsoftware_ |
| **Desktop-App** | Windows 10+, macOS 12+, Linux (glibc 2.31+) | Installer / AppImage / dmg aus dem Release |
| **Server** | Proxmox-LXC, Debian, jeder Linux-Host mit Node ≥ 22.12 | `npm install -g <paketname>` und `homematic-manager-web --install` |
| **Docker** | amd64, arm64, arm/v7 | `ghcr.io/hobbyquaker/homematic-manager` |

Das richtige Addon-Paket sagt `uname -m` auf der CCU. Anleitungen für jede Variante liegen im
Repository unter [docs/](https://github.com/hobbyquaker/homematic-manager/tree/master/docs).

### Für Umsteiger von 2.x

- Die 2.x-Konfiguration wird beim allerersten Start **einmalig übernommen** (CCU-Adresse, TLS,
  Anmeldung, Sprache, RPC-Pacing, Logordner, Callback-Adresse). Die alten Caches nicht — die werden
  neu aufgebaut. **2.7.1 bleibt unangetastet** und kann parallel installiert bleiben.
- **Die Option "BIN-RPC bevorzugen" ist weg.** Keine CCU lauscht im LAN auf BIN-RPC; die Ports
  2001/2000 sind XML-RPC-Proxys des lighttpd. Für das Addon (lokal) und für CUxD wird BIN-RPC
  weiter benutzt, nur nicht mehr als Einstellung.
- **Kein HVL-Support mehr** (das Projekt ist tot) und **keine Homegear-Sonderbehandlung** mehr.
  Homegear funktioniert über den normalen XML-RPC-Weg weiter, dort wo es sich wie eine CCU verhält.
- **Keine 32-Bit-ARM-Desktop-Builds mehr** — Electron baut das nicht mehr. Auf so einer Maschine
  läuft das CCU-Addon oder die Serverinstallation, beides reines Node.
- Ein Konfigurationswechsel startet die App nicht mehr neu, und das Beenden wartet darauf, dass
  sich das Backend an den Schnittstellenprozessen ordentlich abmeldet.

Details dazu:
[docs/migration-from-2.x.md](https://github.com/hobbyquaker/homematic-manager/blob/master/docs/migration-from-2.x.md).

### Was in dieser Beta bekanntermaßen nicht stimmt

- Ein `°` von `rfd` oder CUxD über **BIN-RPC** kommt als `�` an — das betrifft das CCU-Addon und
  CUxD, nicht den XML-RPC-Weg. Die Ursache liegt in einer Bibliothek und ist ein Einzeiler, der
  dort noch eingebaut werden muss.
- **BidCos-Wired** meldet sich auf Systemen ohne Wired-Gateway alle paar Minuten mit einer
  Fehlerzeile. Die Schnittstelle wird inzwischen als "nicht vorhanden" markiert und die Versuche
  werden gestreckt; abschalten lässt sie sich in den Einstellungen.
- Das **Docker-Image** gibt sein Session-Cookie auch auf einer Nicht-Loopback-Adresse aus, damit die
  Oberfläche im Container überhaupt funktioniert. Wer den Port veröffentlicht, sollte
  [docs/install-docker.md](https://github.com/hobbyquaker/homematic-manager/blob/master/docs/install-docker.md)
  lesen — dort stehen drei Wege, das abzusichern.
- **Windows-Signierung fehlt noch**, SmartScreen warnt daher beim ersten Start ("Weitere
  Informationen → Trotzdem ausführen"). macOS ist notarisiert.
- Im Log des CCU-Addons steht einmal pro Minute eine Zeile, dass `VirtualDevices` auf
  `getServiceMessages` kein gültiges XML-RPC antwortet. Das ist harmlos und stört nichts, sieht im
  ansonsten leeren Log aber nach mehr aus als es ist.
- Noch **nicht wieder dabei**: automatische Zuweisung der besten BidCos-Schnittstelle, CCU-Jack als
  vordefinierte Schnittstelle (als benutzerdefinierte Schnittstelle geht es), und ein Teil der
  geräte-spezifischen Editoren (Lichteffekte, RGBW, Alarmzentrale, ESI-Energiezähler,
  Türschlösser).

Die vollständige Liste steht im
[CHANGELOG](https://github.com/hobbyquaker/homematic-manager/blob/master/CHANGELOG.md) unter
"Known issues".

### Was ich von einer Beta brauche

Vor allem Rückmeldungen von **echter Hardware, die ich nicht habe** — BidCos-Wired, HmIP-Wired
jenseits von DRAP/DRI16/DRS8, Homegear, CUxD, große Installationen mit vielen hundert Geräten, und
alles, was beim Schreiben von Parametern nicht so reagiert wie erwartet.

**Fehler bitte als Issue** unter
[github.com/hobbyquaker/homematic-manager/issues](https://github.com/hobbyquaker/homematic-manager/issues),
mit Installationsart (Addon / Desktop / Server / Docker), Version, CCU-Firmware und — wenn es um
einen Schreibvorgang geht — dem Text aus dem Vorschau-Dialog. Fragen und Diskussion gerne hier im
Thread.

Der Homematic Manager 3.0 steht unter der **AGPL-3.0-or-later**.
