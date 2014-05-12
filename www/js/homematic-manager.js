$(document).ready(function () {

    var socket = io.connect();

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
                        buildGridDevices(data);
                    });
                });
            }
        });
    }

    function buildGridDevices(data) {
        console.log(data);
        for (var i = 0, len = data.length; i < len; i++) {
            data[i].id = i;
            if (data[i].RF_ADDRESS) {
                data[i].RF_ADDRESS = parseInt(data[i].RF_ADDRESS, 10).toString(16);
            }
            if (!data[i].PARENT) {
                $("#grid-devices").jqGrid('addRowData', i, data[i]);
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
        colNames: ['ADDRESS', 'FIRMWARE', 'FLAGS', 'INTERFACE', 'PARENT', 'RF_ADDRESS', 'ROAMING', 'RX-MODE', 'TYPE', 'VERSION'],
        colModel: [
            {name:'ADDRESS',index:'ADDRESS', width:70},
            {name:'FIRMWARE',index:'FIRMWARE', width:50},
            {name:'FLAGS',index:'FLAGS', width:50},
            {name:'INTERFACE',index:'INTERFACE', width:70},
            {name:'PARENT',index:'PARENT', width:70},
            {name:'RF_ADDRESS',index:'RF_ADDRESS', width:70},
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
        caption:    "Geräte"
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