/*
 * A stand-in for the CCU's tclrega.so, for the container test.
 *
 * The real one talks to ReGaHSS; the addon's only use of it is the session check
 * `Write(system.GetSessionVarStr('<sid>'))`, whose second result element is the logged-in user name
 * for a live session and the empty string for an expired one. This reproduces exactly that: the
 * session id is taken out of the script text and looked up in /tmp/valid-sids (one id per line), so
 * a test can make a session live or expired by writing that file.
 *
 * Built into the test image by test/Dockerfile. Nothing of this ships in the addon.
 */

#include <stdio.h>
#include <string.h>
#include <tcl.h>

#define MARKER "GetSessionVarStr('"
#define SID_FILE "/tmp/valid-sids"

static int session_is_valid(const char *sid) {
    char line[128];
    FILE *file;
    int found = 0;

    if (sid[0] == '\0') {
        return 0;
    }
    file = fopen(SID_FILE, "r");
    if (file == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        char *newline = strchr(line, '\n');
        if (newline != NULL) {
            *newline = '\0';
        }
        if (strcmp(line, sid) == 0) {
            found = 1;
            break;
        }
    }
    fclose(file);
    return found;
}

static int rega_script_cmd(ClientData data, Tcl_Interp *interp, int argc, const char *argv[]) {
    const char *script = argc > 1 ? argv[1] : "";
    const char *start = strstr(script, MARKER);
    char sid[64];
    Tcl_Obj *result;

    (void)data;
    sid[0] = '\0';
    if (start != NULL) {
        const char *end;
        start += strlen(MARKER);
        end = strchr(start, '\'');
        if (end != NULL && (size_t)(end - start) < sizeof(sid)) {
            memcpy(sid, start, (size_t)(end - start));
            sid[end - start] = '\0';
        }
    }

    result = Tcl_NewListObj(0, NULL);
    /* the real rega_script returns {<stdout> <result>} */
    Tcl_ListObjAppendElement(interp, result, Tcl_NewStringObj("", -1));
    Tcl_ListObjAppendElement(interp, result, Tcl_NewStringObj(session_is_valid(sid) ? "Admin" : "", -1));
    Tcl_SetObjResult(interp, result);
    return TCL_OK;
}

/* `load tclrega.so` derives this name from the file name. */
int Tclrega_Init(Tcl_Interp *interp) {
    Tcl_CreateCommand(interp, "rega_script", rega_script_cmd, NULL, NULL);
    return TCL_OK;
}
