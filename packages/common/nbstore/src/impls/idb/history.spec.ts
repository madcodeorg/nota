import 'fake-indexeddb/auto';

import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  applyUpdate,
  Array as YArray,
  Doc,
  encodeStateAsUpdate,
  encodeStateVector,
  Map as YMap,
  Text as YText,
  XmlElement,
} from 'yjs';

import {
  collectCurrentContentStrings,
  LOCAL_HISTORY_INTERVAL_MS,
  LOCAL_HISTORY_LIMIT,
} from '../../storage/history';
import { IndexedDBBlobStorage } from './blob';
import { IndexedDBDocStorage } from './doc';

let storage: IndexedDBDocStorage;
let options: { flavour: string; id: string; type: 'workspace' };
const docId = 'offline-page';

beforeEach(async () => {
  options = { flavour: 'local', id: crypto.randomUUID(), type: 'workspace' };
  storage = new IndexedDBDocStorage(options);
  storage.connection.connect();
  await storage.connection.waitForConnected();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  storage.connection.disconnect();
});

async function save(doc: Doc, previous?: Uint8Array) {
  return storage.pushDocUpdate({
    docId,
    bin: encodeStateAsUpdate(doc, previous),
  });
}

function read(bin: Uint8Array) {
  const doc = new Doc({ gc: false });
  applyUpdate(doc, bin);
  return doc;
}

