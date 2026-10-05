# Nota Rebrand & License Cleanup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the rebrand from AFFiNE to Nota — rename all package namespaces, update all URLs/docs/configs, rename assets, and update CI/CD pipelines so the codebase is fully independent from AFFiNE branding.

**Architecture:** Phased approach across 5 categories: (1) TypeScript package namespaces, (2) Rust crate names, (3) mobile platform configs, (4) docs/URLs/configs, (5) CI/CD/Docker/Helm. Each phase produces a working, testable state.

**Tech Stack:** TypeScript, Rust, Kotlin, Swift, Yarn workspaces, Cargo workspaces, Gradle, Xcode, Docker, Helm, GitHub Actions

**Key exclusion rule:** `@blocksuite/affine` and all `@blocksuite/*` references must be left as-is everywhere — including imports from outside `blocksuite/`. These are BlockSuite's own namespace, not AFFiNE branding.

---

## Chunk 1: TypeScript Package Namespace Rename

### Task 1: Rename root package.json and workspace config

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Update root package.json**

Change the workspace name (already `@nota/monorepo` — verify). No workspace glob changes needed since directory names stay the same.

- [ ] **Step 2: Update tsconfig.json path aliases**

Change:

```json
"@nota/core/*": ["./packages/frontend/core/src/*"]
```

To:

```json
"@nota/core/*": ["./packages/frontend/core/src/*"]
```

- [ ] **Step 3: Verify root config**

Run: `cat package.json | grep -i nota`
Expected: `@nota/monorepo`

---

### Task 2: Rename all @nota/\* packages (common/)

**Files:**

- Modify: `packages/common/debug/package.json`
- Modify: `packages/common/env/package.json`
- Modify: `packages/common/error/package.json`
- Modify: `packages/common/graphql/package.json`
- Modify: `packages/common/infra/package.json` (currently `@nota/infra`)
- Modify: `packages/common/nbstore/package.json`
- Modify: `packages/common/reader/package.json`
- Modify: `packages/common/s3-compat/package.json`

- [ ] **Step 1: Rename each package name field**

For each `package.json` above, change the `"name"` field:

- `@nota/debug` → `@nota/debug`
- `@nota/env` → `@nota/env`
- `@nota/error` → `@nota/error`
- `@nota/graphql` → `@nota/graphql`
- `@nota/infra` → `@nota/infra`
- `@nota/nbstore` → `@nota/nbstore`
- `@nota/reader` → `@nota/reader`
- `@nota/s3-compat` → `@nota/s3-compat`

- [ ] **Step 2: Update dependency references in each package.json**

In each file, update `dependencies`, `devDependencies`, and `peerDependencies` that reference `@nota/*` or `@toeverything/*` (not `@blocksuite/*`) to `@nota/*`.

- [ ] **Step 3: Verify all common package names are renamed**

Run: `grep -r '"@nota/' packages/common/*/package.json`
Expected: No results

---

### Task 3: Rename all @nota/\* packages (frontend/)

**Files:**

- Modify: `packages/frontend/admin/package.json`
- Modify: `packages/frontend/component/package.json`
- Modify: `packages/frontend/core/package.json`
- Modify: `packages/frontend/electron-api/package.json`
- Modify: `packages/frontend/i18n/package.json`
- Modify: `packages/frontend/routes/package.json`
- Modify: `packages/frontend/templates/package.json`
- Modify: `packages/frontend/track/package.json`
- Modify: `packages/frontend/native/package.json`
- Modify: `packages/frontend/media-capture-playground/package.json`
- Modify: `packages/frontend/apps/web/package.json`
- Modify: `packages/frontend/apps/electron/package.json`
- Modify: `packages/frontend/apps/electron-renderer/package.json`
- Modify: `packages/frontend/apps/android/package.json`
- Modify: `packages/frontend/apps/ios/package.json`
- Modify: `packages/frontend/apps/mobile/package.json`
- Modify: `packages/frontend/apps/mobile-shared/package.json`

- [ ] **Step 1: Rename each package name field**

For each file, change `@nota/*` → `@nota/*` in the `"name"` field.

- [ ] **Step 2: Update dependency references in each package.json**

Update all `@nota/*` and `@toeverything/*` deps to `@nota/*`. Leave `@blocksuite/*` references untouched.

- [ ] **Step 3: Verify**

Run: `grep -r '"@nota/' packages/frontend/ --include="package.json" | grep -v blocksuite | grep -v node_modules`
Expected: No results

