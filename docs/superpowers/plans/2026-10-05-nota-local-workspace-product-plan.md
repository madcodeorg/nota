# Nota local workspace product plan

Date: 2026-10-05

Status: Product requirements agreed in the October 5 discussion. Local database and storage implementation is underway in the current worktree. The implementation record below distinguishes automated validation from packaged release acceptance; other workstreams remain planned.

Nota should become a dependable local workspace for writing, connected knowledge, databases, and meeting notes. The next releases should protect the user's work, make content portable, deepen databases, and provide a polished first-use experience. Local AI and optional user-owned Google Drive sync should support that workspace without becoming prerequisites for writing.

This is the detailed product follow-up to the [local AI workspace design](../specs/2026-04-19-nota-local-ai-workspace-design.md) and [implementation plan](2026-04-19-nota-local-ai-workspace.md). Existing working code takes precedence over descriptions of older implementations. This plan does not mark any new capability as shipped.

## Product decisions

- Local documents and attachments remain canonical in the existing `nbstore`, SQLite, IndexedDB, and Yjs paths.
- Google Drive is the user's optional sync choice. No Google account is required to create, edit, search, import, export, or recover a local workspace.
- Database features, migration, import/export, and related daily workflows form one workstream. Each new property or view must survive the supported native export/import path.
- Onboarding begins with an animated browser-inspired welcome, then becomes a simple setup box with independent choices. Dia and the user's second browser reference guide the visual discovery stage; the final motion direction will use Nota's own identity.
- The setup box offers local AI, meeting transcription, optional Drive sync, and content import. Users can start working immediately and finish optional setup later.
- Nota page links and backlinks remain the foundation of connected knowledge. GitHub links identify the open-source project and its contribution/issue destinations; they do not introduce a GitHub account requirement.
- The public Nota website, documentation, and GitHub links must use verified current destinations. Existing website references are inconsistent, so the public website domain is a link-audit task rather than an assumed broker URL.
- Use one AI/provider policy. A local model failure must not silently send workspace content to a hosted provider.
- Reuse current editor transactions, storage contracts, templates, search, settings, and animation tools. Add a narrow extension only where an existing path cannot carry the required behavior.

## Current foundation and gaps

| Area            | Existing foundation                                                                                    | Work still needed                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Workspace       | Rich documents, whiteboards, folders, collections, tags, journals, templates, page links and backlinks | Complete daily workflows and packaged offline acceptance                                                   |
| Databases       | Table and Kanban with typed properties, filters, sorting, grouping and statistics                      | Relations, formulas, rollups, Calendar, Gallery, and serialization of every supported property             |
| Local storage   | SQLite/IndexedDB documents and blobs; persistence waits reject known failures                          | Safe writer recovery, clear unsaved states, consistent backups, offline page versions                      |
| Portability     | Existing Notion HTML ZIP, Markdown, HTML, DOCX and snapshot paths; manual SQLite backup                | CSV/database coverage, asset/link fidelity, loss reporting, fresh-workspace round trips                    |
| Drive           | Storage adapters, workspace flavour, secure Google session integration                                 | Worker registration, offline workspace discovery, safe conversion, pagination and multi-device convergence |
| Setup           | Animated onboarding route, model health/download APIs and settings                                     | A concise introduction and resumable setup box connected to actual readiness                               |
| AI and meetings | Local text/STT, cited workspace search, reviewed actions, recovery spool and saved meeting notes       | Long-content quality, precise attribution, first-use consistency and real-device release acceptance        |

## Delivery order

| Milestone | Deliverable                                                                | Depends on                                                                                  | Release condition                                                                 |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| M0        | Baseline fixtures, link audit and one declared starter configuration       | Current source inspection                                                                   | Current behavior and package defaults are recorded                                |
| M1        | Reliable local saving, consistent backup, restore and offline page history | M0                                                                                          | A saved note and its attachments reopen and recover offline                       |
| M2        | Shared data tools, import/export reports and reliable content round trips  | M1                                                                                          | Existing databases, pages, assets and links survive export into a fresh workspace |
| M3        | Optional Drive sync                                                        | M1 and validated stable content identities; unrelated import/export formats do not block it | Two devices converge while local use survives auth/network failure                |
| M4        | Relations, formulas, rollups, Calendar and Gallery                         | M2                                                                                          | Each addition passes editing, history and native round-trip checks                |
| M5        | Animated welcome, setup box and useful local starter workflows             | M1 and readiness APIs for choices actually shipped; advanced templates follow M4            | Fresh offline users can start writing and resume setup later                      |
| M6        | Long-content AI and packaged meeting/release acceptance                    | M1 plus the shipped starter configuration                                                   | The complete local workflow passes on declared target devices                     |

