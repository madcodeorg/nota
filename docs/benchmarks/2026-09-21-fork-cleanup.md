# Upstream Fork Cleanup

## Removed

- Unused subscription notifications, survey links, and checkout callback helpers.
- Dead subscription properties passed through the AI chat peek view to a composer
  that no longer consumes them.
- Unused subscription prices entity and registration, checkout creation, and
  subscription mutation methods.
- Obsolete Copilot server-test workflows targeting removed backend packages.
- Cloud release and Docker image jobs, their reusable workflows, and exclusively
  referenced deployment actions and Dockerfile.

## Preserved

- Subscription status queries and account cache for iOS bridge and shared-page
  account consumers. This is compatibility code, not a local AI subscription gate.
- Self-hosted connections, account authentication, Google Drive, local storage,
  editor document identifiers, and license notices.
- Desktop/mobile release configuration and canary gating.
- Generated GraphQL contracts and still-referenced Helm assets.

## Validation

- 30 targeted billing-cleanup, release-workflow, and STT-packaging tests passed.
- Frontend core TypeScript check and scoped Oxlint/Prettier passed.
- Production Electron asset generation, including renderer and build layers,
  passed with bundle-size and outdated Browserslist warnings.
- No installed app replacement, restart, profile mutation, or live release.

This does not establish Windows runtime compatibility, iOS device validation,
GitHub branch-protection compatibility, or packaged offline recovery correctness.
