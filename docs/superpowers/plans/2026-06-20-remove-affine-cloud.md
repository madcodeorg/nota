# Remove AFFiNE-Cloud — Execution Plan (decisions locked)

**Date:** 2026-06-20
**Status:** IN PROGRESS on branch `remove-affine-cloud` — supersedes the read-only map in
[2026-06-14-cloud-server-code-removal-map.md](2026-06-14-cloud-server-code-removal-map.md).
**Related:** [2026-03-16-google-drive-sync.md](2026-03-16-google-drive-sync.md),
[2026-04-19-nota-local-ai-workspace.md](2026-04-19-nota-local-ai-workspace.md)

## Progress log

- ✅ **Phase 1** — removed dead billing/plans/subscription/upgrade UI (~69 files) + dead routes.
- ✅ **Phase 2a** — removed orphaned upsell UI (user-plan-button, user-plan-tag, share-menu plan-tag).
- ✅ **Phase 2b** — share-menu trimmed to local Export only (cloud-publish gone, no ServerService dep).
- ✅ **Phase 1 (Tier A services)** — removed 7 zero-consumer cloud services + DI wiring
  (subscription/invoices/quota/license/cloud-doc-meta).
- ✅ **Phase 6 (partial)** — deleted dead cloud e2e suites (tests/nota-cloud\*, nota-desktop-cloud) + tsconfig refs.
- ⏳ Remaining: Tier A team-sharing leftovers (Invitation→invite page, PublicUser→member-selector,
  UserQuota→storage-progress, UserFeature→account-menu admin), **Phase 3** (AI decoupling),
  **Phase 4** (server/auth/sync spine), Phase 5 (delete modules/cloud + prune graphql),
  rest of Phase 6, Phase 7 (build + smoke).

## ⚠️ Environment blockers found during execution (must fix before the spine)

1. **eslint pre-commit hook broken** — `Cannot find module 'supports-color'`. Commits need
   `--no-verify`. Fix: reinstall deps (`yarn install`).
2. **`tsc -b --force` is unusable as a clean gate** — a full rebuild surfaces ~810 BlockSuite
   engine module-resolution errors (engine needs its own build pipeline) + ~335 `packages/backend/ai`
   errors (uninstalled deps: express, ai, @ai-sdk/\*, multer). NONE are cloud-removal related.
   Reliable gate = incremental `tsc -b` filtered to frontend + manual dangling-ref greps.
3. **No app-run available** — Phase 3/4 change live AI transport + workspace sync; they can only be
   truly verified by running the app (AI answers? Google sign-in + Drive backup work?).

## Phase 4 linchpin (discovered)

AI's `CopilotClient` is built from the cloud `GraphQLService` + `EventSourceService`, and on desktop
the `nota-cloud` server `baseUrl` is `http://localhost:3010` (the AI backend). So removing the
server/transport stack REQUIRES first giving AI its own minimal transport to `localhost:3010`
(`NOTA_AI_BACKEND_URL`). Do that before deleting `ServerService`/`FetchService`/`GraphQLService`.

## Decisions (the 2026-06-14 open questions, now answered)

1. **Strip to fully local — keep NO server scaffolding** for a future cloud. Full removal.
2. **Google Drive is the only sync.** (`nbstore/impls/google-drive`,
   `workspace-engine/impls/google-drive.ts`, `transformLocalToCloud(ws, 'google-drive')`.)
3. **AI works with NO account at all.** AI is Nota's own backend (`@nota/ai-backend`), free.
   Rebuild any billing later if ever needed.
4. Also remove related/orphan UI that is **not connected to anything in Nota's new model**
   (upsell, members, public-share, plan tags), and **relabel** surviving "Cloud" wording to
   "Google Drive backup".

## Target architecture (KEEP — never touch)

- `modules/google-auth/` · `server/google-oauth-broker/` · `api/google/` — auth
- `modules/workspace-engine/impls/google-drive.ts` (+ its registration in `workspace-engine/index.ts`)
- `packages/common/nbstore/src/impls/google-drive/` — Drive sync transport
- `modules/workspace/services/transform.ts` — already special-cases `'google-drive'`
- `packages/backend/ai` (`@nota/ai-backend`) — GraphQL context is `{ config, models, store }`, no auth
- BlockSuite engine (`@blocksuite/affine/*`), local-first storage

## Scope reality

`modules/cloud/` is ~70 files; **~155 files** in `frontend/core/src` import it (mostly via the
barrel `@nota/core/modules/cloud`). This is a **refactor, not a delete**. Leaf-first, one phase
per commit, typecheck after each. Mobile (`mobile/pages`, `mobile/dialogs`, `mobile/components`)
mirrors desktop — handle in the same phase. Where a "cloud" service feeds a local flow, **stub/
inline** rather than delete, and flag it.

