import { GuardService } from '@nota/core/modules/permissions';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useFramework, useService } from '@nota/infra';
import { useCallback, useEffect } from 'react';

import {
  startWorkspaceContentIndexSync,
  type WorkspaceContentAccessForDocument,
} from './ai-workspace-index';

export function useAIWorkspaceIndex() {
  const framework = useFramework();
  const workspaceService = useService(WorkspaceService);
  const {
    docCollection,
    flavour,
    id: workspaceId,
  } = workspaceService.workspace;

  const accessForDocument = useCallback<WorkspaceContentAccessForDocument>(
    async ({ docId }) => {
      if (isUserOwnedWorkspaceFlavour(flavour)) {
        return { readable: true, visibility: 'workspace' };
      }

      const guardService = framework.getOptional(GuardService);
      if (!guardService) {
        return { readable: false, visibility: 'workspace' };
      }
      try {
        return {
          readable: await guardService.can('Doc_Read', docId),
          visibility: 'workspace',
        };
      } catch (error) {
        console.warn('Failed to check doc read permission for AI index', error);
        return { readable: false, visibility: 'workspace' };
      }
    },
    [flavour, framework]
  );

  useEffect(
    () =>
      startWorkspaceContentIndexSync({
        accessForDocument,
        onError: error => {
          console.warn('Failed to sync workspace content for AI search', error);
        },
        workspace: docCollection,
        workspaceId,
      }),
    [accessForDocument, docCollection, workspaceId]
  );
}
