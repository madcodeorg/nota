import {
  SettingHeader,
  SettingWrapper,
} from '@nota/component/setting-components';
import { Button } from '@nota/component/ui/button';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { WorkspacePermissionService } from '@nota/core/modules/permissions';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';

import { BlobManagementPanel } from './blob-management';
import { DesktopExportPanel } from './export';
import { LocalHistoryStoragePanel } from './local-history';
import { WorkspaceQuotaPanel } from './workspace-quota';

export const WorkspaceSettingStorage = () => {
  const t = useI18n();
  const workspace = useService(WorkspaceService).workspace;
  const dialogs = useService(WorkspaceDialogService);
  const workspacePermissionService = useService(
    WorkspacePermissionService
  ).permission;
  const isTeam = useLiveData(workspacePermissionService.isTeam$);
  const isOwner = useLiveData(workspacePermissionService.isOwner$);

  const canExport = !isTeam || isOwner;
  const isUserOwnedWorkspace = isUserOwnedWorkspaceFlavour(workspace.flavour);
  return (
    <>
      <SettingHeader
        title={t['Storage']()}
        subtitle={t['com.affine.settings.workspace.storage.subtitle']()}
      />
      <Button onClick={() => dialogs.open('data-tools', {})}>
        Import and export content
      </Button>
      {isUserOwnedWorkspace ? (
        <SettingWrapper>
          <LocalHistoryStoragePanel />
        </SettingWrapper>
      ) : null}
      {isUserOwnedWorkspace ? (
        BUILD_CONFIG.isElectron && (
          <SettingWrapper>
            <DesktopExportPanel workspace={workspace} />
          </SettingWrapper>
        )
      ) : (
        <>
          {isTeam ? (
            <SettingWrapper>
              <WorkspaceQuotaPanel />
            </SettingWrapper>
          ) : null}

          {BUILD_CONFIG.isElectron && canExport && (
            <SettingWrapper>
              <DesktopExportPanel workspace={workspace} />
            </SettingWrapper>
          )}

          <SettingWrapper>
            <BlobManagementPanel />
          </SettingWrapper>
        </>
      )}
    </>
  );
};
