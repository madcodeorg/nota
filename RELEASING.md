# Releasing Nota

## Stable
1. Merge changes into `main` by PR. The `CI passed` check must be green.
2. Push a tag: `git tag v0.1.4 && git push origin v0.1.4`. The version comes from the tag.
3. Wait about 25 minutes. `Release` builds, signs, notarizes and creates a **draft** release.
4. Download the draft zip, install it, confirm it launches and the version is right.
5. Publish: `gh release edit v0.1.4 --draft=false --latest`. The `Site` workflow then
   updates thenota.app (download link and `updates/stable/latest-mac.yml`).
6. Installed apps find the update on launch, download it, verify it and restart.

## Beta
Push a tag like `v0.1.4-beta.1`. It is published as a pre-release and feeds
`updates/beta/latest-mac.yml` only.

## Rules
- Never publish a draft you have not installed.
- `v*` tags are locked. Fix a bad release with a new version, never a moved tag.
- Only macOS is built today. See docs/PLATFORMS.md for Windows and Linux.
