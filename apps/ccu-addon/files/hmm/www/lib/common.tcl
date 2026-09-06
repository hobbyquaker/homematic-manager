#!/bin/tclsh
#
# Shared bits for the addon's CGIs: paths, the session gate, the token and minimal JSON output.
# Tcl 8.2, see lib/session.tcl.

source [file join [file dirname [info script]] session.tcl]

# Where the addon lives. Deliberately not derived from [info script]: the WebUI reaches these CGIs
# through /usr/local/etc/config/addons/www/hmm, a symlink to this directory, so a relative walk
# up would land in the symlink's parent, somewhere else entirely. `file normalize` used to hide
# that and needs Tcl 8.4 - the CCU3 has 8.2.3. A CCU addon's install path is fixed by the
# installer, so it is simply known. HMM_ADDON_DIR lets the tests run the CGIs from a copy.
set ADDON_DIR /usr/local/addons/hmm
if {[info exists env(HMM_ADDON_DIR)]} {
    set ADDON_DIR $env(HMM_ADDON_DIR)
}

# The profile directory, outside the addon tree: config.json, the caches and the token survive
# an update (which replaces $ADDON_DIR wholesale) and an uninstall.
set STATE_DIR /usr/local/hmm
if {[info exists env(HMM_STATE_DIR)]} {
    set STATE_DIR $env(HMM_STATE_DIR)
}

set BASE_PATH /addons/hmm
set TOKEN_FILE $STATE_DIR/token
set LOG_FILE $ADDON_DIR/var/hmm.log
# in the addon tree, not /var/run - the CCU3 install chroot has no /var/run, see rc.d/hmm
set PID_FILE $ADDON_DIR/var/hmm.pid
set RC_SCRIPT /usr/local/etc/config/rc.d/hmm

# the test harness runs the CGIs from a copy of the tree and points these elsewhere
if {[info exists env(HMM_PID_FILE)]} {
    set PID_FILE $env(HMM_PID_FILE)
}
if {[info exists env(HMM_RC_SCRIPT)]} {
    set RC_SCRIPT $env(HMM_RC_SCRIPT)
}

proc json_header {} {
    puts "Content-Type: application/json; charset=utf-8\r\n"
}

proc html_header {} {
    puts "Content-Type: text/html; charset=utf-8\r\n"
}

# The versions file (VERSION_ADDON, NODE_VERSION, NODE_ARCH, ...) as a name/value list - one parser
# for the file build.sh writes and the rc.d script sources.
proc read_versions {} {
    global ADDON_DIR
    set result [list]
    if {![file exists $ADDON_DIR/versions]} {
        return $result
    }
    set fd [open $ADDON_DIR/versions r]
    set content [read $fd]
    close $fd
    foreach line [split $content "\n"] {
        if {[regexp {^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$} [string trim $line] dummy key value]} {
            lappend result $key $value
        }
    }
    return $result
}

# HMM_PORT from etc/hmm.env - only so the settings page can say where the backend is; the proxy
# rule and the rc.d script read the same file.
proc read_port {} {
    global ADDON_DIR
    set port 8090
    if {![file exists $ADDON_DIR/etc/hmm.env]} {
        return $port
    }
    set fd [open $ADDON_DIR/etc/hmm.env r]
    set content [read $fd]
    close $fd
    foreach line [split $content "\n"] {
        if {[regexp {^HMM_PORT=([0-9]+)} [string trim $line] dummy value]} {
            set port $value
        }
    }
    return $port
}

# One value out of etc/hmm.env, or the default when the file has none. The same file the rc.d
# script sources, so what is read here is what the host process will be started with.
proc read_env {name default} {
    global ADDON_DIR
    set value $default
    if {![file exists $ADDON_DIR/etc/hmm.env]} {
        return $value
    }
    set fd [open $ADDON_DIR/etc/hmm.env r]
    set content [read $fd]
    close $fd
    foreach line [split $content "\n"] {
        if {[regexp "^$name=(.*)\$" [string trim $line] dummy found]} {
            set value [string trim [string trim $found] "\""]
        }
    }
    return $value
}

