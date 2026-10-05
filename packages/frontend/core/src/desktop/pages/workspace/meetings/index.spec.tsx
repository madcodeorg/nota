// @vitest-environment happy-dom
/* eslint-disable rxjs/finnish -- Service stubs preserve the production LiveData names. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { RootAppSidebar } from '../../../../components/root-app-sidebar';
import { Component as MeetingPage } from './index';

const mocks = vi.hoisted(() => {
  function liveData<T>(initial: T) {
    let value = initial;
    const listeners = new Set<() => void>();
    const source = {
      get value() {
        return value;
      },
      set(next: T) {
        value = next;
        listeners.forEach(listener => listener());
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      selector<R>(select: (value: T) => R) {
        return {
          get value() {
            return select(value);
          },
          subscribe: source.subscribe,
        };
      },
    };
    return source;
  }
  return {
    tokens: Object.fromEntries(
      [
        'DesktopApiService',
        'WorkspaceDialogService',
        'DocsService',
        'IntegrationService',
        'JournalService',
        'MeetingSettingsService',
        'GuardService',
        'WorkbenchService',
        'WorkspaceService',
        'ServerService',
        'FeatureFlagService',
        'CMDKQuickSearchService',
      ].map(name => [name, Symbol(name)])
    ),
    workbench: {
      location$: liveData({
        pathname: '/meetings',
        search: '?meetingId=meeting-1',
      }),
      workspaceSelectorOpen$: liveData(false),
      setWorkspaceSelectorOpen: vi.fn(),
      open: vi.fn(),
      openDoc: vi.fn(),
    },
    calendar: {
      localCalendarStatus$: liveData(null),
      workspaceCalendars$: liveData([]),
      eventsByDate$: () => liveData([]),
      eventsByDateMap$: liveData(new Map()),
      refreshLocalCalendarStatus: vi.fn(),
      loadAccountCalendars: vi.fn(),
      revalidateWorkspaceCalendars: vi.fn(),
      revalidateEvents: vi.fn(),
    },
    settings: { settings$: liveData({ recordingSavingMode: 'new-doc' }) },
    workspace: {
      id: 'workspace-1',
      flavour: 'local',
      docCollection: { getDoc: vi.fn(), meta: {} },
      engine: { doc: {} },
    },
    recording: {
      getCurrentRecording: vi.fn(),
      checkMeetingPermissions: vi.fn(),
      closeMicAudioSpool: vi.fn(),
      finishMicAudioSpool: vi.fn(),
      getMicAudioSpoolStatus: vi.fn(),
      getPublishedMicRecordingPath: vi.fn(),
      publishMicRecording: vi.fn(),
      readMicAudioSpoolArchive: vi.fn(),
    },
    executeMeetingSaveOnce: vi.fn(),
    persistPendingMeetingSave: vi.fn(),
    notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    fetch: vi.fn(),
  };
});

vi.mock('@nota/core/modules/desktop-api', () => ({
  DesktopApiService: mocks.tokens.DesktopApiService,
}));
vi.mock('@nota/core/modules/dialogs', () => ({
  WorkspaceDialogService: mocks.tokens.WorkspaceDialogService,
}));
vi.mock('@nota/core/modules/doc', () => ({
  DocsService: mocks.tokens.DocsService,
}));
vi.mock('@nota/core/modules/journal', () => ({
  JournalService: mocks.tokens.JournalService,
}));
vi.mock('@nota/core/modules/permissions', () => ({
  GuardService: mocks.tokens.GuardService,
}));
vi.mock('@nota/core/modules/cloud', () => ({
  ServerService: mocks.tokens.ServerService,
}));
vi.mock('@nota/core/modules/feature-flag', () => ({
  FeatureFlagService: mocks.tokens.FeatureFlagService,
}));
vi.mock('@nota/core/modules/quicksearch/services/cmdk', () => ({
  CMDKQuickSearchService: mocks.tokens.CMDKQuickSearchService,
}));
vi.mock('@nota/core/modules/workspace', () => ({
  WorkspaceService: mocks.tokens.WorkspaceService,
  isUserOwnedWorkspaceFlavour: () => true,
}));
vi.mock('@nota/core/modules/integration', () => ({
  IntegrationService: mocks.tokens.IntegrationService,
  presentLocalCalendarPermission: () => ({ action: 'none' }),
}));
vi.mock('@nota/core/modules/media/services/meeting-settings', () => ({
  MeetingSettingsService: mocks.tokens.MeetingSettingsService,
}));
vi.mock('@nota/core/modules/workbench', () => ({
  WorkbenchService: mocks.tokens.WorkbenchService,
  ViewBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ViewIcon: () => null,
  ViewTitle: () => null,
}));
vi.mock('@nota/core/utils/opus-encoding', () => ({
  createStreamEncoder: vi.fn(),
}));
vi.mock('@nota/infra', async () => {
  const { useSyncExternalStore } = await import('react');
  const services = new Map<symbol, unknown>([
    [mocks.tokens.WorkbenchService, { workbench: mocks.workbench }],
    [mocks.tokens.WorkspaceService, { workspace: mocks.workspace }],
    [
      mocks.tokens.DesktopApiService,
      {
        handler: { recording: mocks.recording },
        events: { recording: { onRecordingStatusChanged: () => () => {} } },
      },
    ],
    [mocks.tokens.MeetingSettingsService, mocks.settings],
    [mocks.tokens.IntegrationService, { calendar: mocks.calendar }],
    [mocks.tokens.ServerService, { server: { features$: { value: {} } } }],
    [
      mocks.tokens.FeatureFlagService,
      { flags: { enable_ai: { $: { value: false } } } },
    ],
  ]);
  const getService = (token: symbol) => services.get(token) ?? {};
  return {
    useFramework: () => ({ getOptional: () => undefined }),
    useService: getService,
    useServiceOptional: getService,
    useServices: (tokens: Record<string, symbol>) =>
      Object.fromEntries(
        Object.entries(tokens).map(([name, token]) => [
          name[0].toLowerCase() + name.slice(1),
          getService(token),
        ])
      ),
    useLiveData: (source: {
      value: unknown;
      subscribe?: (listener: () => void) => () => void;
    }) =>
      useSyncExternalStore(
        source.subscribe ?? (() => () => {}),
        () => source.value
      ),
  };
});
vi.mock('@nota/component', () => ({ notify: mocks.notify }));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@nota/core/modules/app-sidebar/views', () => ({
  AddPageButton: () => null,
  AppSidebar: ({ children }: { children: ReactNode }) => (
    <aside>{children}</aside>
  ),
  SidebarContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarScrollableContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  MenuItem: ({
    children,
    postfix,
    onClick,
  }: {
    children: ReactNode;
    postfix?: ReactNode;
    onClick?: () => void;
  }) => (
    <div>
      <button onClick={onClick}>{children}</button>
      {postfix}
    </div>
  ),
  MenuLinkItem: () => null,
}));
vi.mock('@nota/core/components/workspace-selector', () => ({
  WorkspaceNavigator: () => null,
}));
vi.mock('@nota/core/components/root-app-sidebar/bottom-icon-tray', () => ({
  BottomIconTray: () => null,
}));
vi.mock('@nota/core/desktop/components/navigation-panel', () => ({
  NavigationPanelFavorites: () => <div>Favorites</div>,
  NavigationPanelOrganize: () => null,
  NavigationPanelCollections: () => null,
  NavigationPanelTags: () => null,
}));
vi.mock('../ai-workspace-index', () => ({
  syncWorkspaceContentIndex: vi.fn(),
}));
vi.mock('./meeting-save-executor', () => ({
  createMeetingSavePermissionContext: () => ({}),
  executeMeetingSaveOnce: mocks.executeMeetingSaveOnce,
  finalizePortableMeetingMicRecording: vi.fn(async () => null),
  workspaceDocExists: () => true,
  workspaceDocHasBlock: () => false,
  appendMeetingMarkdownDoc: vi.fn(),
}));
vi.mock('./meeting-save-worker', () => ({
  browserMeetingSaveStorage: () => null,
  persistPendingMeetingSave: mocks.persistPendingMeetingSave,
}));

const segment = {
  id: 'segment-1',
  meetingId: 'meeting-1',
  type: 'final',
  source: 'system',
  startMs: 0,
  endMs: 32_000,
  text: 'The meeting transcript.',
  createdAt: '2026-10-05T14:00:32Z',
};
let meeting: {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  providerId: string;
  recordingDurationMs: number | null;
  docId: string | null;
  transcriptSegments: (typeof segment)[];
  stt: { status: string };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BUILD_CONFIG', { isElectron: true });
  vi.stubGlobal('environment', { isMacOs: true, isWindows: false });
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
  );
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.workbench.location$.set({
    pathname: '/meetings',
    search: '?meetingId=meeting-1',
  });
  mocks.workbench.open.mockImplementation(
    (location: { pathname: string; search: string }) => {
      mocks.workbench.location$.set(location);
    }
  );
  mocks.workbench.openDoc.mockImplementation((docId: string) => {
    mocks.workbench.location$.set({ pathname: `/${docId}`, search: '' });
  });
  mocks.workspace.docCollection.getDoc.mockReturnValue({
    getStore: () => ({}),
  });
  mocks.recording.getCurrentRecording.mockResolvedValue(null);
  mocks.calendar.refreshLocalCalendarStatus.mockResolvedValue(null);
  mocks.calendar.revalidateWorkspaceCalendars.mockResolvedValue(undefined);
  mocks.calendar.revalidateEvents.mockResolvedValue({ failedSources: 0 });
  meeting = {
    id: 'meeting-1',
    workspaceId: 'workspace-1',
    createdAt: new Date(Date.now() - 65_000).toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'stopped',
    providerId: 'cactus-whistle',
    recordingDurationMs: 65_000,
    docId: 'saved-meeting-note',
    transcriptSegments: [segment],
    stt: { status: 'stopped' },
  };
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/v1/meetings') return Response.json({ meetings: [meeting] });
    if (path === '/v1/meetings/meeting-1/stop') {
      meeting.status = 'stopped';
      meeting.stt.status = 'stopped';
    }
    if (path === '/v1/meetings/meeting-1') {
      if (init?.method === 'PATCH')
        Object.assign(meeting, JSON.parse(String(init.body)));
      return Response.json({ meeting });
    }
    if (path === '/v1/meetings/meeting-1/stop')
      return Response.json({ meeting });
    throw new Error(`Unexpected fetch: ${url}`);
  });
  mocks.executeMeetingSaveOnce.mockImplementation(async () => ({
    docId: 'saved-meeting-note',
    contentAdded: true,
    destination: 'new-doc',
    meeting,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('stopped meeting review', () => {
  test('restores the full duration when reopening a saved meeting', async () => {
    render(<MeetingPage />);
    const duration = await screen.findByLabelText('Meeting duration');
    expect(duration.textContent).toContain('01:05');
    expect(screen.getByText(segment.text)).toBeTruthy();
    expect(mocks.workbench.openDoc).not.toHaveBeenCalled();
  });

  test('falls back to transcript duration for an older meeting', async () => {
    meeting.recordingDurationMs = null;
    render(<MeetingPage />);
    expect(
      (await screen.findByLabelText('Meeting duration')).textContent
    ).toContain('00:32');
  });

  test('recovers a ready recording using its audio length instead of time since start', async () => {
    meeting.recordingDurationMs = null;
    mocks.recording.getCurrentRecording.mockResolvedValue({
      archiveBytes: 12_570_624,
      filepath: '/tmp/recovered.opus',
      id: 1,
      meetingId: 'meeting-1',
      numberOfChannels: 2,
      recovered: true,
      sampleRate: 48_000,
      startTime: Date.now() - 180_000,
      status: 'ready',
      workspaceId: 'workspace-1',
    });
    render(<MeetingPage />);
    await waitFor(() => expect(meeting.recordingDurationMs).toBe(32_736));
    expect(
      (await screen.findByLabelText('Meeting duration')).textContent
    ).toContain('00:33');
    expect(mocks.recording.finishMicAudioSpool).toHaveBeenCalledWith(
      'meeting-1'
    );
  });

  test('Stop preserves the meeting view and queues a background save', async () => {
    meeting.status = 'recording';
    meeting.stt.status = 'running';
    meeting.docId = null;
    render(<MeetingPage />);
    const stop = await screen.findByRole('button', { name: 'Stop meeting' });
    await waitFor(() => expect(stop.hasAttribute('disabled')).toBe(false));
    fireEvent.click(stop);
    const duration = await screen.findByLabelText('Meeting duration');
    expect(duration.textContent).toContain('01:05');
    expect(mocks.persistPendingMeetingSave).toHaveBeenCalledWith(
      'workspace-1',
      'meeting-1'
    );
    expect(mocks.workbench.location$.value.pathname).toBe('/meetings');
    expect(mocks.workbench.openDoc).not.toHaveBeenCalled();
  });

  test('saving stays in the meeting view until Open note is clicked', async () => {
    meeting.docId = null;
    render(<MeetingPage />);
    const save = await screen.findByRole('button', { name: 'Save meeting' });
    await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
    fireEvent.click(save);
    const open = await screen.findByRole('button', {
      name: 'Open saved meeting note',
    });
    expect(mocks.executeMeetingSaveOnce).toHaveBeenCalledOnce();
    expect(mocks.workbench.openDoc).not.toHaveBeenCalled();
    fireEvent.click(open);
    await waitFor(() =>
      expect(mocks.workbench.openDoc).toHaveBeenCalledWith(
        'saved-meeting-note',
        { at: 'active' }
      )
    );
  });

  test('keeps meeting history and duration on a linked note, and returns to the meeting', async () => {
    render(<RootAppSidebar />);
    const notes = await screen.findByText('Open notes');
    fireEvent.click(notes);
    expect(mocks.workbench.location$.value.pathname).toBe(
      '/saved-meeting-note'
    );
    expect(screen.getByText('01:05 · 1 transcript lines')).toBeTruthy();
    const historyItem = screen
      .getByText('01:05 · 1 transcript lines')
      .closest('button')!;
    expect(historyItem.dataset.selected).toBe('true');
    fireEvent.click(historyItem);
    expect(mocks.workbench.location$.value).toEqual({
      pathname: '/meetings',
      search: '?meetingId=meeting-1',
    });
    expect(within(historyItem).getByText('Open notes')).toBeTruthy();
  });

  test('keeps ordinary note navigation free of unrelated meeting history', async () => {
    mocks.workbench.location$.set({ pathname: '/ordinary-note', search: '' });
    render(<RootAppSidebar />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(screen.queryByText('Open notes')).toBeNull();
    expect(screen.getByText('Favorites')).toBeTruthy();
    await act(async () => {
      mocks.workbench.location$.set({
        pathname: '/saved-meeting-note',
        search: '',
      });
    });
    expect(await screen.findByText('Open notes')).toBeTruthy();
  });
});
