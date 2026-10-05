# Local Meeting STT Smoke Test

Date: 2026-09-13. This measures speech-to-text (STT), not text-to-speech
(TTS). It is not an end-to-end meeting benchmark or an accuracy ranking.

## Environment And Method

- Apple M5 Pro, 24 GiB RAM, macOS arm64, Node 22.22.3.
- Existing development model files in `.nota/models`, native sherpa-onnx CPU
  inference through `createSherpaUtteranceDecoder`. The initial measurements
  below used sherpa-onnx-node 1.13.4; the upgrade rerun is recorded separately.
- Synthetic Samantha voice, 16 kHz PCM, 12.55275 seconds. No personal meeting
  audio, hosted inference, model downloads, or settings changes.
- One cold and one warm decode per configuration. Each configuration used a
  fresh Node process; cold includes recognizer loading but can use OS caches.
- Nemotron received 100 ms chunks with `partial()` after each chunk, supplied as
  fast as possible without real-time sleeping. Tiny received the full utterance.
- Timings exclude audio capture, VAD, network/IPC, summary generation, document
  import, and storage. The machine was not isolated from other development work.

Synthetic audio creation:

```sh
say -v Samantha --file-format=WAVE --data-format=LEI16@16000 \
  -o /tmp/nota-meeting-review-speech.wav \
  'We agreed to keep the pilot local only. Sam will test recording recovery by September eighteenth. Avery will update the onboarding checklist by September nineteenth. No budget or release date has been approved.'
```

The decoder probe read the WAV with `sherpa-onnx-node.readWave`, converted its
float samples to PCM16, and measured model loading plus `finish()`. Native
loading used `DYLD_LIBRARY_PATH` pointing to the installed
`node_modules/sherpa-onnx-darwin-arm64` directory.

## Measurements

| Decoder Configuration               | Cold Total | Warm Total |
| ----------------------------------- | ---------: | ---------: |
| Whisper Tiny multilingual INT8      |     495 ms |     284 ms |
| Nemotron native, no language label  |   1,399 ms |     688 ms |
| Nemotron native, with Whisper label |   2,881 ms |   1,055 ms |

The third row includes the optional Whisper language detector used when its
model files are complete. It returned `en`. Different cold-load conditions mean
the difference between rows is not a controlled measurement of detector overhead.

Nemotron first produced a partial after 700 ms of audio had been supplied.
That is an audio-position measurement, not wall-clock caption latency.

## Output Review

Tiny retained all key facts in this clean sample:

> We agreed to keep the pilot local only, Sam will test recording recovery by
> September 18. Avery will update the onboarding checklist by September 19.
> No budget or release date has been approved.

Both Nemotron configurations omitted the initial "We" and rendered "budget" as
"budge"; they retained the two owners and dates. The optional language detector
did not change the recognized words.

All three configurations decoded faster than real time. One short synthetic
English clip does not establish quality for accents, noise, overlapping speakers,
code-switching, or long meetings. Parakeet was not installed and was not measured.

## Implementation Follow-Up

- Auto now prefers native Nemotron 3.5 across supported desktop runtimes, then
  installed Parakeet, Tiny, and Moonshine before heavier or legacy fallbacks.
  Available configured preferences and explicit model selections still take
  precedence.
- Nemotron's optional language detector can fail without discarding successful
  text or preventing the next utterance. Cohere's required detection stays strict.
- IndexedDB blob writes now wait for transaction completion before acknowledging
  recording bytes and metadata.

Validation after these changes: 149 targeted tests across 20 files passed,
including meeting startup, audio recovery, finalization, markdown-save execution,
and local persistence. Backend and nbstore typechecks passed. Scoped ESLint
passed after increasing Node's heap to 8 GiB; default-heap lint exhausted 4 GiB.

Remaining acceptance work: realistic noisy and multilingual recordings; a full
desktop record, stop, save, restart, and reopen cycle; lower-RAM devices; memory
behavior when changing models repeatedly. These are local source changes, not a
packaged or released desktop build.

The native recognizer and language-identifier caches currently retain successful
loads until backend restart. The meeting idle-unload path does not evict these
Sherpa instances. Repeated model switching therefore needs a separate lifecycle
and memory review; this change does not add eviction.

## September 13 Runtime Upgrade

Official sources checked live:

- [NVIDIA Nemotron 3.5 model card](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b):
  released June 4, 2026; native streaming with 32 out-of-box locales, not 40
  production-ready languages.
- [Pinned sherpa 560 ms INT8 export](https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11):
  upstream HEAD still equals Nota's revision
  `ab43d895f5985b1bbab8b6eac8607fcdc05343f3`.
- [sherpa-onnx v1.13.8](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8):
  September 10 release, also the npm latest version on September 13. Nota now
  pins this runtime, including its platform binding through the lockfile.
- [Qwen3-ASR](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) is a January 2026
  alternative. Its current sherpa Node path is offline/utterance-final, not a
  drop-in native online-partial decoder. It was not added or benchmarked here.
- [Parakeet TDT v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) is an
  August 2025 model; a later repository modification date is not a model release.

Nemotron 3.5 is the newest applicable NVIDIA multilingual streaming family
verified in this review, not a claim to have surveyed every model or proven the
best meeting accuracy. The existing INT8 weights are unchanged.

Using the same synthetic clip, native Nemotron plus the optional Whisper
language detector on 1.13.8 measured **1,896 ms cold and 800 ms warm**. Both
passes produced 20 distinct partials; first partial was again at 700 ms of
supplied audio, not measured real-time latency. Language was `en`, both owners
and dates were retained, and "budget" was correct. The initial "We" was still
omitted. This uncontrolled short rerun establishes native compatibility, not a
statistically meaningful accuracy or speed improvement over 1.13.4.

Release builds now bundle Nemotron plus Tiny (roughly 786 MB uncompressed model
data). Tiny is retained for recovery and optional language labels. Existing
explicit profile selections are not migrated: changing a source default alone
does not switch an installed user's chosen provider.

Upgrade validation: 159 targeted tests across 18 files passed, covering provider
selection, dual-model seeding, decoder contracts, capture recovery, finalization,
transcript saves, and release packaging. Backend typecheck, scoped lint, and
format checks passed. Both real local seed directories passed checksum
verification. Independent review found no breaking adapter API change; sherpa
already overrides the NeMo feature dimension from model metadata, and its new
online language-hint API does not expose detected-language result metadata.
The release checker was also updated to require `libonnxruntime.dylib`, matching
the actual library name shipped with the new sherpa package, and rejects a
missing library in regression coverage.

| Target          | Native STT Binding     | Desktop Release / Verification                                               |
| --------------- | ---------------------- | ---------------------------------------------------------------------------- |
| macOS arm64     | Present in 1.13.8      | Native decoder smoke passed; packaged/live capture still needs QA            |
| Windows x64     | Present in 1.13.8      | Release target; target-device capture and inference not run here             |
| macOS x64       | Present in sherpa      | Release gated by separate onnxruntime-node 1.24.3 dependency                 |
| Windows arm64   | No sherpa Node binding | Release jobs removed until a supported binding exists                        |
| Linux x64/arm64 | Present in 1.13.8      | x64 release job and backend routing exist; desktop capture not verified here |