Implementation can overlap where ownership is separate. Onboarding storyboards can begin during M1; Drive wiring can proceed after storage recovery is stable; long-content evaluation can run while databases develop. A release must pass its prerequisites even when implementation proceeds in parallel. Do not attach calendar dates until the M0 spikes establish the native backup and restore scope.

## Workstream 1 Local data protection and recovery

### P1 Visible persistence state and safe retry

1. Trace the existing `DocFrontend` failure, disconnect, stop, and close paths. Separate local persistence from remote synchronization.
2. Expose a small state model: Saving, Saved on this device, Changes not saved, and Recovering. Display a persistent failure message with Retry and an option to export the current in-memory content.
3. Add a single-flight recovery operation around the failed local writer. Preserve live YDocs and pending updates; retry must not discard editor state or falsely acknowledge an unsuccessful write.
4. Let waiters for the failed attempt reject. A recovered writer gets a new lifecycle and acknowledges only its successfully committed work.
5. Flush pending document/root-metadata writes during normal close. When flushing fails, preserve the visible unsaved state and offer a recovery export. A forced process kill cannot run a close dialog; measure that window separately.
6. Test edits made during retry, multiple open windows, disconnect/reconnect, disk-full and permission errors. Start with recovery inside the current storage architecture rather than rebuilding the editor or adding another canonical journal.

Acceptance: a failed save stays visible; correcting the simulated failure and retrying persists all affected content; acknowledged writes survive restart; pending edits remain recoverable while the process is alive. Add restart-durable intake only if measured hard-crash tests show an unacceptable pre-commit window, using the existing native update storage path with idempotent identities. Do not claim a journal on a failed disk guarantees recovery.

### P2 Consistent workspace backup and safe restore

1. Run a bounded native compatibility spike. Nota exposes checkpoint and per-document snapshots, but currently has no complete consistent-backup operation.
2. Add one narrow native workspace-backup API, using a supported SQLite live-backup method. Evaluate the Online Backup API first; use an alternative such as `VACUUM INTO` only after checking the packaged SQLx/SQLite runtime. Avoid a general SQL endpoint.
3. Flush known renderer writes and take a coherent database snapshot under concurrent WAL activity. Include committed documents, updates, root metadata, and canonical attachment blobs together.
4. Write to a temporary destination. Check SQLite integrity and schema compatibility, open representative documents, verify referenced blobs, and sync/publish the finished output. A cancelled or failed attempt must leave the last valid backup intact.
5. Route Back up now and full-workspace export through this primitive. Separate exact recovery backups from readable Markdown/HTML/CSV exports in the shared data tools interface.
6. Extend existing backup settings with a user-selected destination, automatic backups, last verified success/error, and bounded retention. Proposed initial behavior is one backup per changed workspace per day while the app is running, retaining seven daily backups; validate storage cost and expose controls before shipping.
7. Prune old backups only after a new one validates. Clarify that a backup on the same disk protects against some mistakes, while a user-selected external location can protect against losing that disk. Drive sync and rotating backup have different recovery purposes.
8. Restore first into a new workspace through the existing import path. Validate the restored workspace before publishing it. Keep the original available; replacement in place can follow only with a verified pre-restore backup and explicit user choice.

Acceptance: backups made during editing and attachment writes restore correctly into a fresh workspace; corruption, cancellation and insufficient disk space fail clearly; retained backups contain usable media. For Drive workspaces, missing uncached attachments require an explicit fetch or an incomplete-backup report. Do not label a partial export complete.

### P3 Offline page version history

