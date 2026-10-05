import { expect, test } from 'vitest';
import { Array as YArray, Doc as YDoc, Map as YMap, Text as YText } from 'yjs';

import { readAllBlocksFromDoc } from '../src';

test('indexes relation usage on existing database rows without reading target content', async () => {
  const doc = new YDoc({ guid: 'tasks-page' });
  const blocks = doc.getMap('blocks');
  const block = (id: string, flavour: string, children: string[] = []) => {
    const model = new YMap();
    model.set('sys:id', id);
    model.set('sys:flavour', flavour);
    model.set('sys:children', YArray.from(children));
    blocks.set(id, model);
    return model;
  };
  block('page', 'affine:page', ['note']).set('prop:title', new YText('Tasks'));
  block('note', 'affine:note', ['tasks']).set('prop:displayMode', 'page');
  const database = block('tasks', 'affine:database', ['task-row']);
  database.set('prop:title', new YText('Tasks'));
  block('task-row', 'affine:paragraph').set('prop:text', new YText('A task'));
  const column = new YMap();
  column.set('id', 'project-relation');
  column.set('type', 'relation');
  column.set('name', 'Project');
  const data = new YMap();
  data.set('targetDocId', 'projects-page');
  data.set('targetDatabaseId', 'projects-database');
  column.set('data', data);
  database.set('prop:columns', YArray.from([column]));
  const cell = new YMap();
  cell.set('columnId', 'project-relation');
  cell.set('value', YArray.from(['project-row', 'project-row', 42, '']));
  const row = new YMap();
  row.set('project-relation', cell);
  const cells = new YMap();
  cells.set('task-row', row);
  database.set('prop:cells', cells);

  const result = await readAllBlocksFromDoc({
    ydoc: doc,
    spaceId: 'local-workspace',
  });
  const indexed = result!.blocks.find(block => block.blockId === 'task-row')!;
  expect(indexed.refDocId).toEqual(['projects-page']);
  expect(indexed.ref).toEqual([
    JSON.stringify({
      docId: 'projects-page',
      blockIds: ['project-row'],
      databaseId: 'projects-database',
    }),
  ]);
  expect(indexed.parentBlockId).toBe('tasks');
  expect(indexed.parentFlavour).toBe('affine:database');
  expect(indexed.additional?.databaseName).toBe('Tasks');
  expect(indexed.markdownPreview).toContain('database');
  expect(result!.summary).toBe('A task');
  // Removing a selected ID removes reverse usage on the next ordinary reindex.
  (cell.get('value') as YArray<unknown>).delete(0, 4);
  const updated = await readAllBlocksFromDoc({
    ydoc: doc,
    spaceId: 'local-workspace',
  });
  expect(
    updated!.blocks.find(block => block.blockId === 'task-row')!.refDocId
  ).toEqual([]);
  doc.destroy();
});
