/* global $, window, document, alert */
/* eslint-disable import/no-unassigned-import */

const ipc = require('electron').ipcRenderer;
const Rpc = require('electron-ipc-rpc');

const ipcRpc = new Rpc(ipc);

window.$ = require('jquery');

window.jQuery = window.$;

require('jquery-ui-dist/jquery-ui.min');
require('ui-contextmenu/jquery.ui-contextmenu');
require('jquery-ui-multiselect-widget/src/jquery.multiselect');
require('jquery-ui-multiselect-widget/src/jquery.multiselect.filter');
require('free-jqgrid/dist/jquery.jqgrid.min')(window, $);
require('free-jqgrid/dist/i18n/grid.locale-de')(window, $);

$.extend($.jgrid.defaults, { autoencode: false });

const async = require('async');

const deviceImages = require('./deviceImages.json');
const helpLinkParamset = require('./helpLinkParamset.json');
const rpcMethods = require('./rpcMethods.json');
const translation = require('./language.json');

const missesTranslation = {};

let language = 'de';

let daemon;
let daemonType;
let config = {};
let listDevices;
let indexDevices;
let indexChannels = {};
let indexSourceRoles = {};
let indexTargetRoles = {};
let listLinks;
let listRssi;
let listInterfaces;
let listMessages;
let names = {};
let hash;
let firstLoad = true;

const easymodes = {lang: {}};

let linkReceiverData;
let linkReceiverDesc;
let linkSenderType;
let linkReceiverType;

let setValueParamsetDescription;
let setValueDesc;

let rpcDialogPending = false;

const $body = $('body');
const $gridDevices = $('#grid-devices');
const $gridLinks = $('#grid-links');
const $gridRssi = $('#grid-rssi');
const $gridMessages = $('#grid-messages');
const $gridInterfaces = $('#grid-interfaces');

const $tableEasymode = $('#table-easymode');
const $tableParamset = $('#table-paramset');
const $tableDeleteLink = $('#table-delete-link');

const $consoleRpcMethod = $('#console-rpc-method');
const $consoleRpcSend = $('#console-rpc-send');
const $consoleRpcResponse = $('#console-rpc-response');
const $consoleFormParams = $('#console-form-params');

const $selectLinkparamsetProfile = $('#linkparamset-profile');
const $linkSourceRoles = $('#link-source-roles');
const $selectLinkSender = $('#select-link-sender');
const $selectLinkReceiver = $('#select-link-receiver');
const $selectReplace = $('#select-replace');
const $selectParamsetMultiselect = $('#select-paramset-multiselect');
const $selectLinkParamsetMultiselect = $('#select-linkparamset-multiselect');

let $selectBidcosDaemon;    // Assigned after ui initialization, see initTabs()

const $tabsMain = $('#tabs-main');

const $dialogLinkparamset = $('#dialog-linkparamset');
const $dialogDisconnect = $('#dialog-disconnect');
const $dialogAddDevice = $('#dialog-add-device');
const $dialogAddCountdown = $('#dialog-add-countdown');
const $dialogDelDevice = $('#dialog-del-device');
const $dialogRename = $('#dialog-rename');
const $dialogParamset = $('#dialog-paramset');
const $dialogRemoveLink = $('#dialog-remove-link');
const $dialogAddLink = $('#dialog-add-link');
const $dialogServicemessage = $('#dialog-servicemessage');
const $dialogAlert = $('#dialog-alert');
const $dialogRpc = $('#dialog-rpc');
const $dialogHelp = $('#dialog-help');
const $dialogConfig = $('#dialog-config');
const $dialogReplace = $('#dialog-replace');

// Entrypoint
getConfig();

ipcRpc.on('disconnect', () => {
    $dialogDisconnect.dialog('open');
});

ipcRpc.on('connection', connected => {
    connected = connected[0];
    let connections = '';
    Object.keys(connected).forEach(d => {
        if (connected[d]) {
            connections += d + ' <span style="color:green">✔</span> ';
        } else {
            connections += d + ' <span style="color:red">✕</span> ';
        }
    });
    $('#connection-indicator').html(`${config.ccuAddress}<br><span style="font-size: 8px; font-weight: normal;">${connections}</span>`);
});

// Incoming Events
ipcRpc.on('rpc', data => {
    const [method, params] = data;
    if (!config || !daemon) {
        return;
    }
    const daemonIdent = params[0];
    if (daemonIdent !== config.daemons[daemon].ident) {
        return;
    }
    switch (method) {
        case 'newDevices': {
            const devArr = params[1];
            $('div.ui-dialog[aria-describedby="dialog-alert"] .ui-dialog-title').html(_('New devices'));
            let count = 0;
            let output = '';
            for (let i = 0; i < devArr.length; i++) {
                if (devArr[i].ADDRESS.match(/:/)) {
                    continue;
                }
                count += 1;
                output += '<br/>' + devArr[i].ADDRESS + ' (' + devArr[i].TYPE + ')';
            }
            $('#alert').html('<h3>' + count + ' ' + _('New') + (count > 1 ? '' : (language === 'de' ? 's' : '')) + ' ' + _('Device') + (count === 1 ? '' : (language === 'de' ? 'e' : 's')) + ' ' + _('introduced') + ':</h3>' + output);
            $('#dialog-alert').dialog('open');
            getDevices(() => {
                getLinks(() => {
                    getRfdData();
                });
            });
            break;
        }
        case 'deleteDevices': {
            const devArr = params[1];
            $('div.ui-dialog[aria-describedby="dialog-alert"] .ui-dialog-title').html(_('Devices deleted'));
            let count = 0;
            let output = '';
            for (let i = 0; i < devArr.length; i++) {
                if (devArr[i].match(/:/)) {
                    continue;
                }
                count += 1;
                output += '<br/>' + devArr[i];
            }
            $('#alert').html('<h3>' + count + ' ' + _('device') + (count === 1 ? '' : (language === 'de' ? 'e' : 's')) + ' ' + _('deleted') + ':</h3>' + output);
            $('#dialog-alert').dialog('open');
            getDevices(() => {
                getLinks(() => {
                    getRfdData();
                });
            });
            break;
        }
        case 'replaceDevice': {
            getNames(() => {
                getDevices(() => {
                    getLinks(() => {
                        getRfdData();
                    });
                });
            });
            break;
        }
        case 'event': {
            const [, address, param, value] = params;

            const timestamp = new Date();
            const ts = timestamp.getFullYear() + '-' +
                ('0' + (timestamp.getMonth() + 1).toString(10)).slice(-2) + '-' +
                ('0' + (timestamp.getDate()).toString(10)).slice(-2) + ' ' +
                ('0' + (timestamp.getHours()).toString(10)).slice(-2) + ':' +
                ('0' + (timestamp.getMinutes()).toString(10)).slice(-2) + ':' +
                ('0' + (timestamp.getSeconds()).toString(10)).slice(-2);

            const name = names && names[address] ? names[address] : '';

            $('#event-table').prepend('<tr class="ui-widget-content jqgrow ui-row-ltr "><td class="event-column-1">' + ts + '</td><td class="event-column-2">' + name + '</td><td class="event-column-3">' + address + '</td><td class="event-column-4">' + param + '</td><td class="event-column-5">' + value + '</td></tr>');

            // Service-Meldung?
            if (!listMessages) {
                listMessages = [];
            }
            if (address.endsWith(':0') && (param !== 'RSSI_PEER' && param !== 'RSSI_DEVICE')) {
                let done;
                if (value) {
                    // Muss Meldung hinzugefügt werden?
                    done = false;
                    for (let i = 0; i < listMessages.length; i++) {
                        if (listMessages[i][0] === address && listMessages[i][1] === param) {
                            done = true;
                        }
                    }

                    // Dialog für neue Servicemeldung anzeigen
                    if (!done && !config.disableServiceMsgPopup) {
                        const devAddress = address.slice(0, -2);
                        const devName = names && names[devAddress] ? names[devAddress] : '';
                        $('#service-device').html(devName + ' (' + devAddress + ')');
                        $('#service-param').html(param);
                        $dialogRpc.dialog('close');
                        $dialogServicemessage.dialog('open');
                    }
                } else {
                    // Muss Meldung gelöscht werden?
                    done = true;
                    for (let i = 0; i < listMessages.length; i++) {
                        if (listMessages[i][0] === address && listMessages[i][1] === param) {
                            done = false;
                        }
                    }
                }
                if (!done) {
                    getServiceMessages();
                }
            }

            // Werte im UI aktualisieren
            $('[data-address="' + address + '"][data-param="' + param + '"]').each(function () {
                const $this = $(this);
                const elem = $this[0].nodeName;
                const type = $this.attr('type');
                let val = value;
                if ($this.attr('data-unit') === '100%') {
                    val = (value || 0) * 100;
                }

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
        }
        default:
    }
});

// I18n
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
        const $this = $(this);
        $this.html(_($this.html()));
    });
    $('.translateT').each(function () {
        const $this = $(this);
        $this.attr('title', _($this.attr('title')));
    });
}

