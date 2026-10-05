/** @vitest-environment happy-dom */
import type { ParagraphBlockModel } from '@blocksuite/affine/model';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import {
  type DeltaInsert,
  Text,
  type Workspace,
} from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import { importFiles, stageContentImport } from './staged-import';

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

function createPage(workspace: Workspace, id: string, title: string) {
  const doc = workspace.createDoc(id);
  doc.load();
  const store = doc.getStore();
  const pageId = store.addBlock('affine:page', { title: new Text(title) });
  const noteId = store.addBlock('affine:note', {}, pageId);
  return { store, noteId };
}

function trackStaging(workspace: WorkspaceImpl) {
  const create = workspace.createStagingWorkspace.bind(workspace);
  let disposed: ReturnType<typeof vi.spyOn> | undefined;
  let destroyed: ReturnType<typeof vi.spyOn> | undefined;
  vi.spyOn(workspace, 'createStagingWorkspace').mockImplementation(() => {
    const staging = create();
    disposed = vi.spyOn(staging, 'dispose');
    destroyed = vi.spyOn(staging.doc, 'destroy');
    return staging;
  });
  return () => {
    expect(disposed).toHaveBeenCalledOnce();
    expect(destroyed).toHaveBeenCalledOnce();
  };
}

describe('staged content import', () => {
  test('publishes complete pages, attachment bytes and forward links together', async () => {
    const destination = createWorkspace('content-import-success');
    createPage(destination, 'existing', 'Existing notes');
    const expectDisposed = trackStaging(destination);
    const result = {
      docIds: ['first', 'second'],
      entryId: 'first',
      warnings: ['A preserved report'],
    };
    const published = await stageContentImport(destination, async staging => {
      const first = createPage(staging, 'first', 'First imported page');
      const second = createPage(staging, 'second', 'Second imported page');
      await staging.blobSync.set(
        'imported-blob',
        new Blob(['Imported attachment'], { type: 'text/plain' })
      );
      first.store.addBlock(
        'affine:attachment',
        { sourceId: 'imported-blob', name: 'notes.txt' },
        first.noteId
      );
      first.store.addBlock(
        'affine:paragraph',
        {
          text: new Text([
            {
              insert: ' ',
              attributes: {
                reference: { type: 'LinkedPage', pageId: second.store.id },
              },
            },
          ] as DeltaInsert<AffineTextAttributes>[]),
        },
        first.noteId
      );
      expect(destination.docs.size).toBe(1);
      expect(await destination.blobSync.get('imported-blob')).toBeNull();
      return result;
    });

    expect(published).toBe(result);
    expect([...destination.docs.keys()]).toEqual([
      'existing',
      'first',
      'second',
    ]);
    expect(destination.meta.getDocMeta('first')?.title).toBe(
      'First imported page'
    );
    expect(destination.meta.getDocMeta('second')?.title).toBe(
      'Second imported page'
    );
    expect(
      await (await destination.blobSync.get('imported-blob'))?.text()
    ).toBe('Imported attachment');
    const first = destination.getDoc('first')!.getStore();
    const linkedParagraph = first.getBlocksByFlavour('affine:paragraph')[0]
      .model as ParagraphBlockModel;
    expect(
      linkedParagraph.props.text.toDelta()[0].attributes?.reference
    ).toEqual({
      type: 'LinkedPage',
      pageId: 'second',
    });
    expect(destination.getDoc('second')!.getStore().root).not.toBeNull();
    expectDisposed();
  });

  test('a second page preparation failure leaves existing documents and assets unchanged', async () => {
    const destination = createWorkspace('content-import-preparation-failure');
    createPage(destination, 'existing', 'Existing notes');
    await destination.blobSync.set(
      'existing-blob',
      new Blob(['Existing bytes'])
    );
    const create = vi.spyOn(destination, 'createDoc');
    const setBlob = vi.spyOn(destination.blobSync, 'set');
    const expectDisposed = trackStaging(destination);
    const failure = new Error('The second page could not be parsed');

    await expect(
      stageContentImport(destination, async staging => {
        createPage(staging, 'first', 'First page');
        await staging.blobSync.set(
          'imported-blob',
          new Blob(['Incoming bytes'])
        );
        createPage(staging, 'second', 'Incomplete second page');
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
    expect([...destination.docs.keys()]).toEqual(['existing']);
    expect(destination.meta.getDocMeta('existing')?.title).toBe(
      'Existing notes'
    );
    expect(
      await (await destination.blobSync.get('existing-blob'))?.text()
    ).toBe('Existing bytes');
    expect(await destination.blobSync.get('imported-blob')).toBeNull();
    expectDisposed();
  });

  test('an adapter returning undefined for a later file rejects the complete staged import', async () => {
    const destination = createWorkspace('content-import-swallowed-failure');
    createPage(destination, 'existing', 'Existing notes');
    const create = vi.spyOn(destination, 'createDoc');
    const setBlob = vi.spyOn(destination.blobSync, 'set');
    const expectDisposed = trackStaging(destination);
    const files = [
      new File(['valid'], 'first.md'),
      new File(['broken'], 'broken.docx'),
    ];

    await expect(
      stageContentImport(destination, async staging => ({
        docIds: await importFiles(files, async file => {
          if (file.name === 'broken.docx') return undefined;
          const first = createPage(staging, 'first', 'First page');
          await staging.blobSync.set(
            'imported-blob',
            new Blob(['Incoming bytes'])
          );
          first.store.addBlock(
            'affine:attachment',
            { sourceId: 'imported-blob', name: 'notes.txt' },
            first.noteId
          );
          return first.store.id;
        }),
      }))
    ).rejects.toThrow('"broken.docx" could not be imported');

    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
    expect([...destination.docs.keys()]).toEqual(['existing']);
    expect(destination.meta.getDocMeta('existing')?.title).toBe(
      'Existing notes'
    );
    expect(await destination.blobSync.get('imported-blob')).toBeNull();
    expectDisposed();
  });

  test('all undefined conversions report failure instead of an empty import success', async () => {
    const destination = createWorkspace('content-import-no-conversions');
    const expectDisposed = trackStaging(destination);
    const convert = vi.fn(async () => undefined);
    const files = [
      new File(['broken'], 'first.docx'),
      new File(['broken'], 'second.docx'),
    ];

    await expect(
      stageContentImport(destination, async () => ({
        docIds: await importFiles(files, convert),
      }))
    ).rejects.toThrow('"first.docx" could not be imported');
    expect(convert).toHaveBeenCalledOnce();
    expect(destination.docs.size).toBe(0);
    expectDisposed();
  });

  test('archives without supported documents fail before publication', async () => {
    const destination = createWorkspace('content-import-empty-archive');
    const create = vi.spyOn(destination, 'createDoc');
    const setBlob = vi.spyOn(destination.blobSync, 'set');
    const expectDisposed = trackStaging(destination);

    await expect(
      stageContentImport(destination, async staging => {
        await staging.blobSync.set('orphan-blob', new Blob(['Unused asset']));
        return { docIds: [] };
      })
    ).rejects.toThrow('contains no supported documents');
    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
    expect(await destination.blobSync.get('orphan-blob')).toBeNull();
    expectDisposed();
  });

  test('successful file conversions retain their input order', async () => {
    const destination = createWorkspace('content-import-file-order');
    const files = [
      new File(['first'], 'first.md'),
      new File(['second'], 'second.md'),
    ];
    const result = await stageContentImport(destination, async staging => ({
      docIds: await importFiles(
        files,
        async file => createPage(staging, file.name, file.name).store.id
      ),
    }));
    expect(result.docIds).toEqual(['first.md', 'second.md']);
    expect([...destination.docs.keys()]).toEqual(result.docIds);
  });

  test('cancellation while preparing prevents publication and releases the staging workspace', async () => {
    const destination = createWorkspace('content-import-cancelled');
    createPage(destination, 'existing', 'Existing notes');
    const create = vi.spyOn(destination, 'createDoc');
    const setBlob = vi.spyOn(destination.blobSync, 'set');
    const expectDisposed = trackStaging(destination);
    const controller = new AbortController();
    let prepared!: () => void;
    const preparationStarted = new Promise<void>(resolve => {
      prepared = resolve;
    });
    let finish!: () => void;
    const finishPreparation = new Promise<void>(resolve => {
      finish = resolve;
    });
    const importing = stageContentImport(
      destination,
      async staging => {
        createPage(staging, 'first', 'First page');
        await staging.blobSync.set(
          'imported-blob',
          new Blob(['Incoming bytes'])
        );
        prepared();
        await finishPreparation;
        return { docIds: ['first'] };
      },
      controller.signal
    );
    await preparationStarted;
    const reason = new Error('Import cancelled');
    controller.abort(reason);
    finish();
    await expect(importing).rejects.toBe(reason);

    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
    expect([...destination.docs.keys()]).toEqual(['existing']);
    expect(await destination.blobSync.get('imported-blob')).toBeNull();
    expectDisposed();
  });

  test('missing attachments fail validation before live storage changes', async () => {
    const destination = createWorkspace('content-import-missing-asset');
    const create = vi.spyOn(destination, 'createDoc');
    const setBlob = vi.spyOn(destination.blobSync, 'set');
    const expectDisposed = trackStaging(destination);
    await expect(
      stageContentImport(destination, async staging => {
        const page = createPage(staging, 'first', 'Missing attachment');
        page.store.addBlock(
          'affine:attachment',
          { sourceId: 'missing-blob', name: 'missing.txt' },
          page.noteId
        );
        return { docIds: ['first'] };
      })
    ).rejects.toThrow('missing a required attachment');
    expect(create).not.toHaveBeenCalled();
    expect(setBlob).not.toHaveBeenCalled();
    expect(destination.docs.size).toBe(0);
    expectDisposed();
  });

  test('a previously cancelled import does not start preparation', async () => {
    const destination = createWorkspace('content-import-already-cancelled');
    const factory = vi.spyOn(destination, 'createStagingWorkspace');
    const prepare = vi.fn(async () => ({ docIds: [] }));
    const controller = new AbortController();
    const reason = new Error('Import cancelled');
    controller.abort(reason);
    await expect(
      stageContentImport(destination, prepare, controller.signal)
    ).rejects.toBe(reason);
    expect(factory).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('a workspace without detached staging rejects instead of importing live', async () => {
    const destination: Workspace = createWorkspace('unsupported-staging');
    destination.createStagingWorkspace = undefined;
    const prepare = vi.fn(async () => ({ docIds: [] }));
    await expect(stageContentImport(destination, prepare)).rejects.toThrow(
      'cannot stage a content import safely'
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(destination.docs.size).toBe(0);
  });
});
