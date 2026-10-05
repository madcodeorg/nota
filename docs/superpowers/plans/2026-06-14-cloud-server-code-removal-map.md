# Cloud-Server Code Removal Map (read-only analysis)

**Date:** 2026-06-14
**Status:** MAP ONLY — no code changed. Review before acting.

## Finding

There is **no Nota Cloud server** in this repo. The original AFFiNE `packages/backend/server`
(NestJS GraphQL cloud: auth, sync, billing, DB) was deleted. `packages/backend/` now contains
only `ai/` (`@nota/ai-backend`), a real local AI backend that does **not** require cloud auth
(see `packages/backend/ai/src/graphql.ts` — its GraphQL context is `{ config, models, store }`,
no user/session).

What remains is the **client side** of AFFiNE cloud, rebranded "Nota Cloud":

- `packages/frontend/core/src/modules/cloud/` — ~70 files (auth, billing, sync, server registry)
- `packages/common/nbstore/src/impls/cloud/` — 8 files (cloud doc/blob/awareness sync)
- Extensive billing / subscription / plans / license / sign-in UI

**Integration depth:** ~155 files in `packages/frontend/core/src` import from `modules/cloud`.
It is woven into the workspace engine (a `CLOUD` workspace flavour) and into AI (the AI provider
reads the cloud `AuthService` for account info). So this is a **refactor, not a delete**.

---

## Tier A — Dead server-only features (safe to remove)

These call API endpoints that no longer exist, and no load-bearing system depends on them.
Each is a service + store + entity tri(remove all three) plus its UI.

### Billing / subscription / quota

- `modules/cloud/services/subscription.ts`, `stores/subscription.ts`, `entities/subscription.ts`, `entities/subscription-prices.ts`
- `modules/cloud/services/workspace-subscription.ts`, `entities/workspace-subscription.ts`
- `modules/cloud/services/invoices.ts`, `stores/invoices.ts`, `entities/invoices.ts`
- `modules/cloud/services/workspace-invoices.ts`, `entities/workspace-invoices.ts`
- `modules/cloud/services/user-quota.ts`, `stores/user-quota.ts`, `entities/user-quota.ts`
- `modules/cloud/services/user-copilot-quota.ts`, `stores/user-copilot-quota.ts`, `entities/user-copilot-quota.ts`
- `modules/cloud/services/user-feature.ts`, `stores/user-feature.ts`, `entities/user-feature.ts`

### Licensing (self-host license server)

- `modules/cloud/services/selfhost-license.ts`, `stores/selfhost-license.ts`
- `modules/cloud/services/selfhost-generate-license.ts`, `stores/selfhost-generate-license.ts`

### Team / sharing-server bits

- `modules/cloud/services/invitation.ts`, `stores/invite-info.ts`, `stores/accept-invite.ts`
- `modules/cloud/services/captcha.ts`
- `modules/cloud/services/public-user.ts`, `stores/public-user.ts`, `views/public-user.{tsx,css.ts}`
- `modules/cloud/services/cloud-doc-meta.ts`, `stores/cloud-doc-meta.ts`, `entities/cloud-doc-meta.ts`
- `modules/cloud/services/doc-created-by.ts`, `doc-updated-by.ts`, `doc-created-by-updated-by-sync.ts`, `stores/doc-created-by-updated-by-sync.ts`

### Tier A UI surfaces (remove or hide together with the above)

- `desktop/dialogs/setting/general-setting/billing/` (8 refs)
- `desktop/dialogs/setting/workspace-setting/billing/` (5 refs)
- `desktop/dialogs/setting/general-setting/plans/` incl. `plans/ai/`, `plans/lifetime/` (billing plans UI)
- `desktop/dialogs/setting/workspace-setting/license/` (3 refs)
- `desktop/pages/subscribe/`, `desktop/pages/upgrade-to-team/`
- `mobile/dialogs/setting/subscription/`, `mobile/dialogs/setting/user-usage/`, `mobile/components/user-plan-tag/`
- Remove the corresponding entries from settings navigation so the panels are unreachable.

**Risk:** low. Mostly self-contained. Main work is deleting `.provide(...)` registrations in
`modules/cloud/index.ts` and the settings-nav entries, then fixing the few view imports.

---

## Tier B — Load-bearing scaffolding (do NOT just delete)

Other systems import these even in a local-only app. Removing them requires rewiring, not deletion.

### Auth / session — coupled to AI

- `modules/cloud/services/auth.ts`, `stores/auth.ts`, `impl/auth.ts`, `provider/auth.ts`, `entities/session.ts`
- `modules/cloud/services/access-token.ts`, `stores/access-token.ts`
- Consumer: `blocksuite/ai/provider/setup-provider.tsx` imports `AuthService` / `AuthAccountInfo`
  to populate AI user info (avatar/email/name) and gate AI.
