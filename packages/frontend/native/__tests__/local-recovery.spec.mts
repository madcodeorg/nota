import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import test from 'ava';
import { applyUpdate, Doc, encodeStateAsUpdate, Map as YMap } from 'yjs';

import { collectCurrentContentStrings } from '../../../common/nbstore/src/storage/history-assets.ts';
import { DocStorage, DocStoragePool } from '../index.js';

test('native WAL backup reopens under a new workspace identity with content, history and media', async t => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'nota-native-recovery-')
  );
  const source = path.join(directory, 'source.db');
  const backup = path.join(directory, 'backup.nota');
  const restored = path.join(directory, 'restored.db');
  const pool = new DocStoragePool();
  const sourceId = 'source-workspace';
  const targetId = 'restored-workspace';
  t.teardown(async () => {
    await pool.disconnect(sourceId);
    await pool.disconnect(targetId);
    await rm(directory, { recursive: true, force: true });
  });
  await pool.connect(sourceId, source);
  await pool.setSpaceId(sourceId, sourceId);

  const root = new Doc();
  root.getMap('meta').set('name', 'Recovery fixture');
  root.getMap('meta').set('pages', [{ id: 'page', title: 'A linked note' }]);
  await pool.setDocSnapshot(sourceId, {
    docId: sourceId,
    bin: encodeStateAsUpdate(root),
    timestamp: new Date(),
  });
  const page = new Doc();
  page.getText('text').insert(0, 'Before editing');
  const row = new YMap();
  row.set('title', 'Task');
  row.set('done', true);
  row.set('amount', 42);
  row.set('pageLink', 'linked-page');
  row.set('attachment', 'recording');
  page.getArray('rows').push([row]);
  const before = encodeStateAsUpdate(page);
  const historyTime = new Date(Date.now() - 1000);
  await pool.setDocSnapshot(sourceId, {
    docId: 'page',
    bin: before,
    timestamp: historyTime,
  });
  await pool.createDocHistory(sourceId, {
    docId: 'page',
    bin: before,
    timestamp: historyTime,
  });
  page
    .getText('text')
    .insert(page.getText('text').length, ' and after editing');
  const updatedAt = await pool.pushUpdate(
    sourceId,
    'page',
    encodeStateAsUpdate(page)
  );
  t.true(updatedAt instanceof Date);
  t.true(Number.isFinite(updatedAt.getTime()));
  const media = new Uint8Array(128 * 1024).fill(73);
  await pool.setBlob(sourceId, {
    key: 'recording',
    data: media,
    mime: 'audio/wav',
  });

  await pool.backup(sourceId, backup);
  t.true(await new DocStorage(backup).validate());
  await pool.disconnect(sourceId);
  await copyFile(backup, restored);
  await new DocStorage(restored).setSpaceId(targetId);
  await pool.connect(targetId, restored);

  const rootRecord = await pool.getDocSnapshot(targetId, targetId);
  t.truthy(rootRecord);
  const recoveredRoot = new Doc();
  applyUpdate(recoveredRoot, rootRecord!.bin);
  t.is(recoveredRoot.getMap('meta').get('name'), 'Recovery fixture');
  t.is(await pool.getDocSnapshot(targetId, sourceId), null);

  const recoveredPage = new Doc();
  const snapshot = await pool.getDocSnapshot(targetId, 'page');
  t.truthy(snapshot);
  applyUpdate(recoveredPage, snapshot!.bin);
  for (const update of await pool.getDocUpdates(targetId, 'page'))
    applyUpdate(recoveredPage, update.bin);
  t.is(
    recoveredPage.getText('text').toString(),
    'Before editing and after editing'
  );
  t.deepEqual(recoveredPage.getArray('rows').toJSON(), [
    {
      title: 'Task',
      done: true,
      amount: 42,
      pageLink: 'linked-page',
      attachment: 'recording',
    },
  ]);
  const restoredMedia = await pool.getBlob(targetId, 'recording');
  t.deepEqual(restoredMedia?.data, media);
  t.is(restoredMedia?.mime, 'audio/wav');
  const histories = await pool.listDocHistories(targetId, 'page', null, 50);
  t.true(
    histories.some(
      history => history.timestamp.getTime() === historyTime.getTime()
    )
  );
  const history = await pool.getDocHistory(targetId, 'page', historyTime);
  t.truthy(history);
  const previous = new Doc();
  for (const bin of history!.bins) applyUpdate(previous, bin);
  t.is(previous.getText('text').toString(), 'Before editing');
  t.deepEqual(
    previous.getArray('rows').toJSON(),
    recoveredPage.getArray('rows').toJSON()
  );
});

