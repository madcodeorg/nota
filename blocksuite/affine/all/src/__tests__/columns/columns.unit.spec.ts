import {
  COLUMN_BLOCK_FLAVOUR,
  type ColumnBlockModel,
  COLUMNS_BLOCK_FLAVOUR,
  type ColumnsBlockModel,
} from '@blocksuite/affine-model';
import {
  HtmlAdapter,
  MarkdownAdapter,
  PlainTextAdapter,
} from '@blocksuite/affine-shared/adapters';
import {
  appendColumn,
  getClosestColumn,
  insertColumns,
  removeColumn,
  resizeColumnPair,
  unwrapColumns,
} from '@blocksuite/affine-shared/utils';
import { type BlockModel, type Store, Text } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { beforeEach, describe, expect, test } from 'vitest';

import { createJob } from '../utils/create-job.js';
import { getProvider } from '../utils/get-provider.js';
import { testStoreExtensions } from '../utils/store.js';

const provider = getProvider();

function createStore() {
  const collection = new TestWorkspace();
  collection.storeExtensions = testStoreExtensions;
  collection.meta.initialize();
  const doc = collection.createDoc('doc:columns');
  doc.load();
  const store = doc.getStore({ id: 'doc:columns' });
  const rootId = store.addBlock('affine:page', {
    title: new Text('Columns'),
  });
  store.addBlock('affine:surface', {}, rootId);
  const noteId = store.addBlock('affine:note', {}, rootId);
  return { store, note: store.getModelById(noteId)! };
}

function texts(models: BlockModel[]) {
  return models.map(model => model.text?.toString());
}

function getColumns(store: Store, id: string) {
  return store.getModelById(id) as ColumnsBlockModel;
}

/** before | [A1 A2] [B1] [C1] | after */
function createLayout(store: Store, note: BlockModel) {
  store.addBlock('affine:paragraph', { text: new Text('before') }, note);
  const { columnsId, paragraphIds } = insertColumns(store, note, undefined, 3);
  store.addBlock('affine:paragraph', { text: new Text('after') }, note);
  const columns = getColumns(store, columnsId);
  const [a, b, c] = columns.children as ColumnBlockModel[];
  store.getModelById(paragraphIds[0])!.text!.insert('A1', 0);
  store.addBlock('affine:paragraph', { text: new Text('A2') }, a);
  store.getModelById(paragraphIds[1])!.text!.insert('B1', 0);
  store.getModelById(paragraphIds[2])!.text!.insert('C1', 0);
  return { columns, a, b, c };
}

describe('columns schema', () => {
  test('allows content blocks in columns but no nesting', () => {
    const { store } = createStore();
    const valid = (child: string, parent: string) =>
      store.schema.isValid(child, parent);

    expect(valid(COLUMNS_BLOCK_FLAVOUR, 'affine:note')).toBe(true);
    expect(valid(COLUMN_BLOCK_FLAVOUR, COLUMNS_BLOCK_FLAVOUR)).toBe(true);
    for (const flavour of [
      'affine:paragraph',
      'affine:list',
      'affine:code',
      'affine:image',
      'affine:divider',
      'affine:bookmark',
      'affine:attachment',
      'affine:latex',
      'affine:table',
      'affine:callout',
      'affine:embed-youtube',
    ]) {
      expect(valid(flavour, COLUMN_BLOCK_FLAVOUR), flavour).toBe(true);
    }

    expect(valid(COLUMNS_BLOCK_FLAVOUR, COLUMN_BLOCK_FLAVOUR)).toBe(false);
    expect(valid(COLUMN_BLOCK_FLAVOUR, 'affine:note')).toBe(false);
    expect(valid('affine:paragraph', COLUMNS_BLOCK_FLAVOUR)).toBe(false);
    expect(valid('affine:database', COLUMN_BLOCK_FLAVOUR)).toBe(false);
  });
});