---

### Task 4: Rename tools and test packages

**Files:**

- Modify: `tools/cli/package.json` (`@nota-tools/cli` → `@nota-tools/cli`)
- Modify: `tools/utils/package.json` (`@nota-tools/utils` → `@nota-tools/utils`)
- Modify: `tools/@types/env/package.json` (`@types/affine__env` → `@types/nota__env`)
- Modify: `tests/kit/package.json` (`@nota-test/kit` → `@nota-test/kit`)
- Modify: `tests/affine-cloud/package.json` (`@nota-test/affine-cloud` → `@nota-test/nota-cloud`)
- Modify: `docs/reference/package.json` (`@nota/docs` → `@nota/docs`)

- [ ] **Step 1: Rename each package name and deps**

Update name fields and dependency references as listed.

- [ ] **Step 2: Rename test directories**

```bash
mv tests/affine-cloud tests/nota-cloud
mv tests/affine-cloud-copilot tests/nota-cloud-copilot
mv tests/affine-desktop tests/nota-desktop
mv tests/affine-desktop-cloud tests/nota-desktop-cloud
mv tests/affine-local tests/nota-local
mv tests/affine-mobile tests/nota-mobile
```

- [ ] **Step 3: Update package.json inside renamed test dirs**

Update name fields and internal references in each renamed test directory's `package.json`.

- [ ] **Step 4: Verify**

Run: `ls tests/ | grep affine`
Expected: No results

---

### Task 5: Update all TypeScript/JavaScript import statements

**Files:**

- Modify: All `.ts`, `.tsx`, `.js`, `.jsx` files under `packages/` and `tests/` that import from `@nota/*` or `@nota/infra`

- [ ] **Step 1a: Bulk replace @nota/ imports in packages/common/**

```bash
find packages/common -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' | \
  xargs sed -i "s|@nota/|@nota/|g"
```

Verify: `grep -r "from '@nota/" packages/common/ --include="*.ts" --include="*.tsx" | grep -v node_modules`

- [ ] **Step 1b: Bulk replace @nota/ imports in packages/frontend/**

```bash
find packages/frontend -path '*/node_modules' -prune -o \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -print | \
  xargs sed -i "s|@nota/|@nota/|g"
```

**IMPORTANT**: After this, restore any `@blocksuite/affine` that got incorrectly changed. Check:

```bash
grep -r "@nota/affine" packages/frontend/ --include="*.ts" --include="*.tsx" | head -5
```

If any `@blocksuite/affine` was wrongly changed to `@blocksuite/nota`, it won't match this pattern since we only replaced `@nota/`. But verify `@blocksuite/affine` imports are still intact:

```bash
grep -r "@blocksuite/affine" packages/frontend/ --include="*.ts" --include="*.tsx" | head -5
```

- [ ] **Step 1c: Bulk replace @nota/ imports in tests/ and tools/**

```bash
find tests tools -path '*/node_modules' -prune -o \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -print | \
  xargs sed -i "s|@nota/|@nota/|g; s|@nota-tools/|@nota-tools/|g; s|@nota-test/|@nota-test/|g"
```

- [ ] **Step 1d: Replace @nota/infra imports (outside blocksuite)**

```bash
find packages tests tools -path '*/node_modules' -prune -o -path 'blocksuite' -prune -o \( -name '*.ts' -o -name '*.tsx' \) -print | \
  xargs sed -i "s|@nota/infra|@nota/infra|g"
```

- [ ] **Step 2: Update any remaining @toeverything references outside blocksuite**

Check for `@toeverything/theme`, `@toeverything/pdf-viewer` etc. in `packages/` and update if they are local packages (not npm dependencies).

```bash
grep -r "@toeverything/" packages/ tests/ tools/ --include="*.ts" --include="*.tsx" | grep -v blocksuite | grep -v node_modules
```

Update any found references.

- [ ] **Step 3: Verify no stale imports**

Run: `grep -r "from '@nota/" packages/ tests/ tools/ --include="*.ts" --include="*.tsx" | grep -v blocksuite | grep -v node_modules | head -20`
Expected: No results

Run: `grep -r "from '@toeverything/" packages/ tests/ tools/ --include="*.ts" --include="*.tsx" | grep -v blocksuite | grep -v node_modules | head -20`
Expected: No results

- [ ] **Step 4: Test build**

Run: `yarn install`
Expected: Resolves all workspace dependencies

Run: `yarn build` (or `yarn typecheck` if full build is too heavy)
Expected: No import resolution errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rename @nota/* packages to @nota/* namespace"
```

