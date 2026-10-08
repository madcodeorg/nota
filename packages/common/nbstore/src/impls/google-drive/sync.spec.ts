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
import { GoogleDriveBlobStorage } from './blob';
import { type DriveFile, GoogleDriveConnection } from './connection';
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

class FakeDrive {
  files = new Map<string, { file: DriveFile; content: Uint8Array }>();
  sequence = 0;
  loseNextUpload = false;
  requests: Array<{ url: string; method: string }> = [];
  fetch = async (urlValue: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(urlValue));
    const method = init?.method ?? 'GET';
    this.requests.push({ url: url.toString(), method });
    if (url.pathname.endsWith('/about'))
      return Response.json({ user: { permissionId: 'owner' } });
    if (url.pathname.endsWith('/generateIds'))
      return Response.json({ ids: [`file-${++this.sequence}`] });
    if (
      url.hostname === 'www.googleapis.com' &&
      url.pathname === '/drive/v3/files'
    ) {
      const q = url.searchParams.get('q') ?? '';
      const clauses = [...q.matchAll(/name (contains|=) '((?:\\.|[^'])*)'/g)];
      const files = [...this.files.values()]
        .map(record => record.file)
        .filter(file =>
          clauses.every(([, op, raw]) => {
            const name = raw.replace(/\\(.)/g, '$1');
            return op === '=' ? file.name === name : file.name.includes(name);
          })
        );
      const page = Number(url.searchParams.get('pageToken') ?? 0);
      return Response.json({
        files: files.slice(page, page + 2),
        nextPageToken: page + 2 < files.length ? String(page + 2) : undefined,
      });
    }
    if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      const body = new Uint8Array(await (init!.body as Blob).arrayBuffer());
      const text = new TextDecoder().decode(body);
      const headerEnd = text.indexOf('\r\n\r\n') + 4;
      const jsonEnd = text.indexOf('\r\n--', headerEnd);
      const metadata = JSON.parse(text.slice(headerEnd, jsonEnd)) as DriveFile;
      if (this.files.has(metadata.id))
        return new Response(null, { status: 409 });
      const dataStart = text.indexOf('\r\n\r\n', jsonEnd) + 4;
      const boundary = text.slice(0, text.indexOf('\r\n'));
      const tail = new TextEncoder().encode(`\r\n${boundary}--`);
      const content = body.slice(
        new TextEncoder().encode(text.slice(0, dataStart)).length,
        body.length - tail.length
      );
      const file = {
        ...metadata,
        modifiedTime: '2026-10-05T12:00:00.000Z',
        size: String(content.length),
      };
      this.files.set(file.id, { file, content });
      if (this.loseNextUpload) {
        this.loseNextUpload = false;
        throw new Error('Response lost after server accepted upload');
      }
      return Response.json(file);
    }
    const id = url.pathname.split('/').at(-1)!;
    const record = this.files.get(id);
    if (!record) return new Response(null, { status: 404 });
    return url.searchParams.get('alt') === 'media'
      ? new Response(record.content.slice().buffer)
      : Response.json(record.file);
  };
}

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
