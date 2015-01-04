var translation = {
    "Devices":          {"de": "Geräte"},
    "Events":           {"de": "Ereignisse"},
    "Cancel":           {"de": "Abbrechen"},
    "OK":               {"de": "OK"},
    "Delete":           {"de": "Löschen"},
    "Save":             {"de": "Speichern"},
    "Create and edit":  {"de": "Anlegen und Bearbeiten"},
    "Create":           {"de": "Anlegen"},
    "Please choose one or more channels":        {"de": "Bitte einen oder mehrere Kanäle auswählen"},
    "Refresh":          {"de": "Aktualisieren"},
    "Delete device":    {"de": "Gerät löschen"},
    "Rename device":    {"de": "Gerät umbenennen"},
    "Pair devices":     {"de": "Geräte anlernen"},
    "Links":            {"de": "Direktverknüpfungen"},
    "Delete Links":     {"de": "Direktverknüpfung löschen"},
    "edit Links":       {"de": "Direktverknüpfung bearbeiten"},
    "Test link":        {"de": "Direktverknüpfung testen"},
    "Create Link":      {"de": "Direktverknüpfung anlegen"},
    "RSSI":             {"de": "RSSI"},
    "RPC Console":      {"de": "RPC Konsole"},
    "Service messages": {"de": "Servicemeldungen"},
    "Send request":     {"de": "Befehl senden"},
    "Parameters":       {"de": "Parameter"},
    "Response":         {"de": "Antwort"},
    "Help":             {"de": "Hilfe"},
    "Settings":         {"de": "Einstellungen"},
    "Acknowledge service messages":         {"de": "Servicemeldung bestätigen"},
    "Acknowledge all service messages":     {"de": "Alle Servicemeldungen bestätigen"},
    "Interfaces":       {"de": "Interfaces"},
    "Edit device":      {"de": "Gerät bearbeiten"},
    "undefined":        {"de": "undefined"},
    "Please select method":                 {"de": "Bitte eine Methode auswählen"}
};

var language = 'de';

var missesTranslation = [];

function _(word) {
    if (translation[word]) {
        if (translation[word][language]) {
            return translation[word][language];
        }
    }
    if (missesTranslation.indexOf(word) === -1) {
        console.log('"' + word + '":        {"de": "' + word + '"},');
        missesTranslation.push(word);
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