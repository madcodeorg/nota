# Third-party notices

Nota's project license is [MIT](LICENSE). It does not relicense third-party model weights, fonts, runtimes, dependencies, external services, or trademarks. Retain the license and attribution material that applies to the source or binary you redistribute.

## Source foundations

- Nota derives from MIT-covered portions of [AFFiNE](https://github.com/toeverything/AFFiNE), copyright (c) 2022-present TOEVERYTHING PTE. LTD. and its affiliates. The upstream notice remains in [LICENSE](LICENSE), [LICENSE-MIT](LICENSE-MIT), and [NOTICE](NOTICE).
- [BlockSuite](https://github.com/toeverything/BlockSuite) and y-octo retain upstream attribution. See [y-octo's license](packages/common/y-octo/core/LICENSE).
- Vendored drawing utilities retain license files beside [perfect-freehand](blocksuite/framework/global/src/gfx/perfect-freehand/LICENSE), [rough](blocksuite/affine/blocks/surface/src/utils/rough/LICENSE), [points-on-path](blocksuite/affine/blocks/surface/src/utils/points-on-path/LICENSE), [points-on-curve](blocksuite/affine/blocks/surface/src/utils/points-on-curve/LICENSE), and [path-data-parser](blocksuite/affine/blocks/surface/src/utils/path-data-parser/LICENSE).
- `blocksuite/docs/package.json` declares MPL-2.0 for the BlockSuite documentation package. Do not describe every repository file as MIT.
- Dependencies retain their own terms. Lockfiles record package versions; distributors must also retain the notices of the actual packaged dependency set, including Electron/Chromium and compiled native dependencies.

## Fonts and media

Retained font license text and copyrights are under [licenses/fonts](licenses/fonts/), component font directories, and `packages/frontend/core/public/fonts/OFL.txt`. SIL Open Font License 1.1 and Reserved Font Names remain applicable to the relevant fonts.

Offline PDF export bundles four Inter 3.3 WOFF files and Sarasa Gothic CL Regular 1.0.35 without editing the font bytes. Retain the [Inter 3.3 OFL](licenses/fonts/inter-3.3-OFL.txt), [Sarasa OFL and constituent copyright notices](licenses/fonts/sarasa-gothic-OFL.txt), and the embedded notices. The [PDF font source/checksum manifest](licenses/fonts/pdf-fonts.sources.json) records original download URLs, versions, copyright metadata, byte sizes, and SHA-256 values. Sarasa includes portions attributed to Renzhi Li, the Inter Project Authors, Adobe, and Google.

Satoshi files and externally sourced onboarding media/excerpts without established redistribution permission are excluded. Old Satoshi document identifiers remain readable through an Inter fallback. This compatibility treatment does not grant rights to distribute the removed font or imply upstream endorsement.

## Local inference runtimes

| Runtime           | Current pinned version             | License material                                                                                                                       |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Transformers.js   | 4.2.0                              | [Apache 2.0](licenses/runtime/transformers-LICENSE.txt)                                                                                |
| ONNX Runtime Node | 1.24.3                             | [MIT](licenses/runtime/onnxruntime-LICENSE.txt) and [upstream third-party notices](licenses/runtime/onnxruntime-ThirdPartyNotices.txt) |
| sherpa-onnx Node  | 1.13.8                             | [Apache 2.0](licenses/runtime/sherpa-onnx-LICENSE.txt); native transitive notices also apply                                           |
| Whisper.cpp       | Pinned by desktop ASR build script | MIT; desktop build copies the pinned upstream license into `native/licenses`                                                           |
| Cactus Needle     | Pinned by desktop ASR build script | Apache 2.0; desktop build copies its license into `native/licenses`                                                                    |
| Silero VAD        | Registered/downloaded component    | [MIT](licenses/models/Silero-VAD-LICENSE.txt); confirm exact weight origin when redistributing                                         |

The pinned runtime license texts were restored from the prior reviewed source notice set. Actual packaged libraries, optional helpers, and native transitive components still require an artifact-specific inventory.

## Model catalog

Models have separate licenses. The table records current catalog declarations and retained terms, not blanket clearance for all conversions or future versions. The [registry](packages/backend/ai/src/model-registry.ts) contains exact model IDs, repository URLs, revisions, and file hashes.

| Model family                         | Catalog terms               | Origin and review status                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cactus Whistle                       | Apache 2.0                  | Cactus Compute; [license fetched from the pinned Whistle revision](licenses/models/Whistle-LICENSE.txt). Current desktop seed model.                                                                                                                                                                         |
| Whisper Tiny/base/small/medium/large | MIT                         | OpenAI; ONNX/sherpa or whisper.cpp conversions. Retain [OpenAI terms](licenses/models/Whisper-LICENSE.txt) and applicable converter notices. Tiny Q5 is the current desktop fallback seed.                                                                                                                   |
| Qwen3.5 0.8B/2B/4B                   | Apache 2.0                  | Qwen/Alibaba; ONNX conversion by onnx-community. [Official 2B base-model license](licenses/models/Qwen3.5-LICENSE.txt) retained with [source revision](licenses/models/Qwen3.5-source.txt). The pinned 2B ONNX export's root LICENSE URL returns 404; converter-origin/NOTICE verification remains separate. |
| Liquid LFM2.5 230M/350M/1.2B/2.6B    | Custom LFM Open License 1.0 | Liquid AI. [Terms fetched from pinned 230M ONNX revision](licenses/models/LFM-1.0.txt). Commercial-use conditions include a $10 million annual-revenue threshold. Confirm each selected model's terms before redistribution; these are not unrestricted Apache models.                                       |
| Gemma 4 E2B/E4B                      | Apache 2.0                  | Google; converted ONNX packages by onnx-community. Catalog declaration retained; exact selected-package attribution must be verified. Do not apply older Gemma terms automatically.                                                                                                                          |
| SmolLM3 3B                           | Apache 2.0                  | Hugging Face/HuggingFaceTB; converter notices must accompany a redistribution where applicable.                                                                                                                                                                                                              |
| MiniLM L6 v2 embeddings              | Apache 2.0                  | sentence-transformers; converted package by Xenova.                                                                                                                                                                                                                                                          |
| Cohere Transcribe                    | Apache 2.0                  | Cohere Labs; sherpa conversion by csukuangfj2. Auxiliary language-detector models have separate terms.                                                                                                                                                                                                       |
| Nemotron 3.5 sherpa INT8             | OpenMDW 1.1                 | NVIDIA base model; sherpa conversion/quantization by csukuangfj2. Retain [OpenMDW terms](licenses/models/OpenMDW-1.1.txt) and model-origin notices.                                                                                                                                                          |
| Parakeet TDT v3 INT8                 | CC BY 4.0                   | NVIDIA base model; sherpa conversion/quantization by csukuangfj. Retain attribution, [license](licenses/models/CC-BY-4.0.txt), source links, and an indication of changes.                                                                                                                                   |
| Distil-Whisper                       | MIT                         | Preserve OpenAI and Hugging Face contributor notices; [retained terms](licenses/models/Distil-Whisper-LICENSE.txt).                                                                                                                                                                                          |
| Moonshine base English               | MIT, English section        | Moonshine AI/usefulsensors; conversion by csukuangfj2. [Combined upstream terms](licenses/models/Moonshine-LICENSE.txt) include separate non-English conditions that do not describe this selected English model.                                                                                            |

`licenses/models/NVIDIA-Open-Model-License.txt` preserves a historically referenced agreement for review. Its presence does not authorize a legacy model or replace the current Nemotron grant.

## npm dependencies with notes

- `y-provider` (0.10.0-canary.9) is a small Yjs provider helper published to npm by an AFFiNE/BlockSuite maintainer. The npm package declares no license field. It appears to originate from the MIT-licensed AFFiNE monorepo, but this is inferred, not declared by the package.
- `@img/sharp-libvips` is LGPL-3.0-or-later and is used as a dynamically linked library.
- `@sentry/cli` (FSL-1.1-MIT) and `eslint-plugin-sonarjs` (LGPL-3.0-only) are development-only tools and are not shipped in installers.
- Run a license scan of the packaged dependency set before each release. Full per-package license text for npm dependencies is available from each package and the lockfile.

## Distribution requirements

Source snapshots contain no user data, model cache, installers, or compiled native runtime library. A source license review does not validate a model-seeded installer.

For every redistributed model/runtime, preserve the applicable copyright, license, NOTICE, source/creator attribution, and required description of conversions or modifications. Apache, MIT, OpenMDW, CC BY, and LFM terms differ. Verify the selected artifact's actual origin rather than treating a catalog identifier as a completed review.

Installer release notes must identify bundled model revisions and components and state the validation performed. See the [release process](docs/contributing/releases.md).
