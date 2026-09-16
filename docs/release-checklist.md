# Release checklist

How a release is cut. Two lists: a **beta** (`3.0.0-beta.n`) and the **3.0.0** release. The
maintainer runs it, or an agent does on his **explicit word for that release** (D-37; beta.18 went out
that way): then the agent runs the gate, the bump, the push of `master`, the tag, the watch of the four
release workflows and the checks of the draft, publishes only when the maintainer said so, and answers
the issues the release contains. Without that word an agent never bumps, tags, pushes `master`,
publishes or runs a release workflow.

The work happens on `master` (D-38). When the maintainer names an integration branch for a batch
(beta.18: `beta18`), that branch is the one gated and bumped, and `master` is fast-forwarded to it;
otherwise it is `master` itself. Either way `master` is never rebased or squashed. Commands are meant
to be pasted into a shell in the repository root, on that branch. `gh` pushes and tags as the
repository owner (`hobbyquaker`); issue replies go out as `hobbyquaker-agent`.

Contents: [Before the first release ever](#before-the-first-release-ever) ·
[Beta](#beta-300-beta-n) · [3.0.0](#300) · [Verifying the assets](#verifying-the-assets-d-27) ·
[Re-running one workflow alone](#re-running-one-workflow-alone) ·
[Issues to close](#issues-to-close) · [If something goes wrong](#if-something-goes-wrong)

---

## Before the first release ever

These are one-time, and nothing below works until they are done.

- [x] **Done: GitHub Actions are enabled** on `hobbyquaker/homematic-manager` (Settings → Actions →
      General → "Allow all actions"; only the owner can set it).
- [x] **Done: workflows may write releases**: Settings → Actions → General → Workflow permissions →
      "Read and write permissions" (the four release workflows need `contents: write`;
      `id-token: write` and `attestations: write` are requested per workflow and need no setting).
- [x] **Done (D-33): the npm package is `homematic-manager`**, the 2.x name, and it is in
      `apps/web/package.json`. Its 1.x versions stay deprecated on npm, which does not block a new
      version. Note for the announcement: `npm install -g homematic-manager` gives the **deprecated
      1.0.14 from 2022** until 3.0.0 moves `latest`, so every pre-release instruction has to say
      `npm install -g homematic-manager@next`.
- [x] **Done: npm trusted publishing is configured** for `homematic-manager` on npmjs.com:
      repository `hobbyquaker/homematic-manager`, workflow **`release-npm.yml`**. The publisher
      names the workflow *file*, so that file cannot be renamed without updating the publisher on
      npmjs.com first. A publish step failing with `ENEEDAUTH` means the two no longer match — which
      is the intended failure, not a reason to add a token secret.
- [x] **Done (D-41, 2026-09-09): OQ-15 is decided**, the image keeps `HMM_ISSUE_COOKIE=true` and the
      host warns at start when it issues the cookie on a non-loopback bind.
- [ ] Optional, both still missing: Apple notarisation secrets (`APPLE_ID`, `APPLE_TEAM_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`) and
      SignPath for Windows (the step is in `release-electron.yml`, commented out). Without them
      macOS ships unnotarised and Windows unsigned; that is a documented state, not a blocker. It is
      why the desktop app on macOS and Windows only opens the new installer in the browser instead of
      updating itself (task 53); the AppImage updates itself.

---

## Beta (`3.0.0-beta.n`)

### 1. The gate

On the branch that is released (see the top), with nothing uncommitted:

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:e2e:electron                          # with ELECTRON_RUN_AS_NODE unset
npm run lint:sh                                    # with shellcheck present, see below
apps/ccu-addon/build.sh x86_64                     # the container test installs the newest package in out/
apps/ccu-addon/build.sh aarch64
npm run test:cgi --workspace apps/ccu-addon
npm run test:package --workspace apps/ccu-addon
apps/ccu-addon/test/container-test.sh --idle      # needs docker
scripts/docker-callback-test.sh                    # needs docker and the image, see the script
```

- [ ] Every step exits 0. `npm test` needs hm-simulator, which is a devDependency since 1.0.0 — a
      skipped e2e suite is not a pass. Write the counts down (beta.18: unit 2922 passed / 11 skipped,
      web e2e 64/1, Electron e2e 9, cgi 301, package 37, container 251, Docker callback 10/10); the
      release notes and the issue replies refer to them.
- [ ] **Build the x86_64 package before the container test.** The test takes the newest
      `hmm-ccu-x86_64-*.tar.gz` in `apps/ccu-addon/out/`, and a stale one from an earlier build tests
      yesterday's addon (beta.13's gate first ran against a beta.9 package and failed only the new
      check).
- [ ] **shellcheck has to run.** Without it `lint:sh` only checks the syntax and says so in one line
      (beta.8's CI failed on an `echo -n` the local lint never saw). Where it is not installed, run it
      through docker over the files `scripts/lint-sh.sh` selects — its shebang rule, not a hand-made
      list (`bin/update_addon` is tclsh and makes shellcheck exit 123):
      `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable -x -S warning <files>`.
- [ ] **A red e2e spec is rerun alone and in the full run** before it is called a regression: beta.8
      (a fixture leak between tests), beta.9 (a seeded count) and beta.18 (`rename.spec.ts`, F2 right
      after Escape) were spec races, not defects.
- [ ] **The lab before the release:** the addon package of this build on the lab boxes that are free,
      for what the release's items name as lab checks, and `docs/hardware-checklist.md` against the
      current build. The production CCU is never touched. What each item's check found goes into the
      item, not into this repository.
- [ ] `CHANGELOG.md`: the `## [Unreleased]` section says what is being released, every bullet of a
      reported bug or a requested feature ends with `(#<issue>, @<handle>)` (step 4), and "Known issues"
      matches what is actually broken today.

### 2. The bump

D-18/D-35: the counter moves with a script, never by hand, and the same version is written into every
workspace package. The bump is **its own commit** on the branch that was gated, named after the
version:

```sh
npm run version:dev            # on a beta: 3.0.0-beta.n -> 3.0.0-beta.n+1
```

For a step to another preid, or to the release, the script takes the version as its argument and
carries the new preid from then on:

```sh
node scripts/version-dev.mjs 3.0.0-beta.0    # sets it everywhere and refreshes package-lock.json
```

In the same commit, `CHANGELOG.md`: `## [Unreleased]` becomes `## [3.0.0-beta.n] — <date>`, and the
link definition `[3.0.0-beta.n]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.n`
is added at the bottom (beta.18: `e75827d`).

- [ ] `npm ci` still works afterwards (the workspace ranges are exact and move with the version;
      a stale `package-lock.json` is what breaks it).
- [ ] `npm run lint` and `npm run typecheck` again, and the unit and e2e suites on the bump (beta.18's
      re-gate is where the flaky rename spec showed).
- [ ] Commit only what the bump and the changelog changed (`git status`: `CHANGELOG.md`,
      `package-lock.json` and the `package.json` files), with the version as the message:
      `git commit -m '3.0.0-beta.n' -- <those files>`.

### 3. Push, then the tag

```sh
git checkout master && git merge --ff-only <the gated branch>   # only when it is not master itself
git push origin master
gh run list --branch master --limit 5
gh run watch <run-id>                       # ci.yml, build.yml, addon.yml green first
git tag -a v3.0.0-beta.n -m 'Homematic Manager 3.0.0-beta.n'
git push origin v3.0.0-beta.n
```

- [ ] The push runs of `ci.yml`, `build.yml` and `addon.yml` are green **before** the tag. `build.yml`
      and `release-electron.yml` both run `npm run check:update-names` right after packaging (B-47,
      B-49): every `url` and `path` in the `latest*.yml` files has to be a file with a GitHub-safe
      name, and every packaged `app-update.yml` has to name the updater folder
      `homematic-manager-updater`. It must pass on all three runners (macOS, Windows, Linux); a failure
      with "no packaged app-update.yml" points at `findAppUpdateFiles` in
      `apps/electron/scripts/update-names.mjs`.

The tag is what starts the four release workflows. They run **in parallel and independently**
(D-24): a failed addon build does not hold back the Electron, npm and Docker releases of the same
tag, and vice versa.

| Workflow | Produces |
| --- | --- |
| `release-electron.yml` | `.exe` + `.blockmap` + `latest.yml` (Windows), `.dmg` + `.zip` + `.blockmap` + `latest-mac.yml` (macOS), `.AppImage` + `.deb` + `latest-linux*.yml` (Linux), one `.cdx.json` per installer |
| `release-npm.yml` | the `apps/web` tarball on npm, plus tarball and `.cdx.json` on the release |
| `release-addon.yml` | `hmm-ccu-{armv7l,aarch64,x86_64}-<version>.tar.gz` with `.sha256` and `.cdx.json` |
| `release-docker.yml` | the multi-arch image on ghcr.io plus `homematic-manager-docker-<version>.cdx.json` |

Whichever gets there first creates **one** GitHub release as a **draft**; the others add their
assets to it. Nothing is public until the draft is published.

The draft's **title and body are generated** (`scripts/release-notes.mjs`, run by each of the four
workflows, so they are the same whichever creates the draft): the title is the version without the
`v` (`3.0.0-beta.5` for the tag `v3.0.0-beta.5`), the body is the 3.0 hint paragraph (German and
English), the `CHANGELOG.md` section of the version (between `## [<version>]` and the next
`## [`, links pointed at the tag) and GitHub's generated notes below it. Nothing to add by hand for
those; a version without a changelog section gets a body that says so and a warning in the run.

```sh
gh run list --limit 8
gh run watch <run-id>
```

- [ ] All four release runs (and the tag's CI run) are green. A red one is re-run alone (see
      [Re-running one workflow alone](#re-running-one-workflow-alone)); never re-tag.
- [ ] **npm dist-tags.** D-39: `release-npm.yml` publishes every version - a beta as well - as
      `latest`, because the 1.x versions under the name are dead, and then tries to add the `next`
      alias. That second step fails with E401 under the trusted-publishing token (beta.4, beta.6)
      and only warns. Check `npm view homematic-manager dist-tags`: `latest` is the version just
      published (the registry needs a few minutes before `npm view <name>@<version>` answers).
      Moving `next` (`npm dist-tag add homematic-manager@<version> next`) is the maintainer's; an
      agent leaves it where it is (after beta.18 it was still on beta.2).

### 4. Check the draft, then publish

```sh
gh release view v3.0.0-beta.n --json isDraft,name,assets --jq '.isDraft, .name, (.assets | length), .assets[].name'
```

- [ ] One draft, titled with the version, with every asset of the table above (beta.18: 40), and each
      installer/package with its `.cdx.json` (D-27: a release with a missing SBOM is not published).
- [ ] The checksums and attestations verify — see [Verifying the assets](#verifying-the-assets-d-27)
      (beta.18: `.sha256` OK, 14 attestations, the ghcr image for three platforms with its CycloneDX
      predicate), and `npm view homematic-manager@<version>` shows the provenance.
- [ ] **Every name the updater asks for is on the draft (B-47).** electron-updater downloads
      `releases/download/<tag>/<url>` for each `url`/`path` in the `latest*.yml` files, plus
      `<url>.blockmap` for the zip and the Setup exe. A draft's files are not served under that URL
      until it is published, so on the draft check the names against its assets:

      ```sh
      tag=v3.0.0-beta.n; mkdir -p /tmp/rel-yml && cd /tmp/rel-yml
      gh release download "$tag" --repo hobbyquaker/homematic-manager --pattern 'latest*.yml' --clobber
      gh release view "$tag" --repo hobbyquaker/homematic-manager --json assets --jq '.assets[].name' > assets.txt
      for n in $(sed -nE "s/^ *-? *(url|path): *['\"]?([^'\"]*)['\"]?$/\2/p" latest*.yml | sort -u); do
          for f in "$n" $(case "$n" in *.zip|*.exe) echo "$n.blockmap" ;; esac); do
              grep -qxF "$f" assets.txt && echo "ok $f" || echo "MISSING: $f"
          done
      done
      ```

- [ ] **The installers of the link mode are on the draft (task 53).** On macOS and Windows and for
      a deb install, the app's "Download" opens one of these files of the new release, and falls back
      to the release page when it is missing: `Homematic-Manager-<version>-universal.dmg`,
      `Homematic-Manager-Setup-<version>.exe`, `Homematic-Manager-<version>-portable.exe`,
      `…-portable-x64.exe`, `…-portable-arm64.exe`, `homematic-manager_<version>_amd64.deb`,
      `homematic-manager_<version>_arm64.deb`, and for the in-app update of the AppImage
      `Homematic-Manager-<version>-x86_64.AppImage` and `…-arm64.AppImage`.
      `update-names.mjs --config-only` prints the same list for the version in `package.json`; in the
      repository root, with `assets.txt` from the check above:

      ```sh
      node apps/electron/scripts/update-names.mjs --config-only |
          sed -n 's/^electron-builder.yml names: //p' | tr ',' '\n' | tr -d ' ' |
          while read -r f; do grep -qxF "$f" /tmp/rel-yml/assets.txt && echo "ok $f" || echo "MISSING: $f"; done
      ```

- [ ] Install each of the D-25 install types **from the released artefacts, not from the
      checkout**, as far as there is hardware for it: the addon packages on the lab boxes,
      `docker run` on the image, the npm package with `--install` in a fresh LXC, the Electron apps.
- [ ] **The release note.** The generated title and body (hint, changelog section, GitHub's notes -
      step 3) stay; what users of this release must do by hand is added at the top, in English and
      German (beta.18: re-choose `token` on openccu-lite once; the settings page is for administrators;
      `writeLog.*` renamed). **Until a signed Mac build exists: Mac users of beta.18 and older download
      the dmg of this release by hand once** — their app cannot install an update and does not know
      the link mode yet (B-47). `gh release edit v3.0.0-beta.n --notes-file <file>` sets the body.
- [ ] **Credit reporters and requesters by @handle in the release notes** (the maintainer, 2026-09-12,
      from beta.15 on). Everyone who reported a bug or asked for a feature that this release carries is
      named with their exact GitHub handle (`gh issue view <n> --json author`; for a report made in a
      comment, the comment's author; a forum report without a GitHub account by the forum name,
      without `@`): at the end of the item's `CHANGELOG.md` bullet as `(#158, @Baxxy13)`, and in a
      "Thanks to @…" line at the top of the body. GitHub builds the release's *Contributors* list from
      the @mentions in the body, so a handle that is only in a commit or an issue does not count.
      Check the draft's body for them before publishing.
- [ ] **Publish** — by the maintainer, or by the agent when the maintainer said so for this release.
      **As Latest, not as a pre-release and not left as a draft** (the maintainer, 2026-09-12, for
      beta.14 and on: "publish as Latest"). There is no stable 3.0 yet, so a beta that is only a
      pre-release is never the one GitHub and the desktop updater show; publish as soon as the assets
      are attached and check out. beta.10 to beta.18 went out that way.

```sh
gh release edit v3.0.0-beta.n --draft=false --prerelease=false --latest
```

- [ ] **Right after publishing, every updater and link-mode URL answers 200** (B-47, task 53): the
      same names as in the two checks above, now under the public URL. A 404 here means every
      running app is offered an update it cannot download: set the release back to draft
      (`gh release edit <tag> --draft=true`), fix, re-run the owning workflow.

      ```sh
      # in the repository root, on the release commit; /tmp/rel-yml is the draft check's folder
      v=3.0.0-beta.n; base=https://github.com/hobbyquaker/homematic-manager/releases/download/v$v
      { sed -nE "s/^ *-? *(url|path): *['\"]?([^'\"]*)['\"]?$/\2/p" /tmp/rel-yml/latest*.yml |
            sed -E 's/^(.*\.(zip|exe))$/\1\n\1.blockmap/'
        node apps/electron/scripts/update-names.mjs --config-only |
            sed -n 's/^electron-builder.yml names: //p' | tr ',' '\n' | tr -d ' '
      } | sort -u | while read -r f; do
          printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -IL "$base/$f")" "$f"
      done
      ```

      Every line has to start with `200` (run against beta.18, whose names did not match yet, it
      printed 404 for everything but the two debs).

- [ ] **Issue replies**, after the release is out: every issue the release contains gets a reply as
      `hobbyquaker-agent` (or the maintainer) in the issue's language — what the cause was, what
      changed, that it is in `3.0.0-beta.n` with the link, what the reporter can do (confirm, send a
      log) — the `fixed unreleased` label comes off, and `waiting for feedback` goes on where the
      reporter is asked to confirm. Read each issue's label timeline first: a label the maintainer
      removed is never set again. No issue is closed on a release (step 5).

### 5. Announce

- [ ] Post [`announcement-3.0-beta.md`](announcement-3.0-beta.md) in the Homematic forum — the
      placeholders at the top of that file first (version, release link, the Docker cookie line).
- [ ] Do **not** close issues on a beta. Issues are closed when 3.0.0 is out; the beta thread is
      where they get retested.

---

## 3.0.0

Everything in the beta list, plus:

- [ ] The beta ran long enough that the forum thread has gone quiet, and every bug it produced is
      either fixed or in "Known issues" with a number.
- [ ] `CHANGELOG.md`: rename `[Unreleased] — 3.0.0` to `[3.0.0] — <date>`, and fix the link
      definition at the bottom (`compare/v2.7.1...v3.0.0`).
- [ ] `Readme.md`: remove the "Version 3.0 ist in Entwicklung" block and the English "under
      development and not released yet" paragraph, and point the install lines at 3.0.0.
- [ ] The version is `3.0.0` exactly: `node scripts/version-dev.mjs 3.0.0`.
- [ ] Tag `v3.0.0` on `master`, which carries the whole 3.0 history since D-37/D-38 (the old
      `3.0-dev` branch was fast-forwarded into it and is left as it is).
- [ ] `latest` moves on npm and on ghcr.io automatically for a version with no `-` in it.
- [ ] Publish the draft **without** "pre-release", so `electron-updater` offers it: the updater
      only ever sees published, non-draft releases.
- [ ] `legacy/` is deleted in a commit of its own after the release, not before (AGENTS.md: it is
      the only specification of the 2.x behaviour that exists).
- [ ] Close the issues below.

### The addon's own version (D-24)

The addon is released as **3.1.0** on its own tag when its packaging changes without the
application changing. Its workflow reacts to any `v*` tag, so a `v3.1.0` tag builds the addon and
the other three workflows publish the same application again — that is intended and harmless, but
the release notes should say which of the four actually changed.

---

## Verifying the assets (D-27)

Every installer, package and tarball carries two Sigstore attestations (build provenance and SBOM),
signed with the workflow's OIDC token. They verify **offline, against a downloaded file**:

```sh
mkdir -p /tmp/rel && cd /tmp/rel
gh release download v3.0.0-beta.0 --repo hobbyquaker/homematic-manager

# every asset that is not itself an SBOM or a checksum
for f in *; do
    case "$f" in *.cdx.json|*.sha256|*.yml|*.blockmap) continue ;; esac
    echo "== $f"
    gh attestation verify "$f" --repo hobbyquaker/homematic-manager || echo "FAILED: $f"
done

# the addon packages also carry a plain checksum
sha256sum -c ./*.sha256

# the Docker image is verified by reference, not by file
gh attestation verify oci://ghcr.io/hobbyquaker/homematic-manager:3.0.0-beta.0 \
    --repo hobbyquaker/homematic-manager
```

- [ ] Every asset verified, and every installer/package has a matching `.cdx.json` next to it.
- [ ] A release with a missing SBOM is **not** published. Re-run the workflow that owns it instead.

---

## Re-running one workflow alone

This is the point of D-24. Each release workflow has a `workflow_dispatch` with the existing tag as
its only input, and attaching assets is idempotent — the action creates the draft if it is missing
and only adds files if it is not.

```sh
gh workflow run release-addon.yml    -f tag=v3.0.0-beta.0
gh workflow run release-electron.yml -f tag=v3.0.0-beta.0
gh workflow run release-npm.yml      -f tag=v3.0.0-beta.0
gh workflow run release-docker.yml   -f tag=v3.0.0-beta.0
gh run list --workflow release-addon.yml --limit 3
```

Never re-tag to retry a failed pipeline: the other three have already published for that tag, and
npm refuses to publish the same version twice. Fix, then dispatch the one that failed.

Inside `release-addon.yml` and `release-electron.yml` the matrix is `fail-fast: false`, so a broken
armv7l runtime still ships the two glibc packages and a failed macOS notarisation still ships
Windows and Linux. Re-running the workflow re-runs the whole matrix; that is fine, the upload is
idempotent.

---

## Issues to close

**Done for the beta on 2026-09-06, at the maintainer's request:** every open issue and both PRs
were commented on by the maintainer's agent (with a footer saying so), 51 closed, three kept open
(#135 CCU-Jack until someone tests it, #69 automatic best-interface assignment, #68 Windows
signing). The rule for the future stays: the comment says what fixed it and points at the
changelog section; the triage that produced this table is
[analysis-2026-09.md](analysis-2026-09.md) §10, and every number below appears in
[../CHANGELOG.md](../CHANGELOG.md) or [migration-from-2.x.md](migration-from-2.x.md).

**Fixed or implemented by the rebuild** — close as completed:

```
18 20 21 22 24 25 26 27 28 29 50 54 66 69 77 79 80 82 87 90 93 94 95 96 97 98
100 102 105 106 112 113 115 119 121 122 124 126 127 128 129 132 133 134 136 137 139
```

**Closed with an explanation instead of a fix** — the reason belongs in the comment:

| # | Comment |
| --- | --- |
| 41 | Rename not stored in Homegear — 3.0 has no Homegear-specific code (D-20); Homegear works over the generic XML-RPC path. |
| 59 | `setInterface` / roaming — answered in 2018; 3.0 reads the assignment out of the device's own `INTERFACE` (#122). |
| 60 | Homegear hang after a parameter change (2018 beta) — not reproducible; the write path was rebuilt, please retest with 3.0. |
| 123 | HVL addon devices — HVL is a dead project, out of scope (D-19). |
| 135 | CCU-Jack — the mechanism exists as a user-defined interface (CCU-Jack serves XML-RPC on `/RPC3` of port 2121). Verified 2026-09-09 against a CCU-Jack built from source with virtual devices and no CCU (device list, paramsets, `setValue` and its event, `ping`); waits for a report from someone with a CCU-Jack on a CCU. See `docs/upstream/`. |
| 68 | Windows code signing — SignPath application; the step is prepared in `release-electron.yml`. Keep open until it is signed. |

**Pull requests** — thank the author, then close:

| PR | Comment |
| --- | --- |
| 130 | Language setting + translations (2021) — the whole UI is de/en in 3.0 with plurals and interpolation; the intent of this PR is in, the code is not (the file it changed no longer exists). |
| 138 | Shift-select + multi `reportValueUsage` (2024) — implemented in 3.0 (#18). |

Suggested form, one per issue (**the maintainer runs these; nothing here closes an issue on its
own**):

```sh
gh issue comment 98 --body 'Fixed in 3.0.0: putParamset sends only changed, validated parameters, every write shows the exact call first, and multi-apply is restricted to channels with an identical paramset description. Background: docs/config-pending.md. https://github.com/hobbyquaker/homematic-manager/blob/master/CHANGELOG.md'
gh issue close 98 --reason completed
```

- [ ] Every number in the first block closed as completed.
- [ ] The six explained ones closed with their reason (or, for 68, left open).
- [ ] Both PRs closed with a thank-you.
- [ ] Nothing closed that a beta tester reopened.

---

## If something goes wrong

- **A workflow fails after another has published.** Do not delete the tag. Fix, then
  `gh workflow run <the one that failed> -f tag=<tag>`.
- **npm published a version you did not want.** `npm unpublish` within 72 hours, otherwise
  `npm deprecate` and release the next patch. The GitHub draft can simply be discarded.
- **The draft carries an asset from a run you rejected.** `gh release delete-asset <tag> <name>`
  before publishing.
- **The updater offers a beta to 2.x users.** That is intended while there is no stable 3.0: betas are
  published as Latest (step 4, the maintainer, 2026-09-12). If a beta must not be offered, tick
  "pre-release" on that one release; `electron-updater` then skips it.
- **A lab box does not come back after an addon update.** Stop, do not retry destructively; the
  rules and what was measured are in [hardware-checklist.md](hardware-checklist.md).
