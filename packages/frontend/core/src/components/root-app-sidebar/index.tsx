import {
  Menu,
  MenuItem as PopMenuItem,
  MenuSeparator,
  Tooltip,
} from '@nota/component';
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
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  RiAddFill,
  RiAddLine,
  RiCalendarTodoLine,
  RiDeleteBin6Line,
  RiFileList3Fill,
  RiFileList3Line,
  RiFileTextFill,
  RiFileTextLine,
  RiFolder3Fill,
  RiFolder3Line,
  RiInboxArchiveLine,
  RiMoreLine,
  RiPriceTag3Fill,
  RiPriceTag3Line,
  RiSearch2Fill,
  RiSearchLine,
  RiSettings5Line,
  RiSparkling2Fill,
  RiSparkling2Line,
  RiStackFill,
  RiStackLine,
  RiStarFill,
  RiStarLine,
  RiVoiceprintFill,
  RiVoiceprintLine,
} from 'react-icons/ri';

import {
  NavigationPanelCollections,
  NavigationPanelFavorites,
  NavigationPanelOrganize,
  NavigationPanelTags,
} from '../../desktop/components/navigation-panel';
import {
  formatElapsedTime,
  meetingDurationSeconds,
} from '../../desktop/pages/workspace/meetings/meeting-save';
import { WorkbenchService } from '../../modules/workbench';
import { WorkspaceNavigator } from '../workspace-selector';
import {
  aiPanelSlot$,
  pagePanelSlot$,
  setSidebarSection,
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

function formatMeetingHistoryTime(value: string) {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MMM D, h:mm A') : 'Meeting';
}

function meetingTitle(meeting: MeetingHistoryItem) {
  return `Meeting ${formatMeetingHistoryTime(meeting.createdAt)}`;
}

const SearchNavItem = () => {
  const t = useI18n();
  const { cMDKQuickSearchService } = useServices({ CMDKQuickSearchService });

  const onOpenQuickSearchModal = useCallback(() => {
    cMDKQuickSearchService.toggle();
  }, [cMDKQuickSearchService]);

  return (
    <MenuItem
      data-testid="slider-bar-quick-search-button"
      data-event-props="$.navigationPanel.$.quickSearch"
      icon={<RiSearch2Fill size={18} />}
      onClick={onOpenQuickSearchModal}
    >
      <span>{t['com.affine.cmdk.placeholder']()}</span>
    </MenuItem>
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
          className={styles.meetingsNewButton}
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
    <div className={styles.meetingHistoryRoot}>
      <div className={styles.meetingHistoryHeader}>
        <div className={styles.meetingHistoryTitle}>Meetings</div>
        <div className={styles.meetingHistoryCount}>
          {busy ? 'Loading...' : `${meetings.length} saved`}
        </div>
      </div>
      <div className={styles.meetingHistoryList}>
        {visibleMeetings.length ? (
          visibleMeetings.map(meeting => (
            <button
              className={styles.meetingHistoryItem}
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
              <span className={styles.meetingHistoryItemTitle}>
                {meetingTitle(meeting)}
              </span>
              <span className={styles.meetingHistoryItemMeta}>
                {meeting.status === 'stopped'
                  ? `${formatElapsedTime(meetingDurationSeconds(meeting))} · `
                  : 'Recording · '}
                {(meeting.transcriptSegments?.length ?? 0).toLocaleString()}{' '}
                transcript lines
              </span>
              {meeting.docId ? (
                <span
                  className={styles.meetingHistoryItemLink}
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
          <div className={styles.meetingHistoryEmpty}>
            No recorded meetings yet.
          </div>
        )}
        {meetings.length > visibleCount ? (
          <button
            className={styles.meetingHistoryMoreButton}
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

const RECENT_NOTES_LIMIT = 30;

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
    <div className={styles.panelGroup}>
      <div className={styles.panelGroupLabel}>Recents</div>
      {recent.map(id => (
        <RecentNoteRow key={id} docId={id} />
      ))}
    </div>
  );
};

const AIPanel = () => {
  const workbench = useService(WorkbenchService).workbench;
  const slotRef = useCallback((node: HTMLDivElement | null) => {
    aiPanelSlot$.next(node);
  }, []);
  return (
    <div className={styles.aiPanel}>
      <div className={styles.aiPanelSlot} ref={slotRef} />
      <div className={styles.aiPanelFallback}>
        <MenuItem
          icon={<RiAddLine size={18} />}
          onClick={() => workbench.open('/chat', { at: 'active' })}
        >
          <span>New chat</span>
        </MenuItem>
      </div>
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
  {
    id: 'favorites',
    label: 'Favorites',
    icon: <RiStarLine size={20} />,
    activeIcon: <RiStarFill size={20} />,
  },
  {
    id: 'organize',
    label: 'Organize',
    icon: <RiFolder3Line size={20} />,
    activeIcon: <RiFolder3Fill size={20} />,
  },
  {
    id: 'collections',
    label: 'Collections',
    icon: <RiStackLine size={20} />,
    activeIcon: <RiStackFill size={20} />,
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: <RiPriceTag3Line size={20} />,
    activeIcon: <RiPriceTag3Fill size={20} />,
  },
  {
    id: 'page',
    label: 'Page details',
    icon: <RiFileTextLine size={20} />,
    activeIcon: <RiFileTextFill size={20} />,
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

  const select = (id: SidebarSection) => {
    setSidebarSection(id);
    // Hovering the rail previews the panel; clicking an icon pins it open.
    appSidebar.setHovering(false);
    appSidebar.setOpen(true);
    if (id === 'meetings') workbench.open('/meetings', { at: 'active' });
  };

  return (
    <div
      className={styles.rail}
      data-testid="sidebar-rail"
      data-electron={BUILD_CONFIG.isElectron}
    >
      <div className={styles.railGroup}>
        {RAIL_ITEMS.filter(item => item.id !== 'ai' || aiEnabled).map(item => (
          <RailButton
            key={item.id}
            label={item.label}
            active={section === item.id}
            testId={`sidebar-rail-${item.id}`}
            onClick={() => select(item.id)}
          >
            {section === item.id ? item.activeIcon : item.icon}
          </RailButton>
        ))}
        <div className={styles.railDivider} />
        <RailButton
          label="Journals"
          active={isJournal}
          testId="sidebar-rail-journals"
          onClick={() => workbench.open('/journals', { at: 'active' })}
        >
          <RiCalendarTodoLine size={20} />
        </RailButton>
      </div>
      <div className={styles.railGroup}>
        <MoreMenu aiEnabled={aiEnabled} onSelect={select} />
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

// Every destination in one list, so nothing depends on finding its icon.
const MoreMenu = ({
  aiEnabled,
  onSelect,
}: {
  aiEnabled: boolean;
  onSelect: (id: SidebarSection) => void;
}) => {
  const workbench = useService(WorkbenchService).workbench;
  const workspaceDialogService = useService(WorkspaceDialogService);
  const { cMDKQuickSearchService } = useServices({ CMDKQuickSearchService });
  const open = (path: string) => workbench.open(path, { at: 'active' });

  const items = (
    <>
      <PopMenuItem
        prefixIcon={<RiSearchLine />}
        onSelect={() => cMDKQuickSearchService.toggle()}
      >
        Search
      </PopMenuItem>
      <PopMenuItem
        prefixIcon={<RiFileList3Line />}
        onSelect={() => open('/all')}
      >
        All docs page
      </PopMenuItem>
      {aiEnabled ? (
        <PopMenuItem
          prefixIcon={<RiSparkling2Line />}
          onSelect={() => open('/chat')}
        >
          Nota AI full chat
        </PopMenuItem>
      ) : null}
      <MenuSeparator />
      {RAIL_ITEMS.filter(item => item.id !== 'ai' || aiEnabled).map(item => (
        <PopMenuItem
          key={item.id}
          prefixIcon={item.icon}
          onSelect={() => onSelect(item.id)}
        >
          {item.label}
        </PopMenuItem>
      ))}
      <PopMenuItem
        prefixIcon={<RiCalendarTodoLine />}
        onSelect={() => open('/journals')}
      >
        Journals
      </PopMenuItem>
      <MenuSeparator />
      <PopMenuItem
        prefixIcon={<RiInboxArchiveLine />}
        onSelect={() => workspaceDialogService.open('import', undefined)}
      >
        Import
      </PopMenuItem>
      <PopMenuItem
        prefixIcon={<RiDeleteBin6Line />}
        onSelect={() => open('/trash')}
      >
        Trash
      </PopMenuItem>
      <PopMenuItem
        prefixIcon={<RiSettings5Line />}
        onSelect={() =>
          workspaceDialogService.open('setting', { activeTab: 'appearance' })
        }
      >
        Settings
      </PopMenuItem>
    </>
  );

  return (
    <Menu items={items} contentOptions={{ side: 'right', align: 'end' }}>
      <button
        type="button"
        className={styles.railButton}
        aria-label="More"
        title="More"
        data-testid="sidebar-rail-more"
      >
        <RiMoreLine size={20} />
      </button>
    </Menu>
  );
};

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
    storedSection === 'ai' && !aiEnabled ? 'notes' : storedSection;

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
            </div>
            {section === 'notes' ? (
              <>
                {!BUILD_CONFIG.isElectron && <SearchNavItem />}
                <AllNotesNavItem />
              </>
            ) : null}
            {section === 'meetings' ? <MeetingsNavItem /> : null}
          </SidebarContainer>
          {aiEnabled ? (
            <div className={styles.aiPanelHost} data-hidden={section !== 'ai'}>
              <AIPanel />
            </div>
          ) : null}
          <div className={styles.aiPanelHost} data-hidden={section !== 'page'}>
            <PagePanel visible={section === 'page'} />
          </div>
          {section !== 'ai' && section !== 'page' ? (
            <SidebarScrollableContainer>
              {section === 'notes' ? <RecentNotes /> : null}
              {section === 'meetings' ? <MeetingHistorySidebar /> : null}
              {section === 'favorites' ? <NavigationPanelFavorites /> : null}
              {section === 'organize' ? <NavigationPanelOrganize /> : null}
              {section === 'collections' ? (
                <NavigationPanelCollections />
              ) : null}
              {section === 'tags' ? <NavigationPanelTags /> : null}
            </SidebarScrollableContainer>
          ) : null}
        </div>
      </div>
    </AppSidebar>
  );
});

RootAppSidebar.displayName = 'memo(RootAppSidebar)';
