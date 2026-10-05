import type {
  AttachmentBlockModel,
  ImageBlockModel,
  ParagraphBlockModel,
  RootBlockModel,
} from '@blocksuite/affine-model';
import {
  NotionHtmlTransformer,
  Zip,
} from '@blocksuite/affine-widget-linked-doc';
import { Schema, Text, type Workspace } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AffineSchemas } from '../../schemas.js';
import { testStoreExtensions } from '../utils/store.js';

const workspaces: TestWorkspace[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    workspace.forceStop();
    workspace.dispose();
    workspace.doc.destroy();
  }
  vi.restoreAllMocks();
});

function createWorkspace(id: string): TestWorkspace & Workspace {
  const workspace = new TestWorkspace({ id });
  workspace.storeExtensions = testStoreExtensions;
  workspace.meta.initialize();
  workspaces.push(workspace);
  return Object.assign(workspace, {
    createStagingWorkspace: () => createWorkspace(`${id}-staging`),
  });
}

const schema = new Schema().register(AffineSchemas);
const html = (title: string, body = '') =>
  `<html><head><title>${title}</title></head><body><article><div class="page-body">${body}</div></article></body></html>`;

async function archive(entries: [string, Blob | string][]) {
  const zip = new Zip();
  for (const [path, contents] of entries) await zip.file(path, contents);
  return zip.generate();
}

function options(collection: Workspace, imported: Blob) {
  return { collection, imported, schema, extensions: testStoreExtensions };
}

// Stand in for the app's CSV importer: this callback receives the detached
// workspace and the already allocated identity, never the live destination.
const importCsv = async (
  collection: Workspace,
  file: Blob,
  docId: string,
  title: string
) => {
  if (!(await file.text()).startsWith('Name')) throw new Error('Invalid CSV');
  const doc = collection.createDoc(docId);
  doc.load();
  const store = doc.getStore();
  const page = store.addBlock('affine:page', { title: new Text(title) });
  const note = store.addBlock('affine:note', {}, page);
  store.addBlock('affine:database', { title: new Text(title) }, note);
  collection.meta.setDocMeta(docId, { title });
  return store;
};

describe('staged Notion HTML and CSV archive import', () => {
  test('imports standalone and nested CSV databases without opening the old blog', async () => {
    const collection = createWorkspace('csv');
    const open = vi.spyOn(window, 'open');
    const inner = await archive([['Team/Tasks.csv', 'Name,Cost\nTask,7']]);
    const imported = await archive([
      ['Projects.csv', 'Name\nProject'],
      ['part.zip', inner],
    ]);
    const csv = vi.fn(importCsv);
    const result = await NotionHtmlTransformer.importNotionZip({
      ...options(collection, imported),
      importCsv: csv,
    });
    expect(result.pageIds).toHaveLength(2);
    expect(collection.docs.size).toBe(2);
    expect(csv).toHaveBeenCalledTimes(2);
    expect(csv.mock.calls[0][0]).not.toBe(collection);
    expect(csv.mock.calls[1][0]).toBe(csv.mock.calls[0][0]);
    expect(csv.mock.calls.map(call => call[2])).toEqual(result.pageIds);
    expect(
      result.folderHierarchy?.children.get('Team')?.children.get('Tasks')
        ?.pageId
    ).toBe(result.pageIds[1]);
    expect(open).not.toHaveBeenCalled();
  });

  test('preallocates one path map for HTML, CSV, nested archives and empty linked pages', async () => {
    const collection = createWorkspace('links');
    const nested = await archive([
      ['Other/Tasks.csv', 'Name\nOther'],
      ['Team/Empty.html', html('Empty')],
    ]);
    const imported = await archive([
      [
        'Team/Home.html',
        html(
          'Home',
          '<p id="links"><a href="Tasks.csv">Tasks</a> <a href="../Other/Tasks.csv">Other</a> <a href="Empty.html">Empty</a></p>'
        ),
      ],
      ['Team/Tasks.csv', 'Name\nTask'],
      ['later.zip', nested],
    ]);
    const result = await NotionHtmlTransformer.importNotionZip({
      ...options(collection, imported),
      importCsv,
    });
    const home = collection.getDoc(result.pageIds[0])!.getStore();
    const paragraph = home.getBlocksByFlavour('affine:paragraph')[0]
      .model as ParagraphBlockModel;
    const references = paragraph.props.text
      .toDelta()
      .map(delta => delta.attributes?.reference?.pageId)
      .filter(Boolean);
    expect(references).toEqual(result.pageIds.slice(1));
    expect(collection.getDoc(result.pageIds[3])!.getStore().root).toBeDefined();
    expect(collection.meta.getDocMeta(result.pageIds[0])?.title).toBe('Home');
  });

  test('rejects unsupported CSV and a later malformed database before any live write', async () => {
    const collection = createWorkspace('failed');
    const create = vi.spyOn(collection, 'createDoc');
    const set = vi.spyOn(collection.blobSync, 'set');
    const imported = await archive([
      ['Home.html', html('Home', '<p>Keep me</p>')],
      ['Tasks.csv', 'Invalid'],
    ]);
    await expect(
      NotionHtmlTransformer.importNotionZip(options(collection, imported))
    ).rejects.toThrow('CSV import is unavailable');
    await expect(
      NotionHtmlTransformer.importNotionZip({
        ...options(collection, imported),
        importCsv,
      })
    ).rejects.toThrow('Invalid CSV');
    expect(create).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(collection.docs.size).toBe(0);
  });

  test('preserves local attachment bytes and rejects missing attachments before publication', async () => {
    const collection = createWorkspace('assets');
    const imported = await archive([
      [
        'Team/Home.html',
        html(
          'Home',
          '<figure><div class="source"><a href="files/report.txt">Report</a></div></figure><img src="files/cover%20%23%20%E6%8A%A5%E5%91%8A.png">'
        ),
      ],
      [
        'Team/files/report.txt',
        new Blob(['local report'], { type: 'text/plain' }),
      ],
      [
        'Team/files/cover # 报告.png',
        new Blob(['local image'], { type: 'image/png' }),
      ],
    ]);
    const result = await NotionHtmlTransformer.importNotionZip(
      options(collection, imported)
    );
    const page = collection.getDoc(result.pageIds[0])!.getStore();
    const attachment = page.getBlocksByFlavour('affine:attachment')[0]
      .model as AttachmentBlockModel;
    expect(
      await (await collection.blobSync.get(attachment.props.sourceId!))?.text()
    ).toBe('local report');
    const image = page.getBlocksByFlavour('affine:image')[0]
      .model as ImageBlockModel;
    expect(
      await (await collection.blobSync.get(image.props.sourceId!))?.text()
    ).toBe('local image');
    const destination = createWorkspace('missing');
    const create = vi.spyOn(destination, 'createDoc');
    const missing = await archive([
      ['Home.html', html('Home', '<img src="missing.png">')],
    ]);
    await expect(
      NotionHtmlTransformer.importNotionZip(options(destination, missing))
    ).rejects.toThrow('required Notion attachment is missing');
    expect(create).not.toHaveBeenCalled();
  });

  test('cancellation while the CSV callback is pending leaves no visible pages', async () => {
    const collection = createWorkspace('cancelled');
    const controller = new AbortController();
    const imported = await archive([['Tasks.csv', 'Name\nTask']]);
    await expect(
      NotionHtmlTransformer.importNotionZip({
        ...options(collection, imported),
        signal: controller.signal,
        importCsv: async (...args) => {
          const page = await importCsv(...args);
          controller.abort();
          return page;
        },
      })
    ).rejects.toThrow();
    expect(collection.docs.size).toBe(0);
  });

  test('rejects colliding nested paths and excessive nesting before publication', async () => {
    const collection = createWorkspace('unsafe-nested');
    const duplicate = await archive([['Tasks.csv', 'Name\nDuplicate']]);
    const collision = await archive([
      ['Tasks.csv', 'Name\nOriginal'],
      ['part.zip', duplicate],
    ]);
    await expect(
      NotionHtmlTransformer.importNotionZip({
        ...options(collection, collision),
        importCsv,
      })
    ).rejects.toThrow('repeats a file path');
    let nested = await archive([['Tasks.csv', 'Name\nTask']]);
    for (let level = 0; level < 9; level++)
      nested = await archive([['part.zip', nested]]);
    await expect(
      NotionHtmlTransformer.importNotionZip({
        ...options(collection, nested),
        importCsv,
      })
    ).rejects.toThrow('too many nested ZIP files');
    expect(collection.docs.size).toBe(0);
  });

  test('retains folder identities for same-named HTML and CSV exports', async () => {
    const collection = createWorkspace('same-name');
    const imported = await archive([
      ['Team/Tasks.html', html('Tasks')],
      ['Team/Tasks.csv', 'Name\nTask'],
    ]);
    const result = await NotionHtmlTransformer.importNotionZip({
      ...options(collection, imported),
      importCsv,
    });
    const children = result.folderHierarchy?.children.get('Team')?.children;
    expect(children?.get('Tasks')?.pageId).toBe(result.pageIds[0]);
    expect(children?.get('Tasks.csv')?.pageId).toBe(result.pageIds[1]);
  });

  test('rejects Markdown and CSV exports instead of reporting a partial migration as successful', async () => {
    const collection = createWorkspace('markdown');
    const csv = vi.fn(importCsv);
    const imported = await archive([
      ['Home.md', '# Home'],
      ['Tasks.csv', 'Name\nTask'],
    ]);
    await expect(
      NotionHtmlTransformer.importNotionZip({
        ...options(collection, imported),
        importCsv: csv,
      })
    ).rejects.toThrow('use Markdown ZIP import');
    expect(csv).not.toHaveBeenCalled();
    expect(collection.docs.size).toBe(0);
  });

  test('rolls back all new pages when publication fails and keeps existing content', async () => {
    const collection = createWorkspace('rollback');
    const existing = await importCsv(
      collection,
      new Blob(['Name\nExisting']),
      'existing',
      'Existing'
    );
    const original = collection.createDoc.bind(collection);
    let calls = 0;
    vi.spyOn(collection, 'createDoc').mockImplementation(id => {
      if (++calls === 2) throw new Error('Publication failed');
      return original(id);
    });
    const imported = await archive([
      ['One.csv', 'Name\nOne'],
      ['Two.csv', 'Name\nTwo'],
    ]);
    await expect(
      NotionHtmlTransformer.importNotionZip({
        ...options(collection, imported),
        importCsv,
      })
    ).rejects.toThrow('Publication failed');
    expect([...collection.docs.keys()]).toEqual(['existing']);
    expect((existing.root as RootBlockModel).props.title.toString()).toBe(
      'Existing'
    );
  });
});
