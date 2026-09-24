#!/bin/tclsh
#
# Session validation and query string handling.
#
# Everything here is written for **Tcl 8.2**, which is what the CCU3 firmware ships (`info
# patchlevel` says 8.2.3, from 1999). That rules out `dict` (8.5), `eq`/`ne` in expressions (8.4),
# `string is` (8.3), `{*}` (8.5), `lassign` (8.5) and `file normalize` (8.4) - all of which are fine
# on OpenCCU and fail on a CCU3. Query parameters are therefore passed around as a plain name/value
# list that the caller turns into an array.
#
# Ported from hm2mqtt.js's addon/files/hm2mqtt/www/lib/session.tcl (same author), which in turn
# follows ccu-addon-howto/templates/lib/session.tcl. The openccu-lite session header below follows
# RedMatic 9.7.3's lib/session.tcl (same author again).

load tclrega.so

# Is this a session the CCU WebUI handed out? The answer comes from ReGaHSS, which is the only
# thing that knows: the WebUI opens the settings page as ?sid=@xxxxxxxxxx@ and every CGI that
# reads or changes anything has to check it, or anyone on the LAN could take the addon over.
proc check_session {sid} {
    if {[regexp {@([0-9a-zA-Z]{10})@} $sid all sidnr]} {
        if {![string equal [lindex [rega_script "Write(system.GetSessionVarStr('$sidnr'));"] 1] ""]} {
            return 1
        }
    }
    return 0
}

# ---------------------------------------------------------------------------------------------
# The session header of openccu-lite (task 50; openccu-lite B-94, D-65).
#
# lighttpd's gate on openccu-lite lets no request under /addons/ through without a live session,
# and hands every request it lets through the bare id of that session as X-Occulite-Session -
# HTTP_X_OCCULITE_SESSION for a CGI - after removing any copy a client sent. With the header the
# settings page and the hand-over no longer need ?sid=@...@ in their address, which is what lets
# the box stop putting the session into URLs (the catalogue's `session.header_since`).
#
# The header is no proof by itself: a CCU's lighttpd passes a client's header straight through to
# the CGI, and so does an openccu-lite image from before the gate. So it is read on openccu-lite
# only (is_openccu_lite, the same rule as rc.d/hmm), and the box is asked about it the way the
# backend asks (apps/web/src/occulite.ts): GET /api/auth/v1/state with the id as Bearer has to
# answer that very session. occulited writes `sid` into that answer only for a session that is not
# an API token, so a token is refused, and so is every failure - an unknown or expired id, a state
# naming another session, a box that cannot be asked, a timeout. Where the header is there and
# confirmed it decides; ?sid=@...@ and the ReGa check above stay for a CCU, for OpenCCU, for an
# older openccu-lite image, and as the fallback when the box does not confirm the header (the
# frontend falls back the same way, B-36).
# ---------------------------------------------------------------------------------------------

# D-40: is this firmware openccu-lite?
#
# `/VERSION` keeps upstream's PRODUCT and PLATFORM and carries an extra `VARIANT=lite` line (their
# D-17), so that update packages stay interchangeable in both directions and the variant is still
# recognisable. That extra line is the only thing to look at - and it is read at *runtime*, never
# written into a configuration file, because a user may move the same `/usr/local` from openccu-lite
# to OpenCCU and back, and an addon that remembered the answer would then be wrong. rc.d/hmm reads
# the same line (B-22); the header path and the settings page follow it, one rule for the addon.
proc is_openccu_lite {} {
    global env
    set file /VERSION
    if {[info exists env(HMM_VERSION_FILE)]} {
        set file $env(HMM_VERSION_FILE)
    }
    if {![file exists $file]} {
        return 0
    }
    set fd [open $file r]
    set content [read $fd]
    close $fd
    foreach line [split $content "\n"] {
        if {[regexp {^VARIANT=lite$} [string trim $line]]} {
            return 1
        }
    }
    return 0
}

# The id in this request's session header, "" when there is none to use. On a CCU the answer is
# "" before the header is even looked at: there the header is whatever the client sent.
proc session_header {} {
    global env
    if {![info exists env(HTTP_X_OCCULITE_SESSION)] || ![is_openccu_lite]} {
        return ""
    }
    return $env(HTTP_X_OCCULITE_SESSION)
}

# Where the box answers about a session: its own lighttpd on the loopback, which proxies /api/ to
# occulited. HMM_OCCULITE_URL (the backend's option of the same name) replaces the base for the
# tests, which run the CGI against a stub box; lighttpd's CGI environment never carries it on a
# box, and a client cannot set it (mod_cgi puts HTTP_ in front of every request header).
proc occulite_state_url {} {
    global env
    set base http://127.0.0.1
    if {[info exists env(HMM_OCCULITE_URL)]} {
        set base $env(HMM_OCCULITE_URL)
    }
    regsub {/$} $base "" base
    return $base/api/auth/v1/state
}

# The box's answer about one session id (the body of a 200), "" when it cannot be asked: no http
# package, a refused connection, a timeout, any other status. `id` has been validated by the caller;
# nothing else goes into the request.
proc occulite_state {id} {
    if {[catch {package require http}]} {
        return ""
    }
    if {[catch {http::geturl [occulite_state_url] -headers [list Authorization "Bearer $id"] -timeout 5000} token]} {
        return ""
    }
    set body ""
    if {[string equal [http::status $token] "ok"] && [regexp {^HTTP/[0-9.]+ 200( |$)} [http::code $token]]} {
        set body [http::data $token]
    }
    http::cleanup $token
    return $body
}

