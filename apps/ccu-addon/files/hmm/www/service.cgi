#!/bin/tclsh
#
# Service control and status for the WebUI and for a support session:
# ?cmd=start|stop|restart|status returns JSON, ?cmd=log returns the tail of the log as plain text.
# Everything goes through /usr/local/etc/config/rc.d/hmm, so there is exactly one place that knows
# how the backend is started.

source [file join [file dirname [info script]] lib common.tcl]

array set params [require_session]

set cmd "status"
if {[info exists params(cmd)]} {
    set cmd $params(cmd)
}

proc pid_of {} {
    global PID_FILE
    if {![file exists $PID_FILE]} {
        return ""
    }
    set fd [open $PID_FILE r]
    set pid [string trim [read $fd]]
    close $fd
    if {[string equal $pid ""] || [catch {exec kill -0 $pid}]} {
        return ""
    }
    return $pid
}

# Resident memory in kB, from /proc: the CCU's busybox ps has no -p, so `ps -o rss= -p <pid>` fails.
proc rss_kb {pid} {
    if {[catch {set fd [open /proc/$pid/status r]}]} {
        return 0
    }
    set data [read $fd]
    close $fd
    if {[regexp {VmRSS:[ \t]+([0-9]+)} $data dummy kb]} {
        return $kb
    }
    return 0
}

# Seconds since the process started: /proc/uptime minus its own start time, field 22 of
# /proc/<pid>/stat counted from after the comm field (which may contain spaces and brackets).
# USER_HZ is 100 on every CCU kernel.
proc uptime_seconds {pid} {
    if {[catch {set fd [open /proc/$pid/stat r]}]} {
        return ""
    }
    set stat [read $fd]
    close $fd
    set tail [string range $stat [expr {[string last ")" $stat] + 2}] end]
    set starttime [lindex [split [string trim $tail] " "] 19]
    if {![regexp {^[0-9]+$} $starttime]} {
        return ""
    }
    if {[catch {set fd [open /proc/uptime r]}]} {
        return ""
    }
    set uptime [lindex [split [read $fd]] 0]
    close $fd
    return [expr {int($uptime - ($starttime / 100.0))}]
}

proc format_uptime {seconds} {
    if {[string equal $seconds ""]} {
        return ""
    }
    if {$seconds < 0} {
        return ""
    }
    set days [expr {$seconds / 86400}]
    set hours [expr {($seconds % 86400) / 3600}]
    set minutes [expr {($seconds % 3600) / 60}]
    if {$days > 0} {
        return "${days}d ${hours}h"
    }
    if {$hours > 0} {
        return "${hours}h ${minutes}m"
    }
    if {$minutes > 0} {
        return "${minutes}m [expr {$seconds % 60}]s"
    }
    return "${seconds}s"
}

switch -- $cmd {
    start -
    stop -
    restart {
        json_header
        catch {exec $RC_SCRIPT $cmd} output
        set pid [pid_of]
        set running [expr {[string equal $pid ""] ? "false" : "true"}]
        puts "{\"ok\":true,\"cmd\":[json_string $cmd],\"output\":[json_string $output],\"running\":$running}"
    }
    status {
        json_header
        set pid [pid_of]
        set rss 0
        set elapsed ""
        if {![string equal $pid ""]} {
            set rss [rss_kb $pid]
            set elapsed [format_uptime [uptime_seconds $pid]]
        }
        set parts [list]
        lappend parts "\"running\":[expr {[string equal $pid ""] ? "false" : "true"}]"
        lappend parts "\"pid\":[json_string $pid]"
        lappend parts "\"rss\":[json_string $rss]"
        lappend parts "\"uptime\":[json_string $elapsed]"
        lappend parts "\"port\":[json_string [read_port]]"
        lappend parts "\"url\":[json_string $BASE_PATH/]"
        foreach {key value} [read_versions] {
            lappend parts "[json_string $key]:[json_string $value]"
        }
        puts "\{[join $parts ,]\}"
    }
    log {
        set lines 200
        if {[info exists params(lines)] && [regexp {^[0-9]+$} $params(lines)]} {
            set lines $params(lines)
            if {$lines > 2000} {
                set lines 2000
            }
        }
        puts "Content-Type: text/plain; charset=utf-8\r\n"
        if {[file exists $LOG_FILE]} {
            catch {exec tail -n $lines $LOG_FILE} output
            puts $output
        } else {
            puts "(kein Log vorhanden - der Dienst lief noch nicht / no log yet)"
        }
    }
    default {
        json_header
        puts "{\"error\":\"unknown command\"}"
        exit 1
    }
}
