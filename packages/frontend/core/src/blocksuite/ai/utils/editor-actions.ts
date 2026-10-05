import { clipboardConfigs } from '@blocksuite/affine/foundation/clipboard';
import { defaultImageProxyMiddleware } from '@blocksuite/affine/shared/adapters';
import { replaceSelectedTextWithBlocksCommand } from '@blocksuite/affine/shared/commands';
import { isInsideEdgelessEditor } from '@blocksuite/affine/shared/utils';
import {
  type BlockComponent,
  BlockSelection,
  BlockStdScope,
  Clipboard,
  type EditorHost,
  SurfaceSelection,
  type TextSelection,
} from '@blocksuite/affine/std';
import {
  type BlockModel,
  type BlockProps,
  type BlockSnapshot,
  Slice,
  type Store,
} from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import {
  applyUpdate,
  Doc as YDoc,
  encodeStateAsUpdate,
  encodeStateVector,
} from 'yjs';

import {
  insertFromMarkdown,
  markDownToDoc,
  markdownToSnapshot,
} from '../../utils';
import type { AffineAIPanelWidget } from '../widgets/ai-panel/ai-panel';

const getNoteId = (blockElement: BlockComponent) => {
  let element = blockElement;
  while (element.flavour !== 'affine:note') {
    if (!element.parentComponent) {
      break;
    }
    element = element.parentComponent;
  }

  return element.model.id;
};

const setBlockSelection = (
  host: EditorHost,
  parent: BlockComponent,
  models: BlockModel[]
) => {
  const selections = models
    .map(model => model.id)
    .map(blockId => host.selection.create(BlockSelection, { blockId }));

  if (isInsideEdgelessEditor(host)) {
    const surfaceElementId = getNoteId(parent);
    const surfaceSelection = host.selection.create(
      SurfaceSelection,
      selections[0].blockId,
      [surfaceElementId],
      true
    );

    selections.push(surfaceSelection);
    host.selection.set(selections);
  } else {
    host.selection.setGroup('note', selections);
  }
};

type PreparedBlock = {
  children: PreparedBlock[];
  flavour: string;
  id: string;
  props: Partial<BlockProps>;
};

type AtomicBlockReplacementUpdate = {
  forward: Uint8Array;
  rollback: Uint8Array;
};

const aiReplaceRollbackOrigin = Symbol('nota-ai-replace-rollback');

const prepareBlockTree = async (
  snapshot: BlockSnapshot,
  transformer: ReturnType<Store['getTransformer']>
): Promise<PreparedBlock> => {
  const modelData = await transformer.snapshotToModelData(snapshot);
  if (!modelData || modelData.flavour !== snapshot.flavour) {
    throw new Error(
      `Could not prepare replacement block ${snapshot.id} (${snapshot.flavour}).`
    );
  }

  const children: PreparedBlock[] = [];
  for (const child of snapshot.children) {
    children.push(await prepareBlockTree(child, transformer));
  }

  return {
    children,
    flavour: modelData.flavour,
    id: snapshot.id,
    props: modelData.props,
  };
};

const addPreparedBlock = (
  store: Store,
  block: PreparedBlock,
  parentId: string,
  index?: number
) => {
  store.addBlock(
    block.flavour,
    {
      ...block.props,
      id: block.id,
    },
    parentId,
    index
  );
  block.children.forEach((child, childIndex) => {
    addPreparedBlock(store, child, block.id, childIndex);
  });
};

const assertPreparedBlock = (store: Store, block: PreparedBlock) => {
  const model = store.getModelById(block.id);
  if (
    !model ||
    model.flavour !== block.flavour ||
    model.children.length !== block.children.length ||
    model.children.some((child, index) => child.id !== block.children[index].id)
  ) {
    throw new Error(`Could not stage replacement block ${block.id}.`);
  }

  block.children.forEach(child => assertPreparedBlock(store, child));
};

