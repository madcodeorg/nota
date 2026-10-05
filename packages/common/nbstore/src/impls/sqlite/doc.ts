import { mergeUpdates } from 'yjs';

import { share } from '../../connection';
import {
  type BlockInfo,
  type CrawlResult,
  type DocClocks,
  type DocRecord,
  type DocUpdate,
  HistoricalDocStorage,
  type HistoryCleanupProtection,
  type HistoryFilter,
  LOCAL_HISTORY_LIMIT,
} from '../../storage';
import { NativeDBConnection, type SqliteNativeDBOptions } from './db';

export class SqliteDocStorage extends HistoricalDocStorage<SqliteNativeDBOptions> {
  static readonly identifier = 'SqliteDocStorage';
  override connection = share(new NativeDBConnection(this.options));

  get db() {
    return this.connection.apis;
  }

  override async pushDocUpdate(update: DocUpdate, origin?: string) {
    const timestamp = await this.db.pushUpdate(update.docId, update.bin);

    this.emit(
      'update',
      {
        docId: update.docId,
        bin: update.bin,
        timestamp,
        editor: update.editor,
      },
      origin
    );

    return { docId: update.docId, timestamp };
  }

  override async deleteDoc(docId: string) {
    await this.db.deleteDoc(docId);
  }

  override async isHistorySupported(): Promise<boolean> {
    try {
      return (await this.db.hasDocHistory?.()) ?? false;
    } catch {
      // Older mobile RPC/native bridges expose canonical storage only.
      return false;
    }
  }

  override async getHistoryStorageUsage() {
    if (!this.db.getDocHistoryStorageUsage)
      throw new Error('Local history cleanup is unavailable on this platform.');
    return this.db.getDocHistoryStorageUsage();
  }

  protected override async clearHistoriesWithProtection(
    protection: HistoryCleanupProtection
  ) {
    if (!this.db.clearDocHistories)
      throw new Error('Local history cleanup is unavailable on this platform.');
    await this.db.clearDocHistories(protection);
  }

  override async listHistories(docId: string, filter?: HistoryFilter) {
    if (!this.db.listDocHistories)
      throw new Error('Local history is unavailable on this platform.');
    return (
      await this.db.listDocHistories(
        docId,
        filter?.before,
        Math.max(
          0,
          Math.min(filter?.limit ?? LOCAL_HISTORY_LIMIT, LOCAL_HISTORY_LIMIT)
        )
      )
    ).map(history => ({ timestamp: history.timestamp, userId: null }));
  }

  override async getHistory(
    docId: string,
    timestamp: Date
  ): Promise<DocRecord | null> {
    if (!this.db.getDocHistory)
      throw new Error('Local history is unavailable on this platform.');
    const history = await this.db.getDocHistory(docId, timestamp);
    return history
      ? { docId, timestamp: history.timestamp, bin: mergeUpdates(history.bins) }
      : null;
  }

  override async deleteHistory(docId: string, timestamp: Date) {
    if (!this.db.deleteDocHistory)
      throw new Error('Local history is unavailable on this platform.');
    await this.db.deleteDocHistory(docId, timestamp);
  }

  protected override async createHistory(_docId: string, snapshot: DocRecord) {
    if (!this.db.createDocHistory)
      throw new Error('Local history is unavailable on this platform.');
    await this.db.createDocHistory(snapshot);
  }

  protected override async pushDocUpdateForRollback(
    update: DocUpdate,
    expectedTimestamp: Date
  ) {
    if (!this.db.pushUpdateForRollback)
      throw new Error('Local history is unavailable on this platform.');
    const timestamp = await this.db.pushUpdateForRollback(
      update.docId,
      update.bin,
      expectedTimestamp
    );
    this.emit('update', { ...update, timestamp }, 'rollback');
    return { docId: update.docId, timestamp };
  }

  override async getDocTimestamps(after?: Date) {
    const clocks = await this.db.getDocClocks(after);

    return clocks.reduce((ret, cur) => {
      ret[cur.docId] = cur.timestamp;
      return ret;
    }, {} as DocClocks);
  }

  override async getDocTimestamp(docId: string) {
    return this.db.getDocClock(docId);
  }

  protected override async getDocSnapshot(docId: string) {
    const snapshot = await this.db.getDocSnapshot(docId);

    if (!snapshot) {
      return null;
    }

    return snapshot;
  }

  protected override async setDocSnapshot(
    snapshot: DocRecord
  ): Promise<boolean> {
    return this.db.setDocSnapshot({
      docId: snapshot.docId,
      bin: snapshot.bin,
      timestamp: snapshot.timestamp,
    });
  }

  protected override async getDocUpdates(docId: string) {
    return this.db.getDocUpdates(docId);
  }

  protected override markUpdatesMerged(docId: string, updates: DocRecord[]) {
    return this.db.markUpdatesMerged(
      docId,
      updates.map(update => update.timestamp)
    );
  }

  override async crawlDocData(docId: string): Promise<CrawlResult | null> {
    const result = await this.db.crawlDocData(docId);
    if (result === null) return null;
    return normalizeNativeCrawlResult(result);
  }
}

function normalizeNativeCrawlResult(result: unknown): CrawlResult | null {
  if (!isRecord(result)) {
    console.warn('[nbstore] crawlDocData returned non-object result');
    return null;
  }

  if (
    typeof result.title !== 'string' ||
    typeof result.summary !== 'string' ||
    !Array.isArray(result.blocks)
  ) {
    console.warn('[nbstore] crawlDocData result missing basic fields');
    return null;
  }

  const { title, summary } = result as { title: string; summary: string };
  const rawBlocks = result.blocks as unknown[];

  const blocks: BlockInfo[] = [];
  for (const block of rawBlocks) {
    const normalized = normalizeBlock(block);
    if (normalized) {
      blocks.push(normalized);
    }
  }

  if (blocks.length === 0) {
    console.warn('[nbstore] crawlDocData has no valid blocks');
    return null;
  }

  return {
    blocks,
    title,
    summary,
  };
}

function normalizeBlock(block: unknown): BlockInfo | null {
  if (!isRecord(block)) {
    return null;
  }

  const blockId = readStringField(block, 'blockId');
  const flavour = readStringField(block, 'flavour');

  if (!blockId || !flavour) {
    return null;
  }

  return {
    blockId,
    flavour,
    content: readStringArrayField(block, 'content'),
    blob: readStringArrayField(block, 'blob'),
    refDocId: readStringArrayField(block, 'refDocId'),
    refInfo: readStringArrayField(block, 'refInfo'),
    parentFlavour: readStringField(block, 'parentFlavour'),
    parentBlockId: readStringField(block, 'parentBlockId'),
    additional: safeAdditionalField(block),
  };
}

function readStringField(
  target: Record<string, unknown>,
  key: string
): string | undefined {
  const value = readField(target, key);
  return typeof value === 'string' && value ? value : undefined;
}

function readStringArrayField(
  target: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = readField(target, key);
  if (Array.isArray(value)) {
    const filtered = value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0
    );
    return filtered.length ? filtered : undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return undefined;
}

function safeAdditionalField(
  target: Record<string, unknown>
): string | undefined {
  const value = readField(target, 'additional');
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  } catch {
    console.warn(
      '[nbstore] ignore invalid additional payload in crawlDocData block'
    );
    return undefined;
  }
}

function readField(target: Record<string, unknown>, key: string) {
  return target[key] ?? target[toSnakeCase(key)];
}

function toSnakeCase(key: string) {
  return key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