# The box's word on `id`: "" when it does not confirm it as one of its live sessions, otherwise
# the role the box names for that session - "admin" or "user" - or "-" when the answer names none.
# Only what can be an openccu-lite session id on some image is asked about - the frontend's rule
# (apps/web/src/occulite.ts, B-36): 26 characters of base32 (A-Z, 2-7), what occulited hands out
# since their task 125, or ten alphanumerics, the ids of images from before (the shape of today's
# legacy alias). Anything else - empty, @-wrapped, a line break, a space, a colon, a list of
# several, an API token (olt_ and hex), another length - is refused without asking, so nothing but
# letters and digits of one of the two shapes ever goes into the Authorization header. The shape
# only ever refuses: an id of the right shape is a session only when the box says so.
proc occulite_session_role {id} {
    if {![regexp {^[A-Z2-7]{26}$} $id] && ![regexp {^[A-Za-z0-9]{10}$} $id]} {
        return ""
    }
    set state [occulite_state $id]
    # JSON escapes every quote inside a string, so a user name cannot fake a key; and "legacy_sid"
    # does not match the "sid" pattern, because the quote before the s is what the pattern asks for
    if {![regexp {"authenticated"\s*:\s*true} $state]} {
        return ""
    }
    if {![regexp {"sid"\s*:\s*"([A-Za-z0-9]+)"} $state all stateSid] || ![string equal $stateSid $id]} {
        return ""
    }
    # B-37: the role occulited writes for an account's session (httpapi/auth.go, `state`). A value
    # with an escape in it, or none at all, is no role anybody is let in by: "-"
    if {[regexp {"role"\s*:\s*"([A-Za-z]+)"} $state all role]} {
        return $role
    }
    return "-"
}

# 1 when the box confirms `id` as one of its live sessions, whatever its role.
proc check_occulite_session {id} {
    if {[string equal [occulite_session_role $id] ""]} {
        return 0
    }
    return 1
}

# B-37: the session id a ?sid= carries - the CCU's @...@ taken off - for the box to be asked about
# on openccu-lite. What it is not able to be is refused by occulite_session_role's shape check.
proc sid_param_id {sid} {
    if {[regexp {^@(.*)@$} $sid all inner]} {
        return $inner
    }
    return $sid
}

# 1 when this request comes with a live session: the session header where openccu-lite sends one
# and the box confirms it, otherwise ?sid=@...@ through ReGa as always. The header comes first
# because on openccu-lite since their task 125 what a shell still puts into ?sid= is only the
# session's legacy alias (answered by the tclrega shim, refused by the API), while the header
# carries the session itself.
proc check_request_session {sid} {
    set id [session_header]
    if {![string equal $id ""] && [check_occulite_session $id]} {
        return 1
    }
    return [check_session $sid]
}

# Percent-decoding, written out rather than the usual `regsub`+`subst` one-liner: that idiom runs
# command substitution over its input, so a query string containing [...] would be executed.
proc url_decode {value} {
    set out ""
    set length [string length $value]
    for {set i 0} {$i < $length} {incr i} {
        set char [string index $value $i]
        if {[string equal $char "+"]} {
            append out " "
        } elseif {[string equal $char "%"] && $i + 2 < $length} {
            set hex [string range $value [expr {$i + 1}] [expr {$i + 2}]]
            if {[regexp {^[0-9a-fA-F][0-9a-fA-F]$} $hex]} {
                # scan needs a variable here: returning the value directly is Tcl 8.4 and up
                scan $hex %x code
                append out [format %c $code]
                incr i 2
            } else {
                append out $char
            }
        } else {
            append out $char
        }
    }
    # the bytes just decoded are utf-8; without this an umlaut arrives as two characters
    return [encoding convertfrom utf-8 $out]
}

# B-41: true for a POST. The settings page and service.cgi change state only on a POST; a GET only
# shows, so a link or a redirect from a foreign site that carries the box's cookie changes nothing.
proc request_is_post {} {
    if {[catch {set method $::env(REQUEST_METHOD)}]} {
        return 0
    }
    return [string equal [string toupper $method] "POST"]
}

# B-41: the fields of a POSTed form (application/x-www-form-urlencoded) as a name/value list,
# decoded like the query. Empty for anything but a POST, and for a body over 64 KiB.
proc post_params {} {
    set params [list]
    if {![request_is_post]} {
        return $params
    }
    set length 0
    catch {set length $::env(CONTENT_LENGTH)}
    if {![regexp {^[0-9]+$} $length] || $length == 0 || $length > 65536} {
        return $params
    }
    fconfigure stdin -translation binary
    set body [read stdin $length]
    foreach pair [split $body &] {
        if {[regexp {^([^=]*)=(.*)$} $pair dummy name value]} {
            lappend params [url_decode $name] [url_decode $value]
        }
    }
    return $params
}

# Query parameters as a name/value list, decoded: `array set params [query_params]`. The WebUI
# percent-encodes the `@` of a session id when it builds the settings URL, so a CGI that skips
# decoding sees no valid session at all.
proc query_params {} {
    set params [list]
    if {[catch {set query $::env(QUERY_STRING)}]} {
        return $params
    }
    foreach pair [split $query &] {
        if {[regexp {^([^=]*)=(.*)$} $pair dummy name value]} {
            lappend params [url_decode $name] [url_decode $value]
        }
    }
    return $params
}
