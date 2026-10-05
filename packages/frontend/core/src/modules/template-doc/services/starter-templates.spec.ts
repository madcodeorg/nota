import {
  type DatabaseBlockModel,
  type ParagraphBlockModel,
} from '@blocksuite/affine/model';
import { AffineSchemas } from '@blocksuite/affine/schemas';
import { replaceIdMiddleware } from '@blocksuite/affine/shared/adapters';
import {
  BlockSchemaExtension,
  Schema,
  Slice,
  type Store,
  Transformer,
} from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';

import { initDocFromProps } from '../../../blocksuite/initialization';
import type { DocRecord } from '../../doc/entities/record';
import type { DocsService } from '../../doc/services/docs';
import type { DocCreateOptions } from '../../doc/types';
import {
  createLocalStarter,
  LOCAL_STARTER_TEMPLATES,
  type LocalStarterTemplateId,
} from './starter-templates';

const workspaces: TestWorkspace[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    workspace.forceStop();
    workspace.dispose();
  }
});

function setup() {
  const workspace = new TestWorkspace();
  workspace.storeExtensions = AffineSchemas.map(BlockSchemaExtension);
  workspace.meta.initialize();
  workspaces.push(workspace);
  const properties = new Map<string, Record<string, unknown>>();
  const createDoc = vi.fn((options: DocCreateOptions = {}) => {
    const doc = workspace.createDoc(options.id);
    const store = doc.getStore({ id: doc.id });
    initDocFromProps(store, options.docProps, options);
    workspace.meta.setDocMeta(doc.id, { title: options.title });
    const record = {
      id: doc.id,
      setProperty: (key: string, value: unknown) => {
        const values = properties.get(doc.id) ?? {};
        values[key] = value;
        properties.set(doc.id, values);
      },
    };
    return record as DocRecord;
  });
  const docsService: Pick<DocsService, 'createDoc'> = { createDoc };
  return { workspace, docsService, createDoc, properties };
}

function databases(store: Store) {
  return store
    .getBlocksByFlavour('affine:database')
    .map(block => block.model as DatabaseBlockModel);
}

function linkedPageIds(store: Store) {
  return store.getBlocksByFlavour('affine:paragraph').flatMap(block =>
    (block.model as ParagraphBlockModel).props.text
      .toDelta()
      .map(delta => delta.attributes?.reference?.pageId)
      .filter((value): value is string => typeof value === 'string')
  );
}