test('native backup rejects the active source and preserves the last output on path failure', async t => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'nota-native-backup-')
  );
  const source = path.join(directory, 'source.db');
  const backup = path.join(directory, 'last-good.nota');
  const pool = new DocStoragePool();
  t.teardown(async () => {
    await pool.disconnect('workspace');
    await rm(directory, { recursive: true, force: true });
  });
  await pool.connect('workspace', source);
  await pool.backup('workspace', backup);
  const previous = await readFile(backup);
  await t.throwsAsync(pool.backup('workspace', source), {
    message: /active workspace database/,
  });
  await t.throwsAsync(
    pool.backup('workspace', path.join(directory, 'missing', 'backup.nota'))
  );
  t.deepEqual(await readFile(backup), previous);
  t.true(await new DocStorage(backup).validate());
});

test('native history cleanup exposes numeric usage and preserves current content and active media after restart', async t => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'nota-native-history-cleanup-')
  );
  const database = path.join(directory, 'workspace.db');
  const workspaceId = 'cleanup-workspace';
  const pool = new DocStoragePool();
  const page = new Doc();
  t.teardown(async () => {
    page.destroy();
    await pool.disconnect(workspaceId);
    await rm(directory, { recursive: true, force: true });
  });
  await pool.connect(workspaceId, database);
  await pool.setSpaceId(workspaceId, workspaceId);
  page.getText('text').insert(0, 'Preserve this page');
  const bin = encodeStateAsUpdate(page);
  const timestamp = await pool.pushUpdate(workspaceId, 'page', bin);
  await pool.setDocSnapshot(workspaceId, { docId: 'page', bin, timestamp });
  await pool.pushUpdate(workspaceId, 'another-page', bin);
  const snapshot = await pool.getDocSnapshot(workspaceId, 'page');
  const updates = await pool.getDocUpdates(workspaceId, 'page');
  const clocks = await pool.getDocClocks(workspaceId);
  const active = new Uint8Array([1, 2]);
  const removed = new Uint8Array([3, 4, 5]);
  await pool.setBlob(workspaceId, {
    key: 'active',
    data: active,
    mime: 'image/png',
  });
  await pool.setBlob(workspaceId, {
    key: 'removed',
    data: removed,
    mime: 'audio/wav',
  });
  await pool.deleteBlob(workspaceId, 'removed', true);
  t.deepEqual((await pool.getBlob(workspaceId, 'removed'))?.data, removed);
  const usage = await pool.getDocHistoryStorageUsage(workspaceId);
  for (const field of [
    'versions',
    'historyBytes',
    'retainedRemovedBlobBytes',
  ] as const) {
    t.is(typeof usage[field], 'number');
    t.true(Number.isFinite(usage[field]));
  }
  t.is(usage.versions, 2);
  t.true(usage.historyBytes > 0);
  t.is(usage.retainedRemovedBlobBytes, removed.byteLength);

  const protection = collectCurrentContentStrings(
    bin,
    new Set(clocks.map(clock => clock.docId))
  );
  t.false(protection.preserveAll);
  await pool.clearDocHistories(workspaceId, {
    expectedDocClocks: clocks,
    protectedBlobKeys: [...protection.strings],
    preserveAllRemovedBlobs: protection.preserveAll,
  });
  t.deepEqual(await pool.getDocHistoryStorageUsage(workspaceId), {
    versions: 0,
    historyBytes: 0,
    retainedRemovedBlobBytes: 0,
  });
  t.deepEqual(await pool.listDocHistories(workspaceId, 'page', null, 50), []);
  t.deepEqual(
    await pool.listDocHistories(workspaceId, 'another-page', null, 50),
    []
  );
  t.is(await pool.getDocHistory(workspaceId, 'page', timestamp), null);
  t.deepEqual(await pool.getDocSnapshot(workspaceId, 'page'), snapshot);
  t.deepEqual(await pool.getDocUpdates(workspaceId, 'page'), updates);
  t.deepEqual(await pool.getDocClocks(workspaceId), clocks);
  t.deepEqual((await pool.getBlob(workspaceId, 'active'))?.data, active);
  t.is(await pool.getBlob(workspaceId, 'removed'), null);

  await pool.disconnect(workspaceId);
  await pool.connect(workspaceId, database);
  t.deepEqual(await pool.getDocHistoryStorageUsage(workspaceId), {
    versions: 0,
    historyBytes: 0,
    retainedRemovedBlobBytes: 0,
  });
  t.deepEqual(await pool.getDocSnapshot(workspaceId, 'page'), snapshot);
  t.deepEqual(await pool.getDocUpdates(workspaceId, 'page'), updates);
  t.deepEqual((await pool.getBlob(workspaceId, 'active'))?.data, active);
  t.is(await pool.getBlob(workspaceId, 'removed'), null);
});

