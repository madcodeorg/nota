import type { Workspace } from '@blocksuite/affine/store';
import { WorkspaceImpl } from '@nota/core/modules/workspace/impls/workspace';
import { applyUpdate, Doc as YDoc, encodeStateAsUpdate } from 'yjs';

/** A detached workspace keeps preview transactions away from canonical documents. */
export function createLocalHistoryPreview(
  workspace: Workspace,
  pageId: string,
  bin: Uint8Array
) {
  const shell = new WorkspaceImpl({
    id: workspace.id,
    rootDoc: new YDoc({ guid: workspace.id }),
    blobSource: {
      name: 'local-history',
      readonly: true,
      get: key => workspace.blobSync.get(key),
      set: async () => {
        throw new Error('History preview is read-only.');
      },
      delete: async () => {
        throw new Error('History preview is read-only.');
      },
      list: async () => [],
    },
  });
  try {
    applyUpdate(shell.doc, encodeStateAsUpdate(workspace.doc));
    const doc = shell.getDoc(pageId) ?? shell.createDoc(pageId);
    doc.load();
    applyUpdate(doc.spaceDoc, bin);
    const store = doc.getStore();
    store.readonly = true;
    return {
      store,
      dispose: () => {
        shell.dispose();
        shell.doc.destroy();
      },
    };
  } catch (error) {
    shell.dispose();
    shell.doc.destroy();
    throw error;
  }
}
