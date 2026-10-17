# Platform support and release status

## Today

- macOS (Apple silicon): built, signed, notarized and auto-updating. See RELEASING.md.
- Windows (x64): built for stable and beta, with Vulkan GPU support. Installers
  are unsigned and trigger SmartScreen warnings. Windows ARM64 is not supported
  because `sherpa-onnx-node` has no ARM64 binding.
- Linux: not built or released yet. The workflow has a `desktop_linux` switch,
  but it has not been run or tested for Nota.

## Before Windows ships

1. Apply for a free SignPath Foundation certificate (open-source programme) or
   buy another signing option. Until then builds are unsigned and trigger
   SmartScreen warnings. `windows-signer.yml` still expects a self-hosted
   `win-signer` runner and only runs when the `WINDOWS_SIGNING` repo variable is
   `true`; it will be replaced when a signing service is chosen.
2. Run Release as a beta tag and install the result on a real PC.
3. Check that auto-update works from one beta to the next. The feed is
   `updates/beta/latest.yml` and lists only the NSIS installer.
4. Confirm the Google sign-in redirect and local transcription work on Windows.
5. The Site workflow already publishes the Windows feed. Add a Windows download
   link to the download page and `public/launch.html` when Windows goes stable.

## Before Linux ships

1. Pick formats (AppImage and .deb are the usual choices).
2. Run Release by hand with only `desktop_linux` on, as a beta tag, and test on a real machine.
3. Check auto-update (`latest-linux.yml`), and note that Linux has no signing step.
4. Add the Linux downloads to the Site workflow.

## Release limits

- GitHub has no limit on the number of releases. Each file must be under 2 GiB,
  and there is no cap on total size or download bandwidth.
- Old versions can stay available. Update feeds only point at the latest one.

## Housekeeping

- Download counts are recorded daily on the `stats` branch (STATS.md).
- Google OAuth verification is pending; the app shows an unverified-app warning until it is approved.
- The stray tag `v0.1.6-beta.5` has no release. Tags are locked, so leave it.
