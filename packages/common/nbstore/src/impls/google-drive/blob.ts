import {
  type BlobRecord,
  BlobStorageBase,
  type ListedBlobRecord,
} from '../../storage';
import {
  driveQueryValue,
  getOrCreateGoogleDriveConnection,
  type GoogleDriveConnection,
  type GoogleDriveTokens,
} from './connection';
import { driveContentHash } from './doc';

interface GoogleDriveBlobStorageOptions {
  id: string;
  tokens?: GoogleDriveTokens | null;
  accountId?: string;
}

export class GoogleDriveBlobStorage extends BlobStorageBase {
  static readonly identifier = 'google-drive:blob';

  override readonly isReadonly = false;

  readonly connection: GoogleDriveConnection;

  private readonly spaceId: string;

  constructor(options: GoogleDriveBlobStorageOptions) {
    super();
    this.spaceId = options.id;
    this.connection = getOrCreateGoogleDriveConnection({
      tokens: options.tokens,
      accountId: options.accountId,
      connectionKey: options.id,
    });
  }

  private blobName(key: string): string {
    return `ws_${this.spaceId}_blob_${key}`;
  }

  override async get(
    key: string,
    _signal?: AbortSignal
  ): Promise<BlobRecord | null> {
    const name = this.blobName(key);
    const files = await this.connection.searchFiles(
      `name = '${driveQueryValue(name)}' and trashed = false`
    );

    if (!files.length) return null;

    const file = files[0];
    const data = await this.connection.downloadFile(file.id);
    if (
      file.properties?.['sha256'] &&
      (await driveContentHash(data)) !== file.properties['sha256']
    )
      throw new Error('Drive attachment content does not match its identity.');
    const mime = file.properties?.['mime'] ?? 'application/octet-stream';
    const createdAt = file.modifiedTime
      ? new Date(file.modifiedTime)
      : undefined;

    return { key, data, mime, createdAt };
  }

  override async set(blob: BlobRecord, _signal?: AbortSignal): Promise<void> {
    const name = this.blobName(blob.key);
    const existing = await this.connection.searchFiles(
      `name = '${driveQueryValue(name)}' and trashed = false`
    );

    if (existing.length) {
      const data = await this.connection.downloadFile(existing[0].id);
      if (
        (await driveContentHash(data)) !== (await driveContentHash(blob.data))
      )
        throw new Error(
          'Drive attachment identity contains conflicting data. Original local media retained.'
        );
    } else {
      await this.connection.createFile(name, blob.data, blob.mime, {
        mime: blob.mime,
        sha256: await driveContentHash(blob.data),
      });
    }
  }

  override async delete(
    key: string,
    _permanently: boolean,
    _signal?: AbortSignal
  ): Promise<void> {
    // Removed media can still be referenced by another offline device or history.
    // Retain remote content until a cross-device garbage collection protocol exists.
    void key;
  }

  override async release(_signal?: AbortSignal): Promise<void> {
    // No-op: Google Drive manages trash lifecycle externally.
  }

  override async list(_signal?: AbortSignal): Promise<ListedBlobRecord[]> {
    const prefix = `ws_${this.spaceId}_blob_`;
    const files = await this.connection.searchFiles(
      `name contains '${driveQueryValue(prefix)}' and trashed = false`
    );

    return files
      .filter(file => file.name.startsWith(prefix))
      .map(file => {
        const key = file.name.slice(prefix.length);
        const mime = file.properties?.['mime'] ?? 'application/octet-stream';
        const size = file.size ? Number(file.size) : 0;
        const createdAt = file.modifiedTime
          ? new Date(file.modifiedTime)
          : undefined;

        return { key, mime, size, createdAt };
      });
  }
}
