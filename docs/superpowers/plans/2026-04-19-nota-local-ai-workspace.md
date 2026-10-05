# Nota Local AI Workspace Plan

Updated: 2026-10-05

This plan implements the source-of-truth design in `docs/superpowers/specs/2026-04-19-nota-local-ai-workspace-design.md`.

## Local workspace product follow up

The [October 5 local workspace product plan](2026-10-05-nota-local-workspace-product-plan.md) details the next daily-use workstreams: local recovery and backups, databases with import/export and migration, optional user-owned Google Drive sync, animated onboarding with a simple setup box, and AI/meeting quality. It includes the agreed product requirements, proposed implementation order, and acceptance gates. Creating the plan does not mark those capabilities implemented or packaged-app QA complete.

## Approved STT Lineup And Delivery Order (October 5)

1. Retire the legacy English-only Nemotron JavaScript adapter and INT4 catalog
   entry. Source changes migrate old settings to native Nemotron 3.5, preserve
   original saved meeting metadata and user model files, and recover retained
   audio through the native decoder. This does not require downloading a new
   model during settings migration. Existing Auto fallback handles a missing
   native package; an explicit native choice reports the missing download.
2. Whistle is integrated through the official Cactus Needle static runtime,
   with a pinned, checksummed 17 MB model for en/de/fr/es/it/nl/pl. It is Auto's
   starter on supported desktops. The shared capture engine produces phrase
   finals; Whistle has no native partial captions. Apple Silicon fixture tests
   pass; meeting/device acceptance remains separate.
3. Multilingual Whisper Q5 Tiny, Base, Small, Medium and Large v3 are integrated
   as separate size choices in the existing model selector, using whisper.cpp.
   Tiny/Base/Small use Q5_1; Medium/Large v3 use Q5_0. Small is the balanced
   option. Whisper produces phrase finals; stable rolling captions remain
   later work. Settings separates download size from device RAM minimum.
4. Keep the current latest verified native Nemotron 3.5 streaming package
   (`sherpa-nemotron-3.5-streaming-560ms-int8`) for multilingual live transcription.
   Do not introduce a second language detector solely for its metadata.
5. Keep Apple SpeechAnalyzer as a Mac option, conditional on OS, hardware and
   locale availability. Add supported-locale discovery, selection and Apple asset
   preparation. The bridge now discovers actual device languages and installed
   packs, accepts a selected locale, and snapshots the system locale for Auto.
6. Add language-aware setup using validated model capabilities and installed
   packages. Offer Whistle for compatible speech, native Nemotron for supported
   alternatives, and Whisper for broader coverage. Avoid automatic switches
   based on inaccurate text. Keep one selected ASR runtime resident and release
   the previous runtime on switching. Keep MiniLM embeddings unchanged.

Whistle, all five Whisper Q5 sizes and the Apple device locale picker are
implemented. The native helpers and desktop layers/renderer build on macOS
arm64. Verified fixtures cover Whistle and Whisper Tiny, including recordings
longer than the helper's 30-second per-request limit. Idle native helpers unload
in 60 seconds or when switching to another idle model. Windows/Linux target
builds and live capture/meeting accuracy acceptance remain unverified. Mac
Intel is outside the current delivery scope by user choice. See the October 5
pipeline review for implementation and measured fixture memory.

## Plug-And-Play Delivery Order

Current focus, September 13:

1. Provider-scoped text fallback is implemented: missing/failed local models no
   longer select a hosted provider automatically. Explicit hosted selection stays
   supported.
2. Local text generation now requests non-thinking chat templates. The offline
   benchmark uses the existing runtime and fixed synthetic inputs; the initial
   Gemma E2B and Qwen3 0.6B CPU comparison is recorded in
   [the baseline report](../../benchmarks/2026-09-13-local-ai-baseline.md).
3. Auto now prefers native Nemotron 3.5 on Mac, Windows, and Linux, while
   preserving saved available preferences. Release builds bundle Nemotron and
   multilingual Whisper Tiny recovery weights with sherpa-onnx-node 1.13.8.
   Mac/Windows release targets remain Mac arm64 and Windows x64; Intel Mac's
   separate ONNX Runtime blocker and Windows arm64's missing sherpa Node binding
   remain explicit gates. Seed/routing tests are not target-device capture proof.
4. Meeting safety fixes now have automated coverage: normalized audio is
   fsynced before acknowledgement and survives a backend SIGKILL before VAD
   completion; Markdown imports publish complete staged updates; local document
   and root-metadata writes precede save acknowledgement; content snapshots
   recover same-ID transcript revisions without replacing user edits. Local
   persistence waits now reject on disconnect/engine failure/stop, and unsaved
   writes survive same-process document reconnect. Short speech requires
   positive timestamp overlap before a final can count as coverage.

Next delivery gates, in order:

1. Extend the promising Qwen3 0.6B short-task results to longer realistic
   meetings and permission-scoped retrieval; compare SmolLM3 next. Evaluate Qwen3 1.7B only as a
   candidate, not an untested default. Measure lower-RAM devices and simultaneous
   STT/text memory pressure before choosing a compact standard package.
2. Complete one setup flow for model download/resume, honest load-failure status,
   repair/retry, permissions, and a working first local answer/meeting. Normal
   settings polling must not load or probe heavyweight models.
3. Finish the remaining user-data risks: cross-renderer canonical-save
   coordination, explicit recovery when the local document persistence engine
   stops or fails, strict handling of Markdown image-import failures, and
   permission checks for embedded content in the workspace index. Keep the new
   audio/save failure-injection tests as regression gates.
