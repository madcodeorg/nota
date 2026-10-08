import {
  type DocClock,
  type DocClocks,
  type DocRecord,
  DocStorageBase,
  type DocStorageOptions,
  type DocUpdate,
} from '../../storage';
import {
  type DriveFile,
  driveQueryValue,
  getOrCreateGoogleDriveConnection,
  type GoogleDriveConnection,
  type GoogleDriveTokens,
} from './connection';

type GoogleDriveDocStorageOptions = DocStorageOptions & {
  deviceId?: string;
  pollingIntervalMs?: number;
  accountId?: string;
  tokens?: GoogleDriveTokens | null;
};

export async function driveContentHash(content: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', content.slice().buffer);
  return [...new Uint8Array(hash)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fileClock(files: DriveFile[]): Date {
  // Counts distinguish concurrent files with the same millisecond timestamp.
  // Updates are append-only; clocks are discovery hints, never deletion authority.
  return new Date(
    Math.max(
      0,
      ...files.map(file =>
        file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0
      )
    ) + files.length
  );
}

export class GoogleDriveDocStorage extends DocStorageBase<GoogleDriveDocStorageOptions> {
  static readonly identifier = 'google-drive:doc';
  readonly connection: GoogleDriveConnection;

  constructor(options: GoogleDriveDocStorageOptions) {
    super(options);
    this.connection = getOrCreateGoogleDriveConnection({
      accountId: options.accountId,
      connectionKey: options.id,
      tokens: options.tokens,
    });
  }

  override subscribeDocUpdate(
    callback: (update: DocRecord, origin?: string) => void
  ): () => void {
    const off = super.subscribeDocUpdate(callback);
    const known = new Map<string, number>();
    let disposed = false;
    let running = false;
    const poll = async () => {
      if (disposed || running || this.connection.status !== 'connected') return;
      running = true;
      try {
        const clocks = await this.getDocTimestamps();
        for (const [docId, timestamp] of Object.entries(clocks)) {
          if (disposed) return;
          if (known.get(docId) === timestamp.getTime()) continue;
          const record = await this.getDoc(docId);
          if (record && !disposed) {
            known.set(docId, record.timestamp.getTime());
            callback(record);
          }
        }
      } catch {
        // nbstore retries remote connection failures independently from local saving.
      } finally {
        running = false;
      }
    };
    const timer = setInterval(
      () => void poll(),
      this.options.pollingIntervalMs ?? 10000
    );
    poll().catch(() => undefined);
    return () => {
      disposed = true;
      clearInterval(timer);
      off();
    };
  }

  private prefix(docId: string): string {
    return `ws_${this.spaceId}_doc_${docId}`;
  }

  private async files(docId: string): Promise<DriveFile[]> {
    const prefix = this.prefix(docId);
    const files = await this.connection.searchFiles(
      `name contains '${driveQueryValue(prefix)}' and trashed = false`
    );
    return files.filter(
      file =>
        file.name === `${prefix}_snapshot` ||
        file.name.startsWith(`${prefix}_update_`)
    );
  }

  /** Read-only merge: a process-local lock cannot safely compact two devices. */
  override async getDoc(docId: string): Promise<DocRecord | null> {
    const files = await this.files(docId);
    if (!files.length) return null;
    const updates = await Promise.all(
      files.map(file => this.connection.downloadFile(file.id))
    );
    return {
      docId,
      bin: await this.mergeUpdates(updates),
      timestamp: fileClock(files),
    };
  }

  protected override async getDocSnapshot(
    _docId: string
  ): Promise<DocRecord | null> {
    return null;
  }
  protected override async setDocSnapshot(
    _snapshot: DocRecord,
    _previous: DocRecord | null
  ): Promise<boolean> {
    return false;
  }
  protected override async getDocUpdates(_docId: string): Promise<DocRecord[]> {
    return [];
  }
  protected override async markUpdatesMerged(
    _docId: string,
    _updates: DocRecord[]
  ): Promise<number> {
    return 0;
  }

  override async pushDocUpdate(
    update: DocUpdate,
    origin?: string
  ): Promise<DocClock> {
    const hash = await driveContentHash(update.bin);
    const name = `${this.prefix(update.docId)}_update_sha256_${hash}`;
    const existing = await this.connection.searchFiles(
      `name = '${driveQueryValue(name)}' and trashed = false`
    );
    if (!existing.length) {
      await this.connection.createFile(
        name,
        update.bin,
        'application/octet-stream',
        {
          workspaceId: this.spaceId,
          docId: update.docId,
          sha256: hash,
        }
      );
    } else {
      // An indeterminate upload is retried by nbstore. Verify before acknowledging.
      const content = await this.connection.downloadFile(existing[0].id);
      if ((await driveContentHash(content)) !== hash)
        throw new Error('Drive update content does not match its identity.');
    }
    const clock = {
      docId: update.docId,
      timestamp: fileClock(await this.files(update.docId)),
    };
    this.emit(
      'update',
      { ...clock, bin: update.bin, editor: update.editor },
      origin
    );
    return clock;
  }

  override async getDocTimestamp(docId: string): Promise<DocClock | null> {
    const files = await this.files(docId);
    return files.length ? { docId, timestamp: fileClock(files) } : null;
  }

  override async getDocTimestamps(_after?: Date): Promise<DocClocks> {
    const prefix = `ws_${this.spaceId}_doc_`;
    const files = await this.connection.searchFiles(
      `name contains '${driveQueryValue(prefix)}' and trashed = false`
    );
    const groups = new Map<string, DriveFile[]>();
    for (const file of files) {
      if (!file.name.startsWith(prefix)) continue;
      const rest = file.name.slice(prefix.length);
      const docId =
        file.properties?.['docId'] ??
        (rest.endsWith('_snapshot')
          ? rest.slice(0, -9)
          : rest.slice(0, rest.lastIndexOf('_update_')));
      if (!docId) continue;
      const group = groups.get(docId) ?? [];
      group.push(file);
      groups.set(docId, group);
    }
    return Object.fromEntries(
      [...groups].map(([id, files]) => [id, fileClock(files)])
    );
  }

  override async deleteDoc(_docId: string): Promise<void> {
    throw new Error(
      'Permanent Drive document removal is unavailable. Move the page to workspace Trash.'
    );
  }
}
