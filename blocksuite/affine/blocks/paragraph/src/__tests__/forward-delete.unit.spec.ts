import {
  ColumnBlockSchemaExtension,
  ColumnsBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { insertColumns } from '@blocksuite/affine-shared/utils';
import type { BlockStdScope } from '@blocksuite/std';
import { type Store, Text } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { expect, test } from 'vitest';

import { forwardDelete } from '../utils/forward-delete.js';

function createStore() {
  const collection = new TestWorkspace();
  collection.storeExtensions = [
    RootBlockSchemaExtension,
    NoteBlockSchemaExtension,
    ParagraphBlockSchemaExtension,
    ColumnsBlockSchemaExtension,
    ColumnBlockSchemaExtension,
  ];
  collection.meta.initialize();
  const doc = collection.createDoc('doc:paragraph');
  doc.load();
  const store = doc.getStore({ id: 'doc:paragraph' });
  const rootId = store.addBlock('affine:page', { title: new Text('') });
  const noteId = store.addBlock('affine:note', {}, rootId);
  return { store, noteId };
}

function stdWithCursorAtEnd(store: Store, blockId: string) {
  const index = store.getModelById(blockId)!.text!.length;
  return {
    store,
    host: { std: { get: () => ({ getEditorMode: () => 'page' }) } },
    selection: {
      find: () => ({ isCollapsed: () => true, from: { blockId, index } }),
    },
  } as unknown as BlockStdScope;
}

function twoColumns() {
  const { store, noteId } = createStore();
  const { paragraphIds } = insertColumns(store, noteId, 0, 2);
  const [left, right] = paragraphIds.map(id => store.getModelById(id)!);
  left.text!.insert('left', 0);
  right.text!.insert('right', 0);
  return { store, left, right };
}

test('Delete at the end of a column keeps the next column intact', () => {
  const { store, left, right } = twoColumns();
  expect(forwardDelete(stdWithCursorAtEnd(store, left.id))).toBe(true);
  expect(left.text!.toString()).toBe('left');
  expect(right.text!.toString()).toBe('right');
});

test('Delete merges a paragraph with its own child inside a column', () => {
  const { store, left, right } = twoColumns();
  const childId = store.addBlock(
    'affine:paragraph',
    { text: new Text('child') },
    left
  );
  expect(forwardDelete(stdWithCursorAtEnd(store, left.id))).toBe(true);
  expect(left.text!.toString()).toBe('leftchild');
  expect(store.getModelById(childId)).toBeNull();
  expect(right.text!.toString()).toBe('right');
});
