# Nota Local AI Workspace Design

Updated: 2026-10-05

## Goal

Nota AI should match the useful parts of Notion AI while staying local-first:

- Answer from the user's workspace with source references.
- Use MCP and built-in tools through one AI SDK backend.
- Create and edit Nota workspace content with clear permission and approval boundaries.
- Capture meetings locally, transcribe them, summarize them, and save the results as workspace content.
- Prefer local models and user-owned credentials. Cloud chat uses user API keys only.

### Plug-And-Play Target

The core product is a local Notion-like workspace, local meeting capture and
transcription, and local workspace AI in one desktop app. After model setup,
these core flows must work offline without a subscription, API key, cloud
account, or separately installed model server. Optional hosted providers and
sync must not become hidden requirements.

Small downloads and fast answers are product requirements, but parameter count
alone does not choose the model. Measure cold startup, warm first-text latency,
memory under combined text/STT workloads, and factual output on the target
device. Keep the current default until a smaller candidate passes those checks.
Local inference avoids hosted usage charges; hardware, storage, downloads, and
model license obligations still exist.

## Product Boundaries

- Keep local storage canonical.
- Reuse Nota docs, blocks, blobs, indexes, and sync paths before adding new persistence.
- Keep one provider-routing strategy for general AI, meetings, and summaries.
- Do not add a second agent runtime. Tools attach to the AI SDK backend.
- Hosted providers are opt-in and configured by the user.

## Daily workspace product follow up

The October 5 product direction adds dependable local save recovery, consistent backups and offline page versions; deeper databases grouped with migration and import/export; optional user-owned Google Drive sync; and an animated welcome followed by independent setup choices. Writing must remain available before model downloads, recording permissions or Google authorization. Nota page links/backlinks connect workspace content, while website and GitHub links expose the public product and open-source project.

Implementation details, sequencing and release gates are in the [local workspace product plan](../plans/2026-10-05-nota-local-workspace-product-plan.md). These are agreed product requirements with proposed engineering steps, not claims of completed implementation. Existing local-first storage, shared AI runtime and explicit hosted-provider policies continue to govern the work.

## AI Runtime

The shared runtime is `packages/backend/ai`.

Text providers:

- `local`: managed ONNX models by default; optional discovered OpenAI-compatible local endpoint at `http://localhost:11434/v1`
- `openai`: user `OPENAI_API_KEY`
- `anthropic`: user `ANTHROPIC_API_KEY`
- `google`: user `GOOGLE_GENERATIVE_AI_API_KEY`
- Hosted provider keys can be entered in AI Settings and are persisted only to the gitignored local `.nota/ai-settings.json`; settings reads return `hasKeys` booleans, not raw keys.
- Gemini 3.7/3.8 Flash uses its supported low/medium/high thinking levels. Legacy none/minimal requests map to low; a none request still hides thought summaries.

Image providers:

- `local`: OpenAI-compatible local image endpoint
- `openai`: `gpt-image-1-mini` by default
- `google`: `imagen-4.0-fast-generate-001` by default

Local main AI models:

- Keep the local stack ONNX-first.
- Fresh local configurations default to `onnx-community/Qwen3.5-2B-ONNX` q4f16 text subset. Existing saved Gemma and hosted selections are preserved. Saved Qwen3 0.6B IDs migrate to Qwen3.5 0.8B, including saved chat selections.
- Offer curated models with per-model device fit:
  - Small: LiquidAI LFM2.5 230M q4, 350M q4f16 and 1.2B Instruct q4f16; Qwen3.5 0.8B q4f16; existing Gemma 4 E2B q4f16.
  - Medium: Qwen3.5 2B/4B q4f16; LiquidAI LFM2.5 2.6B q4f16; existing Gemma 4 E4B and SmolLM3 3B q4f16.
  - Large: trusted Gemma 4 12B ONNX remains planned, not a selectable or auto-selected package.
