import { describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('@blocksuite/affine/blocks/database', () => ({
  DatabaseBlockDataSource: class {
    constructor(
      private readonly model: {
        children: { id: string }[];
        id: string;
        props: {
          cells: Record<string, Record<string, unknown>>;
          columns: { data: object; id: string; name: string; type: string }[];
        };
        store: {
          addBlock: (
            flavour: string,
            props: object,
            parentId: string,
            index?: number
          ) => string;
          deleteBlock: (model: { id: string }) => void;
          getBlock: (id: string) => { model: { id: string } } | null;
        };
      }
    ) {}

    cellValueChange(rowId: string, columnId: string, value: unknown) {
      this.model.props.cells[rowId] ??= {};
      this.model.props.cells[rowId][columnId] = { columnId, value };
    }

    propertyAdd(_position: string, options: { name: string; type: string }) {
      const id = `generated-column-${this.model.props.columns.length + 1}`;
      this.model.props.columns.push({ data: {}, id, ...options });
      return id;
    }

    propertyDelete(id: string) {
      this.model.props.columns = this.model.props.columns.filter(
        column => column.id !== id
      );
    }

    rowAdd() {
      return this.model.store.addBlock('affine:paragraph', {}, this.model.id);
    }

    rowDelete(ids: string[]) {
      for (const id of ids) {
        const block = this.model.store.getBlock(id);
        if (block) this.model.store.deleteBlock(block.model);
        delete this.model.props.cells[id];
      }
    }
  },
  databaseBlockProperties: {
    richTextColumnConfig: { type: 'rich-text' },
    titleColumnConfig: { type: 'title' },
  },
}));
vi.mock('@blocksuite/affine/model', () => ({
  MindmapStyle: { FOUR: 'four' },
}));
vi.mock('@blocksuite/affine/std', () => ({
  TextSelection: class {},
}));
vi.mock('@blocksuite/affine/store', () => {
  class MockText {
    constructor(readonly value: string) {}
  }
  const toJSON = (value: unknown): unknown => {
    if (value instanceof MockText) {
      return { delta: [{ insert: value.value }] };
    }
    if (Array.isArray(value)) return value.map(toJSON);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, toJSON(entry)])
      );
    }
    return value;
  };
  return { Text: MockText, toJSON };
});
vi.mock('@blocksuite/affine/widgets/linked-doc', () => ({
  MarkdownTransformer: {
    importMarkdownToBlock: vi.fn().mockResolvedValue(undefined),
    importMarkdownToDoc: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@nota/core/blocksuite/ai/mini-mindmap', () => ({
  markdownToMindmap: vi.fn(() => ({ children: [], text: 'Root' })),
}));
vi.mock('@nota/core/blocksuite/ai/utils/editor-actions', () => ({
  insert: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@nota/core/blocksuite/ai/utils/selection-utils', () => ({
  getSelections: vi.fn(() => ({ selectedBlocks: [] })),
}));
vi.mock('@nota/core/blocksuite/manager/store', () => ({
  getStoreManager: () => ({
    config: {
      init: () => ({
        value: {
          get: () => [],
        },
      }),
    },
  }),
}));
vi.mock('@nota/core/modules/workspace', () => ({
  getAFFiNEWorkspaceSchema: () => ({}),
}));

import { MarkdownTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { replace as replaceEditorSelection } from '@nota/core/blocksuite/ai/utils/editor-actions';
import { getSelections } from '@nota/core/blocksuite/ai/utils/selection-utils';

import {
  type AgentActionProposal,
  applyPermissionForActionProposal,
  assertActionProposalWorkspace,
  buildAppliedActionProposalResult,
  canApplyFromChat,
  canUndoAppliedProposal,
  databaseMarkdown,
  parseDatabaseMarkdown,
  proposalPreview,
  proposalTitle,
  type StoredActionProposal,
  titleFromMarkdown,
  undoInfo,
  undoPermissionForActionProposal,
  unwrapMarkdownFence,
} from '../action-proposals.js';
import {
  appendMarkdownToDoc,
  appendRowsToDatabaseDoc,
  applyActionProposalToWorkspace,
  blockUndoFingerprint,
  createdDocumentUndoFingerprint,
  createMindmapInDoc,
  documentStateVectorFingerprint,
  surfaceElementUndoFingerprint,
  undoActionProposalInWorkspace,
} from '../apply.js';

function stored(
  proposal: AgentActionProposal,
  status: StoredActionProposal['status'] = 'pending_approval'
): StoredActionProposal {
  return {
    createdAt: '2026-06-14T00:00:00.000Z',
    id: 'proposal-1',
    proposal,
    reason: null,
    result: null,
    sessionId: null,
    status,
    updatedAt: '2026-06-14T00:00:00.000Z',
    workspaceId: 'workspace-1',
  };
}

describe('agent action proposal helpers', () => {
  test('unwraps markdown fences and derives titles', () => {
    const fenced = [
      '```markdown',
      '# Launch plan',
      '',
      '- Ship the secure apply path',
      '```',
      '',
      'Sources:',
      'doc',
    ].join('\n');

    expect(unwrapMarkdownFence(fenced)).toBe(
      '# Launch plan\n\n- Ship the secure apply path'
    );
    expect(titleFromMarkdown(fenced, 'Fallback')).toBe('Launch plan');
    expect(
      titleFromMarkdown('- First action\n- Second action', 'Fallback')
    ).toBe('First action');
    expect(titleFromMarkdown('', 'Fallback')).toBe('Fallback');
  });

  test('parses markdown tables and list rows for database actions', () => {
    expect(
      parseDatabaseMarkdown(
        'Tasks',
        [
          '| Task | Owner |',
          '| --- | --- |',
          '| Draft \\| Review | Kunj |',
        ].join('\n')
      )
    ).toEqual({
      headers: ['Task', 'Owner'],
      rows: [['Draft | Review', 'Kunj']],
    });

    expect(parseDatabaseMarkdown('Tasks', '1. Draft\n- Review')).toEqual({
      headers: ['Item', 'Status', 'Notes'],
      rows: [
        ['Draft', 'Not started', ''],
        ['Review', 'Not started', ''],
      ],
    });

    expect(databaseMarkdown('Tasks', 'Draft | Review')).toContain(
      '| Draft \\| Review | Not started | |'
    );
  });

  test('selects undo metadata by proposal type', () => {
    const base = {
      appliedAt: '2026-06-14T00:00:00.000Z',
      workspaceId: 'workspace-1',
    };

    expect(
      buildAppliedActionProposalResult({
        ...base,
        mutation: {
          createdDocFingerprint: 'doc-fingerprint',
          docId: 'doc-1',
        },
        proposal: {
          markdown: '# Note',
          title: 'Note',
          type: 'create_note',
        },
      }).undo
    ).toEqual({
      docId: 'doc-1',
      fingerprint: 'doc-fingerprint',
      type: 'trash_doc',
    });

    expect(
      buildAppliedActionProposalResult({
        ...base,
        mutation: {
          docId: 'doc-1',
          insertedBlockDocumentFingerprint: 'doc-state-fingerprint',
          insertedBlockTarget: {
            fingerprint: 'block-fingerprint',
            id: 'block-1',
          },
        },
        proposal: {
          docId: 'doc-1',
          markdown: 'Append',
          type: 'insert_markdown',
        },
      }).undo
    ).toEqual({
      documentFingerprint: 'doc-state-fingerprint',
      docId: 'doc-1',
      target: { fingerprint: 'block-fingerprint', id: 'block-1' },
      type: 'delete_block',
    });

    expect(
      buildAppliedActionProposalResult({
        ...base,
        mutation: {
          databaseBlockId: 'database-1',
          databaseColumnTargets: [
            { fingerprint: 'column-fingerprint', id: 'ai-column-1' },
          ],
          databaseRowTargets: [
            { fingerprint: 'row-1-fingerprint', id: 'row-1' },
            { fingerprint: 'row-2-fingerprint', id: 'row-2' },
          ],
          docId: 'doc-1',
        },
        proposal: {
          docId: 'doc-1',
          markdown: '| Task |',
          type: 'append_database_rows',
        },
      }).undo
    ).toEqual({
      columnTargets: [{ fingerprint: 'column-fingerprint', id: 'ai-column-1' }],
      databaseBlockId: 'database-1',
      docId: 'doc-1',
      rowTargets: [
        { fingerprint: 'row-1-fingerprint', id: 'row-1' },
        { fingerprint: 'row-2-fingerprint', id: 'row-2' },
      ],
      type: 'delete_database_rows',
    });

    expect(
      buildAppliedActionProposalResult({
        ...base,
        mutation: {
          docId: 'doc-1',
          insertedSurfaceDocumentFingerprint: 'doc-state-fingerprint',
          insertedSurfaceElementTarget: {
            fingerprint: 'element-fingerprint',
            id: 'element-1',
          },
        },
        proposal: {
          docId: 'doc-1',
          markdown: '- Root',
          type: 'create_mindmap',
        },
      }).undo
    ).toEqual({
      documentFingerprint: 'doc-state-fingerprint',
      docId: 'doc-1',
      target: { fingerprint: 'element-fingerprint', id: 'element-1' },
      type: 'delete_surface_element',
    });

    expect(
      buildAppliedActionProposalResult({
        ...base,
        mutation: {
          docId: 'doc-1',
          editorDocumentFingerprint: 'editor-doc-state',
          editorHistoryDepth: 4,
          editorHistoryToken: 'ai-history-token',
        },
        proposal: {
          docId: 'doc-1',
          markdown: 'Replacement',
          type: 'replace_selection',
        },
      }).undo
    ).toEqual({
      docId: 'doc-1',
      fingerprint: 'editor-doc-state',
      type: 'editor_history',
      undoStackDepth: 4,
      undoStackToken: 'ai-history-token',
    });

    expect(
      buildAppliedActionProposalResult({
        ...base,
        mutation: { docId: 'doc-1' },
        proposal: {
          docId: 'doc-1',
          type: 'clear_doc',
        },
      }).undo
    ).toBeUndefined();
  });

  test('guards chat apply by status, current lock, and active selection host', () => {
    const createNote = stored({
      markdown: '# Note',
      title: 'Note',
      type: 'create_note',
    });
    expect(canApplyFromChat(createNote)).toBe(true);
    expect(canApplyFromChat(createNote, null, 'proposal-2')).toBe(false);
    expect(canApplyFromChat(stored(createNote.proposal, 'approved'))).toBe(
      true
    );
    expect(
      canApplyFromChat({
        ...stored(createNote.proposal, 'failed'),
        result: { retryable: true },
      })
    ).toBe(true);
    expect(
      canApplyFromChat({
        ...stored(createNote.proposal, 'failed'),
        result: { retryable: false },
      })
    ).toBe(false);
    expect(canApplyFromChat(stored(createNote.proposal, 'failed'))).toBe(false);

    const replaceSelection = stored({
      docId: 'doc-1',
      markdown: 'Replacement',
      type: 'replace_selection',
    });
    expect(canApplyFromChat(replaceSelection, null)).toBe(false);
    expect(canApplyFromChat(replaceSelection, { host: {} })).toBe(true);

    const insertAtSelection = stored({
      docId: 'doc-1',
      markdown: 'Insert here',
      position: 'selection',
      type: 'insert_markdown',
    });
    expect(canApplyFromChat(insertAtSelection, null)).toBe(false);
    expect(canApplyFromChat(insertAtSelection, { host: {} })).toBe(true);

    const clearDoc = stored({
      docId: 'doc-1',
      type: 'clear_doc',
    });
    expect(canApplyFromChat(clearDoc, null)).toBe(false);
    expect(proposalTitle(clearDoc.proposal)).toBe('Clear doc-1');
    expect(proposalPreview(clearDoc.proposal)).toContain('Remove all body');
  });

  test('binds mutations and undo operations to target-note permissions', () => {
    expect(
      applyPermissionForActionProposal({
        docId: 'doc-1',
        markdown: 'Append',
        type: 'insert_markdown',
      })
    ).toEqual({ action: 'Doc_Update', docId: 'doc-1' });
    expect(
      applyPermissionForActionProposal({
        markdown: '# New',
        title: 'New',
        type: 'create_note',
      })
    ).toEqual({ action: 'Workspace_CreateDoc' });
    expect(
      undoPermissionForActionProposal({
        docId: 'doc-2',
        fingerprint: 'doc-fingerprint',
        type: 'trash_doc',
      })
    ).toEqual({ action: 'Doc_Trash', docId: 'doc-2' });
    expect(
      undoPermissionForActionProposal({
        documentFingerprint: 'doc-state-fingerprint',
        docId: 'doc-1',
        target: { fingerprint: 'block-fingerprint', id: 'block-1' },
        type: 'delete_block',
      })
    ).toEqual({ action: 'Doc_Update', docId: 'doc-1' });
    expect(
      undoPermissionForActionProposal({
        docId: 'doc-1',
        fingerprint: 'editor-doc-state',
        type: 'editor_history',
        undoStackDepth: 2,
        undoStackToken: 'ai-history-token',
      })
    ).toEqual({ action: 'Doc_Update', docId: 'doc-1' });
  });

  test('rejects proposals from another active workspace', () => {
    expect(() =>
      assertActionProposalWorkspace(
        stored({ markdown: '# Note', title: 'Note', type: 'create_note' }),
        'workspace-2'
      )
    ).toThrow('different workspace');
  });

  test('blocks whole-document clearing in the workspace mutation layer', async () => {
    await expect(
      applyActionProposalToWorkspace({
        docsService: {} as never,
        proposal: { docId: 'doc-1', type: 'clear_doc' },
        workspace: {} as never,
      })
    ).rejects.toThrow(/disabled until Nota can restore it safely/);
  });

  test('removes a just-created document if safe undo capture fails', async () => {
    vi.mocked(MarkdownTransformer.importMarkdownToDoc).mockResolvedValueOnce(
      'new-doc'
    );
    const removeDoc = vi.fn();
    const workspace = {
      getDoc: vi.fn(() => null),
      removeDoc,
    };
    const list = {
      [['doc', '$'].join('')]: vi.fn(() => ({ value: null })),
    };

    await expect(
      applyActionProposalToWorkspace({
        docsService: { list } as never,
        proposal: {
          markdown: '# New note',
          title: 'New note',
          type: 'create_note',
        },
        workspace: workspace as never,
      })
    ).rejects.toThrow('removed the incomplete AI document');
    expect(removeDoc).toHaveBeenCalledWith('new-doc');
  });

  test('removes just-inserted blocks if document revision capture fails', async () => {
    const parent = {
      children: [] as object[],
      flavour: 'affine:page',
      id: 'page-1',
    };
    const block = {
      children: [],
      flavour: 'affine:note',
      id: 'ai-block',
      keys: [],
      props: {},
      store: {
        getParent: () => parent,
      },
      version: 1,
    };
    parent.children.push(block);
    const deleteBlock = vi.fn();
    const doc = {
      addBlock: vi.fn(() => block.id),
      deleteBlock,
      getBlock: vi.fn(() => ({ model: block })),
      getBlocksByFlavour: vi.fn((flavour: string) =>
        flavour === 'affine:page' ? [{ id: parent.id, model: parent }] : []
      ),
      load: vi.fn(),
      spaceDoc: {},
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };

    await expect(
      applyActionProposalToWorkspace({
        docsService: {} as never,
        proposal: {
          docId: 'doc-1',
          markdown: 'AI insertion',
          type: 'insert_markdown',
        },
        workspace: workspace as never,
      })
    ).rejects.toThrow('rolled back the AI insertion');
    expect(deleteBlock).toHaveBeenCalledWith(block);
  });

  test('removes a just-created mindmap if revision capture fails', async () => {
    const element = {
      id: 'mindmap-1',
      serialize: () => ({ id: 'mindmap-1', type: 'mindmap' }),
    };
    const deleteElement = vi.fn();
    const surface = {
      addElement: vi.fn(() => element.id),
      deleteElement,
      getElementById: vi.fn(() => element),
      getGroup: vi.fn(() => null),
    };
    const doc = {
      getBlocksByFlavour: vi.fn((flavour: string) =>
        flavour === 'affine:surface' ? [{ model: surface }] : []
      ),
      load: vi.fn(),
      spaceDoc: {},
      transact: vi.fn((callback: () => void) => callback()),
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };

    await expect(
      applyActionProposalToWorkspace({
        docsService: {} as never,
        mindmapProvider: {} as never,
        proposal: {
          docId: 'doc-1',
          markdown: '- Root',
          type: 'create_mindmap',
        },
        workspace: workspace as never,
      })
    ).rejects.toThrow('rolled back the AI mindmap');
    expect(deleteElement).toHaveBeenCalledWith(element.id);
  });

  test('undoes the exact replacement item if revision capture fails', async () => {
    const item = { meta: new Map<string, string>() };
    const undoStack: Array<{ meta: Map<string, string> }> = [];
    const undo = vi.fn(() => {
      expect(undoStack.at(-1)).toBe(item);
      undoStack.pop();
    });
    vi.mocked(getSelections).mockReturnValueOnce({
      selectedBlocks: [{ model: { id: 'selected-block' } }],
    } as never);
    vi.mocked(replaceEditorSelection).mockImplementationOnce(async () => {
      undoStack.push(item);
    });
    const host = {
      selection: { find: vi.fn(() => null) },
      store: {
        captureSync: vi.fn(),
        history: { undoManager: { undo, undoStack } },
        spaceDoc: {},
      },
    };

    await expect(
      applyActionProposalToWorkspace({
        docsService: {} as never,
        proposal: {
          docId: 'doc-1',
          markdown: 'Replacement',
          type: 'replace_selection',
        },
        replaceEditorContainer: {
          doc: { id: 'doc-1' },
          host,
        } as never,
        workspace: {} as never,
      })
    ).rejects.toThrow('rolled back the AI replacement');
    expect(undo).toHaveBeenCalledOnce();
    expect(undoStack).toEqual([]);
  });

  function editorUndoFixture(undoStack: { meta: Map<string, string> }[]) {
    const spaceDoc = new Y.Doc();
    spaceDoc.getMap<string>('content').set('body', 'AI replacement');
    const undo = vi.fn();
    const doc = {
      history: {
        undoManager: {
          undo,
          undoStack,
        },
      },
      load: vi.fn(),
      spaceDoc,
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };
    return {
      doc,
      fingerprint: documentStateVectorFingerprint(doc),
      spaceDoc,
      undo,
      workspace,
    };
  }

  test('undoes an AI selection replacement only while it is the latest edit', () => {
    const undoStackToken = 'ai-history-token';
    const fixture = editorUndoFixture([
      { meta: new Map() },
      { meta: new Map() },
      {
        meta: new Map([['nota-ai-action-undo-token', undoStackToken]]),
      },
    ]);

    undoActionProposalInWorkspace({
      docsService: {} as never,
      undo: {
        docId: 'doc-1',
        fingerprint: fixture.fingerprint,
        type: 'editor_history',
        undoStackDepth: 3,
        undoStackToken,
      },
      workspace: fixture.workspace as never,
    });

    expect(fixture.doc.load).toHaveBeenCalled();
    expect(fixture.undo).toHaveBeenCalledOnce();
  });

  test('preserves newer note edits when an AI replacement is no longer latest', () => {
    const fixture = editorUndoFixture([
      { meta: new Map() },
      { meta: new Map() },
      { meta: new Map() },
      {
        meta: new Map([['nota-ai-action-undo-token', 'ai-history-token']]),
      },
    ]);

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          docId: 'doc-1',
          fingerprint: fixture.fingerprint,
          type: 'editor_history',
          undoStackDepth: 3,
          undoStackToken: 'ai-history-token',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('changed after the AI replacement');
    expect(fixture.undo).not.toHaveBeenCalled();
  });

  test('preserves a newer edit that reuses the AI history depth', () => {
    const fixture = editorUndoFixture([
      { meta: new Map() },
      { meta: new Map() },
      {
        meta: new Map([['nota-ai-action-undo-token', 'newer-user-edit-token']]),
      },
    ]);

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          docId: 'doc-1',
          fingerprint: fixture.fingerprint,
          type: 'editor_history',
          undoStackDepth: 3,
          undoStackToken: 'ai-history-token',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('changed after the AI replacement');
    expect(fixture.undo).not.toHaveBeenCalled();
  });

  test('preserves remote note edits that do not change local history depth', () => {
    const fixture = editorUndoFixture([
      { meta: new Map() },
      { meta: new Map() },
      {
        meta: new Map([['nota-ai-action-undo-token', 'ai-history-token']]),
      },
    ]);
    fixture.spaceDoc
      .getMap<string>('content')
      .set('remote-edit', 'New collaborator content');

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          docId: 'doc-1',
          fingerprint: fixture.fingerprint,
          type: 'editor_history',
          undoStackDepth: 3,
          undoStackToken: 'ai-history-token',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('changed after the AI replacement');
    expect(fixture.undo).not.toHaveBeenCalled();
  });

  test('refuses unsafe undo for older untagged editor proposals', () => {
    const legacyResult = {
      ...stored(
        {
          docId: 'doc-1',
          markdown: 'Replacement',
          type: 'replace_selection',
        },
        'applied'
      ),
      result: {
        undo: {
          docId: 'doc-1',
          type: 'editor_history',
          undoStackDepth: 3,
        },
      },
    };

    expect(canUndoAppliedProposal(legacyResult)).toBe(false);
    expect(undoInfo(legacyResult)).toBeNull();
  });

  function blockUndoFixture() {
    type MockBlock = {
      children: MockBlock[];
      flavour: string;
      id: string;
      keys: string[];
      props: Record<string, unknown>;
      store: { getParent: (block: { id: string }) => MockBlock | null };
      version: number;
    };
    const parents = new Map<string, MockBlock>();
    const store = {
      getParent: (block: { id: string }) => parents.get(block.id) ?? null,
    };
    const model = (id: string, text = ''): MockBlock => ({
      children: [],
      flavour: 'affine:paragraph',
      id,
      keys: ['text'],
      props: { text },
      store,
      version: 1,
    });
    const parentA = model('parent-a');
    const parentB = model('parent-b');
    const first = model('ai-first', 'First AI block');
    const second = model('ai-second', 'Second AI block');
    parentA.children = [first, second];
    parents.set(first.id, parentA);
    parents.set(second.id, parentA);
    const blocks = new Map(
      [parentA, parentB, first, second].map(block => [block.id, block])
    );
    const deleteBlock = vi.fn((block: MockBlock) => {
      const parent = parents.get(block.id);
      if (parent) {
        parent.children = parent.children.filter(
          child => child.id !== block.id
        );
      }
      parents.delete(block.id);
      blocks.delete(block.id);
    });
    const spaceDoc = new Y.Doc();
    spaceDoc.getMap<string>('content').set('body', 'AI insertion');
    const doc = {
      deleteBlock,
      getBlock: (id: string) => {
        const block = blocks.get(id);
        return block ? { model: block } : null;
      },
      load: vi.fn(),
      spaceDoc,
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };
    const target = (block: MockBlock) => ({
      fingerprint: blockUndoFingerprint(block as never),
      id: block.id,
    });
    return {
      deleteBlock,
      doc,
      documentFingerprint: documentStateVectorFingerprint(doc),
      first,
      parentA,
      parentB,
      parents,
      second,
      spaceDoc,
      target,
      workspace,
    };
  }

  test('deletes unchanged fingerprinted blocks atomically', () => {
    const fixture = blockUndoFixture();

    undoActionProposalInWorkspace({
      docsService: {} as never,
      undo: {
        documentFingerprint: fixture.documentFingerprint,
        docId: 'doc-1',
        targets: [
          fixture.target(fixture.first),
          fixture.target(fixture.second),
        ],
        type: 'delete_blocks',
      },
      workspace: fixture.workspace as never,
    });

    expect(fixture.deleteBlock).toHaveBeenCalledTimes(2);
  });

  test('preserves an AI block after a later content edit', () => {
    const fixture = blockUndoFixture();
    const target = fixture.target(fixture.first);
    fixture.first.props.text = 'User edited this block';

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          documentFingerprint: fixture.documentFingerprint,
          docId: 'doc-1',
          target,
          type: 'delete_block',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('AI-created content changed');
    expect(fixture.deleteBlock).not.toHaveBeenCalled();
  });

  test('preserves an AI block after it is moved or reparented', () => {
    const fixture = blockUndoFixture();
    const target = fixture.target(fixture.first);
    fixture.parentA.children = fixture.parentA.children.filter(
      child => child.id !== fixture.first.id
    );
    fixture.parentB.children.push(fixture.first);
    fixture.parents.set(fixture.first.id, fixture.parentB);

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          documentFingerprint: fixture.documentFingerprint,
          docId: 'doc-1',
          target,
          type: 'delete_block',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('AI-created content changed');
    expect(fixture.deleteBlock).not.toHaveBeenCalled();
  });

  test('does not partially delete when one of several AI blocks changed', () => {
    const fixture = blockUndoFixture();
    const targets = [
      fixture.target(fixture.first),
      fixture.target(fixture.second),
    ];
    fixture.second.props.text = 'New user work';

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          documentFingerprint: fixture.documentFingerprint,
          docId: 'doc-1',
          targets,
          type: 'delete_blocks',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('AI-created content changed');
    expect(fixture.deleteBlock).not.toHaveBeenCalled();
  });

  test('preserves inserted blocks when another document dependency changes', () => {
    const fixture = blockUndoFixture();
    const target = fixture.target(fixture.first);
    fixture.spaceDoc
      .getMap<string>('content')
      .set('linked-reference', 'User linked this content elsewhere');

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          documentFingerprint: fixture.documentFingerprint,
          docId: 'doc-1',
          target,
          type: 'delete_block',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('AI-created content changed');
    expect(fixture.deleteBlock).not.toHaveBeenCalled();
  });

  function documentUndoFixture() {
    const spaceDoc = new Y.Doc();
    const content = spaceDoc.getMap<string>('content');
    content.set('body', 'AI-created note');
    const title = { value: 'AI-created note' };
    const moveToTrash = vi.fn();
    const record = {
      getPrimaryMode: () => 'page',
      getProperties: () => ({ id: 'doc-1' }),
      moveToTrash,
    };
    Reflect.set(record, ['title', '$'].join(''), title);
    const doc = { load: vi.fn(), spaceDoc };
    const list = {
      [['doc', '$'].join('')]: vi.fn(() => ({ value: record })),
    };
    const docsService = {
      list,
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };
    const fingerprint = createdDocumentUndoFingerprint({
      docId: 'doc-1',
      docsService: docsService as never,
      workspace: workspace as never,
    });
    if (!fingerprint) throw new Error('Expected document fingerprint.');
    return {
      content,
      docsService,
      fingerprint,
      moveToTrash,
      title,
      workspace,
    };
  }

  test('trashes an unchanged AI-created document', () => {
    const fixture = documentUndoFixture();

    undoActionProposalInWorkspace({
      docsService: fixture.docsService as never,
      undo: {
        docId: 'doc-1',
        fingerprint: fixture.fingerprint,
        type: 'trash_doc',
      },
      workspace: fixture.workspace as never,
    });

    expect(fixture.moveToTrash).toHaveBeenCalledOnce();
  });

  test('preserves an AI-created document after later content or title edits', () => {
    for (const edit of [
      (fixture: ReturnType<typeof documentUndoFixture>) =>
        fixture.content.set('body', 'User-edited note'),
      (fixture: ReturnType<typeof documentUndoFixture>) => {
        fixture.title.value = 'User-renamed note';
      },
    ]) {
      const fixture = documentUndoFixture();
      edit(fixture);
      expect(() =>
        undoActionProposalInWorkspace({
          docsService: fixture.docsService as never,
          undo: {
            docId: 'doc-1',
            fingerprint: fixture.fingerprint,
            type: 'trash_doc',
          },
          workspace: fixture.workspace as never,
        })
      ).toThrow('AI-created content changed');
      expect(fixture.moveToTrash).not.toHaveBeenCalled();
    }
  });

  function surfaceUndoFixture() {
    let present = true;
    const state = {
      id: 'mindmap-1',
      index: 'a0',
      type: 'mindmap',
      xywh: '[0,0,320,180]',
    };
    const element = { id: state.id, serialize: () => ({ ...state }) };
    const deleteElement = vi.fn(() => {
      present = false;
    });
    const surface = {
      deleteElement,
      getElementById: (id: string) =>
        present && id === element.id ? element : null,
      getGroup: () => null,
    };
    const spaceDoc = new Y.Doc();
    const content = spaceDoc.getMap<string>('content');
    content.set('mindmap', 'AI mindmap');
    const doc = {
      getBlocksByFlavour: vi.fn((flavour: string) =>
        flavour === 'affine:surface' ? [{ model: surface }] : []
      ),
      load: vi.fn(),
      spaceDoc,
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };
    const fingerprint = surfaceElementUndoFingerprint(
      surface as never,
      element.id
    );
    if (!fingerprint) throw new Error('Expected surface fingerprint.');
    return {
      content,
      deleteElement,
      documentFingerprint: documentStateVectorFingerprint(doc),
      element,
      fingerprint,
      state,
      workspace,
    };
  }

  test('deletes an unchanged AI-created mindmap', () => {
    const fixture = surfaceUndoFixture();

    undoActionProposalInWorkspace({
      docsService: {} as never,
      undo: {
        documentFingerprint: fixture.documentFingerprint,
        docId: 'doc-1',
        target: { fingerprint: fixture.fingerprint, id: fixture.element.id },
        type: 'delete_surface_element',
      },
      workspace: fixture.workspace as never,
    });

    expect(fixture.deleteElement).toHaveBeenCalledWith('mindmap-1');
  });

  test('preserves a mindmap after a later geometry or content edit', () => {
    const fixture = surfaceUndoFixture();
    fixture.state.xywh = '[20,20,320,180]';

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          documentFingerprint: fixture.documentFingerprint,
          docId: 'doc-1',
          target: { fingerprint: fixture.fingerprint, id: fixture.element.id },
          type: 'delete_surface_element',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('AI-created content changed');
    expect(fixture.deleteElement).not.toHaveBeenCalled();
  });

  test('preserves a mindmap after a descendant or connector edit', () => {
    const fixture = surfaceUndoFixture();
    fixture.content.set('child-shape', 'User-edited descendant node');

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          documentFingerprint: fixture.documentFingerprint,
          docId: 'doc-1',
          target: { fingerprint: fixture.fingerprint, id: fixture.element.id },
          type: 'delete_surface_element',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('AI-created content changed');
    expect(fixture.deleteElement).not.toHaveBeenCalled();
  });

  test('rejects legacy ID-only destructive undo metadata', () => {
    for (const undo of [
      { docId: 'doc-1', type: 'trash_doc' },
      { blockId: 'block-1', docId: 'doc-1', type: 'delete_block' },
      {
        blockIds: ['block-1'],
        docId: 'doc-1',
        type: 'delete_blocks',
      },
      {
        docId: 'doc-1',
        elementId: 'element-1',
        type: 'delete_surface_element',
      },
    ]) {
      const legacy = {
        ...stored(
          { docId: 'doc-1', markdown: 'Append', type: 'insert_markdown' },
          'applied'
        ),
        result: { undo },
      };
      expect(canUndoAppliedProposal(legacy)).toBe(false);
      expect(undoInfo(legacy)).toBeNull();
    }

    expect(
      buildAppliedActionProposalResult({
        mutation: { docId: 'doc-1', insertedBlockId: 'legacy-block-id' },
        proposal: {
          docId: 'doc-1',
          markdown: 'Append',
          type: 'insert_markdown',
        },
        workspaceId: 'workspace-1',
      }).undo
    ).toBeUndefined();
  });

  function databaseFixture(options?: {
    fingerprintFailure?: boolean;
    withTitle?: boolean;
  }) {
    const rowModels = new Map<
      string,
      {
        children: { id: string }[];
        flavour: string;
        id: string;
        keys: string[];
        props: Record<string, unknown>;
        version: number;
      }
    >();
    const databaseModel = {
      children: [] as Array<{ id: string }>,
      flavour: 'affine:database',
      id: 'database-1',
      props: {
        cells: {} as Record<string, Record<string, unknown>>,
        columns: [
          ...(options?.withTitle === false
            ? []
            : [
                {
                  data: {},
                  id: 'existing-title',
                  name: 'Task',
                  type: 'title',
                },
              ]),
          {
            data: {},
            id: 'existing-owner',
            name: 'Owner',
            type: 'rich-text',
          },
        ],
        views: [] as object[],
      },
      store: null as never,
    };
    let nextRow = 1;
    const doc = {
      addBlock: vi.fn(() => {
        const id = `generated-row-${nextRow++}`;
        const row = {
          children: [],
          flavour: 'affine:paragraph',
          id,
          keys: options?.fingerprintFailure
            ? (Object.defineProperty([], 'map', {
                value: () => {
                  throw new Error('forced database fingerprint failure');
                },
              }) as string[])
            : ['text', 'type'],
          props: { text: null, type: 'text' },
          version: 1,
        };
        rowModels.set(id, row);
        databaseModel.children.push(row);
        return id;
      }),
      deleteBlock: vi.fn((row: { id: string }) => {
        rowModels.delete(row.id);
        databaseModel.children = databaseModel.children.filter(
          candidate => candidate.id !== row.id
        );
      }),
      getBlock: vi.fn((id: string) => {
        const model = rowModels.get(id);
        return model ? { model } : null;
      }),
      getModelById: vi.fn((id: string) =>
        id === databaseModel.id ? databaseModel : rowModels.get(id)
      ),
      load: vi.fn(),
      updateBlock: vi.fn((id: string, props: Record<string, unknown>) => {
        const row = rowModels.get(id);
        if (row) Object.assign(row.props, props);
      }),
    };
    databaseModel.store = doc as never;
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };
    const append = (markdown?: string) =>
      appendRowsToDatabaseDoc({
        databaseBlockId: databaseModel.id,
        docId: 'doc-1',
        markdown:
          markdown ??
          [
            '| Task | Owner | Status |',
            '| --- | --- | --- |',
            '| Review plan | Kunj | In progress |',
          ].join('\n'),
        workspace: workspace as never,
      });
    return { append, databaseModel, doc, rowModels, workspace };
  }

  test('undoes unchanged AI database rows and columns while preserving schema', () => {
    const fixture = databaseFixture();
    const appended = fixture.append();

    undoActionProposalInWorkspace({
      docsService: {} as never,
      undo: {
        columnTargets: appended.columnTargets,
        databaseBlockId: 'database-1',
        docId: 'doc-1',
        rowTargets: appended.rowTargets,
        type: 'delete_database_rows',
      },
      workspace: fixture.workspace as never,
    });

    expect(fixture.doc.deleteBlock).toHaveBeenCalledOnce();
    expect(
      fixture.databaseModel.props.columns.map(column => column.id)
    ).toEqual(['existing-title', 'existing-owner']);
  });

  test('refuses database undo after a later row edit', () => {
    const fixture = databaseFixture();
    const appended = fixture.append();
    const row = fixture.rowModels.get(appended.rowTargets[0].id);
    if (!row) throw new Error('Expected generated row.');
    row.props.text = 'User-edited title';

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          columnTargets: appended.columnTargets,
          databaseBlockId: 'database-1',
          docId: 'doc-1',
          rowTargets: appended.rowTargets,
          type: 'delete_database_rows',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('database changed after the AI action');
    expect(fixture.doc.deleteBlock).not.toHaveBeenCalled();
  });

  test('refuses database undo after a later created-column edit', () => {
    const fixture = databaseFixture();
    const appended = fixture.append();
    const column = fixture.databaseModel.props.columns.find(
      candidate => candidate.id === appended.columnTargets[0].id
    );
    if (!column) throw new Error('Expected generated column.');
    column.name = 'User renamed status';

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          columnTargets: appended.columnTargets,
          databaseBlockId: 'database-1',
          docId: 'doc-1',
          rowTargets: appended.rowTargets,
          type: 'delete_database_rows',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('database changed after the AI action');
    expect(fixture.doc.deleteBlock).not.toHaveBeenCalled();
  });

  test('refuses database undo after another row changes table membership', () => {
    const fixture = databaseFixture();
    const appended = fixture.append();
    fixture.doc.addBlock();

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          columnTargets: appended.columnTargets,
          databaseBlockId: 'database-1',
          docId: 'doc-1',
          rowTargets: appended.rowTargets,
          type: 'delete_database_rows',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('database changed after the AI action');
    expect(fixture.doc.deleteBlock).not.toHaveBeenCalled();
  });

  test('refuses database undo after a view edit with no created columns', () => {
    const fixture = databaseFixture();
    const appended = fixture.append(
      ['| Task | Owner |', '| --- | --- |', '| Review | Kunj |'].join('\n')
    );
    expect(appended.columnTargets).toEqual([]);
    fixture.databaseModel.props.views.push({ id: 'new-user-view' });

    expect(() =>
      undoActionProposalInWorkspace({
        docsService: {} as never,
        undo: {
          columnTargets: appended.columnTargets,
          databaseBlockId: 'database-1',
          docId: 'doc-1',
          rowTargets: appended.rowTargets,
          type: 'delete_database_rows',
        },
        workspace: fixture.workspace as never,
      })
    ).toThrow('database changed after the AI action');
    expect(fixture.doc.deleteBlock).not.toHaveBeenCalled();
  });

  test('keeps a repaired fixed title column when undoing appended rows', () => {
    const fixture = databaseFixture({ withTitle: false });
    const appended = fixture.append();
    expect(
      appended.columnTargets.some(target =>
        fixture.databaseModel.props.columns.some(
          column => column.id === target.id && column.type === 'title'
        )
      )
    ).toBe(false);

    undoActionProposalInWorkspace({
      docsService: {} as never,
      undo: {
        columnTargets: appended.columnTargets,
        databaseBlockId: 'database-1',
        docId: 'doc-1',
        rowTargets: appended.rowTargets,
        type: 'delete_database_rows',
      },
      workspace: fixture.workspace as never,
    });

    expect(
      fixture.databaseModel.props.columns.some(
        column => column.type === 'title'
      )
    ).toBe(true);
    expect(fixture.databaseModel.children).toEqual([]);
  });

  test('rolls back database rows and removable columns if undo capture fails', () => {
    const fixture = databaseFixture({ fingerprintFailure: true });

    expect(() => fixture.append()).toThrow(
      'rolled back the AI database append'
    );
    expect(fixture.databaseModel.children).toEqual([]);
    expect(
      fixture.databaseModel.props.columns.map(column => column.id)
    ).toEqual(['existing-title', 'existing-owner']);
  });

  test('inserts Markdown at the requested start or end of a note', async () => {
    const page = {
      id: 'page-1',
      model: {
        children: [
          { flavour: 'affine:surface', id: 'surface-1' },
          { flavour: 'affine:note', id: 'note-1' },
        ],
      },
    };
    const addBlock = vi
      .fn()
      .mockReturnValueOnce('inserted-start')
      .mockReturnValueOnce('inserted-end');
    const doc = {
      addBlock,
      getBlocksByFlavour: vi.fn(() => [page]),
      load: vi.fn(),
    };
    const workspace = {
      getDoc: vi.fn(() => ({ getStore: () => doc })),
    };

    await appendMarkdownToDoc({
      docId: 'doc-1',
      markdown: 'At start',
      position: 'start',
      workspace: workspace as never,
    });
    await appendMarkdownToDoc({
      docId: 'doc-1',
      markdown: 'At end',
      position: 'end',
      workspace: workspace as never,
    });

    expect(addBlock).toHaveBeenNthCalledWith(1, 'affine:note', {}, 'page-1', 1);
    expect(addBlock).toHaveBeenNthCalledWith(
      2,
      'affine:note',
      {},
      'page-1',
      undefined
    );
  });

  test('creates a mindmap through mocked workspace doc and surface objects', () => {
    const addElement = vi.fn(() => 'element-1');
    const surface = { addElement };
    const doc = {
      getBlocksByFlavour: vi.fn((flavour: string) =>
        flavour === 'affine:surface' ? [{ model: surface }] : []
      ),
      load: vi.fn(),
      transact: vi.fn((callback: () => void) => callback()),
    };
    const workspace = {
      getDoc: vi.fn(() => ({
        getStore: () => doc,
      })),
    };

    expect(
      createMindmapInDoc({
        docId: 'doc-1',
        markdown: '- Root',
        provider: {} as never,
        workspace: workspace as never,
      })
    ).toEqual({ docId: 'doc-1', elementId: 'element-1' });

    expect(doc.load).toHaveBeenCalled();
    expect(doc.transact).toHaveBeenCalled();
    expect(addElement).toHaveBeenCalledWith({
      children: { children: [], text: 'Root' },
      style: 'four',
      type: 'mindmap',
    });
  });
});
