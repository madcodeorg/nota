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
  DriveNotFoundError,
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
  /** Minimum time between two uploads of the same page; edits in between are merged. */
  pushIntervalMs?: number;
  /** Compact a page once it has at least this many Drive files. */
  compactThreshold?: number;
  /** Only compact pages whose newest Drive file is at least this old. */
  compactMinAgeMs?: number;
};

interface DocCache {
  bin: Uint8Array;
  fileIds: Set<string>;
}

const MAX_CACHED_DOCS = 200;
const INDEX_REFRESH_MS = 1000;

export async function driveContentHash(content: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', content.slice().buffer);
  return [...new Uint8Array(hash)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fileTime(file: DriveFile): number {
  return file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0;
}

/** A snapshot stands for every file it replaced; an update stands for itself. */
function fileWeight(file: DriveFile): number {
  const weight = Number(file.properties?.['weight']);
  return Number.isInteger(weight) && weight > 0 ? weight : 1;
}

/**
 * Newest file time plus the total weight. Any new file raises it, even one
 * listed late with an older time, and compaction keeps the total while adding
 * a newer snapshot, so the clock never moves backwards. Clocks are discovery
 * hints, never deletion authority.
 */
export function fileClock(files: DriveFile[]): Date {
  const newest = Math.max(0, ...files.map(fileTime));
  return new Date(
    newest + files.reduce((total, file) => total + fileWeight(file), 0)
  );
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

export class GoogleDriveDocStorage extends DocStorageBase<GoogleDriveDocStorageOptions> {
  static readonly identifier = 'google-drive:doc';
  readonly connection: GoogleDriveConnection;

  /** Drive files of this workspace's pages, kept current through the changes feed. */
  private readonly index = new Map<string, DriveFile>();
  private indexLoaded = false;
  private changeToken: string | null = null;
  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;
  private readonly cache = new Map<string, DocCache>();
  /** Names whose upload may have reached Drive without a response. */
  private readonly uncertainUploads = new Set<string>();
  private readonly lastPush = new Map<string, number>();
  private readonly compacting = new Set<string>();

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

  private get docPrefix(): string {
    return `ws_${this.spaceId}_doc_`;
  }

  private prefix(docId: string): string {
    return `${this.docPrefix}${docId}`;
  }

  private docIdOf(file: DriveFile): string | null {
    if (!file.name.startsWith(this.docPrefix)) return null;
    if (file.properties?.['docId']) return file.properties['docId'];
    const rest = file.name.slice(this.docPrefix.length);
    const update = rest.lastIndexOf('_update_');
    if (update > 0) return rest.slice(0, update);
    const snapshot = rest.lastIndexOf('_snapshot');
    return snapshot > 0 ? rest.slice(0, snapshot) : null;
  }

  private isDocFile(file: DriveFile): boolean {
    const docId = this.docIdOf(file);
    if (!docId) return false;
    const prefix = this.prefix(docId);
    return (
      file.name === `${prefix}_snapshot` ||
      file.name.startsWith(`${prefix}_snapshot_`) ||
      file.name.startsWith(`${prefix}_update_`)
    );
  }

  private async loadIndex(): Promise<void> {
    // Take the cursor before listing so changes made during the listing are replayed.
    const token = await this.connection.getStartPageToken().catch(() => null);
    const files = await this.connection.searchFiles(
      `name contains '${driveQueryValue(this.docPrefix)}' and trashed = false`
    );
    this.index.clear();
    for (const file of files)
      if (this.isDocFile(file)) this.index.set(file.id, file);
    this.changeToken = token;
    this.indexLoaded = true;
  }

  private async applyChanges(token: string): Promise<void> {
    const { changes, nextToken } = await this.connection.listChanges(token);
    for (const change of changes) {
      if (change.removed || !change.file || change.file.trashed)
        this.index.delete(change.fileId);
      else if (this.isDocFile(change.file))
        this.index.set(change.fileId, change.file);
    }
    this.changeToken = nextToken;
  }

  /** Refresh at most once per second; the changes feed makes an idle refresh one request. */
  private refreshIndex(force = false): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (
      !force &&
      this.indexLoaded &&
      Date.now() - this.lastRefresh < INDEX_REFRESH_MS
    )
      return Promise.resolve();
    this.refreshing = (async () => {
      try {
        if (this.indexLoaded && this.changeToken && !force) {
          try {
            await this.applyChanges(this.changeToken);
          } catch {
            await this.loadIndex();
          }
        } else {
          await this.loadIndex();
        }
        this.lastRefresh = Date.now();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private docFiles(docId: string): DriveFile[] {
    return [...this.index.values()].filter(
      file => this.docIdOf(file) === docId
    );
  }

  private remember(docId: string, cache: DocCache) {
    this.cache.delete(docId);
    this.cache.set(docId, cache);
    if (this.cache.size > MAX_CACHED_DOCS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  /** Read-only merge of the page's files; only files this device has not seen are downloaded. */
  override async getDoc(docId: string): Promise<DocRecord | null> {
    for (let attempt = 0; ; attempt++) {
      await this.refreshIndex(attempt > 0);
      const files = this.docFiles(docId);
      if (!files.length) return null;
      const cached = this.cache.get(docId);
      const missing = files.filter(file => !cached?.fileIds.has(file.id));
      try {
        if (missing.length || !cached) {
          const updates = await Promise.all(
            missing.map(file => this.connection.downloadFile(file.id))
          );
          this.remember(docId, {
            bin: await this.mergeUpdates(
              cached ? [cached.bin, ...updates] : updates
            ),
            fileIds: new Set([
              ...(cached?.fileIds ?? []),
              ...missing.map(file => file.id),
            ]),
          });
        }
      } catch (error) {
        // A listed file can be compacted away by another device; its content is
        // in a newer snapshot, so list again and read that instead.
        if (error instanceof DriveNotFoundError && attempt < 3) continue;
        throw error;
      }
      const current = this.cache.get(docId);
      if (!current) continue;
      this.scheduleCompaction(docId);
      return { docId, bin: current.bin, timestamp: fileClock(files) };
    }
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

  /**
   * Upload one immutable file named by its content hash. Waiting here while the
   * sync loop queues newer edits makes them arrive merged in the next upload.
   */
  override async pushDocUpdate(
    update: DocUpdate,
    origin?: string
  ): Promise<DocClock> {
    const interval = this.options.pushIntervalMs ?? 3000;
    const wait = (this.lastPush.get(update.docId) ?? 0) + interval - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastPush.set(update.docId, Date.now());

    const hash = await driveContentHash(update.bin);
    const name = `${this.prefix(update.docId)}_update_sha256_${hash}`;
    await this.refreshIndex();
    let file = [...this.index.values()].find(item => item.name === name);
    if (!file && this.uncertainUploads.has(name)) {
      file = (
        await this.connection.searchFiles(
          `name = '${driveQueryValue(name)}' and trashed = false`
        )
      )[0];
    }
    if (file) {
      if (this.uncertainUploads.has(name)) {
        const content = await this.connection.downloadFile(file.id);
        if ((await driveContentHash(content)) !== hash)
          throw new Error('Drive update content does not match its identity.');
      } else if (
        file.properties?.['sha256'] &&
        file.properties['sha256'] !== hash
      ) {
        throw new Error('Drive update content does not match its identity.');
      }
    } else {
      try {
        file = await this.connection.createFile(
          name,
          update.bin,
          'application/octet-stream',
          { workspaceId: this.spaceId, docId: update.docId, sha256: hash }
        );
      } catch (error) {
        this.uncertainUploads.add(name);
        throw error;
      }
    }
    this.uncertainUploads.delete(name);
    this.index.set(file.id, file);
    const cached = this.cache.get(update.docId);
    if (cached && !cached.fileIds.has(file.id)) {
      this.remember(update.docId, {
        bin: await this.mergeUpdates([cached.bin, update.bin]),
        fileIds: new Set([...cached.fileIds, file.id]),
      });
    }
    const clock = {
      docId: update.docId,
      timestamp: fileClock(this.docFiles(update.docId)),
    };
    this.emit(
      'update',
      { ...clock, bin: update.bin, editor: update.editor },
      origin
    );
    return clock;
  }

  private scheduleCompaction(docId: string) {
    if (this.isReadonly || this.compacting.has(docId)) return;
    const files = this.docFiles(docId);
    if (files.length < (this.options.compactThreshold ?? 50)) return;
    const newest = Math.max(...files.map(fileTime));
    if (Date.now() - newest < (this.options.compactMinAgeMs ?? 60000)) return;
    this.compactDoc(docId).catch(() => undefined);
  }

  /**
   * Publish one snapshot holding everything this device has downloaded for the
   * page, verify it, then delete exactly the files it covers. Files created
   * later, or never downloaded here, are left alone. Two devices compacting at
   * once leave two snapshots, which merge to the same page.
   */
  async compactDoc(docId: string): Promise<void> {
    if (this.compacting.has(docId)) return;
    this.compacting.add(docId);
    try {
      await this.compactNow(docId);
    } finally {
      this.compacting.delete(docId);
    }
  }

  private async compactNow(docId: string): Promise<void> {
    await this.getDoc(docId);
    const cached = this.cache.get(docId);
    if (!cached) return;
    const covered = this.docFiles(docId).filter(file =>
      cached.fileIds.has(file.id)
    );
    if (covered.length < 2) return;
    const bin = cached.bin;
    const hash = await driveContentHash(bin);
    const name = `${this.prefix(docId)}_snapshot_sha256_${hash}`;
    const snapshot =
      covered.find(file => file.name === name) ??
      (await this.connection.createFile(name, bin, 'application/octet-stream', {
        workspaceId: this.spaceId,
        docId,
        sha256: hash,
        kind: 'snapshot',
        weight: String(
          covered.reduce((total, file) => total + fileWeight(file), 0)
        ),
      }));
    const published = await this.connection.downloadFile(snapshot.id);
    if ((await driveContentHash(published)) !== hash)
      throw new Error('Drive snapshot could not be verified.');
    this.index.set(snapshot.id, snapshot);
    this.cache.get(docId)?.fileIds.add(snapshot.id);
    for (const file of covered) {
      if (file.id === snapshot.id) continue;
      await this.connection.deleteFile(file.id);
      this.index.delete(file.id);
      this.cache.get(docId)?.fileIds.delete(file.id);
    }
  }

  override async getDocTimestamp(docId: string): Promise<DocClock | null> {
    await this.refreshIndex();
    const files = this.docFiles(docId);
    return files.length ? { docId, timestamp: fileClock(files) } : null;
  }

  override async getDocTimestamps(_after?: Date): Promise<DocClocks> {
    await this.refreshIndex();
    const groups = new Map<string, DriveFile[]>();
    for (const file of this.index.values()) {
      const docId = this.docIdOf(file);
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
