# Nota release process

Public source and installer releases are published from [madcodeorg/nota](https://github.com/madcodeorg/nota). A configured workflow is not proof that a platform is release-ready. Publish only the binaries validated for that release.

## Prepare source

1. Choose a reviewed implementation snapshot. Preserve copyright and third-party notices.
2. Confirm that private history, local workspace data, tokens, model caches, build outputs, and unverified media/binaries are excluded. Run source/provenance and secret checks before making a repository public.
3. Keep release version, package metadata, tag, and installer filenames consistent. The root and Electron manifests contain the application version; use the repo's version tooling instead of independently editing generated values.
4. Run targeted behavior tests, related package checks, typechecking, and relevant lint/build validation. Record unrelated failures and limitations explicitly.

## Build the desktop artifact

The existing package scripts are `generate-assets`, `build`, `package`, and `make` in `@nota/electron`. Follow [the desktop build guide](../building-desktop-client-app.md) for prerequisites, native modules, and dependency staging. A typical local asset/build invocation from the repository root is:

```sh
BUILD_TYPE=internal yarn nota @nota/electron generate-assets
```

Forge supports explicit platform and architecture parameters:

```sh
BUILD_TYPE=internal HOIST_NODE_MODULES=1 yarn workspace @nota/electron make --platform=darwin --arch=arm64
```

These examples use an internal channel for local evaluation. They do not produce a publicly trusted signature by themselves. Public macOS releases require a consistent Developer ID Application identity, notarization, stapling, and successful platform assessment. Do not label an ad-hoc or development-signed artifact as notarized.

Current public binary work targets macOS arm64 with macOS 14 or later. Windows/Linux x64 packaging remains configured; those platforms must pass their own installer acceptance checks before being advertised as supported public downloads. Intel Mac and Windows ARM64 local-runtime compatibility remain constrained by the distributed Node runtime bindings.

## Models and notices

A source snapshot does not include model weights. For seeded installers, choose explicit model IDs, verify the registry file hashes, and inventory every included model/runtime and conversion. Forge defaults and release CI use `cactus-whistle` and `whisper-tiny-q5-cpp`, about 47 MiB of speech weights uncompressed. The app installs those bundled seeds into local application data on first use. Text AI requires a separate model download through AI Settings unless explicitly bundled; optional AI catalog entries do not imply they are included.

The existing seed command is:

```sh
yarn workspace @nota/ai-backend prepare-model-seed --model cactus-whistle
yarn workspace @nota/ai-backend prepare-model-seed --model whisper-tiny-q5-cpp
yarn workspace @nota/ai-backend prepare-model-seed --verify-only --model cactus-whistle
yarn workspace @nota/ai-backend prepare-model-seed --verify-only --model whisper-tiny-q5-cpp
```

Retain `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, applicable `licenses/` texts, and helper/model-specific notices in the final app. License identifiers and successful checksums are not a substitute for selected-artifact provenance and redistribution review.

## Validate the actual installer

Install the produced artifact and verify first launch, local writing/save/reopen, import/export relevant to the release, model setup/inference, recording permission behavior, and the intended update policy. Validate backups/recovery without overwriting the user's only workspace copy. Inspect the packaged native libraries and notice files.

Record the exact source commit, installer checksum, OS/architecture, signature/notarization status, bundled models, test results, and known limitations. A development smoke test does not prove the release artifact behaves the same way.

## Publish

The [Release workflow](https://github.com/madcodeorg/nota/actions/workflows/release.yml) is the manually invoked CI entry point. Review its inputs and the reusable [desktop workflow](../../.github/workflows/release-desktop.yml) before running it. Signing credentials belong in the release environment, not the repository.

Create a GitHub release with the validated artifacts and checksums. Use a prerelease label for beta/evaluation builds. Publish only after the source and artifact checks are complete; do not reuse binaries from another source commit or imply untested platforms have passed. Release notes must distinguish completed verification from open limitations.
