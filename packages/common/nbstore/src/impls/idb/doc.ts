import { mergeUpdates } from 'yjs';

import { share } from '../../connection';
import {
  type DocClock,
  type DocClocks,
  type DocRecord,
  type DocUpdate,
  HistoricalDocStorage,
  type HistoryCleanupProtection,
  type HistoryFilter,
  type HistoryStorageUsage,
  LOCAL_HISTORY_INTERVAL_MS,
  LOCAL_HISTORY_LIMIT,
  LOCAL_HISTORY_MAX_BYTES,
} from '../../storage';
import { isEmptyUpdate } from '../../utils/is-empty-update';
import { IDBConnection, type IDBConnectionOptions } from './db';
import { IndexedDBLocker } from './lock';

interface ChannelMessage {
  type: 'update';
  update: DocRecord;
  origin?: string;
}

export class IndexedDBDocStorage extends HistoricalDocStorage<IDBConnectionOptions> {
  static readonly identifier = 'IndexedDBDocStorage';

  readonly connection = share(new IDBConnection(this.options));

  get db() {
    return this.connection.inner.db;
  }

  get channel() {
    return this.connection.inner.channel;
  }

  override locker = new IndexedDBLocker(this.connection);

  override async pushDocUpdate(update: DocUpdate, origin?: string) {
    return this.pushUpdate(update, origin);
  }

  protected override pushDocUpdateForRollback(
    update: DocUpdate,
    expectedTimestamp: Date
  ) {
    return this.pushUpdate(update, 'rollback', expectedTimestamp);
  }

  private async pushUpdate(
    update: DocUpdate,
    origin?: string,
    expectedTimestamp?: Date
  ) {
    let timestamp = new Date();

    let retry = 0;

    while (true) {
      const trx = this.db.transaction(
        ['updates', 'clocks', 'snapshots', 'histories'],
        'readwrite'
      );
      // Request failures can abort independently of the awaited request promise.
      void trx.done.catch(() => {});
      try {
        // IDB serializes readwrite transactions before these clock reads.

        const clock = await trx.objectStore('clocks').get(update.docId);
        if (
          expectedTimestamp &&
          (!clock || clock.timestamp.getTime() !== expectedTimestamp.getTime())
        ) {
          trx.abort();
          await trx.done.catch(() => {});
          throw new Error(
            'The page changed. Refresh its history before restoring.'
          );
        }
        if (clock && clock.timestamp >= timestamp) {
          timestamp = new Date(clock.timestamp.getTime() + 1);
        }

        await trx.objectStore('updates').add({
          ...update,
          createdAt: timestamp,
        });

        if (!isEmptyUpdate(update.bin)) {
          const latestKey = (
            await trx
              .objectStore('histories')
              .index('docId')
              .openKeyCursor(IDBKeyRange.only(update.docId), 'prev')
          )?.primaryKey;
          const latestTimestamp = latestKey?.[1];
          if (
            !latestTimestamp ||
            origin === 'rollback' ||
            timestamp.getTime() - latestTimestamp.getTime() >=
              LOCAL_HISTORY_INTERVAL_MS
          ) {
            const snapshot = await trx
              .objectStore('snapshots')
              .get(update.docId);
            const updates = await trx
              .objectStore('updates')
              .index('docId')
              .getAll(update.docId);
            const bin = mergeUpdates([
              ...(snapshot ? [snapshot.bin] : []),
              ...updates.map(item => item.bin),
            ]);
            const latest = latestKey
              ? await trx.objectStore('histories').get(latestKey)
              : undefined;
            if (!latest || !sameBytes(latest.bin, bin)) {
              await trx
                .objectStore('histories')
                .add({ ...update, bin, timestamp });
              const histories = await trx
                .objectStore('histories')
                .index('docId')
                .getAll(update.docId);
              let bytes = histories.reduce(
                (total, history) => total + history.bin.byteLength,
                0
              );
              while (
                histories.length > 2 &&
                (histories.length > LOCAL_HISTORY_LIMIT ||
                  bytes > LOCAL_HISTORY_MAX_BYTES)
              ) {
                const oldest = histories.shift();
                if (!oldest) break;
                bytes -= oldest.bin.byteLength;
                await trx
                  .objectStore('histories')
                  .delete([update.docId, oldest.timestamp]);
              }
            }
          }
        }

        await trx.objectStore('clocks').put({ docId: update.docId, timestamp });

        trx.commit();
        await trx.done;
      } catch (e) {
        // A synchronous merge/validation failure must not commit a partial write.
        try {
          trx.abort();
        } catch {
          /* Already committed or aborted. */
        }
        await trx.done.catch(() => {});
        if (e instanceof Error && e.name === 'ConstraintError') {
          retry++;
          if (retry < 10) {
            timestamp = new Date(timestamp.getTime() + 1);
            continue;
          }
        }
        throw e;
      }
      break;
    }

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

    this.channel.postMessage({
      type: 'update',
      update: {
        docId: update.docId,
        bin: update.bin,
        timestamp,
        editor: update.editor,
      },
      origin,
    } satisfies ChannelMessage);

    return { docId: update.docId, timestamp };
  }