1. Reuse the `HistoricalDocStorage` list/get/rollback contract and the current history interface. Add history records to the existing SQLite schema and implement equivalent IndexedDB history through its schema migration path.
2. Capture bounded, self-contained versions after successful writes and before supported bulk/destructive operations. Use an idle cadence and content hashes to avoid duplicate versions; establish the storage budget in the prototype.
3. Retain document metadata and blobs referenced by retained versions. History pruning and blob cleanup must agree, so old pages still display their images and attachments.
4. Decode each version into an isolated document for preview. A Yjs state vector is not a complete backup, and merging an older update into the current document does not undo newer edits.
5. Restore supported content through a tested editor/workspace transaction as a new recorded change. Save the current version first, coordinate multiple windows, and refuse a stale restore if newer edits invalidate the preview. Provide Restore as a new page where safe in-place restoration is not yet supported.
6. Wire local and cached Drive workspaces to offline history instead of the existing cloud-enablement prompt. Keep the separate disabled AI `clear_doc` contract disabled; page recovery does not automatically make destructive AI clearing safe.

Acceptance: history previews and restores survive restart without login or network; text, databases, canvas content and attachments are preserved for supported versions; restoring leaves a path back to the previous current state; retention remains bounded.

Primary modules: `packages/common/nbstore/src/frontend/doc.ts`, `packages/common/nbstore/src/storage/history.ts`, SQLite/IndexedDB implementations, `packages/frontend/native/nbstore/src/`, Electron dialog/workspace helpers, `modules/backup/`, and the existing page-history modal/header menu.

## Workstream 2 Databases content portability and everyday workflows

### D1 One data tools experience and explicit compatibility

1. Provide one Import and export dialog with scope choices for the workspace, selected pages, or a database. Existing page menus and workspace settings should open the same service/dialog; they should not implement separate conversion rules.
2. Include Backup and Restore entry points that call P2. Explain the distinction in the UI: readable export for other apps, native export for Nota fidelity, and backup for workspace recovery.
3. Define a small capability matrix and conversion report: documents/rows/assets processed, downgraded fields, unsupported formulas/views, missing attachments, and unresolved links.
4. Extend the existing BlockSuite adapters and versioned native snapshot format. Preserve unknown native property/view metadata for later recovery. Do not create another editable canonical database or universal migration framework.
5. Use the existing stable document, database-block, row-block, and column identities. Extend duplication/template/import ID remapping rather than matching content by title.
6. Harden archive/file handling in the existing import path: path traversal checks, bounded expansion, cancellable work, and errors before publishing partial content. Reuse staged document publication where appropriate and report asset failures.

### D2 Complete imports and readable exports

1. Add CSV database import with a preview, header detection, separator/encoding handling, and explicit column-type mapping. Handle quoted newlines, date ambiguity, duplicate headers and empty cells.
2. Extend Notion HTML/CSV ZIP import. Create all supported pages and rows first, then resolve page links using one import ID map. M2 preserves and reports relation information that Nota cannot yet represent; D3 adds relation reconstruction through this same path. Import only metadata the export actually contains.
3. Improve Markdown/media ZIP and linked-folder imports. Extend the same path for Obsidian wikilinks/frontmatter only after the ordinary Markdown round trip is reliable. Keep existing HTML/DOCX support and document its fidelity.
4. Serialize every supported property in Markdown/HTML/CSV exports. The current table adapter must stop silently emitting blank text for unsupported app property types such as attachment/member fields.
5. Package available local assets and remap internal links to relative exported paths. Preserve remote links as remote references unless the user explicitly chooses a supported download action.
6. Keep native exports faithful through a versioned manifest for content schema, identities, assets, views, and supported computed-property definitions. Readable formats export useful values; they cannot promise native reconstruction of every interaction.
7. Show import progress and an actionable completion report. Repeating or cancelling an import must not silently duplicate or partially publish content; define the safe retry boundary for each job.

Acceptance: realistic Notion/CSV/Markdown imports and existing HTML/DOCX import fixtures preserve supported pages, typed values, media and internal links, with explicit conversion reports. Verify native snapshot round trips into a fresh workspace and readable Markdown/HTML/CSV exports. Unsupported source behavior is retained where possible and reported; no new DOCX export is implied. Restore skipped Markdown/HTML export E2E coverage and add round-trip fixtures. D3 extends these adapters and fixtures for relations; D4 and D5 do the same for computed properties and new views.

