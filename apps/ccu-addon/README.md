# @homematic-manager/ccu-addon

Placeholder for the CCU3 / OpenCCU addon package. Empty on purpose: everything it needs is
[task 13 of the roadmap](../../ROADMAP.md#13-ccu-addon) — one `.tar.gz` per architecture
(armv7l, aarch64, x86_64) with a bundled musl Node, `rc.d/hmm`, monit config, the tclsh CGIs with
the WebUI session check, the lighttpd proxy rule to the backend and `update_script`.

Task 13 depends on [task 12](../../ROADMAP.md#12-web-host-for-development-and-e2e): the addon runs
the same backend and the same built UI as `apps/web`, only in local mode on the CCU.