- **Rewire needed:** AI must work without a Nota Cloud login. Either provide a stub/local identity
  to the AI provider, or remove the auth dependency from `setup-provider.tsx`. The local AI backend
  itself does not check auth, so this is purely a frontend coupling.

### Server registry / transport

- `modules/cloud/services/server.ts`, `servers.ts`, `default-server.ts`, `workspace-server.ts`
- `modules/cloud/stores/server-config.ts`, `stores/server-list.ts`, `entities/server.ts`, `scopes/server.ts`
- `modules/cloud/services/fetch.ts`, `graphql.ts`, `eventsource.ts`
- `modules/cloud/constant.ts` (defines the `nota-cloud` server with `serverName: 'Nota Cloud'`)
- These back the `ServersService` used by `modules/workspace-engine/index.ts`.

### Cloud workspace flavour (sync)

- `modules/workspace-engine/impls/cloud.ts` — registers `WorkspaceFlavoursProvider('CLOUD')`,
  branches on `serverId === 'nota-cloud'`, uses `@nota/nbstore/cloud`.
- `packages/common/nbstore/src/impls/cloud/` (8 files: `doc.ts`, `doc-static.ts`, `blob.ts`,
  `awareness.ts`, `indexer.ts`, `http.ts`, `socket.ts`, `index.ts`)
- `@nota/nbstore` exports a `cloud` entry consumed here.
- **Rewire needed:** drop the CLOUD flavour registration in `workspace-engine/index.ts` and remove
  the `nota-cloud` server seed so only LOCAL (and Google Drive) workspaces exist.

### Sign-in / OAuth UI (depends on auth services)

- `components/sign-in/*`, `desktop/pages/auth/*` (sign-in, oauth-callback, magic-link, etc.)
- Account settings: `desktop/dialogs/setting/account-setting/`
- Workspace selector "Nota Cloud" affordances: `components/workspace-selector/*`
- AI login prompts: `blocksuite/ai/messages/error.ts`, `blocksuite/ai/widgets/ai-panel/components/state/error.ts`
  ("You need to login to Nota Cloud to continue using Nota AI") — must be removed/rewritten once
  AI no longer requires login.

---

## Cross-cutting dependencies to verify before removal

1. **`@nota/graphql`** (`packages/common/graphql`) — cloud services import generated queries/mutations
   from here (subscription, invite, user, license, etc.). After removing Tier A/B, regenerate or
   prune so the build has no dangling exports. Confirm the AI backend does not share these.
2. **i18n** — many `"Nota Cloud"`, billing, subscription, plan strings across
   `packages/frontend/i18n/src/resources/*.json`. Remove orphaned keys after UI removal.
3. **Tests** — `tests/nota-cloud/`, `tests/nota-cloud-copilot/`, and `tests/kit/src/utils/cloud.ts`
   exercise the cloud flow; delete or rewrite alongside.
4. **Electron/protocol** — check OAuth deep-link / loopback handlers
   (`apps/electron/src/main/auth/loopback-server.ts`, `protocol.ts`) which exist for cloud sign-in.
5. **Framework registration** — `modules/cloud/index.ts` and `modules/index.ts` wire every service
   into the DI framework; every removed service needs its `.provide`/`.impl` line removed or the
   app fails to boot.

---

## Recommended phased order (when you decide to act)

1. **Phase 1 (Tier A, low risk):** remove billing/subscription/quota/license/invite/captcha
   services+stores+entities+UI, settings-nav entries, and orphaned i18n keys. App still builds and
   runs; "Nota Cloud" account/sync still present.
2. **Phase 2 (AI decoupling):** make `setup-provider.tsx` and the AI error states stop requiring a
   Nota Cloud login (local identity or no identity). Verify AI works fully offline.
3. **Phase 3 (sync + auth removal):** drop the `CLOUD` workspace flavour, `nota-cloud` server seed,
   `nbstore/impls/cloud`, auth/session/server services, and all sign-in/OAuth UI. App becomes purely
   local (+ Google Drive sync). Largest, riskiest step.
4. **Phase 4 (cleanup):** prune `@nota/graphql` operations, electron OAuth handlers, cloud tests.

## Open questions for you

- Keep **any** server scaffolding for a future Nota Cloud, or strip to fully local?
- Is **Google Drive sync** the only intended sync? (It lives in `nbstore/impls/google-drive`,
  independent of the cloud flavour — unaffected by this removal.)
- Should AI remain available with **no account at all**, or do you still want a lightweight local
  profile concept?
