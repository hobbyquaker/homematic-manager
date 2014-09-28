var rpcMethods = {
    abortDeleteDevice: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'address', type: 'device_address' }
        ],
        returns: 'void',
        help: {de: "Diese Methode bricht einen anhängigen Löschvorgang für ein Gerät ab.<br>Es können nur Löschvorgänge abgebrochen werden, die mit dem Flag DELETE_FLAG_DEFER ausgeführt wurden."}
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
        help: {de: "Mit dieser Methode wird ein Link-Parameterset aktiviert. Das logische Gerät verhält sich dann so als ob es direkt von dem entsprechenden zugeordneten Gerät angesteuert worden wäre. Hiermit kann z.B. ein Link-Parameter-Set getestet werden. Der Parameter address ist die Addresses des anzusprechenden logischen Gerätes. Der Parameter peer_address ist die Addresse des Kommunikationspartners, dessen Link-Parameter-Set aktiviert werden soll. Der Parameter long_press gibt an, ob das Parameterset für den langen Tastendruck aktiviert werden soll."}
    },
    addDevice: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'address', type: 'string' },
            { name: 'mode', type: 'integer', optional: ['rfd'] }
        ],
        returns: 'DeviceDescription',
        help: {de: "Diese Methode lernt ein Gerät anhand seiner Seriennummer an die CCU an. Diese Funktion wird nicht von jedem Gerät unterstützt. Rückgabewert ist die DeviceDescription des neu angelernten Geräts.<br>Der optionale Parameter mode bestimmt die Art des Installations-Modus:<br>1 = Normaler Installations-Modus<br>2 = Während des Anlernens werden in den Parametersets „MASTER“ default Parameter gesetzt und alle bestehenden Verknüpfungen werden gelöscht."}
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
        help: {de: "Diese Methode erstellt eine Kommunikationsbeziehung zwischen zwei logischen Geräten. Die Parameter sender und receiver bezeichnen die beiden zu verknüpfenden Partner. Die Parameter name und description sind optional und beschreiben die Verknüpfung näher."}
    },
    addVirtualDeviceInstance: {
        rfd: true,
        hs485d: false,
        params: [],
        returns: '',
        help: {de: "leider nicht von eQ-3 dokumentiert."}

    },
    changeKey: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'passphrase', type: 'string' }
        ],
        returns: 'void',
        help: {de: "Diese Methode ändert den vom Schnittstellenprozess verwendeten AES-Schlüssel. Der Schlüssel wird ebenfalls in allen angelernten Geräten getauscht."}
    },
    clearConfigCache: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'device_address' }
        ],
        returns: 'void',
        help: {de: "Diese Methode löscht alle zu einem Gerät in der CCU gespeicherten Konfigurationsdaten. Diese werden nicht sofort wieder vom Gerät abgefragt, sondern wenn sie das nächste mal benötigt werden."}
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
        help: {de: "Diese Methode löscht ein Gerät aus dem Schnittstellenprozess.<br>Der Parameter address ist die Addresse des zu löschenden Gerätes.<br>Flags ist ein bitweises oder folgender Werte:<ul><li>DELETE_FLAG_RESET Das Gerät wird vor dem Löschen in den Werkszustand zurückgesetzt </li><li>DELETE_FLAG_FORCE Das Gerät wird auch gelöscht, wenn es nicht erreichbar ist </li><li>DELETE_FLAG_DEFER Wenn das Gerät nicht erreichbar ist, wird es bei nächster Gelegenheit gelöscht</li></ul>"}
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
        help: {de: "Mit dieser Methode wird ein Parameter eines Parameter-Sets automatisch bestimmt. Der Parameter kann bei erfolgreicher Ausführung anschließend sofort über getParamset gelesen werden.<br>Der Parameter address ist die Addresses eines logischen Gerätes.<br>Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers). Der Parameter parameter_id bestimmt den automatisch zu bestimmenden Parameter."}
    },
    getDeviceDescription: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'device_address' }
        ],
        returns: 'DeviceDescription',
        help: {de: "Diese Methode gibt die Gerätebeschreibung des als address übergebenen Gerätes zurück."}
    },
    getInstallMode:  {
        rfd: true,
        hs485d: false,
        params: [
        ],
        returns: 'Integer',
        help: {de: "Diese Methode gibt die verbliebene Restzeit in Sekunden im Anlernmodus zurück. Der Wert  0 bedeutet, der Anlernmodus ist nicht aktiv."}
    },
    getKeyMismatchDevice: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'reset', type: 'bool' }
        ],
        returns: 'String',
        help: {de: "Diese Methode gibt die Seriennummer des letzten Gerätes zurück, das aufgrund eines falschen AES-Schlüssels nicht angelernt werden konnte. Mit reset=true wird diese Information im Schnittstellenprozess zurückgesetzt."}
    },
    getLGWStatus: {
        rfd: false,
        hs485d: true,
        params: [],
        returns: '',
        help: {de: "Gibt den Status des Wired-LAN-Gateways zurück."}
    },
    getLinkInfo: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'sender', type: 'device_address' },
            { name: 'receiver', type: 'device_address' }
        ],
        returns: 'Array',
        help: {de: "Diese Methode gibt den Namen und die Beschreibung für eine bestehende Kommunikationsbeziehung zurück. Die Parameter sender_address und receiver_address bezeichnen die beiden verknüpften Partner."}
    },
    getLinkPeers: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'device_address' }
        ],
        returns: '',
        help: {de: "Diese Methode gibt alle einem logischen Gerät zugeordneten Kommunikationspartner zurück. Die zurückgegebenen Werte können als Parameter paramset_key für getParamset() und putParamset() verwendet werden. Der Parameter address ist die Adresse eines logischen Gerätes."}
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
        help: {de: "Diese Methode gibt alle einem logischen Kanal oder Gerät zugeordneten Kommunikationsbeziehungen zurück.<br>Der Parameter address ist die Kanal- oder Geräteadresse des logischen Objektes, auf das sich die Abfrage bezieht. Bei address==&quot;&quot; werden alle Kommunikationsbeziehungen des gesamten Schnittstellenprozesses zurückgegeben.<br>Der Parameter flags ist ein bitweises oder folgender Werte:<ul><li>GL_FLAG_GROUP Wenn address einen Kanal bezeichnet, der sich in einer Gruppe befindet, werden die Kommunikationsbeziehungen für alle Kanäle der Gruppe zurückgegeben.</li><li>GL_FLAG_SENDER_PARAMSET Das Feld SENDER_PARAMSET des Rückgabewertes wird gefüllt. </li><li>GL_FLAG_RECEIVER_PARAMSET Das Feld RECEIVER_PARAMSET des Rückgabewertes wird gefüllt.</li></ul>flags ist optional. Defaultwert ist 0x00."}
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
        help: {de: "Mit dieser Methode wird ein komplettes Parameter-Set für ein logisches Gerät gelesen. Der Parameter address ist die Addresses eines logischen Gerätes. Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers).<br>Dem optionalen Parameter mode können folgende Werte übergeben werden (nur rfd):<ul><li>0 default: Keien Auswirkung, die Funktion verhält sicht wie der Aufruf ohne mode</li><li>1 UndefinedValues: Jeder Eintrag innerhalb des zurückgelieferten Paramset ins eine Struktur mit folgendem Aufbau:<br>„UNDEFINED“(Boolean) Flag ob der angeforderte Wert initial gesetzt wurde und somit wahrscheinlich nicht der Realität entspricht oder ob der Wert von einem Gerät empfangen wurde, true = Wert wurde initial gesetzt und noch nicht verändert, false = der Wert wurde neu gesetzt <br>„VALUE“(ValueType) Wert des angeforderten Parameter.<br>UndefindeValues kann nur für Parameter aus dem Parameterset „VALUES“ abgefragt werden."}
    },
    getParamsetDescription: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'address' },
            { name: 'paramset_type', type: 'paramset_type' }
        ],
        returns: '',
        help: {de: "Mit dieser Methode wird die Beschreibung eines Parameter-Sets ermittelt. Der Parameter address ist die Adresse eines logischen Gerätes (z.B. von listDevices zurückgegeben). Der Parameter paramset_type ist „MASTER“, „VALUES“ oder „LINK“."}
    },
    getParamsetId: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'address' },
            { name: 'type', type: 'string' }
        ],
        returns: '',
        help: {de: "Diese Methode gibt die Id eines Parametersets zurück. Diese wird verwendet, um spezialisierte Konfigurationsdialoge (Easymode) den Parametersets zuzuordnen."}
    },
    getServiceMessages: {
        rfd: true,
        hs485d: false,
        params: [
        ],
        help: {de: "Diese Methode gibt eine Liste aller vorhandenen Servicemeldungen in Form eines Arrays zurück."}
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
        help: {de: "Mit dieser Methode wird ein einzelner Wert aus dem Parameter-Set „VALUES“ gelesen. Der Parameter address ist die Addresse eines logischen Gerätes. Der Parameter value_key ist der Name des zu lesenden Wertes. Die möglichen Werte für value_key ergeben sich aus der ParamsetDescription des entsprechenden Parameter-Sets „VALUES“.<br>Dem Parameter mode können folgende Werte übergeben werden:<ul><li>0 default: Keien Auswirkung, die Funktion verhält sicht wie der Aufruf ohne mode</li><li>1 UndefinedValues: Es wird ein Struktur zurückgeliefert die folgenden Aufbau hat:<br>„UNDEFINED“(Boolean) Flag ob der angeforderte Wert initial gesetzt wurde und somit wahrscheinlich nicht der Realität entspricht oder ob der Wert von eimen Gerät empfangen wurde, true = Wert wurde initial gesetzt und noch nicht verändert, false = der Wert wurde neu gesetzt<br>„VALUE“(ValueType) Wert des angeforderten Parameter.</li></ul><br>UndefindeValues kann nur für Parameter aus dem Parameterset „VALUES“ abgefragt werden die mit OPERATIONS = Read gekenzeichnet sind."}
    },
    getVersion: {
        rfd: true,
        hs485d: false,
        params: [],
        returns: '',
        help: {de: "Liefert die Version des BidCoS-Service."}
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
        help: {de: "Diese Methode gibt eine Liste aller vorhandenen BidCoS-Interfaces in Form eines Arrays von Structs zurück"}
    },
    listDevices: {
        rfd: true,
        hs485d: true,
        params: [],
        returns: '',
        help: {de: "Diese Methode gibt alle dem Schnittstellenprozess bekannten Geräte in Form von Gerätebeschreibungen zurück."}
    },
    listReplaceableDevices: {
        rfd: true,
        hs485d: true,
        params: [
            { name: "newDeviceAddress", type: "device_address" }
        ],
        returns: '',
        help: {de: "Mit dieser Funktionen kann eine Liste der Geräte angefordert werden die durch das übergebene Gerät ersetzt werden können.<br>Über den Parameter newDeviceAddress wird die Adresse des neuen Geräts übergeben für die die möglichen Tauschpartner ermittelt werden sollen."}
    },
    listTeams: {
        rfd: true,
        hs485d: false,
        params: [],
        returns: '',
        help: {de: "Diese Methode gibt alle dem Schnittstellenprozess bekannten Teams in Form von Gerätebeschreibungen zurück."}
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
        help: {de: "Diese Methode gibt den aktuellen Log-Level zurück bzw. setzt diesen."}
    },
    putParamset: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'address' },
            { name: 'paramset_key', type: 'string' },
            { name: 'set', type: 'paramset' }
        ],
        returns: '',
        help: {de: "Mit dieser Methode wird ein komplettes Parameter-Set für ein logisches Gerät geschrieben. Der Parameter address ist die Addresses eines logischen Gerätes. Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers). Der Parameter set ist das zu schreibende Parameter-Set. In set nicht vorhandene Member werden einfach nicht geschrieben und behalten ihren alten Wert"}
    },
    removeLink: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'sender', type: 'device_address' },
            { name: 'receiver', type: 'device_address' }
        ],
        returns: '',
        help: {de: "Diese Methode löscht eine Kommunikationsbeziehung zwischen zwei Geräten. Die Parameter sender und receiver bezeichnen die beiden Kommunikationspartner deren Kommunikationszuordnung gelöscht werden soll."}
    },
    replaceDevice: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'oldDeviceAddress', type: 'device_address' },
            { name: 'newDeviceAddress', type: 'device_address' }
        ],
        returns: '',
        help: {de: "Mit dieser Funktion kann ein altes gegen ein neues Gerät ausgetauscht werden. Alle direkten Geräteverknüpfungen und Konfigurationen werden auf das neue Gerät kopiert und das alte Gerät gelöscht. Die Beiden Geräte müssen hinsichtlich ihrer Funktionalität kompatibel sein. Mit der Methode listReplaceableDevice() kann eine List kompatibeler Geräte abgefragt werden. Das neue Gerät muss an dem Schnittstellenprozess angemeldet sein und darf noch nicht in Verknüpfungen verwendet werden. Über die Parameter oldDeviceAddress und newDeviceAddress wird der Methode die Adresse des alten Gerätes und des neuen Gerätes übergeben. Der Rückgabewert ist true wenn der Tausch erfolgreich war, ansonsten false"}
    },
    reportValueUsage: {
        rfd: true,
        hs485d: true,
        params: [
            { name: 'address', type: 'channel_address' },
            { name: 'value_id', type: 'string' },
            { name: 'ref_counter', type: 'integer' }
        ],
        returns: '',
        help: {de: "Diese Methode teilt dem Interfaceprozess in ref_counter mit, wie oft der Wert value_id des Kanals address innerhalb der Logikschicht (z.B. in Programmen) verwendet wird. Dadurch kann der Interfaceprozess die Verbindung mit der entsprechenden Komponente herstellen bzw. löschen. Diese Funktion sollte bei jeder Änderung aufgerufen werden.<br>Der Rückgabewert ist true, wenn die Aktion sofort durchgeführt wurde. Er ist false, wenn die entsprechende Komponente nicht erreicht werden konnte und vom Benutzer zunächst in den Config-Mode gebracht werden muss. Der Interfaceprozess hat dann aber die neue Einstellung übernommen und wird sie bei nächster Gelegenheit automatisch an die Komponente übertragen. In diesem Fall ist dann auch der Wert CONFIG_PENDING im Kanal MAINTENANCE der Komponente gesetzt."}
    },
    restoreConfigToDevice: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'address', type: 'device_address' }
        ],
        returns: '',
        help: {de: "Diese Methode überträgt alle zu einem Gerät in der CCU gespeicherten Konfigurationsdaten erneut an das Gerät."}
    },
    rssiInfo: {
        rfd: true,
        hs485d: false,
        params: [],
        returns: '',
        help: {de: "Gibt ein zweidimensionales assoziatives Array zurück, dessen Schlüssel die Geräteadressen sind. Die Felder des assoziativen Arrays sind Tupel, die die Empfangsfeldstärken zwischen beiden Schlüsselgeräten für beide Richtungen in dbm angeben. ein Wert von 65536 bedeutet, dass keine Informationen vorliegen.<ul><li>Rückgabewert[<Gerät 1>][<Gerät 2>][0] Empfangsfeldstärke an Gerät 1 für Sendungen von Gerät 2</li><li>Rückgabewert[<Gerät 1>][<Gerät 2>][1] Empfangsfeldstärke an Gerät 2 für Sendungen von Gerät 1</li></ul>"}

    },
    searchDevices: {
        rfd: false,
        hs485d: true,
        params: [],
        returns: '',
        help: {de: "Diese Methode durchsucht den Bus nach neuen Geräten und gibt die Anzahl gefundener Geräte zurück. Die neu gefundenen Geräte werden mit newDevices der Logikschicht gemeldet."}
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
        help: {de: "Diese Methode setzt das für die Kommunikation mit dem durch device_address spezifizierten Gerät verwendete Bidcos-Interface. Die Seriennummer des in Zukunft für die Kommunikation mit diesem Gerät zu verwendenden Interfaces wird in interface_address übergeben. Ist der Parameter roaming gesetzt, so wird die Interfacezuordnung für das Gerät automatisch in Abhängigkeit von der Empfangsfeldstärke angepasst. Das ist für nicht ortsfeste Geräte wie Fernbedienungen sinnvoll."}

    },
    setInstallMode:  {
        rfd: true,
        hs485d: false,
        params: [
            // TODO Mode 3 (anlernen über Seriennummer)
            { name: 'on', type: 'boolean' },
            { name: 'time', type: 'integer', optional: ['rfd'] },
            { name: 'mode', type: 'integer', optional: ['rfd'] }
        ],
        returns: '',
        help: {de: "Diese Methode aktiviert und deaktiviert den Installations-Modus, in dem neue Geräte an der HomeMatic-CCU angemeldet werden können.<br>Der Parameter on bestimmt, ob der Installations-Modus aktiviert oder deaktiviert werden soll.<br>Der Parameter time bestimmt die Zeit in Sekunden die der Installations-Modus aktiviert ist<br>Der Parameter mode bestimmt die Art des Installations-Modus:<ul><li>1 = Normaler Installations-Modus</li><li>2 = Während des Anlernens werden in den Parametersets „MASTER“ default Parameter gesetzt und alle bestehenden Verknüpfungen werden gelöscht.</li></ul>"}
    },
    setInterfaceClock: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'utcSeconds', type: 'integer' },
            { name: 'offsetMinutes', type: 'integer' }
        ],
        returns: '',
        help: {de: "Setzt die UTC Zeit für alle Interfaces, die dies benötigen.<br>Mit dem Parameter utcSeconds werden die Sekunden seti 01.01.1970 00:00 Uhr (UTC) gesetzt.<br>Über den Parameter offsetMinutes wird der Offset in Minuten entsprechend der jeweiligen Zeitzone übergeben.<br>Der Rückgabewert der Methode ist false im Fehlerfall, ansonsten true."}
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
        help: {de: "Diese Methode ändert die beschreibenden Texte einer Kommunikationsbeziehung. Die Spezifikation Parameter sender und receiver bezeichnen die beiden zu verknüpfenden Partner. Die Parameter name und description beschreiben die Verknüpfung textuell."}
    },
    setRFLGWInfoLED: {
        rfd: true,
        hs485d: false,
        params: [],
        returns: '',
        help: {de: "leider nicht von eQ-3 dokumentiert."}
    },
    setTeam: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'channel_address', type: 'channel_address' },
            { name: 'team_address', type: 'team_address' }
        ],
        returns: '',
        help: {de: "Diese Methode fügt den Kanal channel_address zum Team team_address hinzu. Bei team_address==““ wird der Kanal channel_address seinem eigenen Team zugeordnet. Dabei muss team_address entweder leer sein (““) oder eine Seriennummer eines existierenden Teams enthalten. Teams werden dabei je nach Bedarf erzeugt und gelöscht."}
    },
    setTempKey: {
        rfd: true,
        hs485d: false,
        params: [
            { name: 'passphrase', type: 'string' }
        ],
        returns: '',
        help: {de: "Diese Methode ändert den von der CCU verwendeten temporären AES-Schlüssel. Der temporäre AES-Schlüssel wird verwendet, um ein Gerät anzulernen, in dem ein anderer Schlüssel gespeichert ist als der Schlüssel der CCU."}
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
        help: {de: "Mit dieser Methode wird ein einzelner Wert aus dem Parameter-Set „VALUES“ geschrieben. Der Parameter address ist die Addresse eines logischen Gerätes. Der Parameter value_key ist der Name des zu schreibenden Wertes. Die möglichen Werte für value_key ergeben sich aus der ParamsetDescription des entsprechenden Parameter-Sets „VALUES“. Der Parameter value ist der zu schreibende Wert."}
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
        help: {de: "Diese Methode führt ein Firmware-Update für das in device angegebene Gerät durch. Das Gerät wird durch seine Seriennummer spezifiziert. Der Rückgabewert gibt an, ob das Firmware-Update erfolgreich war."}
    }
};