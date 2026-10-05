import {
  type BlobRecord,
  BlobStorageBase,
  type ListedBlobRecord,
} from '../../storage';
import {
  getOrCreateGoogleDriveConnection,
  type GoogleDriveConnection,
  type GoogleDriveTokens,
} from './connection';

interface GoogleDriveBlobStorageOptions {
  id: string;
  tokens?: GoogleDriveTokens | null;
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
      `name = '${name}' and trashed = false`
    );

    if (!files.length) return null;

    const file = files[0];
    const data = await this.connection.downloadFile(file.id);
    const mime = file.properties?.['mime'] ?? 'application/octet-stream';
    const createdAt = file.modifiedTime
      ? new Date(file.modifiedTime)
      : undefined;

    return { key, data, mime, createdAt };
  }

  override async set(blob: BlobRecord, _signal?: AbortSignal): Promise<void> {
    const name = this.blobName(blob.key);
    const existing = await this.connection.searchFiles(
      `name = '${name}' and trashed = false`
    );

    if (existing.length) {
      await this.connection.updateFile(existing[0].id, blob.data, blob.mime);
    } else {
      await this.connection.createFile(name, blob.data, blob.mime, {
        mime: blob.mime,
      });
    }
  }

  override async delete(
    key: string,
    _permanently: boolean,
    _signal?: AbortSignal
  ): Promise<void> {
    const name = this.blobName(key);
    const files = await this.connection.searchFiles(
      `name = '${name}' and trashed = false`
    );

    await Promise.all(files.map(f => this.connection.deleteFile(f.id)));
  }

  override async release(_signal?: AbortSignal): Promise<void> {
    // No-op: Google Drive manages trash lifecycle externally.
  }

  override async list(_signal?: AbortSignal): Promise<ListedBlobRecord[]> {
    const prefix = `ws_${this.spaceId}_blob_`;
    const files = await this.connection.searchFiles(
      `name contains '${prefix}' and trashed = false`
    );

    return files.map(file => {
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