4. Verify record -> transcript -> saved editable note -> cited AI answer ->
   approved edit -> undo, offline after restart in the packaged desktop app.
5. Repair and verify optional Google Drive storage registration/offline behavior
   independently; local workspace use must remain available without Google auth.

Do not interpret this list as completed packaged-app QA. Keep Gemma E2B as the
current text default until comparative output and device measurements justify a
change. The comparison downloaded and checksum-verified the existing 583 MB Qwen3
0.6B package into the development cache without changing user AI settings.

September 21 library/reliability follow-up:

- Native Nemotron now supports preferred-language settings with immutable
  per-meeting snapshots and per-utterance prompts. Auto remains the default;
  Nemotron no longer loads a separate language-ID model. Settings, decoder,
  reservation, persisted snapshots, same-process resume, and validation
  regressions cover this behavior; a real restart remains device QA.
- Embedding search filters scope before inference, leases active pipelines until
  inference finishes, disposes idle runtimes, rejects invalid vectors, and falls
  back after inference/cache-write failures. Concurrent index builds are shared;
  content changes invalidate in-flight results with bounded retries. No new
  inference or vector database dependency was added.
- AI-index exports now keep synced-document contents and linked titles out of
  parent documents; each readable document is indexed independently. A real
  WorkspaceImpl regression covers restricted and separately readable embeds.
- Meeting SSE reconnects skip exact snapshot-final replays before scheduling
  transcript updates, preserving same-ID revisions. This removes quadratic replay
  merge work but does not prove the cause of previously observed live UI lag.
- Optional speaker labeling remains unshipped: the existing sherpa runtime has
  the API, but licensed model provisioning, durable recording-clock alignment,
  reviewed annotations, and target-device quality/performance gates remain.
  See [the library audit](../../benchmarks/2026-09-21-meeting-library-audit.md).

## Current State

Done in the current worktree:

- AI SDK 7 backend package at `packages/backend/ai`, including provider-agnostic reasoning levels in chat requests and capability metadata in the shared model catalog.
- Local/OpenAI/Anthropic/Google text provider routing.
- Local/OpenAI/Google image provider routing.
- Shared local model registry for text, STT, and embedding downloads/probes; local text now routes through a generic ONNX runtime instead of Gemma-specific loader tables.
- Curated local text models include Gemma E2B/E4B, SmolLM3 3B, Qwen3.5 0.8B/2B/4B and LiquidAI LFM2.5 230M/350M/1.2B Instruct/2.6B. Qwen3.5 2B is the fresh-config default; saved Qwen3 0.6B selections migrate to 0.8B. Existing other selections and MiniLM embeddings are preserved.
- October 5 chat-model refresh: seven pinned and checksummed packages run through the shared ONNX runtime. Per-model context limits are exposed in AI Settings and enforced against the templated prompt/output budget. Standard Qwen exports avoid unsupported OPT operators; Liquid 230M assistant-mask template annotations render through the JS tokenizer; always-thinking Liquid 2.6B streams only its final answer. Seven native short-task smokes passed on macOS arm64; smaller devices, other architectures, long transcripts and packaged-app QA remain. Published scores for all ten models and native measurements: [model benchmark report](../../benchmarks/2026-10-05-local-chat-models.md). Onboarding and arbitrary URL import are deferred.
- AI Settings page with provider, local model, hosted API-key, tool, and MCP controls. Hosted keys persist only in `.nota/ai-settings.json` and settings reads return masked `hasKeys` state.
- AI Settings exposes workspace embedding mode/model controls and a local-first remote-download opt-in. Workspace Settings also exposes a focused Embeddings page for local workspaces.
- AI and Meeting AI settings persist locally under `.nota/ai-settings.json`.
- Chat allows 1–50 AI SDK tool rounds, defaulting to 50, then reserves one final response step with tools disabled. Normal completion and cancellation can end the loop earlier.
- October 5 tool connection: all ten curated ONNX text models use the same AI SDK execution/continuation loop and built-in/MCP inventory as hosted chat, with existing workspace access, schema validation and approval policy. The adapter handles complete JSON objects/arrays and supported native Qwen/Liquid syntax without evaluating expressions or repairing truncated calls. Settings shows per-model use guidance without disabling tools for smaller models. Native synthetic tool tasks pass for Qwen3.5 2B/4B and Liquid 1.2B/2.6B; 0.8B repeats calls, and 230M/350M fail. This is functional evidence on one Mac, not a general reliability score. See the [tool smoke report](../../benchmarks/2026-10-05-local-chat-tools.md); packaged-app acceptance remains.
- Local model health/download/probe APIs are now exposed at `/v1/local/models` for local ONNX text, embedding, and STT models, with `/v1/stt/models` retained as a Meeting Settings compatibility alias.
- Built-in AI tools:
- `search_nota_workspace` with structured source references, cached local neural embeddings when the embedding model is available, local hashed-vector chunk ranking, and lexical fallback. The backend indexes only access-verified workspace content explicitly mirrored by the renderer; it never scans Electron app data or arbitrary files under the backend root.
  - `web_crawl`
  - `nota_shell` disabled by default