---

## Phase 0 — Branch + baseline

- Branch off `main` (current changes sit on `main`).
- Baseline command: `yarn nota @nota/core typecheck` + a web build. Re-run after every phase.

## Phase 1 — Tier A: dead server-only features [low risk]

Remove each as service + store + entity + UI, and delete its `.provide(...)` line in
`modules/cloud/index.ts`.

**Billing / subscription / quota / feature**

- `cloud/services|stores|entities/subscription*`, `workspace-subscription*`,
  `invoices*`, `workspace-invoices*`, `user-quota*`, `user-copilot-quota*`, `user-feature*`

**Licensing**

- `cloud/services|stores/selfhost-license*`, `selfhost-generate-license*`

**Team / sharing-server bits**

- `cloud/services/invitation.ts` + `stores/invite-info.ts`, `stores/accept-invite.ts`
- `cloud/services/captcha.ts`
- `cloud/services|stores/public-user*` + `cloud/views/public-user.{tsx,css.ts}`
- `cloud/services|stores|entities/cloud-doc-meta*`
- `cloud/services/doc-created-by.ts`, `doc-updated-by.ts`,
  `doc-created-by-updated-by-sync.ts` (+ store) — **VERIFY** these don't feed local doc author
  display before deleting; if they do, stub with local identity.

**Tier A UI (remove + unregister from settings nav)**

- `setting/general-setting/billing/`, `setting/workspace-setting/billing/`
- `setting/general-setting/plans/` incl. `plans/ai/`, `plans/lifetime/`
- `setting/workspace-setting/license/`
- `pages/subscribe/`, `pages/upgrade-to-team/`
- `mobile/dialogs/setting/subscription/`, `mobile/dialogs/setting/user-usage/`,
  `mobile/components/user-plan-tag/`
- Remove the nav entries in `setting/general-setting/index.tsx` and `setting/setting-sidebar/index.tsx`
  so panels are unreachable.

## Phase 2 — Orphan UI sweep [low risk]

Classify every cloud-era UI surface: REMOVE / KEEP+RELABEL / TRIM.
Rule: if a surface's only action hits the removed cloud server → REMOVE. If it routes into
Google Drive / local / AI → KEEP and relabel away from "Cloud".

**REMOVE — upsell/billing/collab wired to nothing**

- `components/affine/auth/user-plan-button.tsx`, `mobile/components/user-plan-tag/`
- `components/affine/auth/ai-login-required.tsx` (AI is local; no login gate)
- `components/affine/ai-onboarding/**` — VERIFY: it's the AFFiNE subscription pitch. Salvage any
  pure "how AI works" intro; otherwise remove all.