  protected override async getDocSnapshot(docId: string) {
    const trx = this.db.transaction('snapshots', 'readonly');
    const record = await trx.store.get(docId);

    if (!record) {
      return null;
    }

    return {
      docId,
      bin: record.bin,
      timestamp: record.updatedAt,
    };
  }

  override async deleteDoc(docId: string) {
    const trx = this.db.transaction(
      ['snapshots', 'updates', 'clocks', 'histories'],
      'readwrite'
    );

    const idx = trx.objectStore('updates').index('docId');
    const iter = idx.iterate(IDBKeyRange.only(docId));

    for await (const { value } of iter) {
      await trx.objectStore('updates').delete([value.docId, value.createdAt]);
    }

    await trx.objectStore('snapshots').delete(docId);
    await trx.objectStore('clocks').delete(docId);
    const histories = await trx
      .objectStore('histories')
      .index('docId')
      .getAllKeys(docId);
    for (const key of histories) await trx.objectStore('histories').delete(key);
    await trx.done;
  }

  override async getDocTimestamps(after: Date = new Date(0)) {
    const trx = this.db.transaction('clocks', 'readonly');

    const clocks = await trx.store.getAll();

    return clocks.reduce((ret, cur) => {
      if (cur.timestamp > after) {
        ret[cur.docId] = cur.timestamp;
      }
      return ret;
    }, {} as DocClocks);
  }

  override async getDocTimestamp(docId: string): Promise<DocClock | null> {
    const trx = this.db.transaction('clocks', 'readonly');

    return (await trx.store.get(docId)) ?? null;
  }

  protected override async setDocSnapshot(
    snapshot: DocRecord
  ): Promise<boolean> {
    const trx = this.db.transaction('snapshots', 'readwrite');
    const record = await trx.store.get(snapshot.docId);

    if (!record || record.updatedAt < snapshot.timestamp) {
      await trx.store.put({
        docId: snapshot.docId,
        bin: snapshot.bin,
        createdAt: record?.createdAt ?? snapshot.timestamp,
        updatedAt: snapshot.timestamp,
      });
    }

    trx.commit();
    await trx.done;
    return true;
  }

  override async listHistories(docId: string, filter?: HistoryFilter) {
    const limit = Math.max(
      0,
      Math.min(filter?.limit ?? LOCAL_HISTORY_LIMIT, LOCAL_HISTORY_LIMIT)
    );
    const trx = this.db.transaction('histories', 'readonly');
    const histories: { timestamp: Date; userId: null }[] = [];
    let cursor = await trx.store
      .index('docId')
      .openKeyCursor(IDBKeyRange.only(docId), 'prev');
    // Listing and normal writes should not clone retained multi-megabyte snapshots.
    while (cursor && histories.length < limit) {
      const timestamp = cursor.primaryKey[1];
      if (!filter?.before || timestamp < filter.before)
        histories.push({ timestamp, userId: null });
      cursor = await cursor.continue();
    }
    await trx.done;
    return histories;
  }

  override async getHistory(
    docId: string,
    timestamp: Date
  ): Promise<DocRecord | null> {
    return (await this.db.get('histories', [docId, timestamp])) ?? null;
  }

  override async deleteHistory(docId: string, timestamp: Date) {
    await this.db.delete('histories', [docId, timestamp]);
  }

  override async getHistoryStorageUsage(): Promise<HistoryStorageUsage> {
    const trx = this.db.transaction(['histories', 'blobs'], 'readonly');
    const usage: HistoryStorageUsage = {
      versions: 0,
      historyBytes: 0,
      retainedRemovedBlobBytes: 0,
    };
    for await (const cursor of trx.objectStore('histories').iterate()) {
      usage.versions++;
      usage.historyBytes += cursor.value.bin.byteLength;
    }
    for await (const cursor of trx.objectStore('blobs').iterate()) {
      if (cursor.value.deletedAt)
        usage.retainedRemovedBlobBytes += cursor.value.size;
    }
    await trx.done;
    return usage;
  }