### D3 Relations and links

1. Add one relation property targeting one database, with single/multiple row selection. Reuse existing page search, row details, links and access decisions.
2. Persist stable target identities; derive display names from the target. Renaming a page or row must not break the relation. Deleted/unavailable targets remain visible as unresolved references without leaking inaccessible content.
3. Derive reverse usage through the existing reader/indexer/backlink path before adding reciprocal persistent relations. Keep ordinary page links for notes.
4. Extend duplicate/template/import remapping for relation targets and column references. Copied content points to corresponding copied targets; intentional references outside the copied selection remain external.
5. Verify history restore, undo, offline restart, target deletion and native export/import before shipping relations.

### D4 Formulas and rollups

1. Start with a small formula language: property references, arithmetic/comparison, conditionals, string operations and a limited set of date helpers. Store references by column ID so renaming remains safe.
2. Use a restricted expression parser/evaluator. Define null/type/error behavior, cycle detection, and bounded evaluation; do not execute arbitrary JavaScript or grant formulas network/filesystem access.
3. Add rollups over relations: count, sum, average, minimum, maximum and selected value lists. Distinguish unavailable/unloaded targets from an empty relation.
4. Keep results derived and cells read-only. Load only necessary source documents and release unused subscriptions; measure updates on large tables before adding a general computation layer.
5. Make computed values participate in sorting/filtering and readable export. Native bundles retain definitions. Unsupported imported Notion formulas preserve original text and any supplied result with a conversion report; exact Notion formula compatibility is a separate evaluated capability.

### D5 Calendar Gallery and useful templates

1. Add Calendar as another view of the existing rows: month view, selected date property, undated list, open/create/edit row, and undoable date changes. Specify date-only and time-zone behavior before implementing drag/drop.
2. Add Gallery using existing titles, images/attachments, configurable visible properties, row details and keyboard navigation.
3. Reuse shared filters, sorting, row operations and the persisted database views array. Calendar views and external calendar integrations remain distinct features.
4. Bundle a small local starter set through the existing template system: Projects and Tasks, Knowledge Notes, Daily Journal, and Meeting Follow-up. Use relations where useful and page links/backlinks throughout.
5. Keep welcome/template creation idempotent, optional, editable and deletable. A user choosing a blank workspace must receive a blank workspace.

Acceptance for D3-D5: changes appear consistently across Table, Kanban, Calendar and Gallery; identities, formulas, relations and view settings survive history and native round trips; keyboard interaction works; starter content can be edited, searched, exported and reopened offline.

Primary modules: `blocksuite/affine/blocks/database/`, `blocksuite/affine/model/src/blocks/database/`, `blocksuite/affine/data-view/`, app database property extensions, adapter ID middleware, linked-doc transformers, the existing import/export dialogs/hooks, doc-link/reader services and template/journal modules.

## Workstream 3 Optional user owned Google Drive sync

### G1 Register and expose the current implementation

1. Register the existing Google Drive document/blob storages in the desktop and web workers and add an initialization regression test.
2. Keep local workspace creation as the default. Add an explicit Connect Google Drive choice in setup and workspace settings using the existing secure Google session service.
3. Preserve cached Drive workspace discovery through offline, expired-token and disconnected states. Pause the remote peer while continuing local editing; display Saved locally with a separate sync/reconnect state.
4. Bind each remote workspace to the stable Google account identity from the existing authenticated session. Keep its local content available when another account is signed in, but pause remote sync on an account mismatch. Require an explicit reconnect or migration choice; never upload account A's cached content into account B's Drive automatically.
5. Clear worker token state on disconnect/revocation, including the current null-token case. Keep Google session persistence and single-flight refresh in their existing shared path.
6. Make local-to-Drive conversion recoverable: flush source persistence, establish a coherent source snapshot or briefly pause editing, and validate destination local documents/root metadata/blobs against that source. Recheck source changes before any retirement. Preserve the original local workspace through the initial rollout; remote metadata creation alone is not conversion success.

### G2 Safe discovery and convergence

1. Implement complete file pagination and discovery of documents represented only by update files, not just snapshots.
2. Use immutable update files and stable unique identities for retry/deduplication. Clock timestamps are metadata, not deletion authority.
3. Handle missing blobs, interrupted upload, duplicate responses, rate limits and expired credentials without changing local-save success into a remote failure.
4. Defer destructive compaction until a cross-device-safe publication protocol is demonstrated for the actual Drive API. A process-local lock cannot coordinate devices, and a guessed conditional-write header is not a proven protocol.
5. If compaction is enabled, retire only exact update files covered by a verified published snapshot. Preserve compatibility with existing file identities and concurrent writers.
6. Provide clear Disconnect sync and Keep a local copy behavior. Disconnect must not destroy the user's Drive files or local content.

Acceptance: two independent devices edit offline, reconnect and converge with documents, deletion and media intact; cached content remains available through logout/restart; switching Google accounts cannot redirect another account's cached content; pagination discovers multiple result pages; typing/attachment changes during conversion and conversion/upload/compaction interruptions preserve recovery. Ship desktop first only if desktop passes; register and test browser support separately before advertising it.

Primary modules: Electron/web storage workers, `packages/common/nbstore/src/impls/google-drive/`, `modules/workspace-engine/impls/google-drive.ts`, Google auth/session services and `modules/workspace/services/transform.ts`.

## Workstream 4 Animated onboarding and straightforward setup

### O1 Visual direction and introduction

1. Capture and review the browser onboarding references before specifying the final visual treatment. Use the emotional pacing of an animated browser welcome while keeping Nota branding, content and product behavior original.
2. Prototype a concise introduction with a clear motion storyboard: the Nota logo/wordmark reveals; note and table cards assemble and change layout; page-link/backlink connections appear; a local AI/meeting example turns into a saved note; the scene settles into the setup box. Use spring movement, card transformations and coordinated transitions to give the welcome the animated browser feel requested. Illustrative examples must not report actual model/setup readiness.
3. Suggested copy: Write and connect pages. Your workspace stays on your device. Add local AI and meeting notes when you want them.
4. Keep Skip intro and Start working available immediately. Motion duration is a design target to validate, not a forced waiting period; prefer a brief sequence over a long mandatory tour.
5. Reuse the existing React route, Nota components, vanilla-extract CSS, and animejs/WAAPI where needed. Prefer opacity/transform transitions; avoid adding a video player, 3D engine or another motion framework for this flow.
6. Provide reduced-motion/static behavior, keyboard focus, accessible labels and a stable final layout. Animation completion must not be the only path to entering the app.

### O2 The setup box

Present one calm panel titled Make Nota yours with these independent choices:

| Choice           | User action                              | Behavior                                                                                                                       |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Local AI         | Set up local AI                          | Explain hardware/download needs, recommend an appropriate verified model, then show real download/readiness state              |
| Meeting notes    | Set up transcription                     | Choose a suitable local speech model; request recording permissions only when the user starts setup/testing that requires them |
| Google Drive     | Connect Google Drive                     | Clearly optional; explains that the user's own account hosts the sync data                                                     |
| Existing content | Import notes or databases                | Opens the shared import workflow from workstream 2                                                                             |
| Workspace        | Start with a template or blank workspace | Uses existing templates and page/link behavior                                                                                 |

1. Make Start working the primary action. Model downloads, Google consent, recording permissions and imports must not block local writing.
2. Use actual ready/downloading/action-required states from the existing APIs. Link to existing settings for advanced controls instead of duplicating their logic.
3. Persist intro completion separately from optional setup completion. Resume incomplete choices later without replaying the intro or duplicating starter pages.
4. Show download size, disk needs and device requirements separately. Downloads must expose tested resume/retry/cancel behavior and an actionable repair path for invalid assets.
5. Keep cloud text providers and MCP in advanced settings; users who choose them continue to provide their own credentials and explicit provider selection.

The animated welcome and basic setup can ship with a blank workspace and existing simple templates. Add relation-based projects/tasks templates when D3-D5 are ready; onboarding does not have to wait for every advanced database feature.

### O3 Website open source and page links

1. Audit public destinations and centralize the verified website, documentation, GitHub source and issue links in existing product configuration.
2. Add labelled Website, Open source on GitHub, Help and Report a problem links in welcome/help/About. Preserve offline workspace access when those external destinations are unavailable.
3. Offer a local welcome example with two linked pages and visible backlinks, demonstrating how to connect knowledge. Create it only when chosen, using ordinary editable documents.
4. Keep GitHub as an open-source/community destination. No GitHub OAuth, repository synchronization or issue mirroring is implied by this requirement.

Acceptance: a fresh offline install reaches a writable workspace without accounts/models; optional failures can be skipped and resumed; the intro stays completed after restart; focus/reduced-motion checks pass; page links/backlinks work offline; public links open the verified destinations.

Primary modules: the existing `/onboarding` route and onboarding components, Electron `handleOpenMainApp`, app configuration state, local AI onboarding dialog, AI/meeting settings, model health/download APIs, About/help and template/doc-link services.

## Workstream 5 AI meeting quality and release acceptance

### A1 One accurate shipped starter setup

1. Choose one declared speech seed set from the verified registry, then align Forge, release workflows, helpers, checksums/licenses and clean-profile smoke tests. Preserve installed users' existing selections.
2. Keep local text setup explicit and fallback search available without an embedding download. Do not claim that bundled speech models also make local chat ready.
3. Show current model capabilities accurately, including phrase-final versus streaming captions and the narrower local ONNX agent path.

### A2 Long content and supported answers

1. Add model-aware input budgeting in the existing runtime, reserving system/tool context and output space. Replace silent document truncation with deliberate passage selection and coverage handling.
2. Evaluate retrieval using notes, table rows, linked pages and saved meetings, including duplicate titles, stale/deleted content and restricted documents. Attachments require explicit extraction support; advertise only indexed content types.
3. For long transcripts, split at suitable segment/topic boundaries, extract grounded facts, and combine them into the current summary schema. Preserve source segment IDs/timestamps for decisions and tasks.
4. Keep uncertain owners/dates unknown and distinguish tentative discussion from decisions. Cancelled or failed summaries must preserve the transcript and previous note content.
5. Make citations navigate to the supporting paragraph, table row or transcript position. A retrieved Sources list is not by itself proof that a claim is supported.
6. Evaluate local tool-calling improvements only after grounding/quality baselines. Continue using the shared AI SDK backend and reviewed proposal path; do not create a second agent runtime or silently fall back to hosted inference.

### A3 Reliable recording and realistic device measurements

1. Coordinate canonical meeting saves across renderer windows and complete strict asset-import failure handling. Recovery must not create duplicate notes or acknowledge missing attachments.
2. Exercise the packaged app's actual microphone/system-audio capture, permissions, stop, saved note/audio, hard restart and recovery. Include long sessions, quiet/noisy speech, overlap, language changes, input-device changes, sleep and slow decoding.
3. Measure cold/warm first text, final-caption delay, decode backlog, long-summary quality, indexing time and total memory with desktop UI, text, embeddings and STT active together.
4. Include supported 8/16 GiB hardware where available and each declared platform. Separate downloaded bytes, disk footprint, device RAM minimum and measured peak RAM.
5. Set measurable shipping thresholds from these baselines before changing default text models. Existing short synthetic benchmarks cannot choose the default for every long task.
6. Extend existing benchmark/smoke tooling with a fresh disposable profile and network denial after setup. Exercise the Electron backend launcher as well as extracted-backend tests.

Acceptance: no inaccessible source leaks; grounded decisions/tasks retain supporting text; accepted speech and saved media recover in tested interruption scenarios; cancellation/model switching do not corrupt content; every advertised platform has explicit packaged evidence or a documented support gate.

Primary modules: `packages/backend/ai/src/stream.ts`, `text-runtime.ts`, `workspace-search.ts`, `meeting-summary.ts`, `meetings.ts`, meeting audio/recovery modules, frontend meeting-save services, model registry, packaging/release workflows and existing benchmark scripts.

## Verification and release process

Use small reviewed changes per milestone. Each slice should include affected schema/adapter tests, user-visible behavior, and its documented acceptance evidence. Use Team Mode for risky storage/sync changes, multi-file database additions, onboarding UX/accessibility review and final review of medium or large diffs.

Validation order is targeted unit/integration tests, related package tests, typecheck, lint, and reasonable build/E2E checks. Add meaningful fixtures and failure cases; avoid tests that merely reproduce implementation details. Full packaged acceptance follows the focused automated checks.

| Release journey           | Required evidence                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local notes               | Fresh profile, offline create/edit/link/search, close/restart and reopen                                                                                      |
| Recovery                  | Failed save/retry, version restore, corrupt backup rejection, concurrent-edit backup and fresh restore with media                                             |
| Databases and portability | Supported typed values, relations/computed properties/views, Notion/CSV/Markdown/HTML/DOCX imports, native snapshot round trips and Markdown/HTML/CSV exports |
| Optional Drive            | Two independent stores/devices, offline edits, reconnect, auth loss, pagination, media and interrupted conversion/upload                                      |
| Onboarding                | Skip/resume, reduced motion, keyboard/screen reader, optional setup failures, correct external links                                                          |
| AI and meetings           | Long-content grounding, real capture, stop/save, restart/recovery, cited answer, reviewed edit and guarded undo                                               |

The final product gate is one complete journey: install, enter the workspace, import or create connected notes/databases, set up optional models, go offline, ask a supported workspace question, record and save a meeting, restart, reopen content, restore a version, and export/restore into a fresh workspace. Run optional Drive convergence as an additional journey; a local user must not need it.

## Initial implementation slices

- [ ] M0: Record baseline fixtures, verify public links, and choose a consistent package starter configuration.
- [x] P1: Add visible local-save failure state and safe writer recovery.
- [x] P2: Implement and verify the native backup primitive before using it for export/rotation.
- [x] P3: Prototype offline history preview/restore on text, database and attachment fixtures; bound version retention.
- [ ] D1-D2: Build shared data tools and repair existing property/asset/link serialization before adding new database types.
- [ ] G1: Register Drive storages and keep cached workspaces available without auth.
- [ ] G2: Validate pagination, retries, conversion and two-device convergence; gate destructive compaction.
- [ ] D3: Ship relations with identity remapping and native round-trip tests.
- [ ] D4: Add bounded formulas/rollups with derived-value and error semantics.
- [ ] D5: Add Calendar, Gallery and optional starter templates using the same rows/content.
- [ ] O1-O3: Select the motion direction, implement intro/setup, and verify accessibility and links.
- [ ] A1-A3: Align releases, improve long-content grounding, and complete packaged recording/device acceptance.

Start implementation with P1 and the P2 compatibility spike. These protect existing users and establish the restore/export foundation for the remaining workstreams.

## Local implementation record

The October 5 local work is implemented in the shared worktree. The checks below establish source and automated behavior, not a published release. Optional Drive sync, onboarding, and AI work are separate from this implementation.

