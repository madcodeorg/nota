import { Tooltip } from '@nota/component';
import { AIProvider } from '@nota/core/blocksuite/ai';
import { AppSidebarService } from '@nota/core/modules/app-sidebar/services/app-sidebar';
import {
  AddPageButton,
  AppSidebar,
  MenuItem,
  SidebarContainer,
  SidebarScrollableContainer,
} from '@nota/core/modules/app-sidebar/views';
import { ServerService } from '@nota/core/modules/cloud';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import { DocDisplayMetaService } from '@nota/core/modules/doc-display-meta';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { CMDKQuickSearchService } from '@nota/core/modules/quicksearch/services/cmdk';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { LiveData, useLiveData, useService, useServices } from '@nota/infra';
import dayjs from 'dayjs';
import type { ReactElement } from 'react';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  RiAddFill,
  RiAddLine,
  RiCalendarTodoLine,
  RiDeleteBin6Line,
  RiFileList3Fill,
  RiFileList3Line,
  RiFileTextFill,
  RiFileTextLine,
  RiGlobalLine,
  RiInboxArchiveLine,
  RiMindMap,
  RiSearchLine,
  RiSettings5Line,
  RiSparkling2Fill,
  RiSparkling2Line,
  RiTaskFill,
  RiTaskLine,
  RiTimeLine,
  RiVoiceprintFill,
  RiVoiceprintLine,
} from 'react-icons/ri';

import {
  NavigationPanelCollections,
  NavigationPanelFavorites,
  NavigationPanelOrganize,
  NavigationPanelTags,
} from '../../desktop/components/navigation-panel';
import { CollapsibleSection } from '../../desktop/components/navigation-panel/layouts/collapsible-section';
import { EditorChatPanel } from '../../desktop/pages/workspace/detail-page/tabs/chat';
import { getContextDocIdFromPathname } from '../../desktop/pages/workspace/detail-page/tabs/chat-panel-session';
import {
  formatElapsedTime,
  meetingDurationSeconds,
} from '../../desktop/pages/workspace/meetings/meeting-save';
import { WorkbenchService } from '../../modules/workbench';
import { useSaveWebPage } from '../web-clip/use-save-web-page';
import { WorkspaceNavigator } from '../workspace-selector';
import {
  activeDocEditor$,
  aiPanelSlot$,
  chatHistoryVersion$,
  fullChatSessionId$,
  linkSidebarChat,
  pagePanelSlot$,
  pendingFullChatSessionId$,
  pendingNewFullChat$,
  setSidebarSection,
  sidebarChat$,
  type SidebarSection,
  sidebarSection$,
} from './ai-panel-slot';
import * as styles from './index.css';
import UserInfo from './user-info';

const INITIAL_MEETING_HISTORY_LIMIT = 12;

type MeetingHistoryItem = {
  createdAt: string;
  docId?: string | null;
  id: string;
  recordingDurationMs?: number | null;
  status: 'recording' | 'stopped';
  transcriptSegments?: { endMs: number }[];
};

type MeetingListResponse = {
  meetings: MeetingHistoryItem[];
};

async function meetingJsonRequest<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : '') || `Request failed: ${response.status}`
    );
  }
  return data as T;
}

function formatHistoryTime(value: string) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MMM D, h:mm A') : 'Meeting';
}

function meetingTitle(meeting: MeetingHistoryItem) {
  return `Meeting ${formatHistoryTime(meeting.createdAt)}`;
}

