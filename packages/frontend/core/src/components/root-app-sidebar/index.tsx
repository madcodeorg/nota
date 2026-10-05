import {
  AddPageButton,
  AppSidebar,
  MenuItem,
  MenuLinkItem,
  SidebarContainer,
  SidebarScrollableContainer,
} from '@nota/core/modules/app-sidebar/views';
import { ServerService } from '@nota/core/modules/cloud';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { CMDKQuickSearchService } from '@nota/core/modules/quicksearch/services/cmdk';
import { WorkspaceService } from '@nota/core/modules/workspace';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService, useServices } from '@nota/infra';
import dayjs from 'dayjs';
import type { ReactElement } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  RiAddFill,
  RiFileList3Fill,
  RiRobot2Fill,
  RiSearch2Fill,
  RiVoiceprintFill,
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
import { BottomIconTray } from './bottom-icon-tray';
import * as styles from './index.css';

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

const IntelligenceNavItem = () => {
  const featureFlagService = useService(FeatureFlagService);
  const serverService = useService(ServerService);
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);
  const { workbenchService } = useServices({ WorkbenchService });
  const workbench = workbenchService.workbench;
  const aiChatActive = useLiveData(
    workbench.location$.selector(location => location.pathname === '/chat')
  );

  if (!enableAI || !serverFeatures?.copilot) {
    return null;
  }

  return (
    <MenuLinkItem
      icon={<RiRobot2Fill size={18} />}
      active={aiChatActive}
      to={'/chat'}
    >
      <span data-testid="ai-chat">Nota AI</span>
    </MenuLinkItem>
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

  if (location.pathname !== '/meetings' && !selectedMeetingId) {
    return null;
  }

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
export const RootAppSidebar = memo((): ReactElement => {
  const { workbenchService } = useServices({ WorkbenchService });

  const workbench = workbenchService.workbench;
  const workspaceSelectorOpen = useLiveData(workbench.workspaceSelectorOpen$);
  const location = useLiveData(workbench.location$);
  const meetingsActive = location.pathname === '/meetings';

  const onWorkspaceSelectorOpenChange = useCallback(
    (open: boolean) => {
      workbench.setWorkspaceSelectorOpen(open);
    },
    [workbench]
  );

  return (
    <AppSidebar>
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
        {!BUILD_CONFIG.isElectron && <SearchNavItem />}
        <AllNotesNavItem />
        <IntelligenceNavItem />
        <MeetingsNavItem />
      </SidebarContainer>
      <SidebarScrollableContainer>
        <MeetingHistorySidebar />
        {!meetingsActive ? (
          <>
            <NavigationPanelFavorites />
            <NavigationPanelOrganize />
            <NavigationPanelCollections />
            <NavigationPanelTags />
          </>
        ) : null}
      </SidebarScrollableContainer>
      <BottomIconTray />
    </AppSidebar>
  );
});

RootAppSidebar.displayName = 'memo(RootAppSidebar)';
