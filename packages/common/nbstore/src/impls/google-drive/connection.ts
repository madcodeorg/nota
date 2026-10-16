import { AutoReconnectConnection } from '../../connection';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const MAX_CONCURRENT_REQUESTS = 10;

export interface GoogleDriveTokens {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  expiresAt: number;
  refreshMode?: 'google' | 'broker';
  authBrokerUrl?: string;
  scopes?: string[];
}

export interface GoogleDriveConnectionOptions {
  tokens?: GoogleDriveTokens | null;
  /** Stable owner of this remote workspace, never inferred from a later login. */
  accountId?: string;
  connectionKey?: string;
}

interface DriveClient {
  accessToken: string;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  properties?: Record<string, string>;
}

function toBlobBody(content: Uint8Array, mimeType?: string): Blob {
  const body = content.slice();
  return new Blob([body.buffer], {
    type: mimeType ?? 'application/octet-stream',
  });
}

/** A listed file was removed (for example by compaction on another device). */
export class DriveNotFoundError extends Error {
  constructor(fileId: string) {
    super(`Drive file ${fileId} no longer exists.`);
    this.name = 'DriveNotFoundError';
  }
}

export interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile & { trashed?: boolean };
}

const FILE_FIELDS = 'id,name,modifiedTime,size,properties';
// Drive multipart uploads are limited to 5 MB; larger bodies use a resumable session.
const MULTIPART_LIMIT = 5 * 1024 * 1024;
const RESUMABLE_CHUNK = 32 * 256 * 1024;

export class GoogleDriveConnection extends AutoReconnectConnection<DriveClient> {
  private activeRequests = 0;
  private readonly waitQueue: Array<() => void> = [];
  private tokenSnapshot: GoogleDriveTokens | null;
  private generation = 0;
  private activeReferences = 0;
  private requests = new AbortController();
  private readonly authListeners = new Set<() => void>();

  constructor(private readonly options: GoogleDriveConnectionOptions = {}) {
    super();
    this.tokenSnapshot = options.tokens ?? null;
  }

  onAuthRequired(listener: () => void): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  /** Bind only an owner verified by workspace discovery. An existing owner is immutable. */
  bindWorkspaceOwner(accountId: string): void {
    if (
      !accountId ||
      (this.options.accountId && this.options.accountId !== accountId)
    ) {
      throw new Error('Google Drive workspace belongs to a different account.');
    }
    const wasUnbound = !this.options.accountId;
    this.options.accountId = accountId;
    if (wasUnbound && this.activeReferences && this.hasOwnerToken())
      super.connect();
  }

  setTokenSnapshot(tokens?: GoogleDriveTokens | null): void {
    const next = tokens ?? null;
    if (
      this.tokenSnapshot?.accessToken === next?.accessToken &&
      this.tokenSnapshot?.accountId === next?.accountId &&
      this.tokenSnapshot?.expiresAt === next?.expiresAt
    )
      return;
    this.tokenSnapshot = next;
    this.generation++;
    this.requests.abort();
    this.requests = new AbortController();
    // Pause the remote connection completely without closing local storage.
    // Keep our own peer references so reconnect does not depend on reopening the app.
    super.disconnect(true);
    if (this.activeReferences && this.hasOwnerToken()) super.connect();
  }

  private hasOwnerToken(): boolean {
    return (
      !!this.options.accountId &&
      this.tokenSnapshot?.accountId === this.options.accountId
    );
  }

  override connect(): void {
    this.activeReferences++;
    if (this.activeReferences === 1) {
      if (this.hasOwnerToken()) super.connect();
      else super.disconnect(true);
    }
  }

  override disconnect(force = false): void {
    this.activeReferences = force ? 0 : Math.max(0, this.activeReferences - 1);
    if (!this.activeReferences) super.disconnect(true);
  }

  private accessToken(): string {
    const tokens = this.tokenSnapshot;
    if (
      !tokens ||
      !this.options.accountId ||
      tokens.accountId !== this.options.accountId
    ) {
      throw new Error(
        'Google Drive sync paused. Reconnect the workspace owner account.'
      );
    }
    if (Date.now() >= tokens.expiresAt) {
      for (const listener of this.authListeners) listener();
      throw new Error(
        'Google Drive access expired. Reconnect to sync; local editing remains available.'
      );
    }
    return tokens.accessToken;
  }