- All text providers share deterministic workspace-search preflight for workspace/note/meeting questions when search is enabled, inject the top local sources into model context, stream the search result as a stored `search_nota_workspace` tool result, and append a compact Sources section when the model omits source markers. Hosted chat can pass data-URL image attachments as AI SDK image parts; local ONNX remains text-only.
- All text providers can target an accessible note by exact natural-language or quoted title when no note is already open. Longest exact matches win, duplicate/truncated matches refuse safely, and the target is re-read through the access-scoped workspace mirror. Structured calls use the shared approval store; exactly one fenced Markdown payload remains a fallback when no actual proposal exists. Completed tool results are preserved on final-generation errors, and execution/schema failures appear in streamed and saved history.
- Workspace-content mirror APIs now support targeted deletion through `/v1/workspace/content/delete`, letting the app remove trashed/deleted docs from search without rebuilding the entire workspace index.
- Workspace search endpoint at `POST /v1/workspace/search`.
- Durable backend action proposal store under `.nota/agent-action-proposals.json` with bounded local history and endpoints:
  - `POST /v1/agent/actions/proposals`
  - `GET /v1/agent/actions/proposals`
  - `GET /v1/agent/actions/proposals/:id`
  - `PATCH /v1/agent/actions/proposals/:id`
- `propose_nota_action` tool creates pending, approval-gated workspace action proposals.
- Nota AI page shows pending action proposals and can apply create-note/task-list proposals through Markdown import.
- Nota AI page can append `insert_markdown` proposals to existing docs and add `create_mindmap` proposals to an existing doc surface.
- Whole-document `clear_doc` proposals are disabled across model, backend, and frontend paths until Nota can capture a restorable snapshot and provide one-step undo. Historical proposal records remain readable.
- Nota AI page can apply `create_database` proposals as editable table-backed Nota documents through Markdown import.
- Applied action proposals record result metadata, including action type, workspace id, applied doc id, and apply timestamp. Failed applies keep the proposal reviewable instead of hiding it.
- Applied create-note, create-task-list, and create-database proposals carry undo metadata when they create standalone documents; the Nota AI page can undo them by moving the generated document to trash and marking the proposal `undone`.
- Applied insert-markdown proposals and create-task-list proposals appended into existing docs carry inserted block undo metadata; the Nota AI page can undo them by deleting the generated block and marking the proposal `undone`.
- Applied create-mindmap proposals carry generated surface element undo metadata; the Nota AI page can undo them by deleting the generated mindmap element and marking the proposal `undone`.
- Every local undo now takes a durable scoped backend claim (`applied -> undoing`) before mutating workspace content, preventing two renderer windows from undoing the same action. Failed local validation releases the claim to `applied`, successful undo completes to `undone`, and stale/restarted claims recover conservatively to `applied` for fingerprint-guarded retry.
- AI-created proposals carry the originating chat session id when available, and apply/reject events append an audit message back into that chat.
- Main chat, Playground, and interactive AI chat-block history/fork views all pass the proposal's real workspace/session scope through the same apply, reject, and undo handlers, so approval cards remain functional outside the primary Nota AI page.
- Existing frontend AI actions route to the AI backend.
- Local ONNX text pipelines use reference-counted leases and bounded LRU retirement: the current model stays warm, the previous idle model is disposed on a switch, and an active generation is never disposed mid-request.
- Google Calendar/Drive OAuth reports `connected` only after the secure Electron session write succeeds. Direct and broker exchanges, refreshes, replacement sessions, disconnect races, and restart reload now share the awaited persistence contract.
- Electron Google refresh is single-flight across workspace renderers and the calendar scheduler. Refresh broadcasts carry a renderer mutation correlation id, while joined renderers trust the authenticated IPC result when their secure reload is still pending, so the first calendar request after expiry cannot reuse the old access token.
- Electron workspace creation hides the unavailable Nota Cloud target while retaining local, Google Drive, and configured self-hosted choices. About/telemetry/update surfaces no longer advertise disabled cloud telemetry or an unavailable release feed.
- Final macOS packaging replaces Electron's broad App Transport Security exemption with the local-network-only declaration used by Nota's loopback AI and OAuth services, and the release checker rejects any package that restores arbitrary loads.

Known blockers:

- September 14 permission validation found stale development native addons.
  The combined desktop addon now builds without the removed `nota_common`
  Enterprise Edition dependency: nbstore reuses its JavaScript crawler, while
  SQLite persistence and native full-text indexing remain enabled. The new
  system-only audio probe and Calendar pending-request contract are included in
  rebuilt addons. Native storage close/reopen and proof-of-work compatibility
  smokes pass; packaged live capture and recovery still require device QA.
- A separately running local model endpoint is optional, not a blocker for
  managed ONNX inference. Endpoint availability must be checked live only when
  the user selects that path.
