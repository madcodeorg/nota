# Nota Cloud Storage & Google Drive Sync — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Scope:** Google Drive sync using existing nbstore architecture

---

## Overview

Replace AFFiNE's removed EE cloud backend with Google Drive sync. Users sync workspace data to their own Google Drive. The system plugs into the existing nbstore storage architecture — we implement `DocStorage`, `BlobStorage` etc. for Google Drive, register them as a new workspace flavour, and the existing sync engine handles the rest.

**Key principles:**

- Local-first: all data lives locally, cloud is optional backup/sync
- Provider-agnostic: implements nbstore storage interfaces, future providers (Nota Cloud, OneDrive, Dropbox) follow same pattern
- No server infrastructure needed
- Production-grade config (env vars, no hardcoding)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Nota Frontend                     │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │ Local Store   │    │ nbstore sync engine       │   │
│  │ (IndexedDB/   │◄──►│ DocFrontend, BlobFrontend│   │
│  │  SQLite)      │    │                          │   │
│  └──────────────┘    │    ┌──────────────────┐  │   │
│                       │    │ Remote Storage:  │  │   │
│                       │    │ GoogleDriveDoc   │  │   │
│                       │    │ GoogleDriveBlob  │  │   │
│                       │    └──────────────────┘  │   │
│                       └──────────────────────────┘   │
│                                                      │
│  ┌──────────────┐                                    │
│  │ Google Auth   │ ← OAuth 2.0 PKCE                 │
│  │ Module        │                                    │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
         │
         ▼
   Google Drive API v3
   (appDataFolder space)
```

## Module 1: nbstore Storage Implementations for Google Drive

### Location

`packages/common/nbstore/src/impls/google-drive/`

### What we implement

Following the same pattern as existing `CloudDocStorage` and `CloudBlobStorage` in `packages/common/nbstore/src/impls/cloud/`:

| nbstore Interface      | Google Drive Implementation | Notes                                              |
| ---------------------- | --------------------------- | -------------------------------------------------- |
| `DocStorageBase`       | `GoogleDriveDocStorage`     | Read/write Y.js docs as Drive files                |
| `BlobStorageBase`      | `GoogleDriveBlobStorage`    | Read/write blobs (images, attachments)             |
| `DocSyncStorageBase`   | _local only_                | Sync progress tracked locally (same as cloud impl) |
| `BlobSyncStorageBase`  | _local only_                | Sync progress tracked locally                      |
| `AwarenessStorageBase` | `DummyAwarenessStorage`     | No real-time presence without WebSocket            |
| Connection             | `GoogleDriveConnection`     | Manages auth tokens, API client, online/offline    |

### Registration

In `packages/common/nbstore/src/impls/index.ts`, register new implementations:

```typescript
// Add to AvailableStorageImplementations
'google-drive:doc': GoogleDriveDocStorage,
'google-drive:blob': GoogleDriveBlobStorage,
```

### Data layout in Google Drive (flat naming)

Using flat file naming at appDataFolder root to minimize API calls (no nested folder traversal):

```
appDataFolder/
├── nota_config.json
├── ws_{workspaceId}_meta.json
├── ws_{workspaceId}_doc_{docId}_snapshot.ydoc
├── ws_{workspaceId}_doc_{docId}_update_{timestamp}_{deviceId}.bin
├── ws_{workspaceId}_blob_{blobId}
└── ...
```

File naming convention:

- Prefix: `ws_{workspaceId}_` for workspace scoping
- Doc snapshots: `_doc_{docId}_snapshot.ydoc`
- Doc updates: `_doc_{docId}_update_{timestamp}_{deviceId}.bin` (deviceId prevents collisions across devices)
- Blobs: `_blob_{blobId}`
- All files searchable via Drive API `q` parameter with `name contains` queries

### DocStorage implementation

```typescript
class GoogleDriveDocStorage extends DocStorageBase {
  // getDoc: search for snapshot file, download, return Y.js state
  // pushDocUpdate: create a timestamped update file
  // getDocUpdates: list all update files since timestamp, download and return
  // deleteDoc: find and delete all files matching doc prefix
  // Compaction: every 50 updates, merge into new snapshot, delete old updates
  // Uses Drive file properties to store metadata (timestamp, size)
}
```

### BlobStorage implementation

```typescript
class GoogleDriveBlobStorage extends BlobStorageBase {
  // getBlob: search by blob ID, download
  // setBlob: upload file with blob ID name
  // deleteBlob: find and delete
  // listBlobs: search all files matching blob prefix
}
```

### GoogleDriveConnection

```typescript
class GoogleDriveConnection extends AutoReconnectConnection {
  // Manages Google OAuth access token
  // Handles token refresh
  // Provides authenticated fetch wrapper
  // Tracks online/offline state
  // Rate limiting: request queue, max 10 concurrent, exponential backoff on 429
  // Per-user rate limit: 12,000 requests per 60 seconds
}
```

### Multi-device sync safety

- **Update file naming**: includes `{deviceId}` (random UUID generated per device, stored in localStorage) to prevent timestamp collisions
- **Compaction coordination**: before compacting, create a `_doc_{docId}_compacting_{deviceId}` lock file. Check for existing lock files before starting compaction. Lock expires after 5 minutes.
- **Snapshot updates**: use Drive's `If-Match` etag header for conditional writes to prevent overwriting concurrent snapshot updates

## Module 2: Google OAuth

### Location

`packages/frontend/core/src/modules/google-auth/`

### Files

- `index.ts` — module definition, DI registration
- `services/google-auth.ts` — auth service
- `entities/google-session.ts` — session entity with LiveData
- `views/google-sign-in-button.tsx` — sign-in button component

### Configuration (environment-based, never hardcoded)

```typescript
// tools/utils/src/build-config.ts
BUILD_CONFIG = {
  ...existing,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  // Empty string = Google Drive features hidden in UI
};

