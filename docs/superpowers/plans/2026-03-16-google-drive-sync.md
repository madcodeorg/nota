# Google Drive Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Drive sync to Nota — users authenticate with Google OAuth, and their workspaces sync to Google Drive's hidden app data folder.

**Architecture:** Implement `GoogleDriveDocStorage` and `GoogleDriveBlobStorage` as nbstore storage backends. Create `GoogleDriveConnection` for API auth/rate-limiting. Add `GoogleDriveWorkspaceFlavourProvider` to plug into existing sync engine. Google OAuth via PKCE (no backend). Config from environment variables.

**Tech Stack:** TypeScript, Google Drive API v3, Google OAuth 2.0 PKCE, nbstore (DocStorageBase, BlobStorageBase, AutoReconnectConnection), LiveData (@nota/infra), vanilla-extract CSS.

**Spec:** `docs/superpowers/specs/2026-03-15-google-drive-sync-design.md`

---

## Chunk 1: Build Config & Google Drive Connection

### Task 1: Add googleClientId to BUILD_CONFIG

**Files:**

- Modify: `tools/@types/build-config/__all.d.ts`
- Modify: `tools/utils/src/build-config.ts`
- Create: `.env.example` (if not exists)

- [ ] **Step 1: Add googleClientId to BUILD_CONFIG type**

In `tools/@types/build-config/__all.d.ts`, add to `BUILD_CONFIG_TYPE`:

```typescript
googleClientId: string;
```

- [ ] **Step 2: Add googleClientId to build preset**

In `tools/utils/src/build-config.ts`, add to the build preset object:

```typescript
googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
```

- [ ] **Step 3: Create .env.example with the variable**

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

- [ ] **Step 4: Commit**

```bash
git add tools/@types/build-config/__all.d.ts tools/utils/src/build-config.ts .env.example
git commit -m "feat(config): add googleClientId to BUILD_CONFIG"
```

---

### Task 2: Create GoogleDriveConnection

**Files:**

- Create: `packages/common/nbstore/src/impls/google-drive/connection.ts`

This is the core connection class that manages Google OAuth tokens, provides authenticated fetch, and handles rate limiting.

- [ ] **Step 1: Create the connection class**

