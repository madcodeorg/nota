import {
  aiPanelSlot$,
  sidebarSection$,
} from '@nota/core/components/root-app-sidebar/ai-panel-slot';
import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { useLiveData, useService } from '@nota/infra';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import { IslandContainer } from './container';
import { AIIcon } from './icons';
import { aiIslandBtn, aiIslandWrapper, toolStyle } from './styles.css';

const hideChat: Array<string | ((path: string) => boolean)> = [
  '/chat',
  path => path.includes('attachments'),
];

export const AIIsland = () => {
  // to make sure ai island is hidden first and animate in
  const [hide, setHide] = useState(true);

  const workbench = useService(WorkbenchService).workbench;
  const activeView = useLiveData(workbench.activeView$);
  const aiSlot = useLiveData(aiPanelSlot$);
  const section = useLiveData(sidebarSection$);
  const appSidebarOpen = useLiveData(
    useService(AppSidebarService).sidebar.open$
  );
  const haveChatTab = !!aiSlot;
  const activeLocation = useLiveData(activeView.location$);

  useEffect(() => {
    let hide = true;
    if (haveChatTab) {
      hide = !!appSidebarOpen && section === 'ai';
    } else {
      const path = activeLocation.pathname;
      hide = hideChat.some(item =>
        typeof item === 'string' ? path === item : item(path)
      );
    }
    setHide(hide);
  }, [activeLocation.pathname, appSidebarOpen, haveChatTab, section]);

  const onOpenChat = useCallback(() => {
    if (hide) return;
    if (haveChatTab) {
      workbench.openSidebar('chat');
    } else {
      workbench.open('/chat');
      workbench.closeSidebar();
    }
  }, [haveChatTab, hide, workbench]);

  return (
    <IslandContainer className={clsx(toolStyle, { hide })}>
      <div className={aiIslandWrapper} data-hide={hide}>
        <button
          className={aiIslandBtn}
          data-testid="ai-island"
          onClick={onOpenChat}
        >
          <AIIcon />
        </button>
      </div>
    </IslandContainer>
  );
};
