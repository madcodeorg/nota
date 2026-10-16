import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyUpdate, Doc, encodeStateAsUpdate, encodeStateVector } from 'yjs';

import { FakeDrive } from './__tests__/fake-drive';
import { GoogleDriveConnection } from './connection';
import { fileClock, GoogleDriveDocStorage } from './doc';

const tokens = {
  accessToken: 'owner-access',
  accountId: 'owner',
  expiresAt: Date.now() + 3600000,
};
const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function storage(
  workspaceId: string,
  options: Partial<ConstructorParameters<typeof GoogleDriveDocStorage>[0]> = {}
) {
  const connection = new GoogleDriveConnection({ accountId: 'owner', tokens });
  connection.connect();
  stops.push(() => connection.disconnect(true));
  await connection.waitForConnected();
  const doc = new GoogleDriveDocStorage({
    id: workspaceId,
    accountId: 'owner',
    tokens,
    pushIntervalMs: 0,
    ...options,
  });
  Object.defineProperty(doc, 'connection', { value: connection });
  return doc;
}

/** Apply one edit and return only that edit, like a live editor update. */
function edit(doc: Doc, key: string) {
  const before = encodeStateVector(doc);
  doc.getMap('props').set(key, true);
  return encodeStateAsUpdate(doc, before);
}

function props(bin: Uint8Array) {
  const doc = new Doc();
  applyUpdate(doc, bin);
  const value = doc.getMap('props').toJSON();
  doc.destroy();
  return value;
}

/** Let the 1-second index throttle expire so the next read asks Drive again. */
async function nextRefresh() {
  await new Promise(resolve => setTimeout(resolve, 1050));
}