- `pages/upgrade-success/**`, `ai-upgrade-success/**`, `upgrade-to-team/**`
- `setting/general-setting/plans/lifetime/believer-card.tsx`
- `pages/invite/**`, `components/member-selector/**` (no members without a server)
- VERIFY-then-likely-REMOVE: `blocksuite/database-block/properties/member/**` (database "member"
  column; does not import modules/cloud — confirm it's not a generic editor field first)

**KEEP + RELABEL — the Google-Drive front door**

- `components/hooks/nota/use-enable-cloud.tsx` (already calls `transformLocalToCloud('google-drive')`)
- `components/workspace-selector/enable-cloud/enable-cloud.tsx`
- `desktop/dialogs/enable-cloud/index.tsx`
- `setting/workspace-setting/preference/enable-cloud.tsx`
- `components/top-tip.tsx` — imports `useEnableCloud`; relabel to a Google-Drive prompt
  (it also imports `AuthService` from modules/cloud → swap to `GoogleAuthService` in Phase 4)
- ACTION: change copy "Cloud / AFFiNE Cloud / Nota Cloud" → "Google Drive backup" (i18n values +
  hardcoded labels). Mechanism stays; only wording changes.

**TRIM — share-menu: keep offline, drop cloud-publish**

- KEEP: `share-menu/view/share-menu/share-export.tsx` (PDF/HTML/Markdown/PNG) + container
  (`index.tsx`, `share-menu.tsx`, `share-page.tsx`, `scroller.tsx`) trimmed to export-only;
  `cloud-svg.tsx` (icon; keep or reskin)
- REMOVE: `general-access/**` (`public-page-button.tsx` = make-page-public), `plan-tag.tsx`
- `copy-link-button.tsx` — VERIFY: cloud public URL → remove; local doc deep-link → keep

## Phase 3 — AI decoupling [med risk]

AI must run with no Nota-Cloud login.

- `blocksuite/ai/provider/setup-provider.tsx` — stop importing `AuthService`/`AuthAccountInfo`;
  feed a local identity (or none) to the AI provider.
- Remove/rewrite AI login-gate strings: `blocksuite/ai/messages/error.ts`,
  `blocksuite/ai/widgets/ai-panel/components/state/error.ts`
  ("You need to login to Nota Cloud to continue using Nota AI").
- Verify AI works fully offline against `@nota/ai-backend`.

## Phase 4 — Sync + auth + server removal [HIGH risk — the spine]

- Drop the CLOUD workspace flavour: `modules/workspace-engine/impls/cloud.ts` +
  its registration in `workspace-engine/index.ts`.
- Remove the `nota-cloud` server seed (`modules/cloud/constant.ts`).
- Remove `packages/common/nbstore/src/impls/cloud/` (8 files: doc, doc-static, blob, awareness,
  indexer, http, socket, index) and the `cloud` entry from `@nota/nbstore`.
- Remove server registry/transport: `cloud/services/server.ts`, `servers.ts`, `default-server.ts`,
  `workspace-server.ts`, `fetch.ts`, `graphql.ts`, `eventsource.ts`;
  `cloud/stores/server-config.ts`, `server-list.ts`; `entities/server.ts`; `scopes/server.ts`.
- Remove auth/session: `cloud/services/auth.ts`, `stores/auth.ts`, `impl/auth.ts`,
  `provider/auth.ts`, `entities/session.ts`, `services/access-token.ts`, `stores/access-token.ts`,
  `provider/validator.ts`, `events/account-*`.
- Remove sign-in/OAuth UI: `components/sign-in/*` (keep only the Google entry, already in
  `sign-in/index.tsx` via `GoogleAuthService`), `pages/auth/*` (magic-link, confirm-change-email,
  email-verified, oauth-login, sign-in), `setting/account-setting/`,
  `components/workspace-selector/*` "Nota Cloud" affordances.
- Swap remaining account-info reads (`top-tip.tsx`, account-menu, etc.) to `GoogleAuthService`.
- This is where most of the ~155 refactors land. Go file-by-file; typecheck often.

## Phase 5 — Delete module + prune graphql + electron OAuth [med risk]

- `rm -r modules/cloud/` (should be orphaned now); remove its lines from `modules/index.ts`.
- Prune `@nota/graphql` (`packages/common/graphql`, ~197 ops) of now-unused operations;
  if fully unused, drop the package + codegen. Confirm `@nota/ai-backend` doesn't share it.
- iOS `App/Packages/NotaGraphQL/` — if cloud-only, remove it + `apollo-codegen-config.json`/
  `apollo-codegen-chore.sh`/`setup.sh`; if it backs a kept feature, leave it.
- Electron OAuth deep-link / loopback: `apps/electron/src/main/auth/loopback-server.ts`,
  `protocol.ts` — **VERIFY**: Google OAuth reuses the loopback server (touched in the local-backend
  commit). Keep the Google path; remove only the Nota-Cloud-account handlers.

## Phase 6 — Small / dev / test cleanup [low risk]

- `tests/nota-cloud/`, `tests/nota-cloud-copilot/`, `tests/nota-desktop-cloud/`,
  `tests/kit/src/utils/cloud.ts`
- Cloud-only scripts/fixtures under `tools/` and `scripts/`
- Orphaned i18n keys in `packages/frontend/i18n/src/resources/*.json`
  (Cloud / billing / subscription / plan / invoice / license / sign-in-email)
- Stale `.claude/specs` cloud references

## Phase 7 — Verify

- typecheck all changed packages; build web + electron.
- Smoke test: create local workspace → sign in with Google → Enable Google Drive backup →
  confirm AI (`@nota/ai-backend`) responds with no account.

---

## Risk / watch-list

- ~155-file blast radius via the `modules/cloud` barrel export.
- DI boot: every removed service must have its `.provide`/`.impl` removed from
  `modules/cloud/index.ts` and `modules/index.ts` or the app won't boot.
- AI coupling lives in `setup-provider.tsx` (Phase 3) — do it before Phase 4 auth removal.
- `doc-created-by*` may feed local doc author display — stub, don't blind-delete.
- Google OAuth reuses electron loopback-server and possibly `pages/auth/oauth-callback` — verify
  before deleting those.
- Mobile parity in every phase.
- iOS `NotaGraphQL` may or may not be cloud-only (Phase 5).

## Suggested execution order

Land **Phases 1–2 (+6 partial)** first — big visible win, low risk, app stays green.
Then **Phase 3** (AI decoupling). Then the heavy **Phase 4**, then **5**, then finish **6–7**.
