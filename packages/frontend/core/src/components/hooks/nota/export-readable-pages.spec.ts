/** @vitest-environment happy-dom */
import { type SurfaceBlockModel } from '@blocksuite/affine/blocks/surface';
import type { DatabaseBlockModel } from '@blocksuite/affine/model';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { Text, type Workspace } from '@blocksuite/affine/store';
import { Unzip } from '@blocksuite/affine/widgets/linked-doc';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc, encodeStateAsUpdate } from 'yjs';

import { exportReadablePages } from './export-readable-pages';
import { exportPageData } from './use-export-page';

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  vi.restoreAllMocks();
});
function workspace() {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id: 'readable-workspace', rootDoc });
  workspace.meta.initialize();
  cleanup.push(() => {
    workspace.dispose();
    rootDoc.destroy();
  });
  return workspace;
}
function page(workspace: WorkspaceImpl, id: string, title: string) {
  const doc = workspace.createDoc(id);
  doc.load();
  const store = doc.getStore();
  const root = store.addBlock('affine:page', { title: new Text(title) });
  const note = store.addBlock('affine:note', {}, root);
  workspace.meta.setDocMeta(id, { title });
  return { store, root, note };
}
function downloads() {
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    blobs.push(blob as Blob);
    return 'blob:readable';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  return { blobs, click };
}
async function entries(blob: Blob) {
  const unzip = new Unzip();
  await unzip.load(blob);
  return new Map([...unzip].map(entry => [entry.path, entry.content]));
}
function reference(target: string) {
  return new Text<AffineTextAttributes>([
    {
      insert: ' ',
      attributes: { reference: { type: 'LinkedPage', pageId: target } },
    },
  ]);
}

