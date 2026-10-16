# Platform support and release status

## Today
- macOS (Apple silicon): built, signed, notarized and auto-updating. See RELEASING.md.
- Windows and Linux: not built or released yet. The workflows have switches for them
  (`desktop_windows`, `desktop_linux` in release.yml), but they have not been
  run or tested for Nota.

## Before Windows ships
1. Get a Windows code-signing certificate and add it as GitHub secrets. Unsigned
   builds trigger SmartScreen warnings. `windows-signer.yml` signs with `signtool`.
2. Run Release by hand with only `desktop_windows` on, as a beta tag, and install the result on a real PC.
3. Check that auto-update works from one beta to the next (`latest.yml` feed).
4. Confirm the Google sign-in redirect and local transcription work on Windows.
5. Add the Windows files to the Site workflow so thenota.app offers the right download.

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