- Use the standard Qwen3.5 exports: their OPT variants require operators unavailable in the current Node ONNX Runtime. Download only text files, pin revisions, and verify every new model file with SHA-256.
- Report RAM and context per model. Model context limits are ceilings, not a guarantee that the full window fits a device. Count the templated prompt and bound output to the remaining context; keep the requested 12,000-token summary budget when it fits.
- Disable thinking for normal local answers where supported. LFM2.5 2.6B always reasons: give it a larger default output budget, display only its final answer, and report exhaustion if no final answer fits. Keep it optional because reasoning increases response latency.
- LiquidAI models use the custom LFM 1.0 license with a commercial revenue threshold; they are not Apache-licensed. Qwen remains Apache 2.0. See the [October 5 model benchmark report](../../benchmarks/2026-10-05-local-chat-models.md) for published scores, native measurements, and licensing details.
- Prefer ONNX Runtime / ONNX Runtime GenAI for these models. Do not add llama.cpp/GGUF as the core Nota meeting summary runtime.
- Keep model URLs in the model registry because Gemma 4 packaging is moving quickly.
- The same local ONNX runtime supports curated Qwen3.5, LiquidAI, Gemma 4 and SmolLM3 text models. Nota AI chat, note actions, workspace answers, meeting summaries, and note summaries use the selected backend text model through the shared AI runtime; there is no separate summary model setting or summary-only runtime. Embeddings remain MiniLM L6. Onboarding and arbitrary Hugging Face URL imports are separate future work.
- Every curated text model uses the same AI SDK chat/tool loop as hosted providers. The local adapter translates complete JSON and supported native tool-call formats into SDK function calls, preserves execution results and denials in model context, and leaves schema validation, workspace access and approvals to the shared executor. Incomplete calls and expressions cannot execute.
- Shared chat requests allow up to 12,000 output tokens per generation, matching the summary budget. Local inference caps this at the model's remaining context; it no longer silently uses the direct-generation helper's 512-token default for agent calls.
- Model size does not hide tools. AI Settings shows suitability guidance: compact models remain selectable but can fail or repeat tool calls; Qwen3.5 2B remains the balanced default. Tool availability follows the user's tool/MCP settings and permissions. Native function-call syntax support does not imply equal task reliability across models; see the [local tool smoke report](../../benchmarks/2026-10-05-local-chat-tools.md).
- The earlier Gemma 4 QAT mobile q2 ONNX packages are not selected by default because the current Node ONNX Runtime path cannot initialize their `GatherBlockQuantized` q2 kernels. Nota maps those legacy IDs to the q4f16 text subsets.
- AI Settings owns the main text model selection. Meeting Settings owns STT provider/model selection and recording behavior.
- Local model management is shared across text, STT, and embeddings. Use `/v1/local/models` for first-class local model health/download/probe APIs, while keeping `/v1/stt/models` as a backward-compatible alias for Meeting Settings.

Cloud chat:

- User API key only.
- No Nota-managed cloud inference key in local mode.
- Missing or failed local text models must not automatically select a hosted
  provider because its key is present. Automatic fallback stays inside the chosen
  provider; a different provider requires an explicit selection.

## Workspace Semantic Search

Target behavior:

- Search docs, blocks, attachments, meeting transcript docs, and indexed previews.
- Return ranked chunks with doc title, block id, snippet, score, and source reference.
- Generate answers with citations from retrieved chunks.
- Respect workspace/doc access rules.
- Store embeddings locally.
- Keep embeddings optional for low-RAM devices. Workspace search must keep a local fallback ranker that does not require loading a neural embedding model.

V1 implementation shape:

- Add a local `workspace_search` service behind the AI backend.
- Use existing local doc/index data when available.
- Keep a rebuildable local vector index. It is a cache, not canonical state.
- Default to the managed `all-minilm-l6-v2-embedding` local model, backed by `Xenova/all-MiniLM-L6-v2` files in the model registry.
- AI Settings owns embedding runtime/model controls. Workspace Settings exposes a focused Embeddings page for workspace search, routed to the same local backend settings on local workspaces.
- Embedding memory modes:
  - `auto`: use semantic embeddings only when free RAM is healthy, otherwise use fallback ranking
  - `semantic`: force the local embedding model when the user chooses it
  - `fallback`: never load the embedding model
- Unload idle embedding pipelines after use so semantic search does not keep a third local model resident while chat and meeting models are active.
- Mirror Nota docs and saved meeting transcripts into `.nota/search/workspace-content.json` through Markdown export/upsert; the mirror is rebuildable cache, not canonical state.
- Treat a full workspace-content sync as authoritative for that workspace mirror: remove mirrored docs that are no longer present, and avoid returning fallback search chunks when neither lexical nor strong fuzzy matching supports the query.
- AI index exports do not expand synced documents into their parent or inject
  other documents' titles. Each readable linked document is indexed separately
  under its own access decision and source reference.
