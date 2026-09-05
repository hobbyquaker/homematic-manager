/**
 * The XML-RPC method catalogue of the interface processes, for the RPC console (task 8).
 *
 * Converted from the 2.x `www/js/rpcMethods.json` (51 methods, argument names and types plus the
 * German help texts of the eQ-3 XML-RPC specification) into typed data, so that the console can
 * generate its argument form and check what it is about to send instead of posting free text.
 *
 * The catalogue is what we know in advance; what an interface actually offers is
 * `system.listMethods`, and `system.methodHelp` gives its own help text for a method. Both are
 * merged in at runtime by {@link methodsFor} and {@link mergeMethodHelp}, so a Homegear or a CUxD
 * that offers more or fewer methods still gets a usable console (D-20: no vendor-specific code).
 *
 * Generated once from the 2.x file and then maintained here by hand.
 */

import type {Language} from '../data/types.js';

/** The argument types the specification uses. They are hints for the console's form, not a schema. */
export type RpcParameterType =
    | 'RpcStruct[]'
    | 'address'
    | 'bool'
    | 'boolean'
    | 'channel_address'
    | 'device_address'
    | 'integer'
    | 'interface_address'
    | 'mixed'
    | 'paramset'
    | 'paramset_type'
    | 'string'
    | 'team_address'
    | 'value_key'
    | 'variant';

/** One argument of a method. */
export interface RpcMethodParameter {
    readonly name: string;
    readonly type: RpcParameterType;
    /** Interface processes on which the argument may be left out (`rfd`, `hs485d`). */
    readonly optional?: readonly string[];
    /** Bit value -> flag name, for an argument that is a bit field. */
    readonly bitmask?: Readonly<Record<string, string>>;
    /** Value -> name, for an argument with a fixed set of values. */
    readonly values?: Readonly<Record<string, string>>;
}

/** One method of the catalogue. */
export interface RpcMethod {
    readonly name: string;
    readonly params: readonly RpcMethodParameter[];
    /** What the specification says it returns; `''` where it says nothing. */
    readonly returns: string;
    /** Help text per language; the 2.x file has German only, `system.methodHelp` adds more. */
    readonly help: Readonly<Partial<Record<Language, string>>>;
}