const createAtomicBlockReplacementUpdate = (options: {
  firstBlockId: string;
  parentId: string;
  preparedBlocks: PreparedBlock[];
  selectedBlockIds: string[];
  store: Store;
}) => {
  const rootDoc = new YDoc({ guid: 'AI_REPLACE_STAGING' });
  const collection = new WorkspaceImpl({
    id: 'AI_REPLACE_STAGING',
    rootDoc,
  });
  collection.meta.initialize();

  try {
    const stagingDoc = collection.createDoc(options.store.id);
    const stagingStore = stagingDoc.getStore();
    stagingDoc.load();

    // Clone the exact current document, then keep its state vector so only the
    // validated replacement delta (never the baseline) reaches the live doc.
    applyUpdate(
      stagingStore.spaceDoc,
      encodeStateAsUpdate(options.store.spaceDoc)
    );
    const baselineStateVector = encodeStateVector(stagingStore.spaceDoc);

    const parent = stagingStore.getModelById(options.parentId);
    const firstBlock = stagingStore.getModelById(options.firstBlockId);
    if (
      !parent ||
      !firstBlock ||
      stagingStore.getParent(firstBlock) !== parent
    ) {
      throw new Error(
        'The selected blocks changed before replacement was ready.'
      );
    }
    const insertIndex = parent.children.findIndex(
      child => child.id === firstBlock.id
    );
    if (insertIndex < 0) {
      throw new Error(
        'The selected blocks changed before replacement was ready.'
      );
    }

    const selectedBlocks = options.selectedBlockIds.map(id => {
      const model = stagingStore.getModelById(id);
      if (!model) {
        throw new Error(
          'The selected blocks changed before replacement was ready.'
        );
      }
      return model;
    });

    const preparedIds = new Set<string>();
    const validatePreparedBlock = (
      block: PreparedBlock,
      parentFlavour: string
    ) => {
      if (preparedIds.has(block.id) || stagingStore.hasBlock(block.id)) {
        throw new Error(`Replacement block id is not unique: ${block.id}.`);
      }
      preparedIds.add(block.id);
      stagingStore.schema.validate(
        block.flavour,
        parentFlavour,
        block.children.map(child => child.flavour)
      );
      block.children.forEach(child =>
        validatePreparedBlock(child, block.flavour)
      );
    };
    options.preparedBlocks.forEach(block =>
      validatePreparedBlock(block, parent.flavour)
    );

    const previousUndoDepth = stagingStore.history.undoManager.undoStack.length;
    stagingStore.captureSync();
    stagingStore.transact(() => {
      selectedBlocks.forEach(model => stagingStore.deleteBlock(model));
      options.preparedBlocks.forEach((block, index) => {
        addPreparedBlock(stagingStore, block, parent.id, insertIndex + index);
      });
    });
    stagingStore.captureSync();

    if (
      options.selectedBlockIds.some(id => stagingStore.hasBlock(id)) ||
      options.preparedBlocks.some(
        (block, index) => parent.children[insertIndex + index]?.id !== block.id
      )
    ) {
      throw new Error('Could not stage the complete block replacement.');
    }
    options.preparedBlocks.forEach(block =>
      assertPreparedBlock(stagingStore, block)
    );

    if (
      stagingStore.history.undoManager.undoStack.length !==
      previousUndoDepth + 1
    ) {
      throw new Error(
        'Could not stage the replacement as one editor history item.'
      );
    }

    const forward = encodeStateAsUpdate(
      stagingStore.spaceDoc,
      baselineStateVector
    );
    const appliedStateVector = encodeStateVector(stagingStore.spaceDoc);
    stagingStore.undo();
    if (
      options.selectedBlockIds.some(id => !stagingStore.hasBlock(id)) ||
      options.preparedBlocks.some(block => stagingStore.hasBlock(block.id))
    ) {
      throw new Error('Could not prepare a safe replacement rollback.');
    }

    return {
      forward,
      rollback: encodeStateAsUpdate(stagingStore.spaceDoc, appliedStateVector),
    } satisfies AtomicBlockReplacementUpdate;
  } finally {
    collection.dispose();
    rootDoc.destroy();
  }
};

const applyAtomicBlockReplacementUpdate = (
  store: Store,
  replacementUpdate: AtomicBlockReplacementUpdate
) => {
  const undoManager = store.history.undoManager;
  const localOrigin = store.spaceDoc.clientID;
  if (!undoManager.trackedOrigins.has(localOrigin)) {
    throw new Error(
      'The editor cannot safely record this replacement in local history.'
    );
  }

  const previousUndoDepth = undoManager.undoStack.length;
  const previousUndoItem = undoManager.undoStack.at(-1);
  const rollback = () => {
    if (undoManager.undoStack.length > previousUndoDepth) {
      while (undoManager.undoStack.length > previousUndoDepth) {
        undoManager.undo();
      }
      undoManager.clear(false, true);
    } else {
      applyUpdate(
        store.spaceDoc,
        replacementUpdate.rollback,
        aiReplaceRollbackOrigin
      );
    }
  };

  store.captureSync();
  let applied = false;
  try {
    applyUpdate(store.spaceDoc, replacementUpdate.forward, localOrigin);
    applied = true;
    const currentUndoItem = undoManager.undoStack.at(-1);
    if (
      undoManager.undoStack.length !== previousUndoDepth + 1 ||
      !currentUndoItem ||
      currentUndoItem === previousUndoItem
    ) {
      throw new Error(
        'The editor did not capture the replacement as one safe history item.'
      );
    }
  } catch (error) {
    if (applied) {
      rollback();
    }
    throw error;
  } finally {
    store.captureSync();
  }
};