- Expose targeted workspace-content deletion for trashed/deleted docs so search can drop stale mirrored content without a full rebuild.
- Parse Markdown tables into row-level chunks with `table-row:N` citations so table-backed database documents can be searched and cited at row granularity.
- Add attachment extraction later.
- Chat streaming performs a deterministic workspace-search preflight for likely workspace questions when search is enabled. The backend injects top results into model context, stores the result as a `search_nota_workspace` stream object, and appends a compact Sources section if the model answer does not include source markers itself.

Chunk contract:

```ts
interface WorkspaceSearchResult {
  id: string;
  workspaceId: string;
  docId: string;
  blockId?: string;
  startLine?: number;
  endLine?: number;
  title: string;
  snippet: string;
  score: number;
  source: 'doc' | 'transcript' | 'attachment' | 'web';
  sourceRef?: string;
  citation?: {
    ref: string;
    label: string;
    kind: 'document' | 'line-range' | 'table-row' | 'meeting-transcript' | 'attachment' | 'web';
    docId: string;
    blockId?: string;
    startLine?: number;
    endLine?: number;
    source: 'doc' | 'transcript' | 'attachment' | 'web';
    title: string;
    workspaceId: string;
    updatedAt?: string;
  };
  updatedAt?: string;
}
```

## MCP Integration

Target behavior:

- Settings can enable MCP and store local MCP JSON config.
- Backend loads configured MCP servers locally.
- MCP tools are merged with built-in Nota tools.
- Tool availability is visible in AI Settings.
- Tool calls are recorded in chat history.

Rules:

- MCP is local configuration.
- No MCP server should bypass Nota's provider policy.
- Write-capable MCP tools must be gated behind approval or explicit user action.
- The backend exposes only MCP tools that look read-only to autonomous chat.
- MCP tool clients are pooled by local config signature. Annotation-based `readOnlyHint` and `destructiveHint` values drive read/write classification first, with the existing write-name heuristic as a fallback.
- Suspected or annotated write MCP tools are reported as gated in Settings/status and can run only through a `run_mcp_tool` action proposal after explicit user approval.
- Built-in Nota tools stay available without MCP.
- Chat uses the AI SDK tool loop with a configurable 1–50 tool-round budget, defaulting to 50. When the budget is reached, one final generation runs with tools disabled so collected results can become an answer. Explicitly saved lower budgets remain configurable.
- Local and hosted chat share workspace context, target resolution, proposal events and final-response handling. Completed tool results survive a final-generation failure, and tool failures are streamed and stored as error results. A single fenced Markdown payload can still create a pending proposal when the model omits the proposal call; a real proposal is never duplicated. Whole-document clearing and ambiguous target edits remain unavailable under the existing workspace safety policy.

V1 built-in tools:

- `search_nota_workspace`: local workspace search over access-verified content explicitly mirrored by the renderer, with neural embeddings when the configured local embedding model is available plus local fallback ranking. Never scan Electron app data or arbitrary backend-root files as workspace content.
- `web_crawl`: fetch one public `http` or `https` page and return readable text
- `nota_shell`: read-only shell inspection inside the Nota repo root, disabled by default

## Agent Actions

Target behavior:

- Create a new note.
- Insert text into the current note.
- Replace selected text.
- Create a mindmap from generated markdown.
- Create a simple table-backed database document from generated markdown.
- Create/update blocks using existing editor transactions.
- Keep whole-document clearing disabled until the proposal can carry a restorable pre-edit snapshot and provide one-step undo.
- Apply edits with preview, approval, and undo.
- Create action lists from meetings and notes.

Rules:

