# Local AI Runtimes and Meeting Pipeline

Nota runs everything on the user's machine. This page records which runtime
does what, why, what was measured, and what is still open. Source of truth is
the code; this is the map.

## Runtimes

| Job                                       | Runtime                                      | Hardware                  | Code                                       |
| ----------------------------------------- | -------------------------------------------- | ------------------------- | ------------------------------------------ |
| Chat, summaries, tools                    | llama.cpp (`nota-llama-server`, GGUF models) | GPU first, CPU fallback   | `packages/backend/ai/src/local-llama.ts`   |
| Whisper transcription                     | whisper.cpp (`nota-whisper-helper`)          | GPU first (Metal, Vulkan) | `native-asr.ts`, `native/local-asr-helper` |
| Sherpa speech models (Nemotron, Parakeet) | sherpa-onnx                                  | CPU                       | `sherpa-stt.ts`                            |
| Speech detection (Silero VAD)             | ONNX Runtime                                 | CPU                       | `meetings.ts`                              |
| Embeddings                                | ONNX Runtime                                 | CPU                       | `model-registry.ts`                        |

ONNX chat models are still in the registry code but are no longer offered.
`isListedLocalModel` hides them in the UI and `providers.ts` leaves them out of
the catalog. Saved ONNX chat ids are mapped to GGUF ids in `config.ts`, so an
existing user is moved to a model that needs a download.

llama.cpp is text only. Speech models cannot run in it.

### Why llama.cpp for chat

- GPU on every platform with one flag (`-ngl 99`): Metal on Apple Silicon,
  Vulkan on Windows. ONNX chat ran on CPU, and CoreML is unreliable for LLMs.
- New models (Gemma, Qwen3.5) arrive as GGUF first. ONNX exports lag.
- Cost: one extra 18 MB binary we build ourselves, and one child process.

### Chat server behavior

- One resident server at a time, closed after 10 minutes idle.
- Switching models retires the old server once it is idle.
- A pid file in `.nota/llama-server.pid` lets the next run reap a server left
  behind by a crashed parent.
- GPU by default. If the GPU start fails (out of memory, bad driver), the server
  is started once more on CPU and a warning is logged. With no GPU backend at
  all, llama.cpp uses the CPU on its own.
- The device info reports `llama-cpp-gpu` or `llama-cpp-cpu` for what actually
  happened.

### Environment variables

| Variable                 | Effect                                            |
| ------------------------ | ------------------------------------------------- |
| `NOTA_LLM_GPU=0`         | Force chat onto the CPU                           |
| `NOTA_ASR_GPU=0`         | Force Whisper onto the CPU                        |
| `NOTA_SHERPA_PROVIDER`   | Sherpa provider, default `cpu`                    |
| `NOTA_LLAMA_SERVER_PATH` | Use a specific `nota-llama-server` binary         |
| `NOTA_LLAMA_VULKAN`      | Build with Vulkan (default on for Windows builds) |

### Build and packaging

`build-local-asr.ts` builds `nota-llama-server` from a pinned llama.cpp commit
(Metal on macOS, Vulkan on Windows) and copies the license. The binary lives in
`packages/frontend/apps/electron/resources/native/`, which is git-ignored.
`macos-arm64-output-check.ts` and `release-stt-packaging.spec.ts` check it is
packaged. Models are downloaded at setup, never bundled.

## Models

Chat (GGUF): Qwen3.5 0.8B, 2B, 4B, Gemma 4 E4B and Gemma 4 12B.
Qwen3.5 2B is the default. Onboarding marks Gemma E4B as recommended when the
machine has enough RAM. llama.cpp models are checked against total RAM, not
free RAM, because the OS reclaims cache.

Speech: Whisper (tiny to large-v3 and turbo, Q5) on whisper.cpp, plus the sherpa
Nemotron and Parakeet models. The Whistle model was removed.

The model ranking came from two test transcripts. Treat it as a starting point.

## Meeting capture pipeline

`meeting-capture-pipeline.ts` mixes mic and system audio in 100 ms windows, runs
speech detection, and hands phrases to the chosen decoder.

- **Source wait:** if one source lags, the mixer waits up to 500 ms for it
  before mixing. Audio that still arrives later is dropped from the live mix
  and counted as late (the recording is kept).
- **Long speech:** an utterance is cut at the first 150 ms pause after 10 s. A
  hard cut at 20 s only applies to speech with no pause.
- **Silence:** 500 ms ends a phrase for streaming decoders, 400 ms for offline.
- **Save errors:** the background save runs every 3 s. If it fails, the live
  status shows a warning and the error is logged. Search index failures are
  logged.
- **Timestamps:** transcript lines show rounded seconds. Floor on start and ceil
  on end used to make neighboring lines look 1 s apart the wrong way.

## What was measured

Apple Silicon, 24 GB:

- Qwen 2B, 200 words: about 1.6 s warm on GPU through the app. Raw server
  speed is about 148 tok/s on GPU and about 83 tok/s on CPU.
- Gemma E4B: about 4 s including a model switch.
- CPU retry: tested with the real server and a wrapper that fails the GPU start.
  It logged one warning and answered on CPU.
- Silero VAD: 0.1 ms per 32 ms window on CPU (about 320x realtime). CoreML is
  the same. A GPU adds nothing here.
- Sherpa on CPU is deliberate. An earlier benchmark found CoreML slower for the
  int8 models on Apple Silicon. It was not repeated.

## Not verified

- Windows GPU (Vulkan for whisper and llama).
- The release workflows and a signed, packaged build.
- The pipeline fixes in a live meeting.
- A test for the save-error warning.
- The model ranking beyond two transcripts.

## Open work

- Run the sherpa speech models on a GPU, or confirm CPU is fast enough.
- Decide whether to trim the 6 optional sherpa speech models.
- Onboarding offers Whisper large-v3 turbo as the post-meeting model. Plain
  large-v3 is in the registry but is not offered in onboarding yet. If added, it
  should be opt-in with a note that it uses more RAM.
