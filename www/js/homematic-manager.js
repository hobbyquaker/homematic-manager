$(document).ready(function () {

    var socket = io.connect();
    var daemon;
    var config;
    var listDevices;
    var listLinks;
    var regaNames;
    var hash;

    var rpcMethods = {
        abortDeleteDevice: {
            rfd: true,
            hs485d: false,
            params: [
                { name: 'address', type: 'address' }
            ]
        },
        activateLinkParamset: {
            rfd: true,
            hs485d: false,
            params: [
                // String address, String peer_address, Boolean long_press
                { name: 'address', type: 'address' },
                { name: 'peer_address', type: 'address' },
                { name: 'long_press', type: 'boolean' }
            ]
        },
        addDevice: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        addLink: {
            rfd: true,
            hs485d: true,
            params: [
                // String sender, String receiver, String name, String description
                { name: 'sender', type: 'address' },
                { name: 'receiver', type: 'address' },
                { name: 'name', type: 'string', optional: ['rfd', 'hs485d'] },
                { name: 'description', type: 'string', optional: ['rfd', 'hs485d'] }
            ]
        },
        changekey: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        clearConfigCache: {
            rfd: true,
            hs485d: true,
            params: [
            ]
        },
        deleteDevice: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                {
                    name: 'flags',
                    type: 'integer',
                    bitmask: {
                        '1': 'DELETE_FLAG_RESET',
                        '2': 'DELETE_FLAG_FORCE',
                        '4': 'DELETE_FLAG_DEFER'
                    }
                }
            ]
        },
        determineParameter: {
            rfd: true,
            hs485d: false,
            params: [
                // String address, String paramset_key, String parameter_id
                { name: 'address', type: 'address' },
                { name: 'paramset_key', type: 'string' },
                { name: 'parameter_id', type: 'string' }
            ]
        },
        getDeviceDescription: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' }
            ]
        },
        getInstallMode: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        getKeyMismatchDevice: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        getLinkInfo: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'sender', type: 'address' },
                { name: 'receiver', type: 'address' }
            ]
        },
        getLinkPeers: {
            rfd: true,
            hs485d: true,
            params: [
            ]
        },
        getLinks: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
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
            ]
        },
        getParamset: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'paramset_key', type: 'string' },
                { name: 'mode', type: 'integer', optional: ['rfd'] }
            ]
        },
        getParamsetDescription: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'paramset_type', type: 'string' }
            ]
        },
        getParamsetId: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'type', type: 'string' }
            ]
        },
        getValue: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'address' },
                { name: 'value_key', type: 'string' },
                { name: 'mode', type: 'integer', optional: ['rfd'] }
            ]
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
            params: [
            ]
        },
        listDevices: {
            rfd: true,
            hs485d: true,
            params: []
        },
        listTeams: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        logLevel: {
            rfd: true,
            hs485d: true,
            params: [
            ]
        },
        putParamset: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'string' },
                { name: 'paramset_key', type: 'string' },
                { name: 'set', type: 'paramset' }
            ]
        },
        removeLink: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'sender', type: 'address' },
                { name: 'receiver', type: 'address' }
            ]
        },
        reportValueUsage: {
            rfd: true,
            hs485d: true,
            params: [
            ]
        },
        restoreConfigToDevice: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        rssiInfo: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        searchDevices: {
            rfd: false,
            params: [
            ],
            hs485d: true,
            params: [
            ]
        },
        setInstallMode: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        setLinkInfo: {
            rfd: true,
            hs485d: true,
            params: [
                // String sender, String receiver, String name,  String description
                { name: 'sender', type: 'address' },
                { name: 'receiver', type: 'address' },
                { name: 'name', type: 'string' },
                { name: 'description', type: 'string' }
            ]
        },
        setTeam: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        setTempKey: {
            rfd: true,
            hs485d: false,
            params: [
            ]
        },
        setValue: {
            rfd: true,
            hs485d: true,
            params: [
                { name: 'address', type: 'string' },
                { name: 'value_key', type: 'string' },
                { name: 'value', type: 'mixed' }
            ]
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
            ]
        }
    };

    socket.on('connect', function () {
        console.log('connect');
        getConfig();
    });

    function getConfig() {
        socket.emit('getConfig', function (data) {
            config = data;
            $('#select-bidcos-daemon').html('<option value="null">Bitte einen Daemon auswählen</option>');

            hash = window.location.hash.slice(1);

            for (var daemon in config.daemons) {
                $('#select-bidcos-daemon').append('<option value="' + daemon + '"' + (hash == daemon ? ' selected' : '') + '>' + daemon + ' (' + config.daemons[daemon].type + ' ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ')</option>');
            }
            $('#select-bidcos-daemon').multiselect('refresh');
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
            socket.emit('rpc', 'getParamset', [address, paramset], function (err, data) {
                // TODO catch errors
                socket.emit('rpc', 'getParamsetDescription', [address, paramset], function (err2, data2) {
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

            socket.emit('rpc', 'setValue', [address, param, val], function (err, res) {
                // TODO catch errors
                console.log(err);
                console.log(res);
            });
        });

        $('body').on('click', 'button.deletelink', function () {
            var tmp = $(this).attr("id").split("_");
            var sender = tmp[1];
            var receiver = tmp[2];
            deleteLinkDialog(sender, receiver, $(this).attr("params"));
        });
    }

    function initDaemon() {
        daemon = $('#select-bidcos-daemon option:selected').val();
        $gridDevices.jqGrid('clearGridData');
        $gridLinks.jqGrid('clearGridData');
        $("#del-device").addClass("ui-state-disabled");
        if (daemon != 'null') {
            window.location.hash = '#' + daemon;
            if (daemon !== 'null') {
                $('#load_grid-devices').show();
                $('#load_grid-links').show();
                socket.emit('bidcosConnect', daemon, function () {
                    socket.emit('rpc', 'listDevices', [], function (err, data) {
                        listDevices = data;
                        buildGridDevices();
                    });
                    socket.emit('rpc', 'getLinks', [], function (err, data) {
                        listLinks = data;
                        buildGridLinks();
                    });
                });
            }
        } else {
            window.location.hash = '';
        }
        buildRpcSelect();
    }

    function putParamset() {
        var address = $('#edit-paramset-address').val();
        var paramset = $('#edit-paramset-paramset').val();
        var values = {};
        $('[id^="paramset-input"]').each(function () {
            var $input = $(this);
            if (!$input.is(':disabled')) {
                var parts = $input.attr('id').split('-', 3);
                var param = parts[2];
                var elem = $input[0].nodeName;
                var type = $input.attr('type');

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

                values[param] = val;
            }
        });
        socket.emit('rpc', 'putParamset', [address, paramset, values], function (err, res) {
            // Todo catch errors
        });
    }

    function paramsetDialog(data, desc, address, paramset) {

        // Tabelle befüllen
        $('#table-paramset').html('<tr><th>Param</th><th>Value</th><th>Default</th><th></th></tr>');
        var count = 0;
        for (var param in data) {
            count += 1;
            if (desc[param]) {
                // Dirty workaround for encoding problem
                if (desc[param].UNIT == '�C') desc[param].UNIT = '°C';

                // Calculate percent values
                if (desc[param].UNIT == '100%') {
                    var unit = '%';
                    data[param] *= 100;
                } else {
                    var unit = desc[param].UNIT;
                }

                // Create Input-Field
                var input;
                var defaultVal = desc[param].DEFAULT;
                switch (desc[param].TYPE) {
                    case 'BOOL':
                        input = '<input id="paramset-input-' + param + '" type="checkbox" value="true"' + (data[param] ? ' checked="checked"' : '') + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case 'INTEGER':
                        input = '<input data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="number" min="' + desc[param].MIN + '" max="' + desc[param].MAX + '" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    case 'ENUM':
                        input = '<select id="paramset-input-' + param + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                        for (var i = desc[param].MIN; i <= desc[param].MAX; i++) {
                            input += '<option value="' + i + '"' + (data[param] == i ? ' selected="selected"' : '') + '>' + desc[param].VALUE_LIST[i] + '</option>';
                        }
                        input += '</select>';
                        defaultVal = desc[param].VALUE_LIST[defaultVal];
                        break;
                    case 'FLOAT':
                    default:
                        input = '<input data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                }

                // Paramset VALUES?
                if (paramset == 'VALUES' && (desc[param].OPERATIONS & 2)) {
                    $('#table-paramset').append('<tr><td>' + param + '</td><td>' + input + '</td><td>' + desc[param].DEFAULT + '</td><td><button class="paramset-setValue" id="paramset-setValue-' + param + '">setValue</button></td></tr>');
                } else {
                    $('#table-paramset').append('<tr><td>' + param + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + '</td></tr>');
                }

            } else {
                $('#table-paramset').append('<tr><td>' + param + '</td><td colspan = "3">' + data[param] + '</td></tr>');
            }

        }

        if (count == 0) {
            $('#table-paramset').remove();
        }

        // Dialog-Überschrift setzen
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        var name = names[address].Name || '';

        $('div[aria-describedby="dialog-paramset"] span.ui-dialog-title').html(name + ' PARAMSET ' + address + ' ' + paramset);

        // Hidden-Hilfsfelder
        $('#edit-paramset-address').val(address);
        $('#edit-paramset-paramset').val(paramset);

        // Buttons
        $('button.paramset-setValue:not(.ui-button)').button();

        $('#dialog-paramset').dialog('open');
    }

    function deleteLinkDialog(sender, receiver, params) {

        // Dialog-Überschrift setzen
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        var sendername = names[sender].Name || "";
        var receivername = names[receiver].Name || "";
        var arrparams = JSON.parse(params);

        $('div[aria-describedby="dialog-paramset"] span.ui-dialog-title').html('Verknüpfung zwischen ' + sender + ' und ' + receiver + ' löschen');

        $('#table-deletelink').html('<tr><td>Sender:</td><td>' + sender + ' (' + sendername + ')</td></tr>');
        $('#table-deletelink').append('<tr><td>Empfänger:</td><td>' + receiver + ' (' + receivername + ')</td></tr>');
        $('#table-deletelink').append('<tr><td>Name:</td><td>' + arrparams.NAME + '</td></tr>');
        $('#table-deletelink').append('<tr><td>Beschreibung:</td><td>' + arrparams.DESCRIPTION + '</td></tr>');

        // Hidden-Hilfsfelder
        $('#deletelink-sender').val(sender);
        $('#deletelink-receiver').val(receiver);

        $('#dialog-deletelink').dialog('open');
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
            var actions = '<button class="editlink" id="action-editlink_' + listLinks[i].SENDER + '_' + listLinks[i].RECEIVER + '" params=\'' + JSON.stringify(listLinks[i]) + '\'>bearbeiten</button>';
            actions += '<button class="deletelink" id="action-deletelink_' + listLinks[i].SENDER + '_' + listLinks[i].RECEIVER + '" params=\'' + JSON.stringify(listLinks[i]) + '\'>löschen</button>';
            listLinks[i].ACTIONS = actions;
            $gridLinks.jqGrid('addRowData', i, listLinks[i]);
        }
        $gridLinks.trigger('reloadGrid');
    }


    //
    //      initialize UI elements
    //

    // Dialogs
    $('#dialog-paramset').dialog({
        autoOpen: false,
        params: [
        ],
        modal: true,
        width: 720,
        height: 400,
        buttons: [
            {
                text: 'putParamset',
                click: function () {
                    putParamset();
                }
            }
        ]
    });
    $('#dialog-deletelink').dialog({
        autoOpen: false,
        params: [
        ],
        modal: true,
        width: 640,
        height: 400,
        buttons: [
            {
                text: 'löschen',
                click: function () {
                    deleteLink();
                }
            }
        ]
    });

    // Tabs
    $('#tabs-main').tabs({
        create: function () {
            $('#tabs-main ul.ui-tabs-nav').prepend('<li><select id="select-bidcos-daemon"></select></li>');
            $('#tabs-main ul.ui-tabs-nav').prepend('<li class="header">HomeMatic-Manager</li>');
            $('#select-bidcos-daemon').multiselect({
                classes: 'select-daemon',
                multiple: false,
                header: false,
                selectedList: 1
            });

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

            });

            $('#button-config').button({
                text: false,
                icons: {
                    primary: 'ui-icon-gear'
                }
            }).click(function () {

            });

        }
    });



    // Geräte-Tabelle
    var $gridDevices = $('#grid-devices');
    $gridDevices.jqGrid({
        colNames: ['Name', 'ADDRESS', 'FIRMWARE', 'FLAGS', 'INTERFACE', 'RF_ADDRESS', 'PARAMSETS', 'ROAMING', 'RX_MODE', 'TYPE', 'VERSION'],
        colModel: [
            {name:'Name', index: 'Name', width: 100},
            {name:'ADDRESS',index:'ADDRESS', width:70},
            {name:'FIRMWARE',index:'FIRMWARE', width:50},
            {name:'flags',index:'FLAGS', width:50},
            {name:'INTERFACE',index:'INTERFACE', width:70},
            {name:'RF_ADDRESS',index:'RF_ADDRESS', width:70},
            {name:'params',index:'params', width:70},
            {name:'ROAMING',index:'ROAMING', width:70},
            {name:'rx_mode',index:'RX_MODE', width:70},
            {name:'TYPE',index:'TYPE', width:100},
            {name:'VERSION',index:'VERSION', width:50}
        ],
        datatype:   'local',
        rowNum:     25,
        autowidth:  true,
        width:      '100%',
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
        //shrinkToFit: true,
        onSelectRow: function (rowid, iRow, iCol, e) {
            $("#del-device").removeClass("ui-state-disabled");
        },
        gridComplete: function () {
            $("#del-device").addClass("ui-state-disabled");
        }
    }).navGrid('#pager-devices', {
        search: false,
        edit: false,
        add: false,
        del: false,
        refresh: false
    }).jqGrid('navButtonAdd', "#pager-devices", {
        caption:"",
        buttonicon:"ui-icon-calculator",
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
                }

            });
        },
        position: "first",
        id:"choose-columns",
        title:"Geräte löschen",
        cursor: "pointer"
    }).jqGrid('navButtonAdd', "#pager-devices", {
        caption:"",
        buttonicon:"ui-icon-trash",
        onClickButton: function () {
            var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
            alert('del ' + address);
        },
        position: "first",
        id:"del-device",
        title:"Geräte löschen",
        cursor: "pointer"
    }).jqGrid('navButtonAdd', "#pager-devices", {
        caption:"",
        buttonicon:"ui-icon-plus",
        onClickButton: function () {
            alert('add');
        },
        position: "first",
        id: "add-device",
        title:"Geräte anlernen",
        cursor: "pointer"
    }).jqGrid('filterToolbar', {
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    });

    $('#del-device').addClass('ui-state-disabled');



    // Direktverknüpfungs-Tabelle
    var $gridLinks = $('#grid-links');
    $gridLinks.jqGrid({
        colNames:['Sendername', 'Address', 'Receivername', 'Address-Partner', 'Name', 'Description', 'Aktionen'],
        colModel:[
            {name:'Sendername', index:'Sendername', width:100},
            {name:'SENDER', index:'SENDER', width:50},
            {name:'Receivername', index:'Receivername', width:100},
            {name:'RECEIVER', index:'RECEIVER', width:50},
            {name:'NAME', index:'NAME', width:150},
            {name:'DESCRIPTION', index:'DESCRIPTION', width:150},
            {name:'ACTIONS', index:'ACTIONS', width:80}
        ],
        rowNum:     25,
        autowidth:  true,
        width:      '100%',
        rowList:    [25, 50, 100, 500],
        pager:      $('#pager-links'),
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  'desc',
        caption:    'Direktverknüpfungen'
    }).navGrid('#pager-links')
    .jqGrid('filterToolbar', {
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false,
    });

    function subGridChannels(grid_id, row_id) {
        var subgrid_table_id = 'channels_' + row_id + '_t';
        $('#' + grid_id).html('<table id="' + subgrid_table_id + '"></table>');
        var gridConf = {
            datatype: 'local',
            colNames: [
                'Name',
                'ADDRESS',
                'AES_ACTIVE',
                'DIRECTION',
                'FLAGS',
                'LINK_SOURCE_ROLES',
                'LINK_TARGET_ROLES',
                'PARAMSETS',
                'TYPE',
                'VERSION'
            ],
            colModel: [
                {name: 'Name', index: 'Name', width: 100},
                {name: 'ADDRESS', index: 'ADDRESS', width: 70},
                {name: 'aes_active', index: 'aes_active', width: 50},
                {name: 'direction', index: 'direction', width: 50},
                {name: 'flags', index: 'flags', width: 100},
                {name: 'LINK_SOURCE_ROLES', index: 'LINK_SOURCE_ROLES', width: 100, hidden: true},
                {name: 'LINK_TARGET_ROLES', index: 'LINK_TARGET_ROLES', width: 100, hidden: true},
                {name: 'params', index: 'params', width: 70},
                {name: 'TYPE', index: 'TYPE', width: 100},
                {name: 'VERSION', index: 'VERSION', width: 50}
            ],
            rowNum: 1000000,
            autowidth: true,
            height: 'auto',
            width: 1200,
            sortorder: 'desc',
            viewrecords: true,
            ignoreCase: true,
            shrinkToFit: true,
            beforeSelectRow: function(rowid, e) {
                return false;
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

    $('.ui-jqgrid-titlebar-close').hide();

    function resizeGrids() {
        var x = $(window).width();
        var y = $(window).height();
        if (x < 1200) x = 1200;
        if (y < 600) y = 600;

        $('#grid-devices, #grid-links').setGridHeight(y - 148).setGridWidth(x - 18);
    }

    //Konsole
    var $consoleRpcMethod = $('#console-rpc-method');
    var $consoleRpcSend = $('#console-rpc-send');
    var $consoleRpcResponse = $('#console-rpc-response');

    $consoleRpcMethod.multiselect({
        classes: 'rpc-method',
        multiple: false,
        header: false,
        selectedList: 1
    });

    function buildRpcSelect() {
        $consoleRpcMethod.html('');
        $consoleRpcResponse.html('');
        if (daemon == 'null') {
            $consoleRpcSend.attr('disabled', true).button('refresh');
            return;
        } else {
            $consoleRpcSend.removeAttr('disabled').button('refresh');
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

    $consoleRpcSend
        .attr('disabled', true)
        .button()
        .click(function() {
            var method = $consoleRpcMethod.find('option:selected').val();
            try {
                var params = JSON.parse($('#console-rpc-params').val());
            } catch (e) {
                alert('Parsing params: ' + e);
                return;
            }
            $consoleRpcResponse.html('...');
            console.log('rpc', method, params);
            socket.emit('rpc', method, params, function (err, data) {
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
        console.log(hash);
        console.log(config.daemons);
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