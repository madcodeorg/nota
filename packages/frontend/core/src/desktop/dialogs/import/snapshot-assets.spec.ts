/** @vitest-environment happy-dom */
import { DatabaseBlockDataSource } from '@blocksuite/affine/blocks/database';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import { type DocSnapshot, Text, Transformer } from '@blocksuite/affine/store';
import { Zip, ZipTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { getAFFiNEWorkspaceSchema } from '@nota/core/modules/workspace/global-schema';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
});
function createWorkspace(id: string) {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id, rootDoc });
  workspace.meta.initialize();
  cleanup.push(() => {
    workspace.dispose();
    rootDoc.destroy();
  });
  return workspace;
}
function createPage(workspace: WorkspaceImpl) {
  const doc = workspace.createDoc();
  doc.load();
  const store = doc.getStore();
  const pageId = store.addBlock('affine:page', {
    title: new Text('Snapshot assets'),
  });
  const noteId = store.addBlock('affine:note', {}, pageId);
  return { store, noteId };
}

async function archiveSnapshots(snapshots: (DocSnapshot | string)[]) {
  const zip = new Zip();
  for (const [index, snapshot] of snapshots.entries())
    await zip.file(
      `${index}.snapshot.json`,
      typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)
    );
  return zip.generate();
}

function snapshotPage(store: ReturnType<typeof createPage>['store']) {
  const snapshot = new Transformer({
    schema: getAFFiNEWorkspaceSchema(),
    blobCRUD: store.workspace.blobSync,
    docCRUD: {
      create: () => {
        throw new Error('Read only');
      },
      get: () => null,
      delete: () => {},
    },
  }).docToSnapshot(store);
  if (!snapshot) throw new Error('Missing test snapshot');
  return snapshot;
}

