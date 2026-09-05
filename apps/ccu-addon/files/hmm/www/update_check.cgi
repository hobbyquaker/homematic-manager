#!/bin/tclsh
#
# The version line of the addon on the Zusatzsoftware page: prints the newest release tag from
# GitHub, or "n/a" when the CCU has no internet. ?cmd=download redirects to the release page.
#
# The WebUI writes the response text into the cell as it is and compares strings, so this prints the
# bare version and nothing else.

source [file join [file dirname [info script]] lib session.tcl]

set checkURL "https://api.github.com/repos/hobbyquaker/homematic-manager/releases/latest"
set downloadURL "https://github.com/hobbyquaker/homematic-manager/releases/latest"

# No session gate on purpose: the WebUI's version line asks before any login-bound page exists, and
# nothing here reads or changes state.
array set params [query_params]
set cmd ""
if {[info exists params(cmd)]} {
    set cmd $params(cmd)
}

if {[string equal $cmd "download"]} {
    puts "Content-Type: text/html; charset=utf-8\r\n"
    puts "<html><head><meta http-equiv='refresh' content='0; url=$downloadURL' /></head></html>"
} else {
    puts "Content-Type: text/plain; charset=utf-8\r\n"
    catch {
        regexp {"tag_name":[ ]*"v?([0-9]+\.[0-9]+\.[0-9]+[^"]*)"} \
            [exec /usr/bin/env wget -qO- --no-check-certificate $checkURL] dummy newversion
    }
    if {[info exists newversion]} {
        puts -nonewline $newversion
    } else {
        puts -nonewline "n/a"
    }
}