```typescript
// packages/common/nbstore/src/impls/google-drive/connection.ts
import { AutoReconnectConnection } from '../../connection';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleDriveConnectionOptions {
  /** OAuth access token (refreshed externally by auth module) */
  getAccessToken: () => Promise<string | null>;
}

interface DriveClient {
  accessToken: string;
}

export class GoogleDriveConnection extends AutoReconnectConnection<DriveClient> {
  static readonly shareId = 'google-drive';

  private requestQueue: Array<() => Promise<void>> = [];
  private activeRequests = 0;
  private readonly maxConcurrent = 10;

  constructor(private readonly options: GoogleDriveConnectionOptions) {
    super();
    this.retryDelay = 5000;
    this.connectingTimeout = 10000;
  }

  override get shareId() {
    return GoogleDriveConnection.shareId;
  }

  protected override async doConnect(): Promise<DriveClient> {
    const accessToken = await this.options.getAccessToken();
    if (!accessToken) {
      throw new Error('No Google access token available');
    }
    // Verify token works by calling Drive about endpoint
    const resp = await fetch(`${DRIVE_API}/about?fields=user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      throw new Error(`Google Drive auth failed: ${resp.status}`);
    }
    return { accessToken };
  }

  protected override doDisconnect(_conn: DriveClient): void {
    this.requestQueue = [];
    this.activeRequests = 0;
  }

  /** Authenticated fetch with rate limiting */
  async driveFetch(url: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
    const token = this.inner.accessToken;
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const controller = new AbortController();
    const timeout = init?.timeout ?? 30000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await this.enqueueRequest(() =>
        fetch(url, {
          ...init,
          headers,
          signal: controller.signal,
        })
      );

      if (resp.status === 429) {
        // Rate limited — wait and retry
        const retryAfter = parseInt(resp.headers.get('Retry-After') || '5');
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return this.driveFetch(url, init);
      }

      return resp;
    } finally {
      clearTimeout(timer);
    }
  }

  private async enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.activeRequests++;
    try {
      return await fn();
    } finally {
      this.activeRequests--;
    }
  }

  // --- Drive API helpers ---

  /** Search files in appDataFolder */
  async searchFiles(query: string): Promise<DriveFile[]> {
    const resp = await this.driveFetch(`${DRIVE_API}/files?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,size,properties)`);
    if (!resp.ok) throw new Error(`Drive search failed: ${resp.status}`);
    const data = await resp.json();
    return data.files || [];
  }

  /** Create file in appDataFolder */
  async createFile(name: string, content: Uint8Array | string, mimeType = 'application/octet-stream', properties?: Record<string, string>): Promise<string> {
    const metadata = {
      name,
      parents: ['appDataFolder'],
      mimeType,
      properties,
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: mimeType }));

    const resp = await this.driveFetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form });
    if (!resp.ok) throw new Error(`Drive create failed: ${resp.status}`);
    const data = await resp.json();
    return data.id;
  }

  /** Update file content */
  async updateFile(fileId: string, content: Uint8Array | string, mimeType = 'application/octet-stream'): Promise<void> {
    const resp = await this.driveFetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      body: content,
      headers: { 'Content-Type': mimeType },
    });
    if (!resp.ok) throw new Error(`Drive update failed: ${resp.status}`);
  }

  /** Download file content */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const resp = await this.driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
    if (!resp.ok) throw new Error(`Drive download failed: ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** Delete file */
  async deleteFile(fileId: string): Promise<void> {
    const resp = await this.driveFetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
    if (resp.status !== 204 && !resp.ok) {
      throw new Error(`Drive delete failed: ${resp.status}`);
    }
  }

  /** Get Drive storage quota */
  async getQuota(): Promise<{ usage: number; limit: number }> {
    const resp = await this.driveFetch(`${DRIVE_API}/about?fields=storageQuota`);
    if (!resp.ok) throw new Error(`Drive quota failed: ${resp.status}`);
    const data = await resp.json();
    return {
      usage: parseInt(data.storageQuota.usage || '0'),
      limit: parseInt(data.storageQuota.limit || '0'),
    };
  }
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  properties?: Record<string, string>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/common/nbstore/src/impls/google-drive/connection.ts
git commit -m "feat(nbstore): add GoogleDriveConnection with Drive API helpers"
```

---

## Chunk 2: nbstore Storage Implementations

### Task 3: Create GoogleDriveDocStorage

**Files:**

- Create: `packages/common/nbstore/src/impls/google-drive/doc.ts`

Implements `DocStorageBase` using Google Drive files for Y.js doc storage. Uses flat file naming with the pattern: `ws_{workspaceId}_doc_{docId}_snapshot` and `ws_{workspaceId}_doc_{docId}_update_{timestamp}_{deviceId}`.

- [ ] **Step 1: Create the storage class**

Read `packages/common/nbstore/src/impls/cloud/doc.ts` for reference patterns. Then create:

```typescript
// packages/common/nbstore/src/impls/google-drive/doc.ts
import type { DocClock, DocClocks, DocRecord, DocUpdate } from '../../storage';
import { DocStorageBase, type DocStorageOptions } from '../../storage';
import { GoogleDriveConnection, type DriveFile } from './connection';

interface GoogleDriveDocStorageOptions extends DocStorageOptions {
  connection: GoogleDriveConnection;
}

export class GoogleDriveDocStorage extends DocStorageBase<GoogleDriveDocStorageOptions> {
  static readonly identifier = 'google-drive:doc';

  readonly connection = this.options.connection;

  private get workspaceId() {
    return this.options.id;
  }

  private snapshotName(docId: string) {
    return `ws_${this.workspaceId}_doc_${docId}_snapshot`;
  }

  private updatePrefix(docId: string) {
    return `ws_${this.workspaceId}_doc_${docId}_update_`;
  }

  private deviceId = this.getOrCreateDeviceId();

  private getOrCreateDeviceId(): string {
    const key = 'nota-device-id';
    let id = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!id) {
      id = crypto.randomUUID();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, id);
      }
    }
    return id;
  }

  protected override async getDocSnapshot(docId: string): Promise<DocRecord | null> {
    const files = await this.connection.searchFiles(`name = '${this.snapshotName(docId)}'`);
    if (files.length === 0) return null;
    const file = files[0];
    const bin = await this.connection.downloadFile(file.id);
    return {
      docId,
      bin,
      timestamp: new Date(file.modifiedTime || Date.now()),
    };
  }

  protected override async setDocSnapshot(snapshot: DocRecord, _prevSnapshot: DocRecord | null): Promise<boolean> {
    const name = this.snapshotName(snapshot.docId);
    const existing = await this.connection.searchFiles(`name = '${name}'`);
    if (existing.length > 0) {
      await this.connection.updateFile(existing[0].id, snapshot.bin);
    } else {
      await this.connection.createFile(name, snapshot.bin);
    }
    return true;
  }

  protected override async getDocUpdates(docId: string): Promise<DocRecord[]> {
    const prefix = this.updatePrefix(docId);
    const files = await this.connection.searchFiles(`name contains '${prefix}'`);
    // Sort by name (which includes timestamp)
    files.sort((a, b) => a.name.localeCompare(b.name));

    const updates: DocRecord[] = [];
    for (const file of files) {
      const bin = await this.connection.downloadFile(file.id);
      // Extract timestamp from filename: ws_X_doc_Y_update_TIMESTAMP_DEVICEID
      const parts = file.name.split('_update_')[1]?.split('_') || [];
      const timestamp = parseInt(parts[0] || '0');
      updates.push({
        docId,
        bin,
        timestamp: new Date(timestamp),
      });
    }
    return updates;
  }

  protected override async markUpdatesMerged(docId: string, updates: DocRecord[]): Promise<number> {
    // After merging into snapshot, delete the update files
    const prefix = this.updatePrefix(docId);
    const files = await this.connection.searchFiles(`name contains '${prefix}'`);
    let deleted = 0;
    for (const file of files) {
      const parts = file.name.split('_update_')[1]?.split('_') || [];
      const ts = parseInt(parts[0] || '0');
      const shouldDelete = updates.some(u => u.timestamp.getTime() === ts);
      if (shouldDelete) {
        await this.connection.deleteFile(file.id);
        deleted++;
      }
    }
    return deleted;
  }

  override async pushDocUpdate(update: DocUpdate, _origin?: string): Promise<DocClock> {
    const timestamp = Date.now();
    const name = `${this.updatePrefix(update.docId)}${timestamp}_${this.deviceId}`;
    await this.connection.createFile(name, update.bin);
    const clock: DocClock = { docId: update.docId, timestamp: new Date(timestamp) };
    this.emit('update', { ...update, timestamp: new Date(timestamp) }, _origin);
    return clock;
  }

  override async getDocTimestamp(docId: string): Promise<DocClock | null> {
    // Check snapshot first
    const snapshot = await this.connection.searchFiles(`name = '${this.snapshotName(docId)}'`);
    if (snapshot.length > 0) {
      return {
        docId,
        timestamp: new Date(snapshot[0].modifiedTime || 0),
      };
    }
    // Check latest update
    const updates = await this.connection.searchFiles(`name contains '${this.updatePrefix(docId)}'`);
    if (updates.length === 0) return null;
    updates.sort((a, b) => b.name.localeCompare(a.name));
    return {
      docId,
      timestamp: new Date(updates[0].modifiedTime || 0),
    };
  }

  override async getDocTimestamps(after?: Date): Promise<DocClocks> {
    // List all doc files for this workspace
    const prefix = `ws_${this.workspaceId}_doc_`;
    let query = `name contains '${prefix}'`;
    if (after) {
      query += ` and modifiedTime > '${after.toISOString()}'`;
    }
    const files = await this.connection.searchFiles(query);

    const clocks: DocClocks = {};
    for (const file of files) {
      // Extract docId from filename
      const nameAfterPrefix = file.name.replace(prefix, '');
      const docId = nameAfterPrefix.split('_snapshot')[0]?.split('_update_')[0];
      if (docId) {
        const ts = new Date(file.modifiedTime || 0);
        if (!clocks[docId] || ts > clocks[docId]) {
          clocks[docId] = ts;
        }
      }
    }
    return clocks;
  }

  override async deleteDoc(docId: string): Promise<void> {
    const prefix = `ws_${this.workspaceId}_doc_${docId}`;
    const files = await this.connection.searchFiles(`name contains '${prefix}'`);
    for (const file of files) {
      await this.connection.deleteFile(file.id);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/common/nbstore/src/impls/google-drive/doc.ts
git commit -m "feat(nbstore): add GoogleDriveDocStorage implementation"
```

---

### Task 4: Create GoogleDriveBlobStorage

**Files:**

- Create: `packages/common/nbstore/src/impls/google-drive/blob.ts`

- [ ] **Step 1: Create the blob storage class**

```typescript
// packages/common/nbstore/src/impls/google-drive/blob.ts
import type { BlobRecord, ListedBlobRecord } from '../../storage';
import { BlobStorageBase } from '../../storage';
import { GoogleDriveConnection } from './connection';

interface GoogleDriveBlobStorageOptions {
  id: string; // workspace ID
  connection: GoogleDriveConnection;
}

export class GoogleDriveBlobStorage extends BlobStorageBase {
  static readonly identifier = 'google-drive:blob';

  override readonly isReadonly = false;
  readonly connection: GoogleDriveConnection;

  private get workspaceId() {
    return this.options.id;
  }

  constructor(private readonly options: GoogleDriveBlobStorageOptions) {
    super();
    this.connection = this.options.connection;
  }

  private blobName(key: string) {
    return `ws_${this.workspaceId}_blob_${key}`;
  }

  override async get(key: string, _signal?: AbortSignal): Promise<BlobRecord | null> {
    const files = await this.connection.searchFiles(`name = '${this.blobName(key)}'`);
    if (files.length === 0) return null;
    const file = files[0];
    const data = await this.connection.downloadFile(file.id);
    return {
      key,
      data,
      mime: file.properties?.mime || 'application/octet-stream',
      createdAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    };
  }

  override async set(blob: BlobRecord, _signal?: AbortSignal): Promise<void> {
    const name = this.blobName(blob.key);
    const existing = await this.connection.searchFiles(`name = '${name}'`);
    if (existing.length > 0) {
      await this.connection.updateFile(existing[0].id, blob.data, blob.mime);
    } else {
      await this.connection.createFile(name, blob.data, blob.mime, {
        mime: blob.mime,
      });
    }
  }

  override async delete(key: string, _permanently: boolean, _signal?: AbortSignal): Promise<void> {
    const files = await this.connection.searchFiles(`name = '${this.blobName(key)}'`);
    for (const file of files) {
      await this.connection.deleteFile(file.id);
    }
  }

  override async release(_signal?: AbortSignal): Promise<void> {
    // No-op for Google Drive
  }

  override async list(_signal?: AbortSignal): Promise<ListedBlobRecord[]> {
    const prefix = `ws_${this.workspaceId}_blob_`;
    const files = await this.connection.searchFiles(`name contains '${prefix}'`);
    return files.map(file => ({
      key: file.name.replace(prefix, ''),
      mime: file.properties?.mime || 'application/octet-stream',
      size: parseInt(file.size || '0'),
      createdAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    }));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/common/nbstore/src/impls/google-drive/blob.ts
git commit -m "feat(nbstore): add GoogleDriveBlobStorage implementation"
```

---

### Task 5: Register Google Drive storage implementations

**Files:**

- Create: `packages/common/nbstore/src/impls/google-drive/index.ts`
- Modify: `packages/common/nbstore/src/impls/index.ts`

- [ ] **Step 1: Create the barrel export**

```typescript
// packages/common/nbstore/src/impls/google-drive/index.ts
import type { StorageConstructor } from '../index';
import { GoogleDriveBlobStorage } from './blob';
import { GoogleDriveDocStorage } from './doc';

export { GoogleDriveBlobStorage } from './blob';
export { GoogleDriveConnection } from './connection';
export { GoogleDriveDocStorage } from './doc';

export const googleDriveStorages = [GoogleDriveDocStorage, GoogleDriveBlobStorage] satisfies StorageConstructor[];
```

- [ ] **Step 2: Register in the main impls index**

Read `packages/common/nbstore/src/impls/index.ts` and add `googleDriveStorages` to the `Storages` type union and import it.

- [ ] **Step 3: Commit**

```bash
git add packages/common/nbstore/src/impls/google-drive/ packages/common/nbstore/src/impls/index.ts
git commit -m "feat(nbstore): register Google Drive storage implementations"
```

---

## Chunk 3: Google OAuth Module

### Task 6: Create Google Auth service

**Files:**

- Create: `packages/frontend/core/src/modules/google-auth/index.ts`
- Create: `packages/frontend/core/src/modules/google-auth/services/google-auth.ts`
- Create: `packages/frontend/core/src/modules/google-auth/entities/google-session.ts`

- [ ] **Step 1: Create the session entity**

```typescript
// packages/frontend/core/src/modules/google-auth/entities/google-session.ts
import { Entity, LiveData } from '@nota/infra';

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix timestamp ms
  idToken?: string;
}

export interface GoogleUserInfo {
  email: string;
  name: string;
  picture?: string;
  sub: string; // Google user ID
}

export type GoogleAuthStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const STORAGE_KEY = 'nota-google-tokens';

export class GoogleSession extends Entity {
  status$ = new LiveData<GoogleAuthStatus>('disconnected');
  userInfo$ = new LiveData<GoogleUserInfo | null>(null);
  error$ = new LiveData<string | null>(null);

  private tokens: GoogleTokens | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.loadFromStorage();
  }

  get isConnected() {
    return this.status$.value === 'connected';
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (Date.now() > this.tokens.expiresAt - 5 * 60 * 1000) {
      await this.refreshAccessToken();
    }
    return this.tokens?.accessToken ?? null;
  }

  setTokens(tokens: GoogleTokens, userInfo: GoogleUserInfo) {
    this.tokens = tokens;
    this.userInfo$.next(userInfo);
    this.status$.next('connected');
    this.error$.next(null);
    this.saveToStorage();
    this.scheduleRefresh();
  }

  clear() {
    this.tokens = null;
    this.userInfo$.next(null);
    this.status$.next('disconnected');
    this.error$.next(null);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    localStorage.removeItem(STORAGE_KEY);
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      this.clear();
      return;
    }
    try {
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: BUILD_CONFIG.googleClientId,
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
        }),
      });
      if (!resp.ok) {
        this.status$.next('error');
        this.error$.next('Token refresh failed. Please reconnect.');
        return;
      }
      const data = await resp.json();
      this.tokens = {
        ...this.tokens,
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      this.saveToStorage();
      this.scheduleRefresh();
    } catch {
      this.status$.next('error');
      this.error$.next('Failed to refresh token');
    }
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.tokens) return;
    const delay = Math.max(0, this.tokens.expiresAt - Date.now() - 5 * 60 * 1000);
    this.refreshTimer = setTimeout(() => this.refreshAccessToken(), delay);
  }

  private saveToStorage() {
    if (this.tokens) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tokens: this.tokens,
          userInfo: this.userInfo$.value,
        })
      );
    }
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { tokens, userInfo } = JSON.parse(stored);
        if (tokens && userInfo) {
          this.tokens = tokens;
          this.userInfo$.next(userInfo);
          this.status$.next('connected');
          this.scheduleRefresh();
        }
      }
    } catch {
      // Ignore storage errors
    }
  }
}
```

- [ ] **Step 2: Create the auth service**

```typescript
// packages/frontend/core/src/modules/google-auth/services/google-auth.ts
import { Service } from '@nota/infra';
import { GoogleSession } from '../entities/google-session';
import type { GoogleTokens, GoogleUserInfo } from '../entities/google-session';

export class GoogleAuthService extends Service {
  readonly session = this.framework.createEntity(GoogleSession);

  /** Start OAuth PKCE flow in popup */
  async connect(): Promise<void> {
    if (!BUILD_CONFIG.googleClientId) {
      throw new Error('Google Client ID not configured');
    }

    this.session.status$.next('connecting');

    // Generate PKCE verifier/challenge
    const verifier = this.generateCodeVerifier();
    const challenge = await this.generateCodeChallenge(verifier);

    // Store verifier for callback
    sessionStorage.setItem('nota-pkce-verifier', verifier);

    // Build auth URL
    const params = new URLSearchParams({
      client_id: BUILD_CONFIG.googleClientId,
      redirect_uri: `${window.location.origin}/auth/callback`,
      response_type: 'code',
      scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'].join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Open popup
    const popup = window.open(authUrl, 'google-auth', 'width=500,height=600');
    if (!popup) {
      this.session.status$.next('error');
      this.session.error$.next('Popup blocked. Please allow popups for this site.');
      return;
    }

    // Listen for callback message from popup
    return new Promise<void>((resolve, reject) => {
      const handler = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'google-auth-callback') return;

        window.removeEventListener('message', handler);

        const { code, error } = event.data;
        if (error || !code) {
          this.session.status$.next('error');
          this.session.error$.next(error || 'Auth failed');
          reject(new Error(error || 'Auth failed'));
          return;
        }

        try {
          await this.exchangeCodeForTokens(code, verifier);
          resolve();
        } catch (err) {
          this.session.status$.next('error');
          this.session.error$.next('Token exchange failed');
          reject(err);
        }
      };

      window.addEventListener('message', handler);

      // Check if popup was closed without auth
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handler);
          if (this.session.status$.value === 'connecting') {
            this.session.status$.next('disconnected');
          }
        }
      }, 1000);
    });
  }

  /** Disconnect from Google */
  disconnect(): void {
    this.session.clear();
  }

  /** Exchange auth code for tokens (PKCE) */
  private async exchangeCodeForTokens(code: string, verifier: string): Promise<void> {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: BUILD_CONFIG.googleClientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: `${window.location.origin}/auth/callback`,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Token exchange failed: ${resp.status}`);
    }

    const data = await resp.json();

    const tokens: GoogleTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      idToken: data.id_token,
    };

    // Decode ID token to get user info (it's a JWT)
    const payload = JSON.parse(atob(data.id_token.split('.')[1]));
    const userInfo: GoogleUserInfo = {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      sub: payload.sub,
    };

    this.session.setTokens(tokens, userInfo);
  }

  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64UrlEncode(array);
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(new Uint8Array(digest));
  }

  private base64UrlEncode(buffer: Uint8Array): string {
    return btoa(String.fromCharCode(...buffer))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
```

- [ ] **Step 3: Create the module definition**

```typescript
// packages/frontend/core/src/modules/google-auth/index.ts
import { Module } from '@nota/infra';
import { GoogleAuthService } from './services/google-auth';

export { GoogleAuthService } from './services/google-auth';
export { GoogleSession } from './entities/google-session';
export type { GoogleTokens, GoogleUserInfo, GoogleAuthStatus } from './entities/google-session';

export const GoogleAuthModule = new Module('google-auth').service(GoogleAuthService);
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/core/src/modules/google-auth/
git commit -m "feat(google-auth): add Google OAuth PKCE auth module"
```

---

### Task 7: Create OAuth callback page

**Files:**

- Create: `packages/frontend/core/src/modules/google-auth/views/auth-callback.tsx`

- [ ] **Step 1: Create callback page component**

This is a simple page that receives the OAuth code from Google's redirect and posts it back to the parent window.

```typescript
// packages/frontend/core/src/modules/google-auth/views/auth-callback.tsx
import { useEffect } from 'react';

export const GoogleAuthCallback = () => {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (window.opener) {
      window.opener.postMessage(
        { type: 'google-auth-callback', code, error },
        window.location.origin
      );
      window.close();
    }
  }, []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>Connecting to Google Drive...</p>
    </div>
  );
};
```

- [ ] **Step 2: Register the route**

Find where routes are defined in the app (look for `react-router` route definitions) and add `/auth/callback` pointing to `GoogleAuthCallback`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/core/src/modules/google-auth/views/
git commit -m "feat(google-auth): add OAuth callback page"
```

