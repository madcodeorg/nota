import type { BlockComponent, EditorHost } from '@blocksuite/affine/std';
import { type BlockModel, Text } from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import type {
  insertFromMarkdown,
  markDownToDoc,
  markdownToSnapshot,
} from '../../utils';

type MarkdownUtilsModule = {
  insertFromMarkdown: typeof insertFromMarkdown;
  markDownToDoc: typeof markDownToDoc;
  markdownToSnapshot: typeof markdownToSnapshot;
};

const markdownToSnapshotMock = vi.hoisted(() => vi.fn());
const insertFromMarkdownMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils', async importOriginal => {
  const actual = await importOriginal<MarkdownUtilsModule>();
  return {
    ...actual,
    insertFromMarkdown: insertFromMarkdownMock,
    markdownToSnapshot: markdownToSnapshotMock,
  };
});

import { replace } from './editor-actions';

type TestEditor = ReturnType<typeof createTestEditor>;

let originalMarkdownToSnapshot: typeof markdownToSnapshot;
let originalInsertFromMarkdown: typeof insertFromMarkdown;

const modelText = (model: BlockModel | null) => model?.text?.toString() ?? '';

function createTestEditor() {
  const rootDoc = new YDoc({ guid: 'editor-actions-test-root' });
  const collection = new WorkspaceImpl({
    id: 'editor-actions-test',
    rootDoc,
  });
  collection.meta.initialize();
  const doc = collection.createDoc('editor-actions-test-doc');
  const store = doc.getStore();
  doc.load();

  const pageId = store.addBlock('affine:page', {
    title: new Text('AI replacement test'),
  });
  store.addBlock('affine:surface', {}, pageId);
  const noteId = store.addBlock('affine:note', {}, pageId);
  const firstId = store.addBlock(
    'affine:paragraph',
    { text: new Text('Original one') },
    noteId
  );
  const secondId = store.addBlock(
    'affine:paragraph',
    { text: new Text('Original two') },
    noteId
  );
  const unaffectedId = store.addBlock(
    'affine:paragraph',
    { text: new Text('Unaffected') },
    noteId
  );
  store.resetHistory();

  const note = store.getModelById(noteId)!;
  const first = store.getModelById(firstId)!;
  const second = store.getModelById(secondId)!;
  const parentComponent = {
    flavour: 'affine:note',
    model: note,
    parentComponent: null,
  } as unknown as BlockComponent;
  const firstComponent = {
    flavour: 'affine:paragraph',
    model: first,
    parentComponent,
  } as unknown as BlockComponent;
  const host = {
    std: {
      selection: {
        find: () => undefined,
      },
    },
    store,
    updateComplete: Promise.resolve(),
  } as unknown as EditorHost;

  return {
    collection,
    first,
    firstComponent,
    firstId,
    host,
    note,
    rootDoc,
    second,
    secondId,
    store,
    unaffectedId,
  };
}

function disposeTestEditor(editor: TestEditor) {
  editor.collection.dispose();
  editor.rootDoc.destroy();
}

