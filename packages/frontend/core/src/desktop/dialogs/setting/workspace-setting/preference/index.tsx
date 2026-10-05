import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@nota/component/setting-components';
import { useWorkspaceInfo } from '@nota/core/components/hooks/use-workspace-info';
import { WorkspaceServerService } from '@nota/core/modules/cloud';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@nota/env/constant';
import { useI18n } from '@nota/i18n';
import { FrameworkScope, useService } from '@nota/infra';
import { useCallback } from 'react';

import { DeleteLeaveWorkspace } from './delete-leave-workspace';
import { LabelsPanel } from './labels';
import { ProfilePanel } from './profile';
import { SharingPanel } from './sharing';
import { TemplateDocSetting } from './template';
import type { WorkspaceSettingDetailProps } from './types';

export const WorkspaceSettingDetail = ({
  onCloseSetting,
}: WorkspaceSettingDetailProps) => {
  const t = useI18n();

  const workspace = useService(WorkspaceService).workspace;
  const isUserOwnedWorkspace = isUserOwnedWorkspaceFlavour(workspace.flavour);
  const server = isUserOwnedWorkspace
    ? undefined
    : workspace.scope.get(WorkspaceServerService).server;

  const workspaceInfo = useWorkspaceInfo(workspace);

  const handleResetSyncStatus = useCallback(() => {
    workspace?.engine.doc
      .resetSync()
      .then(() => {
        onCloseSetting();
      })
      .catch(err => {
        console.error(err);
      });
  }, [onCloseSetting, workspace]);

  return (
    <FrameworkScope scope={server?.scope}>
      <SettingHeader
        title={
          isUserOwnedWorkspace
            ? workspaceInfo?.name || UNTITLED_WORKSPACE_NAME
            : t[`Workspace Settings with name`]({
                name: workspaceInfo?.name ?? UNTITLED_WORKSPACE_NAME,
              })
        }
        subtitle={
          isUserOwnedWorkspace
            ? 'Manage this user-owned workspace and its note defaults.'
            : t['com.affine.settings.workspace.description']()
        }
      />
      <SettingWrapper title={t['Info']()}>
        <SettingRow
          name={t['Workspace Profile']()}
          desc={t['com.affine.settings.workspace.not-owner']()}
          spreadCol={false}
        >
          <ProfilePanel />
          <LabelsPanel />
        </SettingRow>
      </SettingWrapper>
      <TemplateDocSetting />
      {isUserOwnedWorkspace ? null : <SharingPanel />}
      <SettingWrapper>
        <DeleteLeaveWorkspace onCloseSetting={onCloseSetting} />
        {isUserOwnedWorkspace ? null : (
          <SettingRow
            name={
              <span style={{ color: 'var(--affine-text-secondary-color)' }}>
                {t['com.affine.resetSyncStatus.button']()}
              </span>
            }
            desc={t['com.affine.resetSyncStatus.description']()}
            style={{ cursor: 'pointer' }}
            onClick={handleResetSyncStatus}
            data-testid="reset-sync-status"
          >
            <ArrowRightSmallIcon />
          </SettingRow>
        )}
      </SettingWrapper>
    </FrameworkScope>
  );
};
