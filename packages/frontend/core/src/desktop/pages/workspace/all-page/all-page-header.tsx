import { type MenuProps } from '@nota/component';
import { usePageHelper } from '@nota/core/blocksuite/block-suite-page-list/utils';
import { ExplorerDisplayMenuButton } from '@nota/core/components/explorer/display-menu';
import { ViewToggle } from '@nota/core/components/explorer/display-menu/view-toggle';
import type { DocListItemView } from '@nota/core/components/explorer/docs-view/doc-list-item';
import { ExplorerNavigation } from '@nota/core/components/explorer/header/navigation';
import type { ExplorerDisplayPreference } from '@nota/core/components/explorer/types';
import { PageListNewPageButton } from '@nota/core/components/page-list/docs/page-list-new-page-button';
import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { inferOpenMode } from '@nota/core/utils';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import track from '@nota/track';
import { IconPlus } from '@tabler/icons-react';
import { useCallback } from 'react';

import * as styles from './all-page-header.css';

const menuProps: Partial<MenuProps> = {
  contentOptions: {
    side: 'bottom',
    align: 'end',
    alignOffset: 0,
    sideOffset: 8,
  },
};
export const AllDocsHeader = ({
  displayPreference,
  onDisplayPreferenceChange,
  view,
  onViewChange,
}: {
  displayPreference: ExplorerDisplayPreference;
  onDisplayPreferenceChange: (
    displayPreference: ExplorerDisplayPreference
  ) => void;
  view: DocListItemView;
  onViewChange: (view: DocListItemView) => void;
}) => {
  const t = useI18n();
  const workspaceService = useService(WorkspaceService);
  const workspaceDialogService = useService(WorkspaceDialogService);
  const workbenchService = useService(WorkbenchService);
  const appSidebar = useService(AppSidebarService).sidebar;
  const appSidebarOpen = useLiveData(appSidebar.open$);
  const appSidebarWidth = useLiveData(appSidebar.width$);
  const workbench = workbenchService.workbench;
  const { createEdgeless, createPage } = usePageHelper(
    workspaceService.workspace.docCollection
  );

  const handleOpenDocs = useCallback(
    (result: {
      docIds: string[];
      entryId?: string;
      isWorkspaceFile?: boolean;
    }) => {
      const { docIds, entryId, isWorkspaceFile } = result;
      // If the imported file is a workspace file, open the entry page.
      if (isWorkspaceFile && entryId) {
        workbench.openDoc(entryId);
      } else if (!docIds.length) {
        return;
      }
      // Open all the docs when there are multiple docs imported.
      if (docIds.length > 1) {
        workbench.openAll();
      } else {
        // Otherwise, open the only doc.
        workbench.openDoc(docIds[0]);
      }
    },
    [workbench]
  );

  const onImportFile = useCallback(() => {
    track.$.header.importModal.open();
    workspaceDialogService.open('data-tools', {}, payload => {
      if (!payload) {
        return;
      }
      handleOpenDocs(payload);
    });
  }, [workspaceDialogService, handleOpenDocs]);

  const visibleHeaderStyle = appSidebarOpen
    ? { width: `calc(100vw - ${appSidebarWidth + 28}px)` }
    : undefined;

  return (
    <div className={styles.header} style={visibleHeaderStyle}>
      <ExplorerNavigation active="docs" />

      <div className={styles.actions}>
        <PageListNewPageButton
          className={styles.newPageButtonCompact}
          size="small"
          onCreateEdgeless={e => createEdgeless({ at: inferOpenMode(e) })}
          onCreatePage={e => createPage('page', { at: inferOpenMode(e) })}
          onCreateDoc={e => createPage(undefined, { at: inferOpenMode(e) })}
          onImportFile={onImportFile}
          data-testid="new-page-button-trigger"
        >
          <IconPlus size={16} stroke={2.1} />
          <span className={styles.newPageButtonLabel}>{t['New Page']()}</span>
        </PageListNewPageButton>
        <div className={styles.viewModeGroup}>
          <ViewToggle view={view} onViewChange={onViewChange} />
        </div>
        <ExplorerDisplayMenuButton
          compact
          className={styles.displayMenuButton}
          menuProps={menuProps}
          displayPreference={displayPreference}
          onDisplayPreferenceChange={onDisplayPreferenceChange}
        />
      </div>
    </div>
  );
};
