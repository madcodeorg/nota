# Building Nota Desktop Client App

> **Warning**:
>
> This document is not guaranteed to be up-to-date.
> If you find any outdated information, please feel free to open an issue or submit a PR.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development](#development)
- [Build](#build)
- [CI](#ci)

## Things you may need to know before getting started

Building the desktop client app for the moment is a bit more complicated than building the web app. The client right now is an Electron app that wraps the prebuilt web app, with parts of the native modules written in Rust, which means we have the following source modules to build a desktop client app:

1. `packages/frontend/core`: the web app
2. `packages/frontend/native`: the native modules written in Rust (mostly the sqlite bindings)
3. `packages/frontend/apps/electron`: the Electron app (containing main & helper process, and the electron entry point in `packages/frontend/apps/electron-renderer`)

#3 is dependent on #1 and #2, and relies on electron-forge to make the final app & installer. To get a deep understanding of how the desktop client app is built, you may want to read the workflow file in [release-desktop.yml](../.github/workflows/release-desktop.yml).

Due to [some limitations of Electron builder](https://github.com/yarnpkg/berry/issues/4804), you may need to have two separate yarn config for building the core and the desktop client app:

1. build frontend (with default yarn settings)
2. build electron (reinstall with hoisting off)

We will explain the steps in the following sections.

## Prerequisites

Before you start building Nota Desktop Client Application, please following the same steps in [BUILDING#Prerequisites](./BUILDING.md#prerequisites) to install Node.js and Rust.

On Windows, enable symbolic-link support before cloning. See [the build prerequisites](./BUILDING.md#prerequisites).

## Development

After installing dependencies and building `@nota/native`, start the renderer in one terminal:

```sh
yarn dev --package @nota/electron-renderer
```

Start Electron in a second terminal:

```sh
yarn workspace @nota/electron dev
```

The desktop development launcher bundles and starts the local AI backend. The app's dev script targets the renderer at `http://localhost:8080`. Models still need to be installed locally for inference.

## Build, package & make the desktop client app

> repos/nota/.github/workflows/release-desktop.yml contains real order to build the desktop client app, but here we will explain the steps in a more detailed way. Up-to date.

### 0. Build the native modules

Follow [Build the native module](./BUILDING.md#build-the-native-module) to build the native modules.

### 1. Build the core

On Mac & Linux

```shell
BUILD_TYPE=canary yarn nota @nota/electron build

BUILD_TYPE=canary yarn nota @nota/electron generate-assets
```

On Windows (powershell)

```powershell
$env:BUILD_TYPE="canary"
$env:DISTRIBUTION=desktop
$env:SKIP_WEB_BUILD=1
yarn build
```

### 2. Re-config yarn, clean up the node_modules and reinstall the dependencies

As we said before, you need to reinstall the dependencies with hoisting off. You can do this by running the following command:

```shell
yarn config set nmMode classic
yarn config set nmHoistingLimits workspaces
```

Then, clean up all node_modules and reinstall the dependencies:

On Mac & Linux

```shell
find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +
yarn install
```

On Windows (powershell)

```powershell
dir -Path . -Filter node_modules -recurse | foreach {echo $_.fullname; rm -r -Force $_.fullname}
yarn install
```

### 3. Build the desktop client app installer

#### Mac & Linux

Nota does not require source edits to choose signing behavior. Omit
`APPLE_CODESIGN_IDENTITY` for an unsigned/ad-hoc local build. Set that variable
to sign with a stable identity; notarization additionally activates when
`APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` are present.

```shell
BUILD_TYPE=canary SKIP_WEB_BUILD=1 HOIST_NODE_MODULES=1 yarn nota @nota/electron make
```

Configured macOS release builds include the Apple SpeechAnalyzer Swift helper.
For a local package on a compatible Mac, add
`NOTA_ENABLE_APPLE_SPEECH_HELPER=1` to the make command.

Installer builds, including release CI, do not bundle model weights. Setup
downloads Whisper Base Q5 on first use. To bundle speech models anyway,
`NOTA_BUNDLE_DEFAULT_STT_MODEL=1` selects `whisper-base-q5-cpp` and
`whisper-tiny-q5-cpp` (about 88 MiB uncompressed);
`NOTA_BUNDLE_LOCAL_MODELS=model-id,model-id` selects explicit complete models
from `.nota/models`.

If speech seeds are bundled, the app installs them into local application data on first use.
Local text AI needs a separate text-model download through AI Settings unless
that model was explicitly bundled. Writing remains available without model
setup. Check each published release's notes for the actual bundled contents.

Configured Mac/Windows release targets are macOS arm64 and Windows x64.
These configured targets do not establish published or tested installers; check
the exact [release notes](https://github.com/madcodeorg/nota/releases). Intel Mac
packaging is
gated by `onnxruntime-node@1.24.3`; Windows arm64 packaging is gated by the lack
of a `sherpa-onnx-node@1.13.8` Windows ARM64 binding. Upstream C++/Java support is
not equivalent to the Node binding used by Nota.

For local macOS permission testing, sign the contained app with a consistent
Apple signing identity instead of the ad-hoc fallback. Use the `internal`
channel so a development-signed package does not replace the production
`pro.nota.app` identity. macOS privacy permissions are tied to the app's code
identity, so ad-hoc bundle rebuilds or signer changes can require consent again:

```shell
APPLE_CODESIGN_IDENTITY="Apple Development: Your Name (TEAMID)" \
NOTA_ENABLE_COOKIE_ENCRYPTION=0 \
BUILD_TYPE=internal SKIP_WEB_BUILD=1 HOIST_NODE_MODULES=1 \
yarn nota @nota/electron make --platform=darwin --arch=arm64
```

`Nota Dev` (`pro.nota.app.dev`), internal packages, and stable Nota have separate
macOS grants. Allowing one does not allow the others. Production releases use a
consistent Developer ID identity and notarization; neither bypasses user consent.

The dev launcher preserves the cached `Nota Dev` signer. If re-signing is needed
and its certificate is unavailable, restore that certificate and private key.
To intentionally change the dev signer, set `NOTA_DEV_CODESIGN_IDENTITY` to the
full certificate name or SHA-1 fingerprint (`-` explicitly selects ad-hoc).
This differs from the packaged-build `APPLE_CODESIGN_IDENTITY` setting.
An identity change can require granting permissions again.

Microphone access, System Audio Recording, and Apple Calendar access are separate
permissions. Calendar is optional for recording. Nota's Core Audio tap path
cannot read a public passive authorization status for system audio, so Settings
may show `Check access` after relaunch even when macOS retained the grant. Start
verifies capture access itself; a separate pre-recording check is not required.
Ordinary window focus changes must only refresh passive/cached status. A
functional audio probe is reserved for explicit access checks, returning from
System Audio Settings opened by Nota, and recording startup. After changing a
denied microphone grant in System Settings, Electron may require an app restart.

The system-audio permission check requires a native binding that exports
`ShareableContent.probeSystemAudioAccess`. It uses a tap-only aggregate and does
not activate a physical microphone. Older binaries must report a native-runtime
compatibility error, not fall back to the older mixed-capture probe.

Apple Calendar requests are single-flight across renderer windows. A bounded
wait does not cancel an outstanding macOS consent dialog. While it is pending,
`Check status` is passive. The matching calendar addon must report
`requestPending`; an older addon is incompatible with this consent lifecycle.

On Windows, microphone status is read from Electron and only `granted` is
reported as granted. An actual live microphone stream can satisfy recording
startup when preflight is inconclusive, but never overrides `denied` or
`restricted`. Recovery opens the fixed Windows microphone privacy page.
Windows screen permission does not establish system-audio capture availability.

September 14, 2026 native build repair: the desktop addon no longer depends on
the removed Enterprise Edition `nota_common` parser. SQLite storage and native
full-text indexing remain enabled; document extraction uses nbstore's existing
JavaScript crawler. A regression test covers text, references, attachments,
summary, and index clocks through that fallback. The desktop proof-of-work
helper uses SHA3-256 directly with bounded input/work validation.

The complete arm64 addon passed a document/blob/full-text-index close/reopen
smoke test, and its 20-bit proof-of-work output passed bidirectional compatibility
checks with the previous addon. Build the combined `nota_native` package, not a
capture-only addon. These checks do not establish packaged live-capture or
power-loss guarantees.

#### Windows

Making the windows installer is a bit different. Right now we provide two installer options: squirrel and nsis.

```powershell
$env:BUILD_TYPE="canary"
$env:SKIP_WEB_BUILD=1
$env:HOIST_NODE_MODULES=1
yarn nota @nota/electron package
yarn nota @nota/electron make-squirrel
yarn nota @nota/electron make-nsis
```

Once the build is complete, you can find the paths to the binaries in the terminal output.

```
Finished 2 bundles at:
  › Artifacts available at: <nota-repo>/packages/frontend/apps/electron/out/canary/make
```

## CI

The reusable workflows are [release-desktop.yml](../.github/workflows/release-desktop.yml) and [release-desktop-platform.yml](../.github/workflows/release-desktop-platform.yml), invoked by [release.yml](../.github/workflows/release.yml). Their source describes configured build, packaging, signing, and upload steps; it does not prove those jobs passed for a release.

See [the release process](contributing/releases.md) for source, license, installer, and publication checks. Use only the targets actually validated in the release notes.