const SearchNavItem = () => {
  const { cMDKQuickSearchService } = useServices({ CMDKQuickSearchService });
  const shortcut = environment.isMacOs ? '⌘K' : 'Ctrl K';

  return (
    <button
      type="button"
      className={styles.searchBar}
      data-testid="slider-bar-quick-search-button"
      data-event-props="$.navigationPanel.$.quickSearch"
      onClick={() => cMDKQuickSearchService.toggle()}
    >
      <RiSearchLine aria-hidden size={15} className={styles.searchBarIcon} />
      <span className={styles.searchBarLabel}>Search</span>
      <kbd className={styles.searchBarShortcut}>{shortcut}</kbd>
    </button>
  );
};
const AllNotesNavItem = () => {
  const t = useI18n();
  const { workbenchService } = useServices({ WorkbenchService });
  const workbench = workbenchService.workbench;
  const allPageActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/all')
  );
  const openAllNotes = useCallback(() => {
    workbench.open('/all', { at: 'active' });
  }, [workbench]);

  return (
    <MenuItem
      icon={<RiFileList3Fill size={18} />}
      active={allPageActive}
      onClick={openAllNotes}
      postfix={<AddPageButton />}
      postfixDisplay="always"
    >
      <span data-testid="all-pages">
        {t['com.affine.workspaceSubPath.all']()}
      </span>
    </MenuItem>
  );
};

const useImportDocs = () => {
  const workspaceDialogService = useService(WorkspaceDialogService);
  const workbench = useService(WorkbenchService).workbench;
  return useCallback(() => {
    workspaceDialogService.open('import', undefined, result => {
      if (!result) return;
      const { docIds, entryId, isWorkspaceFile } = result;
      if (isWorkspaceFile && entryId) {
        workbench.openDoc(entryId);
      } else if (docIds.length > 1) {
        workbench.openAll();
      } else if (docIds.length === 1) {
        workbench.openDoc(docIds[0]);
      }
    });
  }, [workspaceDialogService, workbench]);
};

const ImportButton = () => {
  const importDocs = useImportDocs();
  return (
    <Tooltip content="Import" side="bottom">
      <button
        aria-label="Import"
        className={styles.historyNewButton}
        data-testid="sidebar-import-button"
        type="button"
        onClick={importDocs}
      >
        <RiInboxArchiveLine aria-hidden size={16} />
      </button>
    </Tooltip>
  );
};

const SaveWebPageButton = () => {
  const saveWebPage = useSaveWebPage();
  return (
    <Tooltip content="Save web page" side="bottom">
      <button
        aria-label="Save web page"
        className={styles.historyNewButton}
        data-testid="sidebar-save-web-page-button"
        type="button"
        onClick={saveWebPage}
      >
        <RiGlobalLine aria-hidden size={16} />
      </button>
    </Tooltip>
  );
};

const MeetingsNavItem = () => {
  const { workbenchService } = useServices({ WorkbenchService });
  const workbench = workbenchService.workbench;
  const meetingsActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/meetings')
  );
  const openMeetings = useCallback(() => {
    workbench.open('/meetings', { at: 'active' });
  }, [workbench]);
  const openNewMeeting = useCallback(() => {
    workbench.open(
      {
        pathname: '/meetings',
        search: '?new=1',
      },
      { at: 'active' }
    );
  }, [workbench]);

  return (
    <MenuItem
      icon={<RiVoiceprintFill size={18} />}
      active={meetingsActive}
      data-testid="sidebar-meetings-button"
      onClick={openMeetings}
      postfix={
        <button
          aria-label="New meeting"
          className={styles.historyNewButton}
          title="New meeting"
          type="button"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            openNewMeeting();
          }}
        >
          <RiAddFill aria-hidden size={16} />
        </button>
      }
      postfixDisplay="always"
    >
      <span data-testid="meetings">Meetings</span>
    </MenuItem>
  );
};