- Backend can propose actions.
- Frontend applies actions through existing editor/workspace services.
- Selection replacement records a guarded editor-history undo point and refuses undo after newer edits; it does not promise restart-durable undo while editor history is gone.
- Dangerous writes require user approval.
- Every write must be undoable through existing editor history where possible.
- Treat interrupted or ambiguous writes as review-required and non-retryable. Only failures proven to occur before mutation may offer Retry.
- Approved proposals remain resumable through the atomic apply claim; stale applying claims become review-required failures instead of staying stuck.
- Undo claims atomically transition `applied -> undoing` before any renderer mutates local content. Completion records `undone`; a refused local undo returns to `applied`. Stale or restart-interrupted undo claims recover conservatively to `applied`, where exact fingerprints/history tokens make retry safe.
- Actions that create standalone documents carry undo metadata. Undo moves the generated document to trash and marks the proposal `undone`.
- Actions that append generated Markdown into an existing document carry inserted block metadata. Undo deletes that inserted note block and marks the proposal `undone`.
- Actions that create a mindmap in an existing document carry surface element metadata. Undo deletes that generated mindmap element and marks the proposal `undone`.
- Actions that append database rows carry deterministic fingerprints for every AI-created row and column. Undo removes only those targets and refuses the whole operation if any target was edited, reordered, or removed afterward.

Action proposal contract:

```ts
type AgentActionProposal =
  | {
      type: 'create_note';
      title: string;
      markdown: string;
    }
  | {
      type: 'insert_markdown';
      docId: string;
      markdown: string;
      position?: 'start' | 'end' | 'selection';
    }
  | {
      type: 'replace_selection';
      docId: string;
      markdown: string;
    }
  | {
      type: 'clear_doc';
      docId: string;
    }
  | {
      type: 'create_mindmap';
      docId: string;
      markdown: string;
    }
  | {
      type: 'create_database';
      title: string;
      markdown: string;
    }
  | {
      type: 'create_task_list';
      title: string;
      markdown: string;
      docId?: string;
    }
  | {
      type: 'run_mcp_tool';
      toolName: string;
      args: unknown;
    };
```

`clear_doc` remains a reserved contract variant for historical proposal records, but new clear proposals and frontend application are disabled until safe restoration is implemented.

## Meeting Backend

Pipeline:

```text
Audio capture
-> resample to 16k mono PCM
-> durable local frame acceptance
-> VAD / silence detection
-> STT provider
-> transcript segment normalizer
-> meeting timeline
-> summary / chat
-> save as Nota workspace content
```

Meeting session/runtime cache:

- Persist backend meeting sessions and transcript segments in `.nota/meetings/sessions.json` for restart recovery.
- Treat that file as rebuildable local runtime cache only. Editable Nota workspace documents remain the canonical meeting output.
- When a meeting stops, mirror meeting metadata, transcript, and later summary into the rebuildable workspace search mirror as `source: 'transcript'`. This makes unsaved stopped meetings searchable immediately, while saved Nota documents remain the canonical editable meeting output.
- When a saved Nota document id replaces a transient `meeting:<id>` mirror id, remove the transient mirror entry to avoid duplicate meeting search results.
- Reserve and persist the backend meeting id before native capture begins. The Electron main process must fsync capture ownership before opening the audio tap, append the real audio format and terminal state to that journal, and rehydrate recoverable raw recordings after a hard restart without depending on the old in-memory native session.
- The backend appends and fsyncs normalized audio frames, source/timing metadata, and retry IDs in the existing fallback spool before acknowledging intake or mutating live STT/VAD state. Recovery includes unfinished speech tails and deduplicates retried frame IDs across backend restarts. Stop closes intake and waits for in-flight acceptance before finalization. Incomplete final spool records are repairable; complete corrupt metadata fails visibly. New intake is capped at 1 GiB or 250,000 frames per meeting and rejected at the limit, never silently evicted. This is auxiliary recovery storage, not a second canonical meeting database.

Meeting settings behavior:

- Passive permission refreshes must not open OS consent dialogs. macOS
  functional system-audio checks use the native system-only probe, never a
  microphone-activating fallback. Incompatible native bindings fail visibly.
  Calendar consent is single-flight and remains pending after a caller timeout
  until native completion or a confirmed idle state. Windows reports actual
  microphone preflight status; live microphone acquisition can resolve an
  inconclusive status, but cannot override explicit denial or restriction.
