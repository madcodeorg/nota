# Releasing Nota

## Flow: beta first, then main

Every change ships to the `beta` branch and a beta release first. `main` and
stable releases only get what has already been proven in a beta.

1. Land changes on the public `beta` branch (sync from the private repo, then
   open a PR into `beta`, or push to it). The `CI passed` check must be green.
2. Tag the `beta` commit `v0.1.4-beta.1` and push the tag. `Release` builds
   macOS, Windows and Linux and publishes a pre-release on the beta update channel.
3. Install the beta and test it. Found a problem? Fix it on `beta` and tag
   `v0.1.4-beta.2`. Never move a tag.
4. Only when a beta works, open a PR `beta` -> `main` (squash merge). Then follow
   **Stable** below to tag the same version from `main`.

Do not push work-in-progress straight to `main`, and do not tag a stable
release from a commit that has not shipped as a beta first.

## What a release run does

- **Checks** (typecheck and unit tests) run alongside the builds. The release is
  only published if they pass; a commit that fails them is built but never
  released.
- **Smoke test**: the packaged macOS and Windows apps are launched and must
  show the UI (`scripts/smoke-desktop-app.ts`). They remain non-blocking until
  `SMOKE_TEST_BLOCKING=true`. Linux validates ZIP/AppImage/deb and launches all
  three under Xvfb, including an installed Debian package. Linux smoke failures
  block Linux publication from the first run; they do not certify meeting,
  model, deep-link or update behavior on a real desktop.
- **Caches**: GitHub only lets a run read caches saved by its own ref or by the
  default branch (`main`). Releases run on tags, so the `Warm caches` workflow
  (on `main`: pushes that touch native code or lockfiles, plus twice a week)
  saves the Rust, speech-helper (whisper/llama) and install caches that releases
  restore. Do not rename release jobs: cache keys include the job id. A release
  deletes the caches its own tag saved, since nothing else can read them, to stay
  under the repo's 10 GB cache limit.

## Test build without announcing a beta

Run `Release` from the Actions tab on any branch (no tag), choosing the
platforms. It builds a `canary` pre-release (`vYYYY.M.D-canary.HHMM`). Only
stable and beta update feeds are published on thenota.app, so installed apps are
never offered a canary. Download it from the Releases page.

To build just Linux using the shared workflow (no macOS/Windows rebuild):

```sh
gh workflow run release.yml -R madcodeorg/nota --ref beta \
  -f desktop_linux=true -f desktop_macos=false -f desktop_windows=false
```

This branch run gets a fresh canary version; it does not relabel local binaries
or move a released tag. Future tag-triggered runs select all three platforms.

## Stable

1. The version must already have shipped as a beta (see above). Merge `beta`
   into `main` by PR. The `CI passed` check must be green.
   Rename `## Unreleased` in CHANGELOG.md to the version (`## 0.1.4`). Its
   bullets become the GitHub release notes and the in-app "What's new" box
   that people see once after updating. Keep them short and user-facing.
2. Push a tag: `git tag v0.1.4 && git push origin v0.1.4`. The version comes from the tag.
3. Wait for the selected builds and checks. `Release` builds, signs/notarizes
   macOS, and creates a **draft** release. Linux ships ZIP, AppImage and Debian
   packages; Flatpak remains a separate local target.
4. Download the draft zip, install it, confirm it launches and the version is right.
5. Publish: `gh release edit v0.1.4 --draft=false --latest`. The `Site` workflow then
   updates thenota.app (download link, `updates/stable/latest-mac.yml`, and
   `updates/stable/latest.yml` for Windows).
6. Installed apps find the update on launch, download it, verify it and restart.

## Beta

Push a tag like `v0.1.4-beta.1` on the `beta` branch. It is published as a pre-release and feeds
`updates/beta/latest-mac.yml`. Every tag also builds Windows x64 (NSIS and
Squirrel installers), which feeds `updates/<channel>/latest.yml` with the NSIS
installer only.

Windows builds are unsigned until a certificate is set up. Signing runs only
when the `WINDOWS_SIGNING` repo variable is `true` and a `win-signer`
self-hosted runner exists. Without it, installers trigger a SmartScreen
warning. Before telling anyone Windows works, install the beta on a real PC and
check the app launches, Google sign-in returns to the app, and an update from
one beta to the next installs.

## Rules

- Never publish a draft you have not installed.
- Beta first: a stable tag needs a tested `vX.Y.Z-beta.N` of the same code.
- `v*` tags are locked. Fix a bad release with a new version, never a moved tag.
- Every new tag builds macOS arm64, Windows x64 and Linux x64. See
  docs/PLATFORMS.md for platform status.
- Update feeds select the latest published stable/beta release independently
  per platform. A Linux-only release must not remove macOS/Windows feeds;
  canaries are downloads, never stable or beta updates.