test('native delete, restore, guarded cleanup and restart preserve restored assets while reclaiming unrelated removed files', async t => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'nota-restored-media-')
  );
  const database = path.join(directory, 'workspace.db');
  const workspaceId = 'restored-media-workspace';
  const pool = new DocStoragePool();
  const page = new Doc({ gc: false });
  const root = new Doc();
  t.teardown(async () => {
    page.destroy();
    root.destroy();
    await pool.disconnect(workspaceId);
    await rm(directory, { recursive: true, force: true });
  });
  await pool.connect(workspaceId, database);
  page.getMap('blocks').set('image', { sourceId: 'restored-media' });
  const originalBin = encodeStateAsUpdate(page);
  await pool.pushUpdate(workspaceId, 'page', originalBin);
  root.getMap('spaces').set('page', new Doc({ guid: 'page' }));
  await pool.pushUpdate(workspaceId, workspaceId, encodeStateAsUpdate(root));
  for (const key of ['restored-media', 'unrelated-removed'])
    await pool.setBlob(workspaceId, {
      key,
      data: new Uint8Array([1, 2]),
      mime: 'image/png',
    });
  page.getMap('blocks').delete('image');
  const deletedAt = await pool.pushUpdate(
    workspaceId,
    'page',
    encodeStateAsUpdate(page)
  );
  for (const key of ['restored-media', 'unrelated-removed'])
    await pool.deleteBlob(workspaceId, key, true);
  // Restores are forward Yjs updates checked against the durable current clock.
  page.getMap('blocks').set('image', { sourceId: 'restored-media' });
  await pool.pushUpdateForRollback(
    workspaceId,
    'page',
    encodeStateAsUpdate(page),
    deletedAt
  );
  const clocks = await pool.getDocClocks(workspaceId);
  const currentDocIds = new Set(clocks.map(clock => clock.docId));
  const rootRefs = collectCurrentContentStrings(
    encodeStateAsUpdate(root),
    currentDocIds
  );
  const pageRefs = collectCurrentContentStrings(
    encodeStateAsUpdate(page),
    currentDocIds
  );
  t.false(rootRefs.preserveAll);
  t.false(pageRefs.preserveAll);
  t.true(pageRefs.strings.has('restored-media'));
  await pool.clearDocHistories(workspaceId, {
    expectedDocClocks: clocks,
    protectedBlobKeys: [...rootRefs.strings, ...pageRefs.strings],
    preserveAllRemovedBlobs: false,
  });
  t.deepEqual(
    (await pool.getBlob(workspaceId, 'restored-media'))?.data,
    new Uint8Array([1, 2])
  );
  t.is(await pool.getBlob(workspaceId, 'unrelated-removed'), null);
  t.is((await pool.getDocHistoryStorageUsage(workspaceId)).versions, 0);
  await pool.disconnect(workspaceId);
  await pool.connect(workspaceId, database);
  await pool.releaseBlobs(workspaceId);
  t.deepEqual(
    (await pool.getBlob(workspaceId, 'restored-media'))?.data,
    new Uint8Array([1, 2])
  );
  t.is(await pool.getBlob(workspaceId, 'unrelated-removed'), null);
  const recovered = new Doc();
  for (const update of await pool.getDocUpdates(workspaceId, 'page'))
    applyUpdate(recovered, update.bin);
  t.deepEqual(recovered.getMap('blocks').get('image'), {
    sourceId: 'restored-media',
  });
  recovered.destroy();
});
