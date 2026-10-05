import { SettingsIcon } from '@blocksuite/icons/rc';
import {
  IconButton,
  SafeArea,
  startScopedViewTransition,
} from '@nota/component';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { useI18n } from '@nota/i18n';
import { useService } from '@nota/infra';
import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';

import { SearchInput, WorkspaceSelector } from '../../components';
import { searchVTScope } from '../../components/search-input/style.css';
import { useGlobalEvent } from '../../hooks/use-global-events';
import * as styles from './styles.css';

/**
 * Contains `Setting`, `Workspace Selector`, `Search`
 * When scrolled:
 *   - combine Setting and Workspace Selector
 *   - hide Search
 */
export const HomeHeader = () => {
  const workspaceDialogService = useService(WorkspaceDialogService);

  const workspaceCardRef = useRef<HTMLDivElement>(null);
  const floatWorkspaceCardRef = useRef<HTMLDivElement>(null);
  const t = useI18n();
  const workbench = useService(WorkbenchService).workbench;

  const navSearch = useCallback(() => {
    startScopedViewTransition(searchVTScope, () => {
      workbench.open('/search');
    });
  }, [workbench]);

  const [dense, setDense] = useState(false);

  useGlobalEvent(
    'scroll',
    useCallback(() => {
      if (!workspaceCardRef.current || !floatWorkspaceCardRef.current) return;
      const inFlowTop = workspaceCardRef.current.getBoundingClientRect().top;
      const floatTop =
        floatWorkspaceCardRef.current.getBoundingClientRect().top;
      setDense(inFlowTop <= floatTop);
    }, [])
  );

  const openSetting = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'appearance',
    });
  }, [workspaceDialogService]);

  return (
    <>
      <SafeArea top className={styles.root}>
        <div className={styles.headerSettingRow}>
          <div className={styles.brand}>
            <span className={styles.brandMark} />
            <span>Nota</span>
          </div>
          <div className={styles.headerActions}>
            <IconButton
              className={styles.iconButton}
              onClick={openSetting}
              size={28}
              icon={<SettingsIcon />}
              data-testid="settings-button"
            />
          </div>
        </div>
        <div className={styles.wsSelectorAndSearch}>
          <WorkspaceSelector ref={workspaceCardRef} />
          <SearchInput placeholder={t['Quick search']()} onClick={navSearch} />
        </div>
      </SafeArea>
      {/* float */}
      <SafeArea top className={clsx(styles.root, styles.float, { dense })}>
        <WorkspaceSelector
          className={styles.floatWsSelector}
          ref={floatWorkspaceCardRef}
        />
        <IconButton
          className={styles.iconButton}
          onClick={openSetting}
          size={28}
          icon={<SettingsIcon />}
          data-testid="settings-button"
        />
      </SafeArea>
    </>
  );
};