  override async doConnect(signal?: AbortSignal): Promise<DriveClient> {
    const accessToken = this.accessToken();
    const generation = this.generation;
    const response = await fetch(
      `${DRIVE_API}/about?fields=user,storageQuota`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.any([
          this.requests.signal,
          ...(signal ? [signal] : []),
        ]),
      }
    );
    if (generation !== this.generation)
      throw new Error('Google account changed.');
    if (response.status === 401) {
      for (const listener of this.authListeners) listener();
    }
    if (!response.ok)
      throw new Error(
        `Google Drive authentication failed (${response.status}).`
      );
    return { accessToken };
  }

  override doDisconnect(_conn: DriveClient): void {
    this.requests.abort();
    this.requests = new AbortController();
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++;
      return;
    }
    await new Promise<void>(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  private releaseSlot(): void {
    const next = this.waitQueue.shift();
    if (next) next();
    else this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  /** Retry outside the concurrency slot so simultaneous rate limits cannot deadlock. */
  async driveFetch(
    url: string,
    init?: RequestInit,
    retries = 3
  ): Promise<Response> {
    const generation = this.generation;
    for (let attempt = 0; ; attempt++) {
      await this.acquireSlot();
      let response: Response;
      try {
        if (generation !== this.generation)
          throw new Error('Google account changed.');
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${this.accessToken()}`);
        const signal = AbortSignal.any([
          this.requests.signal,
          ...(init?.signal ? [init.signal] : []),
        ]);
        response = await fetch(url, { ...init, headers, signal });
        if (generation !== this.generation)
          throw new Error('Google account changed.');
      } catch (error) {
        if (
          generation === this.generation &&
          !init?.signal?.aborted &&
          this.status !== 'closed'
        ) {
          this.error =
            error instanceof Error
              ? error
              : new Error('Google Drive network request failed.');
        }
        throw error;
      } finally {
        this.releaseSlot();
      }
      if (response.status === 401) {
        for (const listener of this.authListeners) listener();
        this.error = new Error(
          'Google Drive authorization expired. Local changes are saved; reconnect to sync.'
        );
      }
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < retries
      ) {
        const seconds = Number(
          response.headers.get('Retry-After') ?? 2 ** attempt
        );
        const delay = Math.min(
          30000,
          Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : 1000)
        );
        await new Promise<void>((resolve, reject) => {
          const signal = this.requests.signal;
          const abort = () => {
            clearTimeout(timer);
            reject(new Error('Google account changed.'));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          }, delay);
          signal.addEventListener('abort', abort, { once: true });
        });
        continue;
      }
      if (
        (response.status === 429 || response.status >= 500) &&
        this.status !== 'closed'
      ) {
        this.error = new Error(
          `Google Drive request failed (${response.status}); sync will retry.`
        );
      }
      return response;
    }
  }

  /** Search every result page, including empty intermediate pages. */
  async searchFiles(query: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: query,
      fields: 'nextPageToken,files(id,name,modifiedTime,size,properties)',
      pageSize: '1000',
    });
    const files: DriveFile[] = [];
    const seen = new Set<string>();
    let nextPageToken: string | undefined;
    do {
      const response = await this.driveFetch(
        `${DRIVE_API}/files?${params.toString()}`
      );
      if (!response.ok)
        throw new Error(`Drive search failed (${response.status}).`);
      const data = (await response.json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      files.push(...(data.files ?? []));
      nextPageToken = data.nextPageToken;
      if (nextPageToken) {
        if (seen.has(nextPageToken))
          throw new Error('Drive returned a repeated page token. Retry sync.');
        seen.add(nextPageToken);
        params.set('pageToken', nextPageToken);
      }
    } while (nextPageToken);
    return [...new Map(files.map(file => [file.id, file])).values()];
  }

  /**
   * Create a new file in appDataFolder using multipart upload.
   */
  async createFile(
    name: string,
    content: Uint8Array,
    mimeType = 'application/octet-stream',
    properties?: Record<string, string>
  ): Promise<DriveFile> {
    const generated = await this.driveFetch(
      `${DRIVE_API}/files/generateIds?count=1&space=drive`
    );
    if (!generated.ok)
      throw new Error(`Drive ID generation failed (${generated.status}).`);
    const id = ((await generated.json()) as { ids: string[] }).ids[0];
    if (!id) throw new Error('Drive did not generate a file identity.');
    const metadata: Record<string, unknown> = {
      id,
      name,
      parents: ['appDataFolder'],
    };
    if (properties) {
      metadata['properties'] = properties;
    }
    if (content.byteLength > MULTIPART_LIMIT)
      return this.createFileResumable(id, metadata, content, mimeType);

    const boundary = `nota_boundary_${Date.now()}`;
    const metadataPart = JSON.stringify(metadata);
    const encoder = new TextEncoder();

    const preamble = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const epilogue = encoder.encode(`\r\n--${boundary}--`);

    const body = new Uint8Array(
      preamble.byteLength + content.byteLength + epilogue.byteLength
    );
    body.set(preamble, 0);
    body.set(content, preamble.byteLength);
    body.set(epilogue, preamble.byteLength + content.byteLength);

    const response = await this.driveFetch(
      `${UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,size,properties`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: toBlobBody(body),
      }
    );

    if (response.status === 409) return this.getExistingFile(id);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive createFile failed (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<DriveFile>;
  }

  private async getExistingFile(id: string): Promise<DriveFile> {
    const existing = await this.driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`
    );
    if (!existing.ok)
      throw new Error('Drive upload identity could not be verified.');
    return existing.json() as Promise<DriveFile>;
  }

  private async createFileResumable(
    id: string,
    metadata: Record<string, unknown>,
    content: Uint8Array,
    mimeType: string
  ): Promise<DriveFile> {
    const session = await this.driveFetch(
      `${UPLOAD_API}/files?uploadType=resumable&fields=${FILE_FIELDS}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(content.byteLength),
        },
        body: JSON.stringify(metadata),
      }
    );
    if (session.status === 409) return this.getExistingFile(id);
    const location = session.headers.get('Location');
    if (!session.ok || !location)
      throw new Error(`Drive upload session failed (${session.status}).`);
    let offset = 0;
    while (true) {
      const end = Math.min(offset + RESUMABLE_CHUNK, content.byteLength);
      const response = await this.driveFetch(location, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${content.byteLength}`,
        },
        body: toBlobBody(content.subarray(offset, end), mimeType),
      });
      if (response.status === 308) {
        // Range reports the last byte the server stored; resume from there.
        const range = /bytes=0-(\d+)/.exec(response.headers.get('Range') ?? '');
        offset = range ? Number(range[1]) + 1 : 0;
        continue;
      }
      if (response.status === 409) return this.getExistingFile(id);
      if (!response.ok)
        throw new Error(`Drive upload failed (${response.status}).`);
      return response.json() as Promise<DriveFile>;
    }
  }

  async updateFileProperties(
    fileId: string,
    properties: Record<string, string | null>
  ): Promise<DriveFile> {
    const response = await this.driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ properties }),
      }
    );
    if (response.status === 404) throw new DriveNotFoundError(fileId);
    if (!response.ok)
      throw new Error(`Drive property update failed (${response.status}).`);
    return response.json() as Promise<DriveFile>;
  }

  /** Returns null when the account cannot provide a changes cursor. */
  async getStartPageToken(): Promise<string | null> {
    const response = await this.driveFetch(
      `${DRIVE_API}/changes/startPageToken`
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { startPageToken?: string };
    return typeof data.startPageToken === 'string' ? data.startPageToken : null;
  }

  /** Read every appDataFolder change after a cursor and return the next cursor. */
  async listChanges(
    pageToken: string
  ): Promise<{ changes: DriveChange[]; nextToken: string }> {
    const changes: DriveChange[] = [];
    let token = pageToken;
    const seen = new Set<string>();
    while (true) {
      const params = new URLSearchParams({
        pageToken: token,
        spaces: 'appDataFolder',
        includeRemoved: 'true',
        pageSize: '1000',
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS},trashed))`,
      });
      const response = await this.driveFetch(
        `${DRIVE_API}/changes?${params.toString()}`
      );
      if (!response.ok)
        throw new Error(`Drive changes failed (${response.status}).`);
      const data = (await response.json()) as {
        changes?: DriveChange[];
        nextPageToken?: string;
        newStartPageToken?: string;
      };
      changes.push(...(data.changes ?? []));
      if (data.newStartPageToken)
        return { changes, nextToken: data.newStartPageToken };
      if (!data.nextPageToken || seen.has(data.nextPageToken))
        throw new Error('Drive returned an incomplete changes page.');
      seen.add(data.nextPageToken);
      token = data.nextPageToken;
    }
  }

  /**
   * Update the content of an existing file.
   */
  async updateFile(
    fileId: string,
    content: Uint8Array,
    mimeType = 'application/octet-stream'
  ): Promise<DriveFile> {
    const response = await this.driveFetch(
      `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,size,properties`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': mimeType,
        },
        body: toBlobBody(content, mimeType),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive updateFile failed (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<DriveFile>;
  }

  /**
   * Download file content as Uint8Array.
   */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const response = await this.driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`
    );

    if (response.status === 404) throw new DriveNotFoundError(fileId);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive downloadFile failed (${response.status}): ${errorText}`
      );
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Delete a file by ID.
   */
  async deleteFile(fileId: string): Promise<void> {
    const response = await this.driveFetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' }
    );

    // Another device may already have removed the same covered file.
    if (!response.ok && response.status !== 204 && response.status !== 404) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive deleteFile failed (${response.status}): ${errorText}`
      );
    }
  }

  /**
   * Get Drive storage quota information.
   */
  async getQuota(): Promise<{ usage: number; limit: number }> {
    const response = await this.driveFetch(
      `${DRIVE_API}/about?fields=storageQuota`
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive getQuota failed (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as {
      storageQuota: { usage: string; limit: string };
    };

    return {
      usage: Number(data.storageQuota.usage ?? 0),
      limit: Number(data.storageQuota.limit ?? 0),
    };
  }
}

/** Escape Drive query values separately from URL encoding. */
export function driveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const connections = new Map<string, GoogleDriveConnection>();

export function getOrCreateGoogleDriveConnection(
  options: GoogleDriveConnectionOptions = {}
): GoogleDriveConnection {
  const key = `${options.accountId ?? 'unbound'}:${options.connectionKey ?? 'metadata'}`;
  let connection = connections.get(key);
  if (!connection) {
    connection = new GoogleDriveConnection(options);
    connections.set(key, connection);
  } else if (Object.hasOwn(options, 'tokens')) {
    connection.setTokenSnapshot(options.tokens);
  }
  return connection;
}
