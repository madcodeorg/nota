import {
  ColumnBlockSchemaExtension,
  ColumnsBlockSchemaExtension,
  ListBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { insertColumns } from '@blocksuite/affine-shared/utils';
import type { BlockStdScope } from '@blocksuite/std';
import { Text } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { expect, test } from 'vitest';

import { forwardDelete } from '../utils/forward-delete.js';

function createStore() {
  const collection = new TestWorkspace();
  collection.storeExtensions = [
    RootBlockSchemaExtension,
    NoteBlockSchemaExtension,
    ParagraphBlockSchemaExtension,
    ListBlockSchemaExtension,
    ColumnsBlockSchemaExtension,
    ColumnBlockSchemaExtension,
  ];
  collection.meta.initialize();
  const doc = collection.createDoc('doc:list');
  doc.load();
  const store = doc.getStore({ id: 'doc:list' });
  const rootId = store.addBlock('affine:page', { title: new Text('') });
  const noteId = store.addBlock('affine:note', {}, rootId);
  return { store, noteId };
}

function stdWithCursorAtEnd(
  store: ReturnType<typeof createStore>['store'],
  blockId: string
) {
  const index = store.getModelById(blockId)!.text!.length;
  return {
    store,
    selection: {
      find: () => ({ isCollapsed: () => true, from: { blockId, index } }),
    },
    host: { std: { get: () => ({ getEditorMode: () => 'page' }) } },
  } as unknown as BlockStdScope;
}

test('Delete in a nested list item never pulls text out of the next column', () => {
  const { store, noteId } = createStore();
  const { columnsId, paragraphIds } = insertColumns(store, noteId, 0, 2);
  const [leftColumn] = store.getModelById(columnsId)!.children;
  store.deleteBlock(store.getModelById(paragraphIds[0])!);
  const listId = store.addBlock(
    'affine:list',
    { type: 'bulleted', text: new Text('parent') },
    leftColumn
  );
  const nestedId = store.addBlock(
    'affine:list',
    { type: 'bulleted', text: new Text('left') },
    listId
  );
  store.getModelById(paragraphIds[1])!.text!.insert('right', 0);

  expect(forwardDelete(stdWithCursorAtEnd(store, nestedId))).toBe(true);

  expect(store.getModelById(nestedId)!.text!.toString()).toBe('left');
  expect(store.getModelById(paragraphIds[1])!.text!.toString()).toBe('right');
});
