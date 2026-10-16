import {
  aiPanelSlot$,
  linkSidebarChat,
  sidebarSection$,
} from '@nota/core/components/root-app-sidebar/ai-panel-slot';
import { AppSidebarService } from '@nota/core/modules/app-sidebar';
import { WorkbenchService } from '@nota/core/modules/workbench';
import { useLiveData, useService } from '@nota/infra';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import { getContextDocIdFromPathname } from '../../pages/workspace/detail-page/tabs/chat-panel-session';
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

  const contextDocId = getContextDocIdFromPathname(activeLocation.pathname);

  useEffect(() => {
    const path = activeLocation.pathname;
    const sidebarChatVisible =
      haveChatTab && !!appSidebarOpen && section === 'ai';
    setHide(
      sidebarChatVisible ||
        hideChat.some(item =>
          typeof item === 'string' ? path === item : item(path)
        )
    );
  }, [activeLocation.pathname, appSidebarOpen, haveChatTab, section]);

  // On a note the island opens the sidebar chat for that note; elsewhere it
  // opens the full Nota AI page.
  const onOpenChat = useCallback(() => {
    if (hide) return;
    if (haveChatTab && contextDocId) {
      linkSidebarChat({ docId: contextDocId });
      workbench.openSidebar('chat');
    } else {
      workbench.open('/chat');
    }
  }, [contextDocId, haveChatTab, hide, workbench]);

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
