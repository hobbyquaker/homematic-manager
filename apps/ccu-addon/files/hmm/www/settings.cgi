#!/bin/tclsh
#
# The page behind the Homematic Manager button in Systemsteuerung, and the only door into the UI.
#
# Two things, and the first one is the one that matters. It asks ReGaHSS whether the caller has a
# WebUI session, and only then hands out the token the backend's API socket wants:
#
#   GET /addons/hmm/settings.cgi?sid=@xxxxxxxxxx@
#     -> valid    302 to /addons/hmm/ with Set-Cookie hmm_token, Path=/addons/hmm/, HttpOnly,
#                 SameSite=Strict (and Secure when the WebUI was reached over https)
#     -> invalid  a page that says so, in German and English
#
# The browser then replays the cookie on the WebSocket upgrade of the same origin all by itself,
# the host rewrites it into the `?token=` form the backend accepts, and `packages/ui` needs to know
# nothing about any of it (task 12). The host itself runs with `--no-issue-cookie`: behind the CCU's
# lighttpd the cookie may only come from something that checked who is asking, and that is this
# script.
#
# The second thing is `?cmd=config` (D-32): the addon's settings page, which is where the optional
# login against ReGa is switched on and off. It is a separate URL on purpose - the button in
# Systemsteuerung opens the app, as it always has, and the hand-over above is untouched by any of
# the settings below.

source [file join [file dirname [info script]] lib common.tcl]

array set params [query_params]
set sid ""
if {[info exists params(sid)]} {
    set sid $params(sid)
}
set cmd ""
if {[info exists params(cmd)]} {
    set cmd $params(cmd)
}

# `sid` is how the WebUI calls this; the token cookie is how a browser that already has the app
# open calls it. Both were issued after the same ReGaHSS session check.
if {![check_session $sid] && ![has_token_cookie]} {
    html_header
    puts "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
    puts "<title>Homematic Manager</title></head><body style=\"font-family:sans-serif;margin:2em\">"
    puts "<h1>Homematic Manager</h1>"
    puts "<p>Sitzung ungültig. Bitte diese Seite schließen und im WebUI neu anmelden.</p>"
    puts "<p>Invalid session. Please close this page and log in to the WebUI again.</p>"
    puts "</body></html>"
    exit 0
}