---

## Chunk 4: Workspace Flavour Provider & UI

### Task 8: Create GoogleDriveWorkspaceFlavourProvider

**Files:**

- Create: `packages/frontend/core/src/modules/workspace-engine/impls/google-drive.ts`

- [ ] **Step 1: Create the flavour provider**

Read `packages/frontend/core/src/modules/workspace-engine/impls/local.ts` and `cloud.ts` for patterns. Create a provider that:

- Uses local storage (IndexedDB) for `local` config
- Uses GoogleDriveDocStorage + GoogleDriveBlobStorage for `remotes` config
- Lists workspaces by searching Drive for `ws_*_meta.json` files
- Creates workspaces by creating local + uploading meta to Drive
- Deletes workspaces by removing all Drive files matching `ws_{id}_*`

Key method:

```typescript
getEngineWorkerInitOptions(workspaceId: string): WorkerInitOptions {
  return {
    local: {
      doc: { name: LocalDocStorageType.identifier, opts: { ... } },
      blob: { name: LocalBlobStorageType.identifier, opts: { ... } },
      docSync: { name: LocalDocSyncStorageType.identifier, opts: { ... } },
      blobSync: { name: LocalBlobSyncStorageType.identifier, opts: { ... } },
    },
    remotes: {
      'google-drive': {
        doc: { name: 'google-drive:doc', opts: { id: workspaceId, connection: this.connection } },
        blob: { name: 'google-drive:blob', opts: { id: workspaceId, connection: this.connection } },
      },
    },
  };
}
```