- MCP config is stored and the backend pools configured MCP clients by settings signature. Annotated read-only tools are exposed to chat, while annotated/destructive or heuristic write tools are gated for approved `run_mcp_tool` proposals.
- Workspace search has structured citations, an optional local neural embedding path using `@huggingface/transformers`, a rebuildable local embedding cache under `.nota/search`, a local hashed-vector chunk index fallback, and a rebuildable Nota workspace-content mirror under `.nota/search/workspace-content.json`. The default managed embedding model is `all-minilm-l6-v2-embedding`; `auto` mode skips neural embedding load when free RAM is tight, `fallback` mode never loads it, and loaded embedding pipelines are released after idle time. Full workspace-content sync removes stale mirrored docs for that workspace, fallback ranking suppresses no-hit chunks, and Markdown table/database docs produce row-level `table-row:N` chunks. Deeper native database schema/permission integration remains.
- Workspace search results now include a structured `citation` object with `ref`, `label`, `kind`, source type, line range, and block id when available, so chat grounding does not need to parse citation strings.
- Agent write actions have durable backend proposals and frontend apply for create-note/task-list, insert-markdown, create-mindmap, database creation/row append, and active-editor replace-selection. Replace-selection requires the target document to be open with text/blocks selected and records a tagged editor-history undo point; undo refuses to overwrite newer edits and remains available only while that editor history is alive. Database row/schema undo fingerprints every AI-created target and refuses to delete it after any later row, column, cell, order, or view edit.
- Meeting provider/runtime routing, live SSE transcripts, durable fallback audio spooling, hard-restart capture recovery, canonical note saving, and summary generation are wired. The backend reserves a stable id before native capture; Electron fsyncs ownership before the tap and rehydrates raw system/microphone audio without the old native session. Permission-gated live capture, hard-kill/relaunch device QA, and final Developer ID/notarized-package validation remain release QA tasks.
- Mixed local meeting capture caps its initial noise-floor sample and applies the fixed speech threshold immediately, so a meeting that begins mid-sentence cannot learn opening speech as background noise and defer the first live transcript until a louder phrase. Continuous speech is committed to stable transcript rows at a 15-second hard boundary rather than waiting up to five minutes for silence.
- Native sherpa-onnx STT is wired through the existing mixed-capture decoder interface for Parakeet TDT v3 INT8, streaming Nemotron 3.5 INT8, multilingual Whisper Tiny INT8, Moonshine Base v2, Distil-Whisper Large v3.5 INT8, and Cohere Transcribe INT8. On this Apple Silicon Mac, earlier measured decode RTFs were about 0.023 for Whisper Tiny, 0.010 for Moonshine, 0.175 for Distil-Whisper, and 1.45 for Cohere; Cohere remains optional/post-meeting because it is slower than realtime. As of September 13, Nemotron is the Auto default across supported desktop runtimes, transcribes 32 out-of-box locales with its built-in auto prompt, and leaves detected-language metadata unknown because the native binding filters its tag. Parakeet remains an optional phrase-final model. The Electron package carries the sherpa Node binding and required platform libraries.
- Local model health now reports current RAM, disk, platform execution-provider preference, and per-tier fit status.
- Local model health now reports download status, progress, byte targets, and target local path; download requests return structured blocked/planned/queued state and persist status under `.nota/models/downloads.json`.
- macOS DMG builds can opt into seeded local model resources with `NOTA_BUNDLE_DEFAULT_STT_MODEL=1` or `NOTA_BUNDLE_LOCAL_MODELS=...`. Packaged apps copy complete seeded registry models from `Contents/Resources/local-models` into the normal app data `.nota/models` folder on first backend startup, so the existing local model status path remains the source of truth.
- Model download status now exposes per-file checksum state. Downloads verify configured SHA-256 values and re-download same-size files when checksum validation fails. Trusted SHA-256 values are populated for the current ready ONNX/Xet-backed files in Nemotron, Cohere, Gemma E2B, and Gemma E4B; normal Git-object metadata files remain size-checked only.
- Local model runtime probing is explicit and user-triggered from Settings. `POST /v1/stt/models/:id/probe` records the latest probe result and `/api/ai/settings` exposes it without loading heavy models during normal refresh.
- `POST /v1/audio/transcriptions` now accepts local 16 kHz PCM input and common PCM16/Float32 WAV uploads, then routes through the local STT readiness/model path instead of returning a static 501.
- Cohere is wired through the native sherpa adapter once its model and shared multilingual Whisper Tiny detector are downloaded. The detector supplies Cohere's required per-utterance language code for ar/de/el/en/es/fr/it/ja/ko/nl/pl/pt/vi/zh. It emits final transcript snippets per VAD speech chunk and supports uploaded/post-meeting transcription, but is not an Auto default because the measured Mac decode was slower than realtime.
- Meeting stop verifies transcript coverage against every retained VAD speech chunk on a per-source basis. Fully covered chunks are skipped; uncovered or partially covered chunks are retried in contiguous same-source groups with the meeting model first and installed Whisper Tiny, Moonshine, Distil-Whisper, and Cohere fallbacks. Failed or empty candidates fall through instead of discarding captured audio, simultaneous microphone/system speech cannot suppress the nondominant source, and retained stopped-session audio resumes after backend restart or a later STT model download.
- Gemma 4 E2B q4f16 text-only ONNX was the initial default Small local text tier; the October 5 chat refresh makes Qwen3.5 2B the default for fresh configurations. A downloaded-model smoke on this Mac passed for checksum verification, runtime probe, direct generation, and meeting summary generation through the shared backend. Legacy q2 mobile Gemma IDs are mapped to q4f16 because the current Node ONNX Runtime cannot initialize the q2 `GatherBlockQuantized` kernels.
- Apple SpeechAnalyzer has a backend bridge contract and Electron-side bridge client. The Swift helper reports availability, transcribes stopped raw recordings through a temporary WAV, and streams live Float32 audio into partial/final events with timestamps. Current macOS builds enable and bundle the helper alongside Whisper Tiny fallback; the fresh arm64 package reports Apple Speech available for `en_CA`, while permission-gated live transcription still needs explicit interactive QA.
- The Apple helper preheats `SpeechAnalyzer` before reporting stream readiness, moving its lazy model/audio setup out of the first transcript result. Local synthetic `en_CA` file and live stdin-stream smokes both produced a final transcript through the real helper after this change.
- Meeting page start/stop now calls the Electron Apple SpeechAnalyzer path when the backend selects `apple-speechanalyzer`.
- Meeting page consumes meeting SSE status/partial/final/error events, renders the latest live transcript snippets without adding a transcript panel, and shows the backend STT status inline when transcription is unavailable or starting.
- Meeting page now checks the Electron native recording runtime before starting capture and surfaces concrete native binding failures, such as missing ONNX Runtime dylibs, instead of only showing a generic recording setup error. Electron recording now repairs the local macOS dev runtime by linking already-bundled `libonnxruntime.1.17.1.dylib` and `libsherpa-onnx-c-api.dylib` next to `@nota/native` before loading it.
- The current native binary loads `ShareableContent` after that repair, so meeting audio capture can start on supported systems. The bundled Swift helper reports `SpeechTranscriber.isAvailable` for `en_CA` on this development Mac; Screen Recording and microphone permission flows still require explicit user-confirmed live validation. The helper uses the on-device `SpeechAnalyzer`/`SpeechTranscriber` path directly rather than the legacy `SFSpeechRecognizer` authorization flow.
- Model-agnostic capture architecture (2026-06-13, updated 2026-07-16): the mixed capture front-end (mix + AGC + sinc resample + Silero VAD + utterance segmentation) is `createMixedCaptureSttSession`, shared by local STT providers, with the model behind a small `UtteranceDecoder` backend. Native sherpa backends cover streaming Nemotron partials plus Parakeet, Whisper, Moonshine, Distil-Whisper, and Cohere whole-utterance finals; the legacy Nemotron JavaScript decoder is retired, and Apple SpeechAnalyzer uses its native system-locale bridge. Silero VAD loads independently and falls back visibly to energy gating when absent.
- Shared meeting capture pipeline (2026-10-05): `meeting-capture-pipeline.ts` replaces the old drain-aligned mixer with timestamped 100 ms windows, 100 ms single-source lookahead, 200 ms dual-source drift tolerance, per-source smoothed gain and mixed peak limiting. Native streaming decode continues through backlog; Nemotron finalizes after 500 ms silence, offline Parakeet/Whisper after 400 ms. Complete phrase context, the 15 s utterance bound and 600 ms pre-roll remain. Queue eviction is removed; exact stop tails drain and late-source duration is reported. Sparse restart gaps avoid large silent allocations. `meeting-vad.ts` follows Silero's 512+64-sample context contract and provisions a checksummed shared asset during STT downloads/seed preparation, with local migration and visible fallback during capture. Microphone AudioContexts explicitly resume. Acceptance-before-acknowledgement, retries, recording archives and workspace saves retain existing guarantees. Synthetic/mocked tests cover the shared engine and blocked-decoder HTTP acceptance; actual device latency, accuracy and cross-platform capture have not been measured in this change. Research and validation: [October 5 pipeline review](../../benchmarks/2026-10-05-meeting-pipeline-design.md).
- Historical capture pipeline (2026-06-13, superseded by the October 5 shared pipeline): the Nemotron live session now mixes mic + system into one mono 16 kHz stream via per-source drain-aligned queues (only summing windows where both sources align, with a 400ms lag fallback so a mic-only meeting still flows), applies a smoothed loudness AGC, and upgrades resampling from linear to windowed-sinc (Lanczos) to remove aliasing. The mixed stream is gated by Silero VAD into complete utterances, each decoded once with growing partials and a clean final on the ~800ms silence boundary; stop drains all trailing audio. This replaced GPT 5.5's parallel "stream + whole-chunk fallback" double-decode (which transcribed every utterance twice and relied on a fragile containment-merge dedup). The transcript is now a single timeline with no per-speaker attribution (chosen tradeoff). Verified on this Mac for the file path (clean) and mic-only live (two clean sentences split correctly at the pause); full live dual-source re-verification remains pending after the local ONNX runtime refactor.
- Historical legacy Nemotron decoder (2026-06-12, retired October 5): the encoder runs 8960-sample steps carrying `cache_last_channel`/`cache_last_time`/`cache_last_channel_len` between steps with a 9-frame mel pre-encode cache, and the greedy RNNT decoder LSTM state persists across the stream. Live meetings get growing `partial` transcript events per source while speaking plus a `final` segment when the bundled Silero VAD (threshold 0.3) detects ~1.1s of silence. This replaced the earlier single-step chunk decoder, which silently truncated every speech chunk to ~560ms and produced fragmentary transcripts. Three root-cause fixes landed together: `lang_id` now indexes the model's ordered language-token list (en-US = 24) instead of the raw vocab index, the mel filterbank is librosa slaney-scale/slaney-normalized to match the NeMo preprocessor, and the log guard is `2^-24`. Feature extraction uses a radix-2 FFT. Verified on this Mac: full-sentence file transcription through `/v1/audio/transcriptions` (9s WAV in ~2s) and live dual-source (mic+system) meeting streaming at ~5x real-time with word-by-word partials; Windows/Linux target-device validation remains.
- Nemotron live streaming no longer silently drops normalized audio frames when ONNX decoding falls behind. Meeting stop closes intake, drains queued frames, then finalizes active utterances, with backlog status surfaced through `queuedSpeechChunks`.
- Meeting Settings exposes native Parakeet TDT v3 INT8 and streaming Nemotron 3.5 INT8 alongside Whisper Tiny, Moonshine, Distil-Whisper, and Cohere. The legacy Nemotron option is retired. Native model downloads use pinned Hugging Face revisions and file checksums.
- Speech-language capability is explicit in the model registry and Settings: Parakeet, native Nemotron, and multilingual Whisper are automatic; Cohere uses shared Whisper language identification; Moonshine and Distil-Whisper are fixed English; Apple Speech uses the current system locale. Native Nemotron advertises its 32 out-of-box locales and stays in its built-in auto prompt mode. The current sherpa Node online result filters Nemotron's terminal language tag. Nota does not guess it with Whisper; detected-language metadata remains unknown until native tag exposure is supported.
- Meeting start supports automatic STT provider selection. Auto prefers native streaming Nemotron, then installed Parakeet, Tiny, and Moonshine on supported Mac/Windows/Linux runtimes. Apple SpeechAnalyzer remains manual-only. Available saved preferences retain precedence, unavailable preferences can fall back, and explicit requests fail clearly instead of silently selecting another model.
- Meeting Settings exposes Auto as the default STT provider. Explicit provider selections fail clearly when unavailable instead of silently falling back.
- MCP status endpoint can load configured MCP servers and report exposed tool names without starting a chat stream.
- AI Settings now also reports live MCP server/tool status from the backend and closes the temporary MCP clients after the status read.
- MCP tool loading now conservatively blocks suspected write-capable tools from autonomous chat execution and reports those blocked tools in AI Settings/status.
- Gated MCP write tools can run only through a durable `run_mcp_tool` action proposal and the Nota AI approval UI.
- Meeting page persists a workspace-scoped canonical-save job before the stop UI transition, then retries reported failures with capped backoff until finalized metadata, transcript, optional summary/recording attachments, search indexing, and backend `docId` linking all succeed. Jobs resume after reload and work for non-selected meetings; the visible Save action remains an explicit retry/open path. Persisted text/timing/source snapshots let missing or revised finals append as deterministic per-revision recovery blocks without replacing user-edited transcript content. Legacy ID-only watermarks recover conservatively instead of acknowledging unknown text.
- Meeting Markdown imports prepare in a disconnected workspace and publish only a complete Yjs update; recovery imports batch all missing segments into one preparation pass. Initial document load and local document/root-metadata persistence are awaited before search indexing and backend acknowledgement. IndexedDB `pushDocUpdate` waits for transaction completion before notifying observers or reporting success. Local load/write waits no longer depend on remote-sync emissions and reject on known lifecycle failures. Disconnected pending writes remain in memory and replay into a replacement YDoc before it reports loaded.
- Backend audio acceptance now fsyncs each normalized frame and its source/timing/retry identity before STT/VAD mutation or HTTP acknowledgement. The existing spool replays unfinished speech tails, deduplicates accepted IDs across restart, repairs only incomplete final records, and serializes stop behind in-flight acceptance. New intake rejects at 1 GiB or 250,000 frames per meeting rather than evicting accepted audio; fallback decoding remains windowed.
- Low-delay recognition conditioning uses independent bounded source gain, fast gain reduction on loud input and unity gain below the fixed floor. Source recordings/spool PCM remain intact and no new buffering is introduced. High-pass filtering is deferred after fixture recognition regressions. Synthetic signal checks and small Whistle/Whisper Tiny Q5 fixture comparisons pass; real meeting accuracy and device latency remain acceptance work. See the October 5 pipeline benchmark notes.
- September 13 failure-injection coverage includes backend SIGKILL before VAD completion, lost-response replay, partial append/fsync failure, concurrent duplicate intake and stop, failed staged imports, concurrent document edits, document disconnect/replacement and writer failure, and reload through real nbstore with fake IndexedDB. Packaged capture, target-device filesystem/power-loss behavior, cross-renderer save exclusion, strict Markdown image-asset failures, and persistence-engine recreation/recovery UX remain unverified or unfinished. Pending document writes are not disk-backed until storage commits. The meeting-session cache still uses atomic rename without fsync; retry identities do not survive successful acceptance-journal deletion.
- Canonical meeting save now treats workspace-search indexing as part of the durable job acknowledgement; an indexing failure leaves the idempotent save job queued for retry instead of silently dropping searchability.
- Meeting Settings save destination is wired: stopped meetings save as a new Nota document or append into today's journal, and both paths refresh workspace-content search indexing.
- Saved meeting documents are linked back to the backend meeting session via `docId`.
- Meeting sessions and transcript segments are persisted as a rebuildable local runtime cache under `.nota/meetings/sessions.json`; `GET /v1/meetings` lists cached sessions after backend restart. Workspace notes remain canonical meeting output.
- Stopped meetings are mirrored into the rebuildable workspace-content search index with transcript source metadata, and summary/doc id updates refresh that mirror. Automatic save creates the canonical editable Nota document.
- When automatic save patches the meeting with a real Nota doc id, the backend removes the old transient `meeting:<id>` mirror entry before upserting the saved doc mirror, avoiding duplicate search hits for the same meeting.
- The visible Meeting Summaries button still opens the existing Nota AI chat UI, and the streamed assistant summary is now stored back on the meeting runtime so the searchable meeting mirror includes it.
- Misleading auto-summary and auto-todo controls are removed from Meeting Settings. Those persisted fields remain scoped to legacy audio-attachment blocks; meeting summaries are explicit and reuse the canonical saved meeting note.
- Meeting Settings now focuses on recording and STT provider/model selection. Meeting summaries use the selected AI backend text model from AI Settings, with no separate meeting-specific or summary-specific model override.
- Meeting page live capture now posts microphone and system-audio frames at a shorter cadence for lower latency, keeps the meeting transcript layer high-contrast, and suppresses the global floating recording popup for recordings started from the Meetings page.
- The saved meeting note can attach separate verified portable Opus recordings derived from the native/system archive and the durable microphone spool. They remain separate source recordings rather than an inaccurately synthesized mixed track, and raw microphone recovery data is removed only after backend stop, both exports, and recording metadata are durable.