- After meeting transcription finalizes, Nota automatically saves the canonical transcript to the configured workspace destination without requiring an AI model.
- When the user opens Summaries through Nota AI chat, the generated assistant summary is stored back on the meeting runtime and refreshes the searchable transcript mirror.
- The explicit meeting Summary action uses the selected AI model and appends to the already-saved meeting note instead of creating a duplicate document.
- Meeting save destination supports either a new Nota document or appending the meeting block into today's journal document. Both paths keep the backend meeting `docId` link and refresh the workspace-content search index; the visible Save control is the recovery retry/open action.
- The persisted `autoTranscriptionSummary` and `autoTranscriptionTodo` flags remain legacy preferences for audio-attachment blocks and are not presented as meeting-stop automation.
- Meeting summary generation uses the selected AI backend text model from AI Settings; Meeting Settings does not own a separate summary model.
- Meeting stop compares finalized transcript timestamps with every retained VAD speech chunk, scoped by capture source so simultaneous microphone and system speech cannot suppress each other. Timestamp coverage requires positive overlap as well as the existing boundary tolerance; nearby or zero-duration finals cannot suppress short speech. It retries uncovered and partially covered speech with the selected meeting model, then falls through installed Whisper Tiny, Moonshine, Distil-Whisper, and Cohere decoders. This is a timestamp heuristic, not proof of word-level transcription accuracy. Stopped-session recovery resumes after backend restart or model download.
- Canonical workspace saving is a persisted, workspace-scoped job created before the stop UI transition. It retries with capped backoff after reported failures and is removed only after the note, transcript, optional summary/recording attachments, search mirror, and backend `docId` link succeed. Markdown imports are prepared in a disconnected workspace and publish as one complete document update; recovered segments share one preparation batch. Saving waits for initial document loading and local document/root-metadata writes before indexing or acknowledging the backend watermark, without waiting for remote sync.
- Saved transcript snapshots track text, timing, and source, not only segment IDs. Missing or revised final segments append as deterministic per-revision recovery blocks without rewriting user-edited transcript content. The backend acknowledges the exact submitted snapshot, not newer live text. Legacy ID-only watermarks conservatively recover finals once rather than assume which content reached the note.
- Local document load/persistence waits reject on engine stop/failure or interruption by document disconnect instead of acknowledging dropped work or waiting forever after a known failure. Pending writes survive disconnect in memory and replay into a replacement document on same-process reconnect. This is not disk-backed recovery for unsaved document writes; recreating a failed engine and explicit recovery UX remain unfinished.
- Automated tests cover forced backend process termination before VAD completion, lost-response replay, write/fsync failures, concurrent stop, staged-import failures/concurrent edits, document disconnect/reconnect and writer failure, and local IndexedDB reload after save acknowledgement. They do not establish power-loss guarantees, packaged/live microphone behavior, or cross-renderer save exclusivity. Meeting-session cache writes still use atomic rename without fsync, and audio retry identities last only while the acceptance journal is retained. Markdown image adapters can still swallow asset-import failures; complete text-block staging does not establish strict image durability.
- The note can attach separate verified portable Opus exports for native/system audio and microphone audio. Nota does not present them as a fake mixed recording; the microphone recovery spool remains durable until the backend stop, both exports, and recording-metadata update succeed.
- Native recovery ownership is released only after portable publication and the backend recording-metadata update are durable. Restart recovery is idempotent across begin-before-format, stopped-before-export, export-before-metadata, and lost-start-response crash windows.

Provider order:

Meeting Settings defaults to `auto`. Auto mode chooses the first available provider for the current platform. If the user explicitly selects a provider, meeting start fails clearly when that provider is unavailable instead of silently falling back.

Desktop auto mode (updated October 5, 2026):

```text
Whistle/Needle starter on supported hardware
fallback -> native Nemotron 3.5 -> installed Whisper Q5 Small/Base/Tiny/Medium/Large v3
fallback -> installed Parakeet TDT v3 -> native Whisper Tiny -> Moonshine -> optional offline models
```

Available saved provider preferences remain authoritative. Auto skips models
that cannot honor an explicit saved language. Apple SpeechAnalyzer is a manual
choice on compatible Macs, with actual device locale discovery and an explicit
language-pack download action. Meetings snapshot the selected locale; Auto uses
the supported Mac system locale. Missing packs block Apple start with setup
instructions. Optional default seed resources are Whistle and Whisper Tiny Q5,
about 47 MiB combined; larger models remain optional downloads.

Approved model lineup, October 5, 2026:

| Choice                                          | Runtime                       | Role and integration state                                                                                                                         |
| ----------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cactus Whistle                                  | Cactus Needle                 | Integrated seven-language starter; phrase-final text, no native partials. Pinned model/runtime with checksums and Apache-2.0 license.              |
| Whisper Tiny, Base, Small, Medium, Large v3     | whisper.cpp Q5                | Integrated optional multilingual size choices, with 99 languages (100 for Large v3). Phrase finals; Tiny/Base/Small Q5_1 and Medium/Large v3 Q5_0. |
| Nemotron 3.5 streaming 0.6B, 560 ms INT8 export | Native sherpa-onnx            | Integrated multilingual streaming choice, 32 ready locales. Legacy JavaScript adapter and INT4 catalog are retired.                                |
| Apple SpeechAnalyzer                            | Native Apple Speech framework | Integrated manual option with device locale picker, installed-pack readiness and explicit provisioning. Requires compatible macOS 26 hardware.     |

Whistle is Auto's starter where its runtime is supported. Explicit selections remain authoritative. Model packages are optional
downloads, and disk size must not be presented as measured RAM. Load the selected
ASR runtime and release the previous one on a model switch; do not run every
decoder over each phrase. Keep MiniLM embeddings unchanged.

When language routing is added, use a user's selected language and verified model
capabilities. Choose Whistle for a compatible language, native Nemotron for a
supported alternative, or an installed multilingual Whisper package. Do not
guess unsupported speech from poor text or load Whisper solely to label
Nemotron output. Live Whistle partials need proof for Whistle itself.

Retirement preserves existing downloads and saved meeting provenance. Legacy
settings migrate to native Nemotron; old meetings retain their original provider
and model IDs while retained-audio recovery uses the current native decoder.

The pinned sherpa Node runtime is 1.13.8. Current Mac/Windows release targets are
macOS arm64 and Windows x64. Intel Mac remains gated by the separate
`onnxruntime-node` dependency; Windows arm64 remains gated because sherpa has no
Node binding for that architecture. Linux STT routing exists, but this does not
establish packaged desktop capture support there, even though Linux x64 has a
release build job.

STT provider API:

```ts
interface SttProvider {
  id: string;
  name: string;
  capabilities(): SttCapabilities;
  start(session: SttSessionConfig): Promise<void>;
  pushAudio(frame: AudioFrame): Promise<void>;
  stop(): Promise<void>;
}
```

Local model tiers:

```text
small:
  stt: nemotron-sherpa on supported desktop targets, bundled whisper-tiny-en-onnx-q4 for lightweight fallback
  main AI/chat/summary: gemma-4-e2b-it-onnx-q4f16
  target: broad devices, low RAM, default local main AI model

medium:
  stt: parakeet-sherpa accurate fast finals or nemotron-sherpa live partials, optional moonshine-base-onnx-q4 or cohere-onnx chunked live finals / post-meeting
  main AI/chat/summary: gemma-4-e4b-it-onnx-q4f16
  target: stronger summaries on 8-16 GB devices

large:
  stt: parakeet-sherpa accurate fast finals or nemotron-sherpa live partials, distil-whisper-large-v3-5-onnx-q4 or cohere-onnx chunked post-meeting accuracy
  main AI/chat/summary: gemma-4-12b-trusted-onnx
  target: high-RAM devices, best local AI quality, disabled until trusted ONNX package is verified
```

Transcript events:

```ts
type TranscriptEvent =
  | {
      type: 'partial';
      text: string;
      startMs: number;
      endMs: number;
      source: 'mic' | 'system';
    }
  | {
      type: 'final';
      text: string;
      startMs: number;
      endMs: number;
      source: 'mic' | 'system';
    }
  | { type: 'error'; code: string; message: string };
```

App APIs:

```text
GET  /v1/stt/providers
POST /v1/stt/models/:id/download
GET  /v1/meetings
POST /v1/meetings/start
POST /v1/meetings/:id/stop
WS   /v1/meetings/:id/events
POST /v1/audio/transcriptions
POST /v1/meetings/:id/summary
```

Also expose OpenAI-style file transcription:

```text
POST /v1/audio/transcriptions
```

## STT Providers

