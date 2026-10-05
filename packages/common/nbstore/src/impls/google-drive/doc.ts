import {
  type DocClock,
  type DocClocks,
  type DocRecord,
  DocStorageBase,
  type DocStorageOptions,
  type DocUpdate,
} from '../../storage';
import {
  getOrCreateGoogleDriveConnection,
  type GoogleDriveConnection,
  type GoogleDriveTokens,
} from './connection';

type GoogleDriveDocStorageOptions = DocStorageOptions & {
  deviceId?: string;
  tokens?: GoogleDriveTokens | null;
};

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getDeviceId(deviceId?: string): string {
  if (deviceId) return deviceId;

  const KEY = 'nota:gdrive:deviceId';
  try {
    if (typeof localStorage === 'undefined') return generateUUID();
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
    const id = generateUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // localStorage unavailable (e.g. SSR / tests)
    return generateUUID();
  }
}

export class GoogleDriveDocStorage extends DocStorageBase<GoogleDriveDocStorageOptions> {
  static readonly identifier = 'google-drive:doc';

  readonly connection: GoogleDriveConnection;

  private readonly deviceId: string;

  constructor(options: GoogleDriveDocStorageOptions) {
    super(options);
    this.deviceId = getDeviceId(options.deviceId);
    this.connection = getOrCreateGoogleDriveConnection({
      tokens: options.tokens,
    });
  }

  // ── File name helpers ────────────────────────────────────────────────────────

  private snapshotName(docId: string): string {
    return `ws_${this.spaceId}_doc_${docId}_snapshot`;
  }

  private updateNamePrefix(docId: string): string {
    return `ws_${this.spaceId}_doc_${docId}_update_`;
  }

  private updateName(docId: string, timestamp: number): string {
    return `${this.updateNamePrefix(docId)}${timestamp}_${this.deviceId}`;
  }

  // ── DocStorageBase protected abstract implementation ─────────────────────────

  protected override async getDocSnapshot(
    docId: string
  ): Promise<DocRecord | null> {
    const name = this.snapshotName(docId);
    const files = await this.connection.searchFiles(
      `name = '${name}' and trashed = false`
    );

    if (!files.length) return null;

    const file = files[0];
    const bin = await this.connection.downloadFile(file.id);

    return {
      docId,
      bin,
      timestamp: file.modifiedTime ? new Date(file.modifiedTime) : new Date(0),
    };
  }

  protected override async setDocSnapshot(
    snapshot: DocRecord,
    _prevSnapshot: DocRecord | null
  ): Promise<boolean> {
    const name = this.snapshotName(snapshot.docId);
    const existing = await this.connection.searchFiles(
      `name = '${name}' and trashed = false`
    );

    if (existing.length) {
      // Only overwrite if incoming snapshot is newer
      const existingTs = existing[0].modifiedTime
        ? new Date(existing[0].modifiedTime).getTime()
        : 0;
      if (snapshot.timestamp.getTime() < existingTs) {
        return false;
      }
      await this.connection.updateFile(existing[0].id, snapshot.bin);
    } else {
      await this.connection.createFile(name, snapshot.bin);
    }

    this.emit('snapshot', snapshot, _prevSnapshot);
    return true;
  }

  protected override async getDocUpdates(docId: string): Promise<DocRecord[]> {
    const prefix = this.updateNamePrefix(docId);
    const files = await this.connection.searchFiles(
      `name contains '${prefix}' and trashed = false`
    );

    const records: DocRecord[] = [];
    for (const file of files) {
      const bin = await this.connection.downloadFile(file.id);
      records.push({
        docId,
        bin,
        timestamp: file.modifiedTime
          ? new Date(file.modifiedTime)
          : new Date(0),
      });
    }

    // Sort ascending by timestamp so squash works correctly
    records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return records;
  }

  protected override async markUpdatesMerged(
    docId: string,
    updates: DocRecord[]
  ): Promise<number> {
    if (!updates.length) return 0;

    // Find update files whose timestamps match those of the merged records
    const prefix = this.updateNamePrefix(docId);
    const files = await this.connection.searchFiles(
      `name contains '${prefix}' and trashed = false`
    );

    const mergedTs = new Set(updates.map(u => u.timestamp.getTime()));
    let deleted = 0;

    await Promise.all(
      files.map(async file => {
        const ts = file.modifiedTime
          ? new Date(file.modifiedTime).getTime()
          : 0;
        if (mergedTs.has(ts)) {
          await this.connection.deleteFile(file.id);
          deleted++;
        }
      })
    );

    return deleted;
  }

  // ── DocStorage public abstract implementation ────────────────────────────────

  override async pushDocUpdate(
    update: DocUpdate,
    _origin?: string
  ): Promise<DocClock> {
    const timestamp = Date.now();
    const name = this.updateName(update.docId, timestamp);
    await this.connection.createFile(name, update.bin);

    const clock: DocClock = {
      docId: update.docId,
      timestamp: new Date(timestamp),
    };

    this.emit(
      'update',
      { ...clock, bin: update.bin, editor: update.editor },
      _origin
    );

    return clock;
  }

  override async getDocTimestamp(docId: string): Promise<DocClock | null> {
    const snapshot = await this.getDocSnapshot(docId);
    const updates = await this.getDocUpdates(docId);

    const all = [...(snapshot ? [snapshot] : []), ...updates];
    if (!all.length) return null;

    const latest = all.reduce((best, cur) =>
      cur.timestamp > best.timestamp ? cur : best
    );

    return { docId, timestamp: latest.timestamp };
  }

  override async getDocTimestamps(after?: Date): Promise<DocClocks> {
    // List all snapshot files for this workspace
    const prefix = `ws_${this.spaceId}_doc_`;
    const snapshotSuffix = '_snapshot';
    const files = await this.connection.searchFiles(
      `name contains '${prefix}' and name contains '${snapshotSuffix}' and trashed = false`
    );

    const clocks: DocClocks = {};

    for (const file of files) {
      // Extract docId from name: ws_{spaceId}_doc_{docId}_snapshot
      const withoutPrefix = file.name.slice(prefix.length);
      const withoutSuffix = withoutPrefix.endsWith(snapshotSuffix)
        ? withoutPrefix.slice(0, -snapshotSuffix.length)
        : null;
      if (!withoutSuffix) continue;

      const ts = file.modifiedTime ? new Date(file.modifiedTime) : new Date(0);
      if (after && ts <= after) continue;

      clocks[withoutSuffix] = ts;
    }

    return clocks;
  }

  override async deleteDoc(docId: string): Promise<void> {
    const snapshotName = this.snapshotName(docId);
    const updatePrefix = this.updateNamePrefix(docId);

    const [snapshots, updates] = await Promise.all([
      this.connection.searchFiles(
        `name = '${snapshotName}' and trashed = false`
      ),
      this.connection.searchFiles(
        `name contains '${updatePrefix}' and trashed = false`
      ),
    ]);

    await Promise.all(
      [...snapshots, ...updates].map(f => this.connection.deleteFile(f.id))
    );
  }
}
