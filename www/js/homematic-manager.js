/**
 *      homematic-manager
 *
 *  Copyright (c) 2014, 2015 Anli, Hobbyquaker
 *
 *  CC BY-NC-SA 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
 *
 */

"use strict";

;(function ($) {
$(document).ready(function () {

    var language = 'de';

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
    var listMessages;
    var names = {};
    var hash;

    var linkReceiverData;
    var linkReceiverDesc;
    var linkSenderType;
    var linkReceiverType;

    var setValueParamsetDescription;
    var setValueDesc;

    var $body =                         $('body');
    var $gridDevices =                  $('#grid-devices');
    var $gridLinks =                    $('#grid-links');
    var $gridRssi =                     $('#grid-rssi');
    var $gridMessages =                 $('#grid-messages');
    var $gridInterfaces =               $('#grid-interfaces');

    var $tableEasymode =                $('#table-easymode');
    var $tableParamset =                $('#table-paramset');
    var $tableDeleteLink =              $('#table-delete-link');

    var $consoleRpcMethod =             $('#console-rpc-method');
    var $consoleRpcSend =               $('#console-rpc-send');
    var $consoleRpcResponse =           $('#console-rpc-response');
    var $consoleFormParams =            $('#console-form-params');

    var $selectLinkparamsetProfile =    $('#linkparamset-profile');
    var $linkSourceRoles =              $('#link-source-roles');
    var $selectLinkSender =             $('#select-link-sender');
    var $selectLinkReceiver =           $('#select-link-receiver');

    var $selectBidcosDaemon;    // assigned after ui initialization, see initTabs()

    var $tabsMain =                     $('#tabs-main');

    var $dialogLinkparamset =           $('#dialog-linkparamset');
    var $dialogAddDevice =              $('#dialog-add-device');
    var $dialogAddCountdown =           $('#dialog-add-countdown');
    var $dialogDelDevice =              $('#dialog-del-device');
    var $dialogRename =                 $('#dialog-rename');
    var $dialogParamset =               $('#dialog-paramset');
    var $dialogRemoveLink =             $('#dialog-remove-link');
    var $dialogAddLink =                $('#dialog-add-link');
    var $dialogServicemessage =         $('#dialog-servicemessage');
    var $dialogAlert =                  $('#dialog-alert');
    var $dialogRpc =                    $('#dialog-rpc');
    var $dialogHelp =                   $('#dialog-help');
    var $dialogConfig =                 $('#dialog-config');

    // Entrypoint
    socket.on('connect', getConfig);

    // Incoming Events
    socket.on('rpc', function (method, params) {
        if (!config || !daemon) return;
        var daemonIdent = params[0];
        if (daemonIdent != config.daemons[daemon].ident) return;
         switch (method) {
             case 'newDevices':
                 var devArr = params[1];
                 $('div.ui-dialog[aria-describedby="dialog-alert"] .ui-dialog-title').html(_('New devices'));
                 var count = 0;
                 var output = '';
                 for (var i = 0; i < devArr.length; i++) {
                     if (devArr[i].ADDRESS.match(/:/)) continue;
                     count += 1;
                     output += '<br/>' + devArr[i].ADDRESS + ' (' + devArr[i].TYPE + ')';
                 }
                 $('#alert').html('<h3>' + count + ' ' + _('new') + ((count == 1 && language == 'de') ? 's': '') + ' ' + _('device') + (count == 1 ? '' : (language == 'de' ? 'e' : 's')) + ' ' + _('introduced') + ':</h3>' + output);
                 $("#dialog-alert").dialog('open');
                 getDevices(function () {
                     getLinks(function () {
                         getRfdData();
                     });
                 });
                 break;
             case 'deleteDevices':
                 var devArr = params[1];
                 $('div.ui-dialog[aria-describedby="dialog-alert"] .ui-dialog-title').html(_('Devices deleted'));
                var count = 0;
                 var output = '';
                 for (var i = 0; i < devArr.length; i++) {
                     if (devArr[i].match(/:/)) continue;
                     count += 1;
                     output += '<br/>' + devArr[i];
                 }
                 $('#alert').html('<h3>' + count + ' ' + _('device') + (count == 1 ? '' : (language == 'de' ? 'e' : 's')) + ' ' + _('deleted') + ':</h3>' + output);
                 $("#dialog-alert").dialog('open');
                 getDevices(function () {
                     getLinks(function () {
                         getRfdData();
                     });
                 });
                 break;
             case 'event':
                var address = params[1];
                var param = params[2];
                var value = params[3];

                var timestamp = new Date();
                var ts = timestamp.getFullYear() + '-' +
                    ("0" + (timestamp.getMonth() + 1).toString(10)).slice(-2) + '-' +
                    ("0" + (timestamp.getDate()).toString(10)).slice(-2) + ' ' +
                    ("0" + (timestamp.getHours()).toString(10)).slice(-2) + ':' +
                    ("0" + (timestamp.getMinutes()).toString(10)).slice(-2) + ':' +
                    ("0" + (timestamp.getSeconds()).toString(10)).slice(-2);

                var name = names && names[address] ? names[address] : '';

                $('#event-table').prepend('<tr class="ui-widget-content jqgrow ui-row-ltr "><td class="event-column-1">' + ts + '</td><td class="event-column-2">' + name + '</td><td class="event-column-3">' + address + '</td><td class="event-column-4">' + param + '</td><td class="event-column-5">' + value + '</td></tr>');

                // Service-Meldung?
                if (address.slice(-2) == ':0') {
                    var done;
                    if (value) {
                        // Muss Meldung hinzugefügt werden?
                        done = false;
                        for (var i = 0; i < listMessages.length; i++) {
                            if (listMessages[i][0] == address && listMessages[i][1] == param) {
                                done = true;
                            }
                        }

                        // Dialog für neue Servicemeldung anzeigen
                        if (!done) {
                            var devAddress = address.slice(0, -2);
                            var devName = names && names[devAddress] ? names[devAddress] : '';
                            $('#service-device').html(devName + ' (' + devAddress + ')');
                            $('#service-param').html(param);
                            $dialogRpc.dialog('close');
                            $dialogServicemessage.dialog('open');
                        }

                    } else {
                        // Muss Meldung gelöscht werden?
                        done = true;
                        for (var i = 0; i < listMessages.length; i++) {
                            if (listMessages[i][0] == address && listMessages[i][1] == param) {
                                done = false;
                            }
                        }
                    }
                    if (!done) getServiceMessages();
                }

                // Werte im UI aktualisieren
                $('[data-address="' + address + '"][data-param="' + param + '"]').each(function () {
                    var $this = $(this);
                    var elem = $this[0].nodeName;
                    var type = $this.attr('type');
                    var val = value;
                    if ($this.attr('data-unit') == '100%') val = value * 100;

                    switch (elem) {
                        case 'SELECT':
                            $this.val(val);
                            break;
                        case 'INPUT':
                            switch (type) {
                                case 'checkbox':
                                    if (val === true || val === 'true' || val > 0) {
                                        $this.prop('checked', true);
                                    } else {
                                        $this.removeAttr('checked');
                                    }
                                    break;
                                default:
                                    $this.val(val);
                            }
                            break;
                        default:
                            $this.html(val);
                    }

                });

                break;
            default:
        }
    });

    // i18n
    function _(word) {
        if (translation[word]) {
            if (translation[word][language]) {
                return translation[word][language];
            }
        }
        if (!missesTranslation[word]) {
            console.log('missing translation for "' + word + '"');
            missesTranslation[word] = {de: word, en: word};
        }

        return word;
    }
    function translate() {
        $('.translate').each(function () {
            var $this = $(this);
            $this.html(_($this.html()));
        });
        $('.translateT').each(function () {
            var $this = $(this);
            $this.attr('title', _($this.attr('title')));
        });
    }

    // Common
    function getConfig() {
        socket.emit('getConfig', function (data) {
            config = data;
            $('.version').html(config.version);
            language = config.language || 'de';
            translate();

            initTabs();
            initDialogsMisc();
            initDialogParamset();
            initDialogLinkParamset();

            initGridDevices();
            initGridMessages();
            initGridLinks();
            initConsole();

            var tmp = window.location.hash.slice(1).split('/');
            hash = tmp[1];

            var count = 0;
            for (var daemon in config.daemons) {
                count += 1;
                $selectBidcosDaemon.append('<option value="' + daemon + '"' + (hash == daemon ? ' selected' : '') + '>' + daemon + /*' (' + 'http://' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ')*/ '</option>');
            }
            if (count == 1) {
                $selectBidcosDaemon.hide();
            } else {
                $selectBidcosDaemon.multiselect({
                    classes: 'select-daemon',
                    multiple: false,
                    header: false,
                    selectedList: 1,
                    minWidth: 100
                });
            }


            $('#select-bidcos-daemon option').removeAttr('selected');
            $('#select-bidcos-daemon option[value="' + tmp[1] + '"]').attr('selected', true);
            if (tmp[2]) {
                var index = $('#tabs-main a[href="#' + tmp[2] + '"]').parent().index();
                $tabsMain.tabs("option", "active", index - 2);
            }

            getNames(function () {
                initDaemon();
                // at this point everything should be initialized
                $('#loader').hide('fade');
            });

        });
    }
    function getNames(callback) {
        socket.emit('getNames', function (data) {
            names = data;
            if (typeof callback === 'function') callback();
        });
    }
    function initTabs() {
        $tabsMain.tabs({

            activate: function(event ,ui){
                resizeGrids();
                var tab = ui.newTab[0].children[0].hash.slice(1);
                if (hash) window.location.hash = '/' + hash + '/' + tab;
            },
            create: function () {
                $('#tabs-main ul.ui-tabs-nav').prepend('<li><select id="select-bidcos-daemon"></select></li>');
                $selectBidcosDaemon = $('#select-bidcos-daemon');

                $('#tabs-main ul.ui-tabs-nav').prepend('<li class="header">HomeMatic Manager</li>');

                $(".ui-tabs-nav").
                    append("<button title='Help' class='menu-button translateT' id='button-help'></button>").
                    append("<button title='Settings' value='Theme wählen' class='menu-button translateT' id='button-config'></button>");
                // append("<span style='visibility: hidden; width:15px; height:15px; padding-top:5px; margin-right:10px; float:right;'><span title='Kommunikation' id='ajaxIndicator' style='width:15px; height: 15px;' class='ui-icon ui-icon-transfer-e-w'></span></span>");

                $('#button-help').button({
                    text: false,
                    icons: {
                        primary: 'ui-icon-help'
                    }
                }).click(function () {
                    $dialogHelp.dialog('open');
                });

                $('#button-config').button({
                    text: false,
                    icons: {
                        primary: 'ui-icon-gear'
                    }
                }).click(function () {
                    $dialogConfig.dialog('open');
                })/* TODO Einstellungen im UI, kein bearbeiten der config.json*/.hide();

            }
        });

        $selectBidcosDaemon.change(function () {
            initDaemon();
        });

    }
    function initDialogsMisc() {
        $dialogRpc.dialog({
            modal: true,
            autoOpen: false,
            closeOnEscape: false,
            open: function(event, ui) {
                $(".ui-dialog-titlebar-close", ui.dialog || ui).hide();
            }
        });
        $dialogServicemessage.dialog({
            modal: true,
            autoOpen: false
        });
        $dialogAlert.dialog({
            autoOpen: false,
            modal: true,
            width: 400,
            height: 360,
            buttons: [
                {
                    text: _('OK'),
                    click: function () {
                        $(this).dialog('close');
                    }
                }
            ]
        });
        $dialogHelp.dialog({
            autoOpen: false,
            modal: true,
            width: 640,
            height: 400
        });
        $dialogConfig.dialog({
            autoOpen: false,
            modal: true,
            width: 640,
            height: 400
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
        $gridMessages.jqGrid('clearGridData');
        $("#accept-message").addClass("ui-state-disabled");
        $("#accept-messages").addClass("ui-state-disabled");
        $("#del-device").addClass("ui-state-disabled");
        $("#replace-device").addClass("ui-state-disabled");
        $("#edit-device").addClass("ui-state-disabled");
        $("#edit-link").addClass("ui-state-disabled");
        $("#rename-link").addClass("ui-state-disabled");
        $("#play-link").addClass("ui-state-disabled");
        $("#play-link-long").addClass("ui-state-disabled");
        $("#del-link").addClass("ui-state-disabled");

        if (daemon && config.daemons[daemon]) {

            var type = config.daemons[daemon].type;

            var tmp = window.location.hash.slice(1).split('/');
            var tmpHash = '#/' + daemon;

            if (type === 'BidCos-Wired' && (tmp[2] === 'rssi' || tmp[2] === 'messages')) {
                tmp[2] = 'devices';
                $tabsMain.tabs('option', 'active', 0);
            }
            if (tmp[2]) {
                tmpHash += '/' + tmp[2];
            }

            window.location.hash = tmpHash;

            $('.dselect').hide();

            if (type === 'BidCos-Wired') {
                $('.dselect.' + type).show();
                $('#play-link').hide();
                $('#play-link-long').hide();
                //$gridDevices.jqGrid('hideCol', 'roaming');
                $gridDevices.jqGrid('hideCol', 'rx_mode');
                //$gridDevices.jqGrid('hideCol', 'RF_ADDRESS');
                //$gridDevices.jqGrid('hideCol', 'INTERFACE');
                resizeGrids();
            } else if (type == 'CUxD') {
                $('.dselect.' + type).show();
                $('#play-link').hide();
                $('#play-link-long').hide();
            } else {
                $('.dselect').show();
                $('#play-link').show();
                $('#play-link-long').show();
                //$gridDevices.jqGrid('showCol', 'roaming');
                $gridDevices.jqGrid('showCol', 'rx_mode');
                //$gridDevices.jqGrid('showCol', 'RF_ADDRESS');
                //$gridDevices.jqGrid('showCol', 'INTERFACE');
                resizeGrids();
            }

            getDevices(function () {
                getLinks(function () {
                    getRfdData();
                });
            });

        } else {
            window.location.hash = '';
        }

        elementConsoleMethod();
    }

    // Devices
    function getDevices(callback) {
        $('#load_grid-devices').show();
        rpcAlert(daemon, 'listDevices', [], function (err, data) {
            $('#load_grid-devices').hide();
            listDevices = data;
            if (callback) callback();
            refreshGridDevices();
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
    }
    function initGridDevices() {
        $gridDevices.jqGrid({
            colNames: ['Name', 'ADDRESS', 'TYPE', 'FIRMWARE', 'PARAMSETS', 'FLAGS', /*'INTERFACE', 'RF_ADDRESS',*/ /*'ROAMING',*/ 'RX_MODE'/*, 'VERSION'*/],
            colModel: [
                {name:'Name', index: 'Name', width: 224, fixed: false, classes: 'device-cell'},
                {name:'ADDRESS',index:'ADDRESS', width:110, fixed: true, classes: 'device-cell'},
                {name:'TYPE',index:'TYPE', width:140, fixed: false, classes: 'device-cell'},
                {name:'FIRMWARE',index:'FIRMWARE', width:80, fixed: true, classes: 'device-cell'},
                {name:'params',index:'params', width:120, fixed: true, classes: 'device-cell'},
                {name:'flags',index:'FLAGS', width:150, fixed: true, classes: 'device-cell'},
                //{name:'INTERFACE',index:'INTERFACE', width:70},
                //{name:'RF_ADDRESS',index:'RF_ADDRESS', width:70},
                //{name:'roaming',index:'roaming', width:30, hidden: true},
                {name:'rx_mode',index:'RX_MODE', width:150, fixed: true, classes: 'device-cell'}
                //{name:'VERSION',index:'VERSION', width:60, fixed: true, align:'right'}
            ],
            datatype:   'local',
            rowNum:     100,
            autowidth:  true,
            width:      '1000',
            height:     600,
            rowList:    [25, 50, 100, 500],
            pager:      $('#pager-devices'),
            sortname:   'timestamp',
            viewrecords: true,
            sortorder:  'desc',
            caption:    _('Devices'),
            subGrid:    true,
            ignoreCase: true,
            subGridRowExpanded: function(grid_id, row_id) {
                subGridChannels(grid_id, row_id);
            },
            ondblClickRow: function (rowid, iRow, iCol, e) {
                removeSelectionAfterDblClick();
                $gridDevices.jqGrid('toggleSubGridRow', rowid);
            },
            onSelectRow: function (rowid, iRow, iCol, e) {
                if ($('#grid-devices tr#' + rowid + ' td[aria-describedby="grid-devices_flags"]').html().match(/DontDelete/)) {
                    $('#del-device').addClass('ui-state-disabled');
                    $('#replace-device').addClass('ui-state-disabled');
                    $('#edit-device').addClass('ui-state-disabled');

                } else {
                    $('#del-device').removeClass('ui-state-disabled');
                    $('#replace-device').removeClass('ui-state-disabled');
                    $('#edit-device').removeClass('ui-state-disabled');
                    $('#restore-device').removeClass('ui-state-disabled');
                    $('#update-device').removeClass('ui-state-disabled');
                    $('#clear-device').removeClass('ui-state-disabled');
                }

                $('[id^="channels_"][id$="_t"]').jqGrid('resetSelection');
            },
            gridComplete: function () {
                $('button.paramset:not(.ui-button)').button();
                $('#del-device').addClass('ui-state-disabled');
                $('#replace-device').addClass('ui-state-disabled');
                $('#update-device').addClass('ui-state-disabled');
                $('#restore-device').addClass('ui-state-disabled');
                $('#clear-device').addClass('ui-state-disabled');
                $('#edit-device').addClass('ui-state-disabled');
            }
        }).navGrid('#pager-devices', {
            search: false,
            edit: false,
            add: false,
            del: false,
            refresh: false
        }).jqGrid('navButtonAdd', '#pager-devices', {
            caption: '',
            buttonicon: 'ui-icon-refresh',
            onClickButton: getDevices,
            position: 'first',
            id: 'refresh-devices',
            title: _('Refresh'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-devices', {
            caption: '',
            buttonicon: 'ui-icon-trash',
            onClickButton: dialogDeleteDevice,
            position: 'first',
            id: 'del-device',
            title: _('Delete device'),
            cursor: 'pointer'
        })/* TODO .jqGrid('navButtonAdd', '#pager-devices', {
         caption: '',
         buttonicon: 'ui-icon-transfer-e-w',
         onClickButton: function () {
         var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
         alert('todo replace ' + address);
         },
         position: 'first',
         id: 'replace-device',
         title: _('Replace device'),
         cursor: 'pointer'
         })*/.jqGrid('navButtonAdd', '#pager-devices', {
                caption: '',
                buttonicon: 'ui-icon-script',
                onClickButton: updateFirmware,
                position: 'first',
                id: 'update-device',
                title: _('Update firmware'),
                cursor: 'pointer'
            }).jqGrid('navButtonAdd', '#pager-devices', {
                caption: '',
                buttonicon: 'ui-icon-arrowrefresh-1-w',
                onClickButton: clearConfigCache,
                position: 'first',
                id: 'clear-device',
                title: _('clearConfigCache'),
                cursor: 'pointer'
            }).jqGrid('navButtonAdd', '#pager-devices', {
                caption: '',
                buttonicon: 'ui-icon-comment',
                onClickButton: restoreConfigToDevice,
                position: 'first',
                id: 'restore-device',
                title: _('restoreConfigToDevice'),
                cursor: 'pointer'
            }).jqGrid('navButtonAdd', '#pager-devices', {
                caption: '',
                buttonicon: 'ui-icon-pencil',
                onClickButton: dialogRenameDevice,
                position: 'first',
                id: 'edit-device',
                title: _('Rename device'),
                cursor: 'pointer'
            }).jqGrid('navButtonAdd', '#pager-devices', {
                caption: '',
                buttonicon: 'ui-icon-plus',
                onClickButton: function () {
                    $dialogAddDevice.dialog('open');
                },
                position: 'first',
                id: 'add-device',
                title: _('Pair devices'),
                cursor: 'pointer'
            }).jqGrid('filterToolbar', {
                defaultSearch: 'cn',
                autosearch: true,
                searchOnEnter: false,
                enableClear: false
            });
        $gridDevices.contextmenu({
            delegate: "td.device-cell",
            menu: [
                {title: _("Rename"), cmd: "rename", uiIcon: "ui-icon-pencil"},
                {title: _("MASTER Paramset"), cmd: "paramsetMaster", uiIcon: "ui-icon-gear"},
                {title: "----"},
                {title: _("restoreConfigToDevice"), cmd: "restoreConfigToDevice", uiIcon: "ui-icon-comment"},
                {title: _("clearConfigCache"), cmd: "clearConfigCache", uiIcon: "ui-icon-arrowrefresh-1-w"},
                {title: "----"},
                {title: _("updateFirmware"), cmd: "updateFirmware", uiIcon: "ui-icon-script"},
                {title: _("Replace"), cmd: "replace", uiIcon: "ui-icon-transfer-e-w"},
                {title: _("Delete"), cmd: "delete", uiIcon: "ui-icon-trash"}

            ],
            select: function(event, ui) {
                var cmd = ui.cmd;
                var address = ui.target.parent().find('[aria-describedby$="_ADDRESS"]').text();
                switch (cmd) {
                    case 'paramsetMaster':
                        getParamset(address, 'MASTER');
                        break;
                    case 'clearConfigCache':
                        clearConfigCache();
                        break;
                    case 'updateFirmware':
                        updateFirmware();
                        break;
                    case 'restoreConfigToDevice':
                        restoreConfigToDevice();
                        break;
                    case 'rename':
                        dialogRenameDevice();
                        break;
                    case 'delete':
                        dialogDeleteDevice();
                        break;
                    default:
                        alert("todo " + cmd + " on " + address);
                }

            }
        });
        $('#del-device').addClass('ui-state-disabled');
        $('#replace-device').addClass('ui-state-disabled');
        $('#edit-device').addClass('ui-state-disabled');

        $dialogAddDevice.dialog({
            autoOpen: false,
            modal: true,
            width: 540,
            height: 320,
            buttons: [
                {
                    text: _('Cancel'),
                    click: function () {
                        $(this).dialog('close');
                    }
                }
            ]
        });
        $dialogAddCountdown.dialog({
            autoOpen: false,
            modal: true,
            width: 400,
            height: 200
        });
        $dialogDelDevice.dialog({
            autoOpen: false,
            modal: true,
            width: 500,
            height: 240,
            buttons: [
                {
                    text: _('Delete'),
                    click: function () {
                        $dialogDelDevice.dialog('close');
                        var address = $('#del-device-address').val();
                        var flags = parseInt($('#del-device-flag-0').val(), 10) + parseInt($('#del-device-flag-1').val(), 10);
                        rpcDialog(daemon, 'deleteDevice', [address, flags]);
                    }
                },
                {
                    text: _('Cancel'),
                    click: function () {
                        $(this).dialog('close');
                    }
                }
            ]
        });
        $dialogRename.dialog({
            autoOpen: false,
            modal: true,
            width: 400,
            height: 200,
            buttons: [
                {
                    text: _('Save'),
                    click: function () {
                        var $that = $(this);
                        var renameAddress = $('#rename-address').val();
                        var renameName = $('#rename-name').val();
                        var rowid = $('#rename-rowid').val();
                        var gridid = $('#rename-gridid').val();
                        socket.emit('setName', renameAddress, renameName, function () {
                            if (renameAddress.match(/:/)) {
                                var $gridCh = $('#' + gridid);
                                var rowData = $gridCh.jqGrid('getRowData', rowid);
                                rowData.Name = renameName;
                                $gridCh.jqGrid('setRowData', rowid, rowData);
                                if (!names) names = {};
                                names[renameAddress] = renameName;
                                refreshGridLinks();

                            } else {
                                var rowData = $gridDevices.jqGrid('getRowData', rowid);
                                rowData.Name = renameName;
                                $gridDevices.jqGrid('setRowData', rowid, rowData);
                                if (!names) names = {};
                                names[renameAddress] = renameName;
                                names[renameAddress + ':0'] = renameName + ':0';

                                for (var i = 0; i < listDevices.length; i++) {
                                    if (listDevices[i].ADDRESS == renameAddress) {
                                        listDevices[i].Name = renameName;
                                        break;
                                    }
                                }

                                if (config.daemons[daemon].type !== 'BidCos-Wired') {
                                    refreshGridRssi();
                                }
                            }

                            $that.dialog('close');
                        });
                    }
                },
                {
                    text: _('Cancel'),
                    click: function () {
                        $(this).dialog('close');
                    }
                }
            ]
        });

        $('#add-device-address-start').button().click(function () {
            $dialogAddDevice.dialog('close');
            var mode = parseInt($('#add-device-mode').val(), 10);
            var address = $('#add-device-address').val();
            rpcDialog(daemon, 'addDevice', [address, mode]);
        });
        $('#add-device-time-start').button().click(function () {
            var mode = parseInt($('#add-device-mode').val(), 10);
            var time = parseInt($('#add-device-time').val(), 10);
            if (isNaN(time)) time = 60;
            if (time > 300) time = 300;
            $dialogAddDevice.dialog('close');
            rpcAlert(daemon, 'setInstallMode', [true, time, mode], function (err) {
                if (!err) {
                    $('#add-countdown').html(time);
                    $dialogAddCountdown.dialog('open');
                    var addInterval = setInterval(function () {
                        time = time - 1;
                        $('#add-countdown').html(time);
                        if (time < 1) {
                            clearInterval(addInterval);
                            $dialogAddCountdown.dialog('close');
                            addInterval = null;
                        }
                    }, 1000);
                }
            });
        });

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
                    {name: 'Name', index: 'Name', width: 222, fixed: false, classes: 'channel-cell'},
                    {name: 'ADDRESS', index: 'ADDRESS', width: 110, fixed: true, classes: 'channel-cell'},
                    {name: 'TYPE', index: 'TYPE', width: 140, fixed: false, classes: 'channel-cell'},
                    {name: 'direction', index: 'direction', width: 80, fixed: true, classes: 'channel-cell'},
                    {name: 'params', index: 'params', width: 120, fixed: true, classes: 'channel-cell'},
                    {name: 'flags', index: 'flags', width: 150, fixed: true, classes: 'channel-cell'},
                    {name: 'aes_active', index: 'aes_active', width: 148, fixed: true, hidden: (config.daemons[daemon].type !== 'BidCos-RF'), classes: 'channel-cell'}
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
                    $gridDevices.jqGrid('resetSelection');

                    $('#del-device').addClass('ui-state-disabled');

                    var rowData = $('#' + this.id).jqGrid('getRowData', rowid);

                    if (rowData.Name.slice(-2) != ':0') {
                        $('#edit-device').removeClass('ui-state-disabled');
                    } else {
                        $('#edit-device').addClass('ui-state-disabled');
                    }

                    $('#replace-device').addClass('ui-state-disabled');
                    $('#restore-device').addClass('ui-state-disabled');
                    $('#update-device').addClass('ui-state-disabled');
                    $('#clear-device').addClass('ui-state-disabled');
                },
                gridComplete: function () {
                    $('button.paramset:not(.ui-button)').button();
                }
            };
            var $subgrid = $('#' + subgrid_table_id)
            $subgrid.jqGrid(gridConf);

            var rowData = [];
            for (var i = 0, len = listDevices.length; i < len; i++) {

                if (listDevices[i].PARENT == listDevices[row_id].ADDRESS) {

                    if (names[listDevices[i].ADDRESS]) listDevices[i].Name = names[listDevices[i].ADDRESS];

                    var paramsets = '';
                    for (var j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                        if (listDevices[i].PARAMSETS[j] == 'LINK') continue;
                        var idButton = 'paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j];
                        paramsets += '<button class="paramset device-table" data-address="' + listDevices[i].ADDRESS + '" data-paramset="' + listDevices[i].PARAMSETS[j] +'" id="' + idButton + '">' + listDevices[i].PARAMSETS[j] + '</button>';
                    }
                    listDevices[i].params = paramsets;
                    listDevices[i]._id = i;
                    rowData.push(listDevices[i]);
                }
            }
            $subgrid.jqGrid('addRowData', '_id', rowData);
            $('button.paramset:not(.ui-button)').button();
        }

        $body.contextmenu({
            delegate: "td.channel-cell",
            menu: [
                {title: _("Rename"), cmd: "rename", uiIcon: "ui-icon-pencil"},
                {title: _("MASTER Paramset"), cmd: "paramsetMaster", uiIcon: "ui-icon-gear"},
                {title: _("VALUES Paramset"), cmd: "paramsetValues", uiIcon: "ui-icon-gear"}

            ],
            select: function(event, ui) {
                var cmd = ui.cmd;
                var address = ui.target.parent().find('[aria-describedby$="_ADDRESS"]').text();
                switch (cmd) {
                    case 'paramsetMaster':
                        getParamset(address, 'MASTER');
                        break;
                    case 'paramsetValues':
                        getParamset(address, 'VALUES');
                        break;
                    case 'rename':
                        dialogRenameDevice();
                        break;
                    default:
                        alert("todo " + cmd + " on " + address);
                }

            }
        });
    }
    function refreshGridDevices() {
        if (!listDevices) {
            console.log(daemon, 'error: listDevices empty');
            return;
        }
        $gridDevices.jqGrid('clearGridData');
        var rowData = [];
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

            if (names[listDevices[i].ADDRESS]) listDevices[i].Name = names[listDevices[i].ADDRESS];

            var paramsets = '';
            for (var j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                paramsets += '<button class="paramset device-table" data-address="' + listDevices[i].ADDRESS + '" data-paramset="' + listDevices[i].PARAMSETS[j] + '" id="paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j] + '">' + listDevices[i].PARAMSETS[j] + '</button>';
            }
            listDevices[i].params = paramsets;
            if (!listDevices[i].PARENT) {
                listDevices[i]._id = i;
                rowData.push(listDevices[i]);
            }
        }
        $gridDevices.jqGrid('addRowData', '_id', rowData);
        $gridDevices.trigger('reloadGrid');
        $('button.paramset:not(.ui-button)').button();
    }
    function updateFirmware() {
        var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
        rpcDialog(daemon, 'updateFirmware', [address]);
    }
    function restoreConfigToDevice() {
        var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
        rpcDialog(daemon, 'restoreConfigToDevice', [address]);
    }
    function clearConfigCache() {
        var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
        rpcDialog(daemon, 'clearConfigCache', [address]);
    }
    function dialogRenameDevice() {
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
            var name = $('#' + chGrid + ' tr#' + chSelected + ' td[aria-describedby$="_Name"]').html();
            var rowid = chSelected;
        } else {
            var address = $('#grid-devices tr#' + devSelected + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
            var name = $('#grid-devices tr#' + devSelected + ' td[aria-describedby="grid-devices_Name"]').html();
            var rowid = devSelected;
        }
        $('#rename-rowid').val(rowid);
        $('#rename-gridid').val(chGrid);
        $('#rename-address').val(address);
        $('#rename-name').val(name == '&nbsp;' ? '' : name);
        $dialogRename.dialog('open');
    }
    function dialogDeleteDevice() {
        var address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
        $('#del-device-name').html(names[address] ? (names[address] + ' (' + address + ')') : address);
        $('#del-device-address').val(address);
        $dialogDelDevice.dialog('open');
    }
    function dialogParamset(data, desc, address, paramset) {
        //console.log('dialogParamset', data, desc, address, paramset);

        // Tabelle befüllen
        $tableParamset.show().html('<tr><th class="paramset-1">Param</th><th class="paramset-2">&nbsp;</th><th class="paramset-3">Value</th><th class="paramset-4">Default</th><th></th></tr>');
        var count = 0;
        for (var param in desc) {
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
                var helpentry = help_linkParamset[language] && help_linkParamset[language][param.replace('SHORT_', '').replace('LONG_', '')];
                var help;
                if (helpentry && helpentry.helpText) {
                    help = helpentry.helpText;
                } else {
                    help = helpentry || '';
                }

                switch (desc[param].TYPE) {
                    case 'ACTION':
                        input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="BOOL" id="paramset-input-' + param + '" type="checkbox" value="true"' + (data[param] ? ' checked="checked"' : '') + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case 'BOOL':
                        input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="BOOL" id="paramset-input-' + param + '" type="checkbox" value="true"' + (data[param] ? ' checked="checked"' : '') + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case 'INTEGER':
                        input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="INTEGER" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="number" min="' + desc[param].MIN + '" max="' + desc[param].MAX + '" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    case 'ENUM':
                        input = '<select data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="INTEGER" id="paramset-input-' + param + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                        for (var i = desc[param].MIN; i <= desc[param].MAX; i++) {
                            input += '<option value="' + i + '"' + (data[param] == i ? ' selected="selected"' : '') + '>' + desc[param].VALUE_LIST[i] + '</option>';
                            if (helpentry) {
                                if (i == desc[param].MIN) {
                                    help += '<br/><ul>';
                                }
                                if (helpentry.params[desc[param].VALUE_LIST[i]]) {
                                    help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>: ' + helpentry.params[desc[param].VALUE_LIST[i]] + (i < desc[param].MAX ? '<br/>' : '');
                                } else {
                                    help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>';
                                }
                                if (i == desc[param].MAX) {
                                    help += '</ul>';
                                }
                            }
                        }
                        if (param == 'DISPLAY_INFORMATION') {
                            input += '<option value="2"' + (data[param] == 2 ? ' selected="selected"' : '') + '>VENT_POSITION</option>';
                            input += '<option value="3"' + (data[param] == 3 ? ' selected="selected"' : '') + '>ACTUAL_TEMPERATURE</option>';

                        }
                        input += '</select>';
                        defaultVal = desc[param].VALUE_LIST[defaultVal];
                        break;
                    case 'FLOAT':
                        input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="FLOAT" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    default:
                        //console.log('unknown type', desc[param].TYPE);
                        // Todo this should not happen
                        input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="STRING" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                }

                var helpIcon = help ? '<img src="images/help.png" width="16" height="16" title="' + help + '">' : '';


                // Paramset VALUES?
                if (paramset == 'VALUES' && (desc[param].OPERATIONS & 2)) {
                    $tableParamset.append('<tr><td>' + param + '</td><td>' + helpIcon + '</td><td>' + input + '</td><td>' + desc[param].DEFAULT + '</td><td><button class="paramset-setValue" id="paramset-setValue-' + param + '">setValue</button></td></tr>');
                } else {
                    $tableParamset.append('<tr><td>' + param + '</td><td>' + helpIcon + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + unit + '</td></tr>');
                }

            } else {
                $tableParamset.append('<tr><td>' + param + '</td><td>' + helpIcon + '</td><td colspan = "3">' + data[param] + '</td></tr>');
            }
        }

        if (count == 0) {
            $tableParamset.hide();
        }

        // Dialog-Überschrift setzen
        var name = names && names[address] ? names[address] : '';

        name += ' (PARAMSET ' + address + ' ' + paramset + ')';


        $('div[aria-describedby="dialog-paramset"] span.ui-dialog-title').html(name);

        // Hidden-Hilfsfelder
        $('#edit-paramset-address').val(address);
        $('#edit-paramset-paramset').val(paramset);

        // Buttons
        $('button.paramset-setValue:not(.ui-button)').button();


        $dialogParamset.dialog('open');
        $dialogParamset.tooltip({
            open: function (event, ui) {
                ui.tooltip.css("max-width", "500px");
            },
            content: function () {
                return $(this).prop('title');
            }
        });
    }
    function initDialogParamset() {
        $dialogParamset.dialog({
            autoOpen: false,
            modal: true,
            width: 800,
            height: 480,
            buttons: [
                {
                    text: _('putParamset'),
                    click: function () {
                        putParamset();
                    }
                }
            ]
        });
        $body.on('click', 'button.paramset', function () {
            $('#load_grid-devices').show();
            var address = $(this).attr('data-address');
            var paramset = $(this).attr('data-paramset')
            getParamset(address, paramset);
        });
        $body.on('click', 'button.paramset-setValue', function () {

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
                case "BOOL":
                    val = !!val;
                    break;
                case "FLOAT":
                    val = {explicitDouble: parseFloat(val)};
                    break;
                case "INTEGER":
                    val = parseInt(val, 10);
                    break;
                default:
                    val = '' + val;
            }
            rpcDialog(daemon, 'setValue', [address, param, val]);
        });

    }
    function getParamset(address, paramset) {
        rpcAlert(daemon, 'getParamset', [address, paramset], function (err, data) {
            if (err) {
                $('#load_grid-devices').hide();
                return;
            }
            rpcAlert(daemon, 'getParamsetDescription', [address, paramset], function (err2, data2) {
                if (err2) {
                    $('#load_grid-devices').hide();
                    return;
                }
                dialogParamset(data, data2, address, paramset);
                $('#load_grid-devices').hide();
            });
        });
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

                // changes only
                if (val == dataValPrev || (val === true && dataValPrev === 'true') || (val === false && dataValPrev === 'false')) return;

                // todo update ui if channel aes_active is changed

                // calculate value if unit is "100%"
                if ($input.attr('data-unit') == '100%') {
                    val /= 100;
                }
                switch (dataType) {

                    case 'BOOL':
                        if (val === 'true') {
                            val = true;
                        } else if (val === 'false') {
                            val = false;
                        } else {
                            val = !!val;
                        }
                        break;
                    case 'INTEGER':
                        val = parseInt(val, 10);
                        break;
                    case 'FLOAT':
                        val = {explicitDouble: parseFloat(val)};
                        break;
                    default: // (STRING)
                        val = '' + val;
                }

                values[param] = val;
                count += 1;
            }
        });
        if (count > 0) {
            rpcAlert(daemon, 'putParamset', [address, paramset, values]);
        }
    }

    // Links
    function getLinks(callback) {
        if (config.daemons[daemon].type == 'CUxD') {
            if (callback) callback();
            return;
        }
        $('#load_grid-links').show();
        rpcAlert(daemon, 'getLinks', [], function (err, data) {
            listLinks = data;
            if (callback) callback();
            refreshGridLinks();
        });
    }
    function initGridLinks() {
        $gridLinks.jqGrid({
            datatype: 'local',
            colNames:['SENDER Name', 'SENDER', 'RECEIVER Name', 'RECEIVER', 'NAME', 'DESCRIPTION'/*, 'Aktionen'*/],
            colModel:[
                {name:'Sendername', index:'Sendername', width:100, classes: 'link-cell'},
                {name:'SENDER', index:'SENDER', width:50, classes: 'link-cell'},
                {name:'Receivername', index:'Receivername', width:100, classes: 'link-cell'},
                {name:'RECEIVER', index:'RECEIVER', width:50, classes: 'link-cell'},
                {name:'NAME', index:'NAME', width:150, classes: 'link-cell'},
                {name:'DESCRIPTION', index:'DESCRIPTION', width:150, classes: 'link-cell'}
                //{name:'ACTIONS', index:'ACTIONS', width:80}
            ],
            rowNum:     100,
            autowidth:  true,
            width:      '100%',
            rowList:    [25, 50, 100, 500],
            pager:      $('#pager-links'),
            sortname:   'timestamp',
            viewrecords: true,
            sortorder:  'desc',
            caption:    _('Links'),
            ignoreCase: true,
            onSelectRow: function (rowid, iRow, iCol, e) {
                $('#del-link').removeClass('ui-state-disabled');
                $('#rename-link').removeClass('ui-state-disabled');
                $('#edit-link').removeClass('ui-state-disabled');
                $('#play-link').removeClass('ui-state-disabled');
                $('#play-link-long').removeClass('ui-state-disabled');
            },
            ondblClickRow: function (rowid, iRow, iCol, e) {
                removeSelectionAfterDblClick();
                var row = $gridLinks.jqGrid('getGridParam','selrow');
                var sender = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_SENDER"]').html();
                var receiver = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_RECEIVER"]').html();
                getLink(sender, receiver, row);
            },
            gridComplete: function () {
                $('#del-link').addClass('ui-state-disabled');
                $('#rename-link').addClass('ui-state-disabled');
                $('#edit-link').addClass('ui-state-disabled');
                $('#play-link').addClass('ui-state-disabled');
                $('#play-link-long').addClass('ui-state-disabled');
            }
        }).navGrid('#pager-links', {
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
        }).jqGrid('navButtonAdd', '#pager-links', {
            caption: '',
            buttonicon: 'ui-icon-refresh',
            onClickButton: function () {
                getLinks();
            },
            position: 'first',
            id: 'refresh-link',
            title: _('Refresh'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-links', {
            caption: '',
            buttonicon: 'ui-icon-trash',
            onClickButton: function () {
                dialogRemoveLink();
            },
            position: 'first',
            id: 'del-link',
            title: _('Delete link'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-links', {
            caption: '',
            buttonicon: 'ui-icon-seek-next',
            onClickButton: function () {
                var sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
                var receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
                activateLinkParamset(receiver, sender, true);

            },
            position: 'first',
            id: 'play-link-long',
            title: _('Activate long'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-links', {
            caption: '',
            buttonicon: 'ui-icon-seek-end',
            onClickButton: function () {
                var sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
                var receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
                activateLinkParamset(receiver, sender);

            },
            position: 'first',
            id: 'play-link',
            title: _('Activate short'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-links', {
            caption: '',
            buttonicon: 'ui-icon-gear',
            onClickButton: function () {
                var row = $gridLinks.jqGrid('getGridParam','selrow');
                var sender = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_SENDER"]').html();
                var receiver = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_RECEIVER"]').html();
                getLink(sender, receiver, row);
                //alert('edit link ' + sender + ' -> ' + receiver);
            },
            position: 'first',
            id: 'edit-link',
            title: _('Edit link'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-links', {
            caption: '',
            buttonicon: 'ui-icon-plus',
            onClickButton: function () {
                var selectOptions = '<option value="null">Bitte einen Kanal auswählen</option>';
                for (var j = 0, len = listDevices.length; j < len; j++) {
                    if (!listDevices[j].PARENT) continue;
                    if (listDevices[j].ADDRESS.match(/:0$/)) continue;
                    if (!listDevices[j].LINK_SOURCE_ROLES) continue;
                    selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + (names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '') + '</option>';
                }
                $selectLinkSender.html(selectOptions).multiselect('refresh');
                $selectLinkReceiver.html('').multiselect('refresh').multiselect('disable');
                $linkSourceRoles.html('');
                $('#link-target-roles').html('');
                $('.add-link-create').button('disable');
                $('.add-link-create-edit').button('disable');
                $dialogAddLink.dialog('open');
            },
            position: 'first',
            id: 'add-link',
            title: _('Create link'),
            cursor: 'pointer'
        });
        $gridLinks.contextmenu({
            delegate: "td.link-cell",
            menu: [
                {title: _('Edit link'), cmd: "edit", uiIcon: "ui-icon-gear"},
                {title: _('Activate short'), cmd: "activate", uiIcon: "ui-icon-seek-end"},
                {title: _('Activate long'), cmd: "activate_long", uiIcon: "ui-icon-seek-next"},
                {title: _('Delete link'), cmd: "delete", uiIcon: "ui-icon-trash"}
            ],
            select: function(event, ui) {
                var cmd = ui.cmd;
                var row = ui.target.parent().attr('id');
                var sender = ui.target.parent().find('[aria-describedby$="_SENDER"]').text();
                var receiver = ui.target.parent().find('[aria-describedby$="_RECEIVER"]').text();
                switch (cmd) {
                    case 'edit':
                        getLink(sender, receiver, row);
                        break;
                    case 'activate':
                        activateLinkParamset(receiver, sender);
                        break;
                    case 'activate_long':
                        activateLinkParamset(receiver, sender, true);
                        break;
                    case 'delete':
                        dialogRemoveLink(sender, receiver);
                        break;
                    default:
                        alert("todo " + ui.cmd + " on " + sender + ' - ' + receiver);
                }
            }
        });

        $gridInterfaces.jqGrid({
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
            caption:    _('Interfaces'),
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
        $('#gbox_grid-messages .ui-jqgrid-titlebar-close').hide();

        resizeGrids();

        $('#load_grid-devices').show();
        $('#load_grid-messages').show();
        $('#load_grid-interfaces').show();
        $('#load_grid-links').show();

        $dialogRemoveLink.dialog({
            autoOpen: false,
            modal: true,
            width: 640,
            height: 400,
            buttons: [
                {
                    text: _('Delete'),
                    click: function () {
                        $(this).dialog('close');
                        rpcDialog(daemon, 'removeLink', [$('#delete-link-sender').val(), $('#delete-link-receiver').val()], function (err, res) {
                            rpcAlert(daemon, 'getLinks', [], function (err, data) {
                                if (!err) {
                                    listLinks = data;
                                    refreshGridLinks();
                                }
                            });
                        });
                    }
                },
                {
                    text: _('Cancel'),
                    click: function () {
                        $(this).dialog('close');
                    }
                }
            ]
        });
        $dialogAddLink.dialog({
            autoOpen: false,
            modal: true,
            width: 800,
            height: 480,
            buttons: [
                {
                    text: _('Create and edit'),
                    'class': 'add-link-create-edit',
                    click: function () {
                        var sender = $selectLinkSender.val();
                        var targets = $selectLinkReceiver.val();
                        var receiver = targets[0];
                        rpcDialog(daemon, 'addLink', [$selectLinkSender.val(), receiver, '', ''], function (err, res) {
                            $('#load_grid-links').show();
                            rpcAlert(daemon, 'getParamset', [sender, receiver], function (err, data1) {
                                rpcAlert(daemon, 'getParamsetDescription', [sender, receiver], function (err2, desc1) {
                                    rpcAlert(daemon, 'getParamset', [receiver, sender], function (err3, data2) {
                                        rpcAlert(daemon, 'getParamsetDescription', [receiver, sender], function (err4, desc2) {
                                            dialogLinkparamset({NAME: '', DESCRIPTION: ''}, data1, desc1, data2, desc2, sender, receiver);
                                            $('#load_grid-links').hide();
                                        });
                                    });
                                });
                            });
                        });


                        rpcAlert(daemon, 'getLinks', [], function (err, data) {
                            if (!err) {
                                listLinks = data;
                                refreshGridLinks();
                            }
                        });

                        $(this).dialog('close');
                    }
                },{
                    text: _('Create'),
                    'class': 'add-link-create',
                    click: function () {
                        var sender = $selectLinkSender.val();
                        var targets = $selectLinkReceiver.val();

                        for (var i = 0; i < targets.length; i++) {
                            var receiver = targets[i];
                            rpcDialog(daemon, 'addLink', [sender, receiver, '', '']);
                        }

                        rpcAlert(daemon, 'getLinks', [], function (err, data) {
                            if (!err) {
                                listLinks = data;
                                refreshGridLinks();
                            }
                        });

                        $(this).dialog('close');
                    }
                },
                {
                    text: _('Cancel'),
                    click: function () {
                        $(this).dialog('close');
                    }
                }
            ]
        });

    }
    function refreshGridLinks() {
        $gridLinks.jqGrid('clearGridData');
        var rowData = [];
        for (var i = 0, len = listLinks.length; i < len; i++) {
            if (names[listLinks[i].SENDER]) listLinks[i].Sendername = names[listLinks[i].SENDER];
            if (names[listLinks[i].RECEIVER]) listLinks[i].Receivername = names[listLinks[i].RECEIVER];

            listLinks[i]._id = i;
            rowData.push(listLinks[i]);

        }
        $gridLinks.jqGrid('addRowData', '_id', rowData);
        $gridLinks.trigger('reloadGrid');
    }
    function initDialogLinkParamset() {
        $('#link-sender-params, #link-receiver-params, #save-link-info').button();

        $dialogLinkparamset.dialog({
            autoOpen: false,
            modal: true,
            width: 960,
            height: 480,
            buttons: [
                {
                    text: _('Cancel'),
                    click: function () {
                        $dialogLinkparamset.dialog('close');
                    }
                },
                /* TODO {
                 text: _('saveAsNewTemplate'),
                 click: function () {
                 alert('todo'); // todo
                 }
                 }, */
                {
                    'class': 'linkparamset-save',
                    text: _('putParamset'),
                    click: function () {
                        putLinkParamsets($(this));
                    }
                }
            ]
        });
        $selectLinkparamsetProfile.change(function () {
            var prn = parseInt($(this).val(), 10);
            $('#linkparamset-input-receiver-sender-UI_HINT').val(prn);
            formEasyMode(linkReceiverData, linkReceiverDesc, 'receiver-sender', linkSenderType, linkReceiverType, prn);
        });
        $selectLinkparamsetProfile.multiselect({
            multiple: false,
            header: false,
            minWidth: 300,
            selectedList: 1
        });
        $selectLinkSender.change(function () {
            var sender = $(this).val();
            if (sender != "null") {
                var roles = indexChannels[sender].LINK_SOURCE_ROLES.split(' ');
                var targets = [];
                $linkSourceRoles.html('');
                $linkSourceRoles.html(indexChannels[sender].LINK_SOURCE_ROLES);

                for (var i = 0; i < roles.length; i++) {
                    for (var role in indexTargetRoles[roles[i]]) {
                        var address = indexTargetRoles[roles[i]][role];
                        if (targets.indexOf(address) == -1) {
                            targets.push(address);
                        }
                    }
                }

                var selectOptions = '';
                for (var i = 0; i < targets.length; i++) {
                    var name;
                    if (names[targets[i]]) {
                        name = ' ' + (names[targets[i]] || '');
                    } else {
                        name = '';
                    }
                    selectOptions += '<option value="'+ targets[i] + '">' + targets[i] + name + '</option>';
                }
                $selectLinkReceiver.html(selectOptions);
                $('.add-link-create').button('disable');
                $('.add-link-create-edit').button('disable');

                $selectLinkReceiver.multiselect('refresh');
                $selectLinkReceiver.multiselect('enable');
            } else {

                $selectLinkReceiver.multiselect('disable');
                $linkSourceRoles.html('');
            }
        });
        $selectLinkSender.multiselect({
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
        $selectLinkReceiver.multiselect({
            classes: 'link-receiver',
            multiple: true,
            minWidth: 480,
            //header: false,
            height: 400,
            selectedList: 2,
            noneSelectedText: _('Please choose one or more channels'), //"Bitte einen oder mehrere Kanäle auswählen",
            checkAllText: _('Check all'),
            uncheckAllText: _('Uncheck all')
        }).multiselectfilter({
            autoReset: true,
            placeholder: ''
        });

        $selectLinkReceiver.change(function () {
            var c = $selectLinkReceiver.val() ? $selectLinkReceiver.val().length : 0;
            if (c === 0) {
                $('.add-link-create').button('disable');
                $('.add-link-create-edit').button('disable');
            } else if (c === 1) {
                $('.add-link-create').button('enable');
                $('.add-link-create-edit').button('enable');
            } else {
                $('.add-link-create').button('enable');
                $('.add-link-create-edit').button('disable');
            }
        });

        $('#edit-link-input-name').keyup(function () {
            $('#save-link-info').button('enable');
        });
        $('#edit-link-input-description').keyup(function () {
            $('#save-link-info').button('enable');
        });
        $tableEasymode.on('change', '.easymode-select-input', function () {
            var val = $(this).find('option:selected').val();
            var $input = $(this).parent().find('input');
            if (val == 99999999 || val == 99999998) {
                $input.show();
            } else {
                $input.hide();
                $input.val(val);
                $input.trigger('change');
            }

        });
        $tableEasymode.on('change', '.easymode-param', function () {
            var val = $(this).val();
            var binds = $(this).attr('data-binds').split(',');
            //console.log('...', val, binds);
            binds.forEach(function (param) {
                $('#linkparamset-input-receiver-sender-' + param).val(val);
            });
        });
        $('#save-link-info').click(function () {
            $(this).button('disable');

            var sender = $('#edit-linkparamset-sender').val();
            var receiver = $('#edit-linkparamset-receiver').val();
            var name = $('#edit-link-input-name').val();
            var desc = $('#edit-link-input-description').val();

            var row = $('#edit-linkparamset-row').val();

            rpcDialog(daemon, 'setLinkInfo', [sender, receiver, name, desc], function (err, res) {
                if (!err) {
                    var rowData = $gridLinks.jqGrid('getRowData', row);
                    rowData.DESCRIPTION = desc;
                    rowData.NAME = name;
                    $gridLinks.jqGrid('setRowData', row, rowData);
                }
            });
        });
        $('#toggle-link-sender').click(function () {
            var $span = $(this).find('span');

            if ($span.hasClass('ui-icon-plus')) {
                $(this).find('span').removeClass('ui-icon-plus');
                $(this).find('span').addClass('ui-icon-minus');
                $('#div-link-sender').show('blind');
            } else {
                $(this).find('span').removeClass('ui-icon-minus');
                $(this).find('span').addClass('ui-icon-plus');
                $('#div-link-sender').hide('blind');
            }


        });
        $('#toggle-link-receiver').click(function () {
            var $span = $(this).find('span');

            if ($span.hasClass('ui-icon-plus')) {
                $(this).find('span').removeClass('ui-icon-plus');
                $(this).find('span').addClass('ui-icon-minus');
                $('#div-link-receiver').show('blind');
            } else {
                $(this).find('span').removeClass('ui-icon-minus');
                $(this).find('span').addClass('ui-icon-plus');
                $('#div-link-receiver').hide('blind');
            }
        });
    }
    function putLinkParamsets() {
        var sender = $('#edit-linkparamset-sender').val();
        var receiver = $('#edit-linkparamset-receiver').val();
        putLinkParamset('sender-receiver', sender, receiver, function() {
            putLinkParamset('receiver-sender', receiver, sender);
        });
    }
    function putLinkParamset(direction, channel1, channel2, callback) {
        var values = {};
        var count = 0;
        $('[id^="linkparamset-input-' + direction + '"]').each(function () {
            var $input = $(this);
            if (!$input.is(':disabled')) {
                var parts = $input.attr('id').split('-', 5);
                var param = parts[4];
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

                // Überspringe Param falls keine Änderung stattgefunden hat
                if (
                    (val === true && dataValPrev === 'true') ||
                    (val === false && dataValPrev === 'false') ||
                    (val == dataValPrev) ||
                    (!isNaN(dataValPrev) && parseFloat(dataValPrev) == parseFloat(val))
                ) return;

                // aktualisiere data-val-prev - falls auf prn 0 (expert) zurückgeschaltet wird werden diese werte verwendet
                $input.attr('data-val-prev', val);

                // calculate value if unit is "100%"
                if ($input.attr('data-unit') == '100%') {
                    val /= 100;
                }

                // datentypen für rpc konvertieren
                switch (dataType) {
                    case 'BOOL':
                        if (val == 'true') {
                            val = true;
                        } else if (val == 'false') {
                            val = false;
                        } else if (typeof val !== 'boolean') {
                            val = !!val;
                        }
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
            console.log('putParamset', channel1, channel2, values);
            rpcDialog(daemon, 'putParamset', [channel1, channel2, values], function (err, res) {
                if (typeof callback === 'function') {
                    callback(err, res);
                }
            });
        } else if (typeof(callback) === 'function') {
            callback(null, null);
        }
    }
    function dialogLinkparamset(data0, data1, desc1, data2, desc2, sender, receiver) {
        console.log('dialogLinkparamset', sender, receiver);
        $('#save-link-info').button('disable');
        $('#edit-link-input-name').val(data0.NAME);
        $('#edit-link-input-description').val(data0.DESCRIPTION);

        linkReceiverData = data2;
        linkReceiverDesc = desc2;

        var senderType = indexChannels[sender] && indexChannels[sender].TYPE;
        var receiverType = indexChannels[receiver] && indexChannels[receiver].TYPE;

        linkSenderType = senderType;
        linkReceiverType = receiverType;

        //console.log('dialogLinkparamset ' + sender + ' (' + senderType + ') ' + receiver + ' (' + receiverType + ')');

        var profiles = easymodes[receiverType] && easymodes[receiverType][senderType];
        if (!profiles) profiles = {"0":{"params":{},"name":"expert"}};

        // Profil-Select befüllen
        $selectLinkparamsetProfile.html('');
        for (var id in profiles) {
            var selected;
            var name = (easymodes.lang[language] &&
                easymodes.lang[language][receiverType] &&
                easymodes.lang[language][receiverType].GENERIC &&
                easymodes.lang[language][receiverType].GENERIC[profiles[id].name])
                ||
                (easymodes.lang[language] &&
                easymodes.lang[language].GENERIC &&
                easymodes.lang[language].GENERIC && easymodes.lang[language].GENERIC[profiles[id].name])
                ||
                profiles[id].name;

            if (data2.UI_HINT == id) {
                selected = ' selected';
            } else {
                selected = '';
            }
            $selectLinkparamsetProfile.append('<option value="' + id + '"' + selected + '>' + name + '</option>')

        }

        $selectLinkparamsetProfile.multiselect('refresh');

        // Tabelle befüllen
        formLinkParamset($('#table-linkparamset1'), data1, desc1, 'sender-receiver', senderType, receiverType);
        formLinkParamset($('#table-linkparamset2'), data2, desc2, 'receiver-sender', senderType, receiverType, profiles);

        // Dialog-Überschrift setzen
        var name = (names && names[sender] ? names[sender] : '');

        if (names[receiver]) {
            name = name + ' -> ' + names[receiver];
        }

        name += ' (PARAMSET ' + sender + ' ' + receiver + ')';

        $('div[aria-describedby="dialog-linkparamset"] span.ui-dialog-title').html(name);

        // Hidden-Hilfsfelder
        $('#edit-linkparamset-sender').val(sender);
        $('#edit-linkparamset-receiver').val(receiver);
        $('#link-sender-params').attr('data-address', sender);
        $('#link-receiver-params').attr('data-address', receiver);
        $('#link-sender').html(names[sender] + ' (' + sender + ')');
        $('#link-receiver').html(names[receiver] + ' (' + receiver + ')');

        // Buttons
        $('button.paramset-setValue:not(.ui-button)').button();

        $('button.linkparamset-save').button('disable');

        $('.linkparamset-input, .easymode-param, #linkparamset-profile').change(function () {
            $('button.linkparamset-save').button('enable');
        });

        $dialogLinkparamset.dialog('open');
        $dialogLinkparamset.tooltip({
            open: function (event, ui) {
                ui.tooltip.css("max-width", "500px");
            },
            content: function () {
                return $(this).prop('title');
            }
        });
    }
    function elementEasyMode(options, val) {
        //console.log('elementEasyMode', options, val)
        var form = '';
        switch (options.option) {
            case "RAMPTIME":
                var selectOptions = [
                    {value: 0, text: easymodes.lang[language].GENERIC['none']},
                    {value: 0.2, text: '0.2s'},
                    {value: 0.5, text: '0.5s'},
                    {value: 1, text: '1s'},
                    {value: 2, text: '2s'},
                    {value: 5, text: '5s'},
                    {value: 10, text: '10s'},
                    {value: 20, text: '20s'},
                    {value: 30, text: '30s'},
                    {value: 99999999, text: easymodes.lang[language].GENERIC['enterValue']}
                ];

                form += '<select class="easymode-select-input" id="">';
                selectOptions.forEach(function (option) {
                    form += '<option value="' + option.value + '"';
                    if (option.value == parseFloat(val).toFixed(6)) {
                        form += ' selected="selected">' + option.text + '</option>';
                    } else {
                        form += '>' + option.text + '</option>';
                    }

                });
                form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

                break;
            case "LENGTH_OF_STAY":
                var selectOptions = [
                    {value: 1, text: '1s'},
                    {value: 2, text: '2s'},
                    {value: 5, text: '5s'},
                    {value: 10, text: '10s'},
                    {value: 30, text: '30s'},
                    {value: 60, text: '60s'},
                    {value: 120, text: '120s'},
                    {value: 300, text: '300s'},
                    {value: 600, text: '10min'},
                    {value: 1800, text: '30min'},
                    {value: 3600, text: '1h'},
                    {value: 7200, text: '2h'},
                    {value: 10800, text: '3h'},
                    {value: 18000, text: '5h'},
                    {value: 28800, text: '8h'},
                    {value: 43200, text: '12h'},
                    {value: 86400, text: '24h'},
                    {value: 111600, text: easymodes.lang[language].GENERIC['unlimited']},
                    {value: 99999999, text: easymodes.lang[language].GENERIC['enterValue']}
                ];

                form += '<select class="easymode-select-input" id="">';
                selectOptions.forEach(function (option) {
                    form += '<option value="' + option.value + '"';
                    if (option.value == parseFloat(val).toFixed(6)) {
                        form += ' selected="selected">' + option.text + '</option>';
                    } else {
                        form += '>' + option.text + '</option>';
                    }

                });
                form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

                break;

            case "DIM_ONLEVEL":
                var selectOptions = [
                    {value: 10, text: '10%'},
                    {value: 20, text: '20%'},
                    {value: 30, text: '30%'},
                    {value: 40, text: '40%'},
                    {value: 50, text: '50%'},
                    {value: 60, text: '60%'},
                    {value: 70, text: '70%'},
                    {value: 80, text: '80%'},
                    {value: 90, text: '90%'},
                    {value: 100, text: '100%'},
                    {value: 100.5, text: easymodes.lang[language].GENERIC['lastValue']},
                    {value: 99999998, text: easymodes.lang[language].GENERIC['enterValue']},
                ];
                form += '<select class="easymode-select-input" id="">';
                selectOptions.forEach(function (option) {
                    form += '<option value="' + option.value + '"';
                    if (option.value == parseFloat(val).toFixed(6)) {
                        form += ' selected="selected">' + option.text + '</option>';
                    } else {
                        form += '>' + option.text + '</option>';
                    }

                });
                form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

                break;
            case "DIM_OFFLEVEL":
                var selectOptions = [
                    {value: 0, text: '0%'},
                    {value: 10, text: '10%'},
                    {value: 20, text: '20%'},
                    {value: 30, text: '30%'},
                    {value: 40, text: '40%'},
                    {value: 50, text: '50%'},
                    {value: 60, text: '60%'},
                    {value: 70, text: '70%'},
                    {value: 80, text: '80%'},
                    {value: 90, text: '90%'},
                    {value: 100.5, text: easymodes.lang[language].GENERIC['lastValue']},
                    {value: 99999998, text: easymodes.lang[language].GENERIC['enterValue']},
                ];
                form += '<select class="easymode-select-input" id="">';
                selectOptions.forEach(function (option) {
                    form += '<option value="' + option.value + '"';
                    if (option.value == parseFloat(val).toFixed(6)) {
                        form += ' selected="selected">' + option.text + '</option>';
                    } else {
                        form += '>' + option.text + '</option>';
                    }

                });
                form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

                break;

            case "DELAY":
                var selectOptions = [
                    {value: 0, text: easymodes.lang[language].GENERIC['none']},
                    {value: 5, text: '5s'},
                    {value: 10, text: '10s'},
                    {value: 30, text: '30s'},
                    {value: 60, text: '60s'},
                    {value: 120, text: '120s'},
                    {value: 300, text: '300s'},
                    {value: 600, text: '10min'},
                    {value: 1800, text: '30min'},
                    {value: 3600, text: '1h'},
                    {value: 99999999, text: easymodes.lang[language].GENERIC['enterValue']}
                ];

                form += '<select class="easymode-select-input" id="">';
                selectOptions.forEach(function (option) {
                    form += '<option value="' + option.value + '"';
                    if (option.value != val) {
                        form += '>' + option.text + '</option>';
                    } else {
                        form += ' selected="selected">' + option.text + '</option>';
                    }

                });
                form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';


                break;



            default:
                //console.log('elementEasyMode', options.option);
                var param = options.combo[0];
                var $tpl = $('#linkparamset-input-receiver-sender-' + param);
                var $copy = $tpl.clone();
                $copy.removeAttr('id').addClass('easymode-param').attr('data-binds', options.combo);
                return $copy[0].outerHTML;
                break;
        }
        return form;

    }
    function formEasyMode(data, desc, direction, sType, rType, prn) {
        $('#linkparamset-input-receiver-sender-UI_HINT').val(prn);

        var receiverType;
        var senderType;

        //if (config.daemons[daemon].type.toLowerCase() === 'bidcos-wired' || config.daemons[daemon].type === 'hs485d') {
        //    receiverType = 'HMW_' + rType;
        //    senderType = 'HMW_' + sType;
        //} else {
        receiverType = rType;
        senderType = sType;
        //}


        var profiles = easymodes[receiverType] && easymodes[receiverType][senderType];
        if (!profiles) profiles = {"0":{"params":{},"name":"expert"}};

        if (!prn) {
            $tableEasymode.html('');
            $('h4.easymode').html('');

            $('.easymode').hide();

            $('[id^="linkparamset-input-receiver-sender-"]').each(function () {
                $(this).val($(this).attr('data-val-prev'));
            });

            $('#table-linkparamset2').show();
        } else {
            $tableEasymode.html('');
            var options = profiles && profiles[prn] && profiles[prn].options;
            var params = profiles && profiles[prn] && profiles[prn].params;
            var heading = easymodes.lang[language] &&
                easymodes.lang[language][receiverType] &&
                easymodes.lang[language][receiverType][senderType] &&
                easymodes.lang[language][receiverType][senderType]['description_' + prn];
            $('h4.easymode').html(heading);
            if (!options) return;

            for (var id in params) {
                if (params[id].readonly) {
                    var val = (params[id] && params[id].val) || data[id];
                    if (desc[id] && desc[id].UNIT === '100%') val *= 100;
                    $('[id="linkparamset-input-receiver-sender-' + id + '"]').val(val);
                }
            }
            for (var param in options) {
                $tableEasymode.append('<tr><td>' +
                easymodes.lang[language].PNAME[options[param].desc] +
                '</td><td style="font-size: 8px"></td><td>' +
                elementEasyMode(options[param], data[options[param].combo[0]]) + '</td></tr>');

            }

            $('#table-linkparamset2').hide();
            $('.easymode').show();

        }
    }
    function formLinkParamset(elem, data, desc, direction, senderType, receiverType, profiles) {

        elem.show().html('<tr><th class="paramset-1">Param</th><th class="paramset-2">&nbsp;</th><th class="paramset-3">Value</th><th class="paramset-4">Default</th><th></th></tr>');
        var count = 0;
        var resultArr = [];
        for (var param in desc) {
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
                var helpentry = help_linkParamset[language] && help_linkParamset[language][param.replace('SHORT_', '').replace('LONG_', '')];
                var help;
                if (helpentry && helpentry.helpText) {
                    help = helpentry.helpText;
                } else {
                    help = helpentry || '';
                }

                var disabled = desc[param].OPERATIONS & 2;
                var hidden = param === 'UI_HINT';

                switch (desc[param].TYPE) {
                    case 'BOOL':
                        input = '<input class="linkparamset-input" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="checkbox" value="true" data-val-prev="' + data[param] + '" data-type="BOOL" ' + (data[param] ? ' checked="checked"' : '') + (disabled ? '' : ' disabled="disabled"') + '/>';
                        break;
                    case 'INTEGER':
                        input = '<input class="linkparamset-input" data-unit="' + desc[param].UNIT + '" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="number" min="' + desc[param].MIN + '" max="' + desc[param].MAX + '" value="' + data[param] + '" data-val-prev="' + data[param] + '" data-type="INTEGER"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                        break;
                    case 'ENUM':
                        input = '<select class="linkparamset-input" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" data-val-prev="' + data[param] + '" data-type="INTEGER"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                        for (var i = desc[param].MIN; i <= desc[param].MAX; i++) {
                            input += '<option value="' + i + '"' + (data[param] == i ? ' selected="selected"' : '') + '>' + desc[param].VALUE_LIST[i] + '</option>';
                            if (helpentry) {
                                if (i == desc[param].MIN) {
                                    help += '<br/><ul>';
                                }
                                if (helpentry.params[desc[param].VALUE_LIST[i]]) {
                                    help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>: ' + helpentry.params[desc[param].VALUE_LIST[i]] + (i < desc[param].MAX ? '<br/>' : '');
                                } else {
                                    help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>';
                                }
                                if (i == desc[param].MAX) {
                                    help += '</ul>';
                                }
                            }
                        }
                        input += '</select>';
                        defaultVal = desc[param].VALUE_LIST[defaultVal];
                        break;
                    case 'FLOAT':
                        data[param] = parseFloat(parseFloat(data[param]).toFixed(6));
                    default:
                        input = '<input class="linkparamset-input" data-unit="' + desc[param].UNIT + '" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="text" value="' + data[param] + '" data-val-prev="' + data[param] + '" data-type="FLOAT"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                }
                var helpIcon = help ? '<img src="images/help.png" width="16" height="16" title="' + help + '">' : '';

                resultArr.push({order:desc[param].TAB_ORDER, fragment:'<tr style="' + (hidden ? 'display:none;' : '') + '"><td>' + param + '</td><td>' + helpIcon + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + unit + '</td></tr>'});
            } else {
                resultArr.push({order:desc[param].TAB_ORDER, fragment:'<tr style="' + (hidden ? 'display:none;' : '') + '"><td>' + param + '</td><td colspan = "4">' + data[param] + '</td></tr>'});
            }


        }

        if (count == 0) {
            elem.hide();
            if (direction === 'sender-receiver') {
                $('#toggle-link-sender').hide();
            }
        } else {
            if (direction === 'sender-receiver') {
                $('#toggle-link-sender').show();
            }
            resultArr.sort(function (a, b) {
                return a.order - b.order;
            });
            for (var i = 0; i < resultArr.length; i++) {
                elem.append(resultArr[i].fragment);
            }
        }
        if (direction === 'receiver-sender') formEasyMode(data, desc, direction, senderType, receiverType, data.UI_HINT);
    }
    function dialogRemoveLink() {
        var rowId = $gridLinks.jqGrid('getGridParam','selrow');
        var sender = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_SENDER"]').html();
        var receiver = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_RECEIVER"]').html();
        var name = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_NAME"]').html();
        var desc = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_DESCRIPTION"]').html();
        var sendername = names && names[sender] ? names[sender] : '';
        var receivername = names && names[receiver] ? names[receiver] : '';

        $('div[aria-describedby="dialog-remove-link"] span.ui-dialog-title').html('Direktverknüpfung zwischen ' + sender + ' und ' + receiver + ' löschen');

        $tableDeleteLink.html('<tr><td>Sender:</td><td>' + sender + ' (' + sendername + ')</td></tr>');
        $tableDeleteLink.append('<tr><td>Empfänger:</td><td>' + receiver + ' (' + receivername + ')</td></tr>');
        $tableDeleteLink.append('<tr><td>Name:</td><td>' + name + '</td></tr>');
        $tableDeleteLink.append('<tr><td>Beschreibung:</td><td>' + desc + '</td></tr>');

        // Hidden-Hilfsfelder
        $('#delete-link-sender').val(sender);
        $('#delete-link-receiver').val(receiver);
        $('#delete-link-rowid').val(rowId);

        $dialogRemoveLink.dialog('open');
    }
    function getLink(sender, receiver, row) {
        $('#edit-linkparamset-row').val(row);
        $('#load_grid-links').show();
        rpcAlert(daemon, 'getLinkInfo', [sender, receiver], function (err0, data0) {
            rpcAlert(daemon, 'getParamset', [sender, receiver], function (err1, data1) {
                rpcAlert(daemon, 'getParamsetDescription', [sender, receiver], function (err2, data2) {
                    rpcAlert(daemon, 'getParamset', [receiver, sender], function (err3, data3) {
                        rpcAlert(daemon, 'getParamsetDescription', [receiver, sender], function (err4, data4) {
                            dialogLinkparamset(data0, data1, data2, data3, data4, sender, receiver);
                            $('#load_grid-links').hide();
                        });
                    });
                });
            });
        });
    }
    function activateLinkParamset(receiver, sender, long) {
        rpcDialog(daemon, 'activateLinkParamset', [receiver, sender, long || false]);
    }

    // RF
    function getRfdData() {
        if (config.daemons[daemon].type == 'BidCos-RF') {
            $('#load_grid-interfaces').show();
            rpcAlert(daemon, 'listBidcosInterfaces', [], function (err, data) {
                listInterfaces = data;
                initGridRssi();
                $('#load_grid-rssi').show();
                rpcAlert(daemon, 'rssiInfo', [], function (err, data) {
                    listRssi = data;
                    refreshGridRssi();
                    getServiceMessages();
                });
                refreshGridInterfaces();
            });
        }
    }
    function initGridRssi() {
        if (!$gridRssi.hasClass('ui-jqgrid-btable')) {
            var colNamesRssi = ['Name', 'ADDRESS', 'TYPE', 'INTERFACE', 'RF_ADDRESS', 'ROAMING'];
            var colModelRssi = [
                // TODO Name und Type fixed:false - Überschrifts und Inhaltsspalten stimmen nicht mehr... :-(
                {name: 'Name', index: 'Name', width: 250, fixed: true},
                {name: 'ADDRESS', index: 'ADDRESS', width: 84, fixed: true},
                {name: 'TYPE', index: 'TYPE', width: 140, fixed: true},
                {name: 'INTERFACE', index: 'INTERFACE', width: 84, fixed: true},
                {name: 'RF_ADDRESS', index: 'RF_ADDRESS', width: 75, fixed: true},
                {name: 'roaming', index: 'ROAMING', width: 57, fixed: true, search: false, align: 'center'}
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
                    align: 'right',
                    formatter: rssiColor
                });
                colModelRssi.push({
                    name: listInterfaces[i].ADDRESS + '_1',
                    index: listInterfaces[i].ADDRESS + '_1',
                    width: 47,
                    fixed: true,
                    search: false,
                    align: 'right',
                    formatter: rssiColor
                });
                colModelRssi.push({
                    name: listInterfaces[i].ADDRESS + '_set',
                    index: listInterfaces[i].ADDRESS + '_set',
                    width: 28,
                    fixed: true,
                    search: false,
                    align: 'center'
                });
                groupHeaders.push({
                    startColumnName: listInterfaces[i].ADDRESS + '_0',
                    numberOfColumns: 3,
                    titleText: listInterfaces[i].ADDRESS + '<br/><span style="font-size: 9px;">(' + listInterfaces[i].DESCRIPTION + ')</span>'
                });
            }


            $gridRssi.jqGrid({
                colNames: colNamesRssi,
                colModel: colModelRssi,
                datatype: 'local',
                rowNum: 100,
                autowidth: false,
                width: '1000',
                height: 600,
                rowList: [25, 50, 100, 500],
                pager: $('#pager-rssi'),
                sortname: 'timestamp',
                viewrecords: true,
                sortorder: 'desc',
                caption: 'RSSI',
                subGrid: true,
                ignoreCase: true,
                subGridOptions: {
                    expandOnLoad: false
                },
                subGridRowExpanded: function (grid_id, row_id) {
                    subGridRssi(grid_id, row_id);
                },
                onSelectRow: function (rowid, iRow, iCol, e) {

                },
                gridComplete: function () {

                },
                ondblClickRow: function (rowid, iRow, iCol, e) {
                    removeSelectionAfterDblClick();
                    $gridRssi.jqGrid('toggleSubGridRow', rowid);
                }

            }).navGrid('#pager-rssi', {
                search: false,
                edit: false,
                add: false,
                del: false,
                refresh: false
            }).jqGrid('filterToolbar', {
                defaultSearch: 'cn',
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
                    getRfdData();
                },
                position: 'first',
                id: 'refresh-rssi',
                title: _('Refresh'),
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
            var $subgrid = $('#' + subgrid_table_id);
            $subgrid.jqGrid(gridConf);

            var address = $('#grid-rssi tr#' + row_id + ' td[aria-describedby="grid-rssi_ADDRESS"]').html();
            var partners = listRssi[address];
            var i = 0;
            var rowData = [];
            for (var partner in partners) {
                var obj = {
                    ADDRESS: partner,
                    Name: (names && names[partner] ? names[partner] : ''),
                    TYPE: (indexDevices[partner] ? indexDevices[partner].TYPE : ''),
                    'RSSI-Receive': rssiColor(partners[partner][0]),
                    'RSSI-Send': rssiColor(partners[partner][1])
                };
                obj._id = i;
                rowData.push(obj);
                i += 1;
            }
            $subgrid.jqGrid('addRowData', '_id', obj);
        }

        $body.on('click', '.interface-set', function () {
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
            rpcAlert(daemon, 'setBidcosInterface', [$(this).attr('data-device'), listInterfaces[$(this).attr('data-iface-index')].ADDRESS, false]);
        });

        $body.on('change', '.checkbox-roaming', function () {
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
            rpcAlert(daemon, 'setBidcosInterface', [$(this).attr('data-device'), listInterfaces[0].ADDRESS, $(this).is(':checked')]);
        });
    }
    function refreshGridRssi() {
        $gridRssi.jqGrid('clearGridData');

        indexDevices = {};

        var j = 0;
        for (var i = 0, len = listInterfaces.length; i < len; i++) {
            indexDevices[listInterfaces[i].ADDRESS] = listInterfaces[i];
            // TODO - performance improvement, add all rows at once!
            $gridRssi.jqGrid('addRowData', j++, {
                Name: '',
                ADDRESS: listInterfaces[i].ADDRESS,
                TYPE: listInterfaces[i].TYPE
            });
        }

        var rowData = [];

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
            line._id = j++;
            rowData.push(line);


        }
        $gridRssi.jqGrid('addRowData', '_id', rowData);
        $gridRssi.trigger('reloadGrid');

    }
    function refreshGridInterfaces() {
        $gridInterfaces.jqGrid('clearGridData');
        for (var i = 0, len = listInterfaces.length; i < len; i++) {
            $gridInterfaces.jqGrid('addRowData', i, listInterfaces[i]);
        }
        $gridInterfaces.trigger('reloadGrid');
    }

    // Service Messages
    function initGridMessages() {

        $gridMessages.jqGrid({
            colNames: ['Name', 'ADDRESS', 'DeviceAddress', 'Message'],
            colModel: [
                {name:'Name',index:'Name', width:420, fixed: true},
                {name:'ADDRESS',index:'ADDRESS', width:110, fixed: true},
                {name:'DeviceAddress',index:'DeviceAddress', width:110, fixed: true},
                {name:'Message',index:'Message', width:150, fixed: false}
            ],
            datatype:   'local',
            rowNum:     100,
            autowidth:  true,
            width:      '1000',
            height:     'auto',
            rowList:    [25,50,100,500],
            pager:      $('#pager-messages'),
            sortname:   'timestamp',
            viewrecords: true,
            sortorder:  'desc',
            caption:    _('Service messages'),
            onSelectRow: function (rowid, iRow, iCol, e) {
                if ($('#grid-messages tr#' + rowid + ' td[aria-describedby="grid-messages_Message"]').html().match(/STICKY/)) {
                    $('#accept-message').removeClass('ui-state-disabled');
                } else {
                    $('#accept-message').addClass('ui-state-disabled');
                }
            },
            gridComplete: function () {

            }
        }).navGrid('#pager-messages', {
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
        }).jqGrid('navButtonAdd', '#pager-messages', {
            caption: '',
            buttonicon: 'ui-icon-check',
            onClickButton: function () {
                var address = $('#grid-messages tr#' + $gridMessages.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-messages_ADDRESS"]').html();
                var key = $('#grid-messages tr#' + $gridMessages.jqGrid('getGridParam','selrow') + ' td[aria-describedby="grid-messages_Message"]').html();
                rpcAlert(daemon, 'setValue', [address, key, false], function (err) {
                    if (!err) getRfdData(); // todo hier sollte doch eigentlich refreshServicemessages reichen?
                });
            },
            //position: 'first',
            id: 'accept-message',
            title: _('Acknowledge service messages'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-messages', {
            caption: '',
            buttonicon: 'ui-icon-circle-check',
            onClickButton: function () {
                var acceptQueue = [];
                for (var i = 0, len = listMessages.length; i < len; i++) {
                    var address = listMessages[i][0];
                    if (listMessages[i][1].match(/STICKY/)) {
                        acceptQueue.push([address, listMessages[i][1], false]);
                    }
                }
                function popQueue() {
                    var params = acceptQueue.pop();
                    rpcAlert(daemon, 'setValue', params, function () {
                        if (acceptQueue.length > 0)  {
                            popQueue();
                        } else {
                            getRfdData();
                        }
                    });
                }
                popQueue();
            },
            //position: 'first',
            id: 'accept-messages',
            title: _('Acknowledge all service messages'),
            cursor: 'pointer'
        }).jqGrid('navButtonAdd', '#pager-messages', {
            caption: '',
            buttonicon: 'ui-icon-refresh',
            onClickButton: getServiceMessages,
            position: 'first',
            id: 'refresh-messages',
            title: _('Refresh'),
            cursor: 'pointer'
        });

    }
    function refreshGridMessages() {
        if (!listMessages) {
            setTimeout(refreshGridMessages, 250);
            return;
        }
        $gridMessages.jqGrid('clearGridData');
        $('#accept-message').addClass('ui-state-disabled');
        $('#accept-messages').addClass('ui-state-disabled');
        var acceptableMessages = false;
        var rowData = [];
        for (var i = 0, len = listMessages.length; i < len; i++) {
            var deviceAddress = listMessages[i][0].slice(0, listMessages[i][0].length - 2);
            var name = '';
            if (names[deviceAddress]) name = names[deviceAddress];
            if (listMessages[i][1].match(/STICKY/)) acceptableMessages = true;
            var obj = {
                _id: i,
                Name: name,
                ADDRESS: listMessages[i][0],
                DeviceAddress: deviceAddress,
                Message: listMessages[i][1]
            };
            rowData.push(obj);

        }
        $gridMessages.jqGrid('addRowData', '_id', rowData);
        if (acceptableMessages) {
            $('#accept-messages').removeClass('ui-state-disabled');
        }
        $('#message-count').html(listMessages.length);
        $gridMessages.trigger('reloadGrid');
    }
    function getServiceMessages() {
        $('#load_grid-messages').show();
        rpcAlert(daemon, 'getServiceMessages', [], function (err, data) {
            if (!err) {
                listMessages = data;
                refreshGridMessages();
            }
        });
    }

    // RPC Console
    function initConsole() {
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
        $consoleRpcMethod.change(function () {
            var method = $consoleRpcMethod.val();
            if (method == 'null') {
                $consoleRpcSend.attr('disabled', true);
            } else {
                $consoleRpcSend.removeAttr('disabled').button('refresh');
            }
            if (rpcMethods[method]) {
                formConsoleParams();
            } else {
                $('#console-rpc-params').val('');
                $('#console-rpc-error').html('');
                $('#console-rpc-method-heading').html(method);
                $consoleFormParams.html('');
                $('#console-rpc-method-help').html('');

            }
        });
        $consoleRpcSend.attr('disabled', true).button().click(function() {
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
        $consoleFormParams.on('change', 'input', setConsoleParams);
        $consoleFormParams.on('change', 'select', function () {
            setConsoleParams(this);
        });

    }
    function elementConsoleMethod() {
        $('#console-rpc-help').html('');
        $consoleRpcMethod.html('<option value="null" selected="selected">' + _('Please select method') + '</option>');
        $consoleRpcResponse.html('');
        if (daemon == 'null') {
            $consoleRpcSend.attr('disabled', true).button('refresh');
            return;
        }

        rpcAlert(daemon, 'system.listMethods', [], function (err, data) {
            if (err) {
                return;
            }
            for (var i = 0; i < data.length; i++) {
                var method = data[i];
                $consoleRpcMethod.append('<option value="' + method + '">' + method + '</option>');
            }
            $consoleRpcMethod.multiselect('refresh');
        });
    }
    function formConsoleParams() {
        $('#console-rpc-params').val('');
        $('#console-rpc-error').html('');
        setValueDesc = null;
        var method = $consoleRpcMethod.val();
        if (rpcMethods[method].help[language]) {
            $('#console-rpc-method-help').html(rpcMethods[method].help[language]);
        } else {
            $('#console-rpc-method-help').html(rpcMethods[method].help.de);
        }
        var params = rpcMethods[method].params;
        var heading = '<span style="color:#777">' + rpcMethods[method].returns + '</span> ' + method + '(';
        var paramArr = [];
        var form = '';
        var selectOptions
        for (var i = 0; i < params.length; i++) {

            switch (params[i].type) {
                case 'integer':
                    if (params[i].bitmask) {
                        form += '<tr><td colspan="3">' + params[i].name + '</td></tr>';
                        for (var val in params[i].bitmask) {
                            form += '<tr><td style="padding-left: 6px;"><label for="bitmask_param_' + val + '_' + i + '">' + params[i].bitmask[val] + '</label></td><td></td><td><input class="console-param-checkbox" type="checkbox" value="' + val + '" name="bitmask_param_' + val + '_' + i + '" id="bitmask_param_' + val + '_' + i + '"/></td></tr>';
                        }
                    } else if (params[i].values) {
                        selectOptions = '<option value="">Bitte auswählen</option>';
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
                    selectOptions = '<option value="">Bitte auswählen</option>';
                    for (var j = 0, len = listDevices.length; j < len; j++) {
                        if (listDevices[j].PARENT) continue;
                        if (listDevices[j].ADDRESS.match(/BidCoS/)) continue;
                        var name = names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '';

                        selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'channel_address':
                    selectOptions = '<option value="">Bitte auswählen</option>';
                    for (var j = 0, len = listDevices.length; j < len; j++) {
                        if (!listDevices[j].PARENT) continue;
                        if (listDevices[j].ADDRESS.match(/:0$/)) continue;
                        var name = names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '';

                        selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'address':
                    selectOptions = '<option value="">' + _('Please select') + '</option>';
                    for (var j = 0, len = listDevices.length; j < len; j++) {
                        var name = names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '';

                        selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'interface_address':
                    selectOptions = '<option value="">' + _('Please select') + '</option>';
                    for (var j = 0, len = listInterfaces.length; j < len; j++) {
                        selectOptions += '<option value="' + listInterfaces[j].ADDRESS + '">' + listInterfaces[j].ADDRESS + ' ' + listInterfaces[j].TYPE + '</option>';
                    }
                    form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-simple" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                    break;
                case 'paramset_type':
                    selectOptions = '<option value="MASTER">MASTER</option>';
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
        $consoleFormParams.html('<table>' + form + '</table>');
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
    function setConsoleParams(elem) {
        var paramArr = [];
        var method = $consoleRpcMethod.val();

        var param0 = $('#param_0').val();
        if (method == 'setValue' && $(elem).attr('id') == 'param_0' && param0) {
            $('#param_1').val('...').attr('disabled', true);
            rpcAlert(daemon, 'getParamsetDescription', [param0, 'VALUES'], function (err, data) {
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

    // RPC execution Wrappers
    function rpcDialog(daemon, cmd, params, callback) {
        $('#rpc-command').html(cmd + ' ' + params[0]);
        $('#rpc-message').html('');
        $dialogRpc.dialog('open');
        $('#rpc-progress').show()
        socket.emit('rpc', daemon, cmd, params, function (err, res) {
            $('#rpc-progress').hide();
            if (err) {
                $('#rpc-message').html('<span style="color: red; font-weight: bold;">' + (err.faultString ? err.faultString : JSON.stringify(err)) + '</span>');
            } else if (res !== '') {
                $('#rpc-message').html('<span style="color: orange; font-weight: bold;">' + res.faultString + '</span>');
            } else {
                $('#rpc-message').html('<span style="color: green;">success</span><br>' + res);
                setTimeout(function () {
                    $dialogRpc.dialog('close');
                }, 1000);
            }
            if (typeof callback === 'function') callback(err, res);
        });
    }
    function rpcAlert(daemon, cmd, params, callback) {
        socket.emit('rpc', daemon, cmd, params, function (err, res) {
            if (err) {
                alert(JSON.stringify(err));
            } else if (res.faultCode) {
                alert(JSON.stringify(res));
            }
            if (typeof callback === 'function') callback(err, res);
        });
    }

    // Helper functions
    function rssiColor(rssi) {
        if (typeof rssi === 'undefined' || rssi === '' || rssi == 65536) return '';

        var RSSI_BAD = -120.0;
        var RSSI_MEDIUM = -100.0;
        var RSSI_GOOD = -20.0;

        var red = Math.round(256 * (rssi - RSSI_GOOD) / (RSSI_MEDIUM - RSSI_GOOD));
        if (red < 0) red = 0;
        if (red > 255) red = 255;

        var green = Math.round(256 * (rssi - RSSI_BAD) / (RSSI_MEDIUM - RSSI_BAD));
        if (green < 0) green = 0;
        if (green > 255) green = 255;

        var color =  '#' + ('0' + red.toString(16)).slice(-2) + ('0' + green.toString(16)).slice(-2) + '00';
        return '<span class="rssi-cell" style="background-color:' + color + ';">' + rssi + '</span>';
    }
    function removeSelectionAfterDblClick() {
        if(document.selection && document.selection.empty) {
            document.selection.empty();
        } else if(window.getSelection) {
            var sel = window.getSelection();
            sel.removeAllRanges();
        }
    }

    // Resizing
    function resizeGrids() {
        var x = $(window).width();
        var y = $(window).height();
        if (x < 1200) x = 1200;
        if (y < 600) y = 600;

        $('#grid-devices, #grid-links, #grid-messages').setGridHeight(y - 148).setGridWidth(x - 18);
        $('#grid-events').css('height', (y - 84) + 'px').css('width', (x - 18) + 'px');
        $('#grid-events-inner').css('height', (y - 104) + 'px');
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
    $(window).resize(resizeGrids);

    // Navigation
    window.onhashchange = function () {
        var tmp = window.location.hash.slice(1).split('/');
        hash = tmp[1];
        if (config.daemons[hash]) {
            if (daemon != hash) {
                daemon = hash;
                $('#select-bidcos-daemon option').removeAttr('selected');
                $('#select-bidcos-daemon option[value="' + daemon + '"]').attr('selected', true);
                $selectBidcosDaemon.multiselect('refresh');
                initDaemon();
            }
        } else {
            daemon = null;
            $('#select-bidcos-daemon option').removeAttr('selected');
            $selectBidcosDaemon.multiselect('refresh');
            initDaemon();
        }
        if (tmp[2]) {
            var index = $('#tabs-main a[href="#' + tmp[2] + '"]').parent().index();
            $tabsMain.tabs("option", "active", index - 2);
        }

    };

});
})(jQuery);
