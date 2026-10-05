import { share } from '../../connection';
import {
  type BlobRecord,
  BlobStorageBase,
  type ListedBlobRecord,
} from '../../storage';
import { IDBConnection, type IDBConnectionOptions } from './db';

export class IndexedDBBlobStorage extends BlobStorageBase {
  static readonly identifier = 'IndexedDBBlobStorage';
  override readonly isReadonly = false;

  readonly connection = share(new IDBConnection(this.options));

  constructor(private readonly options: IDBConnectionOptions) {
    super();
  }

  get db() {
    return this.connection.inner.db;
  }

  override async get(key: string) {
    const trx = this.db.transaction(
      ['blobs', 'blobData', 'histories'],
      'readonly'
    );
    const blob = await trx.objectStore('blobs').get(key);
    const data = await trx.objectStore('blobData').get(key);

    const historyRetainsMedia =
      blob?.deletedAt && (await trx.objectStore('histories').count()) > 0;
    if (!blob || (blob.deletedAt && !historyRetainsMedia) || !data) {
      return null;
    }

    return {
      ...blob,
      data: data.data,
    };
  }

  override async set(blob: BlobRecord) {
    const trx = this.db.transaction(['blobs', 'blobData'], 'readwrite');
    await Promise.all([
      trx.objectStore('blobs').put({
        key: blob.key,
        mime: blob.mime,
        size: blob.data.byteLength,
        createdAt: new Date(),
        deletedAt: null,
      }),
      trx.objectStore('blobData').put({
        key: blob.key,
        data: blob.data,
      }),
      trx.done,
    ]);
  }

  override async delete(key: string, permanently: boolean) {
    // Historical snapshots can reference detached media. Until per-version blob
    // references are indexed, conservatively pin media while local history exists.
    const check = this.db.transaction(
      ['blobs', 'blobData', 'histories'],
      'readwrite'
    );
    const retained = (await check.objectStore('histories').count()) > 0;
    if (permanently && !retained) {
      await check.objectStore('blobs').delete(key);
      await check.objectStore('blobData').delete(key);
    } else {
      const blob = await check.objectStore('blobs').get(key);
      if (blob) {
        await check.objectStore('blobs').put({
          ...blob,
          deletedAt: new Date(),
        });
      }
    }
    await check.done;
  }

  override async release() {
    const trx = this.db.transaction(
      ['blobs', 'blobData', 'histories'],
      'readwrite'
    );
    if (await trx.objectStore('histories').count()) {
      await trx.done;
      return;
    }

    const it = trx.objectStore('blobs').iterate();

    for await (const item of it) {
      if (item.value.deletedAt) {
        await item.delete();
        await trx.objectStore('blobData').delete(item.value.key);
      }
    }
  }

  override async list() {
    const trx = this.db.transaction('blobs', 'readonly');
    const it = trx.store.iterate();

    const blobs: ListedBlobRecord[] = [];
    for await (const item of it) {
      if (!item.value.deletedAt) {
        blobs.push(item.value);
      }
    }

    return blobs;
  }
}
