// @vitest-environment happy-dom
import type {
  ParagraphBlockModel,
  RootBlockModel,
} from '@blocksuite/affine/model';
import { Text } from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { expect, test } from 'vitest';
import { Doc as YDoc, encodeStateAsUpdate } from 'yjs';

import { createLocalHistoryPreview } from './local-history-preview';

test('historical previews remain detached from the current page and workspace metadata', () => {
  const rootDoc = new YDoc();
  const workspace = new WorkspaceImpl({ id: 'history-preview', rootDoc });
  workspace.meta.initialize();
  const doc = workspace.createDoc('page');
  doc.load();
  const store = doc.getStore();
  const rootId = store.addBlock('affine:page', {
    title: new Text('Older title'),
  });
  const noteId = store.addBlock('affine:note', {}, rootId);
  const paragraphId = store.addBlock(
    'affine:paragraph',
    { text: new Text('Older content') },
    noteId
  );
  const historical = encodeStateAsUpdate(doc.spaceDoc);
  store.updateBlock(store.getModelById(rootId)!, {
    title: new Text('Current title'),
  });
  store.updateBlock(store.getModelById(paragraphId)!, {
    text: new Text('Current content'),
  });
  workspace.meta.setDocMeta(doc.id, { title: 'Current title' });
  const canonical = encodeStateAsUpdate(doc.spaceDoc);
  const metadata = encodeStateAsUpdate(rootDoc);

  const preview = createLocalHistoryPreview(workspace, doc.id, historical);
  try {
    expect(preview.store.readonly).toBe(true);
    expect((preview.store.root as RootBlockModel)?.props.title.toString()).toBe(
      'Older title'
    );
    expect(
      (
        preview.store.getModelById(paragraphId) as ParagraphBlockModel
      )?.props.text.toString()
    ).toBe('Older content');
    expect(encodeStateAsUpdate(doc.spaceDoc)).toEqual(canonical);
    expect(encodeStateAsUpdate(rootDoc)).toEqual(metadata);
  } finally {
    preview.dispose();
    expect(encodeStateAsUpdate(doc.spaceDoc)).toEqual(canonical);
    workspace.dispose();
    rootDoc.destroy();
  }
});
