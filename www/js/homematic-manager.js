$(document).ready(function () {

    var socket = io.connect();

    var listDevices;

    socket.on("connect", function () {
        console.log("connect");
        socket.emit("getConfig", function (config) {
            $("#select-bidcos-daemon").html('<option value="null">Bitte einen Daemon auswählen</option>');
            for (var daemon in config.daemons) {
                $("#select-bidcos-daemon").append('<option value="' + daemon + '">' + daemon + ' (' + config.daemons[daemon].type + ' ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ')</option>');
            }
            initHandlers();
        });
    });

    function initHandlers() {
        $("#select-bidcos-daemon").change(function () {
            var daemon = $("#select-bidcos-daemon option:selected").val();
            $("#grid-devices").jqGrid("clearGridData");
            if (daemon !== "null") {
                $("#load_grid-devices").show();
                socket.emit("bidcosConnect", daemon, function () {
                    socket.emit("listDevices", function (err, data) {
                        listDevices = data;
                        console.log(listDevices);
                        buildGridDevices();
                    });
                });
            }
        });
    }

    function buildGridDevices() {
        for (var i = 0, len = listDevices.length; i < len; i++) {
            if (listDevices[i].RF_ADDRESS) {
                listDevices[i].RF_ADDRESS = parseInt(listDevices[i].RF_ADDRESS, 10).toString(16);
            }
            var paramsets = "";
            for (var j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                paramsets += '<button class="paramset" id="paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j] + '">' + listDevices[i].PARAMSETS[j] + '</button>';
            }
            listDevices[i].params = paramsets;
            if (!listDevices[i].PARENT) {
                $("#grid-devices").jqGrid('addRowData', i, listDevices[i]);
            }
        }
        $("#grid-devices").trigger('reloadGrid');
    }

    //
    //      initialize UI elements
    //

    // Tabs
    $("#tabs-main").tabs({
        create: function () {
            $("#tabs-main ul.ui-tabs-nav").prepend('<li><select id="select-bidcos-daemon"></select></li>');
            $("#tabs-main ul.ui-tabs-nav").prepend('<li class="header">HomeMatic-Manager</li>');
        }
    });

    // Geräte-Tabelle
    $("#grid-devices").jqGrid({
        colNames: ['ADDRESS', 'FIRMWARE', 'FLAGS', 'INTERFACE', 'PARENT', 'RF_ADDRESS', 'PARAMSETS', 'ROAMING', 'RX-MODE', 'TYPE', 'VERSION'],
        colModel: [
            {name:'ADDRESS',index:'ADDRESS', width:70},
            {name:'FIRMWARE',index:'FIRMWARE', width:50},
            {name:'FLAGS',index:'FLAGS', width:50},
            {name:'INTERFACE',index:'INTERFACE', width:70},
            {name:'PARENT',index:'PARENT', width:70},
            {name:'RF_ADDRESS',index:'RF_ADDRESS', width:70},
            {name:'params',index:'params', width:70},
            {name:'ROAMING',index:'ROAMING', width:70},
            {name:'RX-MODE',index:'RX-MODE', width:70},
            {name:'TYPE',index:'TYPE', width:100},
            {name:'VERSION',index:'VERSION', width:50},

        ],
        datatype:   "local",
        rowNum:     25,
        autowidth:  true,
        width:      "100%",
        height:     600,
        rowList:    [25, 50, 100, 500],
        pager:      $('#pager-devices'),
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  "desc",
        caption:    "Geräte",
        subGrid:    true,
        subGridRowExpanded: function(grid_id, row_id) {
            subGridChannels(grid_id, row_id);
        }

    })
    .navGrid('#pager-devices')
    .jqGrid('filterToolbar',{
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    });

    // Direktverknüpfungs-Tabelle
    $("#grid-pairing").jqGrid({
        colNames:['Address', 'Address-Partner', 'Description'],
        colModel:[
            {name:'Address',index:'Address', width:100},
            {name:'Address-Partner',index:'Address-Partner', width:100},
            {name:'Description',index:'Description', width:100},
        ],
        rowNum:     10,
        autowidth:  true,
        width:      "100%",
        rowList:    [10,20,30],
        pager:      $('#pager-pairing'),
        sortname:   'timestamp',
        viewrecords: true,
        sortorder:  "desc",
        caption:    "Direktverknüpfungen"
    })
    .navGrid('#pager-pairing')
    .jqGrid('filterToolbar',{
        defaultSearch:'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    });

    function subGridChannels(grid_id, row_id) {
        var subgrid_table_id = "channels_" + row_id + "_t";
        $("#" + grid_id).html("<table id='" + subgrid_table_id + "''></table>");
        var gridConf = {
            datatype: "local",
            /*
             ADDRESS: "BidCoS-RF:0"
             AES_ACTIVE: 0
             DIRECTION: 0
             FLAGS: 3
             INDEX: 0
             LINK_SOURCE_ROLES: ""
             LINK_TARGET_ROLES: ""
             PARAMSETS: Array[2]
             PARENT: "BidCoS-RF"
             PARENT_TYPE: "HM-RCV-50"
             TYPE: "MAINTENANCE"
             VERSION: 6
             */
            colNames: [
                'ADDRESS',
                'AES_ACTIVE',
                'DIRECTION',
                'FLAGS',
                'INDEX',
                'LINK_SOURCE_ROLES',
                'LINK_TARGET_ROLES',
                'PARAMSETS',
                'TYPE',
                'VERSION'
            ],
            colModel: [
                {name: 'ADDRESS', index: 'ADDRESS', width: 70},
                {name: 'AES_ACTIVE', index: 'AES_ACTIVE', width: 50},
                {name: 'DIRECTION', index: 'DIRECTION', width: 50},
                {name: 'FLAGS', index: 'FLAGS', width: 50},
                {name: 'INDEX', index: 'INDEX', width: 50},
                {name: 'LINK_SOURCE_ROLES', index: 'LINK_SOURCE_ROLES', width: 100},
                {name: 'LINK_TARGET_ROLES', index: 'LINK_TARGET_ROLES', width: 100},
                {name: 'params', index: 'params', width: 100},
                {name: 'TYPE', index: 'TYPE', width: 100},
                {name: 'VERSION', index: 'VERSION', width: 50}
            ],
            rowNum: 1000000,
            autowidth: true,
            height: "auto",
            width: 1200,
            sortorder: "desc",
            viewrecords: true,
            ignoreCase: true
        };
        $("#" + subgrid_table_id).jqGrid(gridConf);
        for (var i = 0, len = listDevices.length; i < len; i++) {

            if (listDevices[i].PARENT == listDevices[row_id].ADDRESS) {
                var paramsets = "";
                for (var j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                    if (listDevices[i].PARAMSETS[j] == "LINK") continue;
                    var idButton = 'paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j];
                    paramsets += '<button class="paramset" id="' + idButton + '">' + listDevices[i].PARAMSETS[j] + '</button>';
                }
                listDevices[i].params = paramsets;
                $("#" + subgrid_table_id).jqGrid('addRowData', i, listDevices[i]);


            }
        }

    }

    $(".ui-jqgrid-titlebar-close").hide();

    function resizeGrids() {
        var x = $(window).width();
        var y = $(window).height();
        if (x < 1024) x = 1024;
        if (y < 640) y = 640;

        $("#grid-devices, #grid-pairing").setGridHeight(y - 186).setGridWidth(x - 60);
    }

    $(window).resize(function() {
        resizeGrids();
    });

    resizeGrids();

});