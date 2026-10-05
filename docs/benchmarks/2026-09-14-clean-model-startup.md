# Clean Model Startup Check

Tested September 14, 2026 against the committed-source macOS arm64 internal
package, version 0.26.4 (`f2f58f10`).

## Isolation

The smoke script extracts the packaged backend and runtime libraries, then uses
fresh temporary home, settings, model, and cache directories. It does not load
the development model cache or user AI credentials. A macOS sandbox restricts
writes to the test directory and denies outbound network access for offline
cases. No user recordings, notes, settings, or OS permissions are changed.

The backend runs under host Node 22.22.3 rather than Electron's utility-process
launcher. This verifies model setup and native loading, not clean-install UI,
permission consent, transcription accuracy, or recording-to-note persistence.

## Results

| Case                                            | Result                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Empty profile, packaged seeds                   | All three seeds installed; Nemotron and Tiny required-file checksums passed |
| Auto native Nemotron preload                    | Passed, 644 ms wall time                                                    |
| Second preload in same process                  | Reused loaded model                                                         |
| Restart without seed access or outbound network | Nemotron loaded in 641 ms; model files unchanged                            |
| Empty profile without seeds                     | Reported missing/unavailable models; did not claim readiness                |
| Actual Tiny download to empty profile           | 103,609,903 bytes downloaded; three checksums passed                        |
| Downloaded Tiny loaded after offline restart    | Passed, 125 ms wall time                                                    |

Timings are single-run observations on the development Mac, not lower-RAM or
Windows performance guarantees. Gemma files were seeded but text generation was
not exercised by this check.

## Reproduce

```sh
node node_modules/tsx/dist/cli.mjs \
  packages/frontend/apps/electron/scripts/clean-model-smoke.ts \
  /absolute/path/to/Nota-internal.app --download-tiny
```

The script prints a temporary evidence directory containing `results.json`,
process logs, and disposable profiles. Omit `--download-tiny` to run only the
offline cases. All child backend processes are stopped at completion.

## Installed-App Distinction

The installed `/Applications/Nota.app` observed during this check was version
0.26.3 and bundled only Whisper Tiny. Its saved Legacy Nemotron preference and
downloaded models belong to the stable profile, independently of the internal
0.26.4 package. Results from one profile do not establish readiness in another.
