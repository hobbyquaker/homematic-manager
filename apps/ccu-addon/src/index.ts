/**
 * The addon itself is not TypeScript: it is POSIX sh, Tcl 8.2 and two bash build scripts, because
 * that is what a CCU runs (see `README.md` and `build.sh`). The Node code the addon executes is the
 * web host of `apps/web`, installed from its own npm tarball.
 *
 * This module exists so the package stays part of the workspace, the build graph and the test run.
 */
export const PACKAGE = '@homematic-manager/ccu-addon';
