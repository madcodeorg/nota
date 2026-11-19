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

import { processTable } from '../adapters/utils.js';
import { DatabaseBlockDataSource } from '../data-source.js';
import {
  evaluateFormulaPreview,
  FormulaEditor,
} from '../properties/computed/formula-editor.js';

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

  test('workspace-wide relation discovery keeps synchronous loaded scan and safely discovers unloaded docs', async () => {
    const { workspace, database } = setup();
    const { model: loadedDb, source } = database();
    loadedDb.props.title.insert('Loaded DB', 0);

    // Prepare an unloaded doc containing a database by creating blocks before simulating unload.
    const unloadedWithDb = workspace.createDoc('unloaded-with-db');
    unloadedWithDb.load();
    const unloadedStore = unloadedWithDb.getStore();
    const p1 = unloadedStore.addBlock('affine:page', {
      title: new Text('Remote Page'),
    });
    const n1 = unloadedStore.addBlock('affine:note', {}, p1);
    const remoteDbId = unloadedStore.addBlock(
      'affine:database',
      { title: new Text('Projects') },
      n1
    );
    let remoteReady = false;
    Object.defineProperty(unloadedWithDb, 'ready', {
      configurable: true,
      get: () => remoteReady,
    });

    // Unloaded doc without any database (must never be mutated during discovery).
    const plainUnloaded = workspace.createDoc('plain-unloaded');
    const plainUpdateSpy = vi.fn();
    plainUnloaded.spaceDoc.on('update', plainUpdateSpy);

    // Failing doc and trashed doc.
    const brokenDoc = workspace.createDoc('broken-doc');
    const trashedDoc = workspace.createDoc('trashed-doc');
    workspace.meta.setDocMeta(trashedDoc.id, { trash: true });

    const releases = new Map<string, ReturnType<typeof vi.fn>>();
    const acquired: string[] = [];
    (workspace as Workspace).acquireDoc = id => {
      acquired.push(id);
      const release = vi.fn(() => {
        if (id === unloadedWithDb.id) remoteReady = false;
      });
      releases.set(id, release);
      if (id === brokenDoc.id) {
        return { ready: Promise.reject(new Error('disk error')), release };
      }
      if (id === unloadedWithDb.id) {
        remoteReady = true;
      } else if (id === plainUnloaded.id) {
        plainUnloaded.load();
      }
      return { ready: Promise.resolve(), release };
    };

    // Fast synchronous scan sees only already-loaded databases and does NOT call acquireDoc.
    expect(source.relationDatabases()).toEqual([
      {
        docId: 'source-doc',
        databaseId: loadedDb.id,
        title: 'Database test / Loaded DB',
      },
    ]);
    expect(acquired).toEqual([]);
    expect(source.hasUnloadedRelationDocs()).toBe(true);

    const discovered = await source.discoverRelationDatabases({
      concurrency: 2,
      timeoutMs: 200,
    });
    expect(discovered).toEqual([
      {
        docId: 'source-doc',
        databaseId: loadedDb.id,
        title: 'Database test / Loaded DB',
      },
      {
        docId: unloadedWithDb.id,
        databaseId: remoteDbId,
        title: 'Remote Page / Projects',
      },
    ]);

    // Trashed docs are never acquired; every acquired lease is released in finally.
    expect(acquired).not.toContain(trashedDoc.id);
    expect(releases.get(unloadedWithDb.id)).toHaveBeenCalledOnce();
    expect(releases.get(brokenDoc.id)).toHaveBeenCalledOnce();
    expect(releases.get(plainUnloaded.id)).toHaveBeenCalledOnce();
    // Unrelated unloaded docs were never mutated.
    expect(plainUpdateSpy).not.toHaveBeenCalled();

    // Cached discovered databases remain visible synchronously after lease release,
    // and disappear immediately if the doc is later trashed or removed.
    expect(remoteReady).toBe(false);
    expect(source.relationDatabases().map(db => db.databaseId)).toContain(
      remoteDbId
    );
    workspace.meta.setDocMeta(unloadedWithDb.id, { trash: true });
    expect(source.relationDatabases().map(db => db.databaseId)).not.toContain(
      remoteDbId
    );
    workspace.meta.setDocMeta(unloadedWithDb.id, { trash: false });
    expect(source.relationDatabases().map(db => db.databaseId)).toContain(
      remoteDbId
    );
    workspace.removeDoc(unloadedWithDb.id);
    expect(source.relationDatabases().map(db => db.databaseId)).not.toContain(
      remoteDbId
    );
  });

  test('discoverRelationDatabases bounds maxDocs, skips timed-out docs, and handles fallback load errors', async () => {
    const { workspace, database } = setup();
    const { source } = database();

    const slowDoc = workspace.createDoc('slow-doc');
    const doc2 = workspace.createDoc('doc-2');
    const doc3 = workspace.createDoc('doc-3');

    const slowRelease = vi.fn();
    const acquired: string[] = [];
    (workspace as Workspace).acquireDoc = id => {
      acquired.push(id);
      if (id === slowDoc.id) {
        return { ready: new Promise<void>(() => {}), release: slowRelease };
      }
      return { ready: Promise.resolve(), release: vi.fn() };
    };

    // Bounded maxDocs=2 only scans the first 2 unloaded docs.
    await source.discoverRelationDatabases({ maxDocs: 2, timeoutMs: 60 });
    expect(acquired).toHaveLength(2);
    expect(slowRelease).toHaveBeenCalledOnce();
    expect(source.hasUnloadedRelationDocs()).toBe(true);

    // Next call scans the remaining unloaded doc.
    await source.discoverRelationDatabases({ maxDocs: 2, timeoutMs: 60 });
    expect(acquired).toContain(doc2.id);
    expect(acquired).toContain(doc3.id);
    expect(source.hasUnloadedRelationDocs()).toBe(false);

    // Fallback without acquireDoc skips docs whose load() throws.
    delete (workspace as Workspace).acquireDoc;
    const throwingDoc = workspace.createDoc('throwing-load');
    vi.spyOn(throwingDoc, 'load').mockImplementation(() => {
      throw new Error('corrupt doc');
    });
    await expect(
      source.discoverRelationDatabases({ force: true })
    ).resolves.toBeDefined();
  });

  test('two-way reciprocal relations create/link paired columns, sync both directions without looping, and handle lifecycle changes', () => {
    const { store, database } = setup();
    const tasks = database();
    tasks.model.props.title.insert('Tasks', 0);
    const projects = database();
    projects.model.props.title.insert('Projects', 0);

    const task1 = tasks.source.rowAdd('end');
    const task2 = tasks.source.rowAdd('end');
    const proj1 = projects.source.rowAdd('end');
    const proj2 = projects.source.rowAdd('end');

    const taskRel = tasks.source.propertyAdd('end', {
      type: 'relation',
      name: 'Project',
    })!;

    // Pre-existing link before enabling two-way should be backfilled when enabled.
    tasks.source.configureRelation(taskRel, {
      targetDocId: store.doc.id,
      targetDatabaseId: projects.model.id,
    });
    tasks.source.cellValueChange(task1, taskRel, [proj1]);

    const { reciprocalColumnId: projRel } = tasks.source.configureRelation(
      taskRel,
      { reciprocal: true }
    );
    expect(projRel).toBeTruthy();

    expect(tasks.source.propertyDataGet(taskRel)).toEqual({
      targetDocId: store.doc.id,
      targetDatabaseId: projects.model.id,
      reciprocal: true,
      reciprocalColumnId: projRel,
    });
    expect(projects.source.propertyDataGet(projRel!)).toEqual({
      targetDocId: store.doc.id,
      targetDatabaseId: tasks.model.id,
      reciprocal: true,
      reciprocalColumnId: taskRel,
    });
    expect(projects.source.propertyNameGet(projRel!)).toBe('Tasks');
    // Backfilled existing link.
    expect(projects.source.cellValueGet(proj1, projRel!)).toEqual([task1]);

    // Re-enabling two-way is idempotent and does not duplicate target column.
    const colCountBefore = projects.source.properties$.value.length;
    const again = tasks.source.configureRelation(taskRel, { reciprocal: true });
    expect(again.reciprocalColumnId).toBe(projRel);
    expect(projects.source.properties$.value.length).toBe(colCountBefore);

    // Bidirectional add & remove sync.
    tasks.source.cellValueChange(task1, taskRel, [proj1, proj2]);
    expect(projects.source.cellValueGet(proj1, projRel!)).toEqual([task1]);
    expect(projects.source.cellValueGet(proj2, projRel!)).toEqual([task1]);

    // Updating from target side syncs back to source side cleanly.
    projects.source.cellValueChange(proj1, projRel!, [task1, task2]);
    expect(tasks.source.cellValueGet(task2, taskRel)).toEqual([proj1]);

    // Removing from target side removes from source without touching other links.
    projects.source.cellValueChange(proj1, projRel!, [task2]);
    expect(tasks.source.cellValueGet(task1, taskRel)).toEqual([proj2]);
    expect(tasks.source.cellValueGet(task2, taskRel)).toEqual([proj1]);

    // Idempotent repeat write causes no extra mutations or loops.
    const updateSpy = vi.fn();
    store.doc.spaceDoc.on('update', updateSpy);
    tasks.source.cellValueChange(task1, taskRel, [proj2, proj2]);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(projects.source.cellValueGet(proj2, projRel!)).toEqual([task1]);

    // Missing target rows are skipped safely while valid rows still sync.
    tasks.source.cellValueChange(task1, taskRel, ['nonexistent-row', proj1]);
    expect(tasks.source.cellValueGet(task1, taskRel)).toEqual([
      'nonexistent-row',
      proj1,
    ]);
    expect(projects.source.cellValueGet(proj1, projRel!)).toEqual([
      task2,
      task1,
    ]);
    expect(projects.source.cellValueGet(proj2, projRel!)).toEqual([]);
    expect(projects.model.props.cells['nonexistent-row']).toBeUndefined();

    // Disabling two-way stops future sync on both sides without erasing cells.
    tasks.source.configureRelation(taskRel, { reciprocal: false });
    expect(tasks.source.propertyDataGet(taskRel)).toEqual({
      targetDocId: store.doc.id,
      targetDatabaseId: projects.model.id,
      reciprocal: false,
    });
    expect(projects.source.propertyDataGet(projRel!)).toEqual({
      targetDocId: store.doc.id,
      targetDatabaseId: tasks.model.id,
      reciprocal: false,
    });
    tasks.source.cellValueChange(task1, taskRel, []);
    expect(projects.source.cellValueGet(proj1, projRel!)).toEqual([
      task2,
      task1,
    ]);

    // Re-enabling links the existing unpaired target column instead of creating a duplicate
    // and backfills target's links back onto source.
    const relinked = tasks.source.configureRelation(taskRel, {
      reciprocal: true,
    });
    expect(relinked.reciprocalColumnId).toBe(projRel);
    expect(projects.source.properties$.value.length).toBe(colCountBefore);
    expect(tasks.source.cellValueGet(task1, taskRel)).toEqual([proj1]);

    // Deleting the source relation column detaches the target reciprocal flag.
    tasks.source.propertyDelete(taskRel);
    expect(projects.source.propertyDataGet(projRel!)).toEqual({
      targetDocId: store.doc.id,
      targetDatabaseId: tasks.model.id,
      reciprocal: false,
    });
  });

  test('two-way self-relations (two-column and symmetric) never infinite-loop', () => {
    const { store, database } = setup();
    const { model, source } = database();
    model.props.title.insert('Tasks', 0);

    const rowA = source.rowAdd('end');
    const rowB = source.rowAdd('end');

    // Two-column self-relation: Blocking <-> Related to Blocking.
    const blocking = source.propertyAdd('end', {
      type: 'relation',
      name: 'Blocking',
    })!;
    const { reciprocalColumnId: blockedBy } = source.configureRelation(
      blocking,
      {
        targetDocId: store.doc.id,
        targetDatabaseId: model.id,
        reciprocal: true,
      }
    );
    expect(blockedBy).toBeTruthy();
    expect(blockedBy).not.toBe(blocking);

    // Linking to another row AND self-row stays loop-free.
    source.cellValueChange(rowA, blocking, [rowA, rowB]);
    expect(source.cellValueGet(rowA, blockedBy!)).toEqual([rowA]);
    expect(source.cellValueGet(rowB, blockedBy!)).toEqual([rowA]);

    source.cellValueChange(rowA, blocking, [rowB]);
    expect(source.cellValueGet(rowA, blockedBy!)).toEqual([]);
    expect(source.cellValueGet(rowB, blockedBy!)).toEqual([rowA]);

    // Symmetric single-column self-relation (same column as its own reciprocal).
    const related = source.propertyAdd('end', {
      type: 'relation',
      name: 'Related',
    })!;
    source.propertyDataSet(related, {
      targetDocId: store.doc.id,
      targetDatabaseId: model.id,
      reciprocal: true,
      reciprocalColumnId: related,
    });
    source.cellValueChange(rowA, related, [rowA, rowB]);
    expect(source.cellValueGet(rowA, related)).toEqual([rowA, rowB]);
    expect(source.cellValueGet(rowB, related)).toEqual([rowA]);

    source.cellValueChange(rowB, related, []);
    expect(source.cellValueGet(rowA, related)).toEqual([rowA]);
  });

  test('cross-page two-way relation syncs edits and configureRelationAsync loads unloaded targets cleanly', async () => {
    const { workspace, database } = setup();
    const { source } = database();

    const targetDoc = workspace.createDoc('target-page');
    targetDoc.load();
    const targetStore = targetDoc.getStore();
    const page = targetStore.addBlock('affine:page', {
      title: new Text('Clients'),
    });
    const note = targetStore.addBlock('affine:note', {}, page);
    const targetDbId = targetStore.addBlock('affine:database', {}, note);
    const targetModel =
      targetStore.getModelById<DatabaseBlockModel>(targetDbId)!;
    const targetSource = new DatabaseBlockDataSource(targetModel);
    const clientRow = targetSource.rowAdd('end');

    let isTargetReady = false;
    Object.defineProperty(targetDoc, 'ready', {
      configurable: true,
      get: () => isTargetReady,
    });
    const tempRelease = vi.fn();
    (workspace as Workspace).acquireDoc = id => {
      if (id === targetDoc.id) isTargetReady = true;
      return { ready: Promise.resolve(), release: tempRelease };
    };

    const row = source.rowAdd('end');
    const rel = source.propertyAdd('end', {
      type: 'relation',
      name: 'Client',
    })!;
    const { reciprocalColumnId } = await source.configureRelationAsync(rel, {
      targetDocId: targetDoc.id,
      targetDatabaseId: targetDbId,
      reciprocal: true,
    });
    expect(reciprocalColumnId).toBeTruthy();
    expect(tempRelease).toHaveBeenCalledOnce();

    source.cellValueChange(row, rel, [clientRow]);
    expect(targetSource.cellValueGet(clientRow, reciprocalColumnId!)).toEqual([
      row,
    ]);

    targetSource.cellValueChange(clientRow, reciprocalColumnId!, []);
    expect(source.cellValueGet(row, rel)).toEqual([]);
  });

  test('formulas resolve human-friendly property names, detect ambiguity, and support live preview', () => {
    const { database } = setup();
    const { source } = database();

    const price = source.propertyAdd('end', { type: 'number', name: 'Price' })!;
    const qty = source.propertyAdd('end', { type: 'number', name: 'Qty' })!;
    const total = source.propertyAdd('end', {
      type: 'formula',
      name: 'Total',
    })!;

    // Empty database live preview: syntax check for property refs, evaluation for constants.
    expect(
      evaluateFormulaPreview(source, {
        expression: '',
        resultType: 'number',
        propertyId: total,
      })
    ).toEqual({ kind: 'empty', message: 'Enter a formula expression' });
    expect(
      evaluateFormulaPreview(source, {
        expression: 'prop("Price") * prop("Qty")',
        resultType: 'number',
        propertyId: total,
      })
    ).toEqual({
      kind: 'syntax-ok',
      message: 'Syntax valid — add a row to preview values',
    });
    expect(
      evaluateFormulaPreview(source, {
        expression: '2 + 3 * 4',
        resultType: 'number',
        propertyId: total,
      })
    ).toEqual({ kind: 'value', value: 14, formatted: '14' });
    expect(
      evaluateFormulaPreview(source, {
        expression: 'prop("Total") + 1',
        resultType: 'number',
        propertyId: total,
      })
    ).toEqual({ kind: 'error', message: 'Circular property reference' });

    // Populate first row and test readable name formulas + case-insensitivity + reactivity.
    const row = source.rowAdd('end');
    source.cellValueChange(row, price, 15);
    source.cellValueChange(row, qty, 3);
    source.propertyDataSet(total, {
      expression: 'prop("Price") * prop("qty")',
      resultType: 'number',
    });
    const totalVal = source.cellValueGet$(row, total);
    expect(totalVal.value).toBe(45);

    // Live preview evaluates draft formula against first row without mutating saved formula.
    expect(
      evaluateFormulaPreview(source, {
        expression: 'prop("Price") * prop("Qty") + 5',
        resultType: 'number',
        propertyId: total,
      })
    ).toEqual({ kind: 'value', value: 50, formatted: '50' });
    expect(
      evaluateFormulaPreview(source, {
        expression: 'dateAdd(date("2026-10-05"), 2)',
        resultType: 'date',
        propertyId: total,
      })
    ).toEqual({
      kind: 'value',
      value: Date.parse('2026-10-07T00:00:00Z'),
      formatted: '2026-10-07',
    });
    expect(
      evaluateFormulaPreview(source, {
        expression: 'prop("Price") * 2',
        resultType: 'string',
        propertyId: total,
      })
    ).toEqual({ kind: 'error', message: 'Formula result must be string' });
    expect(
      evaluateFormulaPreview(source, {
        expression: 'prop("Total") + 1',
        resultType: 'number',
        propertyId: total,
      })
    ).toEqual({ kind: 'error', message: 'Circular property reference' });

    // Saved formula remains unchanged after previews.
    expect(totalVal.value).toBe(45);

    // Circular reference by column name is caught in real evaluation too.
    source.propertyDataSet(total, {
      expression: 'prop("Total") + 1',
      resultType: 'number',
    });
    expect(totalVal.value).toEqual({ error: 'Circular property reference' });

    // Duplicate column names produce explicit ambiguity error, while column ID still works.
    const duplicatePrice = source.propertyAdd('end', {
      type: 'number',
      name: 'Price',
    })!;
    source.propertyNameSet(duplicatePrice, 'Price');
    source.propertyDataSet(total, {
      expression: 'prop("Price") * 2',
      resultType: 'number',
    });
    expect(totalVal.value).toEqual({
      error: 'Ambiguous property name: "Price" (use column ID)',
    });
    source.propertyDataSet(total, {
      expression: `prop(${JSON.stringify(price)}) * 2`,
      resultType: 'number',
    });
    expect(totalVal.value).toBe(30);
  });

  test('retargeting a two-way relation cleans up old backlinks and links the new target', () => {
    const { store, database } = setup();
    const tasks = database();
    const projectsA = database();
    const projectsB = database();

    const taskRow = tasks.source.rowAdd('end');
    const projARow = projectsA.source.rowAdd('end');
    const projBRow = projectsB.source.rowAdd('end');

    const rel = tasks.source.propertyAdd('end', {
      type: 'relation',
      name: 'Project',
    })!;
    const { reciprocalColumnId: colA } = tasks.source.configureRelation(rel, {
      targetDocId: store.doc.id,
      targetDatabaseId: projectsA.model.id,
      reciprocal: true,
    });
    tasks.source.cellValueChange(taskRow, rel, [projARow]);
    expect(projectsA.source.cellValueGet(projARow, colA!)).toEqual([taskRow]);

    // Retargeting to projectsB clears old links & backlinks, detaches colA, and creates colB.
    const { reciprocalColumnId: colB } = tasks.source.configureRelation(rel, {
      targetDocId: store.doc.id,
      targetDatabaseId: projectsB.model.id,
      reciprocal: true,
    });
    expect(colB).toBeTruthy();
    expect(tasks.source.cellValueGet(taskRow, rel)).toEqual([]);
    expect(projectsA.source.cellValueGet(projARow, colA!)).toEqual([]);
    expect(projectsA.source.propertyDataGet(colA!).reciprocal).toBe(false);

    tasks.source.cellValueChange(taskRow, rel, [projBRow]);
    expect(projectsB.source.cellValueGet(projBRow, colB!)).toEqual([taskRow]);
  });

  test('FormulaEditor renders property chips, function templates, live preview, and saves cleanly', async () => {
    const { database } = setup();
    const { source } = database();
    const row = source.rowAdd('end');
    const price = source.propertyAdd('end', { type: 'number', name: 'Price' })!;
    const total = source.propertyAdd('end', {
      type: 'formula',
      name: 'Total',
    })!;
    source.cellValueChange(row, price, 10);

    const view = source.viewManager.viewGet(
      source.viewManager.viewAdd('table')
    )!;
    const formulaProperty = view.propertyGetOrCreate(total);

    const onClose = vi.fn();
    const editor = new FormulaEditor();
    editor.dataSource = source;
    editor.formulaProperty = formulaProperty;
    editor.onClose = onClose;
    document.body.append(editor);
    try {
      await editor.updateComplete;
      const root = editor.shadowRoot!;
      const priceChip = [...root.querySelectorAll('button.chip')].find(
        btn => btn.textContent?.trim() === 'Price'
      ) as HTMLButtonElement | undefined;
      expect(priceChip).toBeDefined();
      priceChip!.click();
      await editor.updateComplete;

      expect(editor.expression).toBe('prop("Price")');
      const preview = root.querySelector(
        '[data-testid="formula-live-preview"]'
      );
      expect(preview?.textContent).toContain('10');

      const saveBtn = root.querySelector(
        '[data-testid="formula-save-btn"]'
      ) as HTMLButtonElement;
      saveBtn.click();

      expect(onClose).toHaveBeenCalledOnce();
      expect(source.propertyDataGet(total)).toEqual({
        expression: 'prop("Price")',
        resultType: 'number',
      });
      expect(source.cellValueGet(row, total)).toBe(10);
    } finally {
      editor.remove();
    }
  });

  test('integrates status labels in rollups, date ranges in formulas/rollups, and last-edited-time in spacialProperties', () => {
    const { store, database } = setup();
    const tasks = database();
    const projects = database();

    const statusCol = tasks.source.propertyAdd('end', {
      type: 'status',
      name: 'Status',
    })!;
    const dueCol = tasks.source.propertyAdd('end', {
      type: 'date',
      name: 'Due',
    })!;
    const editedCol = tasks.source.propertyAdd('end', {
      type: 'last-edited-time',
      name: 'Edited',
    })!;
    const nextDayFormula = tasks.source.propertyAdd('end', {
      type: 'formula',
      name: 'Plus One Day',
    })!;
    tasks.source.propertyDataSet(nextDayFormula, {
      expression: 'dateAdd(prop("Due"), 1)',
      resultType: 'date',
    });

    const startTs = Date.UTC(2026, 4, 10, 9, 30);
    const endTs = Date.UTC(2026, 4, 12, 17, 0);
    const statusOptions = tasks.source.propertyDataGet(statusCol).options as {
      id: string;
      value: string;
    }[];
    const doneOption = statusOptions.find(opt => opt.value === 'Done')!;

    const taskRow = tasks.source.rowAdd('end');
    tasks.source.cellValueChange(taskRow, statusCol, doneOption.id);
    tasks.source.cellValueChange(taskRow, dueCol, {
      start: startTs,
      end: endTs,
      includeTime: true,
    });

    // Formula unwraps DateRangeValue to its start timestamp cleanly.
    expect(tasks.source.cellValueGet(taskRow, nextDayFormula)).toBe(
      startTs + 24 * 60 * 60 * 1000
    );

    // Formula resolves Status option IDs to their readable label.
    const statusLabelFormula = tasks.source.propertyAdd('end', {
      type: 'formula',
      name: 'Status Label',
    })!;
    tasks.source.propertyDataSet(statusLabelFormula, {
      expression: 'prop("Status")',
      resultType: 'string',
    });
    expect(tasks.source.cellValueGet(taskRow, statusLabelFormula)).toBe('Done');
    expect(
      evaluateFormulaPreview(tasks.source, {
        expression: 'prop("Status")',
        resultType: 'string',
        propertyId: statusLabelFormula,
      })
    ).toEqual({ kind: 'value', value: 'Done', formatted: 'Done' });

    // last-edited-time resolves per-row updatedAt via spacialProperties.
    const rowModel = store.getModelById(taskRow)!;
    store.updateBlock(rowModel, { 'meta:updatedAt': 1_700_000_000_000 });
    expect(tasks.source.cellValueGet(taskRow, editedCol)).toBe(
      1_700_000_000_000
    );

    // Rollup over Status renders readable labels, and min over Date range unwraps start timestamp.
    const relCol = projects.source.propertyAdd('end', {
      type: 'relation',
      name: 'Tasks',
    })!;
    projects.source.propertyDataSet(relCol, {
      targetDocId: store.doc.id,
      targetDatabaseId: tasks.model.id,
    });
    const statusRollup = projects.source.propertyAdd('end', {
      type: 'rollup',
      name: 'Task Statuses',
    })!;
    projects.source.propertyDataSet(statusRollup, {
      relationColumnId: relCol,
      targetColumnId: statusCol,
      operation: 'values',
    });
    const minDueRollup = projects.source.propertyAdd('end', {
      type: 'rollup',
      name: 'Earliest Due',
    })!;
    projects.source.propertyDataSet(minDueRollup, {
      relationColumnId: relCol,
      targetColumnId: dueCol,
      operation: 'min',
    });

    const projRow = projects.source.rowAdd('end');
    projects.source.cellValueChange(projRow, relCol, [taskRow]);

    expect(projects.source.cellValueGet(projRow, statusRollup)).toEqual([
      'Done',
    ]);
    expect(projects.source.cellValueGet(projRow, minDueRollup)).toBe(startTs);
  });
});