  protected override async clearHistoriesWithProtection(
    protection: HistoryCleanupProtection
  ): Promise<void> {
    // All history writers include this store in their readwrite transaction.
    // Serializing the clear with them prevents partially cleared recovery data.
    const trx = this.db.transaction(
      ['histories', 'blobs', 'blobData', 'clocks', 'snapshots', 'updates'],
      'readwrite'
    );
    void trx.done.catch(() => {});
    try {
      const clocks = await trx.objectStore('clocks').getAll();
      const expected = new Map(
        protection.expectedDocClocks.map(clock => [
          clock.docId,
          clock.timestamp.getTime(),
        ])
      );
      if (
        clocks.length !== expected.size ||
        clocks.some(
          clock => expected.get(clock.docId) !== clock.timestamp.getTime()
        )
      ) {
        throw new Error('The workspace changed. Retry clearing local history.');
      }
      // Legacy snapshots without clocks cannot be proven unreferenced.
      const snapshotKeys = await trx.objectStore('snapshots').getAllKeys();
      const updateKeys = await trx.objectStore('updates').getAllKeys();
      const preserveAll =
        protection.preserveAllRemovedBlobs ||
        snapshotKeys.some(id => !expected.has(id)) ||
        updateKeys.some(([id]) => !expected.has(id));
      if (preserveAll)
        throw new Error(
          'Local history was kept because some workspace content cannot be safely checked for file references.'
        );
      const referenced = new Set(protection.protectedBlobKeys);
      await trx.objectStore('histories').clear();
      for await (const cursor of trx.objectStore('blobs').iterate()) {
        if (cursor.value.deletedAt) {
          if (referenced.has(cursor.value.key)) {
            // Reactivate current references so they remain readable after all
            // histories disappear. Unknown content conservatively retains media.
            await cursor.update({ ...cursor.value, deletedAt: null });
          } else {
            await trx.objectStore('blobData').delete(cursor.value.key);
            await cursor.delete();
          }
        }
      }
      await trx.done;
    } catch (error) {
      try {
        trx.abort();
      } catch {
        /* Already aborted. */
      }
      await trx.done.catch(() => {});
      throw error;
    }
  }

  protected override async createHistory(docId: string, snapshot: DocRecord) {
    const trx = this.db.transaction('histories', 'readwrite');
    const histories = await trx.store.index('docId').getAll(docId);
    const latest = histories.at(-1);
    if (!latest || !sameBytes(latest.bin, snapshot.bin)) {
      // A checkpoint shares the durable doc clock, and never overwrites an existing version.
      if (!(await trx.store.get([docId, snapshot.timestamp]))) {
        await trx.store.add(snapshot);
        histories.push(snapshot);
      }
      histories.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      let bytes = histories.reduce(
        (total, history) => total + history.bin.byteLength,
        0
      );
      while (
        histories.length > 2 &&
        (histories.length > LOCAL_HISTORY_LIMIT ||
          bytes > LOCAL_HISTORY_MAX_BYTES)
      ) {
        const oldest = histories.shift();
        if (!oldest) break;
        bytes -= oldest.bin.byteLength;
        await trx.store.delete([docId, oldest.timestamp]);
      }
    }
    await trx.done;
  }

  protected override async getDocUpdates(docId: string): Promise<DocRecord[]> {
    const trx = this.db.transaction('updates', 'readonly');
    const updates = await trx.store.index('docId').getAll(docId);

    return updates.map(update => ({
      docId,
      bin: update.bin,
      timestamp: update.createdAt,
    }));
  }

  protected override async markUpdatesMerged(
    docId: string,
    updates: DocRecord[]
  ): Promise<number> {
    const trx = this.db.transaction('updates', 'readwrite');

    await Promise.all(
      updates.map(update => trx.store.delete([docId, update.timestamp]))
    );

    trx.commit();
    await trx.done;
    return updates.length;
  }

  private docUpdateListener = 0;

  override subscribeDocUpdate(
    callback: (update: DocRecord, origin?: string) => void
  ): () => void {
    if (this.docUpdateListener === 0) {
      this.channel.addEventListener('message', this.handleChannelMessage);
    }
    this.docUpdateListener++;

    const dispose = super.subscribeDocUpdate(callback);

    return () => {
      dispose();
      this.docUpdateListener--;
      if (this.docUpdateListener === 0) {
        this.channel.removeEventListener('message', this.handleChannelMessage);
      }
    };
  }

  handleChannelMessage = (event: MessageEvent<ChannelMessage>) => {
    if (event.data.type === 'update') {
      this.emit('update', event.data.update, event.data.origin);
    }
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