// In code:
const GOOGLE_CLIENT_ID = BUILD_CONFIG.googleClientId;
const GOOGLE_REDIRECT_URI = `${window.location.origin}/auth/callback`;
const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'];
```

### OAuth flow (PKCE, no backend needed)

1. Generate `code_verifier` (random 128 bytes, base64url)
2. Compute `code_challenge` = SHA256(code_verifier), base64url
3. Open popup to `accounts.google.com/o/oauth2/v2/auth` with:
   - `client_id`, `redirect_uri`, `scope`, `response_type=code`
   - `code_challenge`, `code_challenge_method=S256`
   - `access_type=offline` (to get refresh_token)
   - `prompt=consent` (ensure refresh_token on first auth)
4. On callback at `/auth/callback`, exchange code + code_verifier for tokens
5. Store tokens, start using Drive API

### Token storage (per-platform)

| Platform | Storage                       | Notes                                                                          |
| -------- | ----------------------------- | ------------------------------------------------------------------------------ |
| Web      | localStorage                  | Tokens are opaque to other origins; XSS is the main risk (same as any web app) |
| Electron | safeStorage API / OS keychain | Encrypted with OS-level protection                                             |
| iOS      | Keychain                      | Via native bridge                                                              |
| Android  | EncryptedSharedPreferences    | Via native bridge                                                              |

### Token refresh handling

- Access tokens expire in 1 hour; auto-refresh 5 min before expiry
- Refresh tokens for unverified apps expire after 7 days
- On refresh failure: set auth status to 'disconnected', show "Reconnect" prompt in UI
- Never lose local data on auth failure — sync just pauses

### Per-platform redirect URI

| Platform    | Redirect URI                                              |
| ----------- | --------------------------------------------------------- |
| Web         | `{origin}/auth/callback`                                  |
| Electron    | `http://localhost:{random-port}/auth/callback` (loopback) |
| iOS/Android | Deep link `nota://auth/callback` (future)                 |

## Module 3: Google Drive Workspace Flavour Provider

### Location

`packages/frontend/core/src/modules/workspace-engine/impls/google-drive.ts`

### Implementation

Following the exact pattern of `LocalWorkspaceFlavourProvider` and `CloudWorkspaceFlavourProvider`:

