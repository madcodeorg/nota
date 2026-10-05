# Meetings And STT Audit

Updated: 2026-06-10

## Goal

Make Nota meetings reliable enough to behave like a dedicated local meeting
assistant while still keeping meeting output inside the Nota workspace.

## Baseline Compared

Meetily Community Edition is a useful baseline because it is a dedicated local
meeting recorder:

- Tauri/Rust native recording core.
- Separate microphone and system-device recording controls.
- Local Whisper/Parakeet transcription.
- Transcript update events from native code.
- Local meeting persistence in SQLite plus frontend recovery state.
- Explicit queue/status reporting for transcription work.
- Stop flow that waits for queued transcript chunks before final shutdown.

Nota has a broader product target:

- Electron/native recording inside the existing workspace app.
- Shared local AI backend for chat, workspace search, meetings, summaries, and
  action proposals.
- Apple SpeechAnalyzer on macOS when available.
- Local ONNX STT fallback through Nemotron/Cohere.
- Meeting transcripts and summaries should become workspace content, not a
  separate canonical meeting database.

## Best-Practice Requirements

1. Normalize audio before STT.
   Meeting STT should ingest raw PCM in a known shape. Nota normalizes live
   backend frames to 16 kHz mono PCM before VAD/chunk STT.

2. Use VAD before batch or chunk STT.
   Local STT models are more stable when silence is filtered before model
   inference. Nota uses VAD buffers and speech chunks for ONNX providers.

3. Separate partial and final transcript events.
   UI should update one live line for partials and persist only final segments.
   Nota keeps `partialSegment` separate from `transcriptSegments`.

4. Expose queue/backpressure state.
   A meeting app must know whether audio capture is ahead of transcription.
   Nota now tracks queued, completed, and failed speech chunks in `SttState`.

5. Drain queued chunks on stop.
   Stop should stop capture first, then finish queued STT work, then mark the
   meeting stopped. Nota's chunked ONNX session now reports and drains queued
   chunks before final status.
   The live Nemotron session must follow the same rule for normalized frames:
   stop closes new frame intake, drains the queued frame chain, and only then
   finalizes active utterances. It must not drop frames only because decoding is
   behind.

6. Keep a post-stop fallback.
   If live transcript has no final segments, use the saved recording/audio
   chunks for a final transcription attempt.

7. Keep provider selection explicit but safe.
   Auto mode should choose Apple SpeechAnalyzer on supported macOS systems and
   fall back to local ONNX STT. Explicit provider choices should fail clearly
   when unavailable.

8. Keep canonical meeting output in workspace content.
   Runtime caches are allowed for recovery and listing, but the long-term
   transcript/summary belongs in Nota docs/search/sync.

## Remaining Gaps

- Device-level internal/system audio needs final validation on macOS and
  Windows hardware.
- Apple SpeechAnalyzer availability depends on OS/runtime support and should be
  tested on a machine where `SpeechTranscriber.isAvailable` is true.
- Speaker diarization is not implemented.
- Audio-level and queue diagnostics are available in state, but no dedicated
  developer diagnostics panel exists yet.
- Full end-to-end stop/save/search validation should be the final test pass.