const MeetingHistorySidebar = () => {
  const { workbenchService } = useServices({ WorkbenchService });
  const workspace = useService(WorkspaceService).workspace;
  const workbench = workbenchService.workbench;
  const location = useLiveData(workbench.location$);
  const [meetings, setMeetings] = useState<MeetingHistoryItem[]>([]);
  const selectedMeetingId = useMemo(
    () =>
      location.pathname === '/meetings'
        ? new URLSearchParams(location.search).get('meetingId')
        : meetings.find(
            meeting =>
              meeting.docId && location.pathname === `/${meeting.docId}`
          )?.id,
    [location.pathname, location.search, meetings]
  );
  const [visibleCount, setVisibleCount] = useState(
    INITIAL_MEETING_HISTORY_LIMIT
  );
  const [busy, setBusy] = useState(false);

  const refreshMeetings = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({ workspaceId: workspace.id });
      const data = await meetingJsonRequest<MeetingListResponse>(
        `/v1/meetings?${params.toString()}`
      );
      setMeetings(data.meetings);
    } catch (error) {
      console.warn('Failed to load meeting history', error);
    } finally {
      setBusy(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    refreshMeetings().catch(console.error);
  }, [refreshMeetings]);

  useEffect(() => {
    const onRefresh = () => {
      refreshMeetings().catch(console.error);
    };
    window.addEventListener('nota:meetings-history-refresh', onRefresh);
    return () => {
      window.removeEventListener('nota:meetings-history-refresh', onRefresh);
    };
  }, [refreshMeetings]);

  const visibleMeetings = useMemo(
    () => meetings.slice(0, visibleCount),
    [meetings, visibleCount]
  );

  return (
    <div className={styles.historyRoot}>
      <div className={styles.historyHeader}>
        <div className={styles.historyTitle}>Meetings</div>
        <div className={styles.historyCount}>
          {busy ? 'Loading...' : `${meetings.length} saved`}
        </div>
      </div>
      <div className={styles.historyList}>
        {visibleMeetings.length ? (
          visibleMeetings.map(meeting => (
            <button
              className={styles.historyItem}
              data-selected={meeting.id === selectedMeetingId}
              key={meeting.id}
              type="button"
              onClick={() => {
                workbench.open(
                  {
                    pathname: '/meetings',
                    search: `?meetingId=${encodeURIComponent(meeting.id)}`,
                  },
                  { at: 'active' }
                );
              }}
            >
              <span className={styles.historyItemTitle}>
                {meetingTitle(meeting)}
              </span>
              <span className={styles.historyItemMeta}>
                {meeting.status === 'stopped'
                  ? `${formatElapsedTime(meetingDurationSeconds(meeting))} · `
                  : 'Recording · '}
                {(meeting.transcriptSegments?.length ?? 0).toLocaleString()}{' '}
                transcript lines
              </span>
              {meeting.docId ? (
                <span
                  className={styles.historyItemLink}
                  role="button"
                  tabIndex={0}
                  onClick={event => {
                    event.stopPropagation();
                    workbench.openDoc(meeting.docId as string, {
                      at: 'active',
                    });
                  }}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    workbench.openDoc(meeting.docId as string, {
                      at: 'active',
                    });
                  }}
                >
                  Open notes
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <div className={styles.historyEmpty}>No recorded meetings yet.</div>
        )}
        {meetings.length > visibleCount ? (
          <button
            className={styles.historyMoreButton}
            type="button"
            onClick={() => {
              setVisibleCount(count => count + INITIAL_MEETING_HISTORY_LIMIT);
            }}
          >
            More
          </button>
        ) : null}
      </div>
    </div>
  );
};

const CHAT_HISTORY_PAGE_SIZE = 20;

type ChatHistoryItem = BlockSuitePresets.AIRecentSession;

const ChatsNavItem = () => {
  const workbench = useService(WorkbenchService).workbench;
  const chatActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/chat')
  );
  const openNewChat = useCallback(() => {
    pendingNewFullChat$.next(true);
    workbench.open('/chat', { at: 'active' });
  }, [workbench]);

  return (
    <MenuItem
      icon={<RiSparkling2Fill size={18} />}
      active={chatActive}
      data-testid="sidebar-chats-button"
      onClick={() => workbench.open('/chat', { at: 'active' })}
      postfix={
        <button
          aria-label="New chat"
          className={styles.historyNewButton}
          title="New chat"
          type="button"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            openNewChat();
          }}
        >
          <RiAddFill aria-hidden size={16} />
        </button>
      }
      postfixDisplay="always"
    >
      <span>Nota AI</span>
    </MenuItem>
  );
};