| Area                     | Implemented behavior                                                                                                                                                                                             | Validation and remaining limits                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saving and recovery      | Visible unsaved-state banner, explicit writer retry retaining live edits, recoverable connection checks, emergency export of loaded pages, and close protection during actual save failure                       | Storage failure/retry, multi-window reload, UI, and local-only sync tests. Pending edits still need a successful save or emergency export before the process exits.                                                                                                                                                                                                                               |
| Workspace backups        | Consistent SQLite WAL snapshot, integrity verification and atomic file publication; manual export; opt-in daily backups to a selected local folder; seven-copy rotation; verified restore as a fresh workspace   | Rust, actual macOS NAPI, Electron export/restore/preferences, lifecycle and failure tests. Destination guards protect active workspace files; failed restores leave no discoverable workspace. Windows/Linux and packaged UI acceptance remain open.                                                                                                                                              |
| Offline page history     | SQLite/IndexedDB immutable complete versions, five-minute edit cadence, explicit checkpoints, isolated page/whiteboard previews, forward Yjs restore and atomic stale-state protection                           | Text/maps/arrays/nested blocks, migration, restart, concurrency, attachment retention and detached-preview tests. Up to 50 versions/50 MiB per page, with at least two recovery points retained. Older/mobile bridges expose an unavailable capability rather than breaking saving.                                                                                                               |
| History storage controls | Workspace-wide usage display and confirmed cleanup of local versions and unused removed media; current references are checked under a guarded writer transaction                                                 | Automatic media reclamation is conservative: retained history pins removed files because a complete per-version reference index is not yet present. Cleanup reactivates restored media still referenced by current pages, refuses stale document clocks, and stops without deletion for content it cannot safely inspect. History bytes are bounded separately from media.                        |
| Data tools and imports   | Shared import/export/recovery entry from pages and Storage; typed CSV preview; staged/cancellable HTML, Markdown ZIP, HTML/CSV Notion, DOCX and native snapshot preparation; explicit failed/empty import errors | Conversion, cancellation, malformed archive, missing/conflicting asset, Unicode name and publication rollback tests. Notion Markdown exports use the separate Markdown ZIP importer. CSV preserves values and reports the absence of source relation/formula/view definitions.                                                                                                                    |
| Export fidelity          | Versioned native ZIP manifest with asset size/hash verification; cross-page identity remapping; readable Markdown/HTML/CSV database values and conversion reports                                                | Fresh-workspace tests cover files, forward page links, relations, formulas, rollups, Calendar/Gallery configuration and imported values. Native bundles preserve definitions; readable output preserves supported values. Publication uses existing synchronous Yjs APIs with rollback, not a cross-document crash transaction; failed/cancelled jobs may leave an unreferenced blob cache entry. |
| Database properties      | Stable relation targets/row picker/unresolved references, derived reverse usage in the existing reader, bounded formulas and numeric count/sum/average/minimum/maximum rollups                                   | Reactive edits, cycles, errors, read-only cells, filtering/sorting, deletion/trash invalidation, parser bounds and duplication/import remapping tests. Cross-page targets currently need their page loaded. Automatic target loading, selected-value rollups and Notion formula translation remain follow-up work.                                                                                |
| Views and starters       | Month Calendar with date selection/undated rows and dated creation; Gallery with image covers/visible properties; Projects and Tasks, Knowledge Notes, Daily Journal and Meeting Follow-up starters              | Shared rows/filters/sorts, options persistence, date/DST/leap-year handling, keyboard row opening, editable templates, unique identities, Yjs reopen and native import tests. Gallery covers use current image URL values; attachment thumbnails and packaged visual acceptance remain open.                                                                                                      |

Automated validation passed: 344 local regression tests across 47 files, 18 Electron backup/restore tests, two protected-preferences tests, 36 Rust storage tests with `use-as-lib`, and four smoke tests against the rebuilt macOS native addon. The native tests include delete → restore → clear history → restart with media and Nota's root/page references. Core and Electron TypeScript builds, scoped ESLint/format checks, and final diff checks passed. Independent storage re-review has no outstanding findings.

The local release gate still requires the packaged journey on each advertised platform: a disposable fresh profile, offline writing/search/linking, restart, version restore, failed-save recovery, import/export with media, and backup restore. Broad source-format parity, relative multi-page readable links, per-version media garbage collection, and large-workspace performance need further acceptance fixtures before stronger claims. Clearing native history/media makes SQLite pages reusable; it does not run a blocking database compaction, so the workspace file may retain its size.

## Reference anchors

- [SQLite live backup](https://www.sqlite.org/backup.html): consistent backup of a running database; availability in Nota's native wrapper remains an implementation spike.
- [Yjs document updates](https://docs.yjs.dev/api/document-updates): state vectors describe sync state, encoded updates carry content, and updates merge into a document.
- [Yjs internals](https://github.com/yjs/yjs/blob/main/INTERNALS.md): snapshot state and deletion information require appropriate retained content; a snapshot marker alone is not a retained version.
- [BlockSuite schemas](https://github.com/toeverything/blocksuite/blob/main/docs/guide/block-schema.md) and [adapters](https://github.com/toeverything/blocksuite/blob/main/docs/guide/adapter.md): extend existing content contracts; Nota's vendored source owns exact APIs.
- [Google Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files): use complete pagination and supported API behavior; conditional compaction guarantees require separate verification.
- Current repo implementation anchors are listed within each workstream. The [October 5 meeting pipeline report](../../benchmarks/2026-10-05-meeting-pipeline-design.md) and [local AI baseline](../../benchmarks/2026-09-13-local-ai-baseline.md) retain their measured scope and device limitations.