/** The method catalogue, keyed by method name. */
export const RPC_METHODS: Readonly<Record<string, RpcMethod>> = {
    abortDeleteDevice: {
        name: 'abortDeleteDevice',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
        ],
        returns: 'void',
        help: {
            de: 'Diese Methode bricht einen anhängigen Löschvorgang für ein Gerät ab.<br>Es können nur Löschvorgänge abgebrochen werden, die mit dem Flag DELETE_FLAG_DEFER ausgeführt wurden.',
        },
    },
    activateLinkParamset: {
        name: 'activateLinkParamset',
        params: [
            {
                name: 'address',
                type: 'channel_address',
            },
            {
                name: 'peer_address',
                type: 'channel_address',
            },
            {
                name: 'long_press',
                type: 'boolean',
            },
        ],
        returns: 'void',
        help: {
            de: 'Mit dieser Methode wird ein Link-Parameterset aktiviert. Das logische Gerät verhält sich dann so als ob es direkt von dem entsprechenden zugeordneten Gerät angesteuert worden wäre. Hiermit kann z.B. ein Link-Parameter-Set getestet werden. Der Parameter address ist die Addresses des anzusprechenden logischen Gerätes. Der Parameter peer_address ist die Addresse des Kommunikationspartners, dessen Link-Parameter-Set aktiviert werden soll. Der Parameter long_press gibt an, ob das Parameterset für den langen Tastendruck aktiviert werden soll.',
        },
    },
    addDevice: {
        name: 'addDevice',
        params: [
            {
                name: 'address',
                type: 'string',
            },
            {
                name: 'mode',
                type: 'integer',
                optional: ['rfd'],
            },
        ],
        returns: 'DeviceDescription',
        help: {
            de: 'Diese Methode lernt ein Gerät anhand seiner Seriennummer an die CCU an. Diese Funktion wird nicht von jedem Gerät unterstützt. Rückgabewert ist die DeviceDescription des neu angelernten Geräts.<br>Der optionale Parameter mode bestimmt die Art des Installations-Modus:<br>1 = Normaler Installations-Modus<br>2 = Während des Anlernens werden in den Parametersets „MASTER“ default Parameter gesetzt und alle bestehenden Verknüpfungen werden gelöscht.',
        },
    },
    addLink: {
        name: 'addLink',
        params: [
            {
                name: 'sender',
                type: 'channel_address',
            },
            {
                name: 'receiver',
                type: 'channel_address',
            },
            {
                name: 'name',
                type: 'string',
                optional: ['rfd', 'hs485d'],
            },
            {
                name: 'description',
                type: 'string',
                optional: ['rfd', 'hs485d'],
            },
        ],
        returns: 'void',
        help: {
            de: 'Diese Methode erstellt eine Kommunikationsbeziehung zwischen zwei logischen Geräten. Die Parameter sender und receiver bezeichnen die beiden zu verknüpfenden Partner. Die Parameter name und description sind optional und beschreiben die Verknüpfung näher.',
        },
    },
    addVirtualDeviceInstance: {
        name: 'addVirtualDeviceInstance',
        params: [],
        returns: '',
        help: {
            de: 'leider nicht von eQ-3 dokumentiert.',
        },
    },
    changeKey: {
        name: 'changeKey',
        params: [
            {
                name: 'passphrase',
                type: 'string',
            },
        ],
        returns: 'void',
        help: {
            de: 'Diese Methode ändert den vom Schnittstellenprozess verwendeten AES-Schlüssel. Der Schlüssel wird ebenfalls in allen angelernten Geräten getauscht.',
        },
    },
    clearConfigCache: {
        name: 'clearConfigCache',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
        ],
        returns: 'void',
        help: {
            de: 'Diese Methode löscht alle zu einem Gerät in der CCU gespeicherten Konfigurationsdaten. Diese werden nicht sofort wieder vom Gerät abgefragt, sondern wenn sie das nächste mal benötigt werden.',
        },
    },
    deleteDevice: {
        name: 'deleteDevice',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
            {
                name: 'flags',
                type: 'integer',
                bitmask: {
                    '1': 'DELETE_FLAG_RESET',
                    '2': 'DELETE_FLAG_FORCE',
                    '4': 'DELETE_FLAG_DEFER',
                },
            },
        ],
        returns: 'DeviceDescription',
        help: {
            de: 'Diese Methode löscht ein Gerät aus dem Schnittstellenprozess.<br>Der Parameter address ist die Addresse des zu löschenden Gerätes.<br>Flags ist ein bitweises oder folgender Werte:<ul><li>DELETE_FLAG_RESET Das Gerät wird vor dem Löschen in den Werkszustand zurückgesetzt </li><li>DELETE_FLAG_FORCE Das Gerät wird auch gelöscht, wenn es nicht erreichbar ist </li><li>DELETE_FLAG_DEFER Wenn das Gerät nicht erreichbar ist, wird es bei nächster Gelegenheit gelöscht</li></ul>Bei Homematic IP sind die Flags 0x01 und 0x04 nicht mehr vorhanden und das Löschen von Geräten ist per Default so, als wenn diese Flags gesetzt worden wären.',
        },
    },
    determineParameter: {
        name: 'determineParameter',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
            {
                name: 'paramset_key',
                type: 'string',
            },
            {
                name: 'parameter_id',
                type: 'string',
            },
        ],
        returns: 'void',
        help: {
            de: 'Mit dieser Methode wird ein Parameter eines Parameter-Sets automatisch bestimmt. Der Parameter kann bei erfolgreicher Ausführung anschließend sofort über getParamset gelesen werden.<br>Der Parameter address ist die Addresses eines logischen Gerätes.<br>Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers). Der Parameter parameter_id bestimmt den automatisch zu bestimmenden Parameter.',
        },
    },
    getDeviceDescription: {
        name: 'getDeviceDescription',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
        ],
        returns: 'DeviceDescription',
        help: {
            de: 'Diese Methode gibt die Gerätebeschreibung des als address übergebenen Gerätes zurück.',
        },
    },
    getInstallMode: {
        name: 'getInstallMode',
        params: [],
        returns: 'Integer',
        help: {
            de: 'Diese Methode gibt die verbliebene Restzeit in Sekunden im Anlernmodus zurück. Der Wert  0 bedeutet, der Anlernmodus ist nicht aktiv.',
        },
    },
    getKeyMismatchDevice: {
        name: 'getKeyMismatchDevice',
        params: [
            {
                name: 'reset',
                type: 'bool',
            },
        ],
        returns: 'String',
        help: {
            de: 'Diese Methode gibt die Seriennummer des letzten Gerätes zurück, das aufgrund eines falschen AES-Schlüssels nicht angelernt werden konnte. Mit reset=true wird diese Information im Schnittstellenprozess zurückgesetzt.',
        },
    },
    getLGWStatus: {
        name: 'getLGWStatus',
        params: [],
        returns: '',
        help: {
            de: 'Gibt den Status des Wired-LAN-Gateways zurück.',
        },
    },
    getLinkInfo: {
        name: 'getLinkInfo',
        params: [
            {
                name: 'sender',
                type: 'device_address',
            },
            {
                name: 'receiver',
                type: 'device_address',
            },
        ],
        returns: 'Array',
        help: {
            de: 'Diese Methode gibt den Namen und die Beschreibung für eine bestehende Kommunikationsbeziehung zurück. Die Parameter sender_address und receiver_address bezeichnen die beiden verknüpften Partner.',
        },
    },
    getLinkPeers: {
        name: 'getLinkPeers',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode gibt alle einem logischen Gerät zugeordneten Kommunikationspartner zurück. Die zurückgegebenen Werte können als Parameter paramset_key für getParamset() und putParamset() verwendet werden. Der Parameter address ist die Adresse eines logischen Gerätes.',
        },
    },
    getLinks: {
        name: 'getLinks',
        params: [
            {
                name: 'address',
                type: 'address',
            },
            {
                name: 'flags',
                type: 'integer',
                optional: ['rfd', 'hs485d'],
                bitmask: {
                    '1': 'GL_FLAG_GROUP',
                    '2': 'GL_FLAG_SENDER_PARAMSET',
                    '4': 'GL_FLAG_RECEIVER_PARAMSET',
                },
            },
        ],
        returns: 'Array',
        help: {
            de: 'Diese Methode gibt alle einem logischen Kanal oder Gerät zugeordneten Kommunikationsbeziehungen zurück.<br>Der Parameter address ist die Kanal- oder Geräteadresse des logischen Objektes, auf das sich die Abfrage bezieht. Bei address==&quot;&quot; werden alle Kommunikationsbeziehungen des gesamten Schnittstellenprozesses zurückgegeben.<br>Der Parameter flags ist ein bitweises oder folgender Werte:<ul><li>GL_FLAG_GROUP Wenn address einen Kanal bezeichnet, der sich in einer Gruppe befindet, werden die Kommunikationsbeziehungen für alle Kanäle der Gruppe zurückgegeben.</li><li>GL_FLAG_SENDER_PARAMSET Das Feld SENDER_PARAMSET des Rückgabewertes wird gefüllt. </li><li>GL_FLAG_RECEIVER_PARAMSET Das Feld RECEIVER_PARAMSET des Rückgabewertes wird gefüllt.</li></ul>flags ist optional. Defaultwert ist 0x00.',
        },
    },
    getMetadata: {
        name: 'getMetadata',
        params: [
            {
                name: 'object_id',
                type: 'string',
            },
            {
                name: 'data_id',
                type: 'string',
            },
        ],
        returns: 'Variant',
        help: {
            de: 'Diese Methode gibt ein Metadatum zu einem Objekt zurück.<br><b>object_id</b> ist die Id des Metadaten-Objekts. Üblicherweise ist dies die Seriennummer eines Gerätes oder Kanals.<br><b>data_id</b> ist die Id des abzufragenden Metadatums. Diese Id kann frei gewählt werden. Der Rückgabewert entspricht in Datentyp und Wert der zuvor an setMetadata() als Parameter value übergebenen Variablen. ',
        },
    },
    getAllMetadata: {
        name: 'getAllMetadata',
        params: [
            {
                name: 'object_id',
                type: 'string',
            },
        ],
        returns: 'Struct',
        help: {
            de: 'Diese Methode gibt alle zuvor gesetzten Metadaten zu einem Objekt zurück.<br><b>object_id</b> ist die Id des Metadaten-Objekts. Üblicherweise ist dies die Seriennummer eines Gerätes oder Kanals. Durch Übergabe einer beliebigen Id können aber auch eigene Metadaten-Objekte angelegt werden.<br>Der Rückgabewert ist ein Struct, der zu jedem zuvor gesetzten Metadatum ein Feld enthält. Der Feldname ist der zuvor an setMetadata() als Parameter data_id übergebene Wert. Der Wert des Feldes entspricht in Datentyp und Wert der zuvor an setMetadata() als Parameter value übergebenen Variablen. ',
        },
    },
    getParamset: {
        name: 'getParamset',
        params: [
            {
                name: 'address',
                type: 'address',
            },
            {
                name: 'paramset_key',
                type: 'string',
            },
            {
                name: 'mode',
                type: 'integer',
                optional: ['rfd'],
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Methode wird ein komplettes Parameter-Set für ein logisches Gerät gelesen. Der Parameter address ist die Addresses eines logischen Gerätes. Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers).<br>Dem optionalen Parameter mode können folgende Werte übergeben werden (nur rfd):<ul><li>0 default: Keien Auswirkung, die Funktion verhält sicht wie der Aufruf ohne mode</li><li>1 UndefinedValues: Jeder Eintrag innerhalb des zurückgelieferten Paramset ins eine Struktur mit folgendem Aufbau:<br>„UNDEFINED“(Boolean) Flag ob der angeforderte Wert initial gesetzt wurde und somit wahrscheinlich nicht der Realität entspricht oder ob der Wert von einem Gerät empfangen wurde, true = Wert wurde initial gesetzt und noch nicht verändert, false = der Wert wurde neu gesetzt <br>„VALUE“(ValueType) Wert des angeforderten Parameter.<br>UndefindeValues kann nur für Parameter aus dem Parameterset „VALUES“ abgefragt werden. Bei HomeMatic IP gibt es für bestimmte Geräte zusätzlich den paramset_type„SERVICE“, welche Geräte dies sind, ist der jeweiligen DeviceDescription zu entnehmen.Ebenso ist dieses Parameter Set kanalübergreifend, so dass es über die XML-RPCSchnittstellefür alle Kanäle abgefragt werden kann, aber immer dieselben Parameterzurückliefert.<br>Hinweis: Diese Parameter werden bei jeder Anfrage direkt vom Gerät abgefragt, deshalbsollten sie wegen der DutyCycle Belastung nicht sehr häufig abgefragt werden.',
        },
    },
    getParamsetDescription: {
        name: 'getParamsetDescription',
        params: [
            {
                name: 'address',
                type: 'address',
            },
            {
                name: 'paramset_type',
                type: 'paramset_type',
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Methode wird die Beschreibung eines Parameter-Sets ermittelt. Der Parameter address ist die Adresse eines logischen Gerätes (z.B. von listDevices zurückgegeben). Der Parameter paramset_type ist „MASTER“, „VALUES“ oder „LINK“.Bei HomeMatic IP gibt es für bestimmte Geräte zusätzlich den paramset_typeSERVICE, welche Geräte dies sind, ist der jeweiligen DeviceDescription zu entnehmen.Ebenso ist dieses Parameter Set kanalübergreifend, so dass es über die XML-RPCSchnittstellefür alle Kanäle abgefragt werden kann, aber immer dieselben Parameter zurückliefert. ',
        },
    },
    getParamsetId: {
        name: 'getParamsetId',
        params: [
            {
                name: 'address',
                type: 'address',
            },
            {
                name: 'type',
                type: 'string',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode gibt die Id eines Parametersets zurück. Diese wird verwendet, um spezialisierte Konfigurationsdialoge (Easymode) den Parametersets zuzuordnen.',
        },
    },
    getServiceMessages: {
        name: 'getServiceMessages',
        params: [],
        returns: '',
        help: {
            de: 'Diese Methode gibt eine Liste aller vorhandenen Servicemeldungen in Form eines Arrays zurück.',
        },
    },
    getValue: {
        name: 'getValue',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
            {
                name: 'value_key',
                type: 'string',
            },
            {
                name: 'mode',
                type: 'integer',
                optional: ['rfd'],
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Methode wird ein einzelner Wert aus dem Parameter-Set „VALUES“ gelesen. Der Parameter address ist die Addresse eines logischen Gerätes. Der Parameter value_key ist der Name des zu lesenden Wertes. Die möglichen Werte für value_key ergeben sich aus der ParamsetDescription des entsprechenden Parameter-Sets „VALUES“.<br>Dem Parameter mode können folgende Werte übergeben werden:<ul><li>0 default: Keien Auswirkung, die Funktion verhält sicht wie der Aufruf ohne mode</li><li>1 UndefinedValues: Es wird ein Struktur zurückgeliefert die folgenden Aufbau hat:<br>„UNDEFINED“(Boolean) Flag ob der angeforderte Wert initial gesetzt wurde und somit wahrscheinlich nicht der Realität entspricht oder ob der Wert von eimen Gerät empfangen wurde, true = Wert wurde initial gesetzt und noch nicht verändert, false = der Wert wurde neu gesetzt<br>„VALUE“(ValueType) Wert des angeforderten Parameter.</li></ul><br>UndefindeValues kann nur für Parameter aus dem Parameterset „VALUES“ abgefragt werden die mit OPERATIONS = Read gekenzeichnet sind.',
        },
    },
    getVersion: {
        name: 'getVersion',
        params: [],
        returns: '',
        help: {
            de: 'Liefert die Version des BidCoS-Service.',
        },
    },
    listBidcosInterfaces: {
        name: 'listBidcosInterfaces',
        params: [],
        returns: '',
        help: {
            de: 'Diese Methode gibt eine Liste aller vorhandenen BidCoS-Interfaces in Form eines Arrays von Structs zurück',
        },
    },
    listDevices: {
        name: 'listDevices',
        params: [],
        returns: '',
        help: {
            de: 'Diese Methode gibt alle dem Schnittstellenprozess bekannten Geräte in Form von Gerätebeschreibungen zurück.',
        },
    },
    listReplaceableDevices: {
        name: 'listReplaceableDevices',
        params: [
            {
                name: 'newDeviceAddress',
                type: 'device_address',
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Funktionen kann eine Liste der Geräte angefordert werden die durch das übergebene Gerät ersetzt werden können.<br>Über den Parameter newDeviceAddress wird die Adresse des neuen Geräts übergeben für die die möglichen Tauschpartner ermittelt werden sollen.',
        },
    },
    listTeams: {
        name: 'listTeams',
        params: [],
        returns: '',
        help: {
            de: 'Diese Methode gibt alle dem Schnittstellenprozess bekannten Teams in Form von Gerätebeschreibungen zurück.',
        },
    },
    logLevel: {
        name: 'logLevel',
        params: [
            {
                name: 'level',
                type: 'integer',
                optional: ['rfd', 'hs485d'],
                values: {
                    '0': 'LOG_ALL',
                    '1': 'LOG_DEBUG',
                    '2': 'LOG_INFO',
                    '3': 'LOG_NOTICE',
                    '4': 'LOG_WARNING',
                    '5': 'LOG_ERROR',
                    '6': 'LOG_FATAL_ERROR',
                },
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode gibt den aktuellen Log-Level zurück bzw. setzt diesen.',
        },
    },
    ping: {
        name: 'ping',
        params: [
            {
                name: 'callerId',
                type: 'string',
            },
        ],
        returns: 'bool',
        help: {
            de: 'Beim Aufruf dieser Funktion wird ein Event (im Folgenden PONG genannt) erzeugt und an alle registrierten Logikschichten versandt. Da das PONG Event an alle registrierten Logikschichten (wie bei allen anderen Events auch) verschickt wird, muss in einer Logikschicht damit gerechnet werden, ein PONG Event zu empfangen ohne zuvor ping aufgerufen zu haben. Der Parameter callerId ist vom Aufrufer zu übergeben und wird als Wert des PONG Events verwendet. Der Inhalt des String ist unerheblich. Tritt während der Verarbeitung keine Exception auf, so wird von der Methode true zurückgegeben. Das PONG Event wird über die event Methode der Logikschicht ausgeliefert. Die Adresse ist dabei immer „CENTRAL“, der key lautet „PONG“ und der Wert ist die im ping Aufrufübergebene callerId',
        },
    },
    putParamset: {
        name: 'putParamset',
        params: [
            {
                name: 'address',
                type: 'address',
            },
            {
                name: 'paramset_key',
                type: 'string',
            },
            {
                name: 'set',
                type: 'paramset',
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Methode wird ein komplettes Parameter-Set für ein logisches Gerät geschrieben. Der Parameter address ist die Addresses eines logischen Gerätes. Der Parameter paramset_key ist „MASTER“, „VALUES“ oder die Adresse eines Kommunikationspartners für das entsprechende Link-Parameter-Set (siehe getLinkPeers). Der Parameter set ist das zu schreibende Parameter-Set. In set nicht vorhandene Member werden einfach nicht geschrieben und behalten ihren alten Wert.<br>Bei HomeMatic IP kann address auch die spezielle Adresse ALL_SMOKE_DETECTORS sein, welche für die Übertragung über Funk nicht eine Geräteadresse sondern die Multicast Adresse (0xF00005) für alle Rauchmelder verwendet und somit auch alle in Funkreichweite befindlichen Rauchmelder des Funknetzwerkes diesen ausführen sollten.',
        },
    },
    removeLink: {
        name: 'removeLink',
        params: [
            {
                name: 'sender',
                type: 'device_address',
            },
            {
                name: 'receiver',
                type: 'device_address',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode löscht eine Kommunikationsbeziehung zwischen zwei Geräten. Die Parameter sender und receiver bezeichnen die beiden Kommunikationspartner deren Kommunikationszuordnung gelöscht werden soll.',
        },
    },
    replaceDevice: {
        name: 'replaceDevice',
        params: [
            {
                name: 'oldDeviceAddress',
                type: 'device_address',
            },
            {
                name: 'newDeviceAddress',
                type: 'device_address',
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Funktion kann ein altes gegen ein neues Gerät ausgetauscht werden. Alle direkten Geräteverknüpfungen und Konfigurationen werden auf das neue Gerät kopiert und das alte Gerät gelöscht. Die Beiden Geräte müssen hinsichtlich ihrer Funktionalität kompatibel sein. Mit der Methode listReplaceableDevice() kann eine List kompatibeler Geräte abgefragt werden. Das neue Gerät muss an dem Schnittstellenprozess angemeldet sein und darf noch nicht in Verknüpfungen verwendet werden. Über die Parameter oldDeviceAddress und newDeviceAddress wird der Methode die Adresse des alten Gerätes und des neuen Gerätes übergeben. Der Rückgabewert ist true wenn der Tausch erfolgreich war, ansonsten false',
        },
    },
    reportValueUsage: {
        name: 'reportValueUsage',
        params: [
            {
                name: 'address',
                type: 'channel_address',
            },
            {
                name: 'value_id',
                type: 'string',
            },
            {
                name: 'ref_counter',
                type: 'integer',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode teilt dem Interfaceprozess in ref_counter mit, wie oft der Wert value_id des Kanals address innerhalb der Logikschicht (z.B. in Programmen) verwendet wird. Dadurch kann der Interfaceprozess die Verbindung mit der entsprechenden Komponente herstellen bzw. löschen. Diese Funktion sollte bei jeder Änderung aufgerufen werden.<br>Der Rückgabewert ist true, wenn die Aktion sofort durchgeführt wurde. Er ist false, wenn die entsprechende Komponente nicht erreicht werden konnte und vom Benutzer zunächst in den Config-Mode gebracht werden muss. Der Interfaceprozess hat dann aber die neue Einstellung übernommen und wird sie bei nächster Gelegenheit automatisch an die Komponente übertragen. In diesem Fall ist dann auch der Wert CONFIG_PENDING im Kanal MAINTENANCE der Komponente gesetzt.',
        },
    },
    restoreConfigToDevice: {
        name: 'restoreConfigToDevice',
        params: [
            {
                name: 'address',
                type: 'device_address',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode überträgt alle zu einem Gerät in der CCU gespeicherten Konfigurationsdaten erneut an das Gerät.',
        },
    },
    rssiInfo: {
        name: 'rssiInfo',
        params: [],
        returns: '',
        help: {
            de: 'Gibt ein zweidimensionales assoziatives Array zurück, dessen Schlüssel die Geräteadressen sind. Die Felder des assoziativen Arrays sind Tupel, die die Empfangsfeldstärken zwischen beiden Schlüsselgeräten für beide Richtungen in dbm angeben. ein Wert von 65536 bedeutet, dass keine Informationen vorliegen.<ul><li>Rückgabewert[<Gerät 1>][<Gerät 2>][0] Empfangsfeldstärke an Gerät 1 für Sendungen von Gerät 2</li><li>Rückgabewert[<Gerät 1>][<Gerät 2>][1] Empfangsfeldstärke an Gerät 2 für Sendungen von Gerät 1</li></ul>',
        },
    },
    searchDevices: {
        name: 'searchDevices',
        params: [],
        returns: '',
        help: {
            de: 'Diese Methode durchsucht den Bus nach neuen Geräten und gibt die Anzahl gefundener Geräte zurück. Die neu gefundenen Geräte werden mit newDevices der Logikschicht gemeldet.',
        },
    },
    setBidcosInterface: {
        name: 'setBidcosInterface',
        params: [
            {
                name: 'device_address',
                type: 'device_address',
            },
            {
                name: 'interface_address',
                type: 'interface_address',
            },
            {
                name: 'roaming',
                type: 'boolean',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode setzt das für die Kommunikation mit dem durch device_address spezifizierten Gerät verwendete Bidcos-Interface. Die Seriennummer des in Zukunft für die Kommunikation mit diesem Gerät zu verwendenden Interfaces wird in interface_address übergeben. Ist der Parameter roaming gesetzt, so wird die Interfacezuordnung für das Gerät automatisch in Abhängigkeit von der Empfangsfeldstärke angepasst. Das ist für nicht ortsfeste Geräte wie Fernbedienungen sinnvoll.',
        },
    },
    setInstallMode: {
        name: 'setInstallMode',
        params: [
            {
                name: 'on',
                type: 'boolean',
            },
            {
                name: 'time',
                type: 'integer',
                optional: ['rfd'],
            },
            {
                name: 'mode',
                type: 'integer',
                optional: ['rfd'],
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode aktiviert und deaktiviert den Installations-Modus, in dem neue Geräte an der HomeMatic-CCU angemeldet werden können.<br>Der Parameter on bestimmt, ob der Installations-Modus aktiviert oder deaktiviert werden soll.<br>Der Parameter time bestimmt die Zeit in Sekunden die der Installations-Modus aktiviert ist<br>Der Parameter mode bestimmt die Art des Installations-Modus:<ul><li>1 = Normaler Installations-Modus</li><li>2 = Während des Anlernens werden in den Parametersets „MASTER“ default Parameter gesetzt und alle bestehenden Verknüpfungen werden gelöscht.</li></ul>',
        },
    },
    setInterfaceClock: {
        name: 'setInterfaceClock',
        params: [
            {
                name: 'utcSeconds',
                type: 'integer',
            },
            {
                name: 'offsetMinutes',
                type: 'integer',
            },
        ],
        returns: '',
        help: {
            de: 'Setzt die UTC Zeit für alle Interfaces, die dies benötigen.<br>Mit dem Parameter utcSeconds werden die Sekunden seti 01.01.1970 00:00 Uhr (UTC) gesetzt.<br>Über den Parameter offsetMinutes wird der Offset in Minuten entsprechend der jeweiligen Zeitzone übergeben.<br>Der Rückgabewert der Methode ist false im Fehlerfall, ansonsten true.',
        },
    },
    setLinkInfo: {
        name: 'setLinkInfo',
        params: [
            {
                name: 'sender',
                type: 'channel_address',
            },
            {
                name: 'receiver',
                type: 'channel_address',
            },
            {
                name: 'name',
                type: 'string',
            },
            {
                name: 'description',
                type: 'string',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode ändert die beschreibenden Texte einer Kommunikationsbeziehung. Die Spezifikation Parameter sender und receiver bezeichnen die beiden zu verknüpfenden Partner. Die Parameter name und description beschreiben die Verknüpfung textuell.',
        },
    },
    setMetadata: {
        name: 'setMetadata',
        params: [
            {
                name: 'object_id',
                type: 'string',
            },
            {
                name: 'data_id',
                type: 'string',
            },
            {
                name: 'value',
                type: 'variant',
            },
        ],
        returns: 'void',
        help: {
            de: 'Diese Methode setzt ein Metadatum zu einem Objekt.<br><b>object_id</b> ist die Id des Metadaten-Objekts. Üblicherweise ist dies die Seriennummer eines Gerätes oder Kanals. Durch Übergabe einer beliebigen Id können aber auch eigene Metadaten-Objekte angelegt werden. <br><b>data_id</b> ist die Id des zu setzenden Metadatums. Diese Id kann frei gewählt werden. <br><b>value</b> ist eine beliebige Variable. Diese wird gespeichert und kann später mittels getMetadata() und getAllMetadata() wieder abgefragt werden.',
        },
    },
    setRFLGWInfoLED: {
        name: 'setRFLGWInfoLED',
        params: [
            {
                name: 'mode',
                type: 'integer',
                optional: ['rfd'],
                values: {
                    '0': 'OFF',
                    '1': 'ON',
                    '2': 'FLASH_SLOW',
                    '3': 'FLASH_FAST',
                },
            },
        ],
        returns: '',
        help: {
            de: 'Steuert die LED von verbundenen LAN Gateways (HMLGW2) an.',
        },
    },
    setTeam: {
        name: 'setTeam',
        params: [
            {
                name: 'channel_address',
                type: 'channel_address',
            },
            {
                name: 'team_address',
                type: 'team_address',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode fügt den Kanal channel_address zum Team team_address hinzu. Bei team_address==““ wird der Kanal channel_address seinem eigenen Team zugeordnet. Dabei muss team_address entweder leer sein (““) oder eine Seriennummer eines existierenden Teams enthalten. Teams werden dabei je nach Bedarf erzeugt und gelöscht.',
        },
    },
    setTempKey: {
        name: 'setTempKey',
        params: [
            {
                name: 'passphrase',
                type: 'string',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode ändert den von der CCU verwendeten temporären AES-Schlüssel. Der temporäre AES-Schlüssel wird verwendet, um ein Gerät anzulernen, in dem ein anderer Schlüssel gespeichert ist als der Schlüssel der CCU.',
        },
    },
    setValue: {
        name: 'setValue',
        params: [
            {
                name: 'address',
                type: 'channel_address',
            },
            {
                name: 'value_key',
                type: 'value_key',
            },
            {
                name: 'value',
                type: 'mixed',
            },
        ],
        returns: '',
        help: {
            de: 'Mit dieser Methode wird ein einzelner Wert aus dem Parameter-Set „VALUES“ geschrieben. Der Parameter address ist die Addresse eines logischen Gerätes. Der Parameter value_key ist der Name des zu schreibenden Wertes. Die möglichen Werte für value_key ergeben sich aus der ParamsetDescription des entsprechenden Parameter-Sets „VALUES“. Der Parameter value ist der zu schreibende Wert.<br>Bei HomeMatic IP kann address auch die spezielle Adresse ALL_SMOKE_DETECTORS sein, welche für die Übertragung über Funk nicht eine Geräteadresse sondern die Multicast Adresse (0xF00005) für alle Rauchmelder verwendet und somit auch alle in Funkreichweite befindlichen Rauchmelder des Funknetzwerkes diesen ausführen sollten.',
        },
    },
    'system.listMethods': {
        name: 'system.listMethods',
        params: [],
        returns: '',
        help: {},
    },
    'system.methodHelp': {
        name: 'system.methodHelp',
        params: [
            {
                name: 'method',
                type: 'string',
            },
        ],
        returns: '',
        help: {},
    },
    updateFirmware: {
        name: 'updateFirmware',
        params: [
            {
                name: 'device',
                type: 'device_address',
            },
        ],
        returns: '',
        help: {
            de: 'Diese Methode führt ein Firmware-Update für das in device angegebene Gerät durch. Das Gerät wird durch seine Seriennummer spezifiziert. Der Rückgabewert gibt an, ob das Firmware-Update erfolgreich war.',
        },
    },
    installFirmware: {
        name: 'installFirmware',
        params: [
            {
                name: 'device',
                type: 'device_address',
            },
        ],
        returns: 'boolean',
        help: {
            de: 'Mit dieser Methode teilt die Logikschicht dem Schnittstellenprozess mit, dass ein Gerät die über Background OTAU aufgespielte Firmware aktiveren soll.',
        },
    },
    setInstallModeWithWhitelist: {
        name: 'setInstallModeWithWhitelist',
        params: [
            {
                name: 'on',
                type: 'boolean',
            },
            {
                name: 'time',
                type: 'integer',
            },
            {
                name: 'whitelistValues',
                type: 'RpcStruct[]',
            },
        ],
        returns: 'void',
        help: {
            de: 'Mit dieser Methode teilt die Logikschicht dem Schnittstellenprozess mit, dass ein oder mehrere Geräte über die Whitelist für die Inkludierung freigeschaltet werden sollen für den angegebenen Zeitraum. <ul><li>on, gibt an ob die Install Mode aktiviert oder deaktiviert werden soll. Wenn der Wert „false“ ist haben die weiteren Parameter keine Auswirkung auf die Aktion. </li><li> time, gibt die Zeit in Sekunden an, nach der der Install Mode deaktiviert werden soll. Der Defaultwert ist 30 Sekunden. </li><li>whiteListValues, gibt die Geräte an, die inkludiert werden sollen, dies ist ein Array aus RPC Structs, welche folgende Daten haben: <ul><li> ADDRESS, gibt die SGTIN bzw. ID des Gerätes an, das inkludiert werden soll. </li><li> KEY_MODE, gibt den Typen des Keys an, der für die Inklusion verwendet werden soll. Dieser Wert ist ein String mit folgenden unterstützten Werten: <ul><li>LOCAL </li><li>MASTER und DEFAULT werden zur Zeit vom crRFD noch nicht unterstützt</li></ul> </li><li> KEY, gibt den zu verwendenden Geräteschlüssel an, der bei der Inklusion verwendet werden soll. Dieser Wert ist der Hexstring des 16 Byte langen Schlüssels </li></ul></li></ul> Wenn der KEY_MODE oder KEY nicht angegeben ist wird der Master Key vom Key-Server für die Inklusion versucht zu nutzten. Die Whitelist wird beim Ablauf des Install Mode zurückgesetzt.',
        },
    },
};

/** The method names of the catalogue, in specification order. */
export const RPC_METHOD_NAMES: readonly string[] = Object.keys(RPC_METHODS);

/** The catalogue entry of a method, or `undefined` for one nobody documented. */
export function rpcMethod(name: string): RpcMethod | undefined {
    return Object.prototype.hasOwnProperty.call(RPC_METHODS, name) ? RPC_METHODS[name] : undefined;
}

/** An entry for a method the catalogue does not know: no arguments, no help, name only. */
export function unknownRpcMethod(name: string): RpcMethod {
    return {name, params: [], returns: '', help: {}};
}

/**
 * The methods to offer for an interface, built from its own `system.listMethods` answer: the
 * catalogue entry where there is one, a bare entry where there is not. Methods the catalogue knows
 * but the interface does not offer are left out - offering them only produces failed calls.
 */
export function methodsFor(listMethods: readonly string[]): RpcMethod[] {
    return [...listMethods].sort().map((name) => rpcMethod(name) ?? unknownRpcMethod(name));
}

/**
 * Merges a `system.methodHelp` answer into a catalogue entry. The interface's own text wins over
 * the shipped one for that language; everything else is kept.
 */
export function mergeMethodHelp(name: string, help: string, language: Language = 'de'): RpcMethod {
    const method = rpcMethod(name) ?? unknownRpcMethod(name);
    if (help === '') {
        return method;
    }
    return {...method, help: {...method.help, [language]: help}};
}