## Phase 1: Provider Health And Settings

1. Keep `/api/ai/settings` as the local control plane.
2. Add model health checks:
   - local text model reachable
   - local image model reachable
   - Gemma main AI model reachable
   - STT provider/model availability
3. Surface setup guidance in Settings when local models are missing.

Acceptance:

- Settings tells the user exactly why chat, note generation, image generation, or meeting transcription is unavailable.

## Phase 2: Workspace Semantic Search

1. Add local chunk extraction:
   - docs done through frontend Markdown export into the backend workspace-content mirror
   - full workspace sync is authoritative for the mirrored docs in that workspace, so deleted/trashed docs are removed from the mirror
   - Markdown tables/database docs now produce row-level chunks with `table-row:N` citations
   - stopped meeting notes/transcripts upsert directly when saved
   - selected attachments where text extraction exists
2. Add local embeddings:
   - default local embedding model when available done through AI Settings, Workspace Settings Embeddings, `NOTA_AI_EMBEDDING_MODEL`, or `all-minilm-l6-v2-embedding` (`Xenova/all-MiniLM-L6-v2` legacy settings map to it)
   - low-RAM mode done through `NOTA_AI_EMBEDDING_MODE=auto|semantic|fallback`, persisted AI settings, and the Settings UI
   - remote embedding model downloads disabled by default; opt in from AI Settings or `NOTA_AI_EMBEDDING_ALLOW_REMOTE=true`
   - hosted embedding remains out of the default path; local fallback ranking must always work without it
3. Store embeddings as rebuildable local cache done under `.nota/search/<embedding-model>-embeddings.json`; cache entries are keyed by chunk id and content hash, so changed chunks rebuild without changing canonical workspace data.
4. Add semantic search endpoint:

```text
POST /v1/workspace/search
```

5. Upgrade `search_nota_workspace` to use semantic ranking when the vector index exists. Current worktree uses local neural embeddings when the model can load, otherwise a local hashed-vector chunk index and lexical fallback.
6. Return citations in the AI answer. Current worktree now preloads likely workspace sources into chat context and preserves the source result object in assistant history; deeper guarantee work remains for permission-aware doc/database retrieval and source coverage evaluation.
7. Keep citation metadata structured. Current worktree returns `sourceRef`, `startLine`, `endLine`, and `citation.kind` for document lines, table rows, meeting transcripts, attachments, and web-style refs where available.

Acceptance:

- Ask AI can answer from notes and meeting transcripts with source references.
- Index deletion/rebuild does not lose canonical data.

## Phase 3: Real MCP Loading

1. Parse MCP JSON from AI Settings.
2. Load local MCP servers in the AI backend.
3. Convert MCP tools into AI SDK tools.
4. Merge MCP tools with built-in Nota tools.
5. Separate read tools from write tools.
   - current worktree conservatively exposes only likely read-only MCP tools
   - suspected write MCP tools are blocked from chat execution and reported in Settings/status
