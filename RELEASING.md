# Releasing Nota

## Flow: beta first, then main

Every change ships to the `beta` branch and a beta release first. `main` and
stable releases only get what has already been proven in a beta.

1. Land changes on the public `beta` branch (sync from the private repo, then
   open a PR into `beta`, or push to it). The `CI passed` check must be green.
2. Tag the `beta` commit `v0.1.4-beta.1` and push the tag. `Release` builds
   macOS and Windows and publishes a pre-release on the beta update channel.
3. Install the beta and test it. Found a problem? Fix it on `beta` and tag
   `v0.1.4-beta.2`. Never move a tag.
4. Only when a beta works, open a PR `beta` -> `main` (squash merge). Then follow
   **Stable** below to tag the same version from `main`.

Do not push work-in-progress straight to `main`, and do not tag a stable
release from a commit that has not shipped as a beta first.

Caches: GitHub only lets a tag run read caches saved on the default branch
(`main`) or on the tag itself. The first beta after a lockfile or native change
is therefore slower. Pushes to `main` and the `Build renderer` CI job keep the
shared caches warm.

## Stable

1. The version must already have shipped as a beta (see above). Merge `beta`
   into `main` by PR. The `CI passed` check must be green.
   Rename `## Unreleased` in CHANGELOG.md to the version (`## 0.1.4`). Its
   bullets become the GitHub release notes and the in-app "What's new" box
   that people see once after updating. Keep them short and user-facing.
2. Push a tag: `git tag v0.1.4 && git push origin v0.1.4`. The version comes from the tag.
3. Wait about 25 minutes. `Release` builds, signs, notarizes and creates a **draft** release.
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
- Every tag builds macOS and Windows x64. See docs/PLATFORMS.md for Windows
  and Linux status.