const ChatHistoryRow = ({
  session,
  selected,
  onOpen,
}: {
  session: ChatHistoryItem;
  selected: boolean;
  onOpen: (sessionId: string) => void;
}) => {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const docTitle = useLiveData(
    session.docId ? docDisplayMetaService.title$(session.docId) : null
  );
  return (
    <button
      className={styles.historyItem}
      data-selected={selected}
      data-testid="sidebar-chat-history-item"
      type="button"
      onClick={() => onOpen(session.sessionId)}
    >
      <span className={styles.historyItemTitle}>
        {session.title || 'New chat'}
      </span>
      <span className={styles.historyItemMeta}>
        {formatHistoryTime(session.updatedAt)}
        {docTitle ? ` · ${docTitle}` : ''}
      </span>
    </button>
  );
};

const ChatHistorySidebar = () => {
  const workbench = useService(WorkbenchService).workbench;
  const workspaceId = useService(WorkspaceService).workspace.id;
  const onChatPage = useLiveData(
    workbench.location$.selector(location => location.pathname === '/chat')
  );
  const currentSessionId = useLiveData(fullChatSessionId$);
  const version = useLiveData(chatHistoryVersion$);
  const [sessions, setSessions] = useState<ChatHistoryItem[] | null>(null);
  const [limit, setLimit] = useState(CHAT_HISTORY_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let disposed = false;
    // Reload the whole visible range so renamed or deleted chats update too.
    Promise.resolve(
      AIProvider.session?.getRecentSessions(workspaceId, limit + 1, 0)
    )
      .then(result => {
        if (disposed) return;
        const list = result ?? [];
        setSessions(list.slice(0, limit));
        setHasMore(list.length > limit);
      })
      .catch(error => {
        console.warn('Failed to load chat history', error);
        if (!disposed) setSessions(prev => prev ?? []);
      });
    return () => {
      disposed = true;
    };
  }, [limit, version, workspaceId]);

  const openSession = useCallback(
    (sessionId: string) => {
      pendingFullChatSessionId$.next(sessionId);
      workbench.open('/chat', { at: 'active' });
    },
    [workbench]
  );

  return (
    <div className={styles.historyRoot}>
      <div className={styles.historyHeader}>
        <div className={styles.historyTitle}>Chats</div>
        <div className={styles.historyCount}>
          {sessions
            ? `${sessions.length}${hasMore ? '+' : ''} saved`
            : 'Loading...'}
        </div>
      </div>
      <div className={styles.historyList}>
        {sessions?.length ? (
          sessions.map(session => (
            <ChatHistoryRow
              key={session.sessionId}
              session={session}
              selected={onChatPage && session.sessionId === currentSessionId}
              onOpen={openSession}
            />
          ))
        ) : sessions ? (
          <div className={styles.historyEmpty}>No chats yet.</div>
        ) : null}
        {hasMore ? (
          <button
            className={styles.historyMoreButton}
            type="button"
            onClick={() => setLimit(count => count + CHAT_HISTORY_PAGE_SIZE)}
          >
            More
          </button>
        ) : null}
      </div>
    </div>
  );
};

/**
 * This is for the whole affine app sidebar.
 * This component wraps the app sidebar in `@nota/component` with logic and data.
 *
 */
