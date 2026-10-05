import {
  DatabaseBlockModel,
  DatabaseBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { replaceIdMiddleware } from '@blocksuite/affine-shared/adapters';
import { Slice, Text } from '@blocksuite/store';
import type { TableViewData } from '@blocksuite/data-view/view-presets';
import { TestWorkspace } from '@blocksuite/store/test';
import { afterEach, describe, expect, test } from 'vitest';

import { DatabaseBlockDataSource } from '../data-source.js';

const workspaces: TestWorkspace[] = [];
function setup(id = 'source-doc') {
  const workspace = new TestWorkspace();
  workspace.storeExtensions = [
    RootBlockSchemaExtension,
    NoteBlockSchemaExtension,
    ParagraphBlockSchemaExtension,
    DatabaseBlockSchemaExtension,
  ];
  workspace.meta.initialize();
  workspaces.push(workspace);
  const doc = workspace.createDoc(id);
  doc.load();
  const store = doc.getStore();
  const page = store.addBlock('affine:page', {
    title: new Text('Database test'),
  });
  const note = store.addBlock('affine:note', {}, page);
  const database = () => {
    const id = store.addBlock('affine:database', {}, note);
    const model = store.getModelById<DatabaseBlockModel>(id)!;
    return { model, source: new DatabaseBlockDataSource(model) };
  };
  return { workspace, store, database };
}
afterEach(() => workspaces.splice(0).forEach(workspace => workspace.dispose()));

describe('derived values in the real local database model', () => {
  test('formula tracks edits and renames, and computed writes are rejected', () => {
    const { database } = setup();
    const { model, source } = database();
    const row = source.rowAdd('end');
    const number = source.propertyAdd('end', {
      type: 'number',
      name: 'Price',
    })!;
    const formula = source.propertyAdd('end', {
      type: 'formula',
      name: 'Total',
    })!;
    source.propertyDataSet(formula, {
      expression: `prop(${JSON.stringify(number)}) * 2`,
      resultType: 'number',
    });
    source.cellValueChange(row, number, 4);
    const computed = source.cellValueGet$(row, formula);
    expect(computed.value).toBe(8);
    source.propertyNameSet(number, 'Renamed price');
    source.cellValueChange(row, number, 6);
    expect(computed.value).toBe(12);
    expect(source.propertyReadonlyGet(formula)).toBe(true);
    source.cellValueChange(row, formula, 999);
    expect(source.cellValueGet(row, formula)).toBe(12);
    expect(model.props.cells[row]?.[formula]).toBeUndefined();
    source.propertyDataSet(formula, {
      expression: `prop(${JSON.stringify(formula)})`,
      resultType: 'number',
    });
    expect(computed.value).toEqual({ error: 'Circular property reference' });
  });

  test('formula observes text edits and participates in numeric sorting and filtering', () => {
    const { database } = setup();
    const { source } = database();
    const first = source.rowAdd('end');
    const second = source.rowAdd('end');
    const text = source.propertyAdd('end', { type: 'rich-text' })!;
    const formula = source.propertyAdd('end', { type: 'formula' })!;
    source.propertyDataSet(formula, {
      expression: `length(prop(${JSON.stringify(text)}))`,
      resultType: 'number',
    });
    source.cellValueChange(first, text, new Text('long'));
    source.cellValueChange(second, text, new Text('a'));
    const value = source.cellValueGet$(second, formula);
    expect(value.value).toBe(1);
    (source.cellValueGet(second, text) as Text).insert('bc', 1);
    expect(value.value).toBe(3);
    const view = source.viewManager.viewGet(
      source.viewManager.viewAdd('table')
    )!;
    source.viewDataUpdate<TableViewData>(view.id, () => ({
      sort: {
        sortBy: [{ ref: { type: 'ref', name: formula }, desc: false }],
        manuallySort: [],
      },
    }));
    expect(view.rows$.value.map(row => row.rowId)).toEqual([second, first]);
    source.viewDataUpdate<TableViewData>(view.id, () => ({
      filter: {
        type: 'group',
        op: 'and',
        conditions: [
          {
            type: 'filter',
            left: { type: 'ref', name: formula },
            function: 'greatThan',
            args: [{ type: 'literal', value: 3 }],
          },
        ],
      },
    }));
    expect(view.rows$.value.map(row => row.rowId)).toEqual([first]);
  });

  test('rollups track related rows, keep deleted IDs, and distinguish unavailable from empty', () => {
    const { store, database } = setup();
    const projects = database();
    const tasks = database();
    const project = projects.source.rowAdd('end');
    const amount = projects.source.propertyAdd('end', { type: 'number' })!;
    projects.source.cellValueChange(project, amount, 5);
    const task = tasks.source.rowAdd('end');
    const relation = tasks.source.propertyAdd('end', { type: 'relation' })!;
    tasks.source.propertyDataSet(relation, {
      targetDocId: store.doc.id,
      targetDatabaseId: projects.model.id,
    });
    tasks.source.cellValueChange(task, relation, [project, project]);
    expect(tasks.source.cellValueGet(task, relation)).toEqual([project]);
    const rollup = tasks.source.propertyAdd('end', { type: 'rollup' })!;
    tasks.source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: amount,
      operation: 'sum',
    });
    const value = tasks.source.cellValueGet$(task, rollup);
    expect(value.value).toBe(5);
    projects.source.cellValueChange(project, amount, 7);
    expect(value.value).toBe(7);
    projects.source.rowDelete([project]);
    expect(tasks.source.cellValueGet(task, relation)).toEqual([project]);
    expect(value.value).toEqual({ error: 'Related row is missing' });
    tasks.source.cellValueChange(task, relation, []);
    expect(value.value).toBe(0);
    store.deleteBlock(projects.model);
    expect(value.value).toHaveProperty('error');
  });

  test('native page duplication remaps relation targets, row and formula references', async () => {
    const { workspace, store, database } = setup();
    const projects = database();
    const tasks = database();
    const project = projects.source.rowAdd('end');
    const number = projects.source.propertyAdd('end', { type: 'number' })!;
    projects.source.cellValueChange(project, number, 3);
    const formula = projects.source.propertyAdd('end', { type: 'formula' })!;
    projects.source.propertyDataSet(formula, {
      expression: `prop(${JSON.stringify(number)}) * 2`,
      resultType: 'number',
    });
    const task = tasks.source.rowAdd('end');
    const relation = tasks.source.propertyAdd('end', { type: 'relation' })!;
    tasks.source.propertyDataSet(relation, {
      targetDocId: store.doc.id,
      targetDatabaseId: projects.model.id,
    });
    tasks.source.cellValueChange(task, relation, [project]);
    const rollup = tasks.source.propertyAdd('end', { type: 'rollup' })!;
    tasks.source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: formula,
      operation: 'sum',
    });
    const snapshot = store.getTransformer().docToSnapshot(store)!;
    const transformer = store.getTransformer([
      replaceIdMiddleware(workspace.idGenerator),
    ]);
    const copy = (await transformer.snapshotToDoc(snapshot))!;
    expect(copy).toBeDefined();
    const databases = Object.values(copy.blocks.value)
      .filter(block => block.model.flavour === 'affine:database')
      .map(block => block.model as DatabaseBlockModel);
    const target = databases.find(model =>
      model.props.columns.some(column => column.type === 'number')
    )!;
    const related = databases.find(model =>
      model.props.columns.some(column => column.type === 'relation')
    )!;
    const relatedSource = new DatabaseBlockDataSource(related);
    const relationColumn = related.props.columns.find(
      column => column.type === 'relation'
    )!;
    expect(relationColumn.data).toEqual({
      targetDocId: copy.doc.id,
      targetDatabaseId: target.id,
    });
    expect(
      relatedSource.cellValueGet(related.children[0]!.id, relationColumn.id)
    ).toEqual([target.children[0]!.id]);
    const rollupColumn = related.props.columns.find(
      column => column.type === 'rollup'
    )!;
    expect(
      relatedSource.cellValueGet(related.children[0]!.id, rollupColumn.id)
    ).toBe(6);

    // Template duplication imports slices into an existing page, without page beforeImport.
    const destination = workspace.createDoc('template-copy');
    destination.load();
    const destinationStore = destination.getStore();
    const root = destinationStore.addBlock('affine:page');
    const note = destinationStore.addBlock('affine:note', {}, root);
    const slice = Slice.fromModels(store, [projects.model, tasks.model]);
    const sliceTransformer = destinationStore.getTransformer([
      replaceIdMiddleware(workspace.idGenerator),
    ]);
    const sliceSnapshot = store.getTransformer().sliceToSnapshot(slice)!;
    await sliceTransformer.snapshotToSlice(
      sliceSnapshot,
      destinationStore,
      note
    );
    const copied = Object.values(destinationStore.blocks.value)
      .map(block => block.model)
      .filter(
        (model): model is DatabaseBlockModel =>
          model.flavour === 'affine:database'
      );
    const copiedTarget = copied.find(model =>
      model.props.columns.some(column => column.type === 'number')
    )!;
    const copiedTasks = copied.find(model =>
      model.props.columns.some(column => column.type === 'relation')
    )!;
    const copiedRelation = copiedTasks.props.columns.find(
      column => column.type === 'relation'
    )!;
    expect(copiedRelation.data).toEqual({
      targetDocId: destination.id,
      targetDatabaseId: copiedTarget.id,
    });
    const copiedSource = new DatabaseBlockDataSource(copiedTasks);
    const copiedRollup = copiedTasks.props.columns.find(
      column => column.type === 'rollup'
    )!;
    expect(
      copiedSource.cellValueGet(copiedTasks.children[0]!.id, copiedRollup.id)
    ).toBe(6);
  });
  test('cross-page access updates when a target is trashed or removed', () => {
    const { workspace, database } = setup();
    const targetDoc = workspace.createDoc('external-projects');
    targetDoc.load();
    const targetStore = targetDoc.getStore();
    const page = targetStore.addBlock('affine:page');
    const note = targetStore.addBlock('affine:note', {}, page);
    const databaseId = targetStore.addBlock('affine:database', {}, note);
    const target = new DatabaseBlockDataSource(
      targetStore.getModelById<DatabaseBlockModel>(databaseId)!
    );
    const targetRow = target.rowAdd('end');
    target.cellValueChange(targetRow, 'title', 'Project name');
    const { source } = database();
    const row = source.rowAdd('end');
    const relation = source.propertyAdd('end', { type: 'relation' })!;
    source.propertyDataSet(relation, {
      targetDocId: targetDoc.id,
      targetDatabaseId: databaseId,
    });
    source.cellValueChange(row, relation, [targetRow]);
    const rollup = source.propertyAdd('end', { type: 'rollup' })!;
    source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: '',
      operation: 'count',
    });
    const value = source.cellValueGet$(row, rollup);
    expect(value.value).toBe(1);
    expect(source.relationOptions(relation)).toEqual([
      { id: targetRow, title: 'Project name' },
    ]);
    workspace.meta.setDocMeta(targetDoc.id, { trash: true });
    expect(value.value).toHaveProperty('error');
    expect(source.relationOptions(relation)).toBeUndefined();
    expect(source.cellValueGet(row, relation)).toEqual([targetRow]);
    workspace.meta.setDocMeta(targetDoc.id, { trash: false });
    expect(value.value).toBe(1);
    workspace.removeDoc(targetDoc.id);
    expect(value.value).toHaveProperty('error');
    expect(source.relationOptions(relation)).toBeUndefined();
  });
});