beforeEach(async () => {
  const actual = await vi.importActual<MarkdownUtilsModule>('../../utils');
  originalMarkdownToSnapshot = actual.markdownToSnapshot;
  originalInsertFromMarkdown = actual.insertFromMarkdown;
  markdownToSnapshotMock.mockImplementation(originalMarkdownToSnapshot);
  insertFromMarkdownMock.mockImplementation(originalInsertFromMarkdown);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('block-selection AI replacement', () => {
  test('prepares slowly, applies one history item, and one undo restores the originals', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const editor = createTestEditor();
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>(resolve => {
      releasePreparation = resolve;
    });
    markdownToSnapshotMock.mockImplementation(
      async (...args: Parameters<typeof originalMarkdownToSnapshot>) => {
        await preparationGate;
        return originalMarkdownToSnapshot(...args);
      }
    );
    insertFromMarkdownMock.mockImplementation(
      async (...args: Parameters<typeof originalInsertFromMarkdown>) => {
        await preparationGate;
        return originalInsertFromMarkdown(...args);
      }
    );

    try {
      const replacePromise = replace(
        editor.host,
        'Replacement paragraph\n\n- Replacement list\n  - Nested item',
        editor.firstComponent,
        [editor.first, editor.second]
      );

      expect(markdownToSnapshotMock).toHaveBeenCalledOnce();
      expect(editor.store.hasBlock(editor.firstId)).toBe(true);
      expect(editor.store.hasBlock(editor.secondId)).toBe(true);
      expect(editor.store.history.undoManager.undoStack).toHaveLength(0);

      vi.setSystemTime(Date.now() + 600);
      releasePreparation();
      await replacePromise;

      expect(editor.store.history.undoManager.undoStack).toHaveLength(1);
      expect(editor.store.hasBlock(editor.firstId)).toBe(false);
      expect(editor.store.hasBlock(editor.secondId)).toBe(false);
      expect(editor.note.children.map(model => modelText(model))).toEqual([
        'Replacement paragraph',
        'Replacement list',
        'Unaffected',
      ]);

      editor.store.undo();

      expect(editor.store.history.undoManager.undoStack).toHaveLength(0);
      expect(editor.store.hasBlock(editor.firstId)).toBe(true);
      expect(editor.store.hasBlock(editor.secondId)).toBe(true);
      expect(editor.note.children.map(model => model.id)).toEqual([
        editor.firstId,
        editor.secondId,
        editor.unaffectedId,
      ]);
      expect(editor.note.children.map(model => modelText(model))).toEqual([
        'Original one',
        'Original two',
        'Unaffected',
      ]);
    } finally {
      disposeTestEditor(editor);
    }
  });

  test('leaves the original blocks untouched when conversion fails', async () => {
    const editor = createTestEditor();
    markdownToSnapshotMock.mockRejectedValueOnce(
      new Error('Markdown conversion failed')
    );
    insertFromMarkdownMock.mockRejectedValueOnce(
      new Error('Markdown conversion failed')
    );

    try {
      await expect(
        replace(editor.host, 'Replacement', editor.firstComponent, [
          editor.first,
          editor.second,
        ])
      ).rejects.toThrow('Markdown conversion failed');

      expect(editor.store.history.undoManager.undoStack).toHaveLength(0);
      expect(editor.note.children.map(model => model.id)).toEqual([
        editor.firstId,
        editor.secondId,
        editor.unaffectedId,
      ]);
      expect(editor.note.children.map(model => modelText(model))).toEqual([
        'Original one',
        'Original two',
        'Unaffected',
      ]);
    } finally {
      disposeTestEditor(editor);
    }
  });

  test('refuses to mutate when local editor history cannot capture the edit', async () => {
    const editor = createTestEditor();
    const undoManager = editor.store.history.undoManager;
    const localOrigin = editor.store.spaceDoc.clientID;
    undoManager.trackedOrigins.delete(localOrigin);

    try {
      await expect(
        replace(editor.host, 'Replacement', editor.firstComponent, [
          editor.first,
          editor.second,
        ])
      ).rejects.toThrow(
        'The editor cannot safely record this replacement in local history.'
      );

      expect(undoManager.undoStack).toHaveLength(0);
      expect(editor.note.children.map(model => model.id)).toEqual([
        editor.firstId,
        editor.secondId,
        editor.unaffectedId,
      ]);
      expect(editor.note.children.map(model => modelText(model))).toEqual([
        'Original one',
        'Original two',
        'Unaffected',
      ]);
    } finally {
      undoManager.trackedOrigins.add(localOrigin);
      disposeTestEditor(editor);
    }
  });

  test('rolls back when history unexpectedly rejects the applied transaction', async () => {
    const editor = createTestEditor();
    const undoManager = editor.store.history.undoManager;
    const originalCaptureTransaction = undoManager.captureTransaction;
    undoManager.captureTransaction = () => false;

    try {
      await expect(
        replace(editor.host, 'Replacement', editor.firstComponent, [
          editor.first,
          editor.second,
        ])
      ).rejects.toThrow(
        'The editor did not capture the replacement as one safe history item.'
      );

      expect(undoManager.undoStack).toHaveLength(0);
      expect(editor.note.children.map(model => model.id)).toEqual([
        editor.firstId,
        editor.secondId,
        editor.unaffectedId,
      ]);
      expect(editor.note.children.map(model => modelText(model))).toEqual([
        'Original one',
        'Original two',
        'Unaffected',
      ]);
    } finally {
      undoManager.captureTransaction = originalCaptureTransaction;
      disposeTestEditor(editor);
    }
  });

  test('updates live block indexes with the complete nested replacement', async () => {
    const editor = createTestEditor();
    const blockEvents: Array<{
      id: string;
      isLocal: boolean;
      type: 'add' | 'delete' | 'update';
    }> = [];
    const subscription = editor.store.slots.blockUpdated.subscribe(event => {
      blockEvents.push({
        id: event.id,
        isLocal: event.isLocal,
        type: event.type,
      });
    });

    try {
      await replace(
        editor.host,
        '- Replacement parent\n  - Nested replacement',
        editor.firstComponent,
        [editor.first, editor.second]
      );

      const replacement = editor.note.children[0];
      expect(editor.note.children).toHaveLength(2);
      expect(modelText(replacement)).toBe('Replacement parent');
      expect(replacement.children).toHaveLength(1);
      expect(modelText(replacement.children[0])).toBe('Nested replacement');
      expect(editor.store.getModelById(replacement.id)).toBe(replacement);
      expect(editor.store.getModelById(replacement.children[0].id)).toBe(
        replacement.children[0]
      );
      expect(editor.store.getParent(replacement.children[0])).toBe(replacement);
      expect(editor.store.hasBlock(editor.firstId)).toBe(false);
      expect(editor.store.hasBlock(editor.secondId)).toBe(false);
      expect(blockEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: editor.firstId,
            isLocal: true,
            type: 'delete',
          }),
          expect.objectContaining({
            id: editor.secondId,
            isLocal: true,
            type: 'delete',
          }),
          expect.objectContaining({
            id: replacement.id,
            isLocal: true,
            type: 'add',
          }),
          expect.objectContaining({
            id: replacement.children[0].id,
            isLocal: true,
            type: 'add',
          }),
        ])
      );
    } finally {
      subscription.unsubscribe();
      disposeTestEditor(editor);
    }
  });
});