const RecentNoteRow = ({ docId }: { docId: string }) => {
  const { workbenchService, docDisplayMetaService } = useServices({
    WorkbenchService,
    DocDisplayMetaService,
  });
  const workbench = workbenchService.workbench;
  const title = useLiveData(docDisplayMetaService.title$(docId));
  const Icon = useLiveData(docDisplayMetaService.icon$(docId));
  const active = useLiveData(
    workbench.location$.selector(location => location.pathname === `/${docId}`)
  );
  return (
    <MenuItem
      icon={<Icon />}
      active={active}
      onClick={() => workbench.openDoc(docId, { at: 'active' })}
    >
      <span>{title}</span>
    </MenuItem>
  );
};

const RECENT_NOTES_LIMIT = 8;

const RecentNotes = () => {
  const docsService = useService(DocsService);
  const recent$ = useMemo(
    () =>
      LiveData.computed(get =>
        get(docsService.list.docs$)
          .filter(doc => !get(doc.trash$))
          .map(doc => ({
            id: doc.id,
            at: get(doc.updatedAt$) ?? get(doc.createdAt$) ?? 0,
          }))
          .sort((a, b) => b.at - a.at)
          .slice(0, RECENT_NOTES_LIMIT)
          .map(doc => doc.id)
      ),
    [docsService]
  );
  const recent = useLiveData(recent$);
  if (!recent.length) return null;
  return (
    <CollapsibleSection
      path={['recents']}
      title="Recents"
      icon={<RiTimeLine />}
    >
      {recent.map(id => (
        <RecentNoteRow key={id} docId={id} />
      ))}
    </CollapsibleSection>
  );
};

// The sidebar owns the chat so it keeps running while the user moves between
// pages. It stays linked to the note it was opened from.
const AIPanel = ({ visible }: { visible: boolean }) => {
  const workbench = useService(WorkbenchService).workbench;
  const location = useLiveData(workbench.location$);
  const contextDocId = getContextDocIdFromPathname(location.pathname);
  const docsService = useService(DocsService);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const target = useLiveData(sidebarChat$);
  const editor = useLiveData(activeDocEditor$);
  const docListReady = useLiveData(docsService.list.isReady$);
  const linkedDoc = useLiveData(
    target ? docsService.list.doc$(target.docId) : null
  );
  const linkedDocTrashed = useLiveData(linkedDoc?.trash$);
  const linkedDocMissing =
    !!target && docListReady && (!linkedDoc || !!linkedDocTrashed);
  const slotRef = useCallback((node: HTMLDivElement | null) => {
    aiPanelSlot$.next(node);
  }, []);

  // The link is a note id in this workspace; it means nothing in another one.
  useEffect(() => {
    return () => sidebarChat$.next(null);
  }, [workspaceId]);

  useEffect(() => {
    if (linkedDocMissing) {
      sidebarChat$.next(null);
    }
  }, [linkedDocMissing]);

  useEffect(() => {
    if (visible && !target && contextDocId) {
      linkSidebarChat({ docId: contextDocId });
    }
  }, [contextDocId, target, visible]);

  return (
    <div className={styles.aiPanel} ref={slotRef}>
      {target && !linkedDocMissing ? (
        <EditorChatPanel target={target} editor={editor} />
      ) : (
        <div className={styles.aiPanelFallback}>
          <MenuItem
            icon={<RiAddLine size={18} />}
            onClick={() => workbench.open('/chat', { at: 'active' })}
          >
            <span>New chat</span>
          </MenuItem>
        </div>
      )}
    </div>
  );
};

type RailItem = {
  id: SidebarSection;
  label: string;
  icon: ReactElement;
  activeIcon: ReactElement;
};

const RAIL_ITEMS: RailItem[] = [
  {
    id: 'notes',
    label: 'All Notes',
    icon: <RiFileList3Line size={20} />,
    activeIcon: <RiFileList3Fill size={20} />,
  },
  {
    id: 'ai',
    label: 'Nota AI',
    icon: <RiSparkling2Line size={20} />,
    activeIcon: <RiSparkling2Fill size={20} />,
  },
  {
    id: 'meetings',
    label: 'Meetings',
    icon: <RiVoiceprintLine size={20} />,
    activeIcon: <RiVoiceprintFill size={20} />,
  },
];

