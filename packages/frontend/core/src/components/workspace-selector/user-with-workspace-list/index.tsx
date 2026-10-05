import { ImportIcon } from '@blocksuite/icons/rc';
import { ScrollableContainer } from '@nota/component';
import { NotaLogoIcon } from '@nota/component/auth-components';
import { MenuItem } from '@nota/component/ui/menu';
import { AuthService, DefaultServerService } from '@nota/core/modules/cloud';
import {
  GlobalDialogService,
  WorkspaceDialogService,
} from '@nota/core/modules/dialogs';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { type WorkspaceMetadata } from '@nota/core/modules/workspace';
import { ServerFeature } from '@nota/graphql';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback } from 'react';

import { AddWorkspace } from './add-workspace';
import * as styles from './index.css';
import { NotaWorkspaceList } from './workspace-list';

export const SignInItem = () => {
  const globalDialogService = useService(GlobalDialogService);

  const t = useI18n();

  const onClickSignIn = useCallback(() => {
    track.$.navigationPanel.workspaceList.requestSignIn();
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  return (
    <MenuItem
      className={styles.menuItem}
      onClick={onClickSignIn}
      data-testid="cloud-signin-button"
    >
      <div className={styles.signInWrapper}>
        <div className={styles.iconContainer}>
          <NotaLogoIcon />
        </div>

        <div className={styles.signInTextContainer}>
          <div className={styles.signInTextPrimary}>
            {t['com.affine.workspace.cloud.auth']()}
          </div>
          <div className={styles.signInTextSecondary}>
            {t['com.affine.workspace.cloud.description']()}
          </div>
        </div>
      </div>
    </MenuItem>
  );
};

interface UserWithWorkspaceListProps {
  onEventEnd?: () => void;
  onClickWorkspace?: (workspace: WorkspaceMetadata) => void;
  onCreatedWorkspace?: (payload: {
    metadata: WorkspaceMetadata;
    defaultDocId?: string;
  }) => void;
  showEnableCloudButton?: boolean;
}

export const UserWithWorkspaceList = ({
  onEventEnd,
  onClickWorkspace,
  onCreatedWorkspace,
  showEnableCloudButton,
}: UserWithWorkspaceListProps) => {
  const t = useI18n();
  const globalDialogService = useService(GlobalDialogService);
  const workspaceDialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;
  const session = useLiveData(useService(AuthService).session.session$);
  const defaultServerService = useService(DefaultServerService);

  const isAuthenticated = session.status === 'authenticated';

  const openSignInModal = useCallback(() => {
    globalDialogService.open('sign-in', {});
  }, [globalDialogService]);

  const onNewWorkspace = useCallback(() => {
    const enableLocalWorkspace =
      BUILD_CONFIG.isNative ||
      defaultServerService.server.config$.value.features.includes(
        ServerFeature.LocalWorkspace
      );
    if (!isAuthenticated && !enableLocalWorkspace) {
      return openSignInModal();
    }
    track.$.navigationPanel.workspaceList.createWorkspace();
    globalDialogService.open('create-workspace', {}, payload => {
      if (payload) {
        onCreatedWorkspace?.(payload);
      }
    });
    onEventEnd?.();
  }, [
    globalDialogService,
    defaultServerService,
    isAuthenticated,
    onCreatedWorkspace,
    onEventEnd,
    openSignInModal,
  ]);

  const onAddWorkspace = useCallback(() => {
    track.$.navigationPanel.workspaceList.createWorkspace({
      control: 'import',
    });
    globalDialogService.open('import-workspace', undefined, payload => {
      if (payload) {
        onCreatedWorkspace?.({ metadata: payload.workspace });
      }
    });
    onEventEnd?.();
  }, [globalDialogService, onCreatedWorkspace, onEventEnd]);

  const onOpenImportModal = useCallback(() => {
    track.$.navigationPanel.importModal.open();
    workspaceDialogService.open('import', undefined, payload => {
      if (!payload) return;
      const { docIds, entryId, isWorkspaceFile } = payload;
      if (isWorkspaceFile && entryId) {
        workbench.openDoc(entryId);
      } else if (docIds.length > 1) {
        workbench.openAll();
      } else if (docIds.length === 1) {
        workbench.openDoc(docIds[0]);
      }
    });
    onEventEnd?.();
  }, [workspaceDialogService, workbench, onEventEnd]);

  return (
    <>
      <ScrollableContainer
        className={styles.workspaceScrollArea}
        viewPortClassName={styles.workspaceScrollAreaViewport}
        scrollBarClassName={styles.scrollbar}
        scrollThumbClassName={styles.scrollbarThumb}
      >
        <NotaWorkspaceList
          onEventEnd={onEventEnd}
          onClickWorkspace={onClickWorkspace}
          showEnableCloudButton={showEnableCloudButton}
        />
      </ScrollableContainer>
      <div className={styles.workspaceFooter}>
        <MenuItem
          className={styles.menuItem}
          prefixIcon={<ImportIcon />}
          onClick={onOpenImportModal}
          data-testid="import-docs"
        >
          {t['com.affine.workspaceList.importDocs']()}
        </MenuItem>
        <AddWorkspace
          onAddWorkspace={onAddWorkspace}
          onNewWorkspace={onNewWorkspace}
        />
      </div>
    </>
  );
};