function getConfig() {
    firstLoad = true;
    ipcRpc.send('getConfig', [], (err, data) => {
        config = data;

        $('.version').html(config.version);
        language = config.language || 'de';

        $.getJSON('easymodes/localization/' + language + '/GENERIC.json', data => {
            if (!easymodes.lang[language]) {
                easymodes.lang[language] = {};
            }
            easymodes.lang[language].GENERIC = data;
            $.getJSON('easymodes/localization/' + language + '/PNAME.json', data => {
                // Console.log('easymode loaded pname', data);
                easymodes.lang[language].PNAME = data;
            });
        });

        translate();

        initTabs();
        initDialogsMisc();
        initDialogParamset();
        initDialogLinkParamset();

        initGridDevices();
        initGridMessages();
        initGridLinks();
        initConsole();

        $('#loader').hide();

        if (!config.ccuAddress) {
            dialogConfigOpen();
        }

        const tmp = window.location.hash.slice(1).split('/');
        hash = tmp[1];

        let count = 0;
        if ($selectBidcosDaemon) {
            $selectBidcosDaemon.html('');
            Object.keys(config.daemons).forEach(daemon => {
                count += 1;
                $selectBidcosDaemon.append('<option value="' + daemon + '"' + (hash === daemon ? ' selected' : '') + '>' + daemon + /* ' (' + 'http://' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ') */ '</option>');
            });
            if (count === 1) {
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
        }
        if (tmp[2]) {
            const index = $('#tabs-main a[href="#' + tmp[2] + '"]').parent().index();
            $tabsMain.tabs('option', 'active', index - 2);
        }

        getNames(() => {
            initDaemon();
            // At this point everything should be initialized
            $dialogDisconnect.dialog('close');
        });
    });
    ipcRpc.send('getConfig');
}
function getNames(callback) {
    ipcRpc.send('getNames', [], (err, data) => {
        names = data;
        if (typeof callback === 'function') {
            callback();
        }
    });
}
function initTabs() {
    $tabsMain.tabs({

        activate(event, ui) {
            resizeGrids();
            const tab = ui.newTab[0].children[0].hash.slice(1);
            if (hash) {
                window.location.hash = '/' + hash + '/' + tab;
            }
        },
        create() {
            $('#tabs-main ul.ui-tabs-nav').prepend('<li><select id="select-bidcos-daemon"></select></li>');
            $selectBidcosDaemon = $('#select-bidcos-daemon');

            $selectBidcosDaemon.change(() => {
                initDaemon();
            });

            $('#tabs-main ul.ui-tabs-nav').prepend('<li class=""></li>');

            $('.ui-tabs-nav')
                .append('<button title=\'Help\' class=\'menu-button translateT\' id=\'button-help\'></button>')
                .append('<button title=\'Settings\' value=\'Settings\' class=\'menu-button translateT\' id=\'button-config\'></button>')
                // .append("<span style='visibility: hidden; width:15px; height:15px; padding-top:5px; margin-right:10px; float:right;'><span title='Kommunikation' id='ajaxIndicator' style='width:15px; height: 15px;' class='ui-icon ui-icon-transfer-e-w'></span></span>")
                .append('<div id="connection-indicator"></div>');

            $('#button-help').button({
                text: false,
                icons: {
                    primary: 'ui-icon-help'
                }
            }).click(() => {
                $dialogHelp.dialog('open');
            });

            $('#button-config').button({
                text: false,
                icons: {
                    primary: 'ui-icon-gear'
                }
            }).click(() => {
                dialogConfigOpen();
            });
        }
    });
}
function initDialogsMisc() {
    $dialogDisconnect.dialog({
        modal: true,
        autoOpen: false,
        closeOnEscape: false,
        open() {
            $(this).parent().children().children('.ui-dialog-titlebar-close').hide();
        }
    });
    $dialogRpc.dialog({
        modal: true,
        autoOpen: false,
        closeOnEscape: false,
        width: 400,
        height: 400,
        open() {
            $(this).parent().children().children('.ui-dialog-titlebar-close').hide();
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
        height: 240,
        buttons: [
            {
                text: _('OK'),
                click() {
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
        height: 400,
        buttons: [
            {
                text: _('Save & Restart'),
                click() {
                    $(this).dialog('close');
                    config.rpcInitIp = $.trim($('#init-ip-select').val());
                    config.ccuAddress = $.trim($('#ccu-address').val());
                    ipcRpc.send('config', [config]);
                }
            },
            {
                text: _('Cancel'),
                click() {
                    $(this).dialog('close');
                }
            }
        ]
    });
    $('#ccu-address-select').change(() => {
        $('#ccu-address').val($('#ccu-address-select').val());
        $('#ccu-address-select').val('Select');
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
    $('#accept-message').addClass('ui-state-disabled');
    $('#accept-messages').addClass('ui-state-disabled');
    $('#del-device').addClass('ui-state-disabled');
    $('#replace-device').addClass('ui-state-disabled');
    $('#edit-device').addClass('ui-state-disabled');
    $('#edit-link').addClass('ui-state-disabled');
    $('#rename-link').addClass('ui-state-disabled');
    $('#play-link').addClass('ui-state-disabled');
    $('#play-link-long').addClass('ui-state-disabled');
    $('#del-link').addClass('ui-state-disabled');

    const tmp = window.location.hash.slice(1).split('/');

    if (tmp[1] && firstLoad) {
        daemon = tmp[1];
    }
    firstLoad = false;

    if (daemon && config.daemons[daemon]) {
        const type = config.daemons[daemon].type;
        daemonType = config.daemons[daemon].type;

        let tmpHash = '#/' + daemon;

        if (type === 'BidCos-Wired' && (tmp[2] === 'rssi' || tmp[2] === 'messages')) {
            tmp[2] = 'devices';
            $tabsMain.tabs('option', 'active', 0);
        }
        if (tmp[2]) {
            tmpHash += '/' + tmp[2];
        }

        window.location.hash = tmpHash;

        $('.dselect').hide();
        $('.show-rf').hide();
        $('.show-wired').hide();
        $('.show-hmip').hide();
        $('.show-cuxd').hide();
        $('#replace-device, #update-device, #clear-device, #add-device, #restore-device').show();

        if (type === 'BidCos-Wired') {
            $('.show-wired').show();

            $('.dselect.' + type).show();
            $('#play-link').hide();
            $('#play-link-long').hide();
            // $gridDevices.jqGrid('hideCol', 'roaming');
            $gridDevices.jqGrid('hideCol', 'rx_mode');
            // $gridDevices.jqGrid('hideCol', 'RF_ADDRESS');
            // $gridDevices.jqGrid('hideCol', 'INTERFACE');
            resizeGrids();
        } else if (type === 'CUxD') {
            $('.show-cuxd').show();
            $('.dselect.' + type).show();
            $('#play-link').hide();
            $('#play-link-long').hide();
        } else if (type === 'HmIP') {
            $('.show-hmip').show();
            $('#play-link').hide();
            $('#play-link-long').hide();
            $('#replace-device, #update-device, #clear-device, #add-device, #restore-device').hide();
            $('.dselect').show();
            $gridDevices.jqGrid('showCol', 'rx_mode');
            resizeGrids();
        } else {
            $('.show-rf').show();
            $('.dselect').show();
            $('#play-link').show();
            $('#play-link-long').show();
            // $gridDevices.jqGrid('showCol', 'roaming');
            $gridDevices.jqGrid('showCol', 'rx_mode');
            // $gridDevices.jqGrid('showCol', 'RF_ADDRESS');
            // $gridDevices.jqGrid('showCol', 'INTERFACE');
            resizeGrids();
        }

        $('#event-table').html('');

        getDevices(err => {
            if (err) {
                dialogAlert(err.syscall + ' ' + daemon + ' (' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ')<br><br><span style="color: red;">' + err.code + '</span>', _('Error'));
                return;
            }
            getLinks(() => {
                getRfdData();
            });
            elementConsoleMethod();
        });
    } else {
        window.location.hash = '';
    }
}

// Devices
function getDevices(callback) {
    $('#load_grid-devices').show();
    ipcRpc.send('rpc', [daemon, 'listDevices'], (err, data) => {
        indexChannels = {};
        indexSourceRoles = {};
        indexTargetRoles = {};
        $('#load_grid-devices').hide();
        listDevices = data;
        if (typeof callback === 'function') {
            callback(err);
        }
        if (err) {
            return;
        }
        refreshGridDevices();
        for (let i = 0; i < listDevices.length; i++) {
            indexChannels[listDevices[i].ADDRESS] = listDevices[i];
            if (listDevices[i].LINK_SOURCE_ROLES) {
                const roles = listDevices[i].LINK_SOURCE_ROLES.split(' ');
                for (let j = 0; j < roles.length; j++) {
                    if (!indexSourceRoles[roles[j]]) {
                        indexSourceRoles[roles[j]] = [];
                    }
                    indexSourceRoles[roles[j]].push(listDevices[i].ADDRESS);
                }
            }
            if (listDevices[i].LINK_TARGET_ROLES) {
                const roles = listDevices[i].LINK_TARGET_ROLES.split(' ');
                for (let j = 0; j < roles.length; j++) {
                    if (!indexTargetRoles[roles[j]]) {
                        indexTargetRoles[roles[j]] = [];
                    }
                    indexTargetRoles[roles[j]].push(listDevices[i].ADDRESS);
                }
            }
        }
    });
}
function initGridDevices() {
    $gridDevices.jqGrid({
        colNames: ['', 'Name', 'ADDRESS', 'TYPE', 'FIRMWARE', 'PARAMSETS', 'FLAGS', /* 'INTERFACE', 'RF_ADDRESS', */ /* 'ROAMING', */ 'RX_MODE'/* , 'VERSION' */],
        colModel: [
            {name: 'img', index: 'img', width: 22, fixed: true, classes: 'device-cell', align: 'center', search: false},
            {name: 'Name', index: 'Name', width: 160, fixed: false, classes: 'device-cell'},
            {name: 'ADDRESS', index: 'ADDRESS', width: 140, fixed: true, classes: 'device-cell'},
            {name: 'TYPE', index: 'TYPE', width: 140, fixed: false, classes: 'device-cell'},
            {name: 'FIRMWARE', index: 'FIRMWARE', width: 80, fixed: true, classes: 'device-cell'},
            {name: 'params', index: 'params', width: 120, fixed: true, classes: 'device-cell', search: false},
            {name: 'flags', index: 'flags', width: 150, fixed: true, classes: 'device-cell'},
            // {name:'INTERFACE',index:'INTERFACE', width:70},
            // {name:'RF_ADDRESS',index:'RF_ADDRESS', width:70},
            // {name:'roaming',index:'roaming', width:30, hidden: true},
            {name: 'rx_mode', index: 'rx_mode', width: 150, fixed: true, classes: 'device-cell'}
            // {name:'VERSION',index:'VERSION', width:60, fixed: true, align:'right'}
        ],
        datatype: 'local',
        rowNum: 100,
        autowidth: true,
        width: '1000',
        height: 600,
        rowList: [25, 50, 100, 500],
        pager: $('#pager-devices'),
        sortname: 'timestamp',
        viewrecords: true,
        sortorder: 'desc',
        caption: _('Devices'),
        subGrid: true,
        ignoreCase: true,
        subGridRowExpanded(gridId, rowId) {
            subGridChannels(gridId, rowId);
        },
        ondblClickRow(rowid) {
            removeSelectionAfterDblClick();
            $gridDevices.jqGrid('toggleSubGridRow', rowid);
        },
        onSelectRow(rowid) {
            $('#reportValueUsage-0').addClass('ui-state-disabled');
            $('#reportValueUsage-1').addClass('ui-state-disabled');

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
        gridComplete() {
            $gridDevices.jqGrid('hideCol', 'cb');
            $('button.paramset:not(.ui-button)').button();
            $('#del-device').addClass('ui-state-disabled');
            $('#replace-device').addClass('ui-state-disabled');
            $('#update-device').addClass('ui-state-disabled');
            $('#restore-device').addClass('ui-state-disabled');
            $('#clear-device').addClass('ui-state-disabled');
            $('#edit-device').addClass('ui-state-disabled');
            $('#reportValueUsage-0').addClass('ui-state-disabled');
            $('#reportValueUsage-1').addClass('ui-state-disabled');
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
    }).jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-transfer-e-w',
        onClickButton() {
            const address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
            replaceDevice(address);
        },
        position: 'first',
        id: 'replace-device',
        title: _('Replace device'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-devices', {
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
        buttonicon: 'ui-icon-pin-w',
        onClickButton() {
            reportValueUsage(0);
        },
        position: 'first',
        id: 'reportValueUsage-0',
        title: 'reportValueUsage 0',
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-devices', {
        caption: '',
        buttonicon: 'ui-icon-pin-s',
        onClickButton() {
            reportValueUsage(1);
        },
        position: 'first',
        id: 'reportValueUsage-1',
        title: 'reportValueUsage 1',
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
        onClickButton() {
            if (daemonType === 'BidCos-Wired') {
                rpcDialog(daemon, 'searchDevices', ['']);
            } else {
                $dialogAddDevice.dialog('open');
            }
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
        delegate: 'td.device-cell',
        menu: [
            {title: _('Rename'), cmd: 'rename', uiIcon: 'ui-icon-pencil'},
            {title: _('MASTER Paramset'), cmd: 'paramsetMaster', uiIcon: 'ui-icon-gear'},
            {title: _('SERVICE Paramset'), cmd: 'paramsetService', uiIcon: 'ui-icon-gear', addClass: 'show-hmip'},
            {title: '----'},
            {title: _('restoreConfigToDevice'), cmd: 'restoreConfigToDevice', uiIcon: 'ui-icon-comment', addClass: 'show-rf'},
            {title: _('clearConfigCache'), cmd: 'clearConfigCache', uiIcon: 'ui-icon-arrowrefresh-1-w', addClass: 'show-rf'},
            {title: '----'},
            {title: _('updateFirmware'), cmd: 'updateFirmware', uiIcon: 'ui-icon-script', addClass: 'show-rf'},
            {title: _('Replace'), cmd: 'replace', uiIcon: 'ui-icon-transfer-e-w', addClass: 'show-rf'},
            {title: _('Delete'), cmd: 'delete', uiIcon: 'ui-icon-trash'}

        ],
        select(event, ui) {
            const cmd = ui.cmd;
            const address = ui.target.parent().find('[aria-describedby$="_ADDRESS"]').text();
            switch (cmd) {
                case 'paramsetMaster':
                    getParamset(address, 'MASTER');
                    break;
                case 'paramsetService':
                    getParamset(address, 'SERVICE');
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
                case 'replace':
                    replaceDevice(address);
                    break;
                default:
                    alert('todo ' + cmd + ' on ' + address); // eslint-disable-line no-alert
            }
        }
    });

    $('#del-device').addClass('ui-state-disabled');
    $('#replace-device').addClass('ui-state-disabled');
    $('#edit-device').addClass('ui-state-disabled');

    $dialogReplace.dialog({
        autoOpen: false,
        modal: true,
        width: 540,
        height: 320,
        buttons: [
            {
                text: _('Cancel'),
                click() {
                    $(this).dialog('close');
                }
            },
            {
                text: _('Replace'),
                click() {
                    const newAddress = $('#replace-new').val();
                    const oldAddress = $selectReplace.val();
                    $(this).dialog('close');
                    rpcDialog(daemon, 'replaceDevice', [oldAddress, newAddress]);
                }
            }
        ]
    });
    $selectReplace.multiselect({
        // Classes: '',
        multiple: false,
        // Header: false,
        height: 160,
        selectedList: 1,
        minWidth: 480
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });
    $dialogAddDevice.dialog({
        autoOpen: false,
        modal: true,
        width: 540,
        height: 320,
        buttons: [
            {
                text: _('Cancel'),
                click() {
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
                click() {
                    $dialogDelDevice.dialog('close');
                    const address = $('#del-device-address').val();
                    const flags = parseInt($('#del-device-flag-0').val(), 10) + parseInt($('#del-device-flag-1').val(), 10);
                    rpcDialog(daemon, 'deleteDevice', [address, flags]);
                }
            },
            {
                text: _('Cancel'),
                click() {
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
                click() {
                    const $that = $(this);
                    const renameAddress = $('#rename-address').val();
                    const renameName = $('#rename-name').val();
                    const rowid = $('#rename-rowid').val();
                    const gridid = $('#rename-gridid').val();

                    const queue = [];
                    queue.push({address: renameAddress, name: renameName});

                    let rowData;
                    if (renameAddress.match(/:/)) {
                        // Rename Channel
                        const $gridCh = $('#' + gridid);
                        rowData = $gridCh.jqGrid('getRowData', rowid);
                        rowData.Name = renameName;
                        $gridCh.jqGrid('setRowData', rowid, rowData);
                        if (!names) {
                            names = {};
                        }
                        names[renameAddress] = renameName;
                        refreshGridLinks();
                    } else {
                        // Rename Device
                        rowData = $gridDevices.jqGrid('getRowData', rowid);
                        rowData.Name = renameName;
                        $gridDevices.jqGrid('setRowData', rowid, rowData);

                        if (!names) {
                            names = {};
                        }
                        names[renameAddress] = renameName;
                        names[renameAddress + ':0'] = renameName + ':0';
                        queue.push({address: renameAddress + ':0', name: renameName + ':0'});

                        const renameChildren = $('#rename-children').is(':checked');
                        const children = indexChannels[renameAddress].CHILDREN;

                        for (let i = 0; i < listDevices.length; i++) {
                            if (listDevices[i].ADDRESS === renameAddress) {
                                listDevices[i].Name = renameName;
                            }
                            if (renameChildren && (children.indexOf(listDevices[i].ADDRESS) !== -1)) {
                                listDevices[i].Name = renameName + ':' + children.indexOf(listDevices[i].ADDRESS);
                            }
                        }

                        if (renameChildren) {
                            children.forEach(child => {
                                names[child] = renameName + ':' + children.indexOf(child);
                                // Console.log('setName', child, names[child]);
                                // ipcRpc.send('setName', [child, names[child]]);
                                queue.push({address: child, name: names[child]});
                            });
                        }

                        const scrollPosition = $gridDevices.closest('.ui-jqgrid-bdiv').scrollTop();
                        $gridDevices.jqGrid('toggleSubGridRow', rowid);
                        $gridDevices.jqGrid('toggleSubGridRow', rowid);
                        $gridDevices.closest('.ui-jqgrid-bdiv').scrollTop(scrollPosition);

                        if (config.daemons[daemon].type === 'BidCos-RF') {
                            refreshGridRssi();
                        }


                    }
                    ipcRpc.send('setNames', [queue], () => {});

                    $that.dialog('close');
                }
            },
            {
                text: _('Cancel'),
                click() {
                    $(this).dialog('close');
                }
            }
        ]
    });

    $('#add-device-address-start').button().click(() => {
        $dialogAddDevice.dialog('close');
        const mode = parseInt($('#add-device-mode').val(), 10);
        const address = $('#add-device-address').val();
        rpcDialog(daemon, 'addDevice', [address, mode]);
    });
    $('#add-device-time-start').button().click(() => {
        const mode = parseInt($('#add-device-mode').val(), 10);
        let time = parseInt($('#add-device-time').val(), 10);
        if (isNaN(time)) {
            time = 60;
        }
        if (time > 300) {
            time = 300;
        }
        $dialogAddDevice.dialog('close');
        rpcAlert(daemon, 'setInstallMode', [true, time, mode], err => {
            if (!err) {
                $('#add-countdown').html(time);
                $dialogAddCountdown.dialog('open');
                let addInterval = setInterval(() => {
                    time -= 1;
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

    function subGridChannels(gridId, rowId) {
        const subgridTableId = 'channels_' + rowId + '_t';
        $('#' + gridId).html('<table id="' + subgridTableId + '"></table>');
        const gridConf = {
            datatype: 'local',
            colNames: [
                'Name',
                'ADDRESS',
                'TYPE',
                'DIRECTION',
                'PARAMSETS',
                'FLAGS',
                config.daemons[daemon].type === 'BidCos-RF' ? 'AES_ACTIVE' : ''
                // 'LINK_SOURCE_ROLES',
                // 'LINK_TARGET_ROLES',
                // 'VERSION'
            ],
            colModel: [
                {name: 'Name', index: 'Name', width: 172, fixed: false, classes: 'channel-cell'},
                {name: 'ADDRESS', index: 'ADDRESS', width: 140, fixed: true, classes: 'channel-cell'},
                {name: 'TYPE', index: 'TYPE', width: 140, fixed: false, classes: 'channel-cell'},
                {name: 'direction', index: 'direction', width: 80, fixed: true, classes: 'channel-cell'},
                {name: 'params', index: 'params', width: 120, fixed: true, classes: 'channel-cell'},
                {name: 'flags', index: 'flags', width: 150, fixed: true, classes: 'channel-cell'},
                {
                    name: 'aes_active',
                    index: 'aes_active',
                    width: 148,
                    fixed: true,
                    classes: 'channel-cell'
                }
                // {name: 'LINK_SOURCE_ROLES', index: 'LINK_SOURCE_ROLES', width: 100, hidden: true},
                // {name: 'LINK_TARGET_ROLES', index: 'LINK_TARGET_ROLES', width: 100, hidden: true},
                // {name: 'VERSION', index: 'VERSION', width: 58, fixed: true, align: 'right'}
            ],
            rowNum: 1000000,
            autowidth: true,
            height: 'auto',
            width: 1000,
            sortorder: 'desc',
            viewrecords: true,
            ignoreCase: true,
            onSelectRow(rowId) {
                // Unselect other subgrids but not myself
                $('[id^="channels_"][id$="_t"]').not('#' + this.id).jqGrid('resetSelection');

                // Unselect devices grid
                $gridDevices.jqGrid('resetSelection');

                $('#del-device').addClass('ui-state-disabled');

                const rowData = $('#' + this.id).jqGrid('getRowData', rowId);

                if (rowData.Name.endsWith(':0')) {
                    $('#edit-device').addClass('ui-state-disabled');
                    $('#reportValueUsage-0').addClass('ui-state-disabled');
                    $('#reportValueUsage-1').addClass('ui-state-disabled');
                } else {
                    $('#edit-device').removeClass('ui-state-disabled');
                    $('#reportValueUsage-0').removeClass('ui-state-disabled');
                    $('#reportValueUsage-1').removeClass('ui-state-disabled');
                }

                $('#replace-device').addClass('ui-state-disabled');
                $('#restore-device').addClass('ui-state-disabled');
                $('#update-device').addClass('ui-state-disabled');
                $('#clear-device').addClass('ui-state-disabled');
            },
            gridComplete() {
                // $subgrid.jqGrid('hideCol', 'cb');
                $('button.paramset:not(.ui-button)').button();
            }
        };
        const $subgrid = $('#' + subgridTableId);
        $subgrid.jqGrid(gridConf);

        const rowData = [];
        for (let i = 0, len = listDevices.length; i < len; i++) {
            if (listDevices[i].PARENT === listDevices[rowId].ADDRESS) {
                if (names[listDevices[i].ADDRESS]) {
                    listDevices[i].Name = names[listDevices[i].ADDRESS];
                }

                let paramsets = '';
                for (let j = 0; j < listDevices[i].PARAMSETS.length; j++) {
                    if (listDevices[i].PARAMSETS[j] === 'LINK' || listDevices[i].PARAMSETS[j] === 'SERVICE') {
                        continue;
                    }
                    const idButton = 'paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j];
                    paramsets += '<button class="paramset device-table" data-address="' + listDevices[i].ADDRESS + '" data-paramset="' + listDevices[i].PARAMSETS[j] + '" id="' + idButton + '">' + listDevices[i].PARAMSETS[j] + '</button>';
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
        delegate: 'td.channel-cell',
        menu: [
            {title: _('Rename'), cmd: 'rename', uiIcon: 'ui-icon-pencil'},
            // {title: _("addLink"), cmd: "addLink", uiIcon: "ui-icon-arrow-2-e-w"},
            {title: 'reportValueUsage 1', cmd: 'reportValueUsage-1', uiIcon: 'ui-icon-pin-s'},
            {title: 'reportValueUsage 0', cmd: 'reportValueUsage-0', uiIcon: 'ui-icon-pin-w'},
            {title: _('MASTER Paramset'), cmd: 'paramsetMaster', uiIcon: 'ui-icon-gear'},
            {title: _('VALUES Paramset'), cmd: 'paramsetValues', uiIcon: 'ui-icon-gear'}

        ],
        beforeOpen(event, ui) {
            const address = ui.target.parent().find('[aria-describedby$="_ADDRESS"]').text();

            if (address.endsWith(':0')) {
                $body.contextmenu('enableEntry', 'rename', false);
                $body.contextmenu('enableEntry', 'reportValueUsage-0', false);
                $body.contextmenu('enableEntry', 'reportValueUsage-1', false);
            } else {
                $body.contextmenu('enableEntry', 'rename', true);
                $body.contextmenu('enableEntry', 'reportValueUsage-0', true);
                $body.contextmenu('enableEntry', 'reportValueUsage-1', true);
            }
        },
        select(event, ui) {
            const cmd = ui.cmd;
            const address = ui.target.parent().find('[aria-describedby$="_ADDRESS"]').text();
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
                case 'reportValueUsage-1':
                    reportValueUsage(1);
                    break;
                case 'reportValueUsage-0':
                    reportValueUsage(0);
                    break;
                default:
                    alert('todo ' + cmd + ' on ' + address); // eslint-disable-line no-alert
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
    const rowData = [];
    for (let i = 0, len = listDevices.length; i < len; i++) {
        if (listDevices[i].RF_ADDRESS) {
            listDevices[i].RF_ADDRESS = parseInt(listDevices[i].RF_ADDRESS, 10).toString(16);
        }

        const rxMode = [];
        if (listDevices[i].RX_MODE & 1) {
            rxMode.push('ALWAYS');
        }
        if (listDevices[i].RX_MODE & 2) {
            rxMode.push('BURST');
        }
        if (listDevices[i].RX_MODE & 4) {
            rxMode.push('CONFIG');
        }
        if (listDevices[i].RX_MODE & 8) {
            rxMode.push('WAKEUP');
        }
        if (listDevices[i].RX_MODE & 16) {
            rxMode.push('LAZY_CONFIG');
        }
        listDevices[i].rx_mode = rxMode.join(' '); // eslint-disable-line camelcase

        let flags = '';
        if (listDevices[i].FLAGS & 1) {
            flags += 'Visible ';
        }
        if (listDevices[i].FLAGS & 2) {
            flags += 'Internal ';
        }
        if (listDevices[i].FLAGS & 8) {
            flags += 'DontDelete ';
        }
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

        listDevices[i].aes_active = listDevices[i].AES_ACTIVE ? listDevices[i].AES_ACTIVE = '<span style="display:inline-block; vertical-align:bottom" class="ui-icon ui-icon-key"></span>' : ''; // eslint-disable-line camelcase

        if (names[listDevices[i].ADDRESS]) {
            listDevices[i].Name = names[listDevices[i].ADDRESS];
        }

        let paramsets = '';
        for (let j = 0; j < listDevices[i].PARAMSETS.length; j++) {
            paramsets += '<button class="paramset device-table" data-address="' + listDevices[i].ADDRESS + '" data-paramset="' + listDevices[i].PARAMSETS[j] + '" id="paramset_' + listDevices[i].ADDRESS + '_' + listDevices[i].PARAMSETS[j] + '">' + listDevices[i].PARAMSETS[j] + '</button>';
        }
        listDevices[i].params = paramsets;
        if (!listDevices[i].PARENT) {
            listDevices[i]._id = i;
            listDevices[i].img = '<img class="device-image" src="' + (deviceImages[listDevices[i].TYPE] || deviceImages.DEVICE) + '">';
            rowData.push(listDevices[i]);
        }
    }
    $gridDevices.jqGrid('addRowData', '_id', rowData);
    $gridDevices.trigger('reloadGrid').sortGrid('Name', false, 'asc');
    $('button.paramset:not(.ui-button)').button();
}
function replaceDevice() {
    const address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
    ipcRpc.send('rpc', [daemon, 'listReplaceableDevices', [address]], (err, data) => {
        if (err) {
            alert(_('RPC error') + '\n\n' + JSON.stringify(err)); // eslint-disable-line no-alert
            return;
        }
        if (data.length === 0) {
            alert(_('Replace Device') + ':\n' + _('No suitable device available')); // eslint-disable-line no-alert
        } else {
            $selectReplace.html('');
            data.forEach(dev => {
                if (!dev.ADDRESS.match(/:[0-9]+$/)) {
                    $selectReplace.append('<option value="' + dev.ADDRESS + '">' + names[dev.ADDRESS] + ' (' + dev.ADDRESS + ')</option>');
                }
            });
            $selectReplace.multiselect('refresh');
            $('#replace-new').val(address);
            $dialogReplace.dialog('open');
        }
    });
}
function updateFirmware() {
    const address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
    rpcDialog(daemon, 'updateFirmware', [address]);
}
function restoreConfigToDevice() {
    const address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
    rpcDialog(daemon, 'restoreConfigToDevice', [address]);
}
function clearConfigCache() {
    const address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
    rpcDialog(daemon, 'clearConfigCache', [address]);
}
function dialogRenameDevice() {
    const devSelected = $gridDevices.jqGrid('getGridParam', 'selrow');
    let chSelected = null;
    let chGrid = null;
    let address;
    let name;
    let rowid;
    if (devSelected) {
        address = $('#grid-devices tr#' + devSelected + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
        name = $('#grid-devices tr#' + devSelected + ' td[aria-describedby="grid-devices_Name"]').html();
        rowid = devSelected;
        $('#rename-device-only').show();
    } else {
        $('[id^="channels_"][id$="_t"]').each(function () {
            if ($(this).jqGrid('getGridParam', 'selrow') > 0) {
                chSelected = $(this).jqGrid('getGridParam', 'selrow');
                chGrid = $(this).attr('id');
            }
        });
        address = $('#' + chGrid + ' tr#' + chSelected + ' td[aria-describedby$="_ADDRESS"]').html();
        name = $('#' + chGrid + ' tr#' + chSelected + ' td[aria-describedby$="_Name"]').html();
        rowid = chSelected;
        $('#rename-device-only').hide();
    }
    $('#rename-rowid').val(rowid);
    $('#rename-gridid').val(chGrid);
    $('#rename-address').val(address);
    $('#rename-children').removeAttr('checked');
    $('#rename-name').val(name === '&nbsp;' ? '' : name);
    $dialogRename.dialog('open');
}
function reportValueUsage(value) {
    const devSelected = $gridDevices.jqGrid('getGridParam', 'selrow');
    let chSelected = null;
    let chGrid = null;
    value = value || 0;
    if (devSelected) {
        alert('error: reportValueUsage on Device'); // eslint-disable-line no-alert
        return;
    }
    $('[id^="channels_"][id$="_t"]').each(function () {
        if ($(this).jqGrid('getGridParam', 'selrow') > 0) {
            chSelected = $(this).jqGrid('getGridParam', 'selrow');
            chGrid = $(this).attr('id');
        }
    });
    const address = $('#' + chGrid + ' tr#' + chSelected + ' td[aria-describedby$="_ADDRESS"]').html();

    ipcRpc.send('rpc', [daemon, 'getParamsetDescription', [address, 'VALUES']], (err, data) => {
        const queue = [];
        Object.keys(data).forEach(param => {
            queue.push(param);
        });

        function popQueue() {
            if (queue.length > 0) {
                const param = queue.pop();
                // Console.log('reportValueUsage', address, param, value);

                ipcRpc.send('rpc', [daemon, 'reportValueUsage', [address, param, value]], () => {
                    popQueue();
                });
            }
        }

        popQueue();
    });
}
function dialogDeleteDevice() {
    const address = $('#grid-devices tr#' + $gridDevices.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-devices_ADDRESS"]').html();
    $('#del-device-name').html(names[address] ? (names[address] + ' (' + address + ')') : address);
    $('#del-device-address').val(address);
    $dialogDelDevice.dialog('open');
}
function dialogParamset(data, desc, address, paramset) {
    if (!data) {
        $('#load_grid-devices').hide();
        return;
    }

    // Tabelle befüllen
    $tableParamset.show().html('<tr><th class="paramset-1">Param</th><th class="paramset-2">&nbsp;</th><th class="paramset-3">Value</th><th class="paramset-4">Default</th><th></th></tr>');
    let count = 0;
    let writeable = false;
    let helpIcon;
    Object.keys(desc).forEach(param => {
        let unit = '';
        count += 1;
        if (desc[param]) {
            // Dirty workaround for encoding problem
            if (desc[param].UNIT === '�C') {
                desc[param].UNIT = '°C';
            }

            let defaultVal = desc[param].DEFAULT;
            // Calculate percent values
            if (desc[param].UNIT === '100%') {
                unit = '%';
                data[param] = (data[param] || 0) * 100;
                defaultVal = (defaultVal || 0) * 100;
            } else {
                unit = desc[param].UNIT || '';
                if (unit === '""') {
                    unit = '';
                }
            }

            if (typeof data[param] === 'undefined') {
                data[param] = desc[param].DEFAULT;
            }

            // Create Input-Field
            let input;
            const helpentry = helpLinkParamset[language] && helpLinkParamset[language][param.replace('SHORT_', '').replace('LONG_', '')];
            let help;
            if (helpentry && helpentry.helpText) {
                help = helpentry.helpText;
            } else {
                help = helpentry || '';
            }

            if (desc[param].OPERATIONS & 2) {
                writeable = true;
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
                    if (typeof desc[param].MIN === 'string') {
                        desc[param].MIN = desc[param].VALUE_LIST.indexOf(desc[param].MIN);
                        desc[param].MAX = desc[param].VALUE_LIST.indexOf(desc[param].MAX);
                    }
                    for (let i = desc[param].MIN; i <= desc[param].MAX; i++) {
                        input += '<option value="' + i + '"' + (data[param] === i ? ' selected="selected"' : '') + '>' + desc[param].VALUE_LIST[i] + '</option>';
                        if (helpentry) {
                            if (i === desc[param].MIN) {
                                help += '<br/><ul>';
                            }
                            if (helpentry.params[desc[param].VALUE_LIST[i]]) {
                                help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>: ' + helpentry.params[desc[param].VALUE_LIST[i]] + (i < desc[param].MAX ? '<br/>' : '');
                            } else {
                                help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>';
                            }
                            if (i === desc[param].MAX) {
                                help += '</ul>';
                            }
                        }
                    }
                    if (param === 'DISPLAY_INFORMATION') {
                        input += '<option value="2"' + (data[param] === 2 ? ' selected="selected"' : '') + '>VENT_POSITION</option>';
                        input += '<option value="3"' + (data[param] === 3 ? ' selected="selected"' : '') + '>ACTUAL_TEMPERATURE</option>';
                    }
                    input += '</select>';
                    if (typeof defaultVal !== 'string') {
                        defaultVal = desc[param].VALUE_LIST[defaultVal];
                    }
                    break;
                case 'FLOAT':
                    input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="FLOAT" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                    break;
                case 'STRING':
                    input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="STRING" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                    break;
                default:
                    console.log('unknown type', desc[param].TYPE);
                    // Todo this should not happen
                    input = '<input data-address="' + address + '" data-paramset="' + paramset + '" data-param="' + param + '" data-val-prev="' + data[param] + '" data-type="STRING" data-unit="' + desc[param].UNIT + '" id="paramset-input-' + param + '" type="text" value="' + data[param] + '"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
            }

            helpIcon = help ? '<img src="images/help.png" width="16" height="16" title="' + help + '">' : '';

            // Paramset VALUES?
            if (paramset === 'VALUES' && (desc[param].OPERATIONS & 2)) {
                $tableParamset.append('<tr><td>' + param + '</td><td>' + helpIcon + '</td><td>' + input + '</td><td>' + desc[param].DEFAULT + '</td><td><button class="paramset-setValue" id="paramset-setValue-' + param + '">setValue</button></td></tr>');
            } else {
                $tableParamset.append('<tr><td>' + param + '</td><td>' + helpIcon + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + unit + '</td></tr>');
            }
        } else {
            $tableParamset.append('<tr><td>' + param + '</td><td>' + helpIcon + '</td><td colspan = "3">' + data[param] + '</td></tr>');
        }
    });

    if (count === 0) {
        $tableParamset.hide();
    }

    // Dialog-Überschrift setzen
    let name = names && names[address] ? names[address] : '';

    name += ' (PARAMSET ' + address + ' ' + paramset + ')';

    $('div[aria-describedby="dialog-paramset"] span.ui-dialog-title').html(name);

    // Hidden-Hilfsfelder
    $('#edit-paramset-address').val(address);
    $('#edit-paramset-paramset').val(paramset);

    // Buttons
    $('button.paramset-setValue:not(.ui-button)').button();

    $selectParamsetMultiselect.html('');
    let tmpName;
    let mcount = 0;
    Object.keys(indexChannels).forEach(a => {
        if (a === address) {
            return;
        }
        if (indexChannels[address].TYPE !== indexChannels[a].TYPE) {
            return;
        }
        if ((indexChannels[address].PARENT === '') && (indexChannels[a].PARENT !== '')) {
            return;
        }
        if ((indexChannels[address].PARENT !== '') && (indexChannels[a].PARENT === '')) {
            return;
        }
        if (names[a]) {
            tmpName = names[a] + ' (' + a + ')';
        } else {
            tmpName = a;
        }
        mcount += 1;
        $selectParamsetMultiselect.append('<option value="' + a + '">' + tmpName + '</option>');
    });

    $selectParamsetMultiselect.multiselect('refresh');

    if (mcount > 0 && writeable) {
        $('#select-paramset-multiselect_ms').show();
    } else {
        $('#select-paramset-multiselect_ms').hide();
    }
    if (writeable) {
        $('#dialog-paramset-button').show();
    } else {
        $('#dialog-paramset-button').hide();
    }

    $dialogParamset.dialog('open');
    $dialogParamset.tooltip({
        open(event, ui) {
            ui.tooltip.css('max-width', '500px');
        },
        content() {
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
                click() {
                    putParamset();
                },
                id: 'dialog-paramset-button'
            }
        ]
    });
    $selectParamsetMultiselect.multiselect({
        classes: 'paramset-multi',
        multiple: true,
        // Header: false,
        height: 400,
        selectedList: 2,
        minWidth: 480,
        noneSelectedText: _('Please choose one or more channels'), // "Bitte einen oder mehrere Kanäle auswählen",
        checkAllText: _('Check all'),
        uncheckAllText: _('Uncheck all')
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });

    $body.on('click', 'button.paramset', function () {
        $('#load_grid-devices').show();
        const address = $(this).attr('data-address');
        const paramset = $(this).attr('data-paramset');
        getParamset(address, paramset);
    });
    $body.on('click', 'button.paramset-setValue', function () {
        // Address paramset and param
        const address = $('#edit-paramset-address').val();
        const parts = $(this).attr('id').split('-', 3);
        const param = parts[2];

        // Find input/select
        const $input = $(this).parent().parent().find('[id$="' + param + '"]');
        const elem = $input[0].nodeName;
        const type = $input.attr('type');
        const dataType = $input.attr('data-type');

        // Get value
        let val;
        if (elem === 'INPUT') {
            if (type === 'checkbox') {
                val = $input.is(':checked');
            } else {
                val = $input.val();
            }
        } else if (elem === 'SELECT') {
            val = $input.find('option:selected').val();
        }

        // Calculate value if unit is "100%"
        if ($input.attr('data-unit') === '100%') {
            val /= 100;
        }

        switch (dataType) {
            case 'BOOL':
                val = Boolean(val);
                break;
            case 'FLOAT':
                val = {explicitDouble: parseFloat(val)};
                break;
            case 'INTEGER':
                val = parseInt(val, 10);
                break;
            default:
                val = String(val);
        }
        rpcDialog(daemon, 'setValue', [address, param, val]);
    });
}
function getParamset(address, paramset) {
    rpcAlert(daemon, 'getParamset', [address, paramset], (err, data) => {
        if (err) {
            $('#load_grid-devices').hide();
            return;
        }
        rpcAlert(daemon, 'getParamsetDescription', [address, paramset], (err2, data2) => {
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
    const address = $('#edit-paramset-address').val();
    const paramset = $('#edit-paramset-paramset').val();
    const values = {};
    let count = 0;
    const multi = $selectParamsetMultiselect.val();
    const isMulti = Boolean(multi);

    $('[id^="paramset-input"]').each(function () {
        const $input = $(this);
        if (!$input.is(':disabled')) {
            const parts = $input.attr('id').split('-', 3);
            const param = parts[2];
            const elem = $input[0].nodeName;
            const type = $input.attr('type');
            const dataType = $input.attr('data-type');
            const dataValPrev = $input.attr('data-val-prev');

            // Get value
            let val;
            if (elem === 'INPUT') {
                if (type === 'checkbox') {
                    val = $input.is(':checked');
                } else {
                    val = $input.val();
                }
            } else if (elem === 'SELECT') {
                val = $input.find('option:selected').val();
            }

            // Changes only if not multiselect
            if (!isMulti && (val === dataValPrev || (val === true && dataValPrev === 'true') || (val === false && dataValPrev === 'false'))) {
                return;
            }

            // Todo update ui if channel aes_active is changed

            // calculate value if unit is "100%"
            if ($input.attr('data-unit') === '100%') {
                val /= 100;
            }
            switch (dataType) {

                case 'BOOL':
                    if (val === 'true') {
                        val = true;
                    } else if (val === 'false') {
                        val = false;
                    } else {
                        val = Boolean(val);
                    }
                    break;
                case 'INTEGER':
                    val = parseInt(val, 10);
                    break;
                case 'FLOAT':
                    val = {explicitDouble: parseFloat(val)};
                    break;
                default: // (STRING)
                    val = String(val);
            }

            values[param] = val;
            count += 1;
        }
    });
    if (count > 0 || isMulti) {
        rpcDialog(daemon, 'putParamset', [address, paramset, values]);
        multi.forEach(a => {
            rpcDialog(daemon, 'putParamset', [a, paramset, values]);
        });
    }
}

// Links
function getLinks(callback) {
    if (config.daemons[daemon].type === 'CUxD') {
        if (callback) {
            callback();
        }
        return;
    }
    $('#load_grid-links').show();
    rpcAlert(daemon, 'getLinks', [], (err, data) => {
        listLinks = data;
        if (callback) {
            callback();
        }
        refreshGridLinks();
    });
}
function initGridLinks() {
    $gridLinks.jqGrid({
        datatype: 'local',
        colNames: ['', 'SENDER Name', 'SENDER', 'TYPE', '', 'RECEIVER Name', 'RECEIVER', 'TYPE', 'NAME', 'DESCRIPTION'/* , 'Aktionen' */],
        colModel: [
            {name: 'img_sender', index: 'img_sender', width: 22, fixed: true, classes: 'device-cell', align: 'center', search: false},
            {name: 'Sendername', index: 'Sendername', width: 100, classes: 'link-cell'},
            {name: 'SENDER', index: 'SENDER', width: 50, classes: 'link-cell'},
            {name: 'SENDER_TYPE', index: 'SENDER_TYPE', width: 50, classes: 'link-cell'},
            {name: 'img_receiver', index: 'img_receiver', width: 22, fixed: true, classes: 'device-cell', align: 'center', search: false},
            {name: 'Receivername', index: 'Receivername', width: 100, classes: 'link-cell'},
            {name: 'RECEIVER', index: 'RECEIVER', width: 50, classes: 'link-cell'},
            {name: 'RECEIVER_TYPE', index: 'RECEIVER_TYPE', width: 50, classes: 'link-cell'},
            {name: 'NAME', index: 'NAME', width: 100, classes: 'link-cell'},
            {name: 'DESCRIPTION', index: 'DESCRIPTION', width: 100, classes: 'link-cell'}
            // {name:'ACTIONS', index:'ACTIONS', width:80}
        ],
        rowNum: 100,
        autowidth: true,
        width: '100%',
        rowList: [25, 50, 100, 500],
        pager: $('#pager-links'),
        sortname: 'timestamp',
        viewrecords: true,
        sortorder: 'desc',
        caption: _('Links'),
        ignoreCase: true,
        onSelectRow() {
            $('#del-link').removeClass('ui-state-disabled');
            $('#rename-link').removeClass('ui-state-disabled');
            $('#edit-link').removeClass('ui-state-disabled');
            $('#play-link').removeClass('ui-state-disabled');
            $('#play-link-long').removeClass('ui-state-disabled');
        },
        ondblClickRow(row) {
            removeSelectionAfterDblClick();
            const sender = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_SENDER"]').html();
            const receiver = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            getLink(sender, receiver, row);
        },
        gridComplete() {
            $gridLinks.jqGrid('hideCol', 'cb');
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
        defaultSearch: 'cn',
        autosearch: true,
        searchOnEnter: false,
        enableClear: false
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-refresh',
        onClickButton() {
            getLinks();
        },
        position: 'first',
        id: 'refresh-link',
        title: _('Refresh'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-trash',
        onClickButton() {
            dialogRemoveLink();
        },
        position: 'first',
        id: 'del-link',
        title: _('Delete link'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-seek-next',
        onClickButton() {
            const sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
            const receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            activateLinkParamset(receiver, sender, true);
        },
        position: 'first',
        id: 'play-link-long',
        title: _('Activate long'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-seek-end',
        onClickButton() {
            const sender = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-links_SENDER"]').html();
            const receiver = $('#grid-links tr#' + $gridLinks.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            activateLinkParamset(receiver, sender);
        },
        position: 'first',
        id: 'play-link',
        title: _('Activate short'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-gear',
        onClickButton() {
            const row = $gridLinks.jqGrid('getGridParam', 'selrow');
            const sender = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_SENDER"]').html();
            const receiver = $('#grid-links tr#' + row + ' td[aria-describedby="grid-links_RECEIVER"]').html();
            getLink(sender, receiver, row);
            // Alert('edit link ' + sender + ' -> ' + receiver);
        },
        position: 'first',
        id: 'edit-link',
        title: _('Edit link'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-links', {
        caption: '',
        buttonicon: 'ui-icon-plus',
        onClickButton() {
            let selectOptions = '';
            for (let j = 0, len = listDevices.length; j < len; j++) {
                if (!listDevices[j].PARENT) {
                    continue;
                }
                if (listDevices[j].ADDRESS.endsWith(':0')) {
                    continue;
                }
                if (!listDevices[j].LINK_SOURCE_ROLES) {
                    continue;
                }
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
        delegate: 'td.link-cell',
        menu: [
            {title: _('Edit link'), cmd: 'edit', uiIcon: 'ui-icon-gear'},
            {title: _('Activate short'), cmd: 'activate', uiIcon: 'ui-icon-seek-end', addClass: 'show-rf'},
            {title: _('Activate long'), cmd: 'activate_long', uiIcon: 'ui-icon-seek-next', addClass: 'show-rf'},
            {title: _('Delete link'), cmd: 'delete', uiIcon: 'ui-icon-trash'}
        ],
        select(event, ui) {
            const cmd = ui.cmd;
            const row = ui.target.parent().attr('id');
            const sender = ui.target.parent().find('[aria-describedby$="_SENDER"]').text();
            const receiver = ui.target.parent().find('[aria-describedby$="_RECEIVER"]').text();
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
                    alert('todo ' + ui.cmd + ' on ' + sender + ' - ' + receiver); // eslint-disable-line no-alert
            }
        }
    });

    $gridInterfaces.jqGrid({
        colNames: ['ADDRESS', 'DESCRIPTION', 'TYPE', 'FIRMWARE_VERSION', 'CONNECTED', 'DEFAULT', 'DUTY_CYCLE'],
        colModel: [
            {name: 'ADDRESS', index: 'ADDRESS', width: 110, fixed: true},
            {name: 'DESCRIPTION', index: 'DESCRIPTION', width: 150, fixed: false},
            {name: 'TYPE', index: 'TYPE', width: 70, fixed: false},
            {name: 'FIRMWARE_VERSION', index: 'FIRMWARE_VERSION', width: 130, fixed: true},
            {name: 'CONNECTED', index: 'CONNECTED', width: 110, fixed: true},
            {name: 'DEFAULT', index: 'DEFAULT', width: 110, fixed: true},
            {name: 'DUTY_CYCLE', index: 'DUTY_CYCLE', width: 110, fixed: true, align: 'right'}
        ],
        datatype: 'local',
        rowNum: 25,
        autowidth: true,
        width: '1000',
        height: 'auto',
        rowList: [25, 50, 100, 500],
        sortname: 'timestamp',
        viewrecords: true,
        sortorder: 'desc',
        caption: _('Interfaces'),
        hiddengrid: false
    });

    $('#gbox_grid-interfaces .ui-jqgrid-titlebar-close').click(() => {
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
                click() {
                    $(this).dialog('close');
                    rpcDialog(daemon, 'removeLink', [$('#delete-link-sender').val(), $('#delete-link-receiver').val()], () => {
                        rpcAlert(daemon, 'getLinks', [], (err, data) => {
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
                click() {
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
                class: 'add-link-create-edit',
                click() {
                    const sender = $selectLinkSender.val();
                    const targets = $selectLinkReceiver.val();
                    const s1 = sender[0];
                    const t1 = targets[0];

                    createLinks(sender, targets, () => {
                        $('#load_grid-links').show();
                        rpcAlert(daemon, 'getParamset', [s1, t1], (err, data1) => {
                            rpcAlert(daemon, 'getParamsetDescription', [s1, t1], (err2, desc1) => {
                                rpcAlert(daemon, 'getParamset', [t1, s1], (err3, data2) => {
                                    rpcAlert(daemon, 'getParamsetDescription', [t1, s1], (err4, desc2) => {
                                        dialogLinkparamset({
                                            NAME: '',
                                            DESCRIPTION: ''
                                        }, data1, desc1, data2, desc2, s1, t1);

                                        sender.forEach(s => {
                                            targets.forEach(t => {
                                                if (s === s1 && t === t1) {
                                                    return;
                                                }
                                                console.log('option[value="' + s + ';' + t + '"]');
                                                console.log($selectLinkParamsetMultiselect.find('option[value="' + s + ';' + t + '"]'));
                                                $selectLinkParamsetMultiselect.find('option[value="' + s + ';' + t + '"]').attr('selected', true);
                                            });
                                        });
                                        $selectLinkParamsetMultiselect.multiselect('refresh');
                                        $('#load_grid-links').hide();
                                    });
                                });
                            });
                        });
                    });

                    $(this).dialog('close');
                }
            }, {
                text: _('Create'),
                class: 'add-link-create',
                click() {
                    const sender = $selectLinkSender.val();
                    const targets = $selectLinkReceiver.val();

                    createLinks(sender, targets);

                    $(this).dialog('close');
                }
            },
            {
                text: _('Cancel'),
                click() {
                    $(this).dialog('close');
                }
            }
        ]
    });
}

function createLinks(sender, targets, callback) {
    const links = [];

    sender.forEach(s => {
        targets.forEach(t => {
            links.push([s, t, '', '']);
        });
    });

    async.mapSeries(links, (link, cb) => {
        rpcDialog(daemon, 'addLink', link, cb);
    }, () => {
        getLinks(() => {
            if (typeof callback === 'function') {
                callback();
            }
        });

    });
}

function refreshGridLinks() {
    $gridLinks.jqGrid('clearGridData');
    const rowData = [];
    if (listLinks) {
        for (let i = 0, len = listLinks.length; i < len; i++) {
            if (names[listLinks[i].SENDER]) {
                listLinks[i].Sendername = names[listLinks[i].SENDER];
            }
            if (names[listLinks[i].RECEIVER]) {
                listLinks[i].Receivername = names[listLinks[i].RECEIVER];
            }

            listLinks[i].SENDER_TYPE = indexChannels[listLinks[i].SENDER] && indexChannels[listLinks[i].SENDER].TYPE;
            listLinks[i].RECEIVER_TYPE = indexChannels[listLinks[i].RECEIVER] && indexChannels[listLinks[i].RECEIVER].TYPE;

            listLinks[i]._id = i;

            if (indexChannels[listLinks[i].SENDER] && indexChannels[indexChannels[listLinks[i].SENDER].PARENT]) {
                const devSender = indexChannels[indexChannels[listLinks[i].SENDER].PARENT].TYPE;
                listLinks[i].img_sender = '<img class="device-image" src="' + (deviceImages[devSender] || deviceImages.DEVICE) + '">'; // eslint-disable-line camelcase
            }

            if (indexChannels[listLinks[i].RECEIVER] && indexChannels[indexChannels[listLinks[i].RECEIVER].PARENT]) {
                const devReceiver = indexChannels[indexChannels[listLinks[i].RECEIVER].PARENT].TYPE;
                listLinks[i].img_receiver = '<img class="device-image" src="' + (deviceImages[devReceiver] || deviceImages.DEVICE) + '">'; // eslint-disable-line camelcase
            }

            rowData.push(listLinks[i]);
        }
        $gridLinks.jqGrid('addRowData', '_id', rowData);
    }
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
                click() {
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
                class: 'linkparamset-save',
                text: _('putParamset'),
                click() {
                    putLinkParamsets($(this));
                }
            }
        ]
    });

    $selectLinkParamsetMultiselect.multiselect({
        classes: 'link-multi',
        multiple: true,
        // Header: false,
        height: 400,
        selectedList: 2,
        minWidth: 560,
        noneSelectedText: _('Please choose one or more links'), // "Bitte einen oder mehrere Kanäle auswählen",
        checkAllText: _('Check all'),
        uncheckAllText: _('Uncheck all')
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });

    $selectLinkparamsetProfile.change(function () {
        const prn = parseInt($(this).val(), 10) || 0;
        // Console.log("$('#linkparamset-input-receiver-sender-UI_HINT').val(" + prn + ");")
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
        const sender = $(this).val();
        let selectOptions;
        if (sender && sender.length > 0) {
            const roles = indexChannels[sender[0]].LINK_SOURCE_ROLES.split(' ');
            const targets = [];
            $linkSourceRoles.html(indexChannels[sender[0]].LINK_SOURCE_ROLES);

            if (sender.length === 1) {
                selectOptions = '';
                for (let j = 0, len = listDevices.length; j < len; j++) {
                    if (!listDevices[j].PARENT) {
                        continue;
                    }
                    if (listDevices[j].ADDRESS.endsWith(':0')) {
                        continue;
                    }
                    if (!listDevices[j].LINK_SOURCE_ROLES) {
                        continue;
                    }
                    if (listDevices[j].TYPE !== indexChannels[sender[0]].TYPE) {
                        continue;
                    }
                    selectOptions += '<option value="' + listDevices[j].ADDRESS + '"' +
                        (sender[0] === listDevices[j].ADDRESS ? ' selected' : '') +
                        '>' + listDevices[j].ADDRESS + ' ' + (names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '') + '</option>';
                }
                $selectLinkSender.html(selectOptions).multiselect('refresh');
            }

            for (let i = 0; i < roles.length; i++) {
                if (indexTargetRoles[roles[i]]) {
                    Object.keys(indexTargetRoles[roles[i]]).forEach(role => {
                        const address = indexTargetRoles[roles[i]][role];
                        if (targets.indexOf(address) === -1) {
                            targets.push(address);
                        }
                    });
                }
            }

            selectOptions = '';
            for (let i = 0; i < targets.length; i++) {
                let name;
                if (names[targets[i]]) {
                    name = names[targets[i]] || '';
                } else {
                    name = '';
                }
                selectOptions += '<option value="' + targets[i] + '">' + targets[i] + ' ' + name + '</option>';
            }
            $selectLinkReceiver.html(selectOptions);
            $('.add-link-create').button('disable');
            $('.add-link-create-edit').button('disable');

            $selectLinkReceiver.multiselect('refresh');
            $selectLinkReceiver.multiselect('enable');
        } else {
            selectOptions = '';
            for (let j = 0, len = listDevices.length; j < len; j++) {
                if (!listDevices[j].PARENT) {
                    continue;
                }
                if (listDevices[j].ADDRESS.endsWith(':0')) {
                    continue;
                }
                if (!listDevices[j].LINK_SOURCE_ROLES) {
                    continue;
                }
                selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' +
                    listDevices[j].ADDRESS + ' ' +
                    (names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '') +
                    '</option>';
            }
            $selectLinkSender.html(selectOptions).multiselect('refresh');
            $selectLinkReceiver.multiselect('disable');
            $linkSourceRoles.html('');
        }
    });
    $selectLinkSender.multiselect({
        classes: 'link-sender',
        multiple: true,
        // Header: false,
        height: 400,
        selectedList: 2,
        minWidth: 480,
        noneSelectedText: _('Please choose one or more channels'), // "Bitte einen oder mehrere Kanäle auswählen",
        checkAllText: _('Check all'),
        uncheckAllText: _('Uncheck all'),
        appendTo: '#dialog-add-link'
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });

    $selectLinkReceiver.multiselect({
        classes: 'link-receiver',
        multiple: true,
        // Header: false,
        height: 400,
        selectedList: 2,
        minWidth: 480,
        noneSelectedText: _('Please choose one or more channels'), // "Bitte einen oder mehrere Kanäle auswählen",
        checkAllText: _('Check all'),
        uncheckAllText: _('Uncheck all'),
        appendTo: '#dialog-add-link'
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });

    $selectLinkReceiver.change(function () {
        const receiver = $(this).val();

        if (receiver && receiver.length > 0) {
            $('.add-link-create').button('enable');
            $('.add-link-create-edit').button('enable');

            if (receiver.length === 1) {
                const roles = indexChannels[receiver[0]].LINK_TARGET_ROLES.split(' ');
                let targetRole;
                roles.forEach(role => {
                    if ($linkSourceRoles.html().split(' ').indexOf(role) !== -1) {
                        targetRole = role;
                    }
                });
                let selectOptions = '';
                listDevices.forEach(dev => {
                    if (!dev.PARENT || dev.ADDRESS.endsWith(':0')) {
                        return;
                    }
                    if (dev.LINK_TARGET_ROLES && dev.LINK_TARGET_ROLES.split(' ').indexOf(targetRole) !== -1) {
                        selectOptions += '<option value="' + dev.ADDRESS + '"' +
                            (receiver[0] === dev.ADDRESS ? ' selected' : '') +
                            '>' + dev.ADDRESS + ' ' + (names && names[dev.ADDRESS] ? names[dev.ADDRESS] : '') + '</option>';
                    }
                });
                $selectLinkReceiver.html(selectOptions).multiselect('refresh');
            }
        } else {
            $('.add-link-create').button('disable');
            $('.add-link-create-edit').button('disable');

            let selectOptions = '';

            const roles = $linkSourceRoles.html().split(' ');
            const targets = [];

            for (let i = 0; i < roles.length; i++) {
                if (indexTargetRoles[roles[i]]) {
                    Object.keys(indexTargetRoles[roles[i]]).forEach(role => {
                        const address = indexTargetRoles[roles[i]][role];
                        if (targets.indexOf(address) === -1) {
                            targets.push(address);
                        }
                    });
                }
            }

            for (let i = 0; i < targets.length; i++) {
                let name;
                if (names[targets[i]]) {
                    name = names[targets[i]] || '';
                } else {
                    name = '';
                }
                selectOptions += '<option value="' + targets[i] + '">' + targets[i] + ' ' + name + '</option>';
            }
            $selectLinkReceiver.html(selectOptions).multiselect('refresh');
        }
    });

    $('#edit-link-input-name').keyup(() => {
        $('#save-link-info').button('enable');
    });
    $('#edit-link-input-description').keyup(() => {
        $('#save-link-info').button('enable');
    });
    $tableEasymode.on('change', '.easymode-select-input', function () {
        const val = $(this).find('option:selected').val();
        const $input = $(this).parent().find('input');
        if (val === 99999999 || val === 99999998) {
            $input.show();
        } else {
            $input.hide();
            $input.val(val);
            $input.trigger('change');
        }
    });
    $tableEasymode.on('change', '.easymode-param', function () {
        const val = $(this).val();
        const binds = $(this).attr('data-binds').split(',');
        // Console.log('...', val, binds);
        binds.forEach(param => {
            $('#linkparamset-input-receiver-sender-' + param).val(val);
        });
    });
    $('#save-link-info').click(function () {
        $(this).button('disable');

        const sender = $('#edit-linkparamset-sender').val();
        const receiver = $('#edit-linkparamset-receiver').val();
        const name = $('#edit-link-input-name').val();
        const desc = $('#edit-link-input-description').val();

        const row = $('#edit-linkparamset-row').val();

        rpcDialog(daemon, 'setLinkInfo', [sender, receiver, name, desc], err => {
            if (!err) {
                const rowData = $gridLinks.jqGrid('getRowData', row);
                rowData.DESCRIPTION = desc;
                rowData.NAME = name;
                $gridLinks.jqGrid('setRowData', row, rowData);
            }
        });
    });
    $('#toggle-link-sender').click(function () {
        const $span = $(this).find('span');

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
        const $span = $(this).find('span');

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
    const sender = $('#edit-linkparamset-sender').val();
    const receiver = $('#edit-linkparamset-receiver').val();
    putLinkParamset('sender-receiver', sender, receiver, () => {
        putLinkParamset('receiver-sender', receiver, sender);
    });
}
function putLinkParamset(direction, channel1, channel2, callback) {
    const values = {};
    let count = 0;
    const multi = $selectLinkParamsetMultiselect.val();
    const isMulti = Boolean(multi);
    $('[id^="linkparamset-input-' + direction + '"]').each(function () {
        const $input = $(this);
        if (!$input.is(':disabled')) {
            const parts = $input.attr('id').split('-', 5);
            const param = parts[4];
            const elem = $input[0].nodeName;
            const type = $input.attr('type');
            const dataType = $input.attr('data-type');
            const dataValPrev = $input.attr('data-val-prev');

            // Get value
            let val;
            if (elem === 'INPUT') {
                if (type === 'checkbox') {
                    val = $input.is(':checked');
                } else {
                    val = $input.val();
                }
            } else if (elem === 'SELECT') {
                val = $input.find('option:selected').val();
            }

            // Überspringe Param falls keine Änderung stattgefunden hat und kein Multiedit stattfindet
            if (!isMulti && (
                    (val === true && dataValPrev === 'true') ||
                    (val === false && dataValPrev === 'false') ||
                    (val === dataValPrev) ||
                    (!isNaN(dataValPrev) && parseFloat(dataValPrev) === parseFloat(val))
                )) {
                return;
            }

            // Console.log(param, val, elem, type, $input.attr('id'));

            // aktualisiere data-val-prev - falls auf prn 0 (expert) zurückgeschaltet wird werden diese werte verwendet
            $input.attr('data-val-prev', val);

            // Calculate value if unit is "100%"
            if ($input.attr('data-unit') === '100%') {
                val /= 100;
            }

            // Datentypen für rpc konvertieren
            switch (dataType) {
                case 'BOOL':
                    if (val === 'true') {
                        val = true;
                    } else if (val === 'false') {
                        val = false;
                    } else if (typeof val !== 'boolean') {
                        val = Boolean(val);
                    }
                    break;
                case 'INTEGER':
                    val = parseInt(val, 10) || 0;
                    break;
                case 'FLOAT':
                    val = {explicitDouble: parseFloat(val)};
                    break;
                case 'STRING':
                default:
                    val = String(val);
            }
            values[param] = val;
            count += 1;
        }
    });

    if (count > 0 || isMulti) {
        rpcDialog(daemon, 'putParamset', [channel1, channel2, values]);
        if (isMulti) {
            multi.forEach(link => {
                const tmp = link.split(';');
                rpcDialog(daemon, 'putParamset', [tmp[0], tmp[1], values]);
            });
        }
    } else if (typeof (callback) === 'function') {
        callback(null, null);
    }
}
function dialogLinkparamset(data0, data1, desc1, data2, desc2, sender, receiver) {
    $('#save-link-info').button('disable');
    $('#edit-link-input-name').val(data0.NAME);
    $('#edit-link-input-description').val(data0.DESCRIPTION);

    linkReceiverData = data2;
    linkReceiverDesc = desc2;

    let senderType = indexChannels[sender] && indexChannels[sender].TYPE;
    let receiverType = indexChannels[receiver] && indexChannels[receiver].TYPE;

    $selectLinkParamsetMultiselect.html('');
    let mcount = 0;
    listLinks.forEach(link => {
        if (link.RECEIVER === receiver && link.SENDER === sender) {
            return;
        }
        if (indexChannels[link.RECEIVER].TYPE !== receiverType) {
            return;
        }
        if (indexChannels[link.SENDER].TYPE !== senderType) {
            return;
        }
        const name = /* (link.NAME ? link.NAME + ' - ' : '') + */
            (names[link.SENDER] ? names[link.SENDER] + ' (' + link.SENDER + ')' : link.SENDER) +
            ' -> ' +
            (names[link.RECEIVER] ? names[link.RECEIVER] + ' (' + link.RECEIVER + ')' : link.RECEIVER);

        mcount += 1;
        $selectLinkParamsetMultiselect.append('<option value="' + link.SENDER + ';' + link.RECEIVER + '">' + name + '</option>');
    });

    $selectLinkParamsetMultiselect.multiselect('refresh');
    if (mcount > 0) {
        $('#select-linkparamset-multiselect_ms').show();
    } else {
        $('#select-linkparamset-multiselect_ms').hide();
    }
    if (daemonType === 'BidCos-Wired') {
        receiverType = 'HMW_' + receiverType;

        ipcRpc.send('rpc', [daemon, 'getParamset', [sender, 'MASTER']], (err, res) => {
            const inputType = senderType === 'VIRTUAL_KEY' ? '1' : (res && res.INPUT_TYPE);
            senderType = senderType + '_' + inputType;
            loadEasyModes();
        });
    } else {
        loadEasyModes();
    }

    function loadEasyModes() {
        linkSenderType = senderType;
        linkReceiverType = receiverType;

        // Console.log('dialogLinkparamset ' + sender + ' (' + senderType + ') ' + receiver + ' (' + receiverType + ')');

        if (easymodes[receiverType] && easymodes[receiverType][senderType]) {
            createEasymodes();
        } else {
            const translationFile = 'easymodes/localization/' + language + '/' + receiverType + '.json';
            const easymodeFile = 'easymodes/' + receiverType + '/' + senderType + '.json';

            $.getJSON(translationFile, data => {
                // Console.log('easymode loaded ', translationFile);
                easymodes.lang[language][receiverType] = data;
                $.getJSON(easymodeFile, data => {
                    // Console.log('easymode loaded', easymodeFile);
                    if (!easymodes[receiverType]) {
                        easymodes[receiverType] = {};
                    }
                    easymodes[receiverType][senderType] = data;
                    createEasymodes();
                }).fail(() => {
                    console.error('TODO! Easymode fail', easymodeFile);
                    createEasymodes();
                });
            }).fail(() => {
                console.error('TODO! Easymode translation fail', translationFile);
                easymodes.lang[language][receiverType] = {};
                $.getJSON(easymodeFile, data => {
                    // Console.log('easymode loaded', easymodeFile);
                    if (!easymodes[receiverType]) {
                        easymodes[receiverType] = {};
                    }
                    easymodes[receiverType][senderType] = data;
                    createEasymodes();
                }).fail(() => {
                    console.error('TODO! Easymode fail', easymodeFile);
                    createEasymodes();
                });
            });
        }
    }

    function createEasymodes() {
        // Todo HmIP Easymodes https://github.com/hobbyquaker/homematic-manager/issues/50
        if (daemon === 'HmIP') {
            receiverType = 'HmIP_' + receiverType;
            senderType = 'HmIP_' + senderType;
        }
        let profiles = easymodes[receiverType] && easymodes[receiverType][senderType];
        if (!profiles) {
            profiles = {0: {params: {}, name: 'expert'}};
        }

        // Profil-Select befüllen
        $selectLinkparamsetProfile.html('');
        Object.keys(profiles).forEach(id => {
            let selected;
            const name = (easymodes.lang[language] &&
                easymodes.lang[language][receiverType] &&
                easymodes.lang[language][receiverType].GENERIC &&
                easymodes.lang[language][receiverType].GENERIC[profiles[id].name]) ||
                (easymodes.lang[language] &&
                easymodes.lang[language].GENERIC &&
                easymodes.lang[language].GENERIC && easymodes.lang[language].GENERIC[profiles[id].name]) ||
                profiles[id].name;

            if (data2.UI_HINT === id) {
                selected = ' selected';
            } else {
                selected = '';
            }
            $selectLinkparamsetProfile.append('<option value="' + id + '"' + selected + '>' + name + '</option>');
        });

        $selectLinkparamsetProfile.multiselect('refresh');

        // Tabelle befüllen
        formLinkParamset($('#table-linkparamset1'), data1, desc1, 'sender-receiver', senderType, receiverType);
        formLinkParamset($('#table-linkparamset2'), data2, desc2, 'receiver-sender', senderType, receiverType, profiles);

        // Dialog-Überschrift setzen
        let name = (names && names[sender] ? names[sender] : '');

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
        $('#link-sender').html((names[sender] || '') + ' (' + sender + ')');
        $('#link-receiver').html((names[receiver] || '') + ' (' + receiver + ')');

        // Buttons
        $('button.paramset-setValue:not(.ui-button)').button();

        $('button.linkparamset-save').button('disable');

        $('.linkparamset-input, .easymode-param, #linkparamset-profile').change(() => {
            $('button.linkparamset-save').button('enable');
        });

        $dialogLinkparamset.dialog('open');
        $dialogLinkparamset.tooltip({
            open(event, ui) {
                ui.tooltip.css('max-width', '500px');
            },
            content() {
                return $(this).prop('title');
            }
        });
    }
}
function elementEasyMode(options, val) {
    // Console.log('elementEasyMode', options, val)
    let form = '';
    let selectOptions;
    switch (options.option) {
        case 'RAMPTIME': {
            selectOptions = [
                {value: 0, text: easymodes.lang[language].GENERIC.none},
                {value: 0.2, text: '0.2s'},
                {value: 0.5, text: '0.5s'},
                {value: 1, text: '1s'},
                {value: 2, text: '2s'},
                {value: 5, text: '5s'},
                {value: 10, text: '10s'},
                {value: 20, text: '20s'},
                {value: 30, text: '30s'},
                {value: 99999999, text: easymodes.lang[language].GENERIC.enterValue}
            ];

            form += '<select class="easymode-select-input" id="">';
            selectOptions.forEach(option => {
                form += '<option value="' + option.value + '"';
                if (option.value === parseFloat(val)) {
                    form += ' selected="selected">' + option.text + '</option>';
                } else {
                    form += '>' + option.text + '</option>';
                }
            });
            form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

            break;
        }
        case 'LENGTH_OF_STAY': {
            selectOptions = [
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
                {value: 111600, text: easymodes.lang[language].GENERIC.unlimited},
                {value: 99999999, text: easymodes.lang[language].GENERIC.enterValue}
            ];

            form += '<select class="easymode-select-input" id="">';
            selectOptions.forEach(option => {
                form += '<option value="' + option.value + '"';
                if (option.value === parseFloat(val)) {
                    form += ' selected="selected">' + option.text + '</option>';
                } else {
                    form += '>' + option.text + '</option>';
                }
            });
            form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

            break;
        }
        case 'DIM_ONLEVEL': {
            selectOptions = [
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
                {value: 100.5, text: easymodes.lang[language].GENERIC.lastValue},
                {value: 99999998, text: easymodes.lang[language].GENERIC.enterValue}
            ];
            form += '<select class="easymode-select-input" id="">';
            selectOptions.forEach(option => {
                form += '<option value="' + option.value + '"';
                if (option.value === parseFloat(val)) {
                    form += ' selected="selected">' + option.text + '</option>';
                } else {
                    form += '>' + option.text + '</option>';
                }
            });
            form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

            break;
        }
        case 'DIM_OFFLEVEL': {
            selectOptions = [
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
                {value: 100.5, text: easymodes.lang[language].GENERIC.lastValue},
                {value: 99999998, text: easymodes.lang[language].GENERIC.enterValue}
            ];
            form += '<select class="easymode-select-input" id="">';
            selectOptions.forEach(option => {
                form += '<option value="' + option.value + '"';
                if (option.value === parseFloat(val)) {
                    form += ' selected="selected">' + option.text + '</option>';
                } else {
                    form += '>' + option.text + '</option>';
                }
            });
            form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

            break;
        }
        case 'DELAY': {
            selectOptions = [
                {value: 0, text: easymodes.lang[language].GENERIC.none},
                {value: 5, text: '5s'},
                {value: 10, text: '10s'},
                {value: 30, text: '30s'},
                {value: 60, text: '60s'},
                {value: 120, text: '120s'},
                {value: 300, text: '300s'},
                {value: 600, text: '10min'},
                {value: 1800, text: '30min'},
                {value: 3600, text: '1h'},
                {value: 99999999, text: easymodes.lang[language].GENERIC.enterValue}
            ];

            form += '<select class="easymode-select-input" id="">';
            selectOptions.forEach(option => {
                form += '<option value="' + option.value + '"';
                if (option.value === val) {
                    form += ' selected="selected">' + option.text + '</option>';
                } else {
                    form += '>' + option.text + '</option>';
                }
            });
            form += '</select><input value="' + val + '" style="display:none;" id="" class="easymode-param" data-binds="' + options.combo.join(',') + '">';

            break;
        }
        default: {
            // Console.log('elementEasyMode', options.option);
            const param = options.combo[0];
            const $tpl = $('#linkparamset-input-receiver-sender-' + param);
            const $copy = $tpl.clone();
            $copy.removeAttr('id').addClass('easymode-param').attr('data-binds', options.combo);
            return $copy && $copy[0] && $copy[0].outerHTML;
        }
    }
    return form;
}
function formEasyMode(data, desc, direction, sType, rType, prn) {
    const receiverType = rType;
    const senderType = sType;

    let profiles = easymodes[receiverType] && easymodes[receiverType][senderType];
    if (!profiles) {
        profiles = {0: {params: {}, name: 'expert'}};
    }

    if (prn) {
        $tableEasymode.html('');
        const options = profiles && profiles[prn] && profiles[prn].options;
        const params = profiles && profiles[prn] && profiles[prn].params;
        const heading = easymodes.lang[language] &&
            easymodes.lang[language][receiverType] &&
            easymodes.lang[language][receiverType][senderType] &&
            easymodes.lang[language][receiverType][senderType]['description_' + prn];
        $('h4.easymode').html(heading);
        if (!options) {
            return;
        }

        for (const id in params) {
            if (params[id].readonly) {
                let val = (params[id] && params[id].val) || data[id];
                if (desc[id] && desc[id].UNIT === '100%') {
                    val = (val || 0) * 100;
                }
                $('[id="linkparamset-input-receiver-sender-' + id + '"]').val(val);
            }
        }
        let tmp;
        for (const param in options) {
            if (!options[param].combo) {
                continue;
            }

            tmp = easymodes.lang[language].PNAME[options[param].desc] ||
                (
                    easymodes.lang[language][receiverType] &&
                    easymodes.lang[language][receiverType].GENERIC &&
                    easymodes.lang[language][receiverType].GENERIC[options[param].desc]
                )
            ;

            $tableEasymode.append('<tr><td>' + tmp + '</td><td style="font-size: 8px"></td><td>' +
                elementEasyMode(options[param], data[options[param].combo[0]]) + '</td></tr>');
        }
        // Console.log("$('#linkparamset-input-receiver-sender-UI_HINT').val(" + prn + ");")
        $('#linkparamset-input-receiver-sender-UI_HINT').val(prn);

        $('#table-linkparamset2').hide();
        $('.easymode').show();
    } else {
        $tableEasymode.html('');
        $('h4.easymode').html('');

        $('.easymode').hide();

        $('[id^="linkparamset-input-receiver-sender-"]').each(function () {
            $(this).val($(this).attr('data-val-prev') || '');
        });
        // Console.log("$('#linkparamset-input-receiver-sender-UI_HINT').val(" + prn + ");")
        $('#linkparamset-input-receiver-sender-UI_HINT').val(prn);
        $('#table-linkparamset2').show();
    }
}
function formLinkParamset(elem, data, desc, direction, senderType, receiverType) {
    elem.show().html('<tr><th class="paramset-1">Param</th><th class="paramset-2">&nbsp;</th><th class="paramset-3">Value</th><th class="paramset-4">Default</th><th></th></tr>');
    let count = 0;
    const resultArr = [];
    if (!desc) {
        throw new Error('formLinkParamset paramsetDescription missing');
    }
    Object.keys(desc).forEach(param => {
        let unit = '';
        let hidden;
        count += 1;
        if (desc[param]) {
            // Dirty workaround for encoding problem
            if (desc[param].UNIT === '�C') {
                desc[param].UNIT = '°C';
            }

            let defaultVal = desc[param].DEFAULT;

            // Calculate percent values
            if (desc[param].UNIT === '100%') {
                unit = '%';
                data[param] = (data[param] || 0) * 100;
                defaultVal = (defaultVal || 0) * 100;
            } else {
                unit = desc[param].UNIT || '';
            }
            if (unit === '""') {
                unit = '';
            }

            if (typeof data[param] === 'undefined') {
                data[param] = desc[param].DEFAULT;
            }

            // Create Input-Field
            let input;
            const helpentry = helpLinkParamset[language] && helpLinkParamset[language][param.replace('SHORT_', '').replace('LONG_', '')];
            let help;
            if (helpentry && helpentry.helpText) {
                help = helpentry.helpText;
            } else {
                help = helpentry || '';
            }

            const disabled = desc[param].OPERATIONS & 2;
            hidden = param === 'UI_HINT';

            // Console.log(param, data[param], desc[param]);

            switch (desc[param].TYPE) {
                case 'BOOL':
                    input = '<input class="linkparamset-input" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="checkbox" value="true" data-val-prev="' + data[param] + '" data-type="BOOL" ' + (data[param] ? ' checked="checked"' : '') + (disabled ? '' : ' disabled="disabled"') + '/>';
                    break;
                case 'INTEGER':
                    input = '<input class="linkparamset-input" data-unit="' + desc[param].UNIT + '" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="number" min="' + desc[param].MIN + '" max="' + desc[param].MAX + '" value="' + data[param] + '" data-val-prev="' + data[param] + '" data-type="INTEGER"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                    break;
                case 'ENUM':
                    input = '<select class="linkparamset-input" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" data-val-prev="' + data[param] + '" data-type="INTEGER"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '>';
                    if (typeof desc[param].MIN === 'string') {
                        desc[param].MIN = desc[param].VALUE_LIST.indexOf(desc[param].MIN);
                        desc[param].MAX = desc[param].VALUE_LIST.indexOf(desc[param].MAX);
                    }
                    for (let i = desc[param].MIN; i <= desc[param].MAX; i++) {
                        input += '<option value="' + i + '"' + (data[param] === i ? ' selected="selected"' : '') + '>' + desc[param].VALUE_LIST[i] + '</option>';
                        if (helpentry) {
                            if (i === desc[param].MIN) {
                                help += '<br/><ul>';
                            }
                            if (helpentry.params[desc[param].VALUE_LIST[i]]) {
                                help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>: ' + helpentry.params[desc[param].VALUE_LIST[i]] + (i < desc[param].MAX ? '<br/>' : '');
                            } else {
                                help += '<li><strong>' + desc[param].VALUE_LIST[i] + '</strong>';
                            }
                            if (i === desc[param].MAX) {
                                help += '</ul>';
                            }
                        }
                    }
                    input += '</select>';
                    if (typeof defaultVal !== 'string') {
                        defaultVal = desc[param].VALUE_LIST[defaultVal];
                    }
                    break;
                case 'FLOAT':
                    data[param] = parseFloat(parseFloat(data[param]).toFixed(6));
                    input = '<input class="linkparamset-input" data-unit="' + desc[param].UNIT + '" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="text" value="' + data[param] + '" data-val-prev="' + data[param] + '" data-type="STRING"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
                    break;
                default:
                    input = '<input class="linkparamset-input" data-unit="' + desc[param].UNIT + '" id="linkparamset-input-' + (direction ? direction + '-' : '') + param + '" type="text" value="' + data[param] + '" data-val-prev="' + data[param] + '" data-type="STRING"' + (desc[param].OPERATIONS & 2 ? '' : ' disabled="disabled"') + '/>' + unit;
            }
            const helpIcon = help ? '<img src="images/help.png" width="16" height="16" title="' + help + '">' : '';

            resultArr.push({
                order: desc[param].TAB_ORDER,
                fragment: '<tr style="' + (hidden ? 'display:none;' : '') + '"><td>' + param + '</td><td>' + helpIcon + '</td><td>' + input + '</td><td colspan="2">' + defaultVal + unit + '</td></tr>'
            });
        } else {
            resultArr.push({
                order: desc[param].TAB_ORDER,
                fragment: '<tr style="' + (hidden ? 'display:none;' : '') + '"><td>' + param + '</td><td colspan = "4">' + data[param] + '</td></tr>'
            });
        }
    });

    if (count === 0) {
        elem.hide();
        if (direction === 'sender-receiver') {
            $('#toggle-link-sender').hide();
        }
    } else {
        if (direction === 'sender-receiver') {
            $('#toggle-link-sender').show();
        }
        resultArr.sort((a, b) => {
            return a.order - b.order;
        });
        for (let i = 0; i < resultArr.length; i++) {
            elem.append(resultArr[i].fragment);
        }
    }
    if (direction === 'receiver-sender') {
        formEasyMode(data, desc, direction, senderType, receiverType, data.UI_HINT);
    }
}
function dialogRemoveLink() {
    const rowId = $gridLinks.jqGrid('getGridParam', 'selrow');
    const sender = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_SENDER"]').html();
    const receiver = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_RECEIVER"]').html();
    const name = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_NAME"]').html();
    const desc = $('#grid-links tr#' + rowId + ' td[aria-describedby="grid-links_DESCRIPTION"]').html();
    const sendername = names && names[sender] ? names[sender] : '';
    const receivername = names && names[receiver] ? names[receiver] : '';

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
    if (!sender || !receiver) {
        throw new Error('getLink Error ' + sender + ' ' + receiver);
    }
    $('#edit-linkparamset-row').val(row);
    $('#load_grid-links').show();
    rpcAlert(daemon, 'getLinkInfo', [sender, receiver], (err0, data0) => {
        rpcAlert(daemon, 'getParamset', [sender, receiver], (err1, data1) => {
            rpcAlert(daemon, 'getParamsetDescription', [sender, 'LINK'], (err2, data2) => {
                rpcAlert(daemon, 'getParamset', [receiver, sender], (err3, data3) => {
                    rpcAlert(daemon, 'getParamsetDescription', [receiver, 'LINK'], (err4, data4) => {
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
    if (config.daemons[daemon].type === 'BidCos-RF' || config.daemons[daemon].type === 'HmIP') {
        $('#load_grid-interfaces').show();
        rpcAlert(daemon, 'listBidcosInterfaces', [], (err, data) => {
            listInterfaces = data;
            if (config.daemons[daemon].type === 'BidCos-RF') {
                $('#load_grid-rssi').show();
                rpcAlert(daemon, 'rssiInfo', [], (err, data) => {
                    listRssi = data;
                    $('#gbox_grid-rssi').show();
                    initGridRssi();
                    refreshGridRssi();
                    getServiceMessages();
                });
            } else {
                $('#gbox_grid-rssi').hide();
                getServiceMessages();
            }

            refreshGridInterfaces();
        });
    }
}
function initGridRssi() {
    if ($gridRssi.hasClass('ui-jqgrid-btable') && $gridRssi.jqGrid) {
        $gridRssi.jqGrid('GridUnload');
    }
    const colNamesRssi = ['Name', 'ADDRESS', 'TYPE', 'INTERFACE', 'RF_ADDRESS', 'ROAMING'];
    const colModelRssi = [
        // TODO Name und Type fixed:false - Überschrifts und Inhaltsspalten stimmen nicht mehr... :-(
        {name: 'Name', index: 'Name', width: 250, fixed: true},
        {name: 'ADDRESS', index: 'ADDRESS', width: 84, fixed: true},
        {name: 'TYPE', index: 'TYPE', width: 140, fixed: true},
        {name: 'INTERFACE', index: 'INTERFACE', width: 84, fixed: true},
        {name: 'RF_ADDRESS', index: 'RF_ADDRESS', width: 75, fixed: true},
        {name: 'roaming', index: 'ROAMING', width: 57, fixed: true, search: false, align: 'center'}
    ];

    const groupHeaders = [];

    for (let i = 0; i < listInterfaces.length; i++) {
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
        subGridRowExpanded(gridId, rowId) {
            subGridRssi(gridId, rowId);
        },
        ondblClickRow(rowId) {
            removeSelectionAfterDblClick();
            $gridRssi.jqGrid('toggleSubGridRow', rowId);
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
        groupHeaders
    }).jqGrid('navButtonAdd', '#pager-rssi', {
        caption: '',
        buttonicon: 'ui-icon-refresh',
        onClickButton() {
            getRfdData();
        },
        position: 'first',
        id: 'refresh-rssi',
        title: _('Refresh'),
        cursor: 'pointer'
    });
    $('#gbox_grid-rssi .ui-jqgrid-titlebar-close').hide();

    resizeGrids();

    function subGridRssi(gridId, rowId) {
        const subgridTableId = 'rssi' + rowId + '_t';
        $('#' + gridId).html('<table id="' + subgridTableId + '"></table>');
        const gridConf = {
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
            ignoreCase: true
        };
        const $subgrid = $('#' + subgridTableId);
        $subgrid.jqGrid(gridConf);

        const address = $('#grid-rssi tr#' + rowId + ' td[aria-describedby="grid-rssi_ADDRESS"]').html();
        const partners = listRssi[address];
        let i = 0;
        const rowData = [];
        Object.keys(partners).forEach(partner => {
            const obj = {
                ADDRESS: partner,
                Name: (names && names[partner] ? names[partner] : ''),
                TYPE: (indexDevices[partner] ? indexDevices[partner].TYPE : ''),
                'RSSI-Receive': rssiColor(partners[partner][0]),
                'RSSI-Send': rssiColor(partners[partner][1])
            };
            obj._id = i;
            rowData.push(obj);
            i += 1;
        });
        $subgrid.jqGrid('addRowData', '_id', rowData);
    }

    $body.on('click', '.interface-set', () => {
        const i = $(this).attr('data-device-index');
        const ifaceIndex = $(this).attr('data-iface-index');
        const rowId = $(this).parent().parent().attr('id');
        const rowData = $gridRssi.jqGrid('getRowData', rowId);
        rowData.roaming = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox">';
        rowData.INTERFACE = listInterfaces[$(this).attr('data-iface-index')].ADDRESS;
        for (let k = 0; k < listInterfaces.length; k++) {
            rowData[listInterfaces[k].ADDRESS + '_set'] = '<input type="radio" class="interface-set" name="iface_' + i + '" data-device-index="' + i + '" data-iface-index="' + k + '" data-device="' + listDevices[i].ADDRESS + '" value="' + listInterfaces[k].ADDRESS + '"' + (k === ifaceIndex ? ' checked="checked"' : '') + '>';
        }
        $gridRssi.jqGrid('setRowData', rowId, rowData);
        rpcAlert(daemon, 'setBidcosInterface', [$(this).attr('data-device'), listInterfaces[$(this).attr('data-iface-index')].ADDRESS, false]);
    });

    $body.on('change', '.checkbox-roaming', function () {
        const checked = $(this).is(':checked');
        const i = $(this).attr('data-device-index');
        const rowId = $(this).parent().parent().attr('id');
        const rowData = $gridRssi.jqGrid('getRowData', rowId);
        rowData.roaming = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox"' + (checked ? ' checked="checked"' : '') + '>';
        rowData.INTERFACE = listInterfaces[0].ADDRESS;
        if (checked) {
            for (let k = 0; k < listInterfaces.length; k++) {
                rowData[listInterfaces[k].ADDRESS + '_set'] = '<input type="radio" class="interface-set" name="iface_' + i + '" data-device-index="' + i + '" data-iface-index="' + k + '" data-device="' + listDevices[i].ADDRESS + '" value="' + listInterfaces[k].ADDRESS + '"' + (k === 0 ? ' checked="checked"' : '') + '>';
            }
        }
        $gridRssi.jqGrid('setRowData', rowId, rowData);
        rpcAlert(daemon, 'setBidcosInterface', [$(this).attr('data-device'), listInterfaces[0].ADDRESS, $(this).is(':checked')]);
    });
}
function refreshGridRssi() {
    $gridRssi.jqGrid('clearGridData');

    indexDevices = {};

    let j = 0;
    for (let i = 0, len = listInterfaces.length; i < len; i++) {
        indexDevices[listInterfaces[i].ADDRESS] = listInterfaces[i];

        // TODO - performance improvement, add all rows at once!
        $gridRssi.jqGrid('addRowData', j++, {
            Name: '',
            ADDRESS: listInterfaces[i].ADDRESS,
            TYPE: listInterfaces[i].TYPE
        });
    }

    const rowData = [];

    for (let i = 0, len = listDevices.length; i < len; i++) {
        if (listDevices[i].PARENT) {
            continue;
        }
        if (listDevices[i].TYPE === 'HM-RCV-50') {
            continue;
        }
        if (listDevices[i].ADDRESS.startsWith('*')) {
            continue;
        }
        indexDevices[listDevices[i].ADDRESS] = listDevices[i];
        let line = {};
        for (let k = 0, ifaceLen = listInterfaces.length; k < ifaceLen; k++) {
            if (listRssi[listDevices[i].ADDRESS] && listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS]) {
                line[listInterfaces[k].ADDRESS + '_0'] = (listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][0] === 65536 ?
                    '' : listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][0]);
                line[listInterfaces[k].ADDRESS + '_1'] = (listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][1] === 65536 ?
                    '' : listRssi[listDevices[i].ADDRESS][listInterfaces[k].ADDRESS][1]);
                if (listDevices[i].INTERFACE === listInterfaces[k].ADDRESS) {
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
        if (listDevices[i].ROAMING === 0) {
            line.roaming = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox">';
        } else {
            line.roaming = '<input class="checkbox-roaming" data-device-index="' + i + '" data-device="' + listDevices[i].ADDRESS + '" type="checkbox" checked="checked">';
        }
        line = $.extend(true, line, listDevices[i]);
        line._id = j++;
        rowData.push(line);
    }
    $gridRssi.jqGrid('addRowData', '_id', rowData);
    $gridRssi.trigger('reloadGrid');
}
function refreshGridInterfaces() {
    $gridInterfaces.jqGrid('clearGridData');
    for (let i = 0, len = listInterfaces.length; i < len; i++) {
        $gridInterfaces.jqGrid('addRowData', i, listInterfaces[i]);
    }
    $gridInterfaces.trigger('reloadGrid');
}

// Service Messages
function initGridMessages() {
    $gridMessages.jqGrid({
        colNames: ['Name', 'ADDRESS', 'DeviceAddress', 'Message'],
        colModel: [
            {name: 'Name', index: 'Name', width: 420, fixed: true},
            {name: 'ADDRESS', index: 'ADDRESS', width: 110, fixed: true},
            {name: 'DeviceAddress', index: 'DeviceAddress', width: 110, fixed: true},
            {name: 'Message', index: 'Message', width: 150, fixed: false}
        ],
        datatype: 'local',
        rowNum: 100,
        autowidth: true,
        width: '1000',
        height: 'auto',
        rowList: [25, 50, 100, 500],
        pager: $('#pager-messages'),
        sortname: 'timestamp',
        viewrecords: true,
        sortorder: 'desc',
        caption: _('Service messages'),
        onSelectRow(rowid) {
            if ($('#grid-messages tr#' + rowid + ' td[aria-describedby="grid-messages_Message"]').html().match(/STICKY/)) {
                $('#accept-message').removeClass('ui-state-disabled');
            } else {
                $('#accept-message').addClass('ui-state-disabled');
            }
        },
        gridComplete() {

        }
    }).navGrid('#pager-messages', {
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
    }).jqGrid('navButtonAdd', '#pager-messages', {
        caption: '',
        buttonicon: 'ui-icon-check',
        onClickButton() {
            const address = $('#grid-messages tr#' + $gridMessages.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-messages_ADDRESS"]').html();
            const key = $('#grid-messages tr#' + $gridMessages.jqGrid('getGridParam', 'selrow') + ' td[aria-describedby="grid-messages_Message"]').html();
            rpcAlert(daemon, 'setValue', [address, key, false], err => {
                if (!err) {
                    getRfdData();
                } // Todo hier sollte doch eigentlich refreshServicemessages reichen?
            });
        },
        // Position: 'first',
        id: 'accept-message',
        title: _('Acknowledge service messages'),
        cursor: 'pointer'
    }).jqGrid('navButtonAdd', '#pager-messages', {
        caption: '',
        buttonicon: 'ui-icon-circle-check',
        onClickButton() {
            const acceptQueue = [];
            for (let i = 0, len = listMessages.length; i < len; i++) {
                const address = listMessages[i][0];
                if (listMessages[i][1].match(/STICKY/)) {
                    acceptQueue.push([address, listMessages[i][1], false]);
                }
            }
            function popQueue() {
                const params = acceptQueue.pop();
                rpcAlert(daemon, 'setValue', params, () => {
                    if (acceptQueue.length > 0) {
                        popQueue();
                    } else {
                        getRfdData();
                    }
                });
            }

            popQueue();
        },
        // Position: 'first',
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
    let acceptableMessages = false;
    const rowData = [];
    for (let i = 0, len = listMessages.length; i < len; i++) {
        const deviceAddress = listMessages[i][0].slice(0, listMessages[i][0].length - 2);
        let name = '';
        if (names[deviceAddress]) {
            name = names[deviceAddress];
        }
        if (listMessages[i][1].match(/STICKY/)) {
            acceptableMessages = true;
        }
        const obj = {
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
    rpcAlert(daemon, 'getServiceMessages', [], (err, data) => {
        if (!err) {
            listMessages = data || [];
            refreshGridMessages();
        }
    });
}

// RPC Console
function initConsole() {
    $consoleRpcMethod.multiselect({
        classes: 'rpc-method',
        multiple: false,
        // Header: false,
        height: 500,
        selectedList: 1
    }).multiselectfilter({
        autoReset: true,
        placeholder: ''
    });
    $consoleRpcMethod.change(() => {
        const method = $consoleRpcMethod.val();
        if (method === 'null') {
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
    $consoleRpcSend.attr('disabled', true).button().click(() => {
        const method = $consoleRpcMethod.find('option:selected').val();
        let params;
        try {
            params = JSON.parse('[' + $('#console-rpc-params').val() + ']');
        } catch (err) {
            alert('Parsing params: ' + err); // eslint-disable-line no-alert
            return;
        }

        $consoleRpcResponse.html('...');
        ipcRpc.send('rpc', [daemon, method, params], (err, data) => {
            if (err) {
                $('#console-rpc-error').html('Error: ' + err.faultString);
            } else {
                $('#console-rpc-error').html('');
            }
            $consoleRpcResponse.html(JSON.stringify(data, null, '  '));
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
    if (daemon === 'null') {
        $consoleRpcSend.attr('disabled', true).button('refresh');
        return;
    }

    $consoleRpcMethod.html('');

    // Würgaround https://github.com/eq-3/occu/issues/53
    const hmipExclude = [
        'activateLinkParamset',
        'addDevice',
        'changeKey',
        'clearConfigCache',
        'determineParameter',
        'getKeyMismatchDevice',
        'getLinkPeers',
        'listTeams',
        'logLevel',
        'restoreConfigToDevice',
        'rssiInfo',
        'searchDevices',
        'setTeam',
        'setTempKey',
        'updateFirmware',
        'setBidcosInterface',
        'getMetadata',
        'setMetadata',
        'getAllMetadata',
        'abortDeleteDevice',
        'hasVolatileMetadata',
        'setVolatileMetadata',
        'getVolatileMetadata',
        'deleteVolatileMetadata',
        'setInterfaceClock',
        'replaceDevice',
        'listReplaceableDevices'
    ];

    rpcAlert(daemon, 'system.listMethods', [], (err, data) => {
        $consoleRpcMethod.html('');

        if (!err && data && data.length > 0) {
            data.sort();
            for (let i = 0; i < data.length; i++) {
                const method = data[i];
                if ((config.daemons[daemon].type !== 'HmIP') || (hmipExclude.indexOf(method) === -1)) {
                    $consoleRpcMethod.append('<option value="' + method + '">' + method + '</option>');
                }
            }
        } else if (err) {
            alert(err); // eslint-disable-line no-alert
        }
        $consoleRpcMethod.multiselect('refresh');
    });
}
function formConsoleParams() {
    $('#console-rpc-params').val('');
    $('#console-rpc-error').html('');
    setValueDesc = null;
    const method = $consoleRpcMethod.val();
    if (rpcMethods[method] && rpcMethods[method].help) {
        if (rpcMethods[method].help[language]) {
            $('#console-rpc-method-help').html(rpcMethods[method].help[language]);
        } else {
            $('#console-rpc-method-help').html(rpcMethods[method].help.de);
        }
    }
    const params = rpcMethods[method].params;
    let heading = '<span style="color:#777">' + rpcMethods[method].returns + '</span> ' + method + '(';
    const paramArr = [];
    let form = '';
    let selectOptions;
    for (let i = 0; i < params.length; i++) {
        switch (params[i].type) {
            case 'integer':
                if (params[i].bitmask) {
                    form += '<tr><td colspan="3">' + params[i].name + '</td></tr>';
                    Object.keys(params[i].bitmask).forEach(val => {
                        form += '<tr><td style="padding-left: 6px;"><label for="bitmask_param_' + val + '_' + i + '">' + params[i].bitmask[val] + '</label></td><td></td><td><input class="console-param-checkbox" type="checkbox" value="' + val + '" name="bitmask_param_' + val + '_' + i + '" id="bitmask_param_' + val + '_' + i + '"/></td></tr>';
                    });
                } else if (params[i].values) {
                    selectOptions = '<option value="">Bitte auswählen</option>';
                    Object.keys(params[i].values).forEach(val => {
                        selectOptions += '<option value="' + val + '">' + params[i].values[val] + ' (' + val + ')</option>';
                    });
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
                for (let j = 0, len = listDevices.length; j < len; j++) {
                    if (listDevices[j].PARENT) {
                        continue;
                    }
                    if (listDevices[j].ADDRESS.match(/BidCoS/)) {
                        continue;
                    }
                    const name = names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '';

                    selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                }
                form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                break;
            case 'channel_address':
                selectOptions = '<option value="">Bitte auswählen</option>';
                for (let j = 0, len = listDevices.length; j < len; j++) {
                    if (!listDevices[j].PARENT) {
                        continue;
                    }
                    if (listDevices[j].ADDRESS.endsWith(':0')) {
                        continue;
                    }
                    const name = names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '';

                    selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                }
                form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                break;
            case 'address':
                selectOptions = '<option value="">' + _('Please select') + '</option>';
                for (let j = 0, len = listDevices.length; j < len; j++) {
                    const name = names && names[listDevices[j].ADDRESS] ? names[listDevices[j].ADDRESS] : '';

                    selectOptions += '<option value="' + listDevices[j].ADDRESS + '">' + listDevices[j].ADDRESS + ' ' + name + '</option>';
                }
                form += '<tr><td><label for="param_' + i + '">' + params[i].name + '</label></td><td></td><td><select class="param-search" name="param_' + i + '" id="param_' + i + '" class="">' + selectOptions + '</select></td></tr>';
                break;
            case 'interface_address':
                selectOptions = '<option value="">' + _('Please select') + '</option>';
                for (let j = 0, len = listInterfaces.length; j < len; j++) {
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
        paramArr.push('<span style="color:#777">' + (params[i].type.endsWith('address$') || params[i].type === 'value_key' ? 'string' : params[i].type) + '</span> ' + params[i].name);
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
    const paramArr = [];
    const method = $consoleRpcMethod.val();

    const param0 = $('#param_0').val();
    if (method === 'setValue' && $(elem).attr('id') === 'param_0' && param0) {
        $('#param_1').val('...').attr('disabled', true);
        rpcAlert(daemon, 'getParamsetDescription', [param0, 'VALUES'], (err, data) => {
            let selectOptions = '<option value="">Bitte auswählen</option>';
            setValueParamsetDescription = data;
            for (const dp in data) {
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
    } else if (method === 'setValue' && $(elem).attr('id') === 'param_1' && param0) {
        const desc = setValueParamsetDescription[$(elem).val()];
        setValueDesc = desc;
        switch (desc.TYPE) {
            case 'BOOL':
            case 'ACTION':
                $('#param_2').replaceWith('<input id="param_2" type="checkbox">');
                break;
            case 'INTEGER':
                $('#param_2').replaceWith('<input class="console-param-input ui-widget ui-state-default ui-corner-all" type="number" name="param_2" id="param_2"/>');
                break;
            default:
                $('#param_2').replaceWith('<input class="console-param-input ui-widget ui-state-default ui-corner-all" type="text" name="param_2" id="param_2"/>');
        }
    }

    // TODO putParamset dynamische Eingabefelder

    $('[id^="bitmask_param_"]').each(function () {
        const tmpArr = $(this).attr('id').split('_');
        const paramIndex = parseInt(tmpArr[3], 10);
        if (paramArr[paramIndex] === undefined) {
            paramArr[paramIndex] = 0;
        }
        const bit = parseInt(tmpArr[2], 10);
        if ($(this).is(':checked')) {
            paramArr[paramIndex] += bit;
        }
    });

    $('[id^="param_"]').each(function () {
        if ($(this).attr('id').endsWith('_ms')) {
            return;
        }
        const paramIndex = parseInt($(this).attr('id').slice(6), 10);
        const paramDesc = rpcMethods[method].params[paramIndex];
        let val = $(this).val();
        if (paramDesc.type === 'integer') {
            const val = parseInt($(this).val(), 10);
            if (isNaN(val) && !paramDesc.optional) {
                paramArr[paramIndex] = 0;
            } else if (!isNaN(val)) {
                paramArr[paramIndex] = val;
            }
        } else if (paramDesc.type === 'boolean') {
            paramArr[paramIndex] = $(this).is(':checked');
        } else if (setValueDesc && paramDesc.type === 'mixed') {
            switch (setValueDesc.TYPE) {
                case 'BOOL':
                case 'ACTION':
                    paramArr[paramIndex] = $(this).is(':checked');
                    break;
                case 'FLOAT':
                    val = parseFloat($(this).val());
                    if (isNaN(val)) {
                        val = 0;
                    }
                    paramArr[paramIndex] = val;
                    break;
                case 'INTEGER':
                    val = parseInt($(this).val(), 10);
                    if (isNaN(val)) {
                        val = 0;
                    }
                    paramArr[paramIndex] = val;
                    break;
                default:
                    paramArr[paramIndex] = $(this).val();
            }
        } else if (val || !paramDesc.optional) {
            paramArr[paramIndex] = val;
        }
        $('#console-rpc-params').val(JSON.stringify(paramArr).slice(1).slice(0, -1).replace(/,/g, ', '));
    });
}

const rpcDialogQueue = [];

function rpcDialog(daemon, cmd, params, callback) {
    // RpcDialogShow(daemon, cmd, params, callback);
    rpcDialogQueue.push({dialog: 'rpcDialog', daemon, cmd, params, callback});
    if (!rpcDialogPending) {
        rpcDialogShift();
    }
}

// RPC execution Wrappers
function rpcDialogShift() {
    if (rpcDialogQueue.length < 1) {
        return;
    }
    rpcDialogPending = true;

    const tmp = rpcDialogQueue.shift();

    const daemon = tmp.daemon;
    const cmd = tmp.cmd;
    const params = tmp.params;
    const callback = tmp.callback;

    const paramText = JSON.stringify(JSON.parse(JSON.stringify(params).replace(/{"explicitDouble":([0-9.]+)}/g, '$1')), null, '  ');


    $('#rpc-command').html(cmd + ' ' + paramText);
    $('#rpc-message').html('');
    $dialogRpc.dialog('open');
    $('#rpc-progress').show();
    // Console.log('>', daemon, cmd, params);
    ipcRpc.send('rpc', [daemon, cmd, params], (err, res) => {
        $('#rpc-progress').hide();
        if (err) {
            $dialogRpc.parent().children().children('.ui-dialog-titlebar-close').show();
            $('#rpc-message').html('<span style="color: red; font-weight: bold;">' + (err.faultString ? err.faultString : JSON.stringify(err)) + '</span>');
            setTimeout(() => {
                rpcDialogPending = false;
                rpcDialogShift();
            }, 1500);
        } else if (res && res.faultCode) {
            $dialogRpc.parent().children().children('.ui-dialog-titlebar-close').show();
            $('#rpc-message').html('<span style="color: orange; font-weight: bold;">' + res.faultString + ' (' + res.faultCode + ')</span>');
            setTimeout(() => {
                rpcDialogPending = false;
                rpcDialogShift();
            }, 1500);
        } else {
            $dialogRpc.parent().children().children('.ui-dialog-titlebar-close').hide();
            const resText = res ? ('<br>' + (typeof res === 'string' ? res : JSON.stringify(res, null, '  '))) : '';
            $('#rpc-message').html('<span style="color: green;">success</span><br>' + resText);
            setTimeout(() => {
                rpcDialogPending = false;
                if (rpcDialogQueue.length > 0) {
                    rpcDialogShift();
                } else {
                    $dialogRpc.dialog('close');
                }
            }, 1500);
        }
        if (typeof callback === 'function') {
            callback(err, res);
        }
    });
}
function rpcAlert(daemon, cmd, params, callback) {
    ipcRpc.send('rpc', [daemon, cmd, params], (err, res) => {
        if (err) {
            alert(daemon + ' ' + cmd + '\n' + JSON.stringify(err)); // eslint-disable-line no-alert
        } else if (res && res.faultCode) {
            alert(daemon + ' ' + cmd + '\n' + JSON.stringify(res)); // eslint-disable-line no-alert
        }
        if (typeof callback === 'function') {
            callback(err, res);
        }
    });
}

// Helper functions
function dialogAlert(text, title) {
    title = title || '&nbsp';
    $('#alert').html(text);
    $dialogAlert.dialog('option', 'title', title);
    $dialogAlert.dialog('open');
}
function rssiColor(rssi) {
    if (typeof rssi === 'undefined' || rssi === '' || rssi === 65536) {
        return '';
    }

    const RSSI_BAD = -120.0;
    const RSSI_MEDIUM = -100.0;
    const RSSI_GOOD = -20.0;

    let red = Math.round(256 * (rssi - RSSI_GOOD) / (RSSI_MEDIUM - RSSI_GOOD));
    if (red < 0) {
        red = 0;
    }
    if (red > 255) {
        red = 255;
    }

    let green = Math.round(256 * (rssi - RSSI_BAD) / (RSSI_MEDIUM - RSSI_BAD));
    if (green < 0) {
        green = 0;
    }
    if (green > 255) {
        green = 255;
    }

    const color = '#' + ('0' + red.toString(16)).slice(-2) + ('0' + green.toString(16)).slice(-2) + '00';
    return '<span class="rssi-cell" style="background-color:' + color + ';">' + rssi + '</span>';
}
function removeSelectionAfterDblClick() {
    if (document.selection && document.selection.empty) {
        document.selection.empty();
    } else if (window.getSelection) {
        const sel = window.getSelection();
        sel.removeAllRanges();
    }
}

// Resizing
function resizeGrids() {
    let x = $(window).width();
    let y = $(window).height();
    if (x < 1200) {
        x = 1200;
    }
    if (y < 600) {
        y = 600;
    }

    $('#grid-devices, #grid-links, #grid-messages').setGridHeight(y - 144).setGridWidth(x - 18);

    $('#grid-events').css('height', (y - 80) + 'px').css('width', (x - 18) + 'px');
    $('#grid-events-inner').css('height', (y - 100) + 'px');
    $('#grid-interfaces')/* .setGridHeight(y - 99) */.setGridWidth(x - 18);
    $('#grid-rssi').setGridHeight(y - (173 + $('#gbox_grid-interfaces').height())).setGridWidth(x - 18);

    /*
     // funktioniert nicht mit gruppierten Headers :-(
     // .updateColumns deprecated :-((

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
    const tmp = window.location.hash.slice(1).split('/');
    hash = tmp[1];
    if (config.daemons[hash]) {
        if (daemon !== hash) {
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
        const index = $('#tabs-main a[href="#' + tmp[2] + '"]').parent().index();
        $tabsMain.tabs('option', 'active', index - 2);
    }
};

function dialogConfigOpen() {
    $('#init-ip-select').html('');
    config.rpcInitIpSelect.forEach(ip => {
        if (ip === config.rpcInitIp) {
            $('#init-ip-select').append('<option selected>' + ip + '</option>');
        } else {
            $('#init-ip-select').append('<option>' + ip + '</option>');
        }
    });

    $('#ccu-address').val(config.ccuAddress);

    $('#ccu-address-select').html('<option>' + _('Select') + '</option>');
    config.ccuAddressSelect.forEach(ccu => {
        if (ccu.type === 'eQ3-HM-CCU2-App') {
            if (ccu.address === config.ccuAddress) {
                $('#ccu-address-select').append(`<option value="${ccu.address}" selected>${ccu.address} ${ccu.serial}</option>`);
            } else {
                $('#ccu-address-select').append(`<option value="${ccu.address}">${ccu.address} ${ccu.serial}</option>`);
            }
        }
    });

    $dialogConfig.dialog('open');
}

