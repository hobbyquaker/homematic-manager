$(document).ready(function () {

    var socket = io.connect();
    var daemon;
    var config;
    var listDevices;
    var listLinks;
    var regaNames;
    var hash;

    socket.on("connect", function () {
        console.log("connect");
        getConfig();
    });

    function getConfig() {
        socket.emit('getConfig', function (data) {
            config = data;
            $("#select-bidcos-daemon").html('<option value="null">Bitte einen Daemon auswählen</option>');

            hash = window.location.hash.slice(1);

            for (var daemon in config.daemons) {
                $("#select-bidcos-daemon").append('<option value="' + daemon + '"' + (hash == daemon ? ' selected' : '') + '>' + daemon + ' (' + config.daemons[daemon].type + ' ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ')</option>');
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
        $("#select-bidcos-daemon").change(function () {
            initDaemon();
        });

        $('body').on('click', 'button.paramset', function () {
            var tmp = $(this).attr("id").split("_");
            var address = tmp[1];
            var paramset = tmp[2];
            socket.emit('rpc', 'getParamset', [address, paramset], function (err, data) {
                // TODO catch errors
                socket.emit('rpc', 'getParamsetDescription', [address, paramset], function (err2, data2) {
                    console.log(data, data2);
                    // TODO catch errors
                    paramsetDialog(data, data2, address, paramset);
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
        daemon = $("#select-bidcos-daemon option:selected").val();
        if (daemon != 'null') {
            window.location.hash = '#' + daemon;
            $('#grid-devices').jqGrid('clearGridData');
            if (daemon !== 'null') {
                $('#load_grid-devices').show();
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

                console.log(elem, param);

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
        console.log(address, paramset, values);
        socket.emit('rpc', 'putParamset', [address, paramset, values], function (err, res) {
            // Todo catch errors
        });
    }

    function paramsetDialog(data, desc, address, paramset) {

        // Tabelle befüllen
        $('#table-paramset').html('<tr><th>Param</th><th>Value</th><th>Default</th><th></th></tr>');
        for (var param in data) {

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
                switch (desc[param].TYPE) {
                    case "BOOL":
                        input = '<input id="paramset-input-' + param + '" type="checkbox" value="true"' + (data[param] ? ' checked="checked"' : '') + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case "INTEGER":
                        input = '<input data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="number" min="' + desc[param].MIN + '" max="' + desc[param].MAX + '" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    case "ENUM":
                        input = '<select id="paramset-input-' + param + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                        for (var i = desc[param].MIN; i <= desc[param].MAX; i++) {
                            input += '<option value="' + i + '">' + desc[param].VALUE_LIST[i] + '</option>';
                        }
                        input += '</select>';
                        break;
                    case "FLOAT":
                    default:
                        input = '<input data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                }

                // Paramset VALUES?
                if (paramset == 'VALUES' && (desc[param].OPERATIONS & 2)) {
                    $('#table-paramset').append('<tr><td>' + param + '</td><td>' + input + '</td><td>' + desc[param].DEFAULT + '</td><td><button class="paramset-setValue" id="paramset-setValue-' + param + '">setValue</button></td></tr>');
                } else {
                    $('#table-paramset').append('<tr><td>' + param + '</td><td>' + input + '</td><td colspan="2">' + desc[param].DEFAULT + '</td></tr>');
                }

            } else {
                $('#table-paramset').append('<tr><td>' + param + '</td><td colspan = "3">' + data[param] + '</td></tr>');
            }

        }


        // Dialog-Überschrift setzen
        if (regaNames && regaNames[config.daemons[daemon].ip]) {
            var names = regaNames[config.daemons[daemon].ip];
        }
        var name = names[address].Name || "";

        $('div[aria-describedby="dialog-paramset"] span.ui-dialog-title').html(name + ' PARAMSET ' + address + ' ' + paramset);

        // Hidden-Hilfsfelder
        $('#edit-paramset-address').val(address);
        $('#edit-paramset-paramset').val(paramset);

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
                $('#grid-devices').jqGrid('addRowData', i, listDevices[i]);
            }
        }
        $('#grid-devices').trigger('reloadGrid');
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
            $('#grid-links').jqGrid('addRowData', i, listLinks[i]);
        }
        $('#grid-links').trigger('reloadGrid');
    }


    //
    //      initialize UI elements
    //

    // Dialogs
    $('#dialog-paramset').dialog({
        autoOpen: false,
        modal: true,
        width: 640,
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
        }
    });

    // Geräte-Tabelle
    $('#grid-devices').jqGrid({
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
        shrinkToFit: true

    })
    .navGrid('#pager-devices')
    .jqGrid('filterToolbar',{
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    });

    // Direktverknüpfungs-Tabelle
    $('#grid-links').jqGrid({
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
        rowNum:     10,
        autowidth:  true,
        width:      '100%',
        rowList:    [10,20,30],
        pager:      $('#pager-links'),
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  'desc',
        caption:    'Direktverknüpfungen'
    })
    .navGrid('#pager-links')
    .jqGrid('filterToolbar',{
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
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
            shrinkToFit: true
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
                    if (listDevices[i].PARAMSETS[j] == "LINK") continue;
                    var idButton = 'paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j];
                    paramsets += '<button class="paramset" id="' + idButton + '">' + listDevices[i].PARAMSETS[j] + '</button>';
                }
                listDevices[i].params = paramsets;
                $('#' + subgrid_table_id).jqGrid('addRowData', i, listDevices[i]);
            }
        }
    }

    $('.ui-jqgrid-titlebar-close').hide();

    function resizeGrids() {
        var x = $(window).width();
        var y = $(window).height();
        if (x < 1024) x = 1024;
        if (y < 640) y = 640;

        $('#grid-devices, #grid-links').setGridHeight(y - 186).setGridWidth(x - 60);
    }

    //Konsole
    $('#btncommand').button();
    $('#btncommand').click(function() {
        console.log($('#txtcommand').val());
        socket.emit('rpc', $('#txtcommand').val(), [], function (err, data) {
            $('#txtcmdanswer').val(JSON.stringify(data));
        });
    });

    $(window).resize(function() {
        resizeGrids();
    });

    resizeGrids();

    window.onhashchange = function () {
        hash = window.location.hash.slice(1);
        console.log(hash);
        console.log(config.daemons);
        if (config.daemons[hash]) {
            if (daemon != hash) {
                daemon = hash;
                $('#select-bidocs-daemon option').removeAttr('selected');
                $('#select-bidcos-daemon option[value="' + daemon + '"]').attr('selected', true);
                initDaemon();
            }
        } else {
            daemon = null;
            $('#select-bidocs-daemon option').removeAttr('selected');
            initDaemon();
        }

    }

});