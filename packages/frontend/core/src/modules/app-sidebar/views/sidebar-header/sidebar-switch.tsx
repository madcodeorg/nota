import { SidebarIcon } from '@blocksuite/icons/rc';
import { IconButton } from '@nota/component';
import { useLiveData, useService } from '@nota/infra';
import { track } from '@nota/track';
import clsx from 'clsx';
import { useCallback, useRef } from 'react';

import { AppSidebarService } from '../../services/app-sidebar';
import * as styles from './sidebar-switch.css';

export const SidebarSwitch = ({
  show,
  className,
}: {
  show: boolean;
  className?: string;
}) => {
  const appSidebarService = useService(AppSidebarService).sidebar;
  const open = useLiveData(appSidebarService.open$);
  const preventHovering = useLiveData(appSidebarService.preventHovering$);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const switchRef = useRef<HTMLDivElement>(null);
  const handleMouseEnter = useCallback(() => {
    if (preventHovering || open) {
      return;
    }
    appSidebarService.setHovering(true);
  }, [appSidebarService, open, preventHovering]);

  const handleClickSwitch = useCallback(() => {
    track.$.navigationPanel.$.toggle({
      type: open ? 'collapse' : 'expand',
    });
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (open) {
      appSidebarService.setHovering(false);
      timeoutRef.current = setTimeout(() => {
        appSidebarService.setPreventHovering(false);
      }, 500);
    }

    appSidebarService.setPreventHovering(true);
    appSidebarService.toggleSidebar();
  }, [appSidebarService, open]);

  return (
    <div
      ref={switchRef}
      data-show={show}
      className={styles.sidebarSwitchClip}
      data-testid={`app-sidebar-arrow-button-${open ? 'collapse' : 'expand'}`}
      onMouseEnter={handleMouseEnter}
    >
      <IconButton
        className={className}
        size="24"
        style={{
          zIndex: 1,
        }}
        onClick={handleClickSwitch}
      >
        <SidebarIcon className={clsx(styles.switchIcon)} />
      </IconButton>
    </div>
  );
};
