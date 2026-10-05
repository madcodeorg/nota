import {
  DatabaseBlockDataSource,
  databaseBlockProperties,
} from '@blocksuite/affine/blocks/database';
import type { SurfaceBlockModel } from '@blocksuite/affine/blocks/surface';
import type { ServiceProvider } from '@blocksuite/affine/global/di';
import {
  type DatabaseBlockModel,
  MindmapStyle,
} from '@blocksuite/affine/model';
import { TextSelection } from '@blocksuite/affine/std';
import {
  type BlockModel,
  Text,
  toJSON,
  type Workspace,
} from '@blocksuite/affine/store';
import { MarkdownTransformer } from '@blocksuite/affine/widgets/linked-doc';
import { markdownToMindmap } from '@nota/core/blocksuite/ai/mini-mindmap';
import {
  insert as insertEditorMarkdown,
  replace as replaceEditorSelection,
} from '@nota/core/blocksuite/ai/utils/editor-actions';
import { getSelections } from '@nota/core/blocksuite/ai/utils/selection-utils';
import type { AffineEditorContainer } from '@nota/core/blocksuite/block-suite-editor';
import { getStoreManager } from '@nota/core/blocksuite/manager/store';
import type { DocsService } from '@nota/core/modules/doc';
import { getAFFiNEWorkspaceSchema } from '@nota/core/modules/workspace';
import { encodeStateVector } from 'yjs';

import {
  type ActionApplyMutationResult,
  type ActionUndoTarget,
  type AgentActionProposal,
  type AgentActionUndo,
  type DatabaseActionUndoTarget,
  databaseMarkdown,
  normalizeDatabaseHeader,
  parseDatabaseMarkdown,
} from './action-proposals';

const EDITOR_HISTORY_UNDO_TOKEN_META_KEY = 'nota-ai-action-undo-token';
const DATABASE_UNDO_CHANGED_MESSAGE =
  'This database changed after the AI action. Review the newer row or column edits before undoing the AI action.';
const DESTRUCTIVE_UNDO_CHANGED_MESSAGE =
  'This AI-created content changed after the action. Review the newer edits before removing it.';

function canonicalizeFingerprintValue(value: unknown): unknown {
  const json = toJSON(value);
  if (Array.isArray(json)) {
    return json.map(canonicalizeFingerprintValue);
  }
  if (json && typeof json === 'object') {
    return Object.fromEntries(
      Object.entries(json)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeFingerprintValue(entry)])
    );
  }
  return json;
}

function actionUndoFingerprint(value: unknown) {
  return JSON.stringify(canonicalizeFingerprintValue(value));
}

function blockUndoSnapshot(block: BlockModel): unknown {
  return {
    children: block.children.map(blockUndoSnapshot),
    flavour: block.flavour,
    id: block.id,
    props: Object.fromEntries(
      block.keys.map(key => [key, Reflect.get(block.props, key)])
    ),
    version: block.version,
  };
}

export function blockUndoFingerprint(block: BlockModel) {
  const parent = block.store.getParent(block);
  return actionUndoFingerprint({
    block: blockUndoSnapshot(block),
    parentId: parent?.id ?? null,
    siblingIndex:
      parent?.children.findIndex(child => child.id === block.id) ?? -1,
  });
}

function captureBlockUndoTargets(options: {
  blockIds: string[];
  docId: string;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) return [];
  doc.load();
  const targets = options.blockIds.map(blockId => {
    const block = doc.getBlock(blockId)?.model;
    return block
      ? ({
          fingerprint: blockUndoFingerprint(block),
          id: blockId,
        } satisfies ActionUndoTarget)
      : null;
  });
  return targets.every((target): target is ActionUndoTarget => !!target)
    ? targets
    : [];
}

