import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { notify } from '@nota/component';
import { SettingRow } from '@nota/component/setting-components';
import { ConfirmModal } from '@nota/component/ui/modal';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { GlobalContextService } from '@nota/core/modules/global-context';
import { WorkspacePermissionService } from '@nota/core/modules/permissions';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
  WorkspacesService,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useServices } from '@nota/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { useCallback, useEffect, useState } from 'react';

import {
  RouteLogic,
  useNavigateHelper,
} from '../../../../../../components/hooks/use-navigate-helper';
import { WorkspaceDeleteModal } from './delete';

export const DeleteLeaveWorkspace = ({
  onCloseSetting,
}: {
  onCloseSetting?: () => void;
}) => {
  const {
    workspaceService,
    globalContextService,
    workspacePermissionService,
    workspacesService,
  } = useServices({
    WorkspaceService,
    GlobalContextService,
    WorkspacePermissionService,
    WorkspacesService,
  });
  const t = useI18n();
  const workspace = workspaceService.workspace;
  const { jumpToPage, jumpToIndex } = useNavigateHelper();
  // fixme: cloud regression
  const [showDelete, setShowDelete] = useState(false);
  const [showLeave, setShowLeave] = useState(false);

  const workspaceList = useLiveData(workspacesService.list.workspaces$);
  const currentWorkspaceId = useLiveData(
    globalContextService.globalContext.workspaceId.$
  );

  const serverPermissionIsOwner = useLiveData(
    workspacePermissionService.permission.isOwner$
  );
  const isUserOwnedWorkspace = isUserOwnedWorkspaceFlavour(workspace.flavour);
  const isOwner = isUserOwnedWorkspace || serverPermissionIsOwner === true;
  useEffect(() => {
    if (!isUserOwnedWorkspace) {
      workspacePermissionService.permission.revalidate();
    }
  }, [isUserOwnedWorkspace, workspacePermissionService]);

  const onLeaveOrDelete = useCallback(() => {
    if (isOwner) {
      setShowDelete(true);
    } else if (serverPermissionIsOwner !== null) {
      setShowLeave(true);
    }
  }, [isOwner, serverPermissionIsOwner]);

  const onDeleteConfirm = useAsyncCallback(async () => {
    onCloseSetting?.();

    if (currentWorkspaceId === workspace.id) {
      const backWorkspace = workspaceList.find(
        ws => ws.id !== currentWorkspaceId
      );
      // TODO(@eyhn): if there is no workspace, jump to a new page(wait for design)
      if (backWorkspace) {
        jumpToPage(backWorkspace?.id || '', 'all', RouteLogic.REPLACE);
      } else {
        jumpToIndex(RouteLogic.REPLACE);
      }
    }

    if (isOwner) {
      await workspacesService.deleteWorkspace(workspace.meta);
    } else {
      await workspacePermissionService.leaveWorkspace();
    }
    notify.success({ title: t['Successfully deleted']() });
  }, [
    onCloseSetting,
    currentWorkspaceId,
    workspace.id,
    workspace.meta,
    isOwner,
    t,
    workspaceList,
    jumpToPage,
    jumpToIndex,
    workspacesService,
    workspacePermissionService,
  ]);

  return (
    <>
      <SettingRow
        name={
          <span style={{ color: cssVarV2('status/error') }}>
            {isOwner
              ? t['com.affine.workspaceDelete.title']()
              : t['com.affine.deleteLeaveWorkspace.leave']()}
          </span>
        }
        desc={t['com.affine.deleteLeaveWorkspace.description']()}
        style={{ cursor: 'pointer' }}
        onClick={onLeaveOrDelete}
        data-testid="delete-workspace-button"
      >
        <ArrowRightSmallIcon />
      </SettingRow>
      {isOwner ? (
        <WorkspaceDeleteModal
          onConfirm={onDeleteConfirm}
          open={showDelete}
          onOpenChange={setShowDelete}
          workspaceMetadata={workspace.meta}
        />
      ) : (
        <ConfirmModal
          open={showLeave}
          cancelText={t['com.affine.confirmModal.button.cancel']()}
          onConfirm={onDeleteConfirm}
          onOpenChange={setShowLeave}
          title={`${t['com.affine.deleteLeaveWorkspace.leave']()}?`}
          description={t['com.affine.deleteLeaveWorkspace.leaveDescription']()}
          confirmText={t['Leave']()}
          confirmButtonOptions={{
            variant: 'error',
          }}
        />
      )}
    </>
  );
};
