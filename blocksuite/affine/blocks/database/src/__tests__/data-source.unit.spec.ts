import type { DatabaseBlockModel } from '@blocksuite/affine-model';
import {
  DatabaseBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { replaceIdMiddleware } from '@blocksuite/affine-shared/adapters';
import type { TableViewData } from '@blocksuite/data-view/view-presets';
import { Slice, Text, type Workspace } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { afterEach, describe, expect, test, vi } from 'vitest';

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
  test('waits for chained cross-page rollups and releases descendant targets when their source relation disappears', async () => {
    const { workspace, database } = setup();
    const targetDatabase = (docId: string) => {
      const doc = workspace.createDoc(docId);
      doc.load();
      const store = doc.getStore();
      const page = store.addBlock('affine:page');
      const note = store.addBlock('affine:note', {}, page);
      const id = store.addBlock('affine:database', {}, note);
      const model = store.getModelById<DatabaseBlockModel>(id)!;
      const source = new DatabaseBlockDataSource(model);
      return { doc, source, model, row: source.rowAdd('end') };
    };
    const leaf = targetDatabase('leaf');
    const number = leaf.source.propertyAdd('end', { type: 'number' })!;
    leaf.source.cellValueChange(leaf.row, number, 8);
    const middle = targetDatabase('middle');
    const relation = middle.source.propertyAdd('end', { type: 'relation' })!;
    middle.source.propertyDataSet(relation, {
      targetDocId: leaf.doc.id,
      targetDatabaseId: leaf.model.id,
    });
    middle.source.cellValueChange(middle.row, relation, [leaf.row]);
    const rollup = middle.source.propertyAdd('end', { type: 'rollup' })!;
    middle.source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: number,
      operation: 'sum',
    });
    const { source } = database();
    const row = source.rowAdd('end');
    const outerRelation = source.propertyAdd('end', { type: 'relation' })!;
    source.propertyDataSet(outerRelation, {
      targetDocId: middle.doc.id,
      targetDatabaseId: middle.model.id,
    });
    source.cellValueChange(row, outerRelation, [middle.row]);
    const outerRollup = source.propertyAdd('end', { type: 'rollup' })!;
    source.propertyDataSet(outerRollup, {
      relationColumnId: outerRelation,
      targetColumnId: rollup,
      operation: 'sum',
    });
    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    const finish = new Map<string, () => void>();
    (workspace as Workspace).acquireDoc = id => {
      const release = vi.fn();
      releases.set(id, release);
      const ready = new Promise<void>(resolve => {
        finish.set(id, resolve);
      });
      return { ready, release };
    };
    const targets = source.acquireRelationTargets();
    const value = source.cellValueGet$(row, outerRollup);
    expect(value.value).toEqual({ error: 'Related database is loading' });
    finish.get('middle')!();
    await vi.waitFor(() => expect(finish.has('leaf')).toBe(true));
    expect(value.value).toEqual({ error: 'Related database is loading' });
    finish.get('leaf')!();
    await targets.ready;
    expect(value.value).toBe(8);
    const targetView = source.relationTarget({
      targetDocId: middle.doc.id,
      targetDatabaseId: middle.model.id,
    })!;
    expect(targetView.readonly$.value).toBe(true);
    targetView.cellValueChange(middle.row, relation, []);
    expect(middle.source.cellValueGet(middle.row, relation)).toEqual([
      leaf.row,
    ]);
    leaf.source.cellValueChange(leaf.row, number, 12);
    expect(source.cellValueGet(row, outerRollup)).toBe(12);
    expect(value.value).toBe(12);
    middle.source.propertyDelete(relation);
    expect(value.value).toEqual({ error: 'Relation property is missing' });
    expect(releases.get('leaf')).toHaveBeenCalledOnce();
    targets.release();
    expect(releases.get('middle')).toHaveBeenCalledOnce();
  });

  test('retains targets for concurrent editor/export readers and releases/reacquires on final close before loading finishes', async () => {
    const { workspace, database } = setup();
    const target = workspace.createDoc('pending-target');
    const releases: ReturnType<typeof vi.fn>[] = [];
    const finishes: (() => void)[] = [];
    const acquire = vi.fn(() => {
      const release = vi.fn();
      releases.push(release);
      const ready = new Promise<void>(resolve => {
        finishes.push(resolve);
      });
      return { ready, release };
    });
    (workspace as Workspace).acquireDoc = acquire;
    const { model, source } = database();
    const relation = source.propertyAdd('end', { type: 'relation' })!;
    source.propertyDataSet(relation, {
      targetDocId: target.id,
      targetDatabaseId: 'db',
    });
    const first = source.acquireRelationTargets();
    const second = new DatabaseBlockDataSource(model).acquireRelationTargets();
    expect(acquire).toHaveBeenCalledTimes(1);
    first.release();
    expect(releases[0]).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(releases[0]).toHaveBeenCalledOnce();
    await Promise.all([first.ready, second.ready]);
    finishes[0]!();
    await Promise.resolve();
    expect(acquire).toHaveBeenCalledTimes(1);
    const reopened = source.acquireRelationTargets();
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(
      source.relationTargetStatus({
        targetDocId: target.id,
        targetDatabaseId: 'db',
      })
    ).toBe('loading');
    reopened.release();
    await reopened.ready;
    expect(releases[1]).toHaveBeenCalledOnce();
  });

  test('loads a closed target through the local lease, observes edits and releases retargeted/deleted columns', async () => {
    const { workspace, database } = setup();
    const targetDoc = workspace.createDoc('closed-target');
    let finish!: () => void;
    const ready = new Promise<void>(resolve => {
      finish = resolve;
    });
    const release = vi.fn();
    const acquire = vi.fn(() => ({ ready, release }));
    (workspace as Workspace).acquireDoc = acquire;
    const { source } = database();
    const row = source.rowAdd('end');
    const relation = source.propertyAdd('end', { type: 'relation' })!;
    source.propertyDataSet(relation, {
      targetDocId: targetDoc.id,
      targetDatabaseId: 'external-db',
    });
    source.cellValueChange(row, relation, ['external-row']);
    const rollup = source.propertyAdd('end', { type: 'rollup' })!;
    source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: '',
      operation: 'count',
    });
    const value = source.cellValueGet$(row, rollup);
    const targets = source.acquireRelationTargets();
    expect(value.value).toEqual({ error: 'Related database is loading' });
    expect(acquire).toHaveBeenCalledExactlyOnceWith(targetDoc.id);
    expect(source.relationOptions(relation)).toBeUndefined();
    targetDoc.load();
    const targetStore = targetDoc.getStore();
    const page = targetStore.addBlock('affine:page');
    const note = targetStore.addBlock('affine:note', {}, page);
    const id = targetStore.addBlock(
      'affine:database',
      { id: 'external-db' },
      note
    );
    targetStore.addBlock(
      'affine:paragraph',
      { id: 'external-row', text: new Text('Loaded row') },
      id
    );
    expect(value.value).toEqual({ error: 'Related database is loading' });
    finish();
    await targets.ready;
    expect(value.value).toBe(1);
    expect(source.relationOptions(relation)).toEqual([
      { id: 'external-row', title: 'Loaded row' },
    ]);
    (targetStore.getModelById('external-row')!.text as Text).insert(
      ' edited',
      10
    );
    expect(source.relationOptions(relation)?.[0]?.title).toBe(
      'Loaded row edited'
    );
    source.propertyDataSet(relation, {
      targetDocId: 'missing-target',
      targetDatabaseId: 'external-db',
    });
    expect(value.value).toEqual({ error: 'Related database is unavailable' });
    expect(release).toHaveBeenCalledTimes(1);
    source.propertyDataSet(relation, {
      targetDocId: targetDoc.id,
      targetDatabaseId: id,
    });
    await source.waitForRelationTargets();
    expect(value.value).toBe(1);
    source.propertyDelete(relation);
    expect(release).toHaveBeenCalledTimes(2);
  });

  test('failed target loading stays unavailable even with an empty relation; store disposal releases it', async () => {
    const { workspace, store, database } = setup();
    const targetDoc = workspace.createDoc('cannot-load');
    const release = vi.fn();
    (workspace as Workspace).acquireDoc = () => ({
      ready: Promise.reject(new Error('local read failed')),
      release,
    });
    const { source } = database();
    const row = source.rowAdd('end');
    const relation = source.propertyAdd('end', { type: 'relation' })!;
    source.propertyDataSet(relation, {
      targetDocId: targetDoc.id,
      targetDatabaseId: 'db',
    });
    const rollup = source.propertyAdd('end', { type: 'rollup' })!;
    source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: '',
      operation: 'count',
    });
    const value = source.cellValueGet$(row, rollup);
    const targets = source.acquireRelationTargets();
    expect(value.value).toEqual({ error: 'Related database is loading' });
    await targets.ready;
    expect(value.value).toEqual({ error: 'Related database is unavailable' });
    store.dispose();
    expect(release).toHaveBeenCalledOnce();
  });

  test('list rollups use selected choice labels and support reactive sorting, filters and readonly readable conversion', () => {
    const { store, database } = setup();
    const target = database();
    const first = target.source.rowAdd('end');
    const second = target.source.rowAdd('end');
    const choice = target.source.propertyAdd('end', { type: 'multi-select' })!;
    target.source.propertyDataSet(choice, {
      options: [
        { id: 'z', value: 'Zulu', color: 'red' },
        { id: 'a', value: 'Alpha', color: 'blue' },
      ],
    });
    target.source.cellValueChange(first, choice, ['z', 'a']);
    target.source.cellValueChange(second, choice, ['a']);
    const { source, model } = database();
    const row = source.rowAdd('end');
    const empty = source.rowAdd('end');
    const alpha = source.rowAdd('end');
    const relation = source.propertyAdd('end', { type: 'relation' })!;
    source.propertyDataSet(relation, {
      targetDocId: store.doc.id,
      targetDatabaseId: target.model.id,
    });
    source.cellValueChange(row, relation, [first, second]);
    source.cellValueChange(alpha, relation, [second]);
    const rollup = source.propertyAdd('end', { type: 'rollup' })!;
    source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: choice,
      operation: 'values',
    });
    const value = source.cellValueGet$(row, rollup);
    expect(value.value).toEqual(['Zulu', 'Alpha', 'Alpha']);
    source.propertyDataSet(rollup, {
      relationColumnId: relation,
      targetColumnId: choice,
      operation: 'unique',
    });
    expect(value.value).toEqual(['Zulu', 'Alpha']);
    expect(source.cellValueGet(empty, rollup)).toEqual([]);
    const view = source.viewManager.viewGet(
      source.viewManager.viewAdd('table')
    )!;
    source.viewDataUpdate<TableViewData>(view.id, () => ({
      sort: {
        sortBy: [{ ref: { type: 'ref', name: rollup }, desc: false }],
        manuallySort: [],
      },
    }));
    expect(view.rows$.value.map(row => row.rowId)).toEqual([alpha, row, empty]);
    source.viewDataUpdate<TableViewData>(view.id, () => ({
      filter: {
        type: 'group',
        op: 'and',
        conditions: [
          {
            type: 'filter',
            left: { type: 'ref', name: rollup },
            function: 'containsValue',
            args: [{ type: 'literal', value: 'Zulu' }],
          },
        ],
      },
    }));
    expect(view.rows$.value.map(row => row.rowId)).toEqual([row]);
    target.source.cellValueChange(first, choice, ['a']);
    expect(value.value).toEqual(['Alpha']);
    expect(view.rows$.value).toEqual([]);
    const meta = source.propertyMetaGet('rollup')!;
    expect(
      meta.config.rawValue.toString({
        value: value.value,
        data: source.propertyDataGet(rollup),
      })
    ).toBe('Alpha');
    source.cellValueChange(row, rollup, ['replacement']);
    expect(model.props.cells[row]?.[rollup]).toBeUndefined();
  });
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
    const list = tasks.source.propertyAdd('end', {
      type: 'rollup',
      name: 'Selected values',
    })!;
    tasks.source.propertyDataSet(list, {
      relationColumnId: relation,
      targetColumnId: formula,
      operation: 'unique',
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
    const listColumn = related.props.columns.find(
      column => column.data.operation === 'unique'
    )!;
    expect(listColumn.data.relationColumnId).toBe(relationColumn.id);
    expect(listColumn.data.targetColumnId).toBe(
      target.props.columns.find(column => column.type === 'formula')!.id
    );
    expect(
      relatedSource.cellValueGet(related.children[0]!.id, listColumn.id)
    ).toEqual(['6']);

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