describe('offline immutable page history', () => {
  test('upgrades an existing pre-history database without changing its content', async () => {
    const previousOptions = { ...options, id: crypto.randomUUID() };
    const doc = new Doc();
    doc.getText('title').insert(0, 'Existing page');
    const old = await openDB(`local:workspace:${previousOptions.id}`, 3, {
      upgrade(db) {
        db.createObjectStore('snapshots', { keyPath: 'docId' });
        const updates = db.createObjectStore('updates', {
          keyPath: ['docId', 'createdAt'],
        });
        updates.createIndex('docId', 'docId');
        db.createObjectStore('clocks', { keyPath: 'docId' });
        db.createObjectStore('locks', { keyPath: 'key' });
      },
    });
    const timestamp = new Date();
    await old.put('snapshots', {
      docId,
      bin: encodeStateAsUpdate(doc),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await old.put('clocks', { docId, timestamp });
    old.close();
    const migrated = new IndexedDBDocStorage(previousOptions);
    migrated.connection.connect();
    await migrated.connection.waitForConnected();
    try {
      expect(
        read((await migrated.getDoc(docId))!.bin)
          .getText('title')
          .toString()
      ).toBe('Existing page');
      const previous = encodeStateVector(doc);
      doc.getText('title').insert(13, ' edited');
      const written = await migrated.pushDocUpdate({
        docId,
        bin: encodeStateAsUpdate(doc, previous),
      });
      expect(
        read((await migrated.getHistory(docId, written.timestamp))!.bin)
          .getText('title')
          .toString()
      ).toBe('Existing page edited');
    } finally {
      migrated.connection.disconnect();
      doc.destroy();
    }
  });

  test('captures successful changed writes without a read, bounds the interval, and persists after restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const doc = new Doc();
    doc.getText('title').insert(0, 'First');
    const first = await save(doc);
    const original = (await storage.getHistory(docId, first.timestamp))!;
    expect(read(original.bin).getText('title').toString()).toBe('First');
    doc.getText('title').insert(5, ' edit');
    await save(doc);
    expect(await storage.listHistories(docId)).toHaveLength(1);
    vi.setSystemTime(new Date(Date.now() + LOCAL_HISTORY_INTERVAL_MS + 1));
    await save(doc);
    expect(await storage.listHistories(docId)).toHaveLength(2);
    storage.connection.disconnect();
    storage = new IndexedDBDocStorage(options);
    storage.connection.connect();
    await storage.connection.waitForConnected();
    const histories = await storage.listHistories(docId);
    expect(histories).toHaveLength(2);
    expect(await storage.getHistory(docId, first.timestamp)).toEqual(original);
    expect(
      read((await storage.getHistory(docId, histories[0].timestamp))!.bin)
        .getText('title')
        .toString()
    ).toBe('First edit');
    doc.destroy();
  });

  test('restores text, maps, arrays, deleted nested blocks and later root types using a new update; preserves the previous version', async () => {
    const doc = new Doc({ gc: false });
    doc.getText('title').insert(0, 'Original');
    doc.getMap('settings').set('color', 'blue');
    doc.getArray('rows').push(['a', 'b']);
    const block = new YMap();
    const text = new YText('Recorded meeting');
    block.set('text', text);
    block.set('attachment', 'blob-1');
    doc.getMap('blocks').set('block-1', block);
    const original = await save(doc);
    const state = encodeStateVector(doc);
    doc.transact(() => {
      doc.getText('title').delete(0, 8);
      doc.getText('title').insert(0, 'New title');
      doc.getMap('settings').set('color', 'red');
      doc.getMap('settings').set('extra', true);
      doc.getArray('rows').delete(0, 1);
      doc.getArray('rows').push(['c']);
      doc.getMap('blocks').delete('block-1');
      doc.getMap('later-root').set('new', true);
    });
    await save(doc, state);
    const checkpoint = (await storage.createCheckpoint(docId))!;
    const onUpdate = vi.fn();
    const dispose = storage.subscribeDocUpdate(onUpdate);
    await storage.rollbackDoc(
      docId,
      original.timestamp,
      undefined,
      checkpoint.bin
    );
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate.mock.calls[0][1]).toBe('rollback');
    applyUpdate(doc, onUpdate.mock.calls[0][0].bin);
    const restored = read((await storage.getDoc(docId))!.bin);
    expect(restored.getText('title').toString()).toBe('Original');
    expect(restored.getMap('settings').toJSON()).toEqual({ color: 'blue' });
    expect(restored.getArray('rows').toArray()).toEqual(['a', 'b']);
    expect(restored.getMap('blocks').toJSON()).toEqual({
      'block-1': { text: 'Recorded meeting', attachment: 'blob-1' },
    });
    expect(restored.getMap('later-root').toJSON()).toEqual({});
    expect(doc.getText('title').toString()).toBe('Original');
    expect(
      read((await storage.getHistory(docId, checkpoint.timestamp))!.bin)
        .getText('title')
        .toString()
    ).toBe('New title');
    // Restoring the preserved checkpoint is itself reversible.
    await storage.rollbackDoc(docId, checkpoint.timestamp);
    expect(
      read((await storage.getDoc(docId))!.bin)
        .getText('title')
        .toString()
    ).toBe('New title');
    dispose();
    restored.destroy();
    doc.destroy();
  });

  test('rejects stale restore input and concurrent persisted writes without changing current content', async () => {
    const doc = new Doc();
    doc.getText('title').insert(0, 'Original');
    const original = await save(doc);
    const oldBin = encodeStateAsUpdate(doc);
    doc.getText('title').insert(8, ' modified');
    await save(doc);
    await expect(
      storage.rollbackDoc(docId, original.timestamp, undefined, oldBin)
    ).rejects.toThrow('page changed');
    const create = storage.createCheckpoint.bind(storage);
    const checkpoint = (await create(docId))!;
    vi.spyOn(storage, 'createCheckpoint').mockImplementationOnce(async id => {
      const point = await create(id);
      doc.getText('title').insert(doc.getText('title').length, ' concurrent');
      await save(doc);
      return point;
    });
    await expect(
      storage.rollbackDoc(docId, original.timestamp, undefined, checkpoint.bin)
    ).rejects.toThrow('page changed');
    expect(
      read((await storage.getDoc(docId))!.bin)
        .getText('title')
        .toString()
    ).toBe('Original modified concurrent');
    doc.destroy();
  });

  test('caps retention, supports list pagination/deletion, and clears versions with the document', async () => {
    const doc = new Doc();
    for (let i = 0; i < LOCAL_HISTORY_LIMIT + 5; i++) {
      doc.getMap('settings').set('iteration', i);
      await save(doc);
      await storage.createCheckpoint(docId);
    }
    const all = await storage.listHistories(docId);
    expect(all).toHaveLength(LOCAL_HISTORY_LIMIT);
    expect(
      await storage.listHistories(docId, { before: all[1].timestamp, limit: 2 })
    ).toEqual(all.slice(2, 4));
    await storage.deleteHistory(docId, all[0].timestamp);
    expect(await storage.getHistory(docId, all[0].timestamp)).toBeNull();
    await storage.deleteDoc(docId);
    expect(await storage.listHistories(docId)).toEqual([]);
    expect(await storage.getDoc(docId)).toBeNull();
    doc.destroy();
  });

  test('keeps media readable through deletion/GC while a historical version may reference it', async () => {
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    try {
      const data = new Uint8Array([1, 2, 3]);
      await blobs.set({ key: 'blob-1', mime: 'audio/wav', data });
      const doc = new Doc();
      doc.getMap('blocks').set('audio', { attachment: 'blob-1' });
      const original = await save(doc);
      await blobs.delete('blob-1', true);
      await blobs.release();
      expect((await blobs.get('blob-1'))?.data).toEqual(data);
      await storage.deleteHistory(docId, original.timestamp);
      await blobs.release();
      expect(await blobs.get('blob-1')).toBeNull();
      doc.destroy();
    } finally {
      blobs.connection.disconnect();
    }
  });

  test('reports usage and atomically clears every history and removed blob while preserving active content after restart', async () => {
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    const doc = new Doc();
    try {
      doc.getText('title').insert(0, 'Keep this page');
      await save(doc);
      await storage.createCheckpoint(docId);
      await storage.pushDocUpdate({
        docId: 'another-page',
        bin: encodeStateAsUpdate(doc),
      });
      const page = await storage.getDoc(docId);
      const anotherPage = await storage.getDoc('another-page');
      const clocks = await storage.getDocTimestamps();
      await blobs.set({
        key: 'active',
        mime: 'image/png',
        data: new Uint8Array([1, 2]),
      });
      await blobs.set({
        key: 'removed',
        mime: 'audio/wav',
        data: new Uint8Array([3, 4, 5]),
      });
      await blobs.delete('removed', true);
      const versions = await storage.db.getAll('histories');
      expect(await storage.getHistoryStorageUsage()).toEqual({
        versions: versions.length,
        historyBytes: versions.reduce(
          (sum, version) => sum + version.bin.byteLength,
          0
        ),
        retainedRemovedBlobBytes: 3,
      });
      expect(versions.length).toBeGreaterThanOrEqual(2);

      await storage.clearHistories();
      expect(await storage.getHistoryStorageUsage()).toEqual({
        versions: 0,
        historyBytes: 0,
        retainedRemovedBlobBytes: 0,
      });
      expect((await blobs.get('active'))?.data).toEqual(new Uint8Array([1, 2]));
      expect(await blobs.db.get('blobs', 'removed')).toBeUndefined();
      expect(await blobs.db.get('blobData', 'removed')).toBeUndefined();
      expect(await storage.getDoc(docId)).toEqual(page);
      expect(await storage.getDoc('another-page')).toMatchObject({
        docId: 'another-page',
        bin: anotherPage!.bin,
        timestamp: anotherPage!.timestamp,
      });
      expect(await storage.getDocTimestamps()).toEqual(clocks);

      blobs.connection.disconnect();
      storage.connection.disconnect();
      storage = new IndexedDBDocStorage(options);
      storage.connection.connect();
      await storage.connection.waitForConnected();
      expect(await storage.listHistories(docId)).toEqual([]);
      expect(await storage.listHistories('another-page')).toEqual([]);
      expect(await storage.db.get('blobData', 'active')).toEqual({
        key: 'active',
        data: new Uint8Array([1, 2]),
      });
      expect(await storage.db.get('blobData', 'removed')).toBeUndefined();
      expect(await storage.getDoc(docId)).toEqual(page);
    } finally {
      blobs.connection.disconnect();
      doc.destroy();
    }
  });

  test('rolls back the history clear when removing blob data fails', async () => {
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    const doc = new Doc();
    try {
      doc.getText('title').insert(0, 'Keep recovery');
      const first = await save(doc);
      await blobs.set({
        key: 'removed',
        mime: 'audio/wav',
        data: new Uint8Array([1, 2, 3]),
      });
      await blobs.delete('removed', true);
      const usage = await storage.getHistoryStorageUsage();
      const originalDelete = IDBObjectStore.prototype.delete;
      const failure = vi
        .spyOn(IDBObjectStore.prototype, 'delete')
        .mockImplementation(function (this: IDBObjectStore, key) {
          if (this.name === 'blobData')
            throw new Error('Injected blob deletion failure');
          return originalDelete.call(this, key);
        });
      await expect(storage.clearHistories()).rejects.toThrow(
        'Injected blob deletion failure'
      );
      failure.mockRestore();
      expect(await storage.getHistoryStorageUsage()).toEqual(usage);
      expect(await storage.getHistory(docId, first.timestamp)).not.toBeNull();
      expect((await blobs.get('removed'))?.data).toEqual(
        new Uint8Array([1, 2, 3])
      );
    } finally {
      blobs.connection.disconnect();
      doc.destroy();
    }
  });

  test('serializes clearing with concurrent updates and blob resurrection without losing canonical content', async () => {
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    const doc = new Doc();
    try {
      doc.getText('title').insert(0, 'Original');
      await save(doc);
      await blobs.set({
        key: 'removed',
        mime: 'text/plain',
        data: new Uint8Array([1]),
      });
      await blobs.delete('removed', true);
      const previous = encodeStateVector(doc);
      doc.getText('title').insert(8, ' edited');
      const getClocks = storage.getDocTimestamps.bind(storage);
      vi.spyOn(storage, 'getDocTimestamps').mockImplementationOnce(async () => {
        const clocks = await getClocks();
        await save(doc, previous);
        await blobs.set({
          key: 'removed',
          mime: 'text/plain',
          data: new Uint8Array([2, 3]),
        });
        return clocks;
      });
      await expect(storage.clearHistories()).rejects.toThrow(
        'workspace changed'
      );
      expect(
        read((await storage.getDoc(docId))!.bin)
          .getText('title')
          .toString()
      ).toBe('Original edited');
      expect(await storage.listHistories(docId)).toHaveLength(1);
      expect((await blobs.get('removed'))?.data).toEqual(
        new Uint8Array([2, 3])
      );
      expect(
        (await storage.getHistoryStorageUsage()).retainedRemovedBlobBytes
      ).toBe(0);

      await storage.clearHistories();
      expect(await storage.listHistories(docId)).toEqual([]);
      expect(
        read((await storage.getDoc(docId))!.bin)
          .getText('title')
          .toString()
      ).toBe('Original edited');
      expect((await blobs.get('removed'))?.data).toEqual(
        new Uint8Array([2, 3])
      );
    } finally {
      blobs.connection.disconnect();
      doc.destroy();
    }
  });

  test('delete, restore, clear and restart preserve assets in page blocks, database cells, canvas elements, text embeds and map keys', async () => {
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    const doc = new Doc({ gc: false });
    const assets = [
      'image',
      'database-file',
      'canvas-file',
      'text-file',
      'key-file',
    ];
    try {
      const block = new YMap();
      block.set('prop:sourceId', 'image');
      const cells = new YArray();
      cells.push([{ attachments: [{ id: 'database-file' }] }]);
      block.set('prop:cells', cells);
      const text = new YText();
      block.set('prop:text', text);
      text.insertEmbed(0, { attachment: { id: 'text-file' } });
      doc.getMap('blocks').set('block', block);
      doc
        .getMap('surface')
        .set('elements', { element: { sourceId: 'canvas-file' } });
      doc.getMap('meta').set('key-file', true);
      const first = await save(doc);
      for (const key of [...assets, 'unrelated-removed']) {
        await blobs.set({
          key,
          mime: 'image/png',
          data: new Uint8Array([1, 2]),
        });
      }
      const previous = encodeStateVector(doc);
      doc.getMap('blocks').delete('block');
      doc.getMap('surface').delete('elements');
      doc.getMap('meta').delete('key-file');
      await save(doc, previous);
      for (const key of [...assets, 'unrelated-removed'])
        await blobs.delete(key, true);
      await storage.rollbackDoc(docId, first.timestamp);
      const restored = (await storage.getDoc(docId))!;
      const refs = collectCurrentContentStrings(restored.bin);
      expect(refs.preserveAll).toBe(false);
      for (const key of assets) expect(refs.strings.has(key)).toBe(true);
      await storage.clearHistories();
      expect(await storage.listHistories(docId)).toEqual([]);
      for (const key of assets) {
        expect((await blobs.get(key))?.data).toEqual(new Uint8Array([1, 2]));
        expect((await blobs.db.get('blobs', key))?.deletedAt).toBeNull();
      }
      expect(
        await blobs.db.get('blobData', 'unrelated-removed')
      ).toBeUndefined();
      blobs.connection.disconnect();
      storage.connection.disconnect();
      storage = new IndexedDBDocStorage(options);
      storage.connection.connect();
      await storage.connection.waitForConnected();
      const restartedBlobs = new IndexedDBBlobStorage(options);
      restartedBlobs.connection.connect();
      await restartedBlobs.connection.waitForConnected();
      try {
        expect(await storage.listHistories(docId)).toEqual([]);
        for (const key of assets)
          expect(await restartedBlobs.get(key)).not.toBeNull();
        expect(await restartedBlobs.get('unrelated-removed')).toBeNull();
        expect((await storage.getDoc(docId))!.bin).toEqual(restored.bin);
      } finally {
        restartedBlobs.connection.disconnect();
      }
    } finally {
      blobs.connection.disconnect();
      doc.destroy();
    }
  });

  test('refuses opaque content and clockless legacy snapshots without losing recovery data or media', async () => {
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    const doc = new Doc();
    try {
      doc.getMap('blocks').set('opaque', new Uint8Array([1, 2, 3]));
      await save(doc);
      await blobs.set({
        key: 'removed',
        mime: 'image/png',
        data: new Uint8Array([4]),
      });
      await blobs.delete('removed', true);
      const usage = await storage.getHistoryStorageUsage();
      await expect(storage.clearHistories()).rejects.toThrow(
        'cannot be safely checked'
      );
      expect(await storage.getHistoryStorageUsage()).toEqual(usage);
      expect(await blobs.get('removed')).not.toBeNull();
      doc.getMap('blocks').delete('opaque');
      await save(doc);
      await storage.db.put('snapshots', {
        docId: 'legacy-page',
        bin: encodeStateAsUpdate(doc),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const before = await storage.getHistoryStorageUsage();
      await expect(storage.clearHistories()).rejects.toThrow(
        'cannot be safely checked'
      );
      expect(await storage.getHistoryStorageUsage()).toEqual(before);
      expect(await blobs.get('removed')).not.toBeNull();
    } finally {
      blobs.connection.disconnect();
      doc.destroy();
    }
  });

  test('scans text and array roots and refuses unsupported XML or pending updates conservatively', () => {
    const doc = new Doc();
    doc.getText('title').insert(0, 'text-root-asset');
    doc.getArray('rows').push([{ files: ['array-root-asset'] }]);
    const refs = collectCurrentContentStrings(encodeStateAsUpdate(doc));
    expect(refs.preserveAll).toBe(false);
    expect(refs.strings.has('text-root-asset')).toBe(true);
    expect(refs.strings.has('array-root-asset')).toBe(true);
    doc.getText('title').format(0, 1, { attachment: 'format-asset' });
    expect(
      collectCurrentContentStrings(encodeStateAsUpdate(doc)).preserveAll
    ).toBe(true);
    doc.getMap('xml').set('value', new XmlElement('attachment'));
    expect(
      collectCurrentContentStrings(encodeStateAsUpdate(doc)).preserveAll
    ).toBe(true);
    const before = encodeStateVector(doc);
    doc.getMap('xml').set('later', 'pending-asset');
    expect(
      collectCurrentContentStrings(encodeStateAsUpdate(doc, before)).preserveAll
    ).toBe(true);
    doc.destroy();
  });

  test('permits the real workspace spaces/subdoc shape only when every referenced page is canonical and scanned', async () => {
    const root = new Doc();
    const page = new Doc();
    const blobs = new IndexedDBBlobStorage(options);
    blobs.connection.connect();
    await blobs.connection.waitForConnected();
    try {
      page.getMap('blocks').set('image', { sourceId: 'page-media' });
      root.getMap('spaces').set(docId, new Doc({ guid: docId }));
      root.getMap('meta').set('pages', [{ id: docId }]);
      await save(page);
      await storage.pushDocUpdate({
        docId: options.id,
        bin: encodeStateAsUpdate(root),
      });
      await blobs.set({
        key: 'page-media',
        mime: 'image/png',
        data: new Uint8Array([1, 2]),
      });
      await blobs.delete('page-media', true);
      await storage.clearHistories();
      expect(await storage.listHistories(docId)).toEqual([]);
      expect(await storage.listHistories(options.id)).toEqual([]);
      expect(await blobs.get('page-media')).not.toBeNull();
      root
        .getMap('spaces')
        .set('unavailable-page', new Doc({ guid: 'unavailable-page' }));
      await storage.pushDocUpdate({
        docId: options.id,
        bin: encodeStateAsUpdate(root),
      });
      const usage = await storage.getHistoryStorageUsage();
      await expect(storage.clearHistories()).rejects.toThrow(
        'cannot be safely checked'
      );
      expect(await storage.getHistoryStorageUsage()).toEqual(usage);
      expect(await blobs.get('page-media')).not.toBeNull();
    } finally {
      blobs.connection.disconnect();
      root.destroy();
      page.destroy();
    }
  });

  test('refuses to clear a read-only storage connection', async () => {
    const doc = new Doc();
    doc.getText('title').insert(0, 'Keep');
    await save(doc);
    vi.spyOn(storage, 'isReadonly', 'get').mockReturnValue(true);
    await expect(storage.clearHistories()).rejects.toThrow('read-only');
    expect(await storage.listHistories(docId)).toHaveLength(1);
    doc.destroy();
  });
});