const RailButton = ({
  label,
  active,
  onClick,
  children,
  testId,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactElement;
  testId?: string;
}) => (
  <Tooltip content={label} side="right">
    <button
      type="button"
      aria-label={label}
      className={styles.railButton}
      data-active={active}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
    </button>
  </Tooltip>
);

const SidebarRail = ({
  section,
  aiEnabled,
}: {
  section: SidebarSection;
  aiEnabled: boolean;
}) => {
  const workbench = useService(WorkbenchService).workbench;
  const workspaceDialogService = useService(WorkspaceDialogService);
  const location = useLiveData(workbench.location$);
  const appSidebar = useService(AppSidebarService).sidebar;
  const isJournal = location.pathname.startsWith('/journals');
  const isTrash = location.pathname.startsWith('/trash');
  const isTasks = location.pathname.startsWith('/tasks');
  const isGraph = location.pathname.startsWith('/graph');

  const select = (id: SidebarSection) => {
    // AI from the rail opens the full Nota AI page with the chat history in
    // the sidebar; the docked sidebar chat ('ai') opens from a note's AI
    // button instead.
    setSidebarSection(id === 'ai' ? 'chats' : id);
    // Hovering the rail previews the panel; clicking an icon pins it open.
    appSidebar.setHovering(false);
    appSidebar.setOpen(true);
    if (id === 'ai') workbench.open('/chat', { at: 'active' });
    if (id === 'meetings') workbench.open('/meetings', { at: 'active' });
  };

  return (
    <div
      className={styles.rail}
      data-testid="sidebar-rail"
      data-electron={BUILD_CONFIG.isElectron}
    >
      <div className={styles.railGroup}>
        {RAIL_ITEMS.filter(item => item.id !== 'ai' || aiEnabled).map(item => {
          const active =
            section === item.id ||
            (item.id === 'ai' &&
              (section === 'chats' || location.pathname === '/chat'));
          return (
            <Fragment key={item.id}>
              <RailButton
                label={item.label}
                active={active}
                testId={`sidebar-rail-${item.id}`}
                onClick={() => select(item.id)}
              >
                {active ? item.activeIcon : item.icon}
              </RailButton>
              {item.id === 'notes' ? (
                <RailButton
                  label="Journals"
                  active={isJournal}
                  testId="sidebar-rail-journals"
                  onClick={() => workbench.open('/journals', { at: 'active' })}
                >
                  <RiCalendarTodoLine size={20} />
                </RailButton>
              ) : null}
              {item.id === 'notes' ? (
                <RailButton
                  label="Tasks"
                  active={isTasks}
                  testId="sidebar-rail-tasks"
                  onClick={() => workbench.open('/tasks', { at: 'active' })}
                >
                  {isTasks ? (
                    <RiTaskFill size={20} />
                  ) : (
                    <RiTaskLine size={20} />
                  )}
                </RailButton>
              ) : null}
              {item.id === 'notes' ? (
                <RailButton
                  label="Graph"
                  active={isGraph}
                  testId="sidebar-rail-graph"
                  onClick={() => workbench.open('/graph', { at: 'active' })}
                >
                  <RiMindMap size={20} />
                </RailButton>
              ) : null}
            </Fragment>
          );
        })}
        <div className={styles.railDivider} />
        <RailButton
          label="Page details"
          active={section === 'page'}
          testId="sidebar-rail-page"
          onClick={() => select('page')}
        >
          {section === 'page' ? (
            <RiFileTextFill size={20} />
          ) : (
            <RiFileTextLine size={20} />
          )}
        </RailButton>
      </div>
      <div className={styles.railGroup}>
        <RailButton
          label="Trash"
          active={isTrash}
          testId="sidebar-tray-trash"
          onClick={() => workbench.open('/trash', { at: 'active' })}
        >
          <RiDeleteBin6Line size={20} />
        </RailButton>
        <RailButton
          label="Settings"
          onClick={() =>
            workspaceDialogService.open('setting', { activeTab: 'appearance' })
          }
        >
          <RiSettings5Line size={20} />
        </RailButton>
        <div className={styles.railAvatar}>
          <UserInfo size={28} />
        </div>
      </div>
    </div>
  );
};