describe('Drive page storage', () => {
  test('the page clock advances for late-listed older files and survives compaction', () => {
    const at = (second: number, weight?: number) => ({
      id: String(second),
      name: 'file',
      modifiedTime: new Date(Date.UTC(2026, 9, 5, 12, 0, second)).toISOString(),
      properties: weight ? { weight: String(weight) } : undefined,
    });
    const before = fileClock([at(2)]).getTime();
    expect(fileClock([at(1), at(2)]).getTime()).toBeGreaterThan(before);
    expect(fileClock([at(5, 3)]).getTime()).toBeGreaterThan(
      fileClock([at(1), at(2), at(3)]).getTime()
    );
  });

  test('downloads only files this device has not read yet', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const id = crypto.randomUUID();
    const writer = await storage(id);
    const reader = await storage(id);
    const page = new Doc();
    for (const key of ['a', 'b', 'c'])
      await writer.pushDocUpdate({ docId: 'page', bin: edit(page, key) });
    expect(props((await reader.getDoc('page'))!.bin)).toEqual({
      a: true,
      b: true,
      c: true,
    });
    expect(drive.downloads()).toBe(3);
    await writer.pushDocUpdate({ docId: 'page', bin: edit(page, 'd') });
    await nextRefresh();
    expect(props((await reader.getDoc('page'))!.bin)).toMatchObject({
      d: true,
    });
    expect(drive.downloads()).toBe(4);
    await nextRefresh();
    await reader.getDoc('page');
    expect(drive.downloads()).toBe(4);
  });

  test('an idle refresh asks the changes feed instead of listing every file', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const id = crypto.randomUUID();
    const writer = await storage(id);
    const reader = await storage(id);
    const page = new Doc();
    await writer.pushDocUpdate({ docId: 'page', bin: edit(page, 'a') });
    expect(Object.keys(await reader.getDocTimestamps())).toEqual(['page']);
    drive.requests = [];
    await nextRefresh();
    await reader.getDocTimestamps();
    expect(
      drive.requests.map(request => new URL(request.url).pathname)
    ).toEqual(['/drive/v3/changes']);
    await writer.pushDocUpdate({ docId: 'other', bin: edit(new Doc(), 'b') });
    await nextRefresh();
    expect(Object.keys(await reader.getDocTimestamps()).sort()).toEqual([
      'other',
      'page',
    ]);
  });

  test('falls back to full listing when the changes feed is unavailable', async () => {
    const drive = new FakeDrive();
    drive.supportsChanges = false;
    vi.stubGlobal('fetch', drive.fetch);
    const id = crypto.randomUUID();
    const writer = await storage(id);
    const reader = await storage(id);
    await writer.pushDocUpdate({ docId: 'page', bin: edit(new Doc(), 'a') });
    expect(Object.keys(await reader.getDocTimestamps())).toEqual(['page']);
    await writer.pushDocUpdate({ docId: 'next', bin: edit(new Doc(), 'b') });
    await nextRefresh();
    expect(Object.keys(await reader.getDocTimestamps()).sort()).toEqual([
      'next',
      'page',
    ]);
  });

  test('spaces uploads of the same page so queued edits can be merged', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const writer = await storage(crypto.randomUUID(), { pushIntervalMs: 300 });
    const page = new Doc();
    const started = Date.now();
    await writer.pushDocUpdate({ docId: 'page', bin: edit(page, 'a') });
    await writer.pushDocUpdate({ docId: 'other', bin: edit(new Doc(), 'x') });
    expect(Date.now() - started).toBeLessThan(250);
    await writer.pushDocUpdate({ docId: 'page', bin: edit(page, 'b') });
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
  });

  test('compaction replaces covered files with one verified snapshot and keeps newer files', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const id = crypto.randomUUID();
    const options = { compactThreshold: 3, compactMinAgeMs: 0 };
    const compactor = await storage(id, options);
    const stale = await storage(id, { compactThreshold: 1000 });
    const page = new Doc();
    for (const key of ['a', 'b', 'c', 'd'])
      await compactor.pushDocUpdate({ docId: 'page', bin: edit(page, key) });
    // The stale device lists the four update files before compaction removes them.
    await stale.getDocTimestamps();
    await compactor.compactDoc('page');
    const names = [...drive.files.values()].map(record => record.file.name);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('_snapshot_sha256_');
    expect(drive.requests.filter(r => r.method === 'DELETE')).toHaveLength(4);

    await compactor.pushDocUpdate({ docId: 'page', bin: edit(page, 'e') });
    expect(props((await stale.getDoc('page'))!.bin)).toEqual({
      a: true,
      b: true,
      c: true,
      d: true,
      e: true,
    });
    const clockBefore = (await compactor.getDocTimestamp('page'))!.timestamp;
    await compactor.compactDoc('page');
    expect(drive.files.size).toBe(1);
    await nextRefresh();
    expect(
      (await stale.getDocTimestamp('page'))!.timestamp.getTime()
    ).toBeGreaterThanOrEqual(clockBefore.getTime());
    expect(props((await stale.getDoc('page'))!.bin)).toMatchObject({ e: true });
  });

  test('two devices compacting the same page keep all content', async () => {
    const drive = new FakeDrive();
    vi.stubGlobal('fetch', drive.fetch);
    const id = crypto.randomUUID();
    const options = { compactThreshold: 2, compactMinAgeMs: 0 };
    const a = await storage(id, options);
    const b = await storage(id, options);
    const docA = new Doc();
    const docB = new Doc();
    await a.pushDocUpdate({ docId: 'page', bin: edit(docA, 'a1') });
    await b.pushDocUpdate({ docId: 'page', bin: edit(docB, 'b1') });
    await a.pushDocUpdate({ docId: 'page', bin: edit(docA, 'a2') });
    await b.pushDocUpdate({ docId: 'page', bin: edit(docB, 'b2') });
    await nextRefresh();
    await Promise.all([a.compactDoc('page'), b.compactDoc('page')]);
    const fresh = await storage(id, { compactThreshold: 1000 });
    expect(props((await fresh.getDoc('page'))!.bin)).toEqual({
      a1: true,
      a2: true,
      b1: true,
      b2: true,
    });
  });
});
