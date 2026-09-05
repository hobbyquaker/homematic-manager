/**
 * The demo fixture: what `npm run dev -w @homematic-manager/ui` shows and what the component tests
 * use when they need something that looks like a CCU.
 *
 * Two interfaces, ten devices with their channels, friendly names, two direct links, two service
 * messages, an RSSI matrix and a handful of events. The device shapes follow the same rules as
 * `packages/core/test/fixtures/devices.json`: plausible types, firmware and roles, not copied from
 * hardware. Nothing here is a specification - it exists so the UI can be operated without a
 * backend, and so a test can assert against a stable set of rows.
 */

import type {
    AppConfig,
    BidcosInterfaceInfo,
    ConnectionConfig,
    DeviceDescription,
    EventRecord,
    InterfaceState,
    LinkRecord,
    NameMap,
    Paramset,
    ParamsetDescription,
    RegaState,
    RpcMethodInfo,
    RssiInfo,
    ServiceMessage,
    WriteLogEntry,
} from '@homematic-manager/core';

export const DEMO_INTERFACE_NAMES = ['BidCos-RF', 'HmIP-RF'] as const;

export type DemoInterfaceName = (typeof DEMO_INTERFACE_NAMES)[number];

const BIDCOS_DEVICES: DeviceDescription[] = [
    {
        ADDRESS: 'BidCoS-RF',
        TYPE: 'HM-RCV-50',
        PARENT: '',
        CHILDREN: ['BidCoS-RF:0', 'BidCoS-RF:1', 'BidCoS-RF:2'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '2.31.25',
        VERSION: 1,
        FLAGS: 9,
        RX_MODE: 1,
        INTERFACE: '',
        RF_ADDRESS: 1_234_567,
    },
    {
        ADDRESS: 'BidCoS-RF:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'BidCoS-RF',
        PARENT_TYPE: 'HM-RCV-50',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 1,
    },
    {
        ADDRESS: 'BidCoS-RF:1',
        TYPE: 'VIRTUAL_KEY',
        PARENT: 'BidCoS-RF',
        PARENT_TYPE: 'HM-RCV-50',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH KEYMATIC WINMATIC',
        LINK_TARGET_ROLES: '',
        FLAGS: 1,
        VERSION: 1,
    },
    {
        ADDRESS: 'BidCoS-RF:2',
        TYPE: 'VIRTUAL_KEY',
        PARENT: 'BidCoS-RF',
        PARENT_TYPE: 'HM-RCV-50',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 2,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH KEYMATIC WINMATIC',
        LINK_TARGET_ROLES: '',
        FLAGS: 1,
        VERSION: 1,
    },
    {
        ADDRESS: 'MEQ0123456',
        TYPE: 'HM-LC-Sw1-Pl-CT-R1',
        PARENT: '',
        CHILDREN: ['MEQ0123456:0', 'MEQ0123456:1'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '2.5',
        AVAILABLE_FIRMWARE: '2.5',
        VERSION: 8,
        FLAGS: 1,
        RX_MODE: 1,
        INTERFACE: 'BidCoS-RF',
        ROAMING: 0,
        RF_ADDRESS: 4_132_819,
        UPDATABLE: 1,
    },
    {
        ADDRESS: 'MEQ0123456:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'MEQ0123456',
        PARENT_TYPE: 'HM-LC-Sw1-Pl-CT-R1',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 8,
    },
    {
        ADDRESS: 'MEQ0123456:1',
        TYPE: 'SWITCH',
        PARENT: 'MEQ0123456',
        PARENT_TYPE: 'HM-LC-Sw1-Pl-CT-R1',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 2,
        LINK_SOURCE_ROLES: '',
        LINK_TARGET_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 8,
    },
    {
        ADDRESS: 'JEQ0234567',
        TYPE: 'HM-PBI-4-FM',
        PARENT: '',
        CHILDREN: ['JEQ0234567:0', 'JEQ0234567:1', 'JEQ0234567:2'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '1.4',
        VERSION: 15,
        FLAGS: 1,
        RX_MODE: 12,
        INTERFACE: 'BidCoS-RF',
        ROAMING: 0,
        RF_ADDRESS: 4_298_112,
    },
    {
        ADDRESS: 'JEQ0234567:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'JEQ0234567',
        PARENT_TYPE: 'HM-PBI-4-FM',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 15,
    },
    {
        ADDRESS: 'JEQ0234567:1',
        TYPE: 'KEY',
        PARENT: 'JEQ0234567',
        PARENT_TYPE: 'HM-PBI-4-FM',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH KEYMATIC WINMATIC',
        LINK_TARGET_ROLES: '',
        FLAGS: 1,
        VERSION: 15,
    },
    {
        ADDRESS: 'JEQ0234567:2',
        TYPE: 'KEY',
        PARENT: 'JEQ0234567',
        PARENT_TYPE: 'HM-PBI-4-FM',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 2,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH KEYMATIC WINMATIC',
        LINK_TARGET_ROLES: '',
        FLAGS: 1,
        VERSION: 15,
    },
    {
        ADDRESS: 'KEQ0345678',
        TYPE: 'HM-CC-RT-DN',
        PARENT: '',
        CHILDREN: ['KEQ0345678:0', 'KEQ0345678:4'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '1.10',
        AVAILABLE_FIRMWARE: '1.11',
        VERSION: 20,
        FLAGS: 1,
        RX_MODE: 12,
        INTERFACE: 'BidCoS-RF',
        ROAMING: 0,
        RF_ADDRESS: 5_012_733,
        UPDATABLE: 1,
    },
    {
        ADDRESS: 'KEQ0345678:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'KEQ0345678',
        PARENT_TYPE: 'HM-CC-RT-DN',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 20,
    },
    {
        ADDRESS: 'KEQ0345678:4',
        TYPE: 'CLIMATECONTROL_RT_TRANSCEIVER',
        PARENT: 'KEQ0345678',
        PARENT_TYPE: 'HM-CC-RT-DN',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 4,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'THERMALCONTROL_TRANSMIT',
        LINK_TARGET_ROLES: '',
        FLAGS: 1,
        VERSION: 20,
    },
    {
        ADDRESS: 'LEQ0456789',
        TYPE: 'HM-Sec-SC-2',
        PARENT: '',
        CHILDREN: ['LEQ0456789:0', 'LEQ0456789:1'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '2.2',
        VERSION: 16,
        FLAGS: 1,
        RX_MODE: 12,
        INTERFACE: 'BidCoS-RF',
        ROAMING: 0,
        RF_ADDRESS: 5_298_004,
    },
    {
        ADDRESS: 'LEQ0456789:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'LEQ0456789',
        PARENT_TYPE: 'HM-Sec-SC-2',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 16,
    },
    {
        ADDRESS: 'LEQ0456789:1',
        TYPE: 'SHUTTER_CONTACT',
        PARENT: 'LEQ0456789',
        PARENT_TYPE: 'HM-Sec-SC-2',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'WINDOW_SWITCH_RECEIVER',
        LINK_TARGET_ROLES: '',
        FLAGS: 1,
        VERSION: 16,
    },
    {
        ADDRESS: 'GEQ0567890',
        TYPE: 'HM-LC-Dim1T-FM',
        PARENT: '',
        CHILDREN: ['GEQ0567890:0', 'GEQ0567890:1'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '2.2',
        VERSION: 34,
        FLAGS: 1,
        RX_MODE: 1,
        INTERFACE: 'BidCoS-RF',
        ROAMING: 0,
        RF_ADDRESS: 3_912_004,
    },
    {
        ADDRESS: 'GEQ0567890:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'GEQ0567890',
        PARENT_TYPE: 'HM-LC-Dim1T-FM',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 34,
    },
    {
        ADDRESS: 'GEQ0567890:1',
        TYPE: 'DIMMER',
        PARENT: 'GEQ0567890',
        PARENT_TYPE: 'HM-LC-Dim1T-FM',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 2,
        LINK_SOURCE_ROLES: '',
        LINK_TARGET_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 34,
    },
];

const HMIP_DEVICES: DeviceDescription[] = [
    {
        ADDRESS: 'HmIP-RCV-50',
        TYPE: 'HmIP-RCV-50',
        PARENT: '',
        CHILDREN: ['HmIP-RCV-50:0', 'HmIP-RCV-50:1'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '1.0.0',
        VERSION: 1,
        FLAGS: 9,
        RX_MODE: 1,
        SUBTYPE: '',
    },
    {
        ADDRESS: 'HmIP-RCV-50:0',
        TYPE: 'MAINTENANCE',
        PARENT: 'HmIP-RCV-50',
        PARENT_TYPE: 'HmIP-RCV-50',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 1,
    },
    {
        ADDRESS: 'HmIP-RCV-50:1',
        TYPE: 'VIRTUAL_KEY',
        PARENT: 'HmIP-RCV-50',
        PARENT_TYPE: 'HmIP-RCV-50',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 1,
    },
    {
        ADDRESS: '000A1B2C3D4E5F',
        TYPE: 'HmIP-BSM',
        SUBTYPE: 'BSM',
        PARENT: '',
        CHILDREN: ['000A1B2C3D4E5F:0', '000A1B2C3D4E5F:1', '000A1B2C3D4E5F:4'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '2.10.4',
        AVAILABLE_FIRMWARE: '2.12.0',
        VERSION: 40,
        FLAGS: 1,
        RX_MODE: 1,
        INTERFACE: 'HmIP-RF',
        UPDATABLE: 1,
    },
    {
        ADDRESS: '000A1B2C3D4E5F:0',
        TYPE: 'MAINTENANCE',
        PARENT: '000A1B2C3D4E5F',
        PARENT_TYPE: 'HmIP-BSM',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 40,
    },
    {
        ADDRESS: '000A1B2C3D4E5F:1',
        TYPE: 'KEY_TRANSCEIVER',
        PARENT: '000A1B2C3D4E5F',
        PARENT_TYPE: 'HmIP-BSM',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 40,
    },
    {
        ADDRESS: '000A1B2C3D4E5F:4',
        TYPE: 'SWITCH_VIRTUAL_RECEIVER',
        PARENT: '000A1B2C3D4E5F',
        PARENT_TYPE: 'HmIP-BSM',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 4,
        DIRECTION: 2,
        LINK_TARGET_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 40,
    },
    {
        ADDRESS: '0011D3C9A1B2C3',
        TYPE: 'HmIP-SWDO',
        SUBTYPE: 'SWDO',
        PARENT: '',
        CHILDREN: ['0011D3C9A1B2C3:0', '0011D3C9A1B2C3:1'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '1.4.6',
        VERSION: 12,
        FLAGS: 1,
        RX_MODE: 8,
        INTERFACE: 'HmIP-RF',
    },
    {
        ADDRESS: '0011D3C9A1B2C3:0',
        TYPE: 'MAINTENANCE',
        PARENT: '0011D3C9A1B2C3',
        PARENT_TYPE: 'HmIP-SWDO',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 12,
    },
    {
        ADDRESS: '0011D3C9A1B2C3:1',
        TYPE: 'SHUTTER_CONTACT',
        PARENT: '0011D3C9A1B2C3',
        PARENT_TYPE: 'HmIP-SWDO',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'WINDOW_SWITCH_RECEIVER',
        FLAGS: 1,
        VERSION: 12,
    },
    {
        ADDRESS: '3014F711A0001F',
        TYPE: 'HmIP-eTRV-2',
        SUBTYPE: 'eTRV',
        PARENT: '',
        CHILDREN: ['3014F711A0001F:0', '3014F711A0001F:1'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '2.4.4',
        VERSION: 34,
        FLAGS: 1,
        RX_MODE: 8,
        INTERFACE: 'HmIP-RF',
    },
    {
        ADDRESS: '3014F711A0001F:0',
        TYPE: 'MAINTENANCE',
        PARENT: '3014F711A0001F',
        PARENT_TYPE: 'HmIP-eTRV-2',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 34,
    },
    {
        ADDRESS: '3014F711A0001F:1',
        TYPE: 'HEATING_CLIMATECONTROL_TRANSCEIVER',
        PARENT: '3014F711A0001F',
        PARENT_TYPE: 'HmIP-eTRV-2',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 2,
        LINK_TARGET_ROLES: 'THERMALCONTROL_TRANSMIT',
        FLAGS: 1,
        VERSION: 34,
    },
    {
        ADDRESS: '0001D8A9B7C6D5',
        TYPE: 'HmIP-WRC2',
        SUBTYPE: 'WRC2',
        PARENT: '',
        CHILDREN: ['0001D8A9B7C6D5:0', '0001D8A9B7C6D5:1', '0001D8A9B7C6D5:2'],
        PARAMSETS: ['MASTER'],
        FIRMWARE: '1.2.6',
        VERSION: 10,
        FLAGS: 1,
        RX_MODE: 8,
        INTERFACE: 'HmIP-RF',
    },
    {
        ADDRESS: '0001D8A9B7C6D5:0',
        TYPE: 'MAINTENANCE',
        PARENT: '0001D8A9B7C6D5',
        PARENT_TYPE: 'HmIP-WRC2',
        PARAMSETS: ['MASTER', 'VALUES'],
        INDEX: 0,
        DIRECTION: 0,
        FLAGS: 3,
        VERSION: 10,
    },
    {
        ADDRESS: '0001D8A9B7C6D5:1',
        TYPE: 'KEY_TRANSCEIVER',
        PARENT: '0001D8A9B7C6D5',
        PARENT_TYPE: 'HmIP-WRC2',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 1,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 10,
    },
    {
        ADDRESS: '0001D8A9B7C6D5:2',
        TYPE: 'KEY_TRANSCEIVER',
        PARENT: '0001D8A9B7C6D5',
        PARENT_TYPE: 'HmIP-WRC2',
        PARAMSETS: ['MASTER', 'LINK', 'VALUES'],
        INDEX: 2,
        DIRECTION: 1,
        LINK_SOURCE_ROLES: 'SWITCH',
        FLAGS: 1,
        VERSION: 10,
    },
];

/** The devices of one demo interface, as `devices.list` would answer. */
export const DEMO_DEVICES: Readonly<Record<DemoInterfaceName, DeviceDescription[]>> = {
    'BidCos-RF': BIDCOS_DEVICES,
    'HmIP-RF': HMIP_DEVICES,
};

/** Friendly names as ReGa would deliver them; a few addresses deliberately have none. */
export const DEMO_NAMES: NameMap = {
    'BidCoS-RF': 'CCU',
    MEQ0123456: 'Licht Küche',
    'MEQ0123456:1': 'Licht Küche:1',
    JEQ0234567: 'Taster Flur',
    'JEQ0234567:1': 'Taster Flur:1',
    'JEQ0234567:2': 'Taster Flur:2',
    KEQ0345678: 'Thermostat Bad',
    'KEQ0345678:4': 'Thermostat Bad:4',
    LEQ0456789: 'Fenster Schlafzimmer',
    'LEQ0456789:1': 'Fenster Schlafzimmer:1',
    GEQ0567890: 'Dimmer Wohnzimmer',
    'GEQ0567890:1': 'Dimmer Wohnzimmer:1',
    '000A1B2C3D4E5F': 'Schaltaktor Terrasse',
    '000A1B2C3D4E5F:4': 'Schaltaktor Terrasse:4',
    '0011D3C9A1B2C3': 'Fenster Arbeitszimmer',
    '3014F711A0001F': 'Heizung Arbeitszimmer',
    '0001D8A9B7C6D5': 'Wandtaster Diele',
};

export const DEMO_LINKS: Readonly<Record<DemoInterfaceName, LinkRecord[]>> = {
    'BidCos-RF': [
        {
            SENDER: 'JEQ0234567:1',
            RECEIVER: 'MEQ0123456:1',
            NAME: 'Taster Flur - Licht Küche',
            DESCRIPTION: 'Standardverknüpfung Taster - Schaltaktor',
            FLAGS: 0,
        },
        {
            SENDER: 'JEQ0234567:2',
            RECEIVER: 'GEQ0567890:1',
            NAME: 'Taster Flur - Dimmer Wohnzimmer',
            DESCRIPTION: 'Dimmer - ein/aus & heller/dunkler',
            FLAGS: 0,
        },
    ],
    'HmIP-RF': [
        {
            SENDER: '0001D8A9B7C6D5:1',
            RECEIVER: '000A1B2C3D4E5F:4',
            NAME: 'Wandtaster Diele - Schaltaktor Terrasse',
            DESCRIPTION: '',
            FLAGS: 0,
        },
    ],
};

export const DEMO_SERVICE_MESSAGES: ServiceMessage[] = [
    {
        interfaceName: 'BidCos-RF',
        address: 'LEQ0456789:0',
        datapoint: 'LOWBAT',
        value: true,
        since: Date.parse('2026-09-04T18:22:00Z'),
    },
    {
        interfaceName: 'BidCos-RF',
        address: 'KEQ0345678:0',
        datapoint: 'STICKY_UNREACH',
        value: true,
        since: Date.parse('2026-09-05T06:14:00Z'),
    },
];

export const DEMO_RSSI: Readonly<Record<DemoInterfaceName, RssiInfo>> = {
    'BidCos-RF': {
        MEQ0123456: {'BidCoS-RF': [-52, -56], JEQ0234567: [-70, 65_536]},
        JEQ0234567: {'BidCoS-RF': [-60, -36]},
        KEQ0345678: {'BidCoS-RF': [-88, -91]},
        LEQ0456789: {'BidCoS-RF': [-112, 65_536]},
        GEQ0567890: {'BidCoS-RF': [-47, -45]},
    },
    'HmIP-RF': {},
};

export const DEMO_BIDCOS_INTERFACES: BidcosInterfaceInfo[] = [
    {
        ADDRESS: 'BidCoS-RF',
        TYPE: 'CCU2',
        DESCRIPTION: 'CCU2-Coprocessor',
        CONNECTED: true,
        DEFAULT: true,
        DUTY_CYCLE: 1,
        FIRMWARE_VERSION: '2.8.6',
    },
];

export const DEMO_INTERFACE_STATES: InterfaceState[] = [
    {
        name: 'BidCos-RF',
        type: 'BidCos-RF',
        protocol: 'xmlrpc',
        host: 'demo.local',
        port: 2001,
        connected: true,
        lastEvent: Date.parse('2026-09-05T09:59:30Z'),
    },
    {
        name: 'HmIP-RF',
        type: 'HmIP-RF',
        protocol: 'xmlrpc',
        host: 'demo.local',
        port: 2010,
        connected: true,
        lastEvent: Date.parse('2026-09-05T09:59:12Z'),
    },
];

export const DEMO_REGA_STATE: RegaState = {
    enabled: true,
    reachable: true,
    names: Object.keys(DEMO_NAMES).length,
};

export const DEMO_CONNECTION: ConnectionConfig = {
    host: 'demo.local',
    interfaces: [...DEMO_INTERFACE_NAMES],
    autoDetect: true,
    extraInterfaces: [],
    tls: false,
    rega: true,
    callback: {ip: '192.168.1.20', xmlrpcPort: 0, binrpcPort: 0},
    language: 'de',
    writePaceMs: 250,
    rpcLogFolder: '',
};

export const DEMO_CONFIG: AppConfig = {
    version: '3.0.0-dev.0',
    connection: DEMO_CONNECTION,
    localAddresses: ['192.168.1.20', '10.0.0.5'],
    discovered: [
        {
            address: 'demo.local',
            name: 'Demo-CCU',
            serial: 'KEQ0000001',
            firmware: '3.89.8',
            interfaces: [...DEMO_INTERFACE_NAMES],
        },
    ],
};

export const DEMO_EVENTS: EventRecord[] = [
    {
        timestamp: Date.parse('2026-09-05T09:58:41Z'),
        interfaceName: 'BidCos-RF',
        method: 'event',
        address: 'JEQ0234567:1',
        datapoint: 'PRESS_SHORT',
        value: true,
    },
    {
        timestamp: Date.parse('2026-09-05T09:58:41Z'),
        interfaceName: 'BidCos-RF',
        method: 'event',
        address: 'MEQ0123456:1',
        datapoint: 'STATE',
        value: true,
    },
    {
        timestamp: Date.parse('2026-09-05T09:59:12Z'),
        interfaceName: 'HmIP-RF',
        method: 'event',
        address: '0011D3C9A1B2C3:1',
        datapoint: 'STATE',
        value: 1,
    },
    {
        timestamp: Date.parse('2026-09-05T09:59:30Z'),
        interfaceName: 'BidCos-RF',
        method: 'event',
        address: 'KEQ0345678:4',
        datapoint: 'ACTUAL_TEMPERATURE',
        value: 21.5,
    },
];

export const DEMO_WRITE_LOG: WriteLogEntry[] = [
    {
        id: 1,
        timestamp: Date.parse('2026-09-05T09:57:02Z'),
        interfaceName: 'BidCos-RF',
        method: 'putParamset',
        params: ['MEQ0123456:1', 'MASTER', {LOGGING: 1}],
        ok: true,
        result: '',
        durationMs: 184,
    },
    {
        id: 2,
        timestamp: Date.parse('2026-09-05T09:57:44Z'),
        interfaceName: 'HmIP-RF',
        method: 'putParamset',
        params: ['000A1B2C3D4E5F:4', 'MASTER', {PROFILE_MODE: 3}],
        ok: false,
        error: 'Unknown parameter PROFILE_MODE',
        durationMs: 902,
    },
];

/** A short method catalogue so the console tab has something to show before task 8 fills it. */
export const DEMO_RPC_METHODS: RpcMethodInfo[] = [
    {name: 'listDevices', help: 'Returns the device descriptions of the interface.', params: []},
    {
        name: 'getParamset',
        help: 'Reads a paramset of a device or channel.',
        params: [
            {name: 'address', type: 'String'},
            {name: 'paramsetKey', type: 'String', values: ['MASTER', 'VALUES']},
        ],
    },
    {
        name: 'setValue',
        help: 'Writes one value of the VALUES paramset.',
        params: [
            {name: 'address', type: 'String'},
            {name: 'valueKey', type: 'String'},
            {name: 'value', type: 'Any'},
        ],
    },
    {name: 'rssiInfo', help: 'Returns the RSSI matrix.', params: []},
];

/** Events the demo mode fires on a timer so the events tab moves without a CCU. */
export const DEMO_EVENT_SCRIPT: ReadonlyArray<Omit<EventRecord, 'timestamp'>> = [
    {interfaceName: 'BidCos-RF', method: 'event', address: 'JEQ0234567:1', datapoint: 'PRESS_SHORT', value: true},
    {interfaceName: 'BidCos-RF', method: 'event', address: 'MEQ0123456:1', datapoint: 'STATE', value: true},
    {interfaceName: 'BidCos-RF', method: 'event', address: 'MEQ0123456:1', datapoint: 'STATE', value: false},
    {
        interfaceName: 'BidCos-RF',
        method: 'event',
        address: 'KEQ0345678:4',
        datapoint: 'ACTUAL_TEMPERATURE',
        value: 21.7,
    },
    {interfaceName: 'HmIP-RF', method: 'event', address: '0011D3C9A1B2C3:1', datapoint: 'STATE', value: 0},
    {interfaceName: 'HmIP-RF', method: 'event', address: '3014F711A0001F:1', datapoint: 'LEVEL', value: 0.35},
    {interfaceName: 'BidCos-RF', method: 'event', address: 'GEQ0567890:1', datapoint: 'LEVEL', value: 0.9},
];

/** Is this one of the two interfaces the fixture knows? */
export function isDemoInterface(name: string): name is DemoInterfaceName {
    return (DEMO_INTERFACE_NAMES as readonly string[]).includes(name);
}

/**
 * Paramset descriptions per channel type, so the paramset editor, the link editor and the write
 * preview can be operated in demo mode and asserted in a test.
 *
 * They are plausible, not dumps: a `SWITCH` really does have `LOGGING`, `TRANSMIT_TRY_MAX` and an
 * `ON_TIME` with a `NOT_USED` special (the 111600 of issue #96), and that is the point - the shapes
 * the editor has to render (bool, enum, integer with bounds, float with a unit, a `SPECIAL` value,
 * a read-only datapoint) are all here.
 */
export const DEMO_DESCRIPTIONS: Readonly<Record<string, ParamsetDescription>> = {
    'SWITCH|MASTER': {
        LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, FLAGS: 1, VALUE_LIST: ['OFF', 'ON'], DEFAULT: 1, TAB_ORDER: 1},
        TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 3, FLAGS: 1, MIN: 1, MAX: 10, DEFAULT: 6, TAB_ORDER: 2},
        ON_TIME: {
            TYPE: 'FLOAT',
            OPERATIONS: 3,
            FLAGS: 1,
            MIN: 0,
            MAX: 8590,
            UNIT: 's',
            DEFAULT: 0,
            TAB_ORDER: 3,
            SPECIAL: [{ID: 'NOT_USED', VALUE: 111_600}],
        },
        STATUSINFO_MINDELAY: {TYPE: 'INTEGER', OPERATIONS: 3, FLAGS: 1, MIN: 0, MAX: 15, DEFAULT: 2, TAB_ORDER: 4},
    },
    'SWITCH|VALUES': {
        STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, TAB_ORDER: 1},
        WORKING: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 1, DEFAULT: false, TAB_ORDER: 2},
        INHIBIT: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, TAB_ORDER: 3},
    },
    'DIMMER|MASTER': {
        LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, FLAGS: 1, VALUE_LIST: ['OFF', 'ON'], DEFAULT: 1, TAB_ORDER: 1},
        DIM_STEP: {TYPE: 'FLOAT', OPERATIONS: 3, FLAGS: 1, MIN: 0, MAX: 1, UNIT: '100%', DEFAULT: 0.05, TAB_ORDER: 2},
    },
    'DIMMER|VALUES': {
        LEVEL: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, MIN: 0, MAX: 1, UNIT: '100%', DEFAULT: 0, TAB_ORDER: 1},
        WORKING: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 1, DEFAULT: false, TAB_ORDER: 2},
    },
    'KEY|MASTER': {
        LONG_PRESS_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, FLAGS: 1, MIN: 0.3, MAX: 1.8, UNIT: 's', DEFAULT: 0.4},
        DBL_PRESS_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, FLAGS: 1, MIN: 0, MAX: 1.5, UNIT: 's', DEFAULT: 0},
    },
    'KEY|VALUES': {
        PRESS_SHORT: {TYPE: 'ACTION', OPERATIONS: 6, FLAGS: 1},
        PRESS_LONG: {TYPE: 'ACTION', OPERATIONS: 6, FLAGS: 1},
    },
    'SWITCH_VIRTUAL_RECEIVER|MASTER': {
        LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, FLAGS: 1, VALUE_LIST: ['OFF', 'ON'], DEFAULT: 1},
    },
    'SWITCH_VIRTUAL_RECEIVER|LINK': {
        SHORT_ON_TIME: {
            TYPE: 'FLOAT',
            OPERATIONS: 3,
            FLAGS: 1,
            MIN: 0,
            MAX: 8590,
            UNIT: 's',
            DEFAULT: 111_600,
            SPECIAL: [{ID: 'NOT_USED', VALUE: 111_600}],
        },
        SHORT_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, FLAGS: 1, MIN: 0, MAX: 1, UNIT: '100%', DEFAULT: 1},
        SHORT_ACTION_TYPE: {
            TYPE: 'ENUM',
            OPERATIONS: 3,
            FLAGS: 1,
            VALUE_LIST: ['INACTIVE', 'JUMP_TO_TARGET', 'TOGGLE_TO_COUNTER', 'TOGGLE_INVERSE_TO_COUNTER'],
            DEFAULT: 1,
        },
        UI_HINT: {TYPE: 'STRING', OPERATIONS: 3, FLAGS: 2, DEFAULT: ''},
    },
    'KEY_TRANSCEIVER|LINK': {
        LONG_PRESS_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, FLAGS: 1, MIN: 0.3, MAX: 1.8, UNIT: 's', DEFAULT: 0.4},
    },
    'MAINTENANCE|VALUES': {
        UNREACH: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9, DEFAULT: false},
        STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 9, DEFAULT: false},
        LOWBAT: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9, DEFAULT: false},
    },
    /** A device (not a channel) - keyed by the empty channel type. */
    '|MASTER': {
        ARR_TIMEOUT: {TYPE: 'INTEGER', OPERATIONS: 3, FLAGS: 1, MIN: 1, MAX: 20, DEFAULT: 10},
    },
};