- [ ] **Step 2: Register the provider**

Add to the workspace engine module initialization so it's registered when Google auth is connected.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/core/src/modules/workspace-engine/impls/google-drive.ts
git commit -m "feat(workspace-engine): add Google Drive workspace flavour provider"
```

---

### Task 9: Add Google Sign-In button to sidebar

**Files:**

- Create: `packages/frontend/core/src/modules/google-auth/views/google-sign-in-button.tsx`
- Modify: `packages/frontend/core/src/components/root-app-sidebar/user-info/index.tsx`

- [ ] **Step 1: Create sign-in button component**

A button that appears in the user info area when not connected to Google. Shows "Sign in with Google" for unauthenticated users.

- [ ] **Step 2: Update UserInfo to show Google sign-in option**

In the account menu (`OperationMenu`), add a "Connect Google Drive" option that calls `googleAuthService.connect()`.

- [ ] **Step 3: Show sync status in sidebar**

Add a small sync indicator dot next to the workspace name showing Drive sync status.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/core/src/modules/google-auth/views/ packages/frontend/core/src/components/root-app-sidebar/user-info/
git commit -m "feat(ui): add Google Sign-In button and sync status indicator"
```

---

### Task 10: Add Storage settings tab

**Files:**

- Create: `packages/frontend/core/src/desktop/dialogs/setting/general-setting/storage/index.tsx`
- Modify: Settings dialog to include the new tab

