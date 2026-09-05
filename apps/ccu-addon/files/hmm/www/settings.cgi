#!/bin/tclsh
#
# The page behind the Homematic Manager button in Systemsteuerung, and the only door into the UI.
#
# The addon has no configuration dialog of its own: everything about the CCU is configured inside
# the app, and everything about the host process is decided by the fact that it runs on the CCU. So
# this CGI does exactly one thing, and it is the thing lighttpd cannot do - it asks ReGaHSS whether
# the caller has a WebUI session, and only then hands out the token the backend's API socket wants:
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

source [file join [file dirname [info script]] lib common.tcl]

array set params [query_params]
set sid ""
if {[info exists params(sid)]} {
    set sid $params(sid)
}

if {![check_session $sid]} {
    html_header
    puts "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"utf-8\">"
    puts "<title>Homematic Manager</title></head><body style=\"font-family:sans-serif;margin:2em\">"
    puts "<h1>Homematic Manager</h1>"
    puts "<p>Sitzung ungültig. Bitte diese Seite schließen und im WebUI neu anmelden.</p>"
    puts "<p>Invalid session. Please close this page and log in to the WebUI again.</p>"
    puts "</body></html>"
    exit 0
}

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
