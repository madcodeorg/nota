# Nota Rebrand & License Cleanup — Design Spec

## Goal

Complete the rebrand from AFFiNE to Nota and ensure full license compliance. Remove all references to AFFiNE branding, TOEVERYTHING PTE. LTD., and any non-MIT artifacts. The codebase should look and feel like an independent project called Nota when done.

## Non-Goals

- Adding new features (AI, meetings, transcription — separate effort)
- Changing functionality or behavior
- Refactoring code beyond what's needed for the rebrand
- Publishing packages to npm under `@nota` scope

## Current State

- Fork of AFFiNE with EE code and backend (BSL-licensed) already removed
- iOS app already branded as "Nota" (display name), but Xcode project and Swift sources still contain ~267 "affine" references
- Main LICENSE already updated to MIT with Nota copyright
- BlockSuite is MIT — no changes needed to its licensing
- 119 package.json files still use `@nota/*` scope
- 21+ Rust crate references use `affine_*` naming across 7 Cargo.toml files
- URLs, docs, configs, templates still reference nota.pro / TOEVERYTHING

## Approach: Phased by Category

Five phases, each independently testable. Each phase gets its own commit.

---

## Phase 1: Package Namespace Rename (TypeScript + Rust)

**Scope**: All `package.json` files, source code imports, and Rust crates.

### 1a: TypeScript Packages

- Rename `@nota/*` packages to `@nota/*` across all 119 package.json files
- Rename `@toeverything/*` packages to `@nota/*` (only in `packages/frontend/` and `packages/common/` — NOT in `blocksuite/`)
- Update all import statements in `.ts`, `.tsx`, `.js`, `.jsx` files
- Update all `tsconfig.json` path aliases
- Update root `package.json` workspace definitions
- Rename test directories: `tests/affine-cloud/`, `tests/affine-cloud-copilot/`, `tests/affine-desktop/`, `tests/affine-desktop-cloud/`, `tests/affine-local/`, `tests/affine-mobile/` → `tests/nota-*`
- Update test `package.json` files inside renamed directories

### 1b: Rust Crates

- Rename crates: `affine_native` → `nota_native`, `affine_nbstore` → `nota_nbstore`, `affine_schema` → `nota_schema`, `affine_sqlite_v1` → `nota_sqlite_v1`, `affine_mobile_native` → `nota_mobile_native`, `affine_media_capture` → `nota_media_capture`, `affine_common` → `nota_common`
- Update all 7 Cargo.toml files
- Update Rust source files that reference these crate names
- Update FFI bindings that reference `libaffine_mobile_native.so` (Android) and the equivalent iOS dylib
- Update UniFFI binding generation configs

**Verification**:

- `yarn install` succeeds
- `yarn build` succeeds (or at minimum no import resolution errors)
- `cargo build` succeeds for all workspace members

**Risk**: HIGH — This is the most likely phase to break the build. Imports are interconnected. Rust FFI renames cascade into mobile builds.

**Edge Cases**:

- `@blocksuite/*` and `@blocksuite/affine` — BlockSuite's own namespace, NOT AFFiNE branding. Leave as-is.
- `@toeverything/*` inside `blocksuite/` — leave as-is (external dependency namespace).
- i18n keys use `com.affine.*` — internal identifiers, not user-facing. Leave for now.
- Some test fixtures may reference `@affine` — update these too.

---

## Phase 2: Mobile Platform Configs

**Scope**: Android and iOS build configs, manifests, source files.

### Android

- `build.gradle`: Change namespace and application ID from `app.nota.pro` to `app.nota.pro`
- `AndroidManifest.xml`: Rename `android:name=".AFFiNEApp"` to `".NotaApp"`, update URL scheme from `affine://` to `nota://`
- Rename Java/Kotlin class `AFFiNEApp` → `NotaApp`
- Update GraphQL namespace `com.nota.pro.graphql` → `com.nota.pro.graphql`
- Update FFI library reference from `libaffine_mobile_native.so` to `libnota_mobile_native.so`

### iOS

- Update Xcode project file (`project.pbxproj`) — ~67 "affine" references including bundle identifiers, build settings, target names, product references
- Update Swift source files (~267 files with "affine" references) — class names, bundle IDs, internal references
- Rename splash asset: `affine@png-1.png` → `nota@png-1.png`, update `Assets.xcassets`

**Decision — URL Scheme**: Changing `affine://` to `nota://` is a breaking change for anyone using deep links. Since this is a fresh fork with no existing users, we change it to `nota://`.

**Verification**:

- Android: `./gradlew assembleDebug` succeeds
- iOS: `xcodebuild` succeeds
- No "affine" references in mobile source/config files

