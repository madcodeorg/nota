import 'fake-indexeddb/auto';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';

import { SpaceStorage } from '../../storage';
import { Sync } from '../../sync';
import {
  IndexedDBBlobStorage,
  IndexedDBBlobSyncStorage,
  IndexedDBDocStorage,
  IndexedDBDocSyncStorage,
} from '../idb';
import { FakeDrive } from './__tests__/fake-drive';
import { GoogleDriveBlobStorage } from './blob';
import { GoogleDriveConnection } from './connection';
import { GoogleDriveDocStorage } from './doc';

const tokens = {
  accessToken: 'owner-access',
  accountId: 'owner',
  expiresAt: Date.now() + 3600000,
};
const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  vi.unstubAllGlobals();
});

async function remote(workspaceId: string) {
  const connection = new GoogleDriveConnection({ accountId: 'owner', tokens });
  connection.connect();
  stops.push(() => connection.disconnect(true));
  await connection.waitForConnected();
  const doc = new GoogleDriveDocStorage({
    id: workspaceId,
    accountId: 'owner',
    tokens,
    pollingIntervalMs: 30,
    pushIntervalMs: 0,
  });
  const blob = new GoogleDriveBlobStorage({
    id: workspaceId,
    accountId: 'owner',
    tokens,
  });
  // Each simulated device has its own process/credential lifecycle.
  Object.defineProperty(doc, 'connection', { value: connection });
  Object.defineProperty(blob, 'connection', { value: connection });
  return new SpaceStorage({ doc, blob });
}

async function device(id: string, flavour: string) {
  const options = { id, flavour, type: 'workspace' as const };
  const local = new SpaceStorage({
    doc: new IndexedDBDocStorage(options),
    docSync: new IndexedDBDocSyncStorage(options),
    blob: new IndexedDBBlobStorage(options),
    blobSync: new IndexedDBBlobSyncStorage(options),
  });
  local.connect();
  await local.waitForConnected();
  stops.push(() => local.disconnect());
  return local;
}

function content(bin: Uint8Array) {
  const doc = new Doc();
  applyUpdate(doc, bin);
  const values = {
    text: doc.getText('text').toString(),
    props: doc.getMap('props').toJSON(),
  };
  doc.destroy();
  return values;
}

describe('user-owned Drive convergence', () => {
  test('two independent durable stores edit offline, reconnect and converge with deleted text and media', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const id = crypto.randomUUID();
    const a = await device(id, 'device-a');
    const b = await device(id, 'device-b');
    const initial = new Doc();
    initial.getText('text').insert(0, 'Delete me');
    const initialBin = encodeStateAsUpdate(initial);
    const docA = new Doc();
    applyUpdate(docA, initialBin);
    const docB = new Doc();
    applyUpdate(docB, initialBin);
    docA.getText('text').delete(0, 9);
    docA.getMap('props').set('offline-A', true);
    docB.getMap('props').set('offline-B', true);
    docB.getMap('props').set('sourceId', 'image');
    await a
      .get('doc')
      .pushDocUpdate({ docId: 'page', bin: encodeStateAsUpdate(docA) });
    await b
      .get('doc')
      .pushDocUpdate({ docId: 'page', bin: encodeStateAsUpdate(docB) });
    await b.get('blob').set({
      key: 'image',
      data: new Uint8Array([1, 2, 3, 255]),
      mime: 'image/png',
    });
    const remoteA = await remote(id);
    const remoteB = await remote(id);
    const syncA = new Sync({ local: a, remotes: { drive: remoteA } });
    const syncB = new Sync({ local: b, remotes: { drive: remoteB } });
    syncA.start();
    syncB.start();
    stops.push(() => {
      syncA.stop();
      syncB.stop();
    });
    await vi.waitFor(
      async () => {
        const valueA = await a.get('doc').getDoc('page');
        const valueB = await b.get('doc').getDoc('page');
        expect(content(valueA!.bin)).toEqual({
          text: '',
          props: { 'offline-A': true, 'offline-B': true, sourceId: 'image' },
        });
        expect(content(valueB!.bin)).toEqual(content(valueA!.bin));
      },
      { timeout: 15000 }
    );
    await vi.waitFor(
      async () => expect(await remoteA.get('blob').get('image')).not.toBeNull(),
      { timeout: 15000 }
    );
    await syncA.blob.downloadBlob('image');
    expect((await a.get('blob').get('image'))?.data).toEqual(
      new Uint8Array([1, 2, 3, 255])
    );
    expect(
      drive.requests.filter(
        request => request.method === 'DELETE' || request.method === 'PATCH'
      )
    ).toEqual([]);
    // Logout does not affect durable local writes or media after reopening storage.
    remoteA.get('doc').connection.disconnect();
    syncA.stop();
    docA.getMap('props').set('after-logout', true);
    await a
      .get('doc')
      .pushDocUpdate({ docId: 'page', bin: encodeStateAsUpdate(docA) });
    a.disconnect();
    const reopened = await device(id, 'device-a');
    expect(
      content((await reopened.get('doc').getDoc('page'))!.bin).props[
        'after-logout'
      ]
    ).toBe(true);
    expect((await reopened.get('blob').get('image'))?.data).toEqual(
      new Uint8Array([1, 2, 3, 255])
    );
  }, 30000);

  test('lost upload response retries by immutable hash and discovers update-only pages across pagination', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const storage = (await remote(crypto.randomUUID())).get('doc');
    const doc = new Doc();
    doc.getText('text').insert(0, 'Page');
    const update = { docId: 'page', bin: encodeStateAsUpdate(doc) };
    drive.loseNextUpload = true;
    await expect(storage.pushDocUpdate(update)).rejects.toThrow(
      'Response lost'
    );
    await storage.pushDocUpdate(update);
    await storage.pushDocUpdate(update);
    expect(drive.files.size).toBe(1);
    for (let i = 0; i < 5; i++)
      await storage.pushDocUpdate({ ...update, docId: `page-${i}` });
    expect(Object.keys(await storage.getDocTimestamps())).toHaveLength(6);
    expect(content((await storage.getDoc('page'))!.bin).text).toBe('Page');
    expect(drive.files.size).toBe(6);
    expect(
      drive.requests.filter(
        request => request.method === 'DELETE' || request.method === 'PATCH'
      )
    ).toEqual([]);
  });
});