```typescript
class GoogleDriveWorkspaceFlavourProvider implements WorkspaceFlavourProvider {
  flavour = 'google-drive';

  async listWorkspaces(): Promise<WorkspaceMetadata[]> {
    // Search Drive for all ws_*_meta.json files
    // Parse and return workspace metadata
  }

  async createWorkspace(initial: (docCollection: DocCollection) => void): Promise<WorkspaceMetadata> {
    // Create local workspace first
    // Upload meta.json to Drive
    // Return metadata with flavour 'google-drive'
  }

  async deleteWorkspace(id: string): Promise<void> {
    // Delete all Drive files matching ws_{id}_*
    // Delete local storage
  }

  getEngineWorkerInitOptions(workspaceId: string): WorkerInitOptions {
    return {
      local: {
        doc: { name: 'idb', opts: { ... } },        // same as local flavour
        blob: { name: 'idb', opts: { ... } },
        docSync: { name: 'idb', opts: { ... } },
        blobSync: { name: 'idb', opts: { ... } },
      },
      remotes: [{
        doc: { name: 'google-drive:doc', opts: { workspaceId, connection } },
        blob: { name: 'google-drive:blob', opts: { workspaceId, connection } },
        awareness: { name: 'dummy', opts: {} },
      }],
    };
  }
}
```

### Flavour lifecycle

1. On app start: check if Google auth tokens exist
2. If authenticated: instantiate `GoogleDriveWorkspaceFlavourProvider`, register with `WorkspaceFlavoursProvider`
3. Provider lists workspaces from both local DB and Drive, merges
4. When workspace opens: sync engine automatically starts local ↔ Drive sync
5. On disconnect: unregister provider, workspaces become local-only (data preserved)

### Converting local workspace to Google Drive

User flow: Settings → Storage → "Sync to Google Drive" on a local workspace

- Changes workspace flavour from 'local' to 'google-drive'
- Triggers initial upload (chunked, with progress bar)
- Rate-limited: uploads docs in batches of 10, waits between batches

## Module 4: UI Integration

### Settings → Storage tab

New "Storage" tab in settings dialog:

- Connected accounts section (Google profile pic, email, "Disconnect" button)
- Per-workspace sync toggle and status
- Drive storage usage (via Drive `about.get` API)
- Quota warning when >90% full

### Sidebar changes

- Sync status dot on workspace name: green (synced), blue (syncing), red (error), gray (offline)
- Google profile avatar replaces generic avatar when connected

### Auth callback route

- `/auth/callback` page receives OAuth code, exchanges for tokens, closes popup
- Shows brief "Connected!" message then redirects

### Sign-in flow

1. User clicks avatar → "Sign in with Google" (or Settings → Storage → Connect)
2. Google OAuth popup
3. User authorizes
4. Popup closes, main app receives tokens
5. For existing local workspaces: "Would you like to sync this workspace to Google Drive?"
6. Background sync begins

### Initial upload progress

When converting a workspace to Google Drive:

- Show progress modal: "Uploading workspace... (45/120 docs)"
- Upload in batches of 10 docs
- 500ms delay between batches to respect rate limits
- Blobs uploaded on-demand (not bulk uploaded)

## Encryption (V2 — not in initial build)

Encryption adds complexity and is deferred to V2. Rationale:

- `appDataFolder` is already app-isolated — only Nota can access these files
- The user's Google account is the security boundary (same as Gmail, Google Docs)
- True zero-knowledge requires a user passphrase (worse UX for V1)
- V2 will add optional passphrase-based encryption (AES-256-GCM with Argon2 key derivation)

## Drive API Quotas & Limits

| Limit                | Value               | How we handle                             |
| -------------------- | ------------------- | ----------------------------------------- |
| Per-user requests    | 12,000 / 60s        | Request queue with tracking               |
| Per-project requests | 20,000 / 100s       | Shared across all users of same Client ID |
| File size            | 5 TB max            | Not a concern for Y.js docs               |
| File count           | No hard limit       | Monitor; compaction reduces count         |
| appDataFolder quota  | Shares user's 15 GB | Show usage in settings, warn at 90%       |

## What we DON'T build (yet)

- **Encryption**: Deferred to V2 with user passphrase
- **Real-time collaboration**: No WebSocket with Drive. V1 is eventual sync. Nota Cloud provider (future) will add real-time.
- **Other storage providers**: OneDrive, Dropbox, S3 — same nbstore interface pattern, future work
- **Workspace sharing**: Future feature using Drive sharing API
- **Key rotation / migration**: Future with V2 encryption

## Testing

- Unit tests: GoogleDriveDocStorage, GoogleDriveBlobStorage (mock fetch)
- Integration tests: OAuth flow with mock Google endpoints
- Sync tests: local ↔ Drive round-trip, multi-device merge
- Rate limit tests: queue behavior under load
- Offline tests: queue changes offline, sync on reconnect
- Compaction tests: snapshot creation, old update cleanup, lock file coordination