describe('bundled local starter templates', () => {
  test.each(LOCAL_STARTER_TEMPLATES)(
    '$title creates ordinary editable content only after selection',
    ({ id }) => {
      const { workspace, docsService, createDoc } = setup();
      expect(createDoc).not.toHaveBeenCalled();
      const docId = createLocalStarter(docsService, id);
      const store = workspace.getDoc(docId)!.getStore();
      expect(store.root?.flavour).toBe('affine:page');
      expect(store.getBlocksByFlavour('affine:note')).toHaveLength(1);
      expect(
        store.getBlocksByFlavour('affine:paragraph').length
      ).toBeGreaterThan(3);
      expect(
        createDoc.mock.calls.every(([options]) => !options?.isTemplate)
      ).toBe(true);
      const [paragraph] = store.getBlocksByFlavour('affine:paragraph');
      const text = (paragraph.model as ParagraphBlockModel).props.text;
      text.insert('Edited offline: ', 0);
      expect(text.toString()).toContain('Edited offline:');
      if (id !== 'daily-journal') {
        const linkedIds = linkedPageIds(store);
        expect(linkedIds).toHaveLength(1);
        expect(workspace.getDoc(linkedIds[0]!)).not.toBeNull();
        expect(linkedIds[0]).not.toBe(docId);
      }
    }
  );

  test('Projects and Tasks contains a working relation to a project row in the same page', () => {
    const { workspace, docsService } = setup();
    const docId = createLocalStarter(docsService, 'projects-and-tasks');
    const [projects, tasks] = databases(workspace.getDoc(docId)!.getStore());
    expect(projects!.props.title.toString()).toBe('Projects');
    expect(tasks!.props.title.toString()).toBe('Tasks');
    const relation = tasks!.props.columns.find(
      column => column.type === 'relation'
    )!;
    expect(relation.data).toEqual({
      targetDocId: docId,
      targetDatabaseId: projects!.id,
    });
    expect(tasks!.props.cells[tasks!.children[0]!.id]![relation.id]).toEqual({
      columnId: relation.id,
      value: [projects!.children[0]!.id],
    });
    expect(tasks!.props.columns.some(column => column.type === 'date')).toBe(
      true
    );
    expect(projects!.props.views[0]!.mode).toBe('table');
  });

  test('journal uses the supplied day and existing workspace journal property', () => {
    const { workspace, docsService, properties } = setup();
    const docId = createLocalStarter(
      docsService,
      'daily-journal',
      new Date(2026, 9, 5, 12)
    );
    expect(workspace.getDoc(docId)!.meta?.title).toBe('2026-10-05');
    expect(properties.get(docId)).toEqual({ journal: '2026-10-05' });
    expect(workspace.docs.size).toBe(1);
  });

  test('invalid selections and dates do not create partial content', () => {
    const { docsService, createDoc } = setup();
    expect(() =>
      createLocalStarter(docsService, 'missing' as LocalStarterTemplateId)
    ).toThrow('Unknown starter');
    expect(() =>
      createLocalStarter(docsService, 'daily-journal', new Date('invalid'))
    ).toThrow('Invalid journal date');
    expect(createDoc).not.toHaveBeenCalled();
  });

  test('separate selections create independent blocks and relation targets', () => {
    const { workspace, docsService } = setup();
    const first = createLocalStarter(docsService, 'projects-and-tasks');
    const second = createLocalStarter(docsService, 'projects-and-tasks');
    const [firstProject] = databases(workspace.getDoc(first)!.getStore());
    const [secondProject, secondTasks] = databases(
      workspace.getDoc(second)!.getStore()
    );
    expect(second).not.toBe(first);
    expect(secondProject!.id).not.toBe(firstProject!.id);
    expect(
      secondTasks!.props.columns.find(column => column.type === 'relation')!
        .data
    ).toEqual({ targetDocId: second, targetDatabaseId: secondProject!.id });
  });

  test('reopens editable databases and relations from persisted Yjs updates', () => {
    const original = setup();
    const id = createLocalStarter(original.docsService, 'projects-and-tasks');
    const originalDoc = original.workspace.getDoc(id)!;
    const [projects] = databases(originalDoc.getStore());
    (projects!.children[0] as ParagraphBlockModel).props.text.insert(
      'Updated ',
      0
    );
    const persisted = encodeStateAsUpdate(originalDoc.spaceDoc);
    const reopened = setup();
    const reopenedDoc = reopened.workspace.createDoc(id);
    applyUpdate(reopenedDoc.spaceDoc, persisted);
    reopenedDoc.load();
    const [reopenedProject, reopenedTasks] = databases(reopenedDoc.getStore());
    expect(
      (
        reopenedProject!.children[0] as ParagraphBlockModel
      ).props.text.toString()
    ).toBe('Updated Example project');
    expect(
      reopenedTasks!.props.columns.find(column => column.type === 'relation')!
        .data
    ).toEqual({ targetDocId: id, targetDatabaseId: reopenedProject!.id });
  });

  test('existing slice duplication remaps projects, task relations and views into the new page', async () => {
    const { workspace, docsService } = setup();
    const sourceId = createLocalStarter(docsService, 'projects-and-tasks');
    const source = workspace.getDoc(sourceId)!.getStore();
    const targetId = docsService.createDoc({ title: 'Copied starter' }).id;
    const target = workspace.getDoc(targetId)!.getStore();
    for (const child of [...target.root!.children]) target.deleteBlock(child);
    const transformer = new Transformer({
      schema: new Schema().register(AffineSchemas),
      blobCRUD: workspace.blobSync,
      docCRUD: {
        create: id => workspace.createDoc(id).getStore(),
        get: id => workspace.getDoc(id)?.getStore() ?? null,
        delete: id => workspace.removeDoc(id),
      },
      middlewares: [replaceIdMiddleware(workspace.idGenerator)],
    });
    try {
      const snapshot = transformer.sliceToSnapshot(
        Slice.fromModels(source, source.root!.children)
      )!;
      await transformer.snapshotToSlice(snapshot, target, target.root!.id);
      const [originalProjects] = databases(source);
      const [copiedProjects, copiedTasks] = databases(target);
      expect(copiedProjects!.id).not.toBe(originalProjects!.id);
      const relation = copiedTasks!.props.columns.find(
        column => column.type === 'relation'
      )!;
      expect(relation.data).toEqual({
        targetDocId: targetId,
        targetDatabaseId: copiedProjects!.id,
      });
      expect(
        copiedTasks!.props.cells[copiedTasks!.children[0]!.id]![relation.id]!
          .value
      ).toEqual([copiedProjects!.children[0]!.id]);
      expect(linkedPageIds(target)).toEqual(linkedPageIds(source));
    } finally {
      transformer[Symbol.dispose]();
    }
  });

  test('native snapshot imports retain forward companion links and project relations in a fresh workspace', async () => {
    const original = setup();
    const sourceId = createLocalStarter(
      original.docsService,
      'projects-and-tasks'
    );
    const source = original.workspace.getDoc(sourceId)!.getStore();
    const companionId = linkedPageIds(source)[0]!;
    const restored = setup();
    const ids = new Map(
      [sourceId, companionId].map(id => [id, restored.workspace.idGenerator()])
    );
    const transformer = new Transformer({
      schema: new Schema().register(AffineSchemas),
      blobCRUD: restored.workspace.blobSync,
      docCRUD: {
        create: id => restored.workspace.createDoc(id).getStore(),
        get: id => restored.workspace.getDoc(id)?.getStore() ?? null,
        delete: id => restored.workspace.removeDoc(id),
      },
      middlewares: [replaceIdMiddleware(restored.workspace.idGenerator, ids)],
    });
    try {
      const imported = await transformer.snapshotToDoc(
        transformer.docToSnapshot(source)!
      );
      const companion = await transformer.snapshotToDoc(
        transformer.docToSnapshot(
          original.workspace.getDoc(companionId)!.getStore()
        )!
      );
      expect(linkedPageIds(imported!)).toEqual([companion!.id]);
      const [projects, tasks] = databases(imported!);
      expect(
        tasks!.props.columns.find(column => column.type === 'relation')!.data
      ).toEqual({ targetDocId: imported!.id, targetDatabaseId: projects!.id });
      expect(restored.workspace.docs.size).toBe(2);
    } finally {
      transformer[Symbol.dispose]();
    }
  });
});
