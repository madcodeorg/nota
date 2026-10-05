import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { GlobalContextService } from '@nota/core/modules/global-context';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import { useCallback } from 'react';
import {
  RiCalendarTodoFill,
  RiDeleteBin6Fill,
  RiSettings5Fill,
} from 'react-icons/ri';

import * as styles from './bottom-icon-tray.css';
import UserInfo from './user-info';

export const BottomIconTray = () => {
  const t = useI18n();
  const workbenchService = useService(WorkbenchService);

  const workbench = workbenchService.workbench;
  const globalContextService = useService(GlobalContextService);
  const trashActive = useLiveData(globalContextService.globalContext.isTrash.$);
  const workspaceDialogService = useService(WorkspaceDialogService);

  const onOpenSettings = useCallback(() => {
    workspaceDialogService.open('setting', { activeTab: 'appearance' });
    track.$.navigationPanel.$.openSettings();
  }, [workspaceDialogService]);

  const location = useLiveData(workbench.location$);
  const isJournal = location.pathname.startsWith('/journals');

  return (
    <div className={styles.trayContainer}>
      <div className={styles.utilityDock}>
        <div className={styles.avatarSection}>
          <UserInfo size={32} />
        </div>
        <div className={styles.utilityActions}>
          <button
            className={styles.utilityIconButton}
            data-active={isJournal}
            data-testid="sidebar-tray-journal"
            onClick={() => workbench.open('/journals')}
            title={t['com.affine.journal.app-sidebar-title']()}
          >
            <RiCalendarTodoFill size={16} />
          </button>
          <button
            className={styles.utilityIconButton}
            data-active={trashActive}
            data-testid="sidebar-tray-trash"
            onClick={() => workbench.open('/trash')}
            title={t['com.affine.workspaceSubPath.trash']()}
          >
            <RiDeleteBin6Fill size={16} />
          </button>
          <button
            className={styles.utilityIconButton}
            data-testid="sidebar-tray-settings"
            onClick={onOpenSettings}
            title={t['com.affine.settingSidebar.title']()}
          >
            <RiSettings5Fill size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
