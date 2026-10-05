import { AutoReconnectConnection } from '../../connection';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const MAX_CONCURRENT_REQUESTS = 10;
const STORAGE_KEY = 'nota-google-tokens';
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export interface GoogleDriveTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshMode?: 'google' | 'broker';
  authBrokerUrl?: string;
  scopes?: string[];
}

export interface GoogleDriveConnectionOptions {
  tokens?: GoogleDriveTokens | null;
}

type StoredTokens = GoogleDriveTokens;

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

export class GoogleDriveConnection extends AutoReconnectConnection<DriveClient> {
  private activeRequests = 0;
  private readonly waitQueue: Array<() => void> = [];
  private tokenSnapshot: StoredTokens | null;

  constructor(options: GoogleDriveConnectionOptions = {}) {
    super();
    this.tokenSnapshot = options.tokens ?? null;
  }

  setTokenSnapshot(tokens?: GoogleDriveTokens | null): void {
    if (tokens) {
      this.tokenSnapshot = tokens;
    }
  }

  private readStoredTokens(): StoredTokens | null {
    if (this.tokenSnapshot) {
      return this.tokenSnapshot;
    }

    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { tokens?: StoredTokens };
      return parsed.tokens ?? null;
    } catch {
      return null;
    }
  }

  private saveStoredTokens(tokens: StoredTokens): void {
    this.tokenSnapshot = tokens;

    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...existing, tokens })
      );
    } catch {
      // Ignore write errors
    }
  }

  private async refreshStoredTokens(
    tokens: StoredTokens
  ): Promise<string | null> {
    const updatedTokens =
      tokens.refreshMode === 'broker'
        ? await this.refreshBrokerToken(tokens)
        : await this.refreshGoogleToken(tokens);

    if (!updatedTokens) return null;

    this.saveStoredTokens(updatedTokens);
    return updatedTokens.accessToken;
  }

  private async refreshGoogleToken(
    tokens: StoredTokens
  ): Promise<StoredTokens | null> {
    try {
      // BUILD_CONFIG.googleClientId is injected at build time via the bundler.
      // In the nbstore worker context the global BUILD_CONFIG is available.
      const clientId =
        typeof BUILD_CONFIG !== 'undefined'
          ? ((BUILD_CONFIG as { googleClientId?: string }).googleClientId ?? '')
          : '';

      const params = new URLSearchParams({
        client_id: clientId,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      });

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };

      const updatedTokens: StoredTokens = {
        accessToken: data.access_token,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
        refreshMode: 'google',
      };

      return updatedTokens;
    } catch (err) {
      console.error('[GoogleDriveConnection] Token refresh failed:', err);
      return null;
    }
  }

  private async refreshBrokerToken(
    tokens: StoredTokens
  ): Promise<StoredTokens | null> {
    try {
      const brokerUrl = normalizeBrokerUrl(
        tokens.authBrokerUrl ||
          (typeof BUILD_CONFIG !== 'undefined'
            ? ((BUILD_CONFIG as { googleAuthBrokerUrl?: string })
                .googleAuthBrokerUrl ?? '')
            : '')
      );

      if (!brokerUrl) {
        throw new Error('Google auth broker URL is missing');
      }

      const response = await fetch(`${brokerUrl}/api/google/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      if (!response.ok) {
        throw new Error(`Broker token refresh failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        accessToken: string;
        expiresIn: number;
        refreshToken?: string;
      };

      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? tokens.refreshToken,
        expiresAt: Date.now() + data.expiresIn * 1000,
        refreshMode: 'broker',
        authBrokerUrl: brokerUrl,
      };
    } catch (err) {
      console.error(
        '[GoogleDriveConnection] Broker token refresh failed:',
        err
      );
      return null;
    }
  }

  override async doConnect(_signal?: AbortSignal): Promise<DriveClient> {
    const tokens = this.readStoredTokens();
    if (!tokens) {
      throw new Error('No Google tokens found in localStorage');
    }

    let accessToken = tokens.accessToken;

    // Refresh if token is expired or expiring soon
    if (Date.now() >= tokens.expiresAt - REFRESH_BEFORE_EXPIRY_MS) {
      const newToken = await this.refreshStoredTokens(tokens);
      if (!newToken) {
        throw new Error('Google Drive access token expired and refresh failed');
      }
      accessToken = newToken;
    }

    // Verify the token by calling the Drive about API
    const response = await fetch(
      `${DRIVE_API}/about?fields=user,storageQuota`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: _signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Google Drive authentication failed (${response.status}): ${errorText}`
      );
    }

    return { accessToken };
  }

  override doDisconnect(_conn: DriveClient): void {
    // Drain the wait queue so callers don't hang
    const pending = this.waitQueue.splice(0);
    for (const resolve of pending) {
      resolve();
    }
    this.activeRequests = 0;
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++;
      return;
    }
    await new Promise<void>(resolve => {
      this.waitQueue.push(resolve);
    });
    this.activeRequests++;
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Authenticated fetch with rate limiting and 429 retry.
   */
  async driveFetch(
    url: string,
    init?: RequestInit,
    retries = 3
  ): Promise<Response> {
    await this.acquireSlot();
    try {
      const { accessToken } = this.inner;
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);

      const response = await fetch(url, { ...init, headers });

      if (response.status === 429 && retries > 0) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? 1);
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
        await new Promise(r => setTimeout(r, delay));
        return await this.driveFetch(url, init, retries - 1);
      }

      return response;
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Search files in appDataFolder.
   */
  async searchFiles(query: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: query,
      fields: 'files(id,name,modifiedTime,size,properties)',
      pageSize: '1000',
    });

    const response = await this.driveFetch(
      `${DRIVE_API}/files?${params.toString()}`
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive searchFiles failed (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as { files: DriveFile[] };
    return data.files ?? [];
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
    const metadata: Record<string, unknown> = {
      name,
      parents: ['appDataFolder'],
    };
    if (properties) {
      metadata['properties'] = properties;
    }

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

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Drive createFile failed (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<DriveFile>;
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

    if (!response.ok && response.status !== 204) {
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

function normalizeBrokerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Singleton connection instance shared between doc and blob storage for the
 * same process.  Using a single connection avoids redundant token checks and
 * ensures the concurrency slot budget is shared.
 */
let sharedConnection: GoogleDriveConnection | null = null;

export function getOrCreateGoogleDriveConnection(
  options: GoogleDriveConnectionOptions = {}
): GoogleDriveConnection {
  if (!sharedConnection) {
    sharedConnection = new GoogleDriveConnection(options);
  } else {
    sharedConnection.setTokenSnapshot(options.tokens);
  }
  return sharedConnection;
}