describe('status property in the real local database model', () => {
  test('defaults, converts with select and rich text, exports names and survives a snapshot round-trip', async () => {
    const { workspace, store, database } = setup();
    const { model, source } = database();
    const row = source.rowAdd('end');
    const status = source.propertyAdd('end', { type: 'status' })!;
    const options = source.propertyDataGet(status).options as {
      id: string;
      value: string;
      color: string;
      group: string;
    }[];
    expect(options.map(v => [v.value, v.group])).toEqual([
      ['Not started', 'todo'],
      ['In progress', 'inProgress'],
      ['Done', 'complete'],
    ]);
    const done = options[2]!;
    source.cellValueChange(row, status, done.id);

    const snapshot = store.getTransformer().docToSnapshot(store)!;
    const table = processTable(
      model.props.columns,
      [{ id: row, props: { text: 'Task' } } as never],
      model.props.cells
    );
    expect(table.rows[0]!.cells.map(cell => cell.value)).toEqual([
      'Task',
      'Done',
    ]);

    const copy = (await store
      .getTransformer([replaceIdMiddleware(workspace.idGenerator)])
      .snapshotToDoc(snapshot))!;
    const copied = Object.values(copy.blocks.value).find(
      block => block.model.flavour === 'affine:database'
    )!.model as DatabaseBlockModel;
    const copiedColumn = copied.props.columns.find(
      column => column.type === 'status'
    )!;
    expect(copiedColumn.data).toEqual(source.propertyDataGet(status));
    expect(
      new DatabaseBlockDataSource(copied).cellValueGet(
        copied.children[0]!.id,
        copiedColumn.id
      )
    ).toBe(done.id);

    source.propertyTypeSet(status, 'select');
    expect(source.propertyDataGet(status).options).toEqual(
      options.map(({ id, value, color }) => ({ id, value, color }))
    );
    expect(source.cellValueGet(row, status)).toBe(done.id);
    source.propertyTypeSet(status, 'status');
    expect(source.propertyDataGet(status).options).toEqual(options);
    expect(source.cellValueGet(row, status)).toBe(done.id);

    source.propertyTypeSet(status, 'rich-text');
    expect(source.cellValueGet(row, status)?.toString()).toBe('Done');
    source.propertyTypeSet(status, 'status');
    const converted = source.propertyDataGet(status).options as typeof options;
    expect(converted.map(v => v.value)).toEqual([
      'Not started',
      'In progress',
      'Done',
    ]);
    expect(source.cellValueGet(row, status)).toBe(converted[2]!.id);
  });
});