/**
 * Root app sidebar: a thin icon rail plus a contextual panel that shows the
 * content of the selected rail section.
 */

// The current view's page panels (properties, outline, frames, comments,
// journal, export...) that used to live in the right sidebar.
const PagePanel = ({ visible }: { visible: boolean }) => {
  const workbench = useService(WorkbenchService).workbench;
  // Page tabs only render their body while the workbench sidebar is "open".
  // That sidebar no longer has its own column, so the flag follows this panel.
  useEffect(() => {
    workbench.setSidebarOpen(visible);
  }, [visible, workbench]);
  const slotRef = useCallback((node: HTMLDivElement | null) => {
    pagePanelSlot$.next(node);
  }, []);
  return <div className={styles.pagePanel} ref={slotRef} />;
};

export const RootAppSidebar = memo((): ReactElement => {
  const { workbenchService } = useServices({ WorkbenchService });
  const featureFlagService = useService(FeatureFlagService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);
  const aiEnabled = !!enableAI && !!serverFeatures?.copilot;

  const workbench = workbenchService.workbench;
  const workspaceSelectorOpen = useLiveData(workbench.workspaceSelectorOpen$);
  const storedSection = useLiveData(sidebarSection$);
  const section =
    (storedSection === 'ai' || storedSection === 'chats') && !aiEnabled
      ? 'notes'
      : storedSection;

  const onWorkspaceSelectorOpenChange = useCallback(
    (open: boolean) => {
      workbench.setWorkspaceSelectorOpen(open);
    },
    [workbench]
  );

  return (
    <AppSidebar rail={<SidebarRail section={section} aiEnabled={aiEnabled} />}>
      <div className={styles.shell}>
        <div className={styles.panel}>
          <SidebarContainer>
            <div className={styles.workspaceWrapper}>
              <WorkspaceNavigator
                showEnableCloudButton
                showSyncStatus
                open={workspaceSelectorOpen}
                onOpenChange={onWorkspaceSelectorOpenChange}
                dense
              />
              {BUILD_CONFIG.isElectron ? <SaveWebPageButton /> : null}
              <ImportButton />
            </div>
            {section === 'notes' ? (
              <>
                {!BUILD_CONFIG.isElectron && <SearchNavItem />}
                <AllNotesNavItem />
              </>
            ) : null}
            {section === 'meetings' ? <MeetingsNavItem /> : null}
            {section === 'chats' ? <ChatsNavItem /> : null}
          </SidebarContainer>
          {aiEnabled ? (
            <div className={styles.aiPanelHost} data-hidden={section !== 'ai'}>
              <AIPanel visible={section === 'ai'} />
            </div>
          ) : null}
          <div className={styles.aiPanelHost} data-hidden={section !== 'page'}>
            <PagePanel visible={section === 'page'} />
          </div>
          {section !== 'ai' && section !== 'page' ? (
            <SidebarScrollableContainer>
              {section === 'notes' ? (
                <>
                  <NavigationPanelFavorites />
                  <NavigationPanelOrganize />
                  <NavigationPanelCollections />
                  <NavigationPanelTags />
                  <RecentNotes />
                </>
              ) : null}
              {section === 'meetings' ? <MeetingHistorySidebar /> : null}
              {section === 'chats' ? <ChatHistorySidebar /> : null}
            </SidebarScrollableContainer>
          ) : null}
        </div>
      </div>
    </AppSidebar>
  );
});

RootAppSidebar.displayName = 'memo(RootAppSidebar)';
