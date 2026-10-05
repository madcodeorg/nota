# Publication Audit

## Status

Current-tree CI and contributor setup cleanup is complete. Public release is
not cleared: repository history and distribution licensing still need review.
Do not describe the entire repository history as MIT-only.

## Security And Privacy

- Gitleaks scanned all local refs (84 commits, approximately 92 MB) on
  September 21, 2026. One private-key finding was reported.
- The finding is in original import commit
  `d78a02a85d72c1a0210e9333d76ece852078395f`, at
  `packages/backend/server/src/core/doc/__tests__/reader-from-rpc.spec.ts:38`.
  Surrounding code explicitly labels it a test key and uses it in test setup.
  This supports fixture classification, but does not prove it was never reused.
  It has not been allowlisted. Do not use this key for any real service.
- Local agent state, SQLite memory, browser console logs, and Electron logs are
  removed from the index and ignored. Local copies remain intact. Historical
  copies remain reachable; deleting current files does not sanitize history.
- Secret scanning is heuristic, not proof that no credentials or private content
  exist. Do not publish raw audit reports containing sensitive values.

## License Provenance

- The original import's root LICENSE explicitly assigns different terms to
  `packages/backend` and `packages/common/native`, with the other code subject
  to its MIT notice and third-party exceptions.
- Its `packages/backend/server/LICENSE` contains AFFiNE Enterprise Edition
  terms and an MPL2.0 provision. Preserve and review those original terms for
  historical content; the current root MIT notice is not a substitute.
- The removed upstream backend and common/native directories are absent from
  the current source tree, but their contents remain in Git history. Current
  backend/ai is a different package; this audit is not a line-by-line provenance
  clearance for it or relocated code.
- Model registry license strings are metadata, not a complete redistribution
  review. Verify pinned model/runtime licenses and include required notices
  before distributing model-seeded installers. Do not label model weights MIT
  merely because Nota's application code uses MIT.

## Completed Checks

- An isolated export of the staged source tree passed Gitleaks with no findings
  (approximately 48.64 MB). This excludes unstaged meeting/AI work and local data.
- Immutable Yarn 4.12.0 dependency installation in that isolated export passed
  with peer-dependency warnings. Scripts were disabled and `--mode=skip-build`
  was used: this verifies resolution/fetch/link, not native builds or postinstall.
- All 39 targeted publication/CI/release/billing cleanup tests passed.
- Source-only export excludes the two checked-in root native runtime libraries
  pending build provenance verification; local copies and packaging are unchanged.
- Executable export regression tests verify committed-only contents, independent
  history, no remotes, runtime exclusion, source-scan failure, forbidden state,
  and existing destination/symlink rejection.
- Obsolete server/Copilot jobs and deployment assets removed.
- Active CI job graph, final gate, local action references, and workspace
  references covered by regression tests.
- Release versioning no longer targets removed Helm paths or the old AFFiNE
  Linux metadata filename.
- Contributor Node/Yarn versions and setup commands aligned with repository
  manifests; deleted server-native setup command removed.

## Remaining Publication Gates

A history-isolated candidate can now be prepared using
`scripts/prepare-publication-snapshot.sh`; see `docs/PUBLICATION.md`. The export
does not carry the historical key, removed local-state files, or old restricted
directories. This is an alternative to rewriting the development repository,
not a complete current-tree license clearance.

1. Review historical local-state content privately and decide whether to publish
   sanitized history or a separately prepared, provenance-reviewed source
   snapshot. Do not force-push or rewrite shared history without approval.
2. Resolve historical restricted-code distribution and current code/assets/model
   licensing with the relevant owners or qualified counsel as appropriate.
3. Complete clean-environment dependency installation/build and hosted CI. Local
   builds with existing dependencies are not equivalent to a clean install.
4. Keep Windows, native iOS, packaged recording/restart recovery, and notarization
   limitations explicit for any preview release.