- [ ] **Step 1: Create Storage settings component**

Shows:

- Google account info (avatar, email) when connected
- "Connect Google Drive" / "Disconnect" button
- Per-workspace sync toggle
- Drive quota usage bar
- Status messages (syncing, error, etc.)

- [ ] **Step 2: Register the tab in settings**

Add "Storage" tab to the settings sidebar navigation.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/core/src/desktop/dialogs/setting/
git commit -m "feat(settings): add Storage tab for Google Drive sync management"
```

---

### Task 11: Register GoogleAuthModule in app bootstrap

**Files:**

- Modify: App module registration (find where modules are configured)

- [ ] **Step 1: Register the Google Auth module**

Find where other modules are registered (look for `Module` imports and `.use()` calls). Add `GoogleAuthModule`.

- [ ] **Step 2: Wire up GoogleDriveWorkspaceFlavourProvider**

When GoogleAuthService reports `connected` status, instantiate and register `GoogleDriveWorkspaceFlavourProvider` with the workspace flavours service.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(app): wire up Google Auth module and Drive workspace provider"
```

---

### Task 12: Final integration testing & cleanup

- [ ] **Step 1: Add .env file with test credentials**

Create `.env` at repo root:

```
GOOGLE_CLIENT_ID=72301272959-il31djeb08gmsnmlj4nh3ehvr2dg40df.apps.googleusercontent.com
```

- [ ] **Step 2: Start dev server and test OAuth flow**

```bash
yarn affine dev -p @nota/web
```

Test:

1. Click avatar → "Connect Google Drive"
2. Google popup opens, authorize
3. Popup closes, status shows "Connected"
4. Create a workspace, verify files appear in Drive appdata

- [ ] **Step 3: Test sync**

1. Create a doc, add content
2. Wait 2 seconds for debounce
3. Check Drive API for uploaded files
4. Reload page, verify doc loads from local + pulls from Drive

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Final commit**

```bash
git commit -m "feat(google-drive): complete Google Drive sync integration"
```
