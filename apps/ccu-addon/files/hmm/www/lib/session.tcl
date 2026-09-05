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
# follows ccu-addon-howto/templates/lib/session.tcl.

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