6. Require approval for write-capable tools.
   - current worktree supports `run_mcp_tool` action proposals
   - approved MCP write proposals execute through `POST /v1/agent/actions/proposals/:id/apply`

Acceptance:

- Enabled MCP servers appear in Settings/tool capabilities.
- Read-only MCP tools can be called by chat.
- Write tools require explicit user confirmation.

## Phase 4: Agent Actions

1. Add backend action proposals:
   - create note
   - insert markdown
   - replace selection
   - create mindmap
   - create task list
   - durable pending proposal persistence done under `.nota/agent-action-proposals.json`
2. Add frontend action preview UI. Current worktree shows pending actions on the Nota AI page.
3. Apply actions through existing editor/workspace transactions:
   - create-note/task-list done through MarkdownTransformer import
   - insert-markdown done through MarkdownTransformer block import
   - whole-document clear disabled until a restorable pre-edit snapshot and one-step undo are available
   - create-mindmap done by converting markdown lists into a surface mindmap element
   - create-database done by importing a table-backed Markdown document
   - replace-selection done through the existing BlockSuite editor replacement command when the target document is the active editor and has a current selection
4. Record action result:
   - proposal audit metadata done
   - chat message history annotation done for apply/reject/undo events when the proposal has a session id
5. Ensure undo works for editor actions:
   - standalone generated docs can be undone by moving the generated doc to trash
   - appended insert-markdown and in-doc task-list proposals can be undone by deleting the generated note block
   - create-mindmap proposals can be undone by deleting the generated surface element
   - replace-selection still relies on editor history; broader selection snapshots remain

Acceptance:

- AI can create and edit Nota content without bypassing the editor transaction model.
- User can review before destructive edits.

## Phase 5: Meeting Recording To STT, Phase 1

Goal: make recording real and show live transcription snippets in the meeting page without adding a transcript box.

This phase does not ship heavy local model runtime yet. It proves the app path:

```text
Electron audio capture
-> backend meeting session
-> provider lifecycle
-> partial/final transcript events
-> meeting page snippets
-> existing Nota AI summary context
```

1. Add meeting session runtime:
   - status
   - selected STT provider
   - transcript segments
   - current partial segment
   - source: `mic` or `system`
2. Upgrade meeting events:

```text
GET /v1/meetings/:id/events
```

Events:

```ts
type MeetingEvent = { type: 'status'; meeting: MeetingSession } | { type: 'partial'; segment: TranscriptSegment } | { type: 'final'; segment: TranscriptSegment } | { type: 'audio-level'; source: 'mic' | 'system'; level: number } | { type: 'error'; code: string; message: string };
```