Meeting Settings groups the model and language controls in one responsive panel.
Language controls reflect the selected provider's current integration: native
Nemotron offers Auto and supported preferred locales; fixed-language models show
their language; multilingual automatic models show detection and concrete
coverage when available; Apple shows the Mac system language. Auto follows its
resolved model. Switching away from Nemotron resets any saved preference to Auto.
Model choices and the selected-model detail show readiness, caption behavior,
download size/status and device RAM minimum. The RAM minimum is a device
requirement, not measured runtime memory. Apple locale selection/provisioning and
the Whistle and Whisper Q5 adapters remain pending; unimplemented models are not
advertised as working choices.

`apple-speechanalyzer`

- macOS/iOS only
- no app-managed model download
- low RAM
- uses the current system locale; do not label it automatic language detection
- manual-only system-language option; excluded from macOS Auto mode
- API: SpeechAnalyzer, SpeechTranscriber, AssetInventory
- preheat the analyzer in its expected audio format before reporting stream readiness so the first spoken phrase does not pay the lazy model-load cost

`nemotron-sherpa`

- cross-platform native streaming default on supported Mac/Windows/Linux runtimes
- official `sherpa-onnx-node` transducer runtime; Nota does not run mel extraction or the RNNT token loop in JavaScript
- built-in `auto` prompt transcribes 32 out-of-box language-locales (19 transcription-ready plus 13 broad-coverage); eight additional tokenizer locales require fine-tuning and are not advertised as ready
- Auto remains the default; an explicit native Nemotron selection also exposes
  supported preferred locales in Meeting Settings. The locale is snapshotted
  when reserving a meeting, persisted for recovery, and applied to every new
  utterance stream. Other providers require Auto language; the UI resets the
  setting visibly when switching providers. Explicit-language recovery does not
  silently fall through to a decoder that ignores that preference.
- Nemotron alone handles Auto transcription and explicit language prompts. Do not
  load Whisper for Nemotron language metadata. The current sherpa Node binding
  filters native language tags; detected-language metadata remains unknown until
  the binding exposes the model's own tag. Requested locale is not detection.
- streams growing partials and emits a final transcript at the utterance boundary
- model: `csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11`

`parakeet-sherpa`

- optional multilingual phrase-final model; no longer the macOS Auto default
- official `sherpa-onnx-node` offline transducer runtime, decoded per VAD-cut utterance
- emits the final transcript after 400 ms of post-speech silence; it does not fabricate token partials for an offline model
- model: `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`

Shared native capture pipeline

- Shared live capture: mic and system audio are downmixed/resampled to 16 kHz mono, aligned by capture timestamps in 100 ms windows, normalized per source, peak-limited, and gated by shared Silero VAD into complete utterances. Single-source lookahead is 100 ms; dual-source drift tolerance is 200 ms. Late audio is reported instead of shifted into future speech.
- The recognition copy uses independent 0.5–12× source gain with fast reduction for loud input/peaks. Signals below the fixed gain floor use unity gain. Conditioning adds no buffering or tail samples and leaves accepted spool PCM and source recordings intact. High-pass filter candidates caused fixture recognition regressions, so frequency filtering is deferred. This is not general noise suppression or proof of improved meeting accuracy.
- Native Nemotron carries its streaming state between model chunks, emits growing partials and finalizes after 500 ms silence. Native decoding continues through backlog; the 100 ms capture window does not change the model's intrinsic 560 ms encoder chunk.
- audio front-end uses a windowed-sinc (Lanczos) resampler instead of linear interpolation to avoid aliasing that degrades ASR accuracy
- Native Nemotron, Parakeet, Whisper, Moonshine, Distil-Whisper, and Cohere use the same capture engine. Offline decoders receive complete phrases, retain their 400 ms endpoint, and do not fabricate partials. The 15-second bound and 600 ms pre-roll remain.
- Silero is a small checksummed shared asset, provisioned with native STT downloads/seeds and migrated from existing installed copies without downloading during capture. Its input carries 512 new samples plus 64 samples of context and recurrent state. Missing/failed VAD is visible as energy fallback.
- Microphone setup and activation resume suspended AudioContexts. Live diagnostics include source wait, VAD mode, queued/late audio and final decode time. Synthetic/mocked tests validate these changes; real-device speed, quiet speech and cross-platform capture remain unmeasured. See [October 5 pipeline review](../../benchmarks/2026-10-05-meeting-pipeline-design.md).
- On stop, queued and trailing audio drains. Retained audio is checked against transcript timestamps and uncovered speech is retried with installed recovery models. This coverage heuristic is not word-level accuracy proof.