/** Current values per channel type and paramset; anything absent falls back to the DEFAULTs. */
export const DEMO_PARAMSET_VALUES: Readonly<Record<string, Paramset>> = {
    'SWITCH|MASTER': {LOGGING: 1, TRANSMIT_TRY_MAX: 6, ON_TIME: 111_600, STATUSINFO_MINDELAY: 2},
    'SWITCH|VALUES': {STATE: true, WORKING: false, INHIBIT: false},
    'DIMMER|MASTER': {LOGGING: 1, DIM_STEP: 0.05},
    'DIMMER|VALUES': {LEVEL: 0.9, WORKING: false},
    'KEY|MASTER': {LONG_PRESS_TIME: 0.4, DBL_PRESS_TIME: 0},
    'SWITCH_VIRTUAL_RECEIVER|MASTER': {LOGGING: 1},
    'SWITCH_VIRTUAL_RECEIVER|LINK': {
        SHORT_ON_TIME: 111_600,
        SHORT_ON_LEVEL: 1,
        SHORT_ACTION_TYPE: 1,
        UI_HINT: '',
    },
    'KEY_TRANSCEIVER|LINK': {LONG_PRESS_TIME: 0.4},
    'MAINTENANCE|VALUES': {UNREACH: false, STICKY_UNREACH: false, LOWBAT: false},
    '|MASTER': {ARR_TIMEOUT: 10},
};

