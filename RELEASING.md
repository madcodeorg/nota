# Releasing Nota

## Beta first, then stable

Develop in the private repo and export only reviewed source to public `beta`.
Never move or delete an existing `v*` tag or replace published installers.

1. Bump workspace versions and add short user-facing notes to `CHANGELOG.md`.
2. Land the reviewed changes on public `beta`; `CI passed` must be green.
3. Build `v0.1.14-beta.1` from that commit. Every beta builds **all supported
   desktop packages**, not just one platform. Fix problems in a new beta version.
4. Install/test the beta, including an update to the next beta on real devices.
5. Promote tested code through a `beta` -> `main` PR, then build `v0.1.14`.
   All builds upload into a **draft** first. Beta is published only after all eight
   packages and three feeds are verified against their uploaded sizes/digests;
   stable remains a draft for installation acceptance.
6. Install the draft and check its embedded version, local data and updater before
   publishing with `gh release edit v0.1.14 -R madcodeorg/nota --draft=false --latest`.

Examples are versions, not instructions to reuse an already published tag.

## Start a release

Push a semantic tag from the tested branch:

```sh
git tag v0.1.14-beta.1
git push origin v0.1.14-beta.1
```

Alternatively, dispatch from `beta` with an **explicit** version:

```sh
gh workflow run release.yml -R madcodeorg/nota --ref beta \
  -f version=0.1.14-beta.1
```

The workflow creates the tag at the exact built commit. A tagged dispatch uses
its tag version. Branch dispatch without a version fails rather than inventing a
date-based canary. Stable branch dispatch is permitted only from `main`.
Existing published versions or tags pointing at another commit fail preflight
and are checked again immediately before release writing. Stable also requires
a published beta of that version with an equivalent source tree, allowing only
explicit release-metadata differences (including squash promotion).
Release runs are serialized without cancelling an active publisher.

## Required packages and checks

Every beta and stable release requires:

- macOS arm64: **DMG and ZIP** (the updater downloads the ZIP).
- Windows x64: **NSIS EXE, Squirrel EXE and portable ZIP**.
- Linux x64: **AppImage, Debian DEB and ZIP**.

All three platform jobs and shared typecheck/unit tests must succeed before
aggregation. The feed generator rejects missing/empty packages and hashing
errors before publishing any manifests. A failed platform never advances a
partial beta/stable release. Flatpak remains a separate local target; there are
no RPM/Pacman or additional CPU-architecture release jobs.

Linux CI builds on Ubuntu 22.04/GCC11 and checks packaged ELF requirements
(GLIBC <= 2.35 / GLIBCXX <= 3.4.30 with current libstdc++ security updates).
It launches ZIP, extraction-mode AppImage and an installed Debian package under
Xvfb; Debian installation/removal and metainfo cleanup are blocking checks.
macOS/Windows packaged launch checks remain controlled by `SMOKE_TEST_BLOCKING`.
Headless startup checks do not prove live recording, models, user-data recovery,
permissions or real update installation. Those remain device acceptance tests.

## Update behavior

All normal packaged builds check automatically at startup and every 30 minutes,
with throttled checks on focus. An old saved auto-check preference cannot disable
these checks. Development builds and explicit `NOTA_DISABLE_AUTO_UPDATE=1` test
profiles can remain offline. Checks do not block opening notes.

- **Stable** reads `/updates/stable/latest{,-mac,-linux}.yml`.
- **Beta** reads `/updates/beta/latest{,-mac,-linux}.yml`.
- The default `latest` filename stays inside the chosen channel directory;
  setting the SDK's channel to `beta` would request different filenames.
- Beta and stable remain separate products/profiles. No implicit cross-channel
  migration or downgrade is enabled.
- Downloads are opt-in by default; restart/install is explicit, never automatic
  on app quit.
- macOS installed apps, positively detected Windows NSIS installs and writable
  Linux AppImages use their native update paths.
- Debian, ZIP/portable, Squirrel and readonly/mounted app layouts still **check
  and notify**, but offer the exact release downloads for user-managed installation.
  They do not invoke privileged package commands or silently migrate to NSIS.
- Microsoft Store installs check/notify but open the Store's update surface;
  the app does not replace the Store installation.

The Site workflow publishes independent per-platform feeds after publication,
retaining usable older platform feeds for historical partial releases. It never
puts a canary into beta/stable feeds. macOS feed eligibility requires a ZIP.

Legacy `2026.*-canary.*` versions are not renamed or offered as stable/beta.
Their version sorts above `0.x`; install the normal beta manually once to leave
that legacy channel. Never globally enable downgrades to work around this.

## Signing and caching

macOS uses the existing signing/notarization path. Windows is unsigned unless
`WINDOWS_SIGNING=true` and the signing runner/certificate are configured, so
SmartScreen warnings remain. Linux packages are not package-signed; provenance
and manifest hashes do not establish OS/package-manager signature trust.

Use unpaid standard runners and the existing main-branch `Warm caches` workflow
for Rust, speech helpers and installs. Tag runs can restore only their own or
main caches. Do not rename release jobs: installation keys include job IDs.
Linux native/helper keys isolate the Ubuntu/compiler baseline. Tag-scoped caches
are removed after publishing so they do not crowd the shared 10 GB cache budget.
