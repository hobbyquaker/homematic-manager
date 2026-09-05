#!/bin/tclsh
#
# Runs one CGI outside a CCU: tclrega.so does not exist here, so `load` is neutralised and
# rega_script answers the way ReGa would. HMM_TEST_SESSION=invalid makes it answer the way ReGa does
# for an expired session, which is how the session check itself gets tested.

rename load __load_orig
proc load {args} {}

proc rega_script {script} {
    if {[info exists ::env(HMM_TEST_SESSION)] && [string equal $::env(HMM_TEST_SESSION) "invalid"]} {
        return [list "" ""]
    }
    return [list "" "Admin"]
}

source [lindex $argv 0]