/** Every demo description by address, so the mock can answer without a device index. */
export function demoChannelType(address: string): string {
    for (const list of Object.values(DEMO_DEVICES)) {
        const found = list.find((device) => device.ADDRESS === address);
        if (found) {
            return found.PARENT === undefined || found.PARENT === '' ? '' : found.TYPE;
        }
    }
    return '';
}

/** What `getParamsetDescription` answers in demo mode; `{}` for a combination nothing describes. */
export function demoDescription(address: string, paramset: string): ParamsetDescription {
    return DEMO_DESCRIPTIONS[`${demoChannelType(address)}|${paramset}`] ?? {};
}

/** What `getParamset` answers in demo mode. */
export function demoParamset(address: string, paramset: string): Paramset {
    return DEMO_PARAMSET_VALUES[`${demoChannelType(address)}|${paramset}`] ?? {};
}

/**
 * The files `data.file` serves in demo mode - a hand-cut corner of `data/dist/` so the metadata
 * layer (parameter order, hidden parameters, option presets, translations) is visible without the
 * 9.2 MB data set.
 */
export const DEMO_DATA_FILES: Readonly<Record<string, unknown>> = {
    'data/manifest.json': {
        generatedAt: '2026-09-05T00:00:00.000Z',
        sources: [{name: 'openccu-data', version: '2026.7.2'}],
        receiverTypes: ['SWITCH_VIRTUAL_RECEIVER'],
        languages: ['de', 'en'],
    },
    'data/receiver-type-aliases.json': {},
    'data/master-metadata.json': {
        SWITCH: {
            channelType: 'SWITCH',
            parameterOrder: ['TRANSMIT_TRY_MAX', 'LOGGING', 'ON_TIME'],
            conditionalVisibility: [{trigger: 'LOGGING', triggerValue: 1, show: ['STATUSINFO_MINDELAY']}],
            optionPresets: {ON_TIME: 'duration'},
        },
    },
    'data/option-presets.json': {
        duration: {
            id: 'duration',
            allowCustom: true,
            presets: [
                {label: '5s', value: 5},
                {label: '30s', value: 30},
                {labelKey: 'not_used', value: 111_600},
            ],
        },
    },
    'data/cross-validations.json': [
        {id: 'onTime', rule: 'lte', paramA: 'STATUSINFO_MINDELAY', paramB: 'TRANSMIT_TRY_MAX', errorKey: 'delay_max'},
    ],
    'data/translations/de.json': {
        language: 'de',
        channelTypes: {SWITCH: 'Schaltaktor'},
        deviceModels: {},
        parameters: {LOGGING: 'Statusmeldungen', 'SWITCH|ON_TIME': 'Einschaltdauer'},
        parameterValues: {'LOGGING|ON': 'an', 'LOGGING|OFF': 'aus'},
        parameterHelp: {LOGGING: '<b>Sendet</b> zyklisch den Status.'},
        uiLabels: {not_used: 'nicht benutzt', delay_max: 'Verzögerung größer als die Sendeversuche'},
    },
    'data/translations/en.json': {
        language: 'en',
        channelTypes: {SWITCH: 'Switch actuator'},
        deviceModels: {},
        parameters: {LOGGING: 'Status messages'},
        parameterValues: {},
        parameterHelp: {},
        uiLabels: {not_used: 'not used', delay_max: 'delay larger than the transmit tries'},
    },
    'data/profiles/SWITCH_VIRTUAL_RECEIVER.json': {
        receiverType: 'SWITCH_VIRTUAL_RECEIVER',
        senders: {
            KEY_TRANSCEIVER: [
                {
                    id: 1,
                    key: 'switch_on',
                    name: {de: 'Einschalten', en: 'Switch on'},
                    description: {de: 'Schaltet ein', en: 'Switches on'},
                    params: {
                        SHORT_ACTION_TYPE: {kind: 'fixed', value: 1},
                        SHORT_ON_LEVEL: {kind: 'fixed', value: 1},
                        SHORT_ON_TIME: {kind: 'fixed', value: 111_600},
                    },
                },
                {
                    id: 2,
                    key: 'staircase',
                    name: {de: 'Treppenhauslicht', en: 'Staircase light'},
                    description: {de: 'Schaltet für eine Zeit ein', en: 'Switches on for a while'},
                    params: {
                        SHORT_ACTION_TYPE: {kind: 'fixed', value: 1},
                        SHORT_ON_LEVEL: {kind: 'fixed', value: 1},
                        SHORT_ON_TIME: {kind: 'range', min: 0, max: 8590, default: 60},
                    },
                },
            ],
        },
        senderMetadata: {
            KEY_TRANSCEIVER: {
                parameterOrder: ['SHORT_ACTION_TYPE', 'SHORT_ON_LEVEL', 'SHORT_ON_TIME'],
                optionPresets: {SHORT_ON_TIME: 'duration'},
            },
        },
    },
    'data/device-icons.json': {},
};