---

## Chunk 2: Rust Crate Rename

### Task 6: Rename all Rust crates

**Files:**

- Modify: `Cargo.toml` (root workspace)
- Modify: `packages/frontend/native/Cargo.toml` (`affine_native` → `nota_native`)
- Modify: `packages/frontend/mobile-native/Cargo.toml` (`affine_mobile_native` → `nota_mobile_native`)
- Modify: `packages/frontend/native/nbstore/Cargo.toml` (`affine_nbstore` → `nota_nbstore`)
- Modify: `packages/frontend/native/schema/Cargo.toml` (`affine_schema` → `nota_schema`)
- Modify: `packages/frontend/native/sqlite_v1/Cargo.toml` (`affine_sqlite_v1` → `nota_sqlite_v1`)
- Modify: `packages/frontend/native/media_capture/Cargo.toml` (`affine_media_capture` → `nota_media_capture`)
- Skip: `packages/common/y-octo/` — confirmed no `affine` references

- [ ] **Step 1: Update root Cargo.toml workspace deps**

Replace `affine_nbstore` → `nota_nbstore` in workspace dependency definitions.

**Note**: `affine_common` is referenced but its path `packages/common/native` does not exist (removed during EE cleanup). Remove the `affine_common` entry from the root workspace deps entirely rather than renaming it.

- [ ] **Step 2: Update each crate's Cargo.toml**

For each file, change:

- `name = "affine_*"` → `name = "nota_*"`
- All dependency references from `affine_*` to `nota_*`
- Remove any `affine_common` dependency references (crate doesn't exist)

- [ ] **Step 3: Update Rust source files**

Replace `use affine_*` and `extern crate affine_*` with `nota_*` equivalents in all `.rs` files under `packages/frontend/native/` and `packages/frontend/mobile-native/`.

```bash
find packages/frontend/native packages/frontend/mobile-native -name '*.rs' | \
  xargs sed -i 's/affine_/nota_/g'
```

- [ ] **Step 4: Update NAPI binding configs**

Check for `napi` build scripts or configs that reference `affine_native` and update to `nota_native`.

```bash
grep -r "affine_native" packages/frontend/native/ --include="*.json" --include="*.js" --include="*.toml"
```

- [ ] **Step 5: Verify Rust build**

Run: `cargo build --workspace`
Expected: All crates compile successfully

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rename affine_* Rust crates to nota_*"
```

---

## Chunk 3: Mobile Platform Configs

### Task 7: Android rebrand

**Files:**

- Modify: `packages/frontend/apps/android/App/app/build.gradle`
- Modify: `packages/frontend/apps/android/App/service/build.gradle`
- Modify: `packages/frontend/apps/android/App/app/src/main/AndroidManifest.xml`
- Move + Modify: All 34 Kotlin files under `packages/frontend/apps/android/App/app/src/main/java/app/affine/pro/` → `app/nota/pro/`
- Move + Modify: `uniffi/affine_mobile_native/` → `uniffi/nota_mobile_native/`

- [ ] **Step 1: Update build.gradle files**

In `app/build.gradle`:

- `namespace "app.nota.pro"` → `namespace "app.nota.pro"`
- `applicationId "app.nota.pro"` → `applicationId "app.nota.pro"`
- `libname = "affine_mobile_native"` → `libname = "nota_mobile_native"`
- `targetIncludes = ["libaffine_mobile_native.so"]` → `targetIncludes = ["libnota_mobile_native.so"]`
- Update uniffi-bindgen command references

In `service/build.gradle`:

- `service("affine")` → `service("nota")`
- `packageName.set("com.nota.pro.graphql")` → `packageName.set("com.nota.pro.graphql")`

- [ ] **Step 2: Update AndroidManifest.xml**

- `android:name=".AFFiNEApp"` → `android:name=".NotaApp"`
- `android:scheme="affine"` → `android:scheme="nota"`

- [ ] **Step 3: Move Kotlin source directory**

```bash
cd packages/frontend/apps/android/App/app/src/main/java
mv app/affine app/nota
```

- [ ] **Step 4a: Bulk replace package/import declarations in Kotlin**

```bash
find packages/frontend/apps/android -name '*.kt' | \
  xargs sed -i 's/app\.affine\.pro/app.nota.pro/g; s/uniffi\.affine_mobile_native/uniffi.nota_mobile_native/g'
```

- [ ] **Step 4b: Rename Kotlin class names**

In the relevant files:

- `AFFiNEApp` → `NotaApp` (in NotaApp.kt, rename file too)
- `AFFiNEAppBar` → `NotaAppBar` (in components/)
- `AFFiNEIcon` → `NotaIcon` (in components/)
- `AFFiNEThemePlugin` → `NotaThemePlugin` (in plugin/)
- `AffineDebugTree` → `NotaDebugTree` (in utils/logger/)

Rename the files themselves to match new class names.

- [ ] **Step 5: Update uniffi bindings directory**

```bash
cd packages/frontend/apps/android/App/app/src/main/java
mv uniffi/affine_mobile_native uniffi/nota_mobile_native
```

Update the generated binding file references inside.

- [ ] **Step 6: Verify Android build**

Run: `cd packages/frontend/apps/android/App && ./gradlew assembleDebug`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: rebrand Android app from affine to nota"
```

---

### Task 8: iOS rebrand

**Files:**

- Modify: `packages/frontend/apps/ios/App/App.xcodeproj/project.pbxproj`
- Rename: `packages/frontend/apps/ios/App/App.xcodeproj/xcshareddata/xcschemes/AFFiNE.xcscheme` → `Nota.xcscheme`
- Modify: `packages/frontend/apps/ios/App/App/AffineViewController+AIButton.swift`
- Modify: `packages/frontend/apps/ios/App/App/AppConfigManager.swift`
- Modify: `packages/frontend/apps/ios/App/App/uniffi/affine_mobile_native.swift`
- Modify: `packages/frontend/apps/ios/App/Packages/AffineGraphQL/Package.swift`
- Rename: iOS splash assets `affine@png-*.png` → `nota@png-*.png`
- Modify: `packages/frontend/apps/ios/App/App/Assets.xcassets/Splash.imageset/Contents.json`

- [ ] **Step 1: Update project.pbxproj (bulk replace)**

This file has ~67 `affine` occurrences. Use sed for bulk replace:

```bash
sed -i 's/affine_mobile_native/nota_mobile_native/g; s/PRODUCT_BUNDLE_IDENTIFIER = app\.affine\.pro/PRODUCT_BUNDLE_IDENTIFIER = app.nota.pro/g' \
  packages/frontend/apps/ios/App/App.xcodeproj/project.pbxproj
```

Review the result to ensure no over-replacement.

- [ ] **Step 2: Rename xcscheme**

```bash
mv "packages/frontend/apps/ios/App/App.xcodeproj/xcshareddata/xcschemes/AFFiNE.xcscheme" \
   "packages/frontend/apps/ios/App/App.xcodeproj/xcshareddata/xcschemes/Nota.xcscheme"
```

Update internal references in the scheme file from `AFFiNE` to `Nota`.

- [ ] **Step 3: Update Swift source files**

In `AffineViewController+AIButton.swift`:

- `com.affine.intelligents.userConsented` → `com.nota.intelligents.userConsented`
- Rename file to `NotaViewController+AIButton.swift`

In `AppConfigManager.swift`:

- `affineVersion` → `notaVersion`
- `getAffineVersion()` → `getNotaVersion()`

In `uniffi/affine_mobile_native.swift`:

- `affine_mobile_nativeFFI` → `nota_mobile_nativeFFI`
- All internal references (bulk sed)

- [ ] **Step 4: Rename GraphQL package**

Rename `AffineGraphQL` → `NotaGraphQL` in `Package.swift` and all import references.
Rename directory if needed: `Packages/AffineGraphQL/` → `Packages/NotaGraphQL/`

- [ ] **Step 5: Rename splash assets**

```bash
cd packages/frontend/apps/ios/App/App/Assets.xcassets/Splash.imageset/
mv affine@png-1.png nota@png-1.png
mv affine@png-2.png nota@png-2.png
mv affine@png-3.png nota@png-3.png
```

Update `Contents.json` to reference new filenames.

- [ ] **Step 6: Verify iOS build**

Run: `cd packages/frontend/apps/ios/App && xcodebuild -scheme Nota -configuration Debug build`
Expected: Build succeeds (or at minimum no unresolved references)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: rebrand iOS app from affine to nota"
```

---

## Chunk 4: URLs, Docs, Configs & Assets

### Task 9: Update README.md

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace all AFFiNE URLs and references**

- `https://cdn.nota.pro/*` → remove or replace with local asset paths
- `https://app.nota.pro` → `https://app.nota.pro` (or remove)
- `https://docs.nota.pro/*` → `https://docs.nota.pro` (or remove)
- `https://github.com/heyyykk3/nota` → `https://github.com/heyyykk3/nota`
- `toeverything` → `heyyykk3` (in GitHub URLs)
- Remove ProductHunt badge (AFFiNE-specific)
- Remove `affine (əˈfʌɪn | a-fine)` etymology reference
- `@nota/component` → `@nota/component` in package references
- `@toeverything/theme` → `@nota/theme`
- Remove references to `awesome-affine`, `OctoBase`
- Update Sealos/ClawCloud deploy links or remove them
- Update contributor image URL

- [ ] **Step 2: Verify no nota.pro URLs remain**

Run: `grep -i "affine" README.md`
Expected: Only LICENSE attribution line if any

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rebrand README from AFFiNE to Nota"
```

---

### Task 10: Update GitHub configs

**Files:**

- Modify: `.github/CLA.md`
- Modify: `.github/FUNDING.yml`
- Modify: `.github/CODEOWNERS`
- Modify: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `.github/ISSUE_TEMPLATE/BUG-REPORT.yml`
- Modify: `.github/ISSUE_TEMPLATE/FEATURE-REQUEST.yml`
- Modify: `.github/actions/build-rust/action.yml`
- Modify: `.github/actions/setup-node/action.yml`
- Modify: `.github/actions/deploy/action.yml`
- Modify: `.github/actions/deploy/deploy.mjs`
- Modify: `.github/actions/server-test-env/action.yml`
- Modify: `.github/actions/copilot-test/action.yml`
- Modify: `.github/actions/cluster-auth/action.yml` (if affine refs exist)
- Modify: `.github/actions/download-web/action.yml` (if affine refs exist)
- Modify: `.github/actions/prepare-release/action.yml` (if affine refs exist)
- Modify: `.github/actions/setup-sentry/action.yml` (if affine refs exist)
- Modify: `.github/actions/setup-version/action.yml` (if affine refs exist)
- Check: `.github/labeler.yml`, `.github/auto_assign.yml`, `.github/renovate.json` for affine refs

- [ ] **Step 1: Update CLA.md**

- `AFFiNE Contributor License Agreement` → `Nota Contributor License Agreement`
- Remove `TOEVERYTHING PTE. LTD registered in Republic of Singapore`
- Update CLA link from `cla-assistant.io/heyyykk3/nota`
- Replace all `AFFiNE` with `Nota`

- [ ] **Step 2: Update FUNDING.yml**

- Remove `github: [toeverything]` or update to your GitHub username

- [ ] **Step 3: Update CODEOWNERS**

- Remove `@toeverything/blocksuite-core` references or update to your team

- [ ] **Step 4: Update issue templates**

In all 3 template files:

- Replace `heyyykk3/nota` → `heyyykk3/nota`
- Replace `nota.pro` URLs with `nota.pro` equivalents or remove
- Replace `AFFiNE` with `Nota` in descriptions

- [ ] **Step 5: Update all GitHub Actions (bulk)**

In ALL action files under `.github/actions/`:

- `'AFFiNE Rust build'` → `'Nota Rust build'`
- `'AFFiNE Node.js Setup'` → `'Nota Node.js Setup'`
- `scope: '@toeverything'` → `scope: '@nota'` (or remove if not publishing)
- `@nota/server` → `@nota/server` in commands
- `@nota-test/*` → `@nota-test/*`
- `NOTA_INDEXER_*` → `NOTA_INDEXER_*` env vars in deploy.mjs
- Update database names in test envs if desired (cosmetic)

- [ ] **Step 6: Check remaining .github/ config files**

```bash
grep -ri "affine\|toeverything" .github/*.yml .github/*.json .github/*.yaml 2>/dev/null | grep -v workflows | grep -v helm
```

Update any found references.

- [ ] **Step 7: Commit**

```bash
git add .github/
git commit -m "docs: rebrand GitHub configs from AFFiNE to Nota"
```

---

### Task 11: Update docs/

**Files:**

- Modify: `docs/CONTRIBUTING.md`
- Modify: `docs/BUILDING.md`
- Modify: `docs/building-desktop-client-app.md`
- Modify: `docs/developing-server.md`
- Modify: `docs/types-of-contributions.md`
- Modify: `docs/contributing/releases.md`
- Modify: `docs/reference/package.json`
- Modify: `docs/reference/readme.md`

- [ ] **Step 1: Update all docs**

In each file:

- `heyyykk3/nota` → `heyyykk3/nota`
- `docs.nota.pro` → `docs.nota.pro` (or remove)
- `@nota/*` → `@nota/*` in all package references
- `yarn affine` → `yarn nota` (if the CLI command was renamed)
- `AFFiNE` → `Nota` in prose

For `docs/developing-server.md` — add note at top: "Note: The backend server is not included in Nota. This document is retained for reference only."

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "docs: rebrand documentation from AFFiNE to Nota"
```

---

### Task 12: Update Docker configs

**Files:**

- Modify: `.docker/dev/.env.example`
- Modify: `.docker/dev/README.md`
- Modify: `.docker/dev/compose.yml.example`
- Modify: `.docker/selfhost/.env.example`
- Modify: `.docker/selfhost/compose.yml`
- Modify: `.docker/selfhost/config.example.json`
- Modify: `.docker/selfhost/schema.json`

- [ ] **Step 1: Update all Docker files**

- `ghcr.io/heyyykk3/nota` → `ghcr.io/heyyykk3/nota`
- `NOTA_REVISION` → `NOTA_REVISION`
- `NOTA_SERVER_HOST` → `NOTA_SERVER_HOST`
- `NOTA_INDEXER_ENABLED` → `NOTA_INDEXER_ENABLED`
- `affine_dev_services` → `nota_dev_services`
- Container names: `affine_server` → `nota_server`, `affine_redis` → `nota_redis`, `affine_postgres` → `nota_postgres`, `affine_migration_job` → `nota_migration_job`
- `~/.affine/` → `~/.nota/`
- `AFFiNE Self Hosted Server` → `Nota Self Hosted Server`
- `AFFiNE Application Configuration` → `Nota Application Configuration`
- `cluster.name=affine-dev` → `cluster.name=nota-dev`
- `yarn affine cert` → `yarn nota cert`
- Database names/users can stay as-is (internal, not branding)

- [ ] **Step 2: Commit**

```bash
git add .docker/
git commit -m "feat: rebrand Docker configs from AFFiNE to Nota"
```

---

### Task 13: Rename asset files

**Files:**

- Rename: `packages/frontend/templates/stickers/Contorted Stickers/Content/AFFiNE.svg` → `Nota.svg`
- Rename: `packages/frontend/templates/stickers/Contorted Stickers/Cover/AFFiNE.svg` → `Nota.svg`
- Rename: `packages/frontend/templates/stickers/Paper/Content/AFFiNE AI.svg` → `Nota AI.svg`
- Rename: `packages/frontend/templates/stickers/Paper/Cover/AFFiNE AI.svg` → `Nota AI.svg`
- Rename: `packages/frontend/core/public/imgs/affine-text-logo.png` → `nota-text-logo.png`
- Delete: `packages/frontend/apps/electron/resources/affine.metainfo.xml` (nota.metainfo.xml already exists)
- Rename: `packages/frontend/apps/electron/resources/icons/affine_installing.gif` → `nota_installing.gif`
- Rename: `tests/fixtures/affine-preview.png` → `nota-preview.png`
- Rename: `tests/fixtures/affine.svg` → `nota.svg`

- [ ] **Step 1: Rename all asset files**

Execute the renames listed above. For `affine.metainfo.xml`, delete it since `nota.metainfo.xml` already exists.

- [ ] **Step 2: Update all source code references to renamed assets**

Search for old filenames in `.ts`, `.tsx`, `.json`, `.xml`, `.html` files and update to new names:

```bash
grep -r "affine-text-logo\|affine_installing\|affine-preview\|affine\.svg\|AFFiNE\.svg\|AFFiNE AI\.svg" packages/ tests/ --include="*.ts" --include="*.tsx" --include="*.json" | grep -v node_modules
```

Update all found references.

- [ ] **Step 3: Update metainfo.xml content**

In `nota.metainfo.xml`, replace any remaining `AFFiNE` references with `Nota`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: rename AFFiNE-branded assets to Nota"
```

---

## Chunk 5: CI/CD & Helm

### Task 14: Update GitHub workflows

**Files:**

- Modify: `.github/workflows/build-images.yml`
- Modify: `.github/workflows/build-test.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/release-mobile.yml`
- Modify: `.github/workflows/release-desktop.yml`
- Modify: `.github/workflows/release-desktop-platform.yml`
- Modify: `.github/workflows/release-cloud.yml`
- Modify: `.github/workflows/pr-title-lint.yml`
- Modify: `.github/workflows/copilot-test.yml`
- Modify: `.github/workflows/copilot-test-automatically.yml`
- Modify: `.github/workflows/auto-labeler.yml`
- Modify: `.github/workflows/windows-signer.yml`
- Modify: Any other workflow files with affine/toeverything references

- [ ] **Step 1: Update all workflow files**

In each workflow:

- `ghcr.io/heyyykk3/nota` → `ghcr.io/heyyykk3/nota`
- `@nota/*` → `@nota/*` in all yarn workspace commands
- `@nota-test/*` → `@nota-test/*`
- `@nota/infra` → `@nota/infra`
- `SENTRY_PROJECT: 'affine'` → `SENTRY_PROJECT: 'nota'`
- `scope: '@toeverything'` → `scope: '@nota'`
- Mac signing: Remove `"Developer ID Application: TOEVERYTHING PTE. LTD."` reference in `release-desktop-platform.yml` — replace with a placeholder or your own cert identity

- [ ] **Step 2: Verify no stale references**

Run: `grep -r "toeverything\|@nota/" .github/workflows/`
Expected: No results

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: rebrand workflows from AFFiNE to Nota"
```

---

### Task 15: Update Helm charts

**Files:**

- Move: `.github/helm/affine/` → `.github/helm/nota/`
- Modify: `.github/helm/releaser.yaml`
- Modify: All files under `.github/helm/nota/` (after rename)

- [ ] **Step 1: Rename helm chart directory**

```bash
mv .github/helm/affine .github/helm/nota
```

- [ ] **Step 2: Update Chart.yaml**

- `name: affine` → `name: nota`
- `description: AFFiNE cloud chart` → `description: Nota cloud chart`

- [ ] **Step 3: Update values.yaml and templates**

- All `affine` service names → `nota`
- `nota.pro` domain → `nota.pro`
- `ghcr.io/heyyykk3/nota` → `ghcr.io/heyyykk3/nota`
- Template helper names: `affine.name` → `nota.name`, `affine.fullname` → `nota.fullname`, `affine.chart` → `nota.chart`, `affine.labels` → `nota.labels`, `affine.selectorLabels` → `nota.selectorLabels`

- [ ] **Step 4: Remove backend subcharts**

Delete `.github/helm/nota/charts/graphql/` — backend is removed from Nota.

- [ ] **Step 5: Update releaser.yaml**

- `owner: toeverything` → `owner: heyyykk3`

- [ ] **Step 6: Verify helm chart**

Run: `helm lint .github/helm/nota/`
Expected: Linting passes

- [ ] **Step 7: Commit**

```bash
git add .github/helm/
git commit -m "ci: rebrand Helm charts from AFFiNE to Nota"
```

---

### Task 16: Final verification sweep

- [ ] **Step 1: Run comprehensive grep for "affine"**

```bash
grep -ri "affine" \
  --include="*.json" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" \
  --include="*.md" --include="*.gradle" --include="*.xml" --include="*.swift" --include="*.toml" \
  --include="*.kt" --include="*.pbxproj" --include="*.plist" --include="*.env" \
  . | grep -v blocksuite | grep -v node_modules | grep -v ".git/" | grep -v "com\.affine\." | grep -v "Based on AFFiNE"
```

Expected: Zero results

- [ ] **Step 2: Run comprehensive grep for "TOEVERYTHING"**

```bash
grep -ri "toeverything\|TOEVERYTHING" \
  --include="*.json" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" \
  --include="*.md" --include="*.gradle" --include="*.xml" --include="*.swift" --include="*.toml" \
  --include="*.kt" --include="*.mjs" \
  . | grep -v blocksuite | grep -v node_modules | grep -v ".git/" | grep -v LICENSE
```

Expected: Zero results

- [ ] **Step 3: Test full build**

```bash
yarn install
yarn build
cargo build --workspace
```

Expected: All pass

- [ ] **Step 4: Final commit if any stragglers found**

```bash
git add -A
git commit -m "chore: fix remaining AFFiNE references missed in rebrand"
```