describe('complete readable archives', () => {
  test.each(['markdown', 'html'] as const)(
    'exports %s page/file links, canonical bytes, duplicate Unicode names and exact subset scope in one download',
    async format => {
      const ws = workspace();
      const title = '计划 Résumé 📝 <&>';
      const a = page(ws, 'a', title);
      const b = page(ws, 'b', title);
      const outside = page(ws, 'c', 'Outside');
      outside.store.addBlock(
        'affine:paragraph',
        { text: new Text('SECRET UNSELECTED CONTENT') },
        outside.note
      );
      a.store.addBlock('affine:paragraph', { text: reference('b') }, a.note);
      a.store.addBlock('affine:embed-linked-doc', { pageId: 'b' }, a.note);
      a.store.addBlock('affine:embed-synced-doc', { pageId: 'c' }, a.note);
      a.store.addBlock('affine:embed-synced-doc', { pageId: 'b' }, a.note);
      const external = new Text([
        {
          insert: 'External image',
          attributes: { link: 'https://example.com/remote.png' },
        },
      ]);
      a.store.addBlock('affine:paragraph', { text: external }, a.note);
      a.store.addBlock(
        'affine:image',
        {
          sourceId: 'https://example.com/remote-source.png',
          caption: 'Remote source image',
        },
        a.note
      );
      const first = new File(['FIRST FILE BYTES'], '报告 Résumé 📝.png', {
        type: 'image/png',
      });
      const second = new File(['SECOND FILE BYTES'], '报告 Résumé 📝.png', {
        type: 'image/png',
      });
      await ws.blobSync.set('first', first);
      await ws.blobSync.set('second', second);
      a.store.addBlock('affine:image', { sourceId: 'first' }, a.note);
      a.store.addBlock(
        'affine:attachment',
        { sourceId: 'second', name: 'My attachment' },
        a.note
      );
      b.store.addBlock('affine:image', { sourceId: 'second' }, b.note);
      const dbId = a.store.addBlock(
        'affine:database',
        {
          columns: [
            { id: 'title', type: 'title', name: 'Title', data: {} },
            { id: 'files', type: 'attachment', name: 'Files', data: {} },
            { id: 'notes', type: 'rich-text', name: 'Notes', data: {} },
          ],
        },
        a.note
      );
      const row = a.store.addBlock(
        'affine:paragraph',
        { text: new Text('Database row') },
        dbId
      );
      const model = a.store.getModelById(dbId) as DatabaseBlockModel;
      model.props.cells[row] = {
        files: {
          columnId: 'files',
          value: {
            second: { id: 'second', name: 'Database file', order: 'a0' },
          },
        },
        notes: { columnId: 'notes', value: reference('b') },
      };
      const original = encodeStateAsUpdate(a.store.spaceDoc);
      const get = vi.spyOn(ws.blobSync, 'get');
      const { blobs, click } = downloads();
      await exportReadablePages([b.store, a.store, a.store], format);
      expect(click).toHaveBeenCalledOnce();
      expect(get.mock.calls.every(([id]) => !id.startsWith('https://'))).toBe(
        true
      );
      const files = await entries(blobs[0]);
      const pageFiles = [...files.keys()].filter(path => /^[12]-/.test(path));
      expect(pageFiles).toHaveLength(2);
      const aPath = pageFiles.find(path => path.startsWith('1-'))!;
      const bPath = pageFiles.find(path => path.startsWith('2-'))!;
      expect(aPath).toContain('计划 Résumé 📝');
      const aText = await files.get(aPath)!.text();
      const bText = await files.get(bPath)!.text();
      expect(aText).toContain(`./${encodeURIComponent(bPath)}`);
      expect(aText).toContain('/workspace/readable-workspace/c');
      expect(aText).toContain('https://example.com/remote.png');
      expect(aText).toContain('https://example.com/remote-source.png');
      expect(aText).not.toContain('SECRET UNSELECTED CONTENT');
      expect(aText).toContain('My attachment');
      expect(aText).toContain('Database file');
      const assetPaths = [...files.keys()].filter(path =>
        path.startsWith('assets/')
      );
      expect(assetPaths).toHaveLength(2);
      expect(
        new Set(
          await Promise.all(assetPaths.map(path => files.get(path)!.text()))
        )
      ).toEqual(new Set(['FIRST FILE BYTES', 'SECOND FILE BYTES']));
      const secondPath = assetPaths.find(path => path.startsWith('assets/2-'))!;
      expect(decodeURIComponent(aText)).toContain(secondPath);
      expect(decodeURIComponent(bText)).toContain(secondPath);
      const report = await files.get('Export report.txt')!.text();
      expect(report).toContain('outside this export');
      expect(report).toContain('interactive behavior');
      expect(encodeStateAsUpdate(a.store.spaceDoc)).toEqual(original);
      if (format === 'html') {
        const parsed = new DOMParser().parseFromString(aText, 'text/html');
        expect(parsed.querySelector('h1')?.textContent).toBe(title);
        expect(parsed.querySelector('h1')?.children).toHaveLength(0);
      }
    }
  );

  test.each(['image', 'attachment', 'database'] as const)(
    'missing canonical %s assets stop both readable formats before download',
    async kind => {
      const ws = workspace();
      const a = page(ws, 'a', 'Good page');
      const b = page(ws, 'b', 'Missing page');
      if (kind !== 'database')
        b.store.addBlock(
          `affine:${kind}`,
          { sourceId: 'missing', name: 'Missing file' },
          b.note
        );
      else {
        const dbId = b.store.addBlock(
          'affine:database',
          {
            columns: [
              { id: 'title', type: 'title', name: 'Title', data: {} },
              { id: 'file', type: 'attachment', name: 'File', data: {} },
            ],
          },
          b.note
        );
        const row = b.store.addBlock(
          'affine:paragraph',
          { text: new Text('Missing file') },
          dbId
        );
        (b.store.getModelById(dbId) as DatabaseBlockModel).props.cells[row] = {
          file: {
            columnId: 'file',
            value: {
              missing: { id: 'missing', name: 'Missing file', order: 'a0' },
            },
          },
        };
      }
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { click } = downloads();
      for (const format of ['markdown', 'html'] as const)
        await expect(
          exportReadablePages([a.store, b.store], format)
        ).rejects.toThrow('required local');
      expect(click).not.toHaveBeenCalled();
    }
  );

  test('includes unsupported canvas image bytes and reports the lost drawing layout', async () => {
    const ws = workspace();
    const a = page(ws, 'a', 'Canvas');
    const surfaceId = a.store.addBlock('affine:surface', {}, a.root);
    const surface = a.store.getModelById(surfaceId) as SurfaceBlockModel;
    surface.addElement({ type: 'shape' });
    a.store.addBlock('affine:image', { sourceId: 'canvas-image' }, surfaceId);
    await ws.blobSync.set(
      'canvas-image',
      new File(['CANVAS IMAGE'], 'canvas.png', { type: 'image/png' })
    );
    const { blobs } = downloads();
    await exportReadablePages([a.store], 'html');
    const files = await entries(blobs[0]);
    expect(await files.get('assets/1-canvas.png')!.text()).toBe('CANVAS IMAGE');
    expect(await files.get('Export report.txt')!.text()).toContain(
      'Canvas drawings and layout'
    );
  });

  test('cancellation during an asset read prevents any partial download and leaves pages untouched', async () => {
    const ws = workspace();
    const a = page(ws, 'a', 'Cancel');
    a.store.addBlock(
      'affine:attachment',
      { sourceId: 'file', name: 'file.txt' },
      a.note
    );
    let resolve: (file: File) => void = () => {};
    vi.spyOn(ws.blobSync, 'get').mockImplementation(
      () =>
        new Promise<File>(done => {
          resolve = done;
        })
    );
    const { click } = downloads();
    const request = new AbortController();
    const exporting = exportReadablePages(
      [a.store],
      'markdown',
      request.signal
    );
    await vi.waitFor(() => expect(ws.blobSync.get).toHaveBeenCalled());
    request.abort();
    await expect(exporting).rejects.toMatchObject({ name: 'AbortError' });
    resolve(new File(['late file'], 'file.txt', { type: 'text/plain' }));
    expect(click).not.toHaveBeenCalled();
    expect(ws.docs.size).toBe(1);
  });

  test.each(['markdown', 'html', 'csv'] as const)(
    'awaits a local relation target before capturing %s rollup values, then releases the target',
    async format => {
      const ws = workspace();
      const a = page(ws, 'a', 'Rollups');
      const target = ws.createDoc('target');
      let finish: () => void = () => {};
      const ready = new Promise<void>(resolve => {
        finish = resolve;
      });
      const release = vi.fn();
      const acquire = vi.fn(() => ({ ready, release }));
      (ws as Workspace).acquireDoc = acquire;
      const dbId = a.store.addBlock(
        'affine:database',
        {
          columns: [
            { id: 'title', type: 'title', name: 'Title', data: {} },
            {
              id: 'related',
              type: 'relation',
              name: 'Related',
              data: { targetDocId: target.id, targetDatabaseId: 'target-db' },
            },
            {
              id: 'total',
              type: 'rollup',
              name: 'Total',
              data: {
                relationColumnId: 'related',
                targetColumnId: 'cost',
                operation: 'sum',
              },
            },
          ],
        },
        a.note
      );
      const row = a.store.addBlock(
        'affine:paragraph',
        { text: new Text('Source row') },
        dbId
      );
      const model = a.store.getModelById(dbId) as DatabaseBlockModel;
      model.props.cells[row] = {
        related: { columnId: 'related', value: ['target-row'] },
      };
      const { blobs, click } = downloads();
      const exporting = exportPageData(a.store, format);
      await vi.waitFor(() =>
        expect(acquire).toHaveBeenCalledExactlyOnceWith('target')
      );
      expect(click).not.toHaveBeenCalled();
      target.load();
      const targetStore = target.getStore();
      const root = targetStore.addBlock('affine:page');
      const note = targetStore.addBlock('affine:note', {}, root);
      targetStore.addBlock(
        'affine:database',
        {
          id: 'target-db',
          columns: [
            { id: 'title', type: 'title', name: 'Title', data: {} },
            {
              id: 'cost',
              type: 'number',
              name: 'Cost',
              data: { decimal: 0, format: 'number' },
            },
          ],
        },
        note
      );
      targetStore.addBlock(
        'affine:paragraph',
        { id: 'target-row', text: new Text('Target row') },
        'target-db'
      );
      const targetModel = targetStore.getModelById(
        'target-db'
      ) as DatabaseBlockModel;
      targetModel.props.cells['target-row'] = {
        cost: { columnId: 'cost', value: 37 },
      };
      finish();
      await exporting;
      const files = await entries(blobs[0]);
      const content = await files
        .get([...files.keys()].find(path => path.startsWith('1-'))!)!
        .text();
      expect(content).toMatch(/(?:>|\s|,)37(?:<|\s|$)/);
      expect(content).not.toContain('loading');
      expect(release).toHaveBeenCalledOnce();
      expect(model.props.cells[row].total).toBeUndefined();
    }
  );

  test.each(['markdown', 'csv'] as const)(
    'cancelling %s while a target loads releases its local lease and never downloads',
    async format => {
      const ws = workspace();
      const a = page(ws, 'a', 'Cancelled target');
      ws.createDoc('target');
      let finish: () => void = () => {};
      const release = vi.fn();
      const acquire = vi.fn(() => ({
        ready: new Promise<void>(resolve => {
          finish = resolve;
        }),
        release,
      }));
      (ws as Workspace).acquireDoc = acquire;
      a.store.addBlock(
        'affine:database',
        {
          columns: [
            { id: 'title', type: 'title', name: 'Title', data: {} },
            {
              id: 'related',
              type: 'relation',
              name: 'Related',
              data: { targetDocId: 'target', targetDatabaseId: 'target-db' },
            },
          ],
        },
        a.note
      );
      const request = new AbortController();
      const { click } = downloads();
      const exporting = exportPageData(a.store, format, request.signal);
      await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce());
      request.abort();
      await expect(exporting).rejects.toMatchObject({ name: 'AbortError' });
      expect(release).toHaveBeenCalledOnce();
      finish();
      expect(click).not.toHaveBeenCalled();
    }
  );
});
