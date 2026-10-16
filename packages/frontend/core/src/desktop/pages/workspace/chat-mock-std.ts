import { BlockStdScope } from '@blocksuite/affine/std';
import type { Workspace } from '@blocksuite/affine/store';
import { getViewManager } from '@nota/core/blocksuite/manager/view';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useService } from '@nota/infra';
import { useMemo } from 'react';

// Chat content renders through an editor host. When no live editor is open
// for the chat's note, a detached one is created for rendering and doc links.
export function createMockStd(workspace: Workspace, docId?: string) {
  workspace.meta.initialize();
  const store = docId
    ? workspace.docs.get(docId)?.getStore()
    : workspace.docs.values().next().value?.getStore();
  if (!store) return null;
  const std = new BlockStdScope({
    store,
    extensions: [...getViewManager().config.init().value.get('page')],
  });
  std.render();
  return std;
}

// Created once per note and kept. It is never mounted, so calling unmount()
// would unbalance shared lifecycle state (for example the code highlighter's
// reference count) used by live editors.
export function useMockStd(docId?: string) {
  const workspace = useService(WorkspaceService).workspace;
  return useMemo(() => {
    if (!workspace) return null;
    return createMockStd(workspace.docCollection, docId);
  }, [docId, workspace]);
}
