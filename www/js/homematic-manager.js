/**
 *      homematic-manager
 *
 *  Copyright (c) 2014 Anli, Hobbyquaker
 *
 *  CC BY-NC-SA 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
 *
 */

"use strict";

;(function ($) {
$(document).ready(function () {

    var socket = io.connect();
    var daemon;
    var config;
    var listDevices;
    var indexDevices;
    var indexChannels = {};
    var indexSourceRoles = {};
    var indexTargetRoles = {};
    var listLinks;
    var listRssi;
    var listInterfaces;
    var regaNames;
    var hash;

    var rpcMethods = {
        abortDeleteDevice: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'address', type: 'device_address' }
            ],
            returns: 'void',
            help: "Diese Methode bricht einen anhängigen Löschvorgang für ein Gerät ab.<br>Es können nur Löschvorgänge abgebrochen werden, die mit dem Flag DELETE_FLAG_DEFER ausgeführt wurden."
        },
        activateLinkParamset: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'address', type: 'channel_address' },
                { name: 'peer_address', type: 'channel_address' },
                { name: 'long_press', type: 'boolean' }
            ],
            returns: 'void',
            help: "Mit dieser Methode wird ein Link-Parameterset aktiviert. Das logische Gerät verhält sich dann so als ob es direkt von dem entsprechenden zugeordneten Gerät angesteuert worden wäre. Hiermit kann z.B. ein Link-Parameter-Set getestet werden. Der Parameter address ist die Addresses des anzusprechenden logischen Gerätes. Der Parameter peer_address ist die Addresse des Kommunikationspartners, dessen Link-Parameter-Set aktiviert werden soll. Der Parameter long_press gibt an, ob das Parameterset für den langen Tastendruck aktiviert werden soll."
        },
        addDevice: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'address', type: 'string' },
                { name: 'mode', type: 'integer', optional: ['rfd'] }
            ],
            returns: 'DeviceDescription',
            help: "Diese Methode lernt ein Gerät anhand seiner Seriennummer an die CCU an. Diese Funktion wird nicht von jedem Gerät unterstützt. Rückgabewert ist die DeviceDescription des neu angelernten Geräts.<br>Der optionale Parameter mode bestimmt die Art des Installations-Modus:<br>1 = Normaler Installations-Modus<br>2 = Während des Anlernens werden in den Parametersets „MASTER“ default Parameter gesetzt und alle bestehenden Verknüpfungen werden gelöscht."
        },
        addLink: {
            rfd: true,
            hs485d: true,
            params: [
                // String sender, String receiver, String name, String description
                { name: 'sender', type: 'channel_address' },
                { name: 'receiver', type: 'channel_address' },
                { name: 'name', type: 'string', optional: ['rfd', 'hs485d'] },
                { name: 'description', type: 'string', optional: ['rfd', 'hs485d'] }
            ],
            returns: 'void',
            help: "Diese Methode erstellt eine Kommunikationsbeziehung zwischen zwei logischen Geräten. Die Parameter sender und receiver bezeichnen die beiden zu verknüpfenden Partner. Die Parameter name und description sind optional und beschreiben die Verknüpfung näher."
        },
        addVirtualDeviceInstance: {
            rfd: true,
            hs485d: false,
            params: [],
            returns: '',
            help: "leider nicht von eQ-3 dokumentiert."

        },
        changeKey: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'passphrase', type: 'string' }
            ],
            returns: 'void',
            help: "Diese Methode ändert den vom Schnittstellenprozess verwendeten AES-Schlüssel. Der Schlüssel wird ebenfalls in allen angelernten Geräten getauscht."
        },
        clearConfigCache: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' }
            ],
            returns: 'void',
            help: "Diese Methode löscht alle zu einem Gerät in der CCU gespeicherten Konfigurationsdaten. Diese werden nicht sofort wieder vom Gerät abgefragt, sondern wenn sie das nächste mal benötigt werden."
        },
        deleteDevice: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' },
                {
                    name: 'flags',
                    type: 'integer',
                    bitmask: {
                        '1': 'DELETE_FLAG_RESET',
                        '2': 'DELETE_FLAG_FORCE',
                        '4': 'DELETE_FLAG_DEFER'
                    }
                }
            ],
            returns: 'DeviceDescription',
            help: "Diese Methode löscht ein Gerät aus dem Schnittstellenprozess.<br>Der Parameter address ist die Addresse des zu löschenden Gerätes.<br>Flags ist ein bitweises oder folgender Werte:<ul><li>DELETE_FLAG_RESET Das Gerät wird vor dem Löschen in den Werkszustand zurückgesetzt </li><li>DELETE_FLAG_FORCE Das Gerät wird auch gelöscht, wenn es nicht erreichbar ist </li><li>DELETE_FLAG_DEFER Wenn das Gerät nicht erreichbar ist, wird es bei nächster Gelegenheit gelöscht</li></ul>"
        },
        determineParameter: {
            rfd: true,
            hs485d: false,
            params: [
                // String address, String paramset_key, String parameter_id
                { name: 'address', type: 'device_address' },
                { name: 'paramset_key', type: 'string' },
                { name: 'parameter_id', type: 'string' }
            ],
            returns: 'void',
            help: "Mit dieser Methode wird ein Parameter eines Parameter-Sets automatisch bestimmt. Der Parameter kann bei erfolgreicher Ausführung anschließend sofort über getParamset gelesen werden.<br>Der Parameter address ist die Addresses eines logischen Gerätes.<br>Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers). Der Parameter parameter_id bestimmt den automatisch zu bestimmenden Parameter."
        },
        getDeviceDescription: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' }
            ],
            returns: 'DeviceDescription',
            help: "Diese Methode gibt die Gerätebeschreibung des als address übergebenen Gerätes zurück."
        },
        getInstallMode: {
            rfd: true,
            hs485d: false,
            params: [
            ],
            returns: 'Integer',
            help: "Diese Methode gibt die verbliebene Restzeit in Sekunden im Anlernmodus zurück. Der Wert  0 bedeutet, der Anlernmodus ist nicht aktiv."
        },
        getKeyMismatchDevice: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'reset', type: 'bool' }
            ],
            returns: 'String',
            help: "Diese Methode gibt die Seriennummer des letzten Gerätes zurück, das aufgrund eines falschen AES-Schlüssels nicht angelernt werden konnte. Mit reset=true wird diese Information im Schnittstellenprozess zurückgesetzt."
        },
        getLGWStatus: {
            rfd: false,
            hs485d: true,
            params: [],
            returns: '',
            help: "Gibt den Status des Wired-LAN-Gateways zurück."
        },
        getLinkInfo: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'sender', type: 'device_address' },
                { name: 'receiver', type: 'device_address' }
            ],
            returns: 'Array',
            help: "Diese Methode gibt die Seriennummer des letzten Gerätes zurück, das aufgrund eines falschen AES-Schlüssels nicht angelernt werden konnte. Mit reset=true wird diese Information im Schnittstellenprozess zurückgesetzt."
        },
        getLinkPeers: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' }
            ],
            returns: '',
            help: "Diese Methode gibt alle einem logischen Gerät zugeordneten Kommunikationspartner zurück. Die zurückgegebenen Werte können als Parameter paramset_key für getParamset() und putParamset() verwendet werden. Der Parameter address ist die Adresse eines logischen Gerätes."
        },
        getLinks: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' },
                {
                    name: 'flags',
                    type: 'integer',
                    bitmask: {
                        '1': 'GL_FLAG_GROUP',
                        '2': 'GL_FLAG_SENDER_PARAMSET',
                        '4': 'GL_FLAG_RECEIVER_PARAMSET'
                    },
                    optional: ['rfd', 'hs485d']
                }
            ],
            returns: 'Array',
            help: "Diese Methode gibt alle einem logischen Kanal oder Gerät zugeordneten Kommunikationsbeziehungen zurück.<br>Der Parameter address ist die Kanal- oder Geräteadresse des logischen Objektes, auf das sich die Abfrage bezieht. Bei address==&quot;&quot; werden alle Kommunikationsbeziehungen des gesamten Schnittstellenprozesses zurückgegeben.<br>Der Parameter flags ist ein bitweises oder folgender Werte:<ul><li>GL_FLAG_GROUP Wenn address einen Kanal bezeichnet, der sich in einer Gruppe befindet, werden die Kommunikationsbeziehungen für alle Kanäle der Gruppe zurückgegeben.</li><li>GL_FLAG_SENDER_PARAMSET Das Feld SENDER_PARAMSET des Rückgabewertes wird gefüllt. </li><li>GL_FLAG_RECEIVER_PARAMSET Das Feld RECEIVER_PARAMSET des Rückgabewertes wird gefüllt.</li></ul>flags ist optional. Defaultwert ist 0x00."
        },
        getParamset: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'paramset_key', type: 'string' },
                { name: 'mode', type: 'integer', optional: ['rfd'] }
            ],
            returns: '',
            help: "Mit dieser Methode wird ein komplettes Parameter-Set für ein logisches Gerät gelesen. Der Parameter address ist die Addresses eines logischen Gerätes. Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers).<br>Dem optionalen Parameter mode können folgende Werte übergeben werden (nur rfd):<ul><li>0 default: Keien Auswirkung, die Funktion verhält sicht wie der Aufruf ohne mode</li><li>1 UndefinedValues: Jeder Eintrag inerhalb des zurückgelieferten Paramset ins eine Struktur mit folgendem Aufbau:<br>„UNDEFINED“(Boolean) Flag ob der angeforderte Wert initial gesetzt wurde und somit wahrscheinlich nicht der Realität entspricht oder ob der Wert von einem Gerät empfangen wurde, true = Wert wurde initial gesetzt und noch nicht verändert, false = der Wert wurde neu gesetzt <br>„VALUE“(ValueType) Wert des angeforderten Parameter.<br>UndefindeValues kann nur für Parameter aus dem Parameterset „VALUES“ abgefragt werden."
        },
        getParamsetDescription: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'paramset_type', type: 'paramset_type' }
            ],
            returns: '',
            help: "Mit dieser Methode wird die Beschreibung eines Parameter-Sets ermittelt. Der Parameter address ist die Adresse eines logischen Gerätes (z.B. von listDevices zurückgegeben). Der Parameter paramset_type ist „MASTER“, „VALUES“ oder „LINK“."
        },
        getParamsetId: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'type', type: 'string' }
            ],
            returns: '',
            help: "Diese Methode gibt die Id eines Parametersets zurück. Diese wird verwendet, um spezialisierte Konfigurationsdialoge (Easymode) den Parametersets zuzuordnen."
        },
        getServiceMessages: {
            rfd: true,
            hs485d: false,
            params: [
            ],
            help: "Diese Methode gibt eine Liste aller vorhandenen Servicemeldungen in Form eines Arrays zurück."
        },
        getValue: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' },
                { name: 'value_key', type: 'string' },
                { name: 'mode', type: 'integer', optional: ['rfd'] }
            ],
            returns: '',
            help: "Mit dieser Methode wird ein einzelner Wert aus dem Parameter-Set „VALUES“ gelesen. Der Parameter address ist die Addresse eines logischen Gerätes. Der Parameter value_key ist der Name des zu lesenden Wertes. Die möglichen Werte für value_key ergeben sich aus der ParamsetDescription des entsprechenden Parameter-Sets „VALUES“.<br>Dem Parameter mode können folgende Werte übergeben werden:<ul><li>0 default: Keien Auswirkung, die Funktion verhält sicht wie der Aufruf ohne mode</li><li>1 UndefinedValues: Es wird ein Struktur zurückgeliefert die folgenden Aufbau hat:<br>„UNDEFINED“(Boolean) Flag ob der angeforderte Wert initial gesetzt wurde und somit wahrscheinlich nicht der Realität entspricht oder ob der Wert von eimen Gerät empfangen wurde, true = Wert wurde initial gesetzt und noch nicht verändert, false = der Wert wurde neu gesetzt<br>„VALUE“(ValueType) Wert des angeforderten Parameter.</li></ul><br>UndefindeValues kann nur für Parameter aus dem Parameterset „VALUES“ abgefragt werden die mit OPERATIONS = Read gekenzeichnet sind."
        },
        getVersion: {
            rfd: true,
            hs485d: false,
            params: [],
            returns: '',
            help: "Liefert die Version des BidCoS-Service."
        },
        /*init: {
         rfd: true,
         hs485d: true,
         params: [
         ]
         },*/
        listBidcosInterfaces: {
            rfd: true,
            hs485d: false,
            params: [],
            returns: '',
            help: "Diese Methode gibt eine Liste aller vorhandenen BidCoS-Interfaces in Form eines Arrays von Structs zurück"
        },
        listDevices: {
            rfd: true,
            hs485d: true,
            params: [],
            returns: '',
            help: "Diese Methode gibt alle dem Schnittstellenprozess bekannten Geräte in Form von Gerätebeschreibungen zurück."
        },
        listReplaceableDevices: {
            rfd: true,
            hs485d: true,
            params: [
                { name: "newDeviceAddress", type: "device_address" }
            ],
            returns: '',
            help: "Mit dieser Funktionen kann eine Liste der Geräte angefordert werden die durch das übergebene Gerät ersetzt werden können.<br>Über den Parameter newDeviceAddress wird die Adresse des neuen Geräts übergeben für die die möglichen Tauschpartner ermittelt werden sollen."
        },
        listTeams: {
            rfd: true,
            hs485d: false,
            params: [],
            returns: '',
            help: "Diese Methode gibt alle dem Schnittstellenprozess bekannten Teams in Form von Gerätebeschreibungen zurück."
        },
        logLevel: {
            rfd: true,
            hs485d: true,
            params: [
                {
                    name: "level",
                    type: "integer",
                    optional: ["rfd", "hs485d"],
                    values: {
                        "0": "LOG_ALL",
                        "1": "LOG_DEBUG",
                        "2": "LOG_INFO",
                        "3": "LOG_NOTICE",
                        "4": "LOG_WARNING",
                        "5": "LOG_ERROR",
                        "6": "LOG_FATAL_ERROR"
                    }
                }
            ],
            returns: '',
            help: "Diese Methode gibt den aktuellen Log-Level zurück bzw. setzt diesen."
        },
        putParamset: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' },
                { name: 'paramset_key', type: 'string' },
                { name: 'set', type: 'paramset' }
            ],
            returns: '',
            help: "Mit dieser Methode wird ein komplettes Parameter-Set für ein logisches Gerät geschrieben. Der Parameter address ist die Addresses eines logischen Gerätes. Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers). Der Parameter set ist das zu schreibende Parameter-Set. In set nicht vorhandene Member werden einfach nicht geschrieben und behalten ihren alten Wert"
        },
        removeLink: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'sender', type: 'device_address' },
                { name: 'receiver', type: 'device_address' }
            ],
            returns: '',
            help: "Diese Methode löscht eine Kommunikationsbeziehung zwischen zwei Geräten. Die Parameter sender und receiver bezeichnen die beiden Kommunikationspartner deren Kommunikationszuordnung gelöscht werden soll."
        },
        replaceDevice: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'oldDeviceAddress', type: 'device_address' },
                { name: 'newDeviceAddress', type: 'device_address' }
            ],
            returns: '',
            help: "Mit dieser Funktion kann ein altes gegen ein neues Gerät ausgetauscht werden. Alle direkten Geräteverknüpfungen und Konfigurationen werden auf das neue Gerät kopiert und das alte Gerät gelöscht. Die Beiden Geräte müssen hinsichtlich ihrer Funktionalität kompatibel sein. Mit der Methode listReplaceableDevice() kann eine List kompatibeler Geräte abgefragt werden. Das neue Gerät muss an dem Schnittstellenprozess angemeldet sein und darf noch nicht in Verknüpfungen verwendet werden. Über die Parameter oldDeviceAddress und newDeviceAddress wird der Methode die Adresse des alten Gerätes und des neuen Gerätes übergeben. Der Rückgabewert ist true wenn der Tausch erfolgreich war, ansonsten false"
        },
        reportValueUsage: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'device_address' },
                { name: 'value_id', type: 'string' },
                { name: 'ref_counter', type: 'integer' }
            ],
            returns: '',
            help: "Diese Methode teilt dem Interfaceprozess in ref_counter mit, wie oft der Wert value_id des Kanals address innerhalb der Logikschicht (z.B. in Programmen) verwendet wird. Dadurch kann der Interfaceprozess die Verbindung mit der entsprechenden Komponente herstellen bzw. löschen. Diese Funktion sollte bei jeder Änderung aufgerufen werden.<br>Der Rückgabewert ist true, wenn die Aktion sofort durchgeführt wurde. Er ist false, wenn die entsprechende Komponente nicht erreicht werden konnte und vom Benutzer zunächst in den Config-Mode gebracht werden muss. Der Interfaceprozess hat dann aber die neue Einstellung übernommen und wird sie bei nächster Gelegenheit automatisch an die Komponente übertragen. In diesem Fall ist dann auch der Wert CONFIG_PENDING im Kanal MAINTENANCE der Komponente gesetzt."
        },
        restoreConfigToDevice: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'address', type: 'device_address' }
            ],
            returns: '',
            help: "Diese Methode überträgt alle zu einem Gerät in der CCU gespeicherten Konfigurationsdaten erneut an das Gerät."
        },
        rssiInfo: {
            rfd: true,
            hs485d: false,
            params: [],
            returns: '',
            help: "Gibt ein zweidimensionales assoziatives Array zurück, dessen Schlüssel die Geräteadressen sind. Die Felder des assoziativen Arrays sind Tupel, die die Empfangsfeldstärken zwischen beiden Schlüsselgeräten für beide Richtungen in dbm angeben. ein Wert von 65536 bedeutet, dass keine Informationen vorliegen.<ul><li>Rückgabewert[<Gerät 1>][<Gerät 2>][0] Empfangsfeldstärke an Gerät 1 für Sendungen von Gerät 2</li><li>Rückgabewert[<Gerät 1>][<Gerät 2>][1] Empfangsfeldstärke an Gerät 2 für Sendungen von Gerät 1</li></ul>"

        },
        searchDevices: {
            rfd: false,
            hs485d: true,
            params: [],
            returns: '',
            help: "Diese Methode durchsucht den Bus nach neuen Geräten und gibt die Anzahl gefundener Geräte zurück. Die neu gefundenen Geräte werden mit newDevices der Logikschicht gemeldet."
        },
        setBidcosInterface: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'device_address', type: 'device_address' },
                { name: 'interface_address', type: 'interface_address' },
                { name: 'roaming', type: 'boolean' }
            ],
            returns: '',
            help: "Diese Methode setzt das für die Kommunikation mit dem durch device_address spezifizierten Gerät verwendete Bidcos-Interface. Die Seriennummer des in Zukunft für die Kommunikation mit diesem Gerät zu verwendenden Interfaces wird in interface_address übergeben. Ist der Parameter roaming gesetzt, so wird die Interfacezuordnung für das Gerät automatisch in Abhängigkeit von der Empfangsfeldstärke angepasst. Das ist für nicht ortsfeste Geräte wie Fernbedienungen sinnvoll."

        },
        setInstallMode: {
            rfd: true,
            hs485d: false,
            params: [
                // TODO Mode 3 (anlernen über Seriennummer)
                { name: 'on', type: 'boolean' },
                { name: 'time', type: 'integer', optional: ['rfd'] },
                { name: 'mode', type: 'integer', optional: ['rfd'] }
            ],
            returns: '',
            help: "Diese Methode aktiviert und deaktiviert den Installations-Modus, in dem neue Geräte an der HomeMatic-CCU angemeldet werden können.<br>Der Parameter on bestimmt, ob der Installations-Modus aktiviert oder deaktiviert werden soll.<br>Der Parameter time bestimmt die Zeit in Sekunden die der Installations-Modus aktiviert ist<br>Der Parameter mode bestimmt die Art des Installations-Modus:<ul><li>1 = Normaler Installations-Modus</li><li>2 = Während des Anlernens werden in den Parametersets „MASTER“ default Parameter gesetzt und alle bestehenden Verknüpfungen werden gelöscht.</li></ul>"
        },
        setInterfaceClock: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'utcSeconds', type: 'integer' },
                { name: 'offsetMinutes', type: 'integer' }
            ],
            returns: '',
            help: "Setzt die UTC Zeit für alle Interfaces, die dies benötigen.<br>Mit dem Parameter utcSeconds werden die Sekunden seti 01.01.1970 00:00 Uhr (UTC) gesetzt.<br>Über den Parameter offsetMinutes wird der Offset in Minuten entsprechend der jeweiligen Zeitzone übergeben.<br>Der Rückgabewert der Methode ist false im Fehlerfall, ansonsten true."
        },
        setLinkInfo: {
            rfd: true,
            hs485d: true,
            params: [
                // String sender, String receiver, String name,  String description
                { name: 'sender', type: 'channel_address' },
                { name: 'receiver', type: 'channel_address' },
                { name: 'name', type: 'string' },
                { name: 'description', type: 'string' }
            ],
            returns: '',
            help: "Diese Methode ändert die beschreibenden Texte einer Kommunikationsbeziehung. Die Spezifikation Parameter sender und receiver bezeichnen die beiden zu verknüpfenden Partner. Die Parameter name und description beschreiben die Verknüpfung textuell."
        },
        setRFLGWInfoLED: {
            rfd: true,
            hs485d: false,
            params: [],
            returns: '',
            help: "leider nicht von eQ-3 dokumentiert."
        },
        setTeam: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'channel_address', type: 'channel_address' },
                { name: 'team_address', type: 'team_address' }
            ],
            returns: '',
            help: "Diese Methode fügt den Kanal channel_address zum Team team_address hinzu. Bei team_address==““ wird der Kanal channel_address seinem eigenen Team zugeordnet. Dabei muss team_address entweder leer sein (““) oder eine Seriennummer eines existierenden Teams enthalten. Teams werden dabei je nach Bedarf erzeugt und gelöscht."
        },
        setTempKey: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'passphrase', type: 'string' }
            ],
            returns: '',
            help: "Diese Methode ändert den von der CCU verwendeten temporären AES-Schlüssel. Der temporäre AES-Schlüssel wird verwendet, um ein Gerät anzulernen, in dem ein anderer Schlüssel gespeichert ist als der Schlüssel der CCU."
        },
        setValue: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'channel_address' },
                { name: 'value_key', type: 'value_key' },
                { name: 'value', type: 'mixed' }
            ],
            returns: '',
            help: "Mit dieser Methode wird ein einzelner Wert aus dem Parameter-Set „VALUES“ geschrieben. Der Parameter address ist die Addresse eines logischen Gerätes. Der Parameter value_key ist der Name des zu schreibenden Wertes. Die möglichen Werte für value_key ergeben sich aus der ParamsetDescription des entsprechenden Parameter-Sets „VALUES“. Der Parameter value ist der zu schreibende Wert."
        },
        'system.listMethods': {
            rfd: true,
            hs485d: true,
            params: []
        },
        'system.methodHelp': {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'method', type: 'string' }
            ]
        },
        /*'system.multicall': {
         rfd: true,
         hs485d: true,
         params: [
         ]
         },*/
        updateFirmware: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'device', type: 'device_address' }
            ],
            returns: '',
            help: "Diese Methode führt ein Firmware-Update für das in device angegebene Gerät durch. Das Gerät wird durch seine Seriennummer spezifiziert. Der Rückgabewert gibt an, ob das Firmware-Update erfolgreich war."
        }
    };

    socket.on('connect', function () {
        getConfig();
    });

    var eventCount = 0;

    socket.on('rpc', function (method, params) {
        switch (method) {
            case 'event':
                var daemonIdent = params[0];
                if (daemonIdent != config.daemons[daemon].ident) break;
                var address = params[1];
                var param = params[2];
                var value = params[3];
                var _index = $gridEvents.jqGrid('getGridParam', '_index');
                var rowNum = $gridEvents.jqGrid('getGridParam', 'rowNum') - 1;
                var keys = Object.keys(_index);
                if (keys.length > rowNum) {
                    var toDelete = keys.splice(0, keys.length - rowNum);
                    for (var i = 0; i < toDelete.length; i++) {
                        $gridEvents.jqGrid('delRowData', toDelete[i]);
                    }
                }
                var timestamp = new Date();
                var ts = timestamp.getFullYear() + '-' +
                    ("0" + (timestamp.getMonth() + 1).toString(10)).slice(-2) + '-' +
                    ("0" + (timestamp.getDate()).toString(10)).slice(-2) + ' ' +
                    ("0" + (timestamp.getHours()).toString(10)).slice(-2) + ':' +
                    ("0" + (timestamp.getMinutes()).toString(10)).slice(-2) + ':' +
                    ("0" + (timestamp.getSeconds()).toString(10)).slice(-2);

                var name = '';
                if (regaNames && regaNames[config.daemons[daemon].ip] && regaNames[config.daemons[daemon].ip][address]) {
                    name = regaNames[config.daemons[daemon].ip][address].Name;
                }

                $gridEvents.jqGrid('addRowData', eventCount++, {
                    Timestamp: ts,
                    Name: name,
                    ADDRESS: address,
                    PARAM: param,
                    VALUE: value
                }, 'first');



                $gridEvents.trigger('reloadGrid');

                break;
            default:
        }
    });

    function getConfig() {
        socket.emit('getConfig', function (data) {
            config = data;
            $('.version').html(config.version);

            hash = window.location.hash.slice(1);

            var count = 0;
            for (var daemon in config.daemons) {
                count += 1;
                $('#select-bidcos-daemon').append('<option value="' + daemon + '"' + (hash == daemon ? ' selected' : '') + '>' + daemon + ' (' + config.daemons[daemon].type + ' ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ')</option>');
            }

            if (count == 1) {
                $('#select-bidcos-daemon').hide();
            } else {
                $('#select-bidcos-daemon').multiselect({
                    classes: 'select-daemon',
                    multiple: false,
                    header: false,
                    selectedList: 1
                });
            }
            initHandlers();
            getRegaNames();
            initDaemon();
        });
    }

    function getUrlVars()
    {
        var vars = [], hash;
        var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
        for (var i = 0; i < hashes.length; i++)
        {
            hash = hashes[i].split('=');
            vars.push(hash[0]);
            vars[hash[0]] = hash[1];
        }
        return vars;
    }

    function getRegaNames() {
        socket.emit('getRegaNames', function (names) {
            regaNames = names;
        });
    }

    function initHandlers() {
        $('#select-bidcos-daemon').change(function () {
            initDaemon();
        });

        $('body').on('click', 'button.paramset', function () {
            $('#load_grid-devices').show();

            var tmp = $(this).attr('id').split('_');
            var address = tmp[1];
            var paramset = tmp[2];
            socket.emit('rpc', daemon, 'getParamset', [address, paramset], function (err, data) {
                // TODO catch errors
                socket.emit('rpc', daemon, 'getParamsetDescription', [address, paramset], function (err2, data2) {
                    // TODO catch errors
                    paramsetDialog(data, data2, address, paramset);
                    $('#load_grid-devices').hide();

                });
            });
        });

        $('body').on('click', 'button.paramset-setValue', function () {

            // address paramset and param
            var address = $('#edit-paramset-address').val();
            var parts = $(this).attr('id').split('-', 3);
            var param = parts[2];

            // find input/select
            var $input = $(this).parent().parent().find('[id$="' + param + '"]');
            var elem = $input[0].nodeName;
            var type = $input.attr('type');
            var dataType = $input.attr('data-type');

            // get value
            var val;
            if (elem == 'INPUT') {
                if (type == 'checkbox') {
                    val = $input.is(':checked');
                } else {
                    val = $input.val();
                }
            } else if (elem == 'SELECT') {
                val = $input.find('option:selected').val();
            }


            // calculate value if unit is "100%"
            if ($input.attr('data-unit') == '100%') {
                val /= 100;
            }

            switch (dataType) {

                case "FLOAT":
                    val = {explicitDouble: parseFloat(val)};
                    break;
                case "INTEGER":
                    val = parseFloat(val, 10);
                    break;
                default:
                    val = '' + val;
            }

            socket.emit('rpc', daemon, 'setValue', [address, param, val], function (err, res) {
                // TODO catch errors
            });
        });

    }

    function initDaemon() {
        indexSourceRoles = {};
        indexTargetRoles = {};
        daemon = $('#select-bidcos-daemon option:selected').val();
        $gridDevices.jqGrid('clearGridData');
        $gridLinks.jqGrid('clearGridData');
        $gridRssi.jqGrid('clearGridData');
        $gridInterfaces.jqGrid('clearGridData');
        $("#del-device").addClass("ui-state-disabled");
        $("#replace-device").addClass("ui-state-disabled");
        $("#edit-device").addClass("ui-state-disabled");
        $("#edit-link").addClass("ui-state-disabled");
        $("#rename-link").addClass("ui-state-disabled");
        $("#play-link").addClass("ui-state-disabled");
        $("#del-link").addClass("ui-state-disabled");
        if (daemon != 'null' && config.daemons[daemon]) {
            window.location.hash = '#' + daemon;

            $('#load_grid-devices').show();
            $('#load_grid-links').show();

            var type = config.daemons[daemon].type;

            if (type == 'BidCos-Wired') {
                $('.rfd-only').hide();
                //$gridDevices.jqGrid('hideCol', 'roaming');
                $gridDevices.jqGrid('hideCol', 'rx_mode');
                //$gridDevices.jqGrid('hideCol', 'RF_ADDRESS');
                //$gridDevices.jqGrid('hideCol', 'INTERFACE');
                resizeGrids();
            } else {
                $('.rfd-only').show();
                //$gridDevices.jqGrid('showCol', 'roaming');
                $gridDevices.jqGrid('showCol', 'rx_mode');
                //$gridDevices.jqGrid('showCol', 'RF_ADDRESS');
                //$gridDevices.jqGrid('showCol', 'INTERFACE');
                resizeGrids();
            }

            socket.emit('rpc', daemon, 'listDevices', [], function (err, data) {
                listDevices = data;
                socket.emit('rpc', daemon, 'getLinks', [], function (err, data) {
                    listLinks = data;
                    if (config.daemons[daemon].type == 'BidCos-RF') {
                        socket.emit('rpc', daemon, 'listBidcosInterfaces', [], function (err, data) {
                            listInterfaces = data;
                            initGridRssi();
                            socket.emit('rpc', daemon, 'rssiInfo', [], function (err, data) {
                                listRssi = data;
                                buildGridRssi();
                            });
                            buildGridInterfaces();
                        });
                    }
                    buildGridLinks();
                });
                buildGridDevices();
                for (var i = 0; i < listDevices.length; i++) {
                    indexChannels[listDevices[i].ADDRESS] = listDevices[i];
                    if (listDevices[i].LINK_SOURCE_ROLES) {
                        var roles = listDevices[i].LINK_SOURCE_ROLES.split(' ');
                        for (var j = 0; j < roles.length; j++) {
                            if (!indexSourceRoles[roles[j]]) indexSourceRoles[roles[j]] = [];
                            indexSourceRoles[roles[j]].push(listDevices[i].ADDRESS);
                        }
                    }
                    if (listDevices[i].LINK_TARGET_ROLES) {
                        var roles = listDevices[i].LINK_TARGET_ROLES.split(' ');
                        for (var j = 0; j < roles.length; j++) {
                            if (!indexTargetRoles[roles[j]]) indexTargetRoles[roles[j]] = [];
                            indexTargetRoles[roles[j]].push(listDevices[i].ADDRESS);
                        }
                    }

                }
            });

        } else {
            window.location.hash = '';
        }
        buildRpcSelect();
    }

    function putParamset() {
        var address = $('#edit-paramset-address').val();
        var paramset = $('#edit-paramset-paramset').val();
        var values = {};
        var count = 0;
        $('[id^="paramset-input"]').each(function () {
            var $input = $(this);
            if (!$input.is(':disabled')) {
                var parts = $input.attr('id').split('-', 3);
                var param = parts[2];
                var elem = $input[0].nodeName;
                var type = $input.attr('type');
                var dataType = $input.attr('data-type');
                var dataValPrev = $input.attr('data-val-prev');

                // get value
                var val;
                if (elem == 'INPUT') {
                    if (type == 'checkbox') {
                        val = $input.is(':checked');
                    } else {
                        val = $input.val();
                    }
                } else if (elem == 'SELECT') {
                    val = $input.find('option:selected').val();
                }

                if (val == dataValPrev || (val === true && dataValPrev === 'true') || (val === false && dataValPrev === 'false')) return;

                // calculate value if unit is "100%"
                if ($input.attr('data-unit') == '100%') {
                    val /= 100;
                }
                switch (dataType) {

                    case 'BOOL':
                        if (val == 'true') val = true;
                        if (val == 'false') val = false;
                        break;
                    case 'INTEGER':
                        val = parseInt(val, 10);
                        break;
                    case 'FLOAT':
                        val = {explicitDouble: parseFloat(val)};
                        break;
                    case 'STRING':
                    default:
                        val = '' + val;
                }

                values[param] = val;
                count += 1;
            }
        });
        if (count > 0) {
            socket.emit('rpc', daemon, 'putParamset', [address, paramset, values], function (err, res) {
                //console.log(err, res);
            });
        }

    }

    function linkparamsetDialog(data1, desc1, data2, desc2, sender, receiver) {
        // Tabelle befüllen
        $('#table-paramset').show().html('<tr><th>Param</th><th>Value</th><th>Default</th><th></th></tr>');
        var count = 0;
        for (var param in data1) {
            var unit = '';
            count += 1;
            if (desc1[param]) {
                // Dirty workaround for encoding problem
                if (desc1[param].UNIT == '�C') desc1[param].UNIT = '°C';

                var defaultVal = desc1[param].DEFAULT;

                // Calculate percent values
                if (desc1[param].UNIT == '100%') {
                    unit = '%';
                    data1[param] *= 100;
                    defaultVal *= 100;

                } else {
                    unit = desc1[param].UNIT;
                }

                // Create Input-Field
                var input;

                switch (desc1[param].TYPE) {
                    case 'BOOL':
                        input = '<input id="linkparamset-input-' + param + '" type="checkbox" value="true"' + (data1[param] ? ' checked="checked"' : '') + (desc1[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case 'INTEGER':
                        input = '<input data-unit="' + desc1[param].UNIT + '" id="linkparamset-input-' + param + '" type="number" min="' + desc1[param].MIN + '" max="' + desc1[param].MAX + '" value="' + data1[param] + '"' + (desc1[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    case 'ENUM':
                        input = '<select id="linkparamset-input-' + param + '"' + (desc1[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                        for (var i = desc1[param].MIN; i <= desc1[param].MAX; i++) {
                            input += '<option value="' + i + '"' + (data1[param] == i ? ' selected="selected"' : '') + '>' + desc1[param].VALUE_LIST[i] + '</option>';
                        }
                        input += '</select>';
                        defaultVal = desc1[param].VALUE_LIST[defaultVal];
                        break;
                    case 'FLOAT':
                    default:
                        input = '<input data-unit="' + desc1[param].UNIT + '" id="linkparamset-input-' + param + '" type="text" value="' + data1[param] + '"' + (desc1[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                }

                // Paramset VALUES?
                if (linkparamset == 'VALUES' && (desc1[param].OPERATIONS & 2)) {
                    $('#table-linkparamset1').append('<tr><td>' + param + '</td><td>' + input + '</td><td>' + desc1[param].DEFAULT + '</td><td><button class="linkparamset-setValue" id="linkparamset-setValue-' + param + '">setValue</button></td></tr>');
                } else {
                    $('#table-linkparamset1').append('<tr><td>' + param + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + unit + '</td></tr>');
                }

            } else {
                $('#table-linkparamset1').append('<tr><td>' + param + '</td><td colspan = "3">' + data1[param] + '</td></tr>');
            }

        }

        if (count == 0) {
            $('#table-linkparamset1').hide();
        }

        // Dialog-Überschrift setzen
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        var name = names[sender].Name || '';

        if (names[receiver]) {
            name = names[receiver].Name + ' -> ' + name;
        }
        //name += ' (PARAMSET ' + address + ' ' + paramset + ')';


        $('div[aria-describedby="dialog-linkparamset"] span.ui-dialog-title').html(name);

        // Hidden-Hilfsfelder
        $('#edit-linkparamset-sender').val(sender);
        $('#edit-linkparamset-receiver').val(receiver);

        // Buttons
        $('button.paramset-setValue:not(.ui-button)').button();

        $('#dialog-linkparamset').dialog('open');
    }

    function paramsetDialog(data, desc, address, paramset) {
        // Tabelle befüllen
        $('#table-paramset').show().html('<tr><th>Param</th><th>Value</th><th>Default</th><th></th></tr>');
        var count = 0;
        for (var param in data) {
            var unit = '';
            count += 1;
            if (desc[param]) {
                // Dirty workaround for encoding problem
                if (desc[param].UNIT == '�C') desc[param].UNIT = '°C';

                var defaultVal = desc[param].DEFAULT;

                // Calculate percent values
                if (desc[param].UNIT == '100%') {
                    unit = '%';
                    data[param] *= 100;
                    defaultVal *= 100;

                } else {
                    unit = desc[param].UNIT;
                }

                // Create Input-Field
                var input;

                switch (desc[param].TYPE) {
                    case 'BOOL':
                        input = '<input data-val-prev="' + data[param] + '" data-type="BOOL" id="paramset-input-' + param + '" type="checkbox" value="true"' + (data[param] ? ' checked="checked"' : '') + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case 'INTEGER':
                        input = '<input data-val-prev="' + data[param] + '" data-type="INTEGER" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="number" min="' + desc[param].MIN + '" max="' + desc[param].MAX + '" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    case 'ENUM':
                        input = '<select data-val-prev="' + data[param] + '" data-type="INTEGER" id="paramset-input-' + param + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                        for (var i = desc[param].MIN; i <= desc[param].MAX; i++) {
                            input += '<option value="' + i + '"' + (data[param] == i ? ' selected="selected"' : '') + '>' + desc[param].VALUE_LIST[i] + '</option>';
                        }
                        input += '</select>';
                        defaultVal = desc[param].VALUE_LIST[defaultVal];
                        break;
                    case 'FLOAT':
                        input = '<input data-val-prev="' + data[param] + '" data-type="FLOAT" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    default:
                        input = '<input data-val-prev="' + data[param] + '" data-type="STRING" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                }

                // Paramset VALUES?
                if (paramset == 'VALUES' && (desc[param].OPERATIONS & 2)) {
                    $('#table-paramset').append('<tr><td>' + param + '</td><td>' + input + '</td><td>' + desc[param].DEFAULT + '</td><td><button class="paramset-setValue" id="paramset-setValue-' + param + '">setValue</button></td></tr>');
                } else {
                    $('#table-paramset').append('<tr><td>' + param + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + unit + '</td></tr>');
                }

            } else {
                $('#table-paramset').append('<tr><td>' + param + '</td><td colspan = "3">' + data[param] + '</td></tr>');
            }

        }

        if (count == 0) {
           $('#table-paramset').hide();
        }

        // Dialog-Überschrift setzen
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        var name;
        if (names && names[address]) {
            name = names[address].Name || '';
        }

        if (names && names[paramset]) {
            name = names[paramset].Name + ' -> ' + name;
        }
        name += ' (PARAMSET ' + address + ' ' + paramset + ')';


        $('div[aria-describedby="dialog-paramset"] span.ui-dialog-title').html(name);

        // Hidden-Hilfsfelder
        $('#edit-paramset-address').val(address);
        $('#edit-paramset-paramset').val(paramset);

        // Buttons
        $('button.paramset-setValue:not(.ui-button)').button();

        $('#dialog-paramset').dialog('open');
    }

    function deleteLinkDialog(sender, receiver, name, desc, rowId) {

        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        var sendername = names[sender].Name || "";
        var receivername = names[receiver].Name || "";

        $('div[aria-describedby="dialog-delete-link"] span.ui-dialog-title').html('Direktverknüpfung zwischen ' + sender + ' und ' + receiver + ' löschen');

        $('#table-delete-link').html('<tr><td>Sender:</td><td>' + sender + ' (' + sendername + ')</td></tr>');
        $('#table-delete-link').append('<tr><td>Empfänger:</td><td>' + receiver + ' (' + receivername + ')</td></tr>');
        $('#table-delete-link').append('<tr><td>Name:</td><td>' + name + '</td></tr>');
        $('#table-delete-link').append('<tr><td>Beschreibung:</td><td>' + desc + '</td></tr>');

        // Hidden-Hilfsfelder
        $('#delete-link-sender').val(sender);
        $('#delete-link-receiver').val(receiver);
        $('#delete-link-rowid').val(rowId);

        $('#dialog-delete-link').dialog('open');
    }

    function buildGridRssi() {

        indexDevices = {};

        var j = 0;
        for (var i = 0, len = listInterfaces.length; i < len; i++) {
            indexDevices[listInterfaces[i].ADDRESS] = listInterfaces[i];
            $gridRssi.jqGrid('addRowData', j++, {
                Name: '',
                ADDRESS: listInterfaces[i].ADDRESS,
                TYPE: listInterfaces[i].TYPE
            });
        }

        for (var i = 0, len = listDevices.length; i < len; i++) {
            if (listDevices[i].PARENT) continue;
            if (listDevices[i].TYPE == 'HM-RCV-50') continue;
            if (listDevices[i].ADDRESS.slice(0, 1) == '*') continue;
            indexDevices[listDevices[i].ADDRESS] = listDevices[i];
            var line = {};
            for (var k = 0, ifaceLen = listInterfaces.length; k < ifaceLen; k++) {
                if (listRssi[listDevices[i].ADDRESS] && listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS]) {
                    line[listInterfaces[k].ADDRESS + '_0'] = (listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][0] != 65536
                                                            ? listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][0]
                                                            : '');
                    line[listInterfaces[k].ADDRESS + '_1'] = (listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][1] != 65536
                                                            ? listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][1]
                                                            : '');
                    if (listDevices[i].INTERFACE == listInterfaces[k].ADDRESS) {
                        line[listInterfaces[k].ADDRESS + '_set'] = '<input type="radio" class="interface-set" name="iface_' + i + '" data-device-index="' + i + '" data-iface-index="' + k + '" data-device="' + listDevices[i].ADDRESS + '" value="' + listInterfaces[k].ADDRESS + '" checked="checked">';
                    } else {
                        line[listInterfaces[k].ADDRESS + '_set'] = '<input type="radio" class="interface-set" name="iface_' + i + '" data-device-index="' + i + '" data-iface-index="' + k + '" data-device="' + listDevices[i].ADDRESS + '" value="' + listInterfaces[k].ADDRESS + '">';
                    }
                } else {
                    line[listInterfaces[k].ADDRESS + '_0'] = '';
                    line[listInterfaces[k].ADDRESS + '_1'] = '';
                    line[listInterfaces[k].ADDRESS + '_set'] = '';
                }

            }
            if (listDevices[i].ROAMING == 0) {
                line['roaming'] = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox">';
            } else {
                line['roaming'] = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox" checked="checked">';
            }
            var line = $.extend(true, line, listDevices[i]);
            $gridRssi.jqGrid('addRowData', j++, line);
        }
        $gridRssi.trigger('reloadGrid');

    }

    $('body').on('click', '.interface-set', function () {
        var i = $(this).attr('data-device-index');
        var ifaceIndex = $(this).attr('data-iface-index');
        var rowId = $(this).parent().parent().attr('id');
        var rowData = $gridRssi.jqGrid('getRowData', rowId);
        rowData.roaming = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox">';
        rowData.INTERFACE = listInterfaces[$(this).attr('data-iface-index')].ADDRESS;
        for (var k = 0; k < listInterfaces.length; k++) {
            rowData[listInterfaces[k].ADDRESS + '_set'] = '<input type="radio" class="interface-set" name="iface_' + i + '" data-device-index="' + i + '" data-iface-index="' + k + '" data-device="' + listDevices[i].ADDRESS + '" value="' + listInterfaces[k].ADDRESS + '"' + (k == ifaceIndex ? ' checked="checked"' : '') + '>';
        }
        $gridRssi.jqGrid('setRowData', rowId, rowData);

        // Todo Implement RPC
        alert('setBidcosInterface ' + $(this).attr('data-device') + ' ' + listInterfaces[$(this).attr('data-iface-index')].ADDRESS + ' false');
    });

    $('body').on('change', '.checkbox-roaming', function () {
        var checked = $(this).is(':checked');
        var i = $(this).attr('data-device-index');
        var rowId = $(this).parent().parent().attr('id');
        var rowData = $gridRssi.jqGrid('getRowData', rowId);
        rowData.roaming = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox"' + (checked ? ' checked="checked"' : '') + '>';
        rowData.INTERFACE = listInterfaces[0].ADDRESS;
        if (checked) {
            for (var k = 0; k < listInterfaces.length; k++) {
                rowData[listInterfaces[k].ADDRESS + '_set'] = '<input type="radio" class="interface-set" name="iface_' + i + '" data-device-index="' + i + '" data-iface-index="' + k + '" data-device="' + listDevices[i].ADDRESS + '" value="' + listInterfaces[k].ADDRESS + '"' + (k == 0 ? ' checked="checked"' : '') + '>';
            }
        }
        $gridRssi.jqGrid('setRowData', rowId, rowData);

        // Todo Implement RPC
        alert('setBidcosInterface ' + $(this).attr('data-device') + ' ' + listInterfaces[0].ADDRESS + ' ' + $(this).is(':checked'));
    });


    function buildGridInterfaces() {
        for (var i = 0, len = listInterfaces.length; i < len; i++) {
            $gridInterfaces.jqGrid('addRowData', i, listInterfaces[i]);
        }
        $gridInterfaces.trigger('reloadGrid');
    }

    function buildGridDevices() {
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        for (var i = 0, len = listDevices.length; i < len; i++) {
            if (listDevices[i].RF_ADDRESS) {
                listDevices[i].RF_ADDRESS = parseInt(listDevices[i].RF_ADDRESS, 10).toString(16);
            }

            var rx_mode = '';
            if (listDevices[i].RX_MODE & 1) rx_mode += 'ALWAYS ';
            if (listDevices[i].RX_MODE & 2) rx_mode += 'BURST ';
            if (listDevices[i].RX_MODE & 4) rx_mode += 'CONFIG ';
            if (listDevices[i].RX_MODE & 8) rx_mode += 'WAKEUP ';
            if (listDevices[i].RX_MODE & 16) rx_mode += 'LAZY_CONFIG ';
            listDevices[i].rx_mode = rx_mode;

            var roaming = '';
            if (listDevices[i].ROAMING != '0') {
                roaming = '<span style="display:inline-block; vertical-align:bottom" class="ui-icon ui-icon-check"></span>';
            }

            var flags = '';
            if (listDevices[i].FLAGS & 1) flags += 'Visible ';
            if (listDevices[i].FLAGS & 2) flags += 'Internal ';
            if (listDevices[i].FLAGS & 8) flags += 'DontDelete ';
            listDevices[i].flags = flags;

            switch (listDevices[i].DIRECTION) {
                case 1:
                    listDevices[i].direction = 'SENDER';
                    break;
                case 2:
                    listDevices[i].direction = 'RECEIVER';
                    break;
                default:
                    listDevices[i].direction = 'NONE';
            }

            listDevices[i].aes_active =  listDevices[i].AES_ACTIVE ? listDevices[i].AES_ACTIVE = '<span style="display:inline-block; vertical-align:bottom" class="ui-icon ui-icon-key"></span>' : '';

            if (names && names[listDevices[i].ADDRESS]) listDevices[i].Name = names[listDevices[i].ADDRESS].Name;

            var paramsets = '';
            for (var j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                paramsets += '<button class="paramset" id="paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j] + '">' + listDevices[i].PARAMSETS[j] + '</button>';
            }
            listDevices[i].params = paramsets;
            if (!listDevices[i].PARENT) {
                $gridDevices.jqGrid('addRowData', i, listDevices[i]);
            }
        }
        $gridDevices.trigger('reloadGrid');
        $('button.paramset:not(.ui-button)').button();
    }

    function buildGridLinks() {
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        for (var i = 0, len = listLinks.length; i < len; i++) {
            /*var flags = '';
             if (listLinks[i].FLAGS & 1) flags += 'Visible ';
             if (listLinks[i].FLAGS & 2) flags += 'Internal ';
             if (listLinks[i].FLAGS & 8) flags += 'DontDelete ';
             listLinks[i].flags = flags;*/

            if (names && names[listLinks[i].SENDER])
                listLinks[i].Sendername = names[listLinks[i].SENDER].Name;
            if (names && names[listLinks[i].RECEIVER])
                listLinks[i].Receivername = names[listLinks[i].RECEIVER].Name;
            /*var actions = '<button class="editlink" id="action-editlink_' + listLinks[i].SENDER + '_' + listLinks[i].RECEIVER + '" params=\'' + JSON.stringify(listLinks[i]) + '\'>bearbeiten</button>';
            actions += '<button class="deletelink" id="action-deletelink_' + listLinks[i].SENDER + '_' + listLinks[i].RECEIVER + '" params=\'' + JSON.stringify(listLinks[i]) + '\'>löschen</button>';
            listLinks[i].ACTIONS = actions;*/
            $gridLinks.jqGrid('addRowData', i, listLinks[i]);
        }
        $gridLinks.trigger('reloadGrid');
    }


    //
    //      initialize UI elements
    //


    // Dialogs
    $('#dialog-help').dialog({
        autoOpen: false,
        modal: true,
        width: 640,
        height: 400
    });
    $('#dialog-config').dialog({
        autoOpen: false,
        modal: true,
        width: 640,
        height: 400
    });
    $('#dialog-paramset').dialog({
        autoOpen: false,
        modal: true,
        width: 800,
        height: 480,
        buttons: [
            {
                text: 'putParamset',
                click: function () {
                    putParamset();
                }
            }
        ]
    });
    $('#dialog-linkparamset').dialog({
        autoOpen: false,
        modal: true,
        width: 960,
        height: 480,
        buttons: [
            {
                text: 'putParamset',
                click: function () {
                    putParamset();
                }
            }
        ]
    });
    $('#dialog-delete-link').dialog({
        autoOpen: false,
        modal: true,
        width: 640,
        height: 400,
        buttons: [
            {
                text: 'Löschen',
                click: function () {
                    // TODO RPC
                    alert('removeLink(' + $('#delete-link-sender').val() + ', ' + $('#delete-link-receiver').val() + ')');
                    // TODO remove Grid row
                    $(this).dialog('close');
                }
            },
            {
                text: 'Abbrechen',
                click: function () {
                    $(this).dialog('close');
                }
            }
        ]
    });

    $('#dialog-add-link').dialog({
        autoOpen: false,
        modal: true,
        width: 800,
        height: 480,
        buttons: [
            {
                text: 'Anlegen und Bearbeiten',
                click: function () {
                    // TODO RPC
                    var targets = $('#select-link-receiver').val();

                    for (var i = 0; i < targets.length; i++) {
                        alert('addLink(' + $('#select-link-sender').val() + ', ' + targets[i] + ')');

                        // TODO eins nach dem anderen... Callback oder synchron?
                        alert('edit paramset!');
                    }


                    $(this).dialog('close');
                }
            },{
                text: 'Anlegen',
                click: function () {
                    // TODO RPC
                    var targets = $('#select-link-receiver').val();

                    for (var i = 0; i < targets.length; i++) {
                        alert('addLink(' + $('#select-link-sender').val() + ', ' + targets[i] + ')');
                    }

                    $(this).dialog('close');
                }
            },
            {
                text: 'Abbrechen',
                click: function () {
                    $(this).dialog('close');
                }
            }
        ]
    });

    $('#select-link-sender').change(function () {
        var sender = $(this).val();
        if (sender != "null") {
            var roles = indexChannels[sender].LINK_SOURCE_ROLES.split(' ');
            var targets = [];
            $('#link-source-roles').html('');
            $('#link-source-roles').html(indexChannels[sender].LINK_SOURCE_ROLES);

            for (var i = 0; i < roles.length; i++) {
                for (var role in indexTargetRoles[roles[i]]) {
                    var address = indexTargetRoles[roles[i]][role];
                    if (targets.indexOf(address) == -1) {
                        targets.push(address);
                    }
                }
            }
            var names;
            if (regaNames && regaNames[config.daemons[daemon].ip]) {
                names = regaNames[config.daemons[daemon].ip];
            }

            var selectOptions = '';
            for (var i = 0; i < targets.length; i++) {
                var name;
                if (names[targets[i]]) {
                    name = ' ' + names[targets[i]].Name;
                } else {
                    name = '';
                }
                selectOptions += '<option value="'+ targets[i] + '">' + targets[i] + name + '</option>';
            }
            $('#select-link-receiver').html(selectOptions);

            $('#select-link-receiver').multiselect('refresh');
            $('#select-link-receiver').multiselect('enable');
        } else {

            $('#select-link-receiver').multiselect('disable');
            $('#link-source-roles').html('');
        }
    });

    $('#select-link-sender').multiselect({
        classes: 'link-sender',
        multiple: false,
        //header: false,
        height: 400,
        selectedList: 1,
        minWidth: 480
    }).multiselectfilter({
            autoReset: true,
            placeholder: ''
        });
    $('#select-link-receiver').multiselect({
        classes: 'link-receiver',
        multiple: true,
        minWidth: 480,
        //header: false,
        height: 400,
        selectedList: 2,
        noneSelectedText: "Bitte einen oder mehrere Kanäle auswählen"
    }).multiselectfilter({
            autoReset: true,
            placeholder: ''
        });

    // Tabs
    $('#tabs-main').tabs({
        activate: resizeGrids,
        create: function () {
            $('#tabs-main ul.ui-tabs-nav').prepend('<li><select id="select-bidcos-daemon"></select></li>');
            $('#tabs-main ul.ui-tabs-nav').prepend('<li class="header">HomeMatic-Manager</li>');


            $(".ui-tabs-nav").
                append("<button title='Hilfe' class='menu-button' id='button-help'></button>").
                append("<button title='Einstellungen' value='Theme wählen' class='menu-button' id='button-config'></button>").
                append("<span style='visibility: hidden; width:15px; height:15px; padding-top:5px; margin-right:10px; float:right;'><span title='Kommunikation' id='ajaxIndicator' style='width:15px; height: 15px;' class='ui-icon ui-icon-transfer-e-w'></span></span>");

            $('#button-help').button({
                text: false,
                icons: {
                    primary: 'ui-icon-help'
                }
            }).click(function () {
                $('#dialog-help').dialog('open');
            });

            $('#button-config').button({
                text: false,
                icons: {
                    primary: 'ui-icon-gear'
                }
            }).click(function () {
                $('#dialog-config').dialog('open');
            });

        }
    });


    // Servicemeldungs-Tabelle


    // Event-Tabelle
    var $gridEvents = $('#grid-events');
    $gridEvents.jqGrid({
        colNames: [
            'Zeit',
            'Name',
            'ADDRESS',
            'PARAM',
            'VALUE'
        ],
        colModel: [
            {name:'Timestamp', index: 'Timestamp', width: 100, fixed: false, sortable: false},
            {name:'Name', index: 'Name', width: 224, fixed: false, sortable: false},
            {name:'ADDRESS',index:'ADDRESS', width:90, fixed: false, sortable: false},
            {name:'PARAM', index: 'PARAM', width: 160, fixed: false, sortable: false},
            {name:'VALUE',index:'VALUE', width:110, fixed: false, sortable: false}
        ],
        datatype:   'local',
        rowNum:     1000,
        autowidth:  true,
        width:      '1000',
        height:     600,
        sortname:   'Timestamp',
        sortorder:  'desc',
        rowList:    [1000],
        caption:    'Ereignisse'
    }).jqGrid('filterToolbar', {
        defaultSearch: 'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    });

    // Geräte-Tabelle
    var $gridDevices = $('#grid-devices');
    $gridDevices.jqGrid({
        colNames: ['Name', 'ADDRESS', 'TYPE', 'FIRMWARE', 'PARAMSETS', 'FLAGS', /*'INTERFACE', 'RF_ADDRESS',*/ /*'ROAMING',*/ 'RX_MODE'/*, 'VERSION'*/],
        colModel: [
            {name:'Name', index: 'Name', width: 224, fixed: false},
            {name:'ADDRESS',index:'ADDRESS', width:110, fixed: true},
            {name:'TYPE',index:'TYPE', width:140, fixed: false},
            {name:'FIRMWARE',index:'FIRMWARE', width:80, fixed: true},
            {name:'params',index:'params', width:120, fixed: true},
            {name:'flags',index:'FLAGS', width:150, fixed: true},
            //{name:'INTERFACE',index:'INTERFACE', width:70},
            //{name:'RF_ADDRESS',index:'RF_ADDRESS', width:70},
            //{name:'roaming',index:'roaming', width:30, hidden: true},
            {name:'rx_mode',index:'RX_MODE', width:150, fixed: true}
            //{name:'VERSION',index:'VERSION', width:60, fixed: true, align:'right'}
        ],
        datatype:   'local',
        rowNum:     25,
        autowidth:  true,
        width:      '1000',
        height:     600,
        rowList:    [25, 50, 100, 500],
        pager:      $('#pager-devices'),
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  'desc',
        caption:    'Geräte',
        subGrid:    true,
        subGridRowExpanded: function(grid_id, row_id) {
            subGridChannels(grid_id, row_id);
        },
        onSelectRow: function (rowid, iRow, iCol, e) {
            if ($('#grid-devices tr#' + rowid + ' td[aria-describedby="grid-devices_flags"]').html().match(/DontDelete/)) {
                $('#del-device').addClass('ui-state-disabled');
                $('#replace-device').addClass('ui-state-disabled');
            } else {
                $('#del-device').removeClass('ui-state-disabled');
                $('#replace-device').removeClass('ui-state-disabled');
            }

            $('#edit-device').removeClass('ui-state-disabled');
            $('[id^="channels_"][id$="_t"]').jqGrid('resetSelection');
        },
        gridComplete: function () {
            $('button.paramset:not(.ui-button)').button();
            $('#del-device').addClass('ui-state-disabled');
            $('#replace-device').addClass('ui-state-disabled');
            $('#edit-device').addClass('ui-state-disabled');
        }
    }).navGrid('#pager-devices', {
        search: false,
        edit: false,
        add: false,
        del: false,
        refresh: false
    })/*.jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-calculator',
        onClickButton: function () {
            $gridDevices.setColumns({
                updateAfterCheck: true,
                shrinkToFit: false,
                onClose: function () {
                    resizeGrids();
                    // TODO Save hidden grids
                },
                colnameview: false,
                beforeShowForm: function (id) {
                    $('#ColTbl_grid-devices_2 tr:last').hide();
                },
                afterChange: resizeGrids

            });
        },
        position: 'first',
        id: 'choose-columns',
        title: 'Geräte löschen',
        cursor: 'pointer'
    })*/.jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-refresh',
        onClickButton: function () {
            alert('refresh devices');
        },
        position: 'first',
        id: 'refresh-device',
        title: 'Aktualisieren',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-trash',
        onClickButton: function () {
            var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
            alert('del ' + address);
        },
        position: 'first',
        id: 'del-device',
        title: 'Gerät löschen',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-transfer-e-w',
        onClickButton: function () {
            var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
            alert('replace ' + address);
        },
        position: 'first',
        id: 'replace-device',
        title: 'Gerät tauschen',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-pencil',
        onClickButton: function () {
            var devSelected = $gridDevices.jqGrid('getGridParam','selrow');
            var chSelected = null;
            var chGrid = null;
            if (!devSelected) {
                $('[id^="channels_"][id$="_t"]').each(function () {
                    if ($(this).jqGrid('getGridParam','selrow') > 0) {
                        chSelected = $(this).jqGrid('getGridParam','selrow');
                        chGrid = $(this).attr('id');
                    }
                });
                var address = $('#' + chGrid + ' tr#' + chSelected + ' td[aria-describedby$="_ADDRESS"]').html();
            } else {
                var address = $('#grid-devices tr#' + devSelected + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
            }
            alert('edit ' + address);
        },
        position: 'first',
        id: 'edit-device',
        title: 'Gerät umbenennen',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-plus',
        onClickButton: function () {
            alert('anlernen');
        },
        position: 'first',
        id: 'add-device',
        title: 'Geräte anlernen',
        cursor: 'pointer'
    }).jqGrid('filterToolbar', {
        defaultSearch: 'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    });

    $('#del-device').addClass('ui-state-disabled');
    $('#replace-device').addClass('ui-state-disabled');
    $('#edit-device').addClass('ui-state-disabled');

    function subGridChannels(grid_id, row_id) {
        var subgrid_table_id = 'channels_' + row_id + '_t';
        $('#' + grid_id).html('<table id="' + subgrid_table_id + '"></table>');
        var gridConf = {
            datatype: 'local',
            colNames: [
                'Name',
                'ADDRESS',
                'TYPE',
                'DIRECTION',
                'PARAMSETS',
                'FLAGS',
                'AES_ACTIVE'
                //'LINK_SOURCE_ROLES',
                //'LINK_TARGET_ROLES',
                //'VERSION'
            ],
            colModel: [
                {name: 'Name', index: 'Name', width: 222, fixed: false},
                {name: 'ADDRESS', index: 'ADDRESS', width: 110, fixed: true},
                {name: 'TYPE', index: 'TYPE', width: 140, fixed: false},
                {name: 'direction', index: 'direction', width: 80, fixed: true},
                {name: 'params', index: 'params', width: 120, fixed: true},
                {name: 'flags', index: 'flags', width: 150, fixed: true},
                {name: 'aes_active', index: 'aes_active', width: 148, fixed: true, hidden: (config.daemons[daemon].type == 'BidCos-Wired')}
                //{name: 'LINK_SOURCE_ROLES', index: 'LINK_SOURCE_ROLES', width: 100, hidden: true},
                //{name: 'LINK_TARGET_ROLES', index: 'LINK_TARGET_ROLES', width: 100, hidden: true},
                //{name: 'VERSION', index: 'VERSION', width: 58, fixed: true, align: 'right'}
            ],
            rowNum: 1000000,
            autowidth: true,
            height: 'auto',
            width: 1000,
            sortorder: 'desc',
            viewrecords: true,
            ignoreCase: true,
            onSelectRow: function (rowid, e) {

                // unselect other subgrids but not myself
                $('[id^="channels_"][id$="_t"]').not('#' + this.id).jqGrid('resetSelection');

                // unselect devices grid
                $('#grid-devices').jqGrid('resetSelection');

                $('#del-device').addClass('ui-state-disabled');
                $('#edit-device').removeClass('ui-state-disabled');
                $('#replace-device').removeClass('ui-state-disabled');
            },
            gridComplete: function () {
                $('button.paramset:not(.ui-button)').button();
            }
        };
        $('#' + subgrid_table_id).jqGrid(gridConf);

        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }

        for (var i = 0, len = listDevices.length; i < len; i++) {

            if (listDevices[i].PARENT == listDevices[row_id].ADDRESS) {

                if (names && names[listDevices[i].ADDRESS]) listDevices[i].Name = names[listDevices[i].ADDRESS].Name;

                var paramsets = '';
                for (var j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                    if (listDevices[i].PARAMSETS[j] == 'LINK') continue;
                    var idButton = 'paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j];
                    paramsets += '<button class="paramset" id="' + idButton + '">' + listDevices[i].PARAMSETS[j] + '</button>';
                }
                listDevices[i].params = paramsets;
                $('#' + subgrid_table_id).jqGrid('addRowData', i, listDevices[i]);
            }
        }
        $('button.paramset:not(.ui-button)').button();
    }



    // Direktverknüpfungs-Tabelle
    var $gridLinks = $('#grid-links');
    $gridLinks.jqGrid({
        datatype: 'local',
        colNames:['SENDER Name', 'SENDER', 'RECEIVER Name', 'RECEIVER', 'NAME', 'DESCRIPTION'/*, 'Aktionen'*/],
        colModel:[
            {name:'Sendername', index:'Sendername', width:100},
            {name:'SENDER', index:'SENDER', width:50},
            {name:'Receivername', index:'Receivername', width:100},
            {name:'RECEIVER', index:'RECEIVER', width:50},
            {name:'NAME', index:'NAME', width:150},
            {name:'DESCRIPTION', index:'DESCRIPTION', width:150}
            //{name:'ACTIONS', index:'ACTIONS', width:80}
        ],
        rowNum:     25,
        autowidth:  true,
        width:      '100%',
        rowList:    [25, 50, 100, 500],
        pager:      $('#pager-links'),
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  'desc',
        caption:    'Direktverknüpfungen',
        onSelectRow: function (rowid, iRow, iCol, e) {
            $('#del-link').removeClass('ui-state-disabled');
            $('#rename-link').removeClass('ui-state-disabled');
            $('#edit-link').removeClass('ui-state-disabled');
            $('#play-link').removeClass('ui-state-disabled');
        },
        gridComplete: function () {
            $('#del-link').addClass('ui-state-disabled');
            $('#rename-link').addClass('ui-state-disabled');
            $('#edit-link').addClass('ui-state-disabled');
            $('#play-link').addClass('ui-state-disabled');
        }
    }).navGrid('#pager-links', {
        search: false,
        edit: false,
        add: false,
        del: false,
        refresh: false
    })
    .jqGrid('filterToolbar', {
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-refresh',
        onClickButton: function () {
            alert('refresh link');
        },
        position: 'first',
        id: 'refresh-link',
        title: 'Aktualisieren',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-trash',
        onClickButton: function () {
            var rowId = $gridLinks.jqGrid('getGridParam','selrow')
            var sender = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_SENDER"]').html();
            var receiver = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            var name = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_NAME"]').html();
            var desc = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_DESCRIPTION"]').html();
            deleteLinkDialog(sender, receiver, name, desc, rowId);
        },
        position: 'first',
        id: 'del-link',
        title: 'Direktverknüpfung löschen',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-gear',
        onClickButton: function () {
            var sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
            var receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            $('#load_grid-links').show();
            socket.emit('rpc', daemon, 'getParamset', [receiver, sender], function (err, data) {
                // TODO catch errors
                socket.emit('rpc', daemon, 'getParamsetDescription', [receiver, sender], function (err2, data2) {
                    // TODO catch errors
                    paramsetDialog(data, data2, receiver, sender);
                    $('#load_grid-links').hide();

                });
            });
            //alert('edit link ' + sender + ' -> ' + receiver);
        },
        position: 'first',
        id: 'edit-link',
        title: 'Direktverknüpfung bearbeiten',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-pencil',
        onClickButton: function () {
            var sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
            var receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            alert('rename link ' + sender + ' -> ' + receiver);
        },
        position: 'first',
        id: 'rename-link',
        title: 'Direktverknüpfung umbenennen',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-play',
        onClickButton: function () {
            var sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
            var receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            socket.emit('rpc', daemon, 'activateLinkParamset', [receiver, sender]);
        },
        position: 'first',
        id: 'play-link',
        title: 'Direktverknüpfung testen',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-plus',
        onClickButton: function () {
            var selectOptions = '<option value="null">Bitte einen Kanal auswählen</option>';
            var names = regaNames[config.daemons[daemon].ip];
            for (var j = 0, len = listDevices.length; j < len; j++) {
                if (!listDevices[j].PARENT) continue;
                if (listDevices[j].ADDRESS.match(/:0$/)) continue;
                if (!listDevices[j].LINK_SOURCE_ROLES) continue;
                selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + (names[listDevices[j].ADDRESS] ? ' ' + names[listDevices[j].ADDRESS].Name : '') + '</option>';
            }
            $('#select-link-sender').html(selectOptions).multiselect('refresh');
            $('#select-link-receiver').html('').multiselect('refresh').multiselect('disable');
            $('#link-source-roles').html('');
            $('#link-target-roles').html('');

            $('#dialog-add-link').dialog('open');
        },
        position: 'first',
        id: 'add-link',
        title: 'Direktverknüpfung anlegen',
        cursor: 'pointer'
    });


    // RSSI Tabelle
    var $gridRssi = $('#grid-rssi');
    function initGridRssi() {
        var colNamesRssi = ['Name', 'ADDRESS', 'TYPE', 'INTERFACE', 'RF_ADDRESS', 'ROAMING'];
        var colModelRssi = [
            // TODO Name und Type fixed:false - Überschrifts und Inhaltsspalten stimmen nicht mehr... :-(
            {name:'Name', index: 'Name', width: 250, fixed: true},
            {name:'ADDRESS',index:'ADDRESS', width: 84, fixed: true},
            {name:'TYPE',index:'TYPE', width: 140, fixed: true},
            {name:'INTERFACE',index:'INTERFACE', width: 84, fixed: true},
            {name:'RF_ADDRESS',index:'RF_ADDRESS', width: 75, fixed: true},
            {name:'roaming',index:'ROAMING', width: 57, fixed: true, search: false, align: 'center'}
        ];

        var groupHeaders = [];

        for (var i = 0; i < listInterfaces.length; i++) {
            colNamesRssi.push('<- dBm');
            colNamesRssi.push('-> dBm');
            colNamesRssi.push(' ');
            colModelRssi.push({
                name: listInterfaces[i].ADDRESS + '_0',
                index: listInterfaces[i].ADDRESS + '_0',
                width: 47,
                fixed: true,
                search: false,
                align: 'right'
            });
            colModelRssi.push({
                name: listInterfaces[i].ADDRESS + '_1',
                index: listInterfaces[i].ADDRESS + '_1',
                width: 47,
                fixed: true,
                search: false,
                align: 'right'
            });
            colModelRssi.push({
                name: listInterfaces[i].ADDRESS + '_set',
                index: listInterfaces[i].ADDRESS + '_set',
                width: 28,
                fixed: true,
                search: false,
                align: 'center'
            });
            groupHeaders.push({startColumnName: listInterfaces[i].ADDRESS + '_0', numberOfColumns: 3, titleText: listInterfaces[i].ADDRESS + ' (' + listInterfaces[i].TYPE + ')'});
        }

        $gridRssi.jqGrid({
            colNames: colNamesRssi,
            colModel: colModelRssi,
            datatype:   'local',
            rowNum:     25,
            autowidth:  false,
            width:      '1000',
            height:     600,
            rowList:    [25, 50, 100, 500],
            pager:      $('#pager-rssi'),
            sortname:   'timestamp',
            viewrecords: true,
            sortorder:  'desc',
            caption:    'RSSI',
            subGrid:    true,
            subGridOptions: {
                expandOnLoad: false
            },
            subGridRowExpanded: function(grid_id, row_id) {
                subGridRssi(grid_id, row_id);
            },
            onSelectRow: function (rowid, iRow, iCol, e) {

            },
            gridComplete: function () {

            }
        }).navGrid('#pager-rssi', {
            search: false,
            edit: false,
            add: false,
            del: false,
            refresh: false
        }).jqGrid('filterToolbar', {
            defaultSearch:'cn',
            autosearch: true,
            searchOnEnter: false,
            enableClear: false
        }).jqGrid('setGroupHeaders', {
            useColSpanStyle: true,
            groupHeaders: groupHeaders
        }).jqGrid('navButtonAdd', '#pager-rssi', {
            caption: '',
            buttonicon: 'ui-icon-refresh',
            onClickButton: function () {
                alert('refresh rssi');
            },
            position: 'first',
            id: 'refresh-rssi',
            title: 'Aktualisieren',
            cursor: 'pointer'
        });
        $('#gbox_grid-rssi .ui-jqgrid-titlebar-close').hide();

        resizeGrids();
    }


    function subGridRssi(grid_id, row_id) {
        var subgrid_table_id = 'rssi' + row_id + '_t';
        $('#' + grid_id).html('<table id="' + subgrid_table_id + '"></table>');
        var gridConf = {
            datatype: 'local',
            colNames: [
                'Name',
                'ADDRESS',
                'TYPE',
                '<- dBm',
                '-> dBm'
            ],
            colModel: [
                {name: 'Name', index: 'Name', width: 248, fixed: true},
                {name: 'ADDRESS', index: 'ADDRESS', width: 84, fixed: true},
                {name: 'TYPE', index: 'TYPE', width: 140, fixed: true},
                {name: 'RSSI-Receive', index: 'RSSI-Receive', width: 47, fixed: true, align: 'right'},
                {name: 'RSSI-Send', index: 'RSSI-Send', width: 47, fixed: true, align: 'right'}
            ],
            rowNum: 1000000,
            autowidth: true,
            height: 'auto',
            width: 1000,
            sortorder: 'desc',
            viewrecords: true,
            ignoreCase: true,
            onSelectRow: function (rowid, e) {

            },
            gridComplete: function () {

            }
        };
        $('#' + subgrid_table_id).jqGrid(gridConf);

        var address = $('#grid-rssi tr#' + row_id + ' td[aria-describedby="grid-rssi_ADDRESS"]').html();
        var partners = listRssi[address];
        var i = 0;
        var names = [];
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            names = regaNames[config.daemons[daemon].ip];
        }
        for (var partner in partners) {
            var obj = {
                ADDRESS: partner,
                Name: (names[partner] ? names[partner].Name : ''),
                TYPE: (indexDevices[partner] ? indexDevices[partner].TYPE : ''),
                'RSSI-Receive': (partners[partner][0] == 65536 ? '' : partners[partner][0]),
                'RSSI-Send': (partners[partner][1] == 65536 ? '' : partners[partner][1])
            };
            $('#' + subgrid_table_id).jqGrid('addRowData', i++, obj);
        }


    }

    // Interfaces-Tabelle
    var $gridInterfaces = $('#grid-interfaces');
    $gridInterfaces.jqGrid({
        /*

         ADDRESS: "JEQ0739174"
         CONNECTED: true
         DEFAULT: true
         DESCRIPTION: "CCU2-Coprocessor"
         DUTY_CYCLE: 0
         FIRMWARE_VERSION: "1.0.11"
         TYPE: "CCU2"
         */

        colNames: ['ADDRESS', 'DESCRIPTION', 'TYPE', 'FIRMWARE_VERSION', 'CONNECTED', 'DEFAULT', 'DUTY_CYCLE'],
        colModel: [
            {name:'ADDRESS',index:'ADDRESS', width:110, fixed: true},
            {name:'DESCRIPTION',index:'DESCRIPTION', width:150, fixed: false},
            {name:'TYPE',index:'TYPE', width:70, fixed: false},
            {name:'FIRMWARE_VERSION',index:'FIRMWARE_VERSION', width:130, fixed: true},
            {name:'CONNECTED',index:'CONNECTED', width:110, fixed: true},
            {name:'DEFAULT',index:'DEFAULT', width:110, fixed: true},
            {name:'DUTY_CYCLE',index:'DUTY_CYCLE', width:110, fixed: true, align: 'right'}
        ],
        datatype:   'local',
        rowNum:     25,
        autowidth:  true,
        width:      '1000',
        height:     'auto',
        rowList:    [25, 50, 100, 500],
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  'desc',
        caption:    'Interfaces',
        onSelectRow: function (rowid, iRow, iCol, e) {

        },
        gridComplete: function () {

        },
        hiddengrid: true
    });

    $('#gbox_grid-interfaces .ui-jqgrid-titlebar-close').click(function () {
        setTimeout(resizeGrids, 250);
    });

    $('#gbox_grid-devices .ui-jqgrid-titlebar-close').hide();
    $('#gbox_grid-links .ui-jqgrid-titlebar-close').hide();
    $('#gbox_grid-events .ui-jqgrid-titlebar-close').hide();




    function resizeGrids() {
        var x = $(window).width();
        var y = $(window).height();
        if (x < 1200) x = 1200;
        if (y < 600) y = 600;

        $('#grid-devices, #grid-links, #grid-messages').setGridHeight(y - 148).setGridWidth(x - 18);
        $('#grid-events').setGridHeight(y - 122).setGridWidth(x - 18);
        $('#grid-interfaces')/*.setGridHeight(y - 99)*/.setGridWidth(x - 18);
        $('#grid-rssi').setGridHeight(y - (177 + $('#gbox_grid-interfaces').height())).setGridWidth(x - 18);

        /*

        // funktioniert nicht mit gruppierten Headers :-(
        // .updateColumns depreacted :-((


        var table = $("#grid-rssi")[0];
        var r = table.rows[0], selftable = table;
        if (r) {
            $("td", r).each(function (k) {
                $(this).css('width', selftable.grid.headers[k].width + 'px');
            });
            table.grid.cols = r.cells;
        }
        */
    }

    //Konsole
    var $consoleRpcMethod = $('#console-rpc-method');
    var $consoleRpcSend = $('#console-rpc-send');
    var $consoleRpcResponse = $('#console-rpc-response');

    $consoleRpcMethod.multiselect({
        classes: 'rpc-method',
        multiple: false,
        //header: false,
        height: 500,
        selectedList: 1
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });

    function buildRpcSelect() {
        $('#console-rpc-help').html('');
        $consoleRpcMethod.html('<option value="null" selected="selected">Bitte eine Methode auswählen</option>');
        $consoleRpcResponse.html('');
        if (daemon == 'null') {
            $consoleRpcSend.attr('disabled', true).button('refresh');
            return;
        }
        var daemonName = config.daemons[daemon].type;
        switch (daemonName) {
            case 'BidCos-RF':
                var daemonType = 'rfd';
                break;
            case 'BidCos-Wired':
                var daemonType = 'hs485d';
                break;
            default:
                var daemonType = 'unknown';
        }
        for (var method in rpcMethods) {
            if (rpcMethods[method][daemonType]) {
                $consoleRpcMethod.append('<option value="' + method + '">' + method + '</option>');
            }
        }
        $consoleRpcMethod.multiselect('refresh');
    }

    $consoleRpcMethod.change(function () {
        var method = $consoleRpcMethod.val();
        if (method == 'null') {
            $consoleRpcSend.attr('disabled', true);
        } else {
            $consoleRpcSend.removeAttr('disabled').button('refresh');
        }
        if (rpcMethods[method]) {
            buildRpcParamsForm();
        }
    });

    function buildRpcParamsForm() {
        $('#console-rpc-params').val('');
        $('#console-rpc-error').html('');
        setValueDesc = null;
        var names = regaNames[config.daemons[daemon].ip];
        var method = $consoleRpcMethod.val();
        $('#console-rpc-method-help').html(rpcMethods[method].help);
        var params = rpcMethods[method].params;
        var heading = '<span style="color:#777">' + rpcMethods[method].returns + '</span> ' + method + '(';
        var paramArr = [];
        var form = '';
        for (var i = 0; i < params.length; i++) {

            switch (params[i].type) {
                case 'integer':
                    if (params[i].bitmask) {
                        form += '<tr><td colspan="3">' + params[i].name + '</td></tr>';
                        for (var val in params[i].bitmask) {
                            form += '<tr><td style="padding-left: 6px;"><label for="bitmask_param_' + val + '_' + i + '">' + params[i].bitmask[val] + '</label></td><td></td><td><input class="console-param-checkbox" type="checkbox" value="' + val + '" name="bitmask_param_' + val + '_' + i + '" id="bitmask_param_' + val + '_' + i + '"/></td></tr>';
                        }
                    } else if (params[i].values) {
                        var selectOptions = '<option value="">Bitte auswählen</option>';
                        for (var val in params[i].values) {
                            selectOptions += '<option value="' + val + '">' + params[i].values[val] + ' (' + val + ')</option>';
                        }
                        form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-simple" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    } else {
                        form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><input class="console-param-input ui-widget ui-state-default ui-corner-all" type="number" name="param_' + i + '" id="param_' + i + '" class=""/></td></tr>';
                    }
                    break;
                case 'boolean':
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><input class="console-param-checkbox" type="checkbox" name="param_' + i + '" id="param_' + i + '" class=""/></td></tr>';
                    break;
                case 'device_address':
                    var selectOptions = '<option value="">Bitte auswählen</option>';
                    for (var j = 0, len = listDevices.length; j < len; j++) {
                        if (listDevices[j].PARENT) continue;
                        if (listDevices[j].ADDRESS.match(/BidCoS/)) continue;
                        var name = '';
                        if (names && names[listDevices[j].ADDRESS]) {
                            name = names[listDevices[j].ADDRESS].Name;
                        }
                        selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'channel_address':
                    var selectOptions = '<option value="">Bitte auswählen</option>';
                    for (var j = 0, len = listDevices.length; j < len; j++) {
                        if (!listDevices[j].PARENT) continue;
                        if (listDevices[j].ADDRESS.match(/:0$/)) continue;
                        var name = '';
                        if (names && names[listDevices[j].ADDRESS]) {
                            name = names[listDevices[j].ADDRESS].Name;
                        }
                        selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'address':
                    var selectOptions = '<option value="">Bitte auswählen</option>';
                    for (var j = 0, len = listDevices.length; j < len; j++) {
                        var name = '';
                        if (names && names[listDevices[j].ADDRESS]) {
                            name = names[listDevices[j].ADDRESS].Name;
                        }
                        selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'interface_address':
                    var selectOptions = '<option value="">Bitte auswählen</option>';
                    for (var j = 0, len = listInterfaces.length; j < len; j++) {
                        selectOptions += '<option value="' + listInterfaces[j].ADDRESS + '">' + listInterfaces[j].ADDRESS + ' ' + listInterfaces[j].TYPE + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-simple" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'paramset_type':
                    var selectOptions = '<option value="MASTER">MASTER</option>';
                    selectOptions += '<option value="VALUES">VALUES</option>';
                    selectOptions += '<option value="LINK">LINK</option>';
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-simple" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'string':
                default:
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><input class="console-param-input ui-widget ui-state-default ui-corner-all" type="text" name="param_' + i + '" id="param_' + i + '"/></td></tr>';
                    break;
            }
            paramArr.push('<span style="color:#777">' + (params[i].type.match(/address$/) || params[i].type.match(/^value_key$/) ? 'string' : params[i].type) + '</span> ' + params[i].name);
        }
        heading += paramArr.join(', ');
        heading += ')';
        $('#console-rpc-method-heading').html(heading);
        $('#console-form-params').html('<table>' + form + '</table>');
        $('select.param-simple').multiselect({
            minWidth: 360,
            header: false,
            multiple: false,
            selectedList: 1
        });
        $('select.param-search').multiselect({
            minWidth: 360,
            multiple: false,
            selectedList: 1
        }).multiselectfilter();

    }

    $('#console-form-params').on('change', 'input', setConsoleParams);
    $('#console-form-params').on('change', 'select', function () {
        setConsoleParams(this);
    });

    var setValueParamsetDescription;
    var setValueDesc;

    function setConsoleParams(elem) {
        var paramArr = [];
        var method = $consoleRpcMethod.val();

        var param0 = $('#param_0').val();
        if (method == 'setValue' && $(elem).attr('id') == 'param_0' && param0) {
            $('#param_1').val('...').attr('disabled', true);
            socket.emit('rpc', daemon, 'getParamsetDescription', [param0, 'VALUES'], function (err, data) {
                var selectOptions = '<option value="">Bitte auswählen</option>';
                setValueParamsetDescription = data;
                for (var dp in data) {
                    if (data[dp].OPERATIONS & 2) {
                        selectOptions += '<option value="' + dp + '">' + dp + '</option>';
                    }
                }

                $('#param_1').replaceWith('<select id="param_1">' + selectOptions + '</select>');
                $('#param_1').multiselect({
                    minWidth: 360,
                    header: false,
                    multiple: false,
                    selectedList: 1
                });
            });
        } else if (method == 'setValue' && $(elem).attr('id') == 'param_1' && param0) {
            var desc = setValueParamsetDescription[$(elem).val()];
            setValueDesc = desc;
            switch (desc.TYPE) {
                case "BOOL":
                case "ACTION":
                    $('#param_2').replaceWith('<input id="param_2" type="checkbox">');
                    break;
                case "INTEGER":
                    $('#param_2').replaceWith('<input class="console-param-input ui-widget ui-state-default ui-corner-all" type="number" name="param_2" id="param_2"/>');
                default:
                    $('#param_2').replaceWith('<input class="console-param-input ui-widget ui-state-default ui-corner-all" type="text" name="param_2" id="param_2"/>');
            }
        }

        // TODO putParamset dynamische Eingabefelder

        $('[id^="bitmask_param_"]').each(function () {
            var tmpArr = $(this).attr('id').split('_');
            var paramIndex = parseInt(tmpArr[3], 10);
            if (paramArr[paramIndex] === undefined) paramArr[paramIndex] = 0;
            var bit = parseInt(tmpArr[2], 10);
            if ($(this).is(':checked')) {
                paramArr[paramIndex] += bit;
            }
        });

        $('[id^="param_"]').each(function () {
            var paramIndex = parseInt($(this).attr('id').slice(6), 10);
            var paramDesc = rpcMethods[method].params[paramIndex];
            if (paramDesc.type == 'integer') {
                var val = parseInt($(this).val(), 10);
                if (isNaN(val) && !paramDesc.optional) {
                    paramArr[paramIndex] = 0;
                } else if (!isNaN(val)) {
                    paramArr[paramIndex] = val;
                }
            } else if (paramDesc.type == 'boolean') {
                paramArr[paramIndex] = $(this).is(':checked');
            } else if (setValueDesc && paramDesc.type == 'mixed') {

                switch (setValueDesc.TYPE) {
                    case "BOOL":
                    case "ACTION":
                        paramArr[paramIndex] = $(this).is(':checked');
                        break;
                    case "FLOAT":
                        var val = parseFloat($(this).val());
                        if (isNaN(val)) val = 0;
                        paramArr[paramIndex] = val;
                        break;
                    case "INTEGER":
                        var val = parseInt($(this).val(), 10);
                        if (isNaN(val)) val = 0;
                        paramArr[paramIndex] = val;
                        break;
                    default:
                        paramArr[paramIndex] = $(this).val();
                }
            } else {
                var val = $(this).val();
                if (val != '' || !paramDesc.optional) {
                    paramArr[paramIndex] = val;
                }
            }
            $('#console-rpc-params').val(JSON.stringify(paramArr).slice(1).slice(0, -1).replace(/,/g, ', '));
        });
    }

    $consoleRpcSend
        .attr('disabled', true)
        .button()
        .click(function() {
            var method = $consoleRpcMethod.find('option:selected').val();

            try {
                var params = JSON.parse('[' + $('#console-rpc-params').val() + ']');
            } catch (e) {
                alert('Parsing params: ' + e);
                return;
            }

            $consoleRpcResponse.html('...');
            socket.emit('rpc', daemon, method, params, function (err, data) {
                if (err) {
                    $('#console-rpc-error').html('Error: ' + err.faultString);
                } else {
                    $('#console-rpc-error').html('');
                }
                $consoleRpcResponse.html(JSON.stringify(data, null, "  "));
            });
        });


    // Grid resize
    $(window).resize(function() {
        resizeGrids();
    });
    resizeGrids();


    // Navigation
    window.onhashchange = function () {
        hash = window.location.hash.slice(1);
        if (config.daemons[hash]) {
            if (daemon != hash) {
                daemon = hash;
                $('#select-bidcos-daemon option').removeAttr('selected');
                $('#select-bidcos-daemon option[value="' + daemon + '"]').attr('selected', true);
                $('#select-bidcos-daemon').multiselect('refresh');
                initDaemon();
            }
        } else {
            daemon = null;
            $('#select-bidocs-daemon option').removeAttr('selected');
            $('#select-bidcos-daemon').multiselect('refresh');
            initDaemon();
        }
    }

});
})(jQuery);