3. Add the first usable STT path:
   - Mac: `apple-speechanalyzer` backend, Electron bridge, bundled Swift helper, meeting page start/stop wiring, and Apple -> ONNX automatic fallback done; helper status and synthetic file transcription pass on this Mac, while permission-gated live capture remains
   - Windows/Linux placeholder: clear unavailable state until ONNX provider streaming decoder is wired
4. Normalize live transcript snippets:
   - partial text updates one live line
   - final text becomes stable
   - dedupe repeated partials
   - keep timestamps
5. Frontend rendering:
   - keep artwork/date and recording buttons
   - render 3-5 live snippets in the empty middle space
   - show backend STT status/errors inline so recording never fails silently
   - no transcript card, no chat box, no second AI panel
6. Summaries:
   - Stop stores transcript segments for the session
   - Stop verifies complete transcript coverage against retained VAD chunks and retries uncovered speech through the meeting model plus installed fallback decoders
   - stopped sessions/transcript segments persist across backend restarts as local runtime cache
   - finalized transcripts save automatically after stop without requiring AI
   - the explicit Summary action runs the selected AI model and appends to the canonical meeting note
   - Summaries opens existing Nota AI with transcript context
   - automatic save creates a Nota document containing meeting metadata and transcript, or appends the same content into today's journal when that Meeting Settings destination is selected
   - automatic save persists an indefinite-retry job before the stop transition, updates the backend meeting session with the created `docId`, and lets the visible Save control retry or open that note
7. Model tier behavior:
   - show Small/Medium/Large in Settings
   - default to Small for broad-device compatibility
   - mark Medium/Large as planned until device health and runtime are wired
   - do not run llama.cpp/GGUF for meeting summaries
   - current worktree reports device fit status from `/v1/stt/models` and AI Settings
   - Meeting Settings now groups model/language controls in a responsive panel,
     with provider-specific preferences, fixed/automatic/system-language states,
     readiness, downloads and a separately labelled device RAM minimum
   - tested contextual language changes and failed saves with mocked services;
     local preview uses actual Settings primitives with a simulated backend
   - Apple device locale picker and speech asset provisioning, Whistle/Needle,
     and all five whisper.cpp Q5 sizes are integrated; target-device meeting
     acceptance and Windows/Linux native builds remain release validation

Acceptance:

- Start creates a session and live snippets appear while speaking.
- Stop ends the stream and keeps the transcript available for summary.
- Summaries uses the existing Nota AI route/backend.
- Save stores the meeting as editable Nota workspace content.

## Phase 6: Meeting Recording To STT, Phase 2

Goal: make the meeting pipeline production-ready, local-first, cross-platform, and saved as workspace content. The October 5 STT lineup above supersedes the earlier STT tier assignments.

1. Implement local model tiers:

```text
small:
  stt: Whistle starter; optional Whisper Tiny/Base Q5 and Apple Speech on supported Macs
  main AI/chat/summary: onnx-community/gemma-4-E2B-it-ONNX q4f16 text subset
  target: broad devices and low RAM
  selection: default

medium:
  stt: native Nemotron streaming or optional Whisper Small/Medium Q5
  main AI/chat/summary: onnx-community/gemma-4-E4B-it-ONNX q4f16 text subset
  target: 8-16 GB devices
  selection: only when device health reports enough RAM

large:
  stt: optional Whisper Large v3 Q5; native Nemotron remains the live choice
  main AI/chat/summary: Gemma 4 12B trusted ONNX package
  target: high-RAM devices
  selection: disabled until a trusted ONNX package is verified
```

2. Implement model download manager:
   - model registry endpoint done
   - download status/local path done
   - download progress events/status endpoint done
   - checksum validation support done
   - trusted per-file checksum population done for current ready ONNX/Xet-backed files
   - local model path storage status done
   - actual byte downloader done
3. Implement device health and tier selection:
   - RAM check done
   - OS/architecture check done
   - execution provider preference done
   - available disk check done
   - model status: `ready`, `planned`, or `blocked` done
   - explicit runtime probe endpoint done
   - remaining: Medium Gemma/Cohere target-device smoke and Windows/Linux target-device STT validation
4. Implement ONNX STT providers:
   - Native Nemotron streaming adapter done; legacy JavaScript/INT4 adapter retired October 5
   - Nemotron downloaded-model runtime smoke done on this Mac; Windows/Linux target-device smoke remains
   - Cohere provider emits final transcript snippets per VAD speech chunk and supports 16 kHz PCM file transcription; downloaded-model runtime smoke done on this Mac
5. Pick execution provider by platform:
   - Mac: CoreML then CPU
   - Windows: DirectML then CPU
   - Linux: CUDA then CPU
6. Store meeting output as workspace content:
   - transcript blocks
   - summary block
   - decisions
   - action items
   - meeting metadata
7. Index transcript content:
   - semantic search chunks
   - citations back to meeting note blocks
8. Route local summaries through the shared ONNX model tier:
   - default to Small
   - allow Medium/Large only when device health says they fit

Acceptance:

- Mac works with native STT first.
- Windows/Linux have a local ONNX STT path.
- Meeting notes are searchable, citeable, editable Nota content.
- Local chat, workspace answers, actions, and summaries use the selected local ONNX text model through the shared AI backend.
- Small/Medium/Large are the only exposed local AI tiers.
- Large is not auto-selected from an unofficial 12B ONNX upload.

## Non-Goals For V1

- Heavy diarization by speaker embedding.
- Hosted STT by default.
- Nota-managed cloud AI keys.
- A second agent runtime outside the AI SDK backend.