`cohere-onnx`

- optional 14-language accuracy model through native `sherpa-onnx-node`
- a shared multilingual Whisper Tiny language-ID pass selects Cohere's required language code per utterance
- emits final snippets per VAD speech chunk when selected for a live meeting
- also supports post-meeting/high-quality transcription
- measured slower than realtime on the development Mac, so it is not an Auto/live default
- model: `csukuangfj2/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01`

`distil-whisper-large-v3-5-onnx`

- optional higher-accuracy English model
- native sherpa-onnx Whisper decoder, fixed to English because the model is English-only
- emits final snippets per VAD speech chunk when selected for a live meeting
- also supports post-meeting transcription
- model: `csukuangfj/sherpa-onnx-whisper-distil-large-v3.5`

`moonshine-base-onnx`

- optional fast English model
- native sherpa-onnx Moonshine v2 decoder, fixed to English
- emits final snippets per VAD speech chunk when selected for a live meeting
- model: `csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27`

`whisper-tiny-en-onnx` (compatibility provider id)

- optional fastest small multilingual fallback through native sherpa-onnx
- automatically detects the spoken language and returns the language code with each final transcript
- emits final snippets per VAD speech chunk when selected for a live meeting
- model: `csukuangfj/sherpa-onnx-whisper-tiny`

## Execution Providers

Mac:

1. Native sherpa-onnx CPU runtime for Parakeet, Nemotron, Whisper, Moonshine, Distil-Whisper, and Cohere
2. Apple SpeechAnalyzer for platform-native STT
3. Planned Cactus and whisper.cpp backends use their own execution providers; verify each target package independently.

Windows/Linux:

1. Native sherpa-onnx CPU runtime for current ASR models
2. Planned Cactus and whisper.cpp backends after target-package validation

The standalone ONNX VAD session uses the existing ONNX Runtime execution-provider fallback. Removing legacy Nemotron does not remove ONNX Runtime from text, embedding or speech detection.

## Model Registry

Every downloadable local model has a manifest:

```json
{
  "id": "whisper-tiny-en-onnx-q4",
  "type": "stt",
  "runtime": "sherpa-onnx",
  "sherpaKind": "whisper-offline",
  "downloadUrl": "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny",
  "sha256": "",
  "sizeMb": 99,
  "streaming": false,
  "languages": ["multilingual"],
  "languageDetection": "automatic",
  "license": "mit",
  "minRamGb": 2
}
```

Speaker detection V1:

- The default Nemotron live path mixes mic and system audio into one stream before transcription (Meetily-style), producing a single transcript timeline without per-speaker attribution. This was chosen for robust capture; reintroducing `mic = You` / `system = Others` labels would require decoding the two sources separately again.
- Do not add heavy diarization in the default pipeline.

## Sources

- Apple SpeechAnalyzer: https://developer.apple.com/documentation/speech/speechanalyzer
- Apple AssetInventory: https://developer.apple.com/documentation/speech/assetinventory
- Native Nemotron package: https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11
- Whisper.cpp: https://github.com/ggml-org/whisper.cpp
- Cactus: https://github.com/cactus-compute/cactus
- Cohere Transcribe sherpa-onnx: https://huggingface.co/csukuangfj2/sherpa-onnx-cohere-transcribe-14-lang-int8-2026-04-01
- Distil-Whisper Large v3.5 sherpa-onnx: https://huggingface.co/csukuangfj/sherpa-onnx-whisper-distil-large-v3.5
- Moonshine Base v2 sherpa-onnx: https://huggingface.co/csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27
- Whisper Tiny multilingual sherpa-onnx: https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny
- Parakeet TDT 0.6B v3 ONNX: https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx
- Gemma 4 E2B ONNX: https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX
- Gemma 4 E4B ONNX: https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX
- ONNX Runtime Execution Providers: https://onnxruntime.ai/docs/execution-providers/
- Gemma 4 12B: https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12B/