export const insert = async (
  host: EditorHost,
  content: string,
  selectBlock: BlockComponent,
  below: boolean = true
) => {
  const blockParent = selectBlock.parentComponent;
  if (!blockParent) return [];
  const index = blockParent.model.children.findIndex(
    model => model.id === selectBlock.model.id
  );
  const insertIndex = below ? index + 1 : index;

  const { store } = host;
  const models = await insertFromMarkdown(
    host,
    content,
    store,
    blockParent.model.id,
    insertIndex
  );
  await host.updateComplete;
  requestAnimationFrame(() => setBlockSelection(host, blockParent, models));
  return models;
};

export const insertBelow = async (
  host: EditorHost,
  content: string,
  selectBlock: BlockComponent
) => {
  await insert(host, content, selectBlock, true);
};

export const insertAbove = async (
  host: EditorHost,
  content: string,
  selectBlock: BlockComponent
) => {
  await insert(host, content, selectBlock, false);
};

export const replace = async (
  host: EditorHost,
  content: string,
  firstBlock: BlockComponent,
  selectedModels: BlockModel[],
  textSelection?: TextSelection
) => {
  const firstBlockParent = firstBlock.parentComponent;
  if (!firstBlockParent) return;

  if (textSelection) {
    const collection = new WorkspaceImpl({
      id: 'AI_REPLACE',
      rootDoc: new YDoc({ guid: 'AI_REPLACE' }),
    });
    collection.meta.initialize();
    const fragmentDoc = collection.createDoc();

    try {
      const fragment = fragmentDoc.getStore();
      fragmentDoc.load();

      const rootId = fragment.addBlock('affine:page');
      fragment.addBlock('affine:surface', {}, rootId);
      const noteId = fragment.addBlock('affine:note', {}, rootId);

      const { snapshot, transformer } = await markdownToSnapshot(
        content,
        fragment,
        host
      );

      if (snapshot) {
        const blockSnapshots = (
          snapshot.content[0].flavour === 'affine:note'
            ? snapshot.content[0].children
            : snapshot.content
        ) as BlockSnapshot[];

        const blocks = (
          await Promise.all(
            blockSnapshots.map(async blockSnapshot => {
              return await transformer.snapshotToBlock(
                blockSnapshot,
                fragment,
                noteId,
                0
              );
            })
          )
        ).filter(block => block) as BlockModel[];
        host.std.command.exec(replaceSelectedTextWithBlocksCommand, {
          textSelection,
          blocks,
        });
      }
    } finally {
      collection.dispose();
    }
  } else {
    const { store } = host;
    const { snapshot, transformer } = await markdownToSnapshot(
      content,
      store,
      host
    );
    const blockSnapshots = snapshot?.content.flatMap(
      contentSnapshot => contentSnapshot.children
    );
    if (!blockSnapshots?.length) {
      throw new Error('The replacement did not produce any editable blocks.');
    }

    const preparedBlocks: PreparedBlock[] = [];
    for (const blockSnapshot of blockSnapshots) {
      preparedBlocks.push(await prepareBlockTree(blockSnapshot, transformer));
    }

    const replacementUpdate = createAtomicBlockReplacementUpdate({
      firstBlockId: firstBlock.model.id,
      parentId: firstBlockParent.model.id,
      preparedBlocks,
      selectedBlockIds: selectedModels.map(model => model.id),
      store,
    });

    // A prebuilt Yjs delta applies every deletion and nested insertion in one
    // synchronous local transaction, independent of Markdown/asset load time.
    applyAtomicBlockReplacementUpdate(store, replacementUpdate);

    const models = preparedBlocks.map(block => store.getModelById(block.id));
    if (models.some(model => !model)) {
      throw new Error('The replacement could not be applied to the editor.');
    }

    await host.updateComplete;
    requestAnimationFrame(() =>
      setBlockSelection(
        host,
        firstBlockParent,
        models.filter((model): model is BlockModel => !!model)
      )
    );
  }
};

export const copyTextAnswer = async (panel: AffineAIPanelWidget) => {
  if (!panel.answer) {
    return false;
  }
  return copyText(panel.answer);
};

export const copyText = async (text: string) => {
  const previewDoc = await markDownToDoc(text, [defaultImageProxyMiddleware]);
  const models = previewDoc
    .getBlocksByFlavour('affine:note')
    .map(b => b.model)
    .flatMap(model => model.children);
  const slice = Slice.fromModels(previewDoc, models);
  const std = new BlockStdScope({
    store: previewDoc,
    extensions: [...clipboardConfigs],
  });
  const clipboard = std.provider.get(Clipboard);
  await clipboard.copySlice(slice);
  previewDoc.dispose();
  return true;
};
