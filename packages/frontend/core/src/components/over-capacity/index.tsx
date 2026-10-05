import { notify } from '@nota/component';
import { WorkspacePermissionService } from '@nota/core/modules/permissions';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useLiveData, useService } from '@nota/infra';
import type { BlobSyncState } from '@nota/nbstore';
import { debounce } from 'lodash-es';
import { useEffect } from 'react';

/**
 * TODO(eyhn): refactor this
 */
export const OverCapacityNotification = () => {
  const currentWorkspace = useService(WorkspaceService).workspace;
  const permissionService = useService(WorkspacePermissionService);
  const isOwner = useLiveData(permissionService.permission.isOwner$);
  useEffect(() => {
    // revalidate permission
    permissionService.permission.revalidate();
  }, [permissionService]);

  // debounce sync engine status
  useEffect(() => {
    const disposableOverCapacity =
      currentWorkspace.engine.blob.state$.subscribe(
        debounce(({ overCapacity }: BlobSyncState) => {
          const isOver = overCapacity;
          if (!isOver) {
            return;
          }
          if (isOwner) {
            notify.warning({
              title: 'Workspace storage is full',
              message:
                'This workspace cannot sync because its connected storage is full. Remove unneeded files or free space in the connected storage, then try again.',
            });
          } else {
            notify.warning({
              title: 'Workspace storage is full',
              message:
                'This workspace cannot sync because its connected storage is full. Ask the workspace owner to free space, then try again.',
            });
          }
        })
      );
    return () => {
      disposableOverCapacity?.unsubscribe();
    };
  }, [currentWorkspace, isOwner]);

  return null;
};