describe('columns model helpers', () => {
  let store: Store;
  let note: BlockModel;

  beforeEach(() => {
    ({ store, note } = createStore());
  });

  test('insertColumns creates columns with an empty paragraph each', () => {
    const { columnsId, paragraphIds } = insertColumns(store, note, 0, 3);
    const columns = getColumns(store, columnsId);

    expect(note.children[0]).toBe(columns);
    expect(columns.children.map(c => c.flavour)).toEqual([
      COLUMN_BLOCK_FLAVOUR,
      COLUMN_BLOCK_FLAVOUR,
      COLUMN_BLOCK_FLAVOUR,
    ]);
    expect(
      columns.children.map(c => (c as ColumnBlockModel).props.ratio)
    ).toEqual([1, 1, 1]);
    expect(columns.children.map(c => c.children[0].id)).toEqual(paragraphIds);
    expect(getClosestColumn(store.getModelById(paragraphIds[1]))).toBe(
      columns.children[1]
    );
  });

  test('insertColumns clamps the column count', () => {
    const one = insertColumns(store, note, undefined, 1);
    const many = insertColumns(store, note, undefined, 9);
    expect(getColumns(store, one.columnsId).children).toHaveLength(2);
    expect(getColumns(store, many.columnsId).children).toHaveLength(4);
  });

  test('appendColumn stops at four columns', () => {
    const { columnsId } = insertColumns(store, note, undefined, 3);
    const columns = getColumns(store, columnsId);
    expect(appendColumn(store, columns)).toBeTruthy();
    expect(columns.children).toHaveLength(4);
    expect(appendColumn(store, columns)).toBeNull();
    expect(columns.children).toHaveLength(4);
  });

  test('unwrapColumns keeps content in reading order', () => {
    const { columns } = createLayout(store, note);
    unwrapColumns(store, columns);

    expect(store.getModelById(columns.id)).toBeNull();
    expect(texts(note.children)).toEqual([
      'before',
      'A1',
      'A2',
      'B1',
      'C1',
      'after',
    ]);
  });

  test('removeColumn deletes the column and unwraps a single column', () => {
    const { columns, b, c } = createLayout(store, note);

    removeColumn(store, b);
    expect(columns.children).toHaveLength(2);
    expect(store.getModelById(b.id)).toBeNull();

    removeColumn(store, c);
    expect(store.getModelById(columns.id)).toBeNull();
    expect(texts(note.children)).toEqual(['before', 'A1', 'A2', 'after']);
  });

  test('resizeColumnPair keeps the ratio sum and the minimum width', () => {
    expect(resizeColumnPair([1, 1], [300, 300], 60, 80)).toEqual([1.2, 0.8]);
    expect(resizeColumnPair([1, 1], [300, 300], -1000, 80)).toEqual([
      0.267, 1.733,
    ]);
    expect(resizeColumnPair([2, 1], [400, 200], 1000, 80)).toEqual([2.6, 0.4]);
    expect(resizeColumnPair([1, 1], [0, 0], 10, 80)).toEqual([1, 1]);
  });
});

describe('columns snapshot and adapters', () => {
  test('native snapshot round-trips columns and ratios', async () => {
    const { store, note } = createStore();
    const { columns, a, b } = createLayout(store, note);
    store.updateBlock(a, { ratio: 1.5 });
    store.updateBlock(b, { ratio: 0.5 });

    const job = createJob();
    const snapshot = job.docToSnapshot(store);
    expect(snapshot).toBeTruthy();

    const imported = await createJob().snapshotToDoc(snapshot!);
    expect(imported).toBeTruthy();
    const importedColumns = imported!.getModelById(
      columns.id
    ) as ColumnsBlockModel;
    expect(importedColumns.flavour).toBe(COLUMNS_BLOCK_FLAVOUR);
    expect(
      importedColumns.children.map(c => (c as ColumnBlockModel).props.ratio)
    ).toEqual([1.5, 0.5, 1]);
    expect(importedColumns.children.map(c => texts(c.children))).toEqual([
      ['A1', 'A2'],
      ['B1'],
      ['C1'],
    ]);
  });

  test('markdown and plain text list column content in order', async () => {
    const { store, note } = createStore();
    createLayout(store, note);
    const snapshot = createJob().docToSnapshot(store)!;

    const markdown = await new MarkdownAdapter(
      createJob(),
      provider
    ).fromDocSnapshot({ snapshot });
    expect(markdown.file).toBe(
      '# Columns\n\nbefore\n\nA1\n\nA2\n\nB1\n\nC1\n\nafter\n'
    );

    const plainText = await new PlainTextAdapter(
      createJob(),
      provider
    ).fromDocSnapshot({ snapshot });
    expect(plainText.file).toBe('Columns\n\nbefore\nA1\nA2\nB1\nC1\nafter\n');
  });

  test('html wraps columns in a flex container', async () => {
    const { store, note } = createStore();
    const { a } = createLayout(store, note);
    store.updateBlock(a, { ratio: 2 });
    const snapshot = createJob().docToSnapshot(store)!;

    const html = await new HtmlAdapter(createJob(), provider).fromDocSnapshot({
      snapshot,
    });
    expect(html.file).toContain(
      '<div class="affine-columns-block-container" style="display: flex; flex-wrap: wrap; gap: 24px;">'
    );
    expect(html.file).toContain(
      '<div class="affine-column-block-container" style="flex: 2 1 0; min-width: 160px;">'
    );
    const order = ['before', 'A1', 'A2', 'B1', 'C1', 'after'].map(text =>
      html.file.indexOf(`<p>${text}</p>`)
    );
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});