describe('native snapshots require their local assets', () => {
  test('cancellation during native asset preparation prevents the complete snapshot download', async () => {
    const workspace = createWorkspace('cancel-export');
    const { store, noteId } = createPage(workspace);
    store.addBlock(
      'affine:attachment',
      { sourceId: 'file', name: 'file.txt' },
      noteId
    );
    await workspace.blobSync.set(
      'file',
      new File(['complete file'], 'file.txt', { type: 'text/plain' })
    );
    const request = new AbortController();
    const get = workspace.blobSync.get.bind(workspace.blobSync);
    vi.spyOn(workspace.blobSync, 'get').mockImplementation(async id => {
      const file = await get(id);
      request.abort();
      return file;
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await expect(
      ZipTransformer.exportDocs(
        workspace,
        getAFFiNEWorkspaceSchema(),
        [store],
        request.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(click).not.toHaveBeenCalled();
  });
  test('fails visibly before downloading an incomplete attachment snapshot', async () => {
    const workspace = createWorkspace('missing-block-asset');
    const { store, noteId } = createPage(workspace);
    store.addBlock(
      'affine:attachment',
      { name: 'missing.pdf', sourceId: 'missing-blob' },
      noteId
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await expect(
      ZipTransformer.exportDocs(workspace, getAFFiNEWorkspaceSchema(), [store])
    ).rejects.toThrow('required attachment');
    expect(click).not.toHaveBeenCalled();
  });
  test('does not silently omit a missing file stored inside a database cell', async () => {
    const workspace = createWorkspace('missing-db-asset');
    const { store, noteId } = createPage(workspace);
    const databaseId = store.addBlock(
      'affine:database',
      {
        columns: [{ id: 'file', name: 'Files', type: 'attachment', data: {} }],
      },
      noteId
    );
    const rowId = store.addBlock(
      'affine:paragraph',
      { text: new Text('A file') },
      databaseId
    );
    const model = store.getModelById(databaseId) as DatabaseBlockModel;
    model.props.cells[rowId] = {
      file: {
        columnId: 'file',
        value: {
          'missing-db-blob': {
            id: 'missing-db-blob',
            name: 'report.pdf',
            order: 'a0',
          },
        },
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await expect(
      ZipTransformer.exportDocs(workspace, getAFFiNEWorkspaceSchema(), [store])
    ).rejects.toThrow('required attachment');
    expect(click).not.toHaveBeenCalled();
  });
  test('exports and imports database attachment bytes into a fresh workspace', async () => {
    const workspace = createWorkspace('database-assets-source');
    const { store, noteId } = createPage(workspace);
    workspace.meta.setDocMeta(store.id, { title: '项目 Résumé 📝' });
    const bytes = new File(['attachment content'], '报告 Résumé 📝.txt', {
      type: 'text/plain',
    });
    const blobId = await workspace.blobSync.set('database-blob', bytes);
    const databaseId = store.addBlock(
      'affine:database',
      {
        columns: [{ id: 'file', name: 'Files', type: 'attachment', data: {} }],
      },
      noteId
    );
    const rowId = store.addBlock(
      'affine:paragraph',
      { text: new Text('A file') },
      databaseId
    );
    const model = store.getModelById(databaseId) as DatabaseBlockModel;
    model.props.cells[rowId] = {
      file: {
        columnId: 'file',
        value: {
          [blobId]: { id: blobId, name: '报告 Résumé 📝.txt', order: 'a0' },
        },
      },
    };
    let exported: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      exported = blob as Blob;
      return 'blob:export-test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await ZipTransformer.exportDocs(workspace, getAFFiNEWorkspaceSchema(), [
      store,
    ]);
    expect(exported).toBeDefined();
    const destination = createWorkspace('database-assets-destination');
    const imported = await ZipTransformer.importDocs(
      destination,
      getAFFiNEWorkspaceSchema(),
      exported!
    );
    expect(imported.filter(Boolean)).toHaveLength(1);
    expect(await (await destination.blobSync.get(blobId))?.text()).toBe(
      'attachment content'
    );
  });

  test('rejects a malformed second snapshot and missing required blobs before any live write', async () => {
    const source = createWorkspace('invalid-source');
    const first = createPage(source);
    const destination = createWorkspace('invalid-destination');
    const create = vi.spyOn(destination, 'createDoc');
    const setBlob = vi.spyOn(destination.blobSync, 'set');
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        await archiveSnapshots([snapshotPage(first.store), '{'])
      )
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
    first.store.addBlock(
      'affine:attachment',
      { sourceId: 'missing', name: 'missing.txt' },
      first.noteId
    );
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        await archiveSnapshots([snapshotPage(first.store)])
      )
    ).rejects.toThrow('missing a required attachment');
    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
  });

  test('rolls back newly published pages when later publication fails, preserving existing content', async () => {
    const source = createWorkspace('rollback-source');
    const first = createPage(source);
    const second = createPage(source);
    const archive = await archiveSnapshots([
      snapshotPage(first.store),
      snapshotPage(second.store),
    ]);
    const destination = createWorkspace('rollback-destination');
    const existing = createPage(destination);
    const existingId = existing.store.id;
    const original = destination.createDoc.bind(destination);
    let calls = 0;
    const create = vi.spyOn(destination, 'createDoc').mockImplementation(id => {
      if (++calls === 2) throw new Error('publication failed');
      return original(id);
    });
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        archive
      )
    ).rejects.toThrow('publication failed');
    expect([...destination.docs.keys()]).toEqual([existingId]);
    expect(destination.meta.getDocMeta(existingId)?.title).toBe(
      'Snapshot assets'
    );
    create.mockRestore();
    await ZipTransformer.importDocs(
      destination,
      getAFFiNEWorkspaceSchema(),
      archive
    );
    expect(destination.docs.size).toBe(3);
  });

  test('rejects unsafe archive paths and attachment identity conflicts without changing user data', async () => {
    const unsafe = new Zip();
    await unsafe.file('../escape.snapshot.json', '{}');
    const destination = createWorkspace('safe-destination');
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        await unsafe.generate()
      )
    ).rejects.toThrow('unsafe file path');
    const source = createWorkspace('conflict-source');
    const { store, noteId } = createPage(source);
    store.addBlock(
      'affine:attachment',
      { sourceId: 'same-id', name: 'report.txt' },
      noteId
    );
    const archive = new Zip();
    await archive.file(
      'page.snapshot.json',
      JSON.stringify(snapshotPage(store))
    );
    await archive.file(
      'assets/same-id.txt',
      new Blob(['incoming'], { type: 'text/plain' })
    );
    await destination.blobSync.set(
      'same-id',
      new Blob(['existing'], { type: 'text/plain' })
    );
    const set = vi.spyOn(destination.blobSync, 'set');
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        await archive.generate()
      )
    ).rejects.toThrow('conflicts with existing');
    expect(set).not.toHaveBeenCalled();
    expect(await (await destination.blobSync.get('same-id'))?.text()).toBe(
      'existing'
    );
    expect(destination.docs.size).toBe(0);
  });

  test('restores cross-page relations, computed references and Calendar/Gallery options together', async () => {
    const source = createWorkspace('connected-source');
    const projects = createPage(source);
    const tasks = createPage(source);
    source.meta.setDocMeta(projects.store.id, { title: 'Projects' });
    source.meta.setDocMeta(tasks.store.id, { title: 'Tasks' });
    const taskDbId = tasks.store.addBlock(
      'affine:database',
      {
        title: new Text('Tasks'),
        columns: [
          { id: 'task-title', type: 'title', name: 'Task', data: {} },
          {
            id: 'cost',
            type: 'number',
            name: 'Cost',
            data: { decimal: 0, format: 'number' },
          },
        ],
      },
      tasks.noteId
    );
    const taskRowId = tasks.store.addBlock(
      'affine:paragraph',
      { text: new Text('Task one') },
      taskDbId
    );
    const taskDb = tasks.store.getModelById(taskDbId) as DatabaseBlockModel;
    taskDb.props.cells[taskRowId] = { cost: { columnId: 'cost', value: 7 } };
    const projectDbId = projects.store.addBlock(
      'affine:database',
      {
        title: new Text('Projects'),
        columns: [
          { id: 'project-title', type: 'title', name: 'Project', data: {} },
          {
            id: 'budget',
            type: 'number',
            name: 'Budget',
            data: { decimal: 0, format: 'number' },
          },
          {
            id: 'related',
            type: 'relation',
            name: 'Tasks',
            data: { targetDocId: tasks.store.id, targetDatabaseId: taskDbId },
          },
          {
            id: 'double',
            type: 'formula',
            name: 'Double budget',
            data: { expression: 'prop("budget") * 2', resultType: 'number' },
          },
          {
            id: 'total',
            type: 'rollup',
            name: 'Task total',
            data: {
              relationColumnId: 'related',
              targetColumnId: 'cost',
              operation: 'sum',
            },
          },
          { id: 'deadline', type: 'date', name: 'Deadline', data: {} },
          { id: 'cover', type: 'image', name: 'Cover', data: {} },
        ],
      },
      projects.noteId
    );
    const projectRowId = projects.store.addBlock(
      'affine:paragraph',
      { text: new Text('Project one') },
      projectDbId
    );
    const projectDb = projects.store.getModelById(
      projectDbId
    ) as DatabaseBlockModel;
    projectDb.props.cells[projectRowId] = {
      budget: { columnId: 'budget', value: 4 },
      related: { columnId: 'related', value: [taskRowId] },
    };
    const dataSource = new DatabaseBlockDataSource(projectDb);
    dataSource.viewManager.viewAdd('calendar');
    dataSource.viewManager.viewAdd('gallery');
    const calendar = projectDb.props.views[0] as unknown as Record<
      string,
      unknown
    >;
    calendar.dateColumn = 'deadline';
    calendar.month = '2026-10';
    calendar.header = { titleColumn: 'project-title' };
    const gallery = projectDb.props.views[1] as unknown as Record<
      string,
      unknown
    >;
    gallery.header = { titleColumn: 'project-title', imageColumn: 'cover' };
    const archive = await archiveSnapshots([
      snapshotPage(projects.store),
      snapshotPage(tasks.store),
    ]);
    const destination = createWorkspace('connected-destination');
    const imported = await ZipTransformer.importDocs(
      destination,
      getAFFiNEWorkspaceSchema(),
      archive
    );
    const restoredProject = imported[0].getBlocksByFlavour('affine:database')[0]
      .model as DatabaseBlockModel;
    const restoredTask = imported[1].getBlocksByFlavour('affine:database')[0]
      .model as DatabaseBlockModel;
    const byName = (name: string) =>
      restoredProject.props.columns.find(column => column.name === name)!;
    expect(byName('Tasks').data).toEqual({
      targetDocId: imported[1].id,
      targetDatabaseId: restoredTask.id,
    });
    expect(
      restoredProject.props.cells[restoredProject.children[0].id][
        byName('Tasks').id
      ].value
    ).toEqual([restoredTask.children[0].id]);
    expect(byName('Double budget').data.expression).toBe(
      `prop("${byName('Budget').id}") * 2`
    );
    expect(byName('Task total').data).toEqual({
      relationColumnId: byName('Tasks').id,
      targetColumnId: restoredTask.props.columns.find(
        column => column.name === 'Cost'
      )!.id,
      operation: 'sum',
    });
    const restoredSource = new DatabaseBlockDataSource(restoredProject);
    expect(
      restoredSource.cellValueGet(
        restoredProject.children[0].id,
        byName('Double budget').id
      )
    ).toBe(8);
    expect(
      restoredSource.cellValueGet(
        restoredProject.children[0].id,
        byName('Task total').id
      )
    ).toBe(7);
    expect(restoredProject.props.views[0]).toMatchObject({
      mode: 'calendar',
      dateColumn: byName('Deadline').id,
      month: '2026-10',
      header: { titleColumn: byName('Project').id },
    });
    expect(restoredProject.props.views[1]).toMatchObject({
      mode: 'gallery',
      header: {
        titleColumn: byName('Project').id,
        imageColumn: byName('Cover').id,
      },
    });
  });

  test('checks the manifest integrity and archive expansion metadata before any live write', async () => {
    const source = createWorkspace('integrity-source');
    const page = createPage(source);
    const snapshot = snapshotPage(page.store);
    const zip = new Zip();
    await zip.file('page.snapshot.json', JSON.stringify(snapshot));
    await zip.file('assets/blob.txt', 'changed');
    await zip.file(
      'nota.snapshot-manifest.json',
      JSON.stringify({
        format: 'nota-workspace-snapshot',
        version: 1,
        documents: [{ id: snapshot.meta.id, path: 'page.snapshot.json' }],
        assets: [
          {
            id: 'blob',
            path: 'assets/blob.txt',
            size: 7,
            mime: 'text/plain',
            sha256: 'wrong',
          },
        ],
        blockVersions: {},
      })
    );
    const destination = createWorkspace('integrity-destination');
    const set = vi.spyOn(destination.blobSync, 'set');
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        await zip.generate()
      )
    ).rejects.toThrow('integrity check');
    expect(set).not.toHaveBeenCalled();
    expect(destination.docs.size).toBe(0);

    const small = await archiveSnapshots([snapshot]);
    const bytes = new Uint8Array(await small.arrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 28; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 600 * 1024 * 1024, true);
        break;
      }
    }
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        new Blob([bytes])
      )
    ).rejects.toThrow('expansion limit');
    expect(destination.docs.size).toBe(0);
  });

  test('cancellation during asset preparation prevents live document publication', async () => {
    const source = createWorkspace('cancel-source');
    const page = createPage(source);
    page.store.addBlock(
      'affine:attachment',
      { sourceId: 'cancel-blob', name: 'file.txt' },
      page.noteId
    );
    const zip = new Zip();
    await zip.file(
      'page.snapshot.json',
      JSON.stringify(snapshotPage(page.store))
    );
    await zip.file('assets/cancel-blob.txt', 'content');
    const destination = createWorkspace('cancel-destination');
    const controller = new AbortController();
    vi.spyOn(destination.blobSync, 'get').mockImplementation(async () => {
      controller.abort();
      return null;
    });
    const create = vi.spyOn(destination, 'createDoc');
    const set = vi.spyOn(destination.blobSync, 'set');
    await expect(
      ZipTransformer.importDocs(
        destination,
        getAFFiNEWorkspaceSchema(),
        await zip.generate(),
        controller.signal
      )
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(destination.docs.size).toBe(0);
  });
});