**Risk**: MEDIUM — Mobile builds have many interconnected config files. Missing one reference can cause build failures.

---

## Phase 3: URLs, Docs, Configs, Templates

**Scope**: All non-code references to AFFiNE branding.

**Changes**:

- `README.md` — Replace all `nota.pro`, `cdn.nota.pro`, `app.nota.pro`, `docs.nota.pro` URLs with Nota equivalents (or placeholder `nota.pro` URLs)
- `.github/CLA.md` — Remove TOEVERYTHING PTE. LTD. references, update to Nota project
- `.github/ISSUE_TEMPLATE/BUG-REPORT.yml` — Replace nota.pro URLs
- `.github/ISSUE_TEMPLATE/FEATURE-REQUEST.yml` — Replace toeverything references
- `.github/ISSUE_TEMPLATE/config.yml` — Replace discord URL
- `.github/FUNDING.yml` — Remove `toeverything` sponsor or update
- `.github/actions/setup-node/action.yml` — Update toeverything references
- `docs/CONTRIBUTING.md` — Update to reference Nota
- `docs/developing-server.md` — Remove (backend was removed) or add note that backend is not included
- `docs/BUILDING.md` — Update any AFFiNE references
- `.docker/selfhost/.env.example` — Rename `NOTA_REVISION`, `NOTA_SERVER_HOST` vars
- `.docker/dev/.env.example` — Update affine references

**Verification**: `grep -r "nota.pro" .` returns zero results (excluding blocksuite internals). No `TOEVERYTHING` references outside LICENSE.

**Risk**: LOW — Documentation/config changes only.

---

## Phase 4: Assets & Branding

**Scope**: Visual assets, logos, icons, stickers.

**Changes**:

- Sticker SVGs: Rename "AFFiNE AI.svg" files to "Nota AI.svg" (2 files in Paper/Cover and Paper/Content)
- Any logo/favicon files that contain AFFiNE branding — replace with Nota equivalents or generic placeholders
- Update any hardcoded asset paths in source code that reference renamed files

**Verification**: No files named with "AFFiNE" in asset directories (excluding blocksuite).

**Risk**: LOW — Cosmetic changes only at this point (mobile assets handled in Phase 2).

---

## Phase 5: CI/CD, Docker, Helm

**Scope**: Build infrastructure and deployment configs.

**Changes**:

- Helm chart: Rename from `affine` to `nota` in `.github/helm/affine/` → `.github/helm/nota/`. Remove backend-related subcharts (graphql, etc.) since backend is removed.
- Docker images: Update references from `ghcr.io/heyyykk3/nota` to `ghcr.io/heyyykk3/nota` (or appropriate registry)
- GitHub workflows: Update image tags, repository references, artifact names
- Mac signing: Remove TOEVERYTHING certificate reference (will need new cert for actual releases)
- Docker compose files: Update service names, env vars

**Verification**: CI workflow files have no `heyyykk3/nota` references. Helm chart validates with `helm lint`.

**Risk**: MEDIUM — Won't affect local dev, but broken CI means no automated builds.

---

## What We're NOT Changing

| Item                                   | Reason                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@blocksuite/*` packages               | BlockSuite's own namespace, not AFFiNE branding                                                                                              |
| `@toeverything/*` inside `blocksuite/` | External dependency namespace within BlockSuite                                                                                              |
| i18n key prefixes (`com.affine.*`)     | Internal identifiers, display text already says "Nota". Renaming risks breaking key lookups for zero user-facing benefit. Can be done later. |
| Git history                            | Rewriting history is destructive and unnecessary                                                                                             |
| Any MIT-licensed code                  | MIT allows free use, modification, distribution                                                                                              |

## Success Criteria

1. `grep -ri "affine"` across all file types (`.json`, `.ts`, `.tsx`, `.yml`, `.md`, `.gradle`, `.xml`, `.swift`, `.toml`, `.plist`, `.pbxproj`, `.env`, `.yaml`) returns only:
   - BlockSuite internal references (`@blocksuite/affine`, `@toeverything/*` inside `blocksuite/`)
   - i18n key identifiers (`com.affine.*`)
   - LICENSE attribution ("Based on AFFiNE")
2. `yarn install` and `yarn build` succeed
3. `cargo build` succeeds for all Rust workspace members
4. No URLs point to `nota.pro` domains
5. No references to TOEVERYTHING PTE. LTD. (except LICENSE attribution)
6. Android app ID is `app.nota.pro`, URL scheme is `nota://`
7. iOS bundle identifiers updated, Xcode project builds
8. All TypeScript package scopes are `@nota/*`
9. All Rust crate names use `nota_*` prefix
10. Helm chart lints successfully
