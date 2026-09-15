#!/usr/bin/tclsh
#
# An openccu-lite box, as far as the addon's CGIs ask one: GET /api/auth/v1/state answered the way
# occulited's httpapi answers it, keyed by the Bearer the request carries (task 50).
#
#   tclsh occulite-state-stub.tcl <port file> <request log>
#
# Listens on 127.0.0.1 on a free port, writes the port into <port file> and every request as
# "<method> <path> <Authorization or ->" into <request log>, so a test can see which calls were made
# - and that none was. The answer depends on the Bearer:
#
#   LIVE            authenticated, this session: {"authenticated":true,...,"sid":"<LIVE>"} - occulited's
#                   answer for a session that is not a token (with "legacy_sid" too, which must not
#                   be mistaken for "sid"); the role admin
#   OLD             the same for a ten-character session id, as an image from before occulited's
#                   task 125 hands them out; the role user
#   OLDADMIN        a ten-character session id with the role admin
#   USER            a 26-character session with the role user (B-37)
#   NOROLE          a session whose answer names no role
#   ADMINCASE       the role "Admin", which is not the role admin
#   ESCROLE         a role with a JSON escape in it ("admin")
#   FAKEROLE        the role user, and a user name that spells "role":"admin" inside its escaped quotes,
#                   placed before the real role
#   NOSID           authenticated without a sid - occulited's answer for an API token (a real one,
#                   olt_ and 32 hex digits, never reaches a box: the CGI refuses the underscore)
#   OTHER           authenticated, but the state names the LIVE session - a box that answers for
#                   another session than the one asked about (cannot happen, must still be refused)
#   BROKEN          500 with an HTML body
#   GARBAGE         200 with a body that is no JSON but contains the words
#   anything else   {"authenticated":false}, as for an unknown or expired id
#
# The ids have the shapes occulited hands out: 26 characters of base32 since their task 125, ten
# alphanumerics before.

set LIVE ABCDEFGHIJKLMNOPQRSTUVWXYZ
set OLD abcdefgh12
set NOSID NOSIDNOSIDNOSIDNOSIDNOSI22
set OTHER OTHERSESSIONOTHERSESSION22
set BROKEN BROKENBROKENBROKENBROKEN22
set GARBAGE GARBAGEGARBAGEGARBAGEGAR22
set OLDADMIN oldadmin12
set USERSID USERSESSIONUSERSESSIONUS22
set NOROLE NOROLENOROLENOROLENOROLE22
set ADMINCASE ADMINCASEADMINCASEADMINC22
set ESCROLE ESCAPEDROLEESCAPEDROLEES22
set FAKEROLE FAKEROLEFAKEROLEFAKEROLE22

set portFile [lindex $argv 0]
set logFile [lindex $argv 1]

proc answer {chan status type body} {
    set head "HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: [string length $body]\r\nConnection: close\r\n\r\n"
    puts -nonewline $chan $head$body
}

proc serve {chan addr port} {
    global LIVE OLD NOSID OTHER BROKEN GARBAGE OLDADMIN USERSID NOROLE ADMINCASE ESCROLE FAKEROLE logFile
    fconfigure $chan -translation {auto binary} -blocking 1
    set request [gets $chan]
    set auth "-"
    while {![eof $chan]} {
        set line [gets $chan]
        if {[string equal $line ""]} {
            break
        }
        if {[regexp -nocase {^Authorization:\s*(.*)$} $line all value]} {
            set auth [string trim $value]
        }
    }
    regexp {^([A-Z]+) ([^ ]+)} $request all method path
    set fd [open $logFile a]
    puts $fd "$method $path $auth"
    close $fd
    if {![string equal $method GET] || ![string equal $path /api/auth/v1/state]} {
        answer $chan "404 Not Found" application/json {{"error":"not found"}}
    } elseif {[string equal $auth "Bearer $LIVE"]} {
        answer $chan "200 OK" application/json "{\"setup_required\":false,\"authenticated\":true,\"user\":\"anna\",\"role\":\"admin\",\"scopes\":\[\"*\"\],\"must_change_password\":false,\"sid\":\"$LIVE\",\"method\":\"password\",\"legacy_sid\":\"abcdefgh12\"}"
    } elseif {[string equal $auth "Bearer $OLD"]} {
        answer $chan "200 OK" application/json "{\"setup_required\":false,\"authenticated\":true,\"user\":\"anna\",\"role\":\"user\",\"scopes\":\[\],\"must_change_password\":false,\"sid\":\"$OLD\",\"method\":\"password\"}"
    } elseif {[string equal $auth "Bearer $NOSID"]} {
        answer $chan "200 OK" application/json {{"setup_required":false,"authenticated":true,"user":"anna","role":"admin","scopes":["meta:read"],"must_change_password":false}}
    } elseif {[string equal $auth "Bearer $OTHER"]} {
        answer $chan "200 OK" application/json "{\"setup_required\":false,\"authenticated\":true,\"user\":\"anna\",\"role\":\"admin\",\"sid\":\"$LIVE\"}"
    } elseif {[string equal $auth "Bearer $BROKEN"]} {
        answer $chan "500 Internal Server Error" text/html "<html>authenticated: true sid: $BROKEN</html>"
    } elseif {[string equal $auth "Bearer $GARBAGE"]} {
        answer $chan "200 OK" text/plain "authenticated true sid $GARBAGE"
    } elseif {[string equal $auth "Bearer $OLDADMIN"]} {
        answer $chan "200 OK" application/json [format {{"authenticated":true,"method":"password","must_change_password":false,"role":"admin","setup_required":false,"sid":"%s","user":"admin"}} $OLDADMIN]
    } elseif {[string equal $auth "Bearer $USERSID"]} {
        # the answer of the lab's openccu-lite for an account with the role user, key for key (B-37)
        answer $chan "200 OK" application/json [format {{"authenticated":true,"method":"password","must_change_password":false,"role":"user","scopes":["meta:read"],"setup_required":false,"sid":"%s","user":"b37probe"}} $USERSID]
    } elseif {[string equal $auth "Bearer $NOROLE"]} {
        answer $chan "200 OK" application/json [format {{"authenticated":true,"method":"password","setup_required":false,"sid":"%s","user":"anna"}} $NOROLE]
    } elseif {[string equal $auth "Bearer $ADMINCASE"]} {
        answer $chan "200 OK" application/json [format {{"authenticated":true,"role":"Admin","setup_required":false,"sid":"%s","user":"anna"}} $ADMINCASE]
    } elseif {[string equal $auth "Bearer $ESCROLE"]} {
        # the backslash is put in by format, so no Tcl parser along the way turns m into the m
        answer $chan "200 OK" application/json [format {{"authenticated":true,"role":"ad%su006din","setup_required":false,"sid":"%s","user":"anna"}} [format %c 92] $ESCROLE]
    } elseif {[string equal $auth "Bearer $FAKEROLE"]} {
        answer $chan "200 OK" application/json [format {{"authenticated":true,"user":"eve\",\"role\":\"admin","role":"user","setup_required":false,"sid":"%s"}} $FAKEROLE]
    } else {
        answer $chan "200 OK" application/json {{"setup_required":false,"authenticated":false}}
    }
    close $chan
}

set server [socket -server serve -myaddr 127.0.0.1 0]
set fd [open $portFile w]
puts $fd [lindex [fconfigure $server -sockname] 2]
close $fd
vwait forever
