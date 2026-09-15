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
    # D-40: on openccu-lite the second mode is not `rega` - there is no ReGaHSS and the users are
    # the box's own - it is `occulite`, where the session the box's shell hands over is checked
    # against the box's own API. Which of the two is offered is decided at runtime, so the same
    # package behaves correctly on either firmware.
    # B-22: and each firmware has its own line in hmm.env, read the way rc.d/hmm reads it (its
    # LiteAuthMode). A CCU reads HMM_AUTH_MODE, token unless it says rega. openccu-lite reads
    # HMM_AUTH_MODE_LITE, occulite unless it says exactly `token` - a `HMM_AUTH_MODE=token` from the
    # CCU days is not read there, because that line is in every hmm.env a CCU install wrote, and it
    # kept the Charly's addon out of the box's login after its upgrade. A choice made on this page is
    # written into the line of the firmware the page runs on, and survives a move to the other one.
    set lite [is_openccu_lite]
    if {$lite} {
        set other "occulite"
        set variable HMM_AUTH_MODE_LITE
    } else {
        set other "rega"
        set variable HMM_AUTH_MODE
    }
    set mode [read_env $variable ""]
    if {$lite} {
        if {![string equal $mode "token"]} {
            set mode "occulite"
        }
    } elseif {![string equal $mode "rega"]} {
        set mode "token"
    }

    if {[info exists params(auth_mode)]} {
        set wanted $params(auth_mode)
        if {[string equal $wanted "token"] || [string equal $wanted $other]} {
            if {![string equal $wanted $mode]} {
                write_env $variable $wanted
                set mode $wanted
                catch {exec $RC_SCRIPT restart} output
                set message "Gespeichert, der Dienst wurde neu gestartet. / Saved, the service was restarted."
            }
        } else {
            set message "Unbekannter Wert. / Unknown value."
        }
    }

    # Task 43 (#159): where the backend's output goes on a CCU and OpenCCU, the same way as the mode
    # above: written into hmm.env, which rc.d/hmm reads at the start the restart does. On openccu-lite
    # the log is the journal and there is nothing to choose.
    set logchoice [log_choice]
    if {[info exists params(log)]} {
        set wanted $params(log)
        if {$lite} {
            set message "Auf openccu-lite steht das Log im Journal, es gibt nichts umzustellen. / On openccu-lite the log is the journal, there is nothing to switch."
        } elseif {[string equal $wanted "varlog"] || [string equal $wanted "addon"]} {
            if {![string equal $wanted $logchoice]} {
                write_env HMM_ADDON_LOG $wanted
                set logchoice $wanted
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
    puts "pre{background:#f4f4f4;padding:.5em .7em;overflow:auto;max-height:30em;font-size:.85em}"
    puts "</style></head><body>"
    puts "<h1>Homematic Manager</h1>"
    if {![string equal $message ""]} {
        puts "<p class=\"msg\">[html_escape $message]</p>"
    }
    puts "<h2>Anmeldung / Login</h2>"
    puts "<table><tr><td><b>token</b></td><td>"
    puts "Die WebUI-Sitzung entscheidet: der Knopf in der Systemsteuerung öffnet die App direkt."
    puts "<br>The WebUI session decides: the button in Systemsteuerung opens the app directly."
    puts "</td></tr><tr><td><b>[html_escape $other]</b></td><td>"
    if {$lite} {
        puts "Zusätzlich: die Sitzung, die openccu-lite der Addon-Seite übergibt (?sid=@...@), wird"
        puts "gegen die Metadaten-API der Box geprüft. Ohne gültige Sitzung landet der Browser auf"
        puts "der Anmeldung der Box. Das ist die Voreinstellung auf openccu-lite."
        puts "<br>Additionally: the session openccu-lite hands the addon page (?sid=@...@) is checked"
        puts "against the box's metadata API. Without a valid one the browser is sent to the box's"
        puts "own login. This is the default on openccu-lite."
    } else {
        puts "Zusätzlich eine eigene Anmeldung mit einem CCU-Benutzer, wenn die App ohne WebUI-Sitzung"
        puts "geöffnet wird (z.B. als Lesezeichen). Der Weg über die Systemsteuerung funktioniert"
        puts "unverändert weiter."
        puts "<br>Additionally asks for a CCU user when the app is opened without a WebUI session (a"
        puts "bookmark, say). The way through Systemsteuerung keeps working unchanged."
    }
    puts "</td></tr></table>"
    puts "<p>Aktuell / current: <b>[html_escape $mode]</b></p>"
    if {[string equal $mode $other]} {
        puts "<p><a href=\"settings.cgi?cmd=config&amp;auth_mode=token$query\">Auf <b>token</b>"
        puts "umstellen / switch to <b>token</b></a></p>"
    } else {
        puts "<p><a href=\"settings.cgi?cmd=config&amp;auth_mode=[html_escape $other]$query\">Auf"
        puts "<b>[html_escape $other]</b> umstellen / switch to <b>[html_escape $other]</b></a></p>"
    }
    puts "<p class=\"note\">Das schreibt $variable nach"
    puts "/usr/local/addons/hmm/etc/hmm.env und startet den Dienst neu. Dieselbe Datei nimmt jede"
    puts "weitere Option des Hosts auf (<code>homematic-manager-web --help</code>), z.B."
    puts "HMM_SESSION_TTL.</p>"
    puts "<p class=\"note\">This writes $variable to /usr/local/addons/hmm/etc/hmm.env and"
    puts "restarts the service. The same file takes every other option of the host, e.g."
    puts "HMM_SESSION_TTL.</p>"
    if {$lite && ![string equal [read_env HMM_AUTH_MODE ""] ""]} {
        # B-22: the line a CCU install left behind, so nobody wonders why it has no effect
        puts "<p class=\"note\">HMM_AUTH_MODE=[html_escape [read_env HMM_AUTH_MODE ""]] steht auch in"
        puts "der Datei: das ist die Einstellung einer CCU und wird auf openccu-lite nicht gelesen."
        puts "<br>HMM_AUTH_MODE=[html_escape [read_env HMM_AUTH_MODE ""]] is in the file as well: that"
        puts "is a CCU's setting and is not read on openccu-lite.</p>"
    }
    puts "<h2>Log</h2>"
    if {$lite} {
        # tasks 41 and 43: there is no log file on openccu-lite; the box's Log page shows the journal,
        # and occulited is where its storage is set
        puts "<p>Auf openccu-lite steht das Log im Journal der Box; wo es gespeichert wird, stellt man"
        puts "in occulited ein (<a href=\"[html_escape $LITE_LOG_PAGE]\">Seite Log</a>)."
        puts "<br>On openccu-lite the log is in the box's journal; its storage is configured in"
        puts "occulited (<a href=\"[html_escape $LITE_LOG_PAGE]\">Log page</a>).</p>"
    } else {
        puts "<table><tr><td><b>varlog</b></td><td><code>[html_escape $VARLOG_LOG_FILE]</code><br>"
        puts "Im Arbeitsspeicher (tmpfs): keine Schreibzugriffe auf die SD-Karte, nach einem Neustart"
        puts "der CCU leer. Das ist die Voreinstellung."
        puts "<br>In memory (tmpfs): no writes to the SD card, empty after a reboot of the CCU. This is"
        puts "the default."
        puts "</td></tr><tr><td><b>addon</b></td><td><code>[html_escape $ADDON_LOG_FILE]</code><br>"
        puts "Im Addon-Verzeichnis: bleibt über einen Neustart erhalten, schreibt dafür auf die SD-Karte."
        puts "<br>In the addon directory: survives a reboot, at the cost of writes to the SD card."
        puts "</td></tr></table>"
        puts "<p>Aktuell / current: <b>[html_escape $logchoice]</b></p>"
        if {[string equal $logchoice "addon"]} {
            set switchto "varlog"
        } else {
            set switchto "addon"
        }
        puts "<p><a href=\"settings.cgi?cmd=config&amp;log=$switchto[html_escape $query]\">Auf"
        puts "<b>$switchto</b> umstellen / switch to <b>$switchto</b></a></p>"
        puts "<p class=\"note\">Das schreibt HMM_ADDON_LOG nach /usr/local/addons/hmm/etc/hmm.env und"
        puts "startet den Dienst neu; die Datei am anderen Ort wird dabei gelöscht. Beide Dateien werden"
        puts "bei 1 MB rotiert (hmm.log.1).</p>"
        puts "<p class=\"note\">This writes HMM_ADDON_LOG to /usr/local/addons/hmm/etc/hmm.env and"
        puts "restarts the service, which removes the file at the other location. Both files are"
        puts "rotated at 1 MB (hmm.log.1).</p>"
        set shown [log_file]
        puts "<p>Die letzten Zeilen / the last lines: <code>[html_escape $shown]</code></p>"
        if {[file isfile $shown]} {
            catch {exec tail -n 50 $shown} lines
            puts "<pre>[html_escape $lines]</pre>"
        } else {
            puts "<p class=\"note\">(kein Log vorhanden - der Dienst lief noch nicht / no log yet)</p>"
        }
    }
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
