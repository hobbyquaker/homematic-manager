# Lab scripts

Scripts that talk to real hardware. **None of them runs in CI**, none of them is part of `npm test`,
and none of them is on any workflow's path - they need a CCU, an ssh key and a person watching.

**No address, alias, password or key belongs in this directory, ever** (AGENTS.md). Every script
reads its target from the command line or from the environment, and the values live in the
maintainer's private lab note. Refer to "the lab", never to a host. A script that grows a default
host has a bug.

## What is here

| Script | What it does |
| --- | --- |
| [`config-pending-study.mjs`](config-pending-study.mjs) | The write-safety study of roadmap task 6, repeatable. Provokes bad `putParamset` calls on **one** named device, records what the interface process answers, whether `CONFIG_PENDING` appears and which recovery clears it. The measurement behind [`docs/config-pending.md`](../../docs/config-pending.md) and D-28. |
| [`addon-check.sh`](addon-check.sh) | The post-install checklist for the CCU addon (task 13), per box: is it installed, is the process up, does monit watch it, does lighttpd proxy it, does the CGI answer, and what does the log say. |

## Running them

Both are run from WSL (or any Linux shell) against a box you are looking at:

```sh
# the write-path study - one device at a time, baseline first, restore last
node tools/lab/config-pending-study.mjs --host "$CCU" --interface HmIP-RF \
    --device ABC0000001 --channel 1 --out ~/lab-results/hmm-task6 --ssh "$CCU_SSH" baseline

# the addon checklist - everything comes from the environment
HMM_LAB_SSH="$CCU_SSH" HMM_LAB_URL="https://$CCU" HMM_LAB_USER="$CCU_USER" \
    sh tools/lab/addon-check.sh
```

`config-pending-study.mjs` has safety rails that are not optional: `baseline` must run first
(the dump is what `restore` writes back), only the `--device` given is ever written to, the central
`HM-RCV-50` / `HmIP-RCV-50` channels are refused outright, and `--dry-run` prints every call and
makes none. Read its header before pointing it at anything.

## Why they are outside CI

A CI runner has no CCU, and a lab CCU is a device in someone's flat that heats a room and switches
a light. Task 6 measured what happens when a write goes wrong, and the answer was
`CONFIG_PENDING` on real hardware - not something to reproduce on every push. The simulator carries
those measurements instead (`hm-simulator`'s `configPendingMode`, D-28), and the e2e suite in
`apps/web/test/e2e` runs against that.

What the simulator cannot answer is what a *new* firmware does. When that question comes up, these
scripts are how it gets answered, and the result goes into `docs/` as a measurement with a date and
a firmware version - never as a script that assumes it.

## Adding one

- Read the target from `argv` or the environment. No defaults that resolve to a real host.
- Say in the header what it writes and what it only reads. A script that writes gets a `--dry-run`.
- Print what it did, so the output can be pasted into an issue with the addresses redacted.
- Keep it out of `package.json`'s `scripts`: these are run by hand, on purpose.
