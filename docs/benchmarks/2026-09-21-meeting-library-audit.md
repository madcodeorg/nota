# Meeting And Search Library Audit

Date: September 21, 2026

## Decisions

- Reuse the installed `sherpa-onnx-node` 1.13.8 speech runtime. Its NeMo
  streaming implementation consumes the per-stream `language` option. Language
  prompting must apply to every newly created stream, including utterance resets.
- Keep the existing ONNX/Transformers.js text and embedding runtime. Do not add
  another inference runtime or change the selected model during this work.
- Do not add sqlite-vec without retrieval/scale measurements demonstrating a
  need. The current workspace mirror and embedding files are rebuildable caches;
  workspace documents and blobs remain canonical.
- Never inline synced documents into the AI index under a parent document's
  access decision. Index each readable document separately, retaining its own
  permissions and citations. Do not inject titles from unverified linked docs.

Indexing tradeoff: even readable linked-document titles are omitted from the
parent export. That avoids inheriting the parent's potentially broader
downstream visibility, but loses some parent-to-target semantic context. Target
documents remain independently searchable. Canonical editor content is unchanged.

## Optional Speaker Labels

The installed sherpa package exposes `OfflineSpeakerDiarization` with mono
float input and `{ start, end, speaker }` output. Configuration includes a
pyannote segmentation model, speaker embedding model, clustering configuration,
and minimum on/off durations. The public wrapper's `process` method is
synchronous, so it must not execute on the live meeting backend event loop.

This is not ready for a user-facing toggle:

- No verified diarization model pair, pinned checksums, model license review,
  readiness flow, or target-device memory/latency measurements exist in Nota.
- The live recognizer mixes microphone and system audio. Its dominant-source
  label is not a speaker identity and must not be presented as one.
- Microphone archive export concatenates raw samples; the spool journal carries
  gap/restart timing that is removed during cleanup. Portable recordings alone
  do not establish a trustworthy mapping to meeting transcript timestamps.
- Transcript save snapshots currently track text, source, and timing, not
  reviewed speaker annotations.

The smallest safe follow-up is to preserve a per-source sample-to-meeting-time
manifest with the canonical recording attachments before journal cleanup,
provision licensed models through the existing manager, and run optional
post-meeting inference in an isolated worker with cancellation and resource
limits. Produce reviewable anonymous turns first. Refuse timestamp alignment for
older recordings without a trustworthy map; do not infer cross-source identity
or overwrite edited transcript blocks.

## Evidence Boundaries

The API findings are based on the installed package source and the upstream
v1.13.8 NeMo implementation. No diarization weights were downloaded and no user
recordings were processed. Native imports are not packaged Mac/Windows execution
proof. New unit/integration tests do not establish improved transcription
accuracy, live device behavior, or launch readiness.