function requireInsertedBlockUndoTargets(options: {
  blockIds: string[];
  docId: string;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(
      `Doc not found after inserting AI content: ${options.docId}`
    );
  }
  try {
    const targets = captureBlockUndoTargets(options);
    if (targets.length !== options.blockIds.length) {
      throw new Error('Inserted block fingerprint capture was incomplete.');
    }
    return {
      documentFingerprint: documentStateVectorFingerprint(doc),
      targets,
    };
  } catch (error) {
    for (const blockId of options.blockIds) {
      const block = doc.getBlock(blockId)?.model;
      if (block) doc.deleteBlock(block);
    }
    throw new Error(
      `Nota rolled back the AI insertion because safe Undo metadata could not be captured. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function surfaceElementUndoFingerprint(
  surface: SurfaceBlockModel,
  elementId: string
) {
  const element = surface.getElementById(elementId);
  if (
    !element ||
    !('serialize' in element) ||
    typeof element.serialize !== 'function'
  ) {
    return null;
  }
  return actionUndoFingerprint({
    element: element.serialize(),
    groupId: surface.getGroup(elementId)?.id ?? null,
  });
}

function captureSurfaceElementUndoTarget(options: {
  docId: string;
  elementId: string;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) return null;
  doc.load();
  const surface = doc.getBlocksByFlavour('affine:surface')[0]?.model as
    | SurfaceBlockModel
    | undefined;
  const fingerprint = surface
    ? surfaceElementUndoFingerprint(surface, options.elementId)
    : null;
  return fingerprint
    ? {
        documentFingerprint: documentStateVectorFingerprint(doc),
        target: {
          fingerprint,
          id: options.elementId,
        } satisfies ActionUndoTarget,
      }
    : null;
}

function requireInsertedSurfaceUndoTarget(options: {
  docId: string;
  elementId: string;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(
      `Doc not found after inserting AI mindmap: ${options.docId}`
    );
  }
  try {
    const captured = captureSurfaceElementUndoTarget(options);
    if (!captured) {
      throw new Error('Inserted mindmap fingerprint capture was incomplete.');
    }
    return captured;
  } catch (error) {
    const surface = doc.getBlocksByFlavour('affine:surface')[0]?.model as
      | SurfaceBlockModel
      | undefined;
    try {
      surface?.deleteElement(options.elementId);
    } catch (rollbackError) {
      throw new Error(
        `Nota could not capture safe Undo metadata or roll back the AI mindmap. ${
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        }`
      );
    }
    throw new Error(
      `Nota rolled back the AI mindmap because safe Undo metadata could not be captured. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function stateVectorFingerprint(value: Uint8Array) {
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function documentStateVectorFingerprint(doc: {
  spaceDoc: Parameters<typeof encodeStateVector>[0];
}) {
  return stateVectorFingerprint(encodeStateVector(doc.spaceDoc));
}

export function createdDocumentUndoFingerprint(options: {
  docId: string;
  docsService: DocsService;
  workspace: Workspace;
}) {
  const record = options.docsService.list.doc$(options.docId).value;
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!record || !doc) return null;
  doc.load();
  return actionUndoFingerprint({
    metadata: {
      primaryMode: record.getPrimaryMode(),
      properties: record.getProperties(),
      title: record.title$.value,
    },
    stateVector: documentStateVectorFingerprint(doc),
  });
}

function databaseRowBlockSnapshot(row: DatabaseBlockModel['children'][number]) {
  return {
    children: row.children.map(child => child.id),
    flavour: row.flavour,
    id: row.id,
    props: Object.fromEntries(
      row.keys.map(key => [key, Reflect.get(row.props, key)])
    ),
    version: row.version,
  };
}

function databaseRowUndoFingerprint(
  databaseModel: DatabaseBlockModel,
  rowId: string
) {
  const rowIndex = databaseModel.children.findIndex(row => row.id === rowId);
  const row = databaseModel.children[rowIndex];
  if (!row) return null;
  return actionUndoFingerprint({
    block: databaseRowBlockSnapshot(row),
    cells: databaseModel.props.cells[rowId] ?? null,
    rowIndex,
    schema: {
      columns: databaseModel.props.columns,
      rowIds: databaseModel.children.map(child => child.id),
      views: databaseModel.props.views,
    },
  });
}

function databaseColumnUndoFingerprint(
  databaseModel: DatabaseBlockModel,
  columnId: string
) {
  const columnIndex = databaseModel.props.columns.findIndex(
    column => column.id === columnId
  );
  const column = databaseModel.props.columns[columnIndex];
  if (!column) return null;
  const cells = Object.fromEntries(
    Object.entries(databaseModel.props.cells).flatMap(([rowId, rowCells]) => {
      const cell = rowCells[columnId];
      return cell ? [[rowId, cell] as const] : [];
    })
  );
  return actionUndoFingerprint({
    cells,
    column,
    columnIndex,
    schema: {
      columns: databaseModel.props.columns,
      rowIds: databaseModel.children.map(child => child.id),
    },
    titleRows:
      column.type === 'title'
        ? databaseModel.children.map(databaseRowBlockSnapshot)
        : undefined,
    views: databaseModel.props.views,
  });
}

function captureDatabaseUndoTargets(
  databaseModel: DatabaseBlockModel,
  rowIds: string[],
  columnIds: string[]
) {
  const capture = (
    ids: string[],
    fingerprint: (id: string) => string | null
  ): DatabaseActionUndoTarget[] =>
    ids.map(id => {
      const value = fingerprint(id);
      if (!value) {
        throw new Error('Could not capture safe database undo metadata.');
      }
      return { fingerprint: value, id };
    });
  return {
    columnTargets: capture(columnIds, id =>
      databaseColumnUndoFingerprint(databaseModel, id)
    ),
    rowTargets: capture(rowIds, id =>
      databaseRowUndoFingerprint(databaseModel, id)
    ),
  };
}

function transformerExtensions() {
  return getStoreManager().config.init().value.get('store');
}

export async function importMarkdownDoc(options: {
  markdown: string;
  title: string;
  workspace: Workspace;
}) {
  const docId = await MarkdownTransformer.importMarkdownToDoc({
    collection: options.workspace,
    schema: getAFFiNEWorkspaceSchema(),
    markdown: options.markdown,
    fileName: options.title,
    extensions: transformerExtensions(),
  });
  if (!docId) {
    throw new Error('Markdown import did not return a document id.');
  }
  return docId;
}

export async function appendMarkdownToDoc(options: {
  docId: string;
  markdown: string;
  position?: 'end' | 'start';
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(`Doc not found: ${options.docId}`);
  }

  doc.load();
  const pageBlock = doc.getBlocksByFlavour('affine:page')[0];
  if (!pageBlock) {
    throw new Error(`Doc has no page block: ${options.docId}`);
  }

  const firstNoteIndex = pageBlock.model.children.findIndex(
    child => child.flavour === 'affine:note'
  );
  const blockId = doc.addBlock(
    'affine:note',
    {},
    pageBlock.id,
    options.position === 'start' && firstNoteIndex >= 0
      ? firstNoteIndex
      : undefined
  );
  await MarkdownTransformer.importMarkdownToBlock({
    doc,
    blockId,
    markdown: options.markdown,
    extensions: transformerExtensions(),
  });
  return {
    blockId,
    docId: options.docId,
  };
}

export async function createDatabaseDoc(options: {
  docsService: DocsService;
  markdown: string;
  title: string;
}) {
  const table = parseDatabaseMarkdown(options.title, options.markdown);
  const headers = table.headers.slice(0, 12);
  const rows = table.rows.length ? table.rows : [[options.title]];
  const record = options.docsService.createDoc({
    title: options.title,
    docProps: {
      onStoreLoad: (doc, { noteId }) => {
        const databaseId = doc.addBlock(
          'affine:database',
          {
            cells: {},
            columns: [],
          },
          noteId
        );
        const databaseModel = doc.getModelById(
          databaseId
        ) as DatabaseBlockModel;
        if (!databaseModel) {
          throw new Error('Database block was not created.');
        }

        databaseModel.props.title = new Text(options.title);
        const dataSource = new DatabaseBlockDataSource(databaseModel);
        dataSource.viewManager.viewAdd('table');
        dataSource.propertyAdd('start', {
          name: headers[0] || 'Title',
          type: databaseBlockProperties.titleColumnConfig.type,
        });
        const propertyIds = headers.slice(1).map((header, index) => {
          return dataSource.propertyAdd('end', {
            name: header || `Column ${index + 2}`,
            type: databaseBlockProperties.richTextColumnConfig.type,
          });
        });

        for (const row of rows) {
          const rowId = dataSource.rowAdd('end');
          const titleText = row[0]?.trim() || 'Untitled';
          doc.updateBlock(rowId, {
            text: new Text(titleText),
          });

          propertyIds.forEach((propertyId, index) => {
            if (!propertyId) {
              return;
            }
            const value = row[index + 1]?.trim();
            if (value) {
              dataSource.cellValueChange(rowId, propertyId, new Text(value));
            }
          });
        }
      },
    },
  });

  return record.id;
}

function findDatabaseModel(options: {
  databaseBlockId?: string;
  docId: string;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(`Doc not found: ${options.docId}`);
  }

  doc.load();
  if (options.databaseBlockId) {
    const model = doc.getModelById(options.databaseBlockId);
    if (model?.flavour !== 'affine:database') {
      throw new Error(`Database block not found: ${options.databaseBlockId}`);
    }
    return {
      databaseModel: model as DatabaseBlockModel,
      doc,
    };
  }

  const databaseModel = doc.getBlocksByFlavour('affine:database')[0]?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) {
    throw new Error(`Doc has no database block: ${options.docId}`);
  }

  return {
    databaseModel,
    doc,
  };
}

export function appendRowsToDatabaseDoc(options: {
  databaseBlockId?: string;
  docId: string;
  markdown: string;
  workspace: Workspace;
}) {
  const table = parseDatabaseMarkdown('Database rows', options.markdown);
  const headers = table.headers.slice(0, 12);
  const rows = table.rows.length ? table.rows : [];
  if (!rows.length) {
    throw new Error('No database rows to append.');
  }

  const { databaseModel, doc } = findDatabaseModel(options);
  const dataSource = new DatabaseBlockDataSource(databaseModel);
  const createdColumnIds: string[] = [];
  const rowIds: string[] = [];
  try {
    if (!databaseModel.props.columns.some(column => column.type === 'title')) {
      // A title property is a fixed BlockSuite database invariant and cannot be
      // removed through propertyDelete. Repair that invariant, but do not claim
      // that Undo will restore the invalid title-less schema.
      dataSource.propertyAdd('start', {
        name: headers[0] || 'Title',
        type: databaseBlockProperties.titleColumnConfig.type,
      });
    }

    const usedColumnIds = new Set<string>();
    const propertyIds = headers.slice(1).map((header, index) => {
      const normalizedHeader = normalizeDatabaseHeader(header);
      const columns = databaseModel.props.columns.filter(
        column => column.type !== 'title'
      );
      const matchingColumn = columns.find(
        column =>
          !usedColumnIds.has(column.id) &&
          normalizeDatabaseHeader(column.name) === normalizedHeader
      );
      const fallbackColumn = columns.find(
        column => !usedColumnIds.has(column.id)
      );
      const column = matchingColumn ?? fallbackColumn;
      if (column) {
        usedColumnIds.add(column.id);
        return column.id;
      }

      const propertyId = dataSource.propertyAdd('end', {
        name: header || `Column ${index + 2}`,
        type: databaseBlockProperties.richTextColumnConfig.type,
      });
      if (propertyId) {
        usedColumnIds.add(propertyId);
        createdColumnIds.push(propertyId);
      }
      return propertyId;
    });

    for (const row of rows) {
      const rowId = dataSource.rowAdd('end');
      rowIds.push(rowId);
      doc.updateBlock(rowId, {
        text: new Text(row[0]?.trim() || 'Untitled'),
      });
      propertyIds.forEach((propertyId, index) => {
        if (!propertyId) {
          return;
        }
        const value = row[index + 1]?.trim();
        if (value) {
          dataSource.cellValueChange(rowId, propertyId, new Text(value));
        }
      });
    }

    const undoTargets = captureDatabaseUndoTargets(
      databaseModel,
      rowIds,
      createdColumnIds
    );

    return {
      columnTargets: undoTargets.columnTargets,
      databaseBlockId: databaseModel.id,
      docId: options.docId,
      rowTargets: undoTargets.rowTargets,
    };
  } catch (error) {
    try {
      dataSource.rowDelete(rowIds);
      for (const columnId of [...createdColumnIds].reverse()) {
        dataSource.propertyDelete(columnId);
      }
    } catch (rollbackError) {
      throw new Error(
        `Nota could not complete or roll back the AI database append. ${
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        }`
      );
    }
    throw new Error(
      `Nota rolled back the AI database append because safe Undo metadata could not be captured. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function createMindmapInDoc(options: {
  docId: string;
  markdown: string;
  provider: ServiceProvider;
  workspace: Workspace;
}) {
  const doc = options.workspace.getDoc(options.docId)?.getStore();
  if (!doc) {
    throw new Error(`Doc not found: ${options.docId}`);
  }

  doc.load();
  const surface = doc.getBlocksByFlavour('affine:surface')[0]?.model as
    | SurfaceBlockModel
    | undefined;
  if (!surface) {
    throw new Error(`Doc has no surface block: ${options.docId}`);
  }

  const node = markdownToMindmap(options.markdown, doc, options.provider);
  if (!node) {
    throw new Error('Mindmap markdown must contain a nested list.');
  }

  let elementId = '';
  doc.transact(() => {
    elementId = surface.addElement({
      type: 'mindmap',
      children: node,
      style: MindmapStyle.FOUR,
    });
  });

  return {
    docId: options.docId,
    elementId,
  };
}

export async function replaceSelectionInActiveEditor(options: {
  editorContainer: AffineEditorContainer;
  markdown: string;
}) {
  const host = options.editorContainer.host;
  if (!host) {
    throw new Error('Open the target document before replacing a selection.');
  }

  const textSelection = host.selection.find(TextSelection);
  const mode = textSelection ? 'flat' : 'highest';
  const { selectedBlocks } = getSelections(host, mode);
  if (!selectedBlocks?.length) {
    throw new Error('Select text or blocks in the target document first.');
  }

  const firstBlock = selectedBlocks[0];
  const selectedModels = selectedBlocks.map(block => block.model);
  const undoStackToken = globalThis.crypto?.randomUUID?.();
  if (!undoStackToken) {
    throw new Error('Secure editor undo tagging is unavailable.');
  }
  const undoManager = host.store.history.undoManager;
  const previousUndoStackItem = undoManager.undoStack.at(-1);
  // Isolate the approved AI edit into its own Yjs undo item. The proposal
  // records the resulting item token and only allows Undo while that exact
  // item is still newest, so a later user edit cannot reuse the same depth.
  host.store.captureSync();
  await replaceEditorSelection(
    host,
    options.markdown,
    firstBlock,
    selectedModels,
    textSelection
  );
  host.store.captureSync();
  const undoStackItem = undoManager.undoStack.at(-1);
  if (!undoStackItem || undoStackItem === previousUndoStackItem) {
    throw new Error(
      'The AI replacement did not create a safe editor history entry.'
    );
  }
  try {
    undoStackItem.meta.set(EDITOR_HISTORY_UNDO_TOKEN_META_KEY, undoStackToken);
    return {
      docId: options.editorContainer.doc.id,
      documentFingerprint: documentStateVectorFingerprint(host.store),
      undoStackDepth: undoManager.undoStack.length,
      undoStackToken,
    };
  } catch (error) {
    if (undoManager.undoStack.at(-1) !== undoStackItem) {
      throw new Error(
        'Nota could not capture safe Undo metadata and the editor history changed before the AI replacement could be rolled back.'
      );
    }
    undoManager.undo();
    throw new Error(
      `Nota rolled back the AI replacement because safe Undo metadata could not be captured. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export async function insertMarkdownAtActiveSelection(options: {
  editorContainer: AffineEditorContainer;
  markdown: string;
}) {
  const host = options.editorContainer.host;
  if (!host) {
    throw new Error(
      'Open the target document before inserting at a selection.'
    );
  }

  const { selectedBlocks } = getSelections(host, 'highest');
  const firstBlock = selectedBlocks?.[0];
  if (!firstBlock) {
    throw new Error('Select text or a block in the target document first.');
  }

  const inserted = await insertEditorMarkdown(
    host,
    options.markdown,
    firstBlock,
    false
  );
  if (!inserted.length) {
    throw new Error('The selected block has no insertion point.');
  }
  return {
    docId: options.editorContainer.doc.id,
    insertedBlockIds: inserted.map(model => model.id),
  };
}

export async function applyActionProposalToWorkspace(options: {
  docsService: DocsService;
  mindmapProvider?: ServiceProvider | null;
  proposal: Exclude<AgentActionProposal, { type: 'run_mcp_tool' }>;
  replaceEditorContainer?: AffineEditorContainer | null;
  workspace: Workspace;
}): Promise<ActionApplyMutationResult> {
  const { proposal, workspace } = options;

  const createdDocumentMutation = (docId: string) => {
    try {
      const createdDocFingerprint = createdDocumentUndoFingerprint({
        docId,
        docsService: options.docsService,
        workspace,
      });
      if (!createdDocFingerprint) {
        throw new Error('Created document fingerprint capture was incomplete.');
      }
      return { createdDocFingerprint, docId };
    } catch (error) {
      try {
        workspace.removeDoc(docId);
      } catch (rollbackError) {
        throw new Error(
          `Nota could not capture safe Undo metadata or remove the incomplete AI document. ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`
        );
      }
      throw new Error(
        `Nota removed the incomplete AI document because safe Undo metadata could not be captured. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  switch (proposal.type) {
    case 'create_note': {
      const docId = await importMarkdownDoc({
        markdown: proposal.markdown,
        title: proposal.title,
        workspace,
      });
      return createdDocumentMutation(docId);
    }
    case 'create_task_list': {
      const markdown = `# ${proposal.title}\n\n${proposal.markdown}`;
      if (proposal.docId) {
        const appended = await appendMarkdownToDoc({
          docId: proposal.docId,
          markdown,
          workspace,
        });
        const undoCapture = requireInsertedBlockUndoTargets({
          blockIds: [appended.blockId],
          docId: appended.docId,
          workspace,
        });
        return {
          docId: appended.docId,
          insertedBlockDocumentFingerprint: undoCapture.documentFingerprint,
          insertedBlockId: appended.blockId,
          insertedBlockTarget: undoCapture.targets[0],
        };
      }
      const docId = await importMarkdownDoc({
        markdown,
        title: proposal.title,
        workspace,
      });
      return createdDocumentMutation(docId);
    }
    case 'create_database': {
      let docId: string;
      try {
        docId = await createDatabaseDoc({
          docsService: options.docsService,
          markdown: proposal.markdown,
          title: proposal.title,
        });
      } catch (error) {
        console.warn(
          'Failed to create native Nota database; falling back to Markdown import.',
          error
        );
        docId = await importMarkdownDoc({
          markdown: databaseMarkdown(proposal.title, proposal.markdown),
          title: proposal.title,
          workspace,
        });
      }
      return createdDocumentMutation(docId);
    }
    case 'insert_markdown': {
      if (proposal.position === 'selection') {
        if (!options.replaceEditorContainer) {
          throw new Error(
            'Open the target document and select text or a block first.'
          );
        }
        const inserted = await insertMarkdownAtActiveSelection({
          editorContainer: options.replaceEditorContainer,
          markdown: proposal.markdown,
        });
        const undoCapture = requireInsertedBlockUndoTargets({
          blockIds: inserted.insertedBlockIds,
          docId: inserted.docId,
          workspace,
        });
        return {
          ...inserted,
          insertedBlockDocumentFingerprint: undoCapture.documentFingerprint,
          insertedBlockTargets: undoCapture.targets,
        };
      }
      const appended = await appendMarkdownToDoc({
        docId: proposal.docId,
        markdown: proposal.markdown,
        position: proposal.position === 'start' ? 'start' : 'end',
        workspace,
      });
      const undoCapture = requireInsertedBlockUndoTargets({
        blockIds: [appended.blockId],
        docId: appended.docId,
        workspace,
      });
      return {
        docId: appended.docId,
        insertedBlockDocumentFingerprint: undoCapture.documentFingerprint,
        insertedBlockId: appended.blockId,
        insertedBlockTarget: undoCapture.targets[0],
      };
    }
    case 'append_database_rows': {
      const appended = appendRowsToDatabaseDoc({
        databaseBlockId: proposal.databaseBlockId,
        docId: proposal.docId,
        markdown: proposal.markdown,
        workspace,
      });
      return {
        databaseBlockId: appended.databaseBlockId,
        databaseColumnTargets: appended.columnTargets,
        databaseRowTargets: appended.rowTargets,
        docId: appended.docId,
      };
    }
    case 'clear_doc':
      throw new Error(
        'Clearing an entire document is disabled until Nota can restore it safely.'
      );
    case 'create_mindmap': {
      if (!options.mindmapProvider) {
        throw new Error('Mindmap apply needs an initialized editor host.');
      }
      const inserted = createMindmapInDoc({
        docId: proposal.docId,
        markdown: proposal.markdown,
        provider: options.mindmapProvider,
        workspace,
      });
      // Let the mindmap's initial layout microtask settle before fingerprinting
      // the exact element state that Undo is allowed to remove.
      await Promise.resolve();
      const undoCapture = requireInsertedSurfaceUndoTarget({
        docId: inserted.docId,
        elementId: inserted.elementId,
        workspace,
      });
      return {
        docId: inserted.docId,
        insertedSurfaceElementId: inserted.elementId,
        insertedSurfaceDocumentFingerprint: undoCapture.documentFingerprint,
        insertedSurfaceElementTarget: undoCapture.target,
      };
    }
    case 'replace_selection': {
      if (!options.replaceEditorContainer) {
        throw new Error(
          'Open the target document and select text or blocks first.'
        );
      }
      const replaced = await replaceSelectionInActiveEditor({
        editorContainer: options.replaceEditorContainer,
        markdown: proposal.markdown,
      });
      return {
        docId: replaced.docId,
        editorDocumentFingerprint: replaced.documentFingerprint,
        editorHistoryDepth: replaced.undoStackDepth,
        editorHistoryToken: replaced.undoStackToken,
      };
    }
  }
}

export function undoActionProposalInWorkspace(options: {
  docsService: DocsService;
  undo: AgentActionUndo;
  workspace: Workspace;
}) {
  const { undo, workspace } = options;
  if (undo.type === 'trash_doc') {
    const docRecord = options.docsService.list.doc$(undo.docId).value;
    if (!docRecord) {
      throw new Error(`Doc not found: ${undo.docId}`);
    }
    const currentFingerprint = createdDocumentUndoFingerprint({
      docId: undo.docId,
      docsService: options.docsService,
      workspace,
    });
    if (currentFingerprint !== undo.fingerprint) {
      throw new Error(DESTRUCTIVE_UNDO_CHANGED_MESSAGE);
    }
    docRecord.moveToTrash();
    return;
  }

  const doc = workspace.getDoc(undo.docId)?.getStore();
  if (!doc) {
    throw new Error(`Doc not found: ${undo.docId}`);
  }
  doc.load();

  if (undo.type === 'editor_history') {
    const undoManager = doc.history.undoManager;
    const undoStackItem = undoManager.undoStack.at(-1);
    if (
      documentStateVectorFingerprint(doc) !== undo.fingerprint ||
      undoManager.undoStack.length !== undo.undoStackDepth ||
      undoStackItem?.meta.get(EDITOR_HISTORY_UNDO_TOKEN_META_KEY) !==
        undo.undoStackToken
    ) {
      throw new Error(
        'This note changed after the AI replacement. Use the editor history to review those newer edits before undoing the AI action.'
      );
    }
    undoManager.undo();
    return;
  }

  if (undo.type === 'delete_block') {
    const block = doc.getBlock(undo.target.id)?.model;
    if (
      documentStateVectorFingerprint(doc) !== undo.documentFingerprint ||
      !block ||
      blockUndoFingerprint(block) !== undo.target.fingerprint
    ) {
      throw new Error(DESTRUCTIVE_UNDO_CHANGED_MESSAGE);
    }
    doc.deleteBlock(block);
    return;
  }

  if (undo.type === 'delete_blocks') {
    const blocks = undo.targets.map(target => doc.getBlock(target.id)?.model);
    const unchanged =
      documentStateVectorFingerprint(doc) === undo.documentFingerprint &&
      undo.targets.every(
        (target, index) =>
          !!blocks[index] &&
          blockUndoFingerprint(blocks[index]) === target.fingerprint
      );
    if (!unchanged) {
      throw new Error(DESTRUCTIVE_UNDO_CHANGED_MESSAGE);
    }
    for (const block of blocks) {
      if (block) doc.deleteBlock(block);
    }
    return;
  }

  if (undo.type === 'delete_database_rows') {
    const databaseModel = doc.getModelById(undo.databaseBlockId);
    if (databaseModel?.flavour !== 'affine:database') {
      throw new Error(`Database block not found: ${undo.databaseBlockId}`);
    }
    const typedDatabaseModel = databaseModel as DatabaseBlockModel;
    const dataSource = new DatabaseBlockDataSource(typedDatabaseModel);
    const rowsUnchanged = undo.rowTargets.every(
      target =>
        databaseRowUndoFingerprint(typedDatabaseModel, target.id) ===
        target.fingerprint
    );
    const columnsUnchanged = undo.columnTargets.every(
      target =>
        databaseColumnUndoFingerprint(typedDatabaseModel, target.id) ===
        target.fingerprint
    );
    if (!rowsUnchanged || !columnsUnchanged) {
      throw new Error(DATABASE_UNDO_CHANGED_MESSAGE);
    }
    dataSource.rowDelete(undo.rowTargets.map(target => target.id));
    for (const target of undo.columnTargets) {
      dataSource.propertyDelete(target.id);
    }
    return;
  }

  const surface = doc.getBlocksByFlavour('affine:surface')[0]?.model as
    | SurfaceBlockModel
    | undefined;
  if (
    documentStateVectorFingerprint(doc) !== undo.documentFingerprint ||
    !surface ||
    surfaceElementUndoFingerprint(surface, undo.target.id) !==
      undo.target.fingerprint
  ) {
    throw new Error(DESTRUCTIVE_UNDO_CHANGED_MESSAGE);
  }
  surface.deleteElement(undo.target.id);
}