# ---------------------------------------------------------------------------------------------
# The settings page (D-32). Everything about the CCU itself is configured inside the app; what is
# here is what the *host process* is started with, and today that is exactly one thing.
# ---------------------------------------------------------------------------------------------
if {[string equal $cmd "config"]} {
    set message ""
    set mode [read_env HMM_AUTH_MODE token]
    if {![string equal $mode "rega"]} {
        set mode "token"
    }

    if {[info exists params(auth_mode)]} {
        set wanted $params(auth_mode)
        if {[string equal $wanted "token"] || [string equal $wanted "rega"]} {
            if {![string equal $wanted $mode]} {
                write_env HMM_AUTH_MODE $wanted
                set mode $wanted
                catch {exec $RC_SCRIPT restart} output
                set message "Gespeichert, der Dienst wurde neu gestartet. / Saved, the service was restarted."
            }
        } else {
            set message "Unbekannter Wert. / Unknown value."
        }
    }

    set query ""
    if {![string equal $sid ""]} {
        set query "&sid=$sid"
    }

    html_header
    puts "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
    puts "<title>Homematic Manager</title>"
    puts "<style>body{font-family:sans-serif;margin:2em;max-width:44em}"
    puts "h1{font-size:1.3em}h2{font-size:1.05em;margin-top:1.6em}"
    puts "p.note{color:#666}p.msg{padding:.5em .7em;border:1px solid #2779aa;background:#eef4fb}"
    puts "table{border-collapse:collapse}td{padding:.2em .8em .2em 0;vertical-align:top}"
    puts "</style></head><body>"
    puts "<h1>Homematic Manager</h1>"
    if {![string equal $message ""]} {
        puts "<p class=\"msg\">[html_escape $message]</p>"
    }
    puts "<h2>Anmeldung / Login</h2>"
    puts "<table><tr><td><b>token</b></td><td>"
    puts "Die WebUI-Sitzung entscheidet: der Knopf in der Systemsteuerung öffnet die App direkt."
    puts "<br>The WebUI session decides: the button in Systemsteuerung opens the app directly."
    puts "</td></tr><tr><td><b>rega</b></td><td>"
    puts "Zusätzlich eine eigene Anmeldung mit einem CCU-Benutzer, wenn die App ohne WebUI-Sitzung"
    puts "geöffnet wird (z.B. als Lesezeichen). Der Weg über die Systemsteuerung funktioniert"
    puts "unverändert weiter."
    puts "<br>Additionally asks for a CCU user when the app is opened without a WebUI session (a"
    puts "bookmark, say). The way through Systemsteuerung keeps working unchanged."
    puts "</td></tr></table>"
    puts "<p>Aktuell / current: <b>[html_escape $mode]</b></p>"
    if {[string equal $mode "rega"]} {
        puts "<p><a href=\"settings.cgi?cmd=config&amp;auth_mode=token$query\">Auf <b>token</b>"
        puts "umstellen / switch to <b>token</b></a></p>"
    } else {
        puts "<p><a href=\"settings.cgi?cmd=config&amp;auth_mode=rega$query\">Auf <b>rega</b>"
        puts "umstellen / switch to <b>rega</b></a></p>"
    }
    puts "<p class=\"note\">Das schreibt HMM_AUTH_MODE nach"
    puts "/usr/local/addons/hmm/etc/hmm.env und startet den Dienst neu. Dieselbe Datei nimmt jede"
    puts "weitere Option des Hosts auf (<code>homematic-manager-web --help</code>), z.B."
    puts "HMM_SESSION_TTL.</p>"
    puts "<p class=\"note\">This writes HMM_AUTH_MODE to /usr/local/addons/hmm/etc/hmm.env and"
    puts "restarts the service. The same file takes every other option of the host, e.g."
    puts "HMM_SESSION_TTL.</p>"
    if {![string equal $sid ""]} {
        puts "<p><a href=\"settings.cgi?sid=[html_escape $sid]\">Homematic Manager öffnen / open</a></p>"
    } else {
        puts "<p><a href=\"$BASE_PATH/\">Homematic Manager öffnen / open</a></p>"
    }
    puts "</body></html>"
    exit 0
}

# ---------------------------------------------------------------------------------------------
# The hand-over. Unchanged by D-32: a WebUI session that passed the check above gets the token
# cookie and is let straight into the UI, login page or no login page.
# ---------------------------------------------------------------------------------------------
set token [read_token]
if {[string equal $token ""]} {
    html_header
    puts "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
    puts "<title>Homematic Manager</title></head><body style=\"font-family:sans-serif;margin:2em\">"
    puts "<h1>Homematic Manager</h1>"
    puts "<p>Kein Token gefunden ($TOKEN_FILE). Das Addon wurde nicht vollständig installiert -"
    puts "bitte das Paket erneut installieren.</p>"
    puts "<p>No token found ($TOKEN_FILE). The addon was not installed completely - please install"
    puts "the package again.</p>"
    puts "</body></html>"
    exit 0
}

set cookie "hmm_token=$token; Path=$BASE_PATH/; HttpOnly; SameSite=Strict"
if {[request_is_https]} {
    append cookie "; Secure"
}

puts "Status: 302 Found"
puts "Set-Cookie: $cookie"
puts "Location: $BASE_PATH/"
puts "Cache-Control: no-store"
puts "Content-Type: text/html; charset=utf-8\r\n"
puts "<!DOCTYPE html><meta charset=\"utf-8\"><title>Homematic Manager</title>"
puts "<p><a href=\"$BASE_PATH/\">Homematic Manager</a></p>"