# Writes one value into etc/hmm.env: replaces the line that sets it - commented out or not - and
# appends it when there is none. Everything else in the file is kept byte for byte, because a user
# may have put their own HMM_* lines there and an update never overwrites the file either.
proc write_env {name value} {
    global ADDON_DIR
    set file $ADDON_DIR/etc/hmm.env
    set lines [list]
    set replaced 0
    if {[file exists $file]} {
        set fd [open $file r]
        set content [read $fd]
        close $fd
        foreach line [split $content "\n"] {
            if {[regexp "^ *#? *$name=" $line]} {
                if {$replaced == 0} {
                    lappend lines "$name=$value"
                    set replaced 1
                }
            } else {
                lappend lines $line
            }
        }
    }
    if {$replaced == 0} {
        lappend lines "$name=$value"
        lappend lines ""
    }
    set fd [open $file w]
    puts -nonewline $fd [join $lines "\n"]
    close $fd
}

# The token the backend expects on its API socket. Written by update_script (and by the rc.d script
# when it is missing) with mode 600 into the profile directory, so it is readable by root only -
# which is what a CGI is.
proc read_token {} {
    global TOKEN_FILE
    if {![file exists $TOKEN_FILE]} {
        return ""
    }
    set fd [open $TOKEN_FILE r]
    set token [string trim [read $fd]]
    close $fd
    return $token
}

# Is this request coming in over https? lighttpd sets HTTPS=on for its TLS socket; without it the
# Secure attribute would make the browser drop the cookie on a plain http WebUI.
proc request_is_https {} {
    global env
    if {[info exists env(HTTPS)] && [string equal -nocase $env(HTTPS) "on"]} {
        return 1
    }
    if {[info exists env(SERVER_PORT)] && [string equal $env(SERVER_PORT) "443"]} {
        return 1
    }
    return 0
}

# Does the browser hold the addon's own token cookie?
#
# The cookie is only ever handed out by settings.cgi after a session check, so holding it is a
# second proof of the same thing. It is what makes the settings page reachable from a plain link
# that carries no `sid` - the entry in Systemsteuerung, or a bookmark - for a browser that has the
# app open. Everything the page then offers is a WebUI operation anyway.
proc has_token_cookie {} {
    global env
    set token [read_token]
    if {[string equal $token ""]} {
        return 0
    }
    if {![info exists env(HTTP_COOKIE)]} {
        return 0
    }
    foreach part [split $env(HTTP_COOKIE) ";"] {
        set part [string trim $part]
        set index [string first "=" $part]
        if {$index < 0} {
            continue
        }
        if {[string equal [string range $part 0 [expr {$index - 1}]] "hmm_token"]} {
            if {[string equal [string range $part [expr {$index + 1}] end] $token]} {
                return 1
            }
        }
    }
    return 0
}

# D-40: is this firmware openccu-lite?
#
# `/VERSION` keeps upstream's PRODUCT and PLATFORM and carries an extra `VARIANT=lite` line (their
# D-17), so that update packages stay interchangeable in both directions and the variant is still
# recognisable. That extra line is the only thing to look at - and it is read at *runtime*, never
# written into a configuration file, because a user may move the same `/usr/local` from openccu-lite
# to OpenCCU and back, and an addon that remembered the answer would then be wrong.
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

# HTML-escapes a value that goes into a page. Nothing here is user input today, but the settings
# page prints what is in etc/hmm.env, and that file is edited by hand.
proc html_escape {value} {
    regsub -all {&} $value {\&amp;} value
    regsub -all {<} $value {\&lt;} value
    regsub -all {>} $value {\&gt;} value
    regsub -all {"} $value {\&quot;} value
    return $value
}

# Answers with a JSON error and exits unless the request carries a valid WebUI session. Returns the
# query parameters as a name/value list.
proc require_session {} {
    set params [query_params]
    array set query $params
    set sid ""
    if {[info exists query(sid)]} {
        set sid $query(sid)
    }
    if {![check_session $sid]} {
        json_header
        puts "{\"error\":\"invalid session\"}"
        exit 1
    }
    return $params
}

proc json_string {value} {
    set out ""
    foreach char [split $value ""] {
        scan $char %c code
        switch -- $char {
            "\"" {append out {\"}}
            "\\" {append out {\\}}
            "\n" {append out {\n}}
            "\r" {append out {\r}}
            "\t" {append out {\t}}
            default {
                if {$code < 32} {
                    append out [format {\u%04x} $code]
                } else {
                    append out $char
                }
            }
        }
    }
    return "\"$out\""
}
