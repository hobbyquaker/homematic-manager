# Release checklist

What the maintainer does to cut a release. Two lists: a **beta** (`3.0.0-beta.n`) and the **3.0.0**
release. Everything here is run by a person — the agent never tags, never pushes to `master`, never
publishes, never runs a release workflow and never touches an issue (AGENTS.md).

Commands are meant to be pasted into a shell in the repository root, on the branch that is being
released. `gh` has to be logged in as the repository owner.

Contents: [Before the first release ever](#before-the-first-release-ever) ·
[Beta](#beta-300-beta-n) · [3.0.0](#300) · [Verifying the assets](#verifying-the-assets-d-27) ·
[Re-running one workflow alone](#re-running-one-workflow-alone) ·
[Issues to close](#issues-to-close) · [If something goes wrong](#if-something-goes-wrong)

---

## Before the first release ever

These are one-time, and nothing below works until they are done.

- [ ] **Enable GitHub Actions** on `hobbyquaker/homematic-manager` (Settings → Actions → General →
      "Allow all actions"). Nothing has ever run: no CI, no build artefact, no release. The agent
      could not do this — the API call is refused for anything but the owner.
- [ ] **Let workflows write releases**: Settings → Actions → General → Workflow permissions →
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
- [ ] **Decide OQ-15**, the Docker cookie default, before the first image is published.
- [ ] Optional, both still missing: Apple notarisation secrets (`APPLE_ID`, `APPLE_TEAM_ID`,
      `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_CERTIFICATE_P12`, `APPLE_CERTIFICATE_PASSWORD`) and
      SignPath for Windows (the step is in `release-electron.yml`, commented out). Without them
      macOS ships unnotarised and Windows unsigned; that is a documented state, not a blocker.

Run a `ci.yml` and a `build.yml` green **once** before tagging anything. `build.yml` is what
produces the first Windows Electron artifact, and the packaged desktop app has never been started
by a human (`app.whenReady()` does not fire under WSL).

---

## Beta (`3.0.0-beta.n`)

### 1. The branch is green

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build && npm run test:e2e
apps/ccu-addon/test/container-test.sh --idle      # needs docker
```

- [ ] All green. `npm test` needs hm-simulator, which is a devDependency since 1.0.0 — a skipped
      e2e suite is not a pass.
- [ ] `docs/hardware-checklist.md` has a run against the **current** build on the three lab boxes.
- [ ] `CHANGELOG.md` "Known issues" matches what is actually broken today, and the version heading
      says what is being released.

### 2. The version

D-18: the counter moves with a script, never by hand, and the same version is written into every
workspace package.

```sh
npm run version:dev            # 3.0.0-dev.n  -> 3.0.0-dev.n+1
```

For the step from dev to alpha or beta the script takes the version as its argument and carries
the new preid from then on (`npm run version:dev` on a beta gives the next beta):

```sh
node scripts/version-dev.mjs 3.0.0-beta.0    # sets it everywhere and refreshes package-lock.json
```

- [ ] `npm ci` still works afterwards (the workspace ranges are exact and move with the version;
      a stale `package-lock.json` is what breaks it).
- [ ] Commit the bump on `3.0-dev`.

### 3. The tag

```sh
git push origin 3.0-dev
gh run watch                                # ci.yml, build.yml, addon.yml green first
git tag -a v3.0.0-beta.0 -m 'Homematic Manager 3.0.0-beta.0'
git push origin v3.0.0-beta.0
```

The tag is what starts the four release workflows. They run **in parallel and independently**
(D-24): a failed addon build does not hold back the Electron, npm and Docker releases of the same
tag, and vice versa.

| Workflow | Produces |
| --- | --- |
| `release-electron.yml` | `.exe` + `.blockmap` + `latest.yml` (Windows), `.dmg` + `.zip` + `latest-mac.yml` (macOS), `.AppImage` + `.deb` + `latest-linux*.yml` (Linux), one `.cdx.json` per installer |
| `release-npm.yml` | the `apps/web` tarball on npm, plus tarball and `.cdx.json` on the release |
| `release-addon.yml` | `hmm-ccu-{armv7l,aarch64,x86_64}-<version>.tar.gz` with `.sha256` and `.cdx.json` |
| `release-docker.yml` | the multi-arch image on ghcr.io plus `homematic-manager-docker-<version>.cdx.json` |

Whichever gets there first creates the GitHub release as a **draft**; the others add their assets
to it. Nothing is public until the draft is published by hand.

```sh
gh run list --limit 8
gh run watch <run-id>
```

- [ ] **npm dist-tag.** Nothing to do by hand: `release-npm.yml` publishes any version containing
      a `-` under `next` and only a plain one under `latest`, the way the Docker workflow does.
      Check it though — `npm view homematic-manager dist-tags` must still show `latest` on the old
      1.0.14 after a beta, and `next` on the version just published. Testers install
      `npm install -g homematic-manager@next`.

### 4. Verify, then publish

- [ ] Every asset that should be there is there, and each installer/package has its `.cdx.json`
      (D-27: a release with a missing SBOM is not published).
- [ ] `gh attestation verify` passes for each — see below.
- [ ] Install each of the D-25 install types **from the published artefacts, not from the
      checkout**: the three addon packages on the lab boxes, `docker run` on the image, the npm
      package with `--install` in a fresh LXC, the three Electron apps.
- [ ] Edit the draft: the generated notes plus a short "what to test / what is known broken", and
      **tick "Set as a pre-release"**.
- [ ] Publish the draft.

```sh
gh release view v3.0.0-beta.0 --json assets --jq '.assets[].name'
gh release edit v3.0.0-beta.0 --prerelease --draft=false
```

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
- [ ] `Readme.md`: remove the "Version 3.0 ist in Entwicklung" block and the "noch kein Release"
      sentence.
- [ ] The version is `3.0.0` exactly:
      `npm version 3.0.0 --no-git-tag-version && node scripts/version-dev.mjs`.
- [ ] Merge `3.0-dev` into `master` (`master` is still 2.7.1), tag `v3.0.0` on `master`.
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

Only when **3.0.0** is published, never on a beta, and by the maintainer. The comment should say
what fixed it and point at the changelog section; the triage that produced this table is
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
| 135 | CCU-Jack — the mechanism exists as a user-defined interface (CCU-Jack serves XML-RPC on `/RPC3` of port 2121); no CCU-Jack was available to verify it against. See `docs/upstream/`. |
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
- **The updater offered a beta to stable users.** The release was published without "pre-release"
  ticked; tick it and the updater stops offering it.
- **A lab box does not come back after an addon update.** Stop, do not retry destructively; the
  rules and what was measured are in [hardware-checklist.md](hardware-checklist.md).
