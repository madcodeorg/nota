# Codebase guide

Start with [Building Nota](../BUILDING.md) and the [contribution guide](../CONTRIBUTING.md).

## Main packages

- `packages/frontend/core`: workspace UI, documents, meeting settings, AI settings, and editor integration.
- `packages/frontend/apps/electron`: desktop main, helper, and preload processes, local runtime packaging, and installers.
- `packages/frontend/apps/electron-renderer`: desktop renderer entry point.
- `packages/frontend/native`: Rust-backed desktop storage, indexing, and media capture.
- `packages/common/nbstore`: shared document/blob storage, local SQLite and IndexedDB implementations, and sync paths.
- `packages/backend/ai`: the local AI service, managed model catalog, meeting transcription, workspace search, and the shared provider/tool loop.
- `blocksuite`: the editor and its framework. Preserve its upstream notices and package identities.
- `tools`: build and development tooling.
- `tests`: integration and end-to-end tests.

Local workspace data remains canonical. Meeting results belong in workspace documents and blobs; search mirrors and other derived indexes are rebuildable caches. Hosted AI providers are explicit user choices.

## Development entry points

From the repository root:

```sh
# Web UI
yarn dev --package @nota/web

# Frontend with the local AI service
yarn dev:ai

# AI service only
yarn dev:ai-backend
```

For the Electron renderer and desktop process, follow the [desktop development guide](../building-desktop-client-app.md#development).

For changes to AI or meetings, see [Local AI backend](../developing-ai-backend.md).
