// @vitest-environment happy-dom
import type { LocalCalendarStatus } from '@nota/core/modules/integration/type';
import type { MeetingPermissionReport } from '@nota/core/modules/media/services/meeting-settings';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type * as ProviderSelection from './provider-selection';
import type { MeetingProviderSelectionInput } from './provider-selection';

const mocks = vi.hoisted(() => ({
  tokens: {
    meeting: Symbol('MeetingSettingsService'),
    desktop: Symbol('DesktopApiService'),
    integration: Symbol('IntegrationService'),
    google: Symbol('GoogleAuthService'),
  },
  meeting: {
    // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
    settings$: {
      value: { recordingMode: 'prompt', recordingSavingMode: 'new-doc' },
    },
    isRecordingFeatureAvailable: vi.fn(),
    checkMeetingPermissions: vi.fn(),
    showRecordingPermissionSetting: vi.fn(),
    askForMeetingPermission: vi.fn(),
  },
  calendar: {
    // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
    localCalendarStatus$: { value: null as LocalCalendarStatus | null },
    refreshLocalCalendarStatus: vi.fn(),
    requestLocalCalendarAccess: vi.fn(),
    openLocalCalendarSettings: vi.fn(),
  },
  google: {
    session: {
      // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
      status$: { value: 'disconnected' },
      // eslint-disable-next-line rxjs/finnish -- Preserve the service's LiveData API in the stub.
      userInfo$: { value: null },
    },
  },
  desktop: { handler: { recording: { prepareAppleSpeechLanguage: vi.fn() } } },
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  openConfirmModal: vi.fn(),
  providerSelectionState: vi.fn<
    (provider: MeetingProviderSelectionInput & { id?: string }) => {
      reason: string | null;
      selectable: boolean;
    }
  >(),
}));

vi.mock('./provider-selection', async importOriginal => {
  const actual = await importOriginal<typeof ProviderSelection>();
  return {
    ...actual,
    meetingProviderSelectionState:
      mocks.providerSelectionState.mockImplementation(
        actual.meetingProviderSelectionState
      ),
  };
});
vi.mock('@nota/core/modules/media/services/meeting-settings', () => ({
  MeetingSettingsService: mocks.tokens.meeting,
}));
vi.mock('@nota/core/modules/desktop-api', () => ({
  DesktopApiService: mocks.tokens.desktop,
}));
vi.mock('@nota/core/modules/google-auth', () => ({
  GoogleAuthService: mocks.tokens.google,
}));
vi.mock('@nota/core/modules/integration', async () => {
  const { presentLocalCalendarPermission } =
    await import('@nota/core/modules/integration/local-calendar-permission');
  return {
    IntegrationService: mocks.tokens.integration,
    presentLocalCalendarPermission,
  };
});
vi.mock('@nota/infra', () => ({
  useLiveData: (source: { value: unknown }) => source.value,
  useService: (token: symbol) => {
    switch (token) {
      case mocks.tokens.meeting:
        return mocks.meeting;
      case mocks.tokens.desktop:
        return mocks.desktop;
      case mocks.tokens.integration:
        return { calendar: mocks.calendar };
      case mocks.tokens.google:
        return mocks.google;
      default:
        throw new Error(`Unexpected service: ${String(token)}`);
    }
  },
}));
vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@nota/core/components/hooks/nota-async-hooks', () => ({
  useAsyncCallback: (callback: () => Promise<void>) => callback,
}));
vi.mock('@blocksuite/icons/rc', () => ({
  ArrowRightSmallIcon: () => null,
  DoneIcon: () => null,
  DownloadIcon: () => null,
  ResetIcon: () => null,
}));
vi.mock('@nota/component', () => {
  const Button = ({
    children,
    loading,
    disabled,
    prefix: _prefix,
    block: _block,
    icon: _icon,
    tooltip: _tooltip,
    ...props
  }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'prefix'> & {
    loading?: boolean;
    prefix?: ReactNode;
    block?: boolean;
    icon?: ReactNode;
    tooltip?: string;
  }) => (
    <button {...props} disabled={disabled || loading}>
      {children}
    </button>
  );
  return {
    Button,
    IconButton: Button,
    MenuTrigger: Button,
    // Keep options inline: these tests exercise settings, not portal behavior.
    Menu: ({ children, items }: { children: ReactNode; items: ReactNode }) => (
      <div>
        {children}
        <div role="menu">{items}</div>
      </div>
    ),
    MenuItem: ({
      children,
      onSelect,
      checked: _checked,
      disabled,
      ...props
    }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & {
      onSelect: () => void;
      checked?: boolean;
    }) => (
      // Deliberately forward disabled selections to exercise the handler guard.
      <button
        {...props}
        role="menuitem"
        aria-disabled={disabled}
        onClick={onSelect}
      >
        {children}
      </button>
    ),
    Progress: ({ value }: { value: number }) => (
      <progress max={100} value={value} />
    ),
    notify: mocks.notify,
    useConfirmModal: () => ({ openConfirmModal: mocks.openConfirmModal }),
  };
});
vi.mock('@nota/component/setting-components', () => ({
  SettingHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  SettingWrapper: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SettingRow: ({
    name,
    desc,
    children,
  }: {
    name: string;
    desc?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h2>{name}</h2>
      <div>{desc}</div>
      {children}
    </div>
  ),
}));

import { MeetingsSettings } from './index';

type Provider = {
  id: string;
  name: string;
  modelId?: string;
  available: boolean;
  canProduceTranscript: boolean;
  defaultForPlatform: boolean;
  notes: string;
  languages?: string[];
  installedLanguages?: string[];
  systemLocale?: string;
  readiness: {
    status:
      | 'available'
      | 'failed'
      | 'missing_model'
      | 'missing_runtime'
      | 'unsupported'
      | 'planned';
    reason?: string;
  };
  transcriptMode: 'native-streaming' | 'unavailable' | 'vad-chunk';
};

const nemotron: Provider = {
  id: 'nemotron-sherpa',
  name: 'Nemotron 3.5',
  modelId: 'sherpa-nemotron-3.5-streaming-560ms-int8',
  available: false,
  canProduceTranscript: false,
  defaultForPlatform: true,
  notes: '',
  readiness: { status: 'missing_model', reason: 'Download the model first.' },
  transcriptMode: 'unavailable',
};
const apple: Provider = {
  id: 'apple-speechanalyzer',
  name: 'Apple System Speech',
  available: true,
  canProduceTranscript: true,
  defaultForPlatform: false,
  notes: '',
  readiness: { status: 'available' },
  transcriptMode: 'native-streaming',
};
const readyNemotron: Provider = {
  ...nemotron,
  available: true,
  canProduceTranscript: true,
  readiness: { status: 'available' },
  transcriptMode: 'native-streaming',
};
const autoError = 'No automatic transcription model is ready.';
const missingModelDiagnostic =
  'whisper-base-q5-cpp is not downloaded yet. POST /v1/local/models/whisper-base-q5-cpp/download, then check GET /v1/local/models/whisper-base-q5-cpp. Local path: /Users/example/Library/Application Support/Nota/.nota/models/whisper-base-q5-cpp';

function model(
  downloadStatus:
    | 'not_started'
    | 'queued'
    | 'downloading'
    | 'downloaded' = 'not_started',
  progress = 0,
  languageDetection: 'automatic' | 'fixed' | 'selectable' = 'automatic'
) {
  return {
    id: nemotron.modelId!,
    type: 'stt',
    runtime: 'sherpa-onnx',
    sttProviderId: nemotron.id,
    languageDetection,
    streaming: true,
    languages: ['en-US', 'fr-CA'],
    sizeMb: 100,
    minRamGb: 2,
    releaseState: 'ready',
    deviceFit: 'fits',
    downloadStatus,
    progress,
    bytesDownloaded: progress * 100 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
  };
}

function backendSettings() {
  return {
    meetings: {
      localModels: [model()],
      sttModelId: '',
      sttProviderId: 'auto',
      sttLanguage: 'auto',
      sttProviders: [nemotron, apple],
      // Apple can transcribe, but that does not make Auto ready.
      transcriptionAvailable: true,
    },
  };
}

function backendRuntime(
  resolvedProvider: Provider | null = null,
  providers = [nemotron, apple],
  selectedProviderId = 'auto'
) {
  return {
    platform: 'darwin',
    selectedProviderId,
    selectedProvider:
      providers.find(provider => provider.id === selectedProviderId) ?? null,
    selectedModelId: resolvedProvider?.modelId ?? null,
    resolvedProvider,
    resolvedProviderId: resolvedProvider?.id ?? null,
    transcriptAvailable: resolvedProvider?.canProduceTranscript === true,
    autoSelectionError: resolvedProvider ? null : autoError,
    providers,
  };
}

const fetchMock = vi.fn<typeof fetch>();
let settings: ReturnType<typeof backendSettings>;
let runtime: ReturnType<typeof backendRuntime>;
let models: ReturnType<typeof model>[];
let modelsHttpStatus: number;
let runtimeHttpStatus: number;
let download: { status: string; message: string };
let unexpectedRequests: string[];

function requests(path: string) {
  return fetchMock.mock.calls.filter(([url]) => url === path);
}

async function mountSettings() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<MeetingsSettings />);
  });
  return view;
}

async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('environment', { isMacOs: true });
  mocks.meeting.isRecordingFeatureAvailable.mockResolvedValue(false);
  mocks.meeting.checkMeetingPermissions.mockResolvedValue(undefined);
  mocks.meeting.showRecordingPermissionSetting.mockResolvedValue(false);
  mocks.meeting.askForMeetingPermission.mockResolvedValue(undefined);
  mocks.calendar.localCalendarStatus$.value = null;
  mocks.calendar.refreshLocalCalendarStatus.mockResolvedValue(undefined);
  settings = backendSettings();
  runtime = backendRuntime();
  models = settings.meetings.localModels;
  modelsHttpStatus = 200;
  runtimeHttpStatus = 200;
  download = { status: 'error', message: 'Model download failed.' };
  unexpectedRequests = [];
  fetchMock.mockImplementation(async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/ai/settings') {
      return Response.json(settings);
    }
    if (method === 'GET' && url === '/v1/stt/runtime') {
      return Response.json(runtime, { status: runtimeHttpStatus });
    }
    if (method === 'GET' && url === '/v1/stt/models') {
      return Response.json({ models }, { status: modelsHttpStatus });
    }
    if (
      method === 'POST' &&
      url === `/v1/stt/models/${nemotron.modelId}/download`
    ) {
      return Response.json({ download }, { status: 409 });
    }
    unexpectedRequests.push(`${method} ${String(url)}`);
    throw new Error(`Unexpected request: ${method} ${String(url)}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Only explicit selection tests opt into save/preload responses.
  expect(unexpectedRequests).toEqual([]);
});

describe('meeting permission settings', () => {
  const openSettingsLabel = 'com.affine.cmdk.affine.navigation.open-settings';
  const systemAudioName =
    'com.affine.settings.meetings.privacy.screen-system-audio-recording';

  function permissionReport(
    status: 'unknown' | 'granted' = 'unknown',
    source: MeetingPermissionReport['systemAudioAccessSource'] = 'not-checked'
  ): MeetingPermissionReport {
    return {
      checkedAt: 1,
      microphone: true,
      ready: status === 'granted',
      reasons: {},
      runtime: { available: true, reason: null },
      systemAudio: status === 'granted',
      systemAudioAccessSource: source,
      statuses: { microphone: 'granted', systemAudio: status },
    };
  }

  async function activate(event: 'focus' | 'visibilitychange') {
    await act(async () => {
      fireEvent(event === 'focus' ? window : document, new Event(event));
    });
  }

  beforeEach(() => {
    mocks.meeting.isRecordingFeatureAvailable.mockResolvedValue(true);
    mocks.meeting.checkMeetingPermissions.mockResolvedValue(permissionReport());
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });

  test('mounts permission controls with a passive check only', async () => {
    await mountSettings();

    expect(screen.getByRole('heading', { name: systemAudioName })).toBeTruthy();
    expect(screen.getByText('Checked on start')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test access' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check access' })).toBeNull();
    expect(
      screen.queryByRole('status', {
        name: `${systemAudioName} access granted`,
      })
    ).toBeNull();
    expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([[]]);
    expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
    expect(mocks.meeting.showRecordingPermissionSetting).not.toHaveBeenCalled();
  });

  test('retains passive startup status after settings remount and focus', async () => {
    await mountSettings();
    cleanup();
    await mountSettings();
    await activate('focus');

    expect(screen.getByText('Checked on start')).toBeTruthy();
    expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
      [],
      [],
      [{ probeSystemAudio: false }],
    ]);
    expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
  });

  test('runs the optional system audio test only after an explicit click', async () => {
    await mountSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test access' }));
    });

    expect(
      mocks.meeting.askForMeetingPermission
    ).toHaveBeenCalledExactlyOnceWith('systemAudio');
  });

  test.each([
    'failed-probe',
    'reason-only',
    'unavailable-runtime',
    'denied',
    'restricted',
  ] as const)(
    'does not hide %s behind a checked-on-start state',
    async failure => {
      const report = permissionReport();
      if (failure === 'failed-probe') {
        report.systemAudioAccessSource = 'core-audio-probe';
        report.reasons.systemAudio = 'System audio check failed.';
      } else if (failure === 'reason-only') {
        report.reasons.systemAudio = 'System audio check could not complete.';
      } else if (failure === 'unavailable-runtime') {
        report.runtime = {
          available: false,
          reason: 'Native binding missing.',
        };
      } else {
        report.statuses.systemAudio = failure;
      }
      mocks.meeting.checkMeetingPermissions.mockResolvedValue(report);
      await mountSettings();

      expect(screen.queryByText('Checked on start')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Test access' })).toBeNull();
      expect(
        screen.getByRole('button', { name: openSettingsLabel })
      ).toBeTruthy();
    }
  );

  test('checks pending calendar consent without submitting another request', async () => {
    mocks.calendar.localCalendarStatus$.value = {
      available: true,
      authorized: false,
      requestPending: true,
      status: 'not-determined',
      supported: true,
    };
    await mountSettings();
    mocks.calendar.refreshLocalCalendarStatus.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    });

    expect(mocks.calendar.refreshLocalCalendarStatus).toHaveBeenCalledOnce();
    expect(mocks.calendar.requestLocalCalendarAccess).not.toHaveBeenCalled();
    expect(mocks.calendar.openLocalCalendarSettings).not.toHaveBeenCalled();
    const calendarRow = screen.getByRole('heading', {
      name: 'Apple Calendar',
    }).parentElement!;
    expect(
      within(calendarRow).queryByRole('button', { name: 'Connect' })
    ).toBeNull();
  });

  test('does not open Settings while an Add Only upgrade is still pending', async () => {
    mocks.calendar.localCalendarStatus$.value = {
      available: true,
      authorized: false,
      status: 'write-only',
      supported: true,
    };
    mocks.calendar.requestLocalCalendarAccess.mockResolvedValue({
      ...mocks.calendar.localCalendarStatus$.value,
      requestPending: true,
    });
    await mountSettings();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Request Full Access' })
      );
    });

    expect(mocks.calendar.requestLocalCalendarAccess).toHaveBeenCalledOnce();
    expect(mocks.calendar.openLocalCalendarSettings).not.toHaveBeenCalled();
    expect(mocks.notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Waiting for Apple Calendar' })
    );
  });

  test.each(['denied', 'restricted', 'unknown', 'not-determined'] as const)(
    'opens Windows microphone settings for %s access without a macOS request',
    async status => {
      vi.stubGlobal('environment', { isMacOs: false, isWindows: true });
      const report = permissionReport();
      report.microphone = false;
      report.systemAudio = true;
      report.systemAudioAccessSource = 'platform-compatibility';
      report.statuses.microphone = status;
      mocks.meeting.checkMeetingPermissions.mockResolvedValue(report);
      mocks.meeting.showRecordingPermissionSetting.mockResolvedValue(true);
      await mountSettings();

      expect(
        screen.queryByRole('heading', { name: systemAudioName })
      ).toBeNull();
      expect(
        screen.getByRole('heading', {
          name: 'com.affine.settings.meetings.privacy.microphone',
        })
      ).toBeTruthy();
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: openSettingsLabel })
        );
      });
      expect(mocks.meeting.showRecordingPermissionSetting).toHaveBeenCalledWith(
        'microphone'
      );
      expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
      await activate('focus');
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenLastCalledWith({
        probeSystemAudio: false,
      });
    }
  );

  test('shows a granted Windows microphone without a consent action', async () => {
    vi.stubGlobal('environment', { isMacOs: false, isWindows: true });
    await mountSettings();
    expect(
      screen.getByRole('status', {
        name: 'com.affine.settings.meetings.privacy.microphone access granted',
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: openSettingsLabel })
    ).toBeNull();
  });

  test.each(['false', 'undefined', 'rejected'] as const)(
    'explains manual Windows recovery when Settings launch is %s',
    async outcome => {
      vi.stubGlobal('environment', { isMacOs: false, isWindows: true });
      const report = permissionReport();
      report.microphone = false;
      report.statuses.microphone = 'denied';
      mocks.meeting.checkMeetingPermissions.mockResolvedValue(report);
      if (outcome === 'rejected') {
        mocks.meeting.showRecordingPermissionSetting.mockRejectedValueOnce(
          new Error('Settings launch failed')
        );
      } else {
        mocks.meeting.showRecordingPermissionSetting.mockResolvedValueOnce(
          outcome === 'false' ? false : undefined
        );
      }
      await mountSettings();
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: openSettingsLabel })
        );
      });
      expect(mocks.notify.warning).toHaveBeenCalledExactlyOnceWith({
        title: 'Could not open permission settings',
        message:
          'Open Windows Settings > Privacy & security > Microphone and allow microphone access for desktop apps.',
      });
      expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
      await activate('focus');
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenLastCalledWith({
        probeSystemAudio: false,
      });
    }
  );

  test.each(['denied', 'restricted'] as const)(
    'reports a macOS Settings failure after microphone access becomes %s',
    async status => {
      const current = permissionReport('granted', 'core-audio-probe');
      current.microphone = false;
      current.statuses.microphone = 'not-determined';
      const next: MeetingPermissionReport = {
        ...current,
        statuses: { ...current.statuses, microphone: status },
      };
      mocks.meeting.checkMeetingPermissions
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(current)
        .mockResolvedValue(next);
      await mountSettings();
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: 'com.affine.settings.meetings.privacy.microphone.permission-setting',
          })
        );
      });
      expect(mocks.meeting.askForMeetingPermission).toHaveBeenCalledWith(
        'microphone'
      );
      expect(
        mocks.meeting.showRecordingPermissionSetting
      ).toHaveBeenCalledExactlyOnceWith('microphone');
      expect(mocks.notify.warning).toHaveBeenCalledExactlyOnceWith({
        title: 'Could not open permission settings',
        message: expect.stringContaining('Open System Settings'),
      });
    }
  );

  test('shows the native probe failure instead of advising another access retry', async () => {
    const report = permissionReport();
    const reason =
      'This native runtime does not support system-only audio permission checks. Update the native binding before retrying; microphone capture was not started.';
    report.reasons.systemAudio = reason;
    mocks.meeting.checkMeetingPermissions.mockResolvedValue(report);
    await mountSettings();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
    });
    expect(mocks.notify.warning).toHaveBeenCalledExactlyOnceWith({
      title: 'System Audio access not verified',
      message: `${reason} Access was checked for this app.`,
    });
    expect(mocks.meeting.showRecordingPermissionSetting).not.toHaveBeenCalled();
  });

  test.each([
    ['successful', 'granted'],
    ['failed', 'unknown'],
  ] as const)(
    'keeps repeated focus and visibility refreshes passive after a prior %s Core Audio probe',
    async (_outcome, status) => {
      mocks.meeting.checkMeetingPermissions.mockResolvedValue(
        permissionReport(status, 'core-audio-probe')
      );
      await mountSettings();
      if (status === 'granted') {
        expect(
          screen.getByRole('status', {
            name: `${systemAudioName} access granted`,
          })
        ).toBeTruthy();
      } else {
        expect(
          screen.getByRole('button', { name: 'Check access' })
        ).toBeTruthy();
        expect(
          screen.getByRole('button', { name: openSettingsLabel })
        ).toBeTruthy();
      }

      for (const event of [
        'focus',
        'visibilitychange',
        'focus',
        'visibilitychange',
      ] as const) {
        await activate(event);
      }

      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
        [],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: false }],
      ]);
      expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
      expect(
        mocks.meeting.showRecordingPermissionSetting
      ).not.toHaveBeenCalled();
    }
  );

  test.each(['focus', 'visibilitychange'] as const)(
    'arms exactly one probe after a successful System Settings visit returning via %s',
    async returnEvent => {
      await mountSettings();
      const launch = Promise.withResolvers<boolean>();
      mocks.meeting.showRecordingPermissionSetting.mockReturnValueOnce(
        launch.promise
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: openSettingsLabel })
        );
      });
      expect(
        mocks.meeting.showRecordingPermissionSetting
      ).toHaveBeenCalledExactlyOnceWith('systemAudio');
      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([[]]);

      await activate(returnEvent);
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenLastCalledWith({
        probeSystemAudio: false,
      });
      await act(async () => {
        launch.resolve(true);
      });
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(2);

      const probe = Promise.withResolvers<MeetingPermissionReport>();
      mocks.meeting.checkMeetingPermissions.mockReturnValueOnce(probe.promise);
      await activate(returnEvent);
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenLastCalledWith({
        probeSystemAudio: true,
      });
      await activate(returnEvent === 'focus' ? 'visibilitychange' : 'focus');
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(3);
      await act(async () => {
        const report = permissionReport('granted', 'core-audio-probe');
        mocks.meeting.checkMeetingPermissions.mockResolvedValue(report);
        probe.resolve(report);
      });
      await activate('focus');
      await activate('visibilitychange');

      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
        [],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: true }],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: false }],
      ]);
      expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
    }
  );

  test.each(['active', 'hidden', 'unfocused'] as const)(
    'preserves a Settings return during a pending passive refresh when %s at drain',
    async stateAtDrain => {
      const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
      await mountSettings();
      const passive = Promise.withResolvers<MeetingPermissionReport>();
      const probe = Promise.withResolvers<MeetingPermissionReport>();
      mocks.meeting.checkMeetingPermissions.mockReturnValueOnce(
        passive.promise
      );
      await activate('focus');
      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
        [],
        [{ probeSystemAudio: false }],
      ]);

      mocks.meeting.showRecordingPermissionSetting.mockResolvedValueOnce(true);
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: openSettingsLabel })
        );
      });
      expect(
        mocks.meeting.showRecordingPermissionSetting
      ).toHaveBeenCalledExactlyOnceWith('systemAudio');
      await activate('focus');
      await activate('visibilitychange');
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(2);

      const visibility = vi
        .spyOn(document, 'visibilityState', 'get')
        .mockReturnValue(stateAtDrain === 'hidden' ? 'hidden' : 'visible');
      hasFocus.mockReturnValue(stateAtDrain !== 'unfocused');
      mocks.meeting.checkMeetingPermissions.mockReturnValue(probe.promise);
      await act(async () => {
        passive.resolve(permissionReport());
      });
      if (stateAtDrain === 'hidden') {
        expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(2);
        await activate('focus');
        await activate('visibilitychange');
        expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(2);
        visibility.mockReturnValue('visible');
        await activate('visibilitychange');
      } else if (stateAtDrain === 'unfocused') {
        expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(2);
        hasFocus.mockReturnValue(true);
        await activate('focus');
      }
      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
        [],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: true }],
      ]);

      await activate('focus');
      await activate('visibilitychange');
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(3);
      await act(async () => {
        const report = permissionReport('granted', 'core-audio-probe');
        mocks.meeting.checkMeetingPermissions.mockResolvedValue(report);
        probe.resolve(report);
      });
      expect(mocks.meeting.checkMeetingPermissions).toHaveBeenCalledTimes(3);
      await activate('focus');
      await activate('visibilitychange');
      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
        [],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: true }],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: false }],
      ]);
      expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
    }
  );

  test.each(['false', 'undefined', 'rejected'] as const)(
    'shows manual recovery without arming a probe when System Settings launch is %s',
    async outcome => {
      await mountSettings();
      const error = new Error('Settings launch failed');
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      if (outcome === 'rejected') {
        mocks.meeting.showRecordingPermissionSetting.mockRejectedValueOnce(
          error
        );
      } else {
        mocks.meeting.showRecordingPermissionSetting.mockResolvedValueOnce(
          outcome === 'false' ? false : undefined
        );
      }
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: openSettingsLabel })
        );
      });
      expect(
        mocks.meeting.showRecordingPermissionSetting
      ).toHaveBeenCalledExactlyOnceWith('systemAudio');
      expect(consoleError).not.toHaveBeenCalled();
      expect(mocks.notify.warning).toHaveBeenCalledExactlyOnceWith({
        title: 'Could not open permission settings',
        message: expect.stringContaining('Screen & System Audio Recording'),
      });
      await activate('focus');
      await activate('visibilitychange');

      expect(mocks.meeting.checkMeetingPermissions.mock.calls).toEqual([
        [],
        [{ probeSystemAudio: false }],
        [{ probeSystemAudio: false }],
      ]);
      expect(mocks.meeting.askForMeetingPermission).not.toHaveBeenCalled();
    }
  );
});

describe('meeting transcription settings', () => {
  test('shows a missing model as a normal download step without raw diagnostics or an alert', async () => {
    settings.meetings.sttProviderId = nemotron.id;
    settings.meetings.sttProviders = [
      {
        ...nemotron,
        readiness: { status: 'missing_model', reason: missingModelDiagnostic },
      },
    ];
    runtime = backendRuntime(null, settings.meetings.sttProviders, nemotron.id);
    await mountSettings();

    const selected = screen.getByLabelText('Selected transcription model');
    expect(
      within(selected).getByText(
        'Download this model to use it for transcription.'
      )
    ).toBeTruthy();
    expect(
      within(selected).getAllByRole('button', { name: /Download/ })
    ).toHaveLength(1);
    expect(within(selected).getByText('Not downloaded')).toBeTruthy();
    expect(screen.queryByText(missingModelDiagnostic)).toBeNull();
    expect(screen.queryByText('Technical details')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test.each([
    { status: 'failed', downloadStatus: 'downloaded' },
    { status: 'missing_runtime', downloadStatus: 'downloaded' },
    { status: 'failed', downloadStatus: 'not_started' },
    { status: 'missing_runtime', downloadStatus: 'not_started' },
  ] as const)(
    'keeps a real $status runtime failure actionable when the model is $downloadStatus',
    async ({ status, downloadStatus }) => {
      settings.meetings.sttProviderId = nemotron.id;
      settings.meetings.localModels = [model(downloadStatus)];
      settings.meetings.sttProviders = [
        {
          ...nemotron,
          readiness: {
            status,
            reason:
              'Runtime failed at /Users/example/Library/Application Support/Nota/runtime',
          },
        },
      ];
      runtime = backendRuntime(
        null,
        settings.meetings.sttProviders,
        nemotron.id
      );
      await mountSettings();

      const selected = screen.getByLabelText('Selected transcription model');
      expect(selected.textContent).toContain(
        'choose another transcription model.'
      );
      expect(
        within(selected).queryByText(
          'Download this model to use it for transcription.'
        )
      ).toBeNull();
      const details = selected.querySelector('details')!;
      expect(details.open).toBe(false);
      expect(details.textContent).toContain('/Users/example/');
    }
  );

  test('labels the Arabic model token accurately and preserves it when saving', async () => {
    settings.meetings.sttProviderId = nemotron.id;
    settings.meetings.localModels[0].languages = ['ar-AR', 'en-US'];
    await mountSettings();
    expect(
      screen.queryByRole('menuitem', { name: 'Arabic (Argentina)' })
    ).toBeNull();
    fetchMock.mockImplementationOnce(async () => {
      settings.meetings.sttLanguage = 'ar-AR';
      return Response.json({ ok: true });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Arabic' }));
    });
    expect(
      requests('/api/ai/settings').find(
        ([, options]) => options?.method === 'POST'
      )?.[1]?.body
    ).toBe(JSON.stringify({ meetingSttLanguage: 'ar-AR' }));
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('Arabic');
  });

  test('shows a fixed-language model without offering unsupported preferences', async () => {
    const moonshine = {
      ...readyNemotron,
      id: 'moonshine-base-onnx',
      modelId: 'moonshine-base-onnx-q4',
      name: 'Moonshine Base',
      transcriptMode: 'vad-chunk' as const,
    };
    settings.meetings.sttProviderId = moonshine.id;
    settings.meetings.sttProviders = [moonshine, apple];
    settings.meetings.localModels = [
      {
        ...model('downloaded', 1, 'fixed'),
        id: moonshine.modelId,
        sttProviderId: moonshine.id,
        streaming: false,
        languages: ['en'],
      },
    ];
    runtime = backendRuntime(
      moonshine,
      settings.meetings.sttProviders,
      moonshine.id
    );
    await mountSettings();
    expect(
      screen.getByRole('status', { name: 'Transcription language mode' })
        .textContent
    ).toBe('English');
    expect(
      screen.queryByRole('button', { name: 'Transcription language' })
    ).toBeNull();
    expect(
      screen.getByText(
        'This model supports a fixed language. Choose a multilingual model for other languages.'
      )
    ).toBeTruthy();
    expect(requests('/api/ai/settings')).toHaveLength(1);
  });

  test('shows automatic language coverage for a multilingual model without a manual picker', async () => {
    const parakeet = {
      ...readyNemotron,
      id: 'parakeet-sherpa',
      modelId: 'sherpa-parakeet-tdt-0.6b-v3-int8',
      name: 'Parakeet TDT v3',
      transcriptMode: 'vad-chunk' as const,
    };
    settings.meetings.sttProviderId = parakeet.id;
    settings.meetings.sttProviders = [parakeet, apple];
    settings.meetings.localModels = [
      { ...model('downloaded', 1), id: parakeet.modelId, streaming: false },
    ];
    runtime = backendRuntime(
      parakeet,
      settings.meetings.sttProviders,
      parakeet.id
    );
    await mountSettings();
    expect(
      screen.getByRole('status', { name: 'Transcription language mode' })
        .textContent
    ).toBe('Automatic detection');
    expect(
      screen.queryByRole('button', { name: 'Transcription language' })
    ).toBeNull();
    expect(screen.getByText('Supported languages (2)')).toBeTruthy();
    expect(screen.getByText('English (United States)')).toBeTruthy();
    expect(screen.getByText('French (Canada)')).toBeTruthy();
  });

  test('does not invent a language count from a multilingual catalog marker', async () => {
    settings.meetings.sttProviderId = 'whisper-tiny-en-onnx';
    const whisper = {
      ...readyNemotron,
      id: 'whisper-tiny-en-onnx',
      modelId: 'whisper-tiny-en-onnx-q4',
      name: 'Whisper Tiny',
      transcriptMode: 'vad-chunk' as const,
    };
    settings.meetings.sttProviders = [whisper];
    settings.meetings.localModels = [
      {
        ...model('downloaded', 1),
        id: whisper.modelId,
        languages: ['multilingual'],
        streaming: false,
      },
    ];
    runtime = backendRuntime(whisper, [whisper], whisper.id);
    await mountSettings();
    expect(
      screen.getByRole('status', { name: 'Transcription language mode' })
        .textContent
    ).toBe('Automatic detection');
    expect(screen.queryByText(/Supported languages/)).toBeNull();
    expect(screen.queryByText('multilingual only')).toBeNull();
  });

  test('retains the saved language and explains a rejected language change', async () => {
    settings.meetings.sttProviderId = nemotron.id;
    settings.meetings.sttLanguage = 'en-US';
    await mountSettings();
    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        { error: 'Language setting could not be saved.' },
        { status: 500 }
      )
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'French (Canada)' })
      );
    });
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('English (United States)');
    expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
      'Your transcription language could not be saved. Refresh the status and try again.'
    );
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(0);
  });

  test('resets a preferred language when selecting a fixed-language model and updates its controls', async () => {
    const moonshine = {
      ...readyNemotron,
      id: 'moonshine-base-onnx',
      modelId: 'moonshine-base-onnx-q4',
      name: 'Moonshine Base',
      transcriptMode: 'vad-chunk' as const,
    };
    settings.meetings.sttProviderId = nemotron.id;
    settings.meetings.sttLanguage = 'fr-CA';
    settings.meetings.sttProviders = [readyNemotron, moonshine];
    settings.meetings.localModels.push({
      ...model('downloaded', 1, 'fixed'),
      id: moonshine.modelId,
      languages: ['en'],
      streaming: false,
    });
    await mountSettings();
    fetchMock
      .mockImplementationOnce(async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          meetingSttProviderId: moonshine.id,
          meetingSttModelId: moonshine.modelId,
          meetingSttLanguage: 'auto',
        });
        settings.meetings.sttProviderId = moonshine.id;
        settings.meetings.sttLanguage = 'auto';
        runtime = backendRuntime(
          moonshine,
          settings.meetings.sttProviders,
          moonshine.id
        );
        return Response.json({ ok: true });
      })
      .mockImplementationOnce(async () =>
        Response.json({ preload: { available: true, status: 'loaded' } })
      );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Select Moonshine Base transcription model',
        })
      );
    });
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe(moonshine.name);
    expect(
      screen.getByRole('status', { name: 'Transcription language mode' })
        .textContent
    ).toBe('English');
    expect(
      screen.queryByRole('menuitem', { name: 'French (Canada)' })
    ).toBeNull();
    expect(mocks.notify.success).toHaveBeenCalledWith({
      title: 'Transcription language reset to Auto for the selected model',
    });
  });

  test('labels download size and device RAM minimum separately', async () => {
    await mountSettings();
    expect(screen.getByText('Device minimum: 2 GB RAM')).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: /Nemotron 3.5/ }).textContent
    ).toContain('100 MB download');
    expect(screen.queryByText(/100 MB · 2 GB RAM/)).toBeNull();
  });

  test('shows supported preferred locales only for native Nemotron and saves without preloading', async () => {
    settings.meetings.sttProviderId = nemotron.id;
    await mountSettings();
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('Auto');
    fetchMock.mockImplementationOnce(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        meetingSttLanguage: 'fr-CA',
      });
      settings.meetings.sttLanguage = 'fr-CA';
      return Response.json({ ok: true });
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitem', { name: 'French (Canada)' })
      );
    });
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('French (Canada)');
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(0);
  });

  test.each(['auto', 'apple-speechanalyzer'])(
    'explains language behavior without an unsupported picker for %s',
    async provider => {
      settings.meetings.sttProviderId = provider;
      await mountSettings();
      expect(
        screen.queryByRole('button', { name: 'Transcription language' })
      ).toBeNull();
      expect(
        screen.getByRole('status', { name: 'Transcription language mode' })
          .textContent
      ).toBe(
        provider === 'auto' ? 'Automatic detection' : 'Mac system language'
      );
    }
  );
  test('uses runtime readiness for Auto when only manual Apple speech is available', async () => {
    await mountSettings();

    expect(requests('/v1/stt/runtime')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe('Auto (recommended)');
    const autoOption = screen.getByRole('menuitem', {
      name: /Auto \(recommended\)/,
    });
    expect(within(autoOption).queryByText('Ready')).toBeNull();
    expect(within(autoOption).getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText(autoError)).toBeTruthy();
    expect(
      within(
        screen.getByRole('menuitem', { name: /Apple System Speech/ })
      ).getByText('Ready')
    ).toBeTruthy();
  });

  test('shows Auto as ready when the runtime resolves a transcription provider', async () => {
    settings.meetings.sttProviders = [readyNemotron, apple];
    settings.meetings.localModels = [model('downloaded', 1)];
    runtime = backendRuntime(readyNemotron, settings.meetings.sttProviders);
    await mountSettings();

    expect(
      within(
        screen.getByRole('menuitem', { name: /Auto \(recommended\)/ })
      ).getByText('Ready')
    ).toBeTruthy();
    expect(screen.getByText('Automatic selection')).toBeTruthy();
    expect(screen.getByText('Downloaded')).toBeTruthy();
    expect(screen.queryByText(autoError)).toBeNull();
    await poll();
    expect(requests('/v1/stt/models')).toHaveLength(0);
    expect(requests('/v1/stt/runtime')).toHaveLength(1);
  });

  test.each([apple, nemotron])(
    'preserves the saved $id manual selection on load and refresh',
    async provider => {
      settings.meetings.sttProviderId = provider.id;
      settings.meetings.sttModelId = provider.modelId ?? '';
      runtime = backendRuntime(
        provider.available ? provider : null,
        settings.meetings.sttProviders,
        provider.id
      );
      await mountSettings();
      expect(
        screen.getByRole('button', { name: 'Transcription model' }).textContent
      ).toBe(provider.name);
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Refresh transcription status' })
        );
      });

      expect(requests('/api/ai/settings')).toHaveLength(2);
      expect(
        screen.getByRole('button', { name: 'Transcription model' }).textContent
      ).toBe(provider.name);
      expect(
        screen.getByRole('menuitem', { name: new RegExp(provider.name) })
          .dataset.selected
      ).toBe('true');
      expect(
        screen.getByRole('menuitem', { name: /Auto \(recommended\)/ }).dataset
          .selected
      ).toBe('false');
    }
  );

  test.each([
    'Download the selected transcription model before recording.',
    missingModelDiagnostic,
    null,
  ])(
    'saves before preloading and treats an unavailable missing model as setup: %s',
    async message => {
      await mountSettings();
      const save = Promise.withResolvers<Response>();
      const preload = Promise.withResolvers<Response>();
      fetchMock
        .mockImplementationOnce(() => save.promise)
        .mockImplementationOnce(() => preload.promise);

      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Nemotron 3.5/ }));
      });
      expect(fetchMock).toHaveBeenLastCalledWith('/api/ai/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          meetingSttModelId: nemotron.modelId,
          meetingSttProviderId: nemotron.id,
          meetingSttLanguage: 'auto',
        }),
      });
      expect(requests('/v1/stt/runtime/preload')).toHaveLength(0);
      expect(screen.getByText('Saving and preparing model...')).toBeTruthy();
      expect(
        (
          screen.getByRole('button', {
            name: 'Transcription model',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);

      settings.meetings.sttProviderId = nemotron.id;
      settings.meetings.sttModelId = nemotron.modelId!;
      runtime = backendRuntime(
        null,
        settings.meetings.sttProviders,
        nemotron.id
      );
      await act(async () => {
        save.resolve(Response.json({ ok: true }));
      });
      expect(fetchMock).toHaveBeenLastCalledWith('/v1/stt/runtime/preload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: nemotron.id }),
      });
      expect(requests('/api/ai/settings')).toHaveLength(2);
      expect(requests('/v1/stt/runtime')).toHaveLength(1);
      expect(mocks.notify.success).not.toHaveBeenCalled();

      await act(async () => {
        preload.resolve(
          Response.json({
            preload: {
              available: false,
              cached: false,
              durationMs: 0,
              message,
              modelId: nemotron.modelId,
              providerId: nemotron.id,
              status: 'unavailable',
            },
          })
        );
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText(missingModelDiagnostic)).toBeNull();
      expect(
        screen.getByText('Download this model to use it for transcription.')
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Transcription model' }).textContent
      ).toBe(nemotron.name);
      expect(requests('/api/ai/settings')).toHaveLength(3);
      expect(requests('/v1/stt/runtime')).toHaveLength(2);
      expect(requests('/v1/stt/runtime/preload')).toHaveLength(1);
      expect(screen.queryByText('Saving and preparing model...')).toBeNull();
      expect(mocks.notify.success).not.toHaveBeenCalled();
    }
  );

  test.each(['unsupported', 'planned'] as const)(
    'rejects a %s provider even when the menu forwards onSelect',
    async status => {
      settings.meetings.sttProviders = [
        { ...nemotron, readiness: { status } },
        apple,
      ];
      runtime = backendRuntime(null, settings.meetings.sttProviders);
      await mountSettings();
      const option = screen.getByRole('menuitem', { name: /Nemotron 3.5/ });
      expect(option.getAttribute('aria-disabled')).toBe('true');
      const count = fetchMock.mock.calls.length;

      await act(async () => {
        fireEvent.click(option);
      });

      expect(fetchMock).toHaveBeenCalledTimes(count);
      expect(
        screen.getByRole('button', { name: 'Transcription model' }).textContent
      ).toBe('Auto (recommended)');
      expect(screen.queryByText('Saving and preparing model...')).toBeNull();
      expect(mocks.notify.success).not.toHaveBeenCalled();
    }
  );

  test('rejects a menu callback with an unknown provider ID', async () => {
    await mountSettings();
    const autoProvider = mocks.providerSelectionState.mock.calls
      .map(([provider]) => provider)
      .findLast(provider => provider.id === 'auto');
    expect(autoProvider).toBeDefined();
    // Auto is a synthesized menu entry, separate from the saved provider registry.
    // Change the callback's ID to simulate an invalid selection from that boundary.
    autoProvider!.id = 'unknown-provider';
    const count = fetchMock.mock.calls.length;
    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitem', { name: /Auto \(recommended\)/ })
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(count);
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe('Auto (recommended)');
    expect(mocks.notify.success).not.toHaveBeenCalled();
  });

  test.each(['loading', 'saving', 'download'] as const)(
    'ignores a forwarded provider selection while %s is busy',
    async busy => {
      await mountSettings();
      const pending = Promise.withResolvers<Response>();
      fetchMock.mockImplementationOnce(() => pending.promise);
      if (busy === 'saving') {
        fetchMock.mockResolvedValueOnce(
          Response.json({
            preload: {
              available: false,
              message: 'Not ready.',
              status: 'unavailable',
            },
          })
        );
      }
      await act(async () => {
        fireEvent.click(
          busy === 'loading'
            ? screen.getByRole('button', {
                name: 'Refresh transcription status',
              })
            : busy === 'saving'
              ? screen.getByRole('menuitem', { name: /Nemotron 3.5/ })
              : screen.getByRole('button', {
                  name: `Download ${nemotron.name} transcription model`,
                })
        );
      });
      const count = fetchMock.mock.calls.length;
      expect(
        (
          screen.getByRole('button', {
            name: 'Transcription model',
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      await act(async () => {
        fireEvent.click(
          screen.getByRole('menuitem', { name: /Apple System Speech/ })
        );
      });
      expect(fetchMock).toHaveBeenCalledTimes(count);
      expect(
        screen.getByRole('button', { name: 'Transcription model' }).textContent
      ).toBe(busy === 'saving' ? nemotron.name : 'Auto (recommended)');

      await act(async () => {
        pending.resolve(
          Response.json(
            busy === 'loading'
              ? settings
              : busy === 'saving'
                ? { ok: true }
                : { download: { status: 'queued' } }
          )
        );
      });
      expect(requests('/v1/stt/runtime/preload')).toHaveLength(
        busy === 'saving' ? 1 : 0
      );
    }
  );

  test('rejects a second selection in the same tick while the first POST is in flight', async () => {
    await mountSettings();
    const pending = Promise.withResolvers<Response>();
    fetchMock
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(
        Response.json({
          preload: {
            available: false,
            message: 'Download the model first.',
            status: 'missing_model',
          },
        })
      );
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Nemotron 3.5/ }));
      fireEvent.click(
        screen.getByRole('menuitem', { name: /Apple System Speech/ })
      );
    });
    expect(requests('/api/ai/settings')).toHaveLength(2);
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe(nemotron.name);
    settings.meetings.sttProviderId = nemotron.id;
    settings.meetings.sttModelId = nemotron.modelId!;
    runtime = backendRuntime(null, settings.meetings.sttProviders, nemotron.id);
    await act(async () => {
      pending.resolve(Response.json({ ok: true }));
    });
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(1);
    expect(requests('/v1/stt/runtime/preload')[0][1]?.body).toBe(
      JSON.stringify({ providerId: nemotron.id })
    );
    expect(requests('/api/ai/settings')).toHaveLength(3);
  });

  test('reports native preload success as selection saved, not a model loaded', async () => {
    await mountSettings();
    fetchMock
      .mockImplementationOnce(async () => {
        settings.meetings.sttProviderId = apple.id;
        settings.meetings.sttModelId = '';
        runtime = backendRuntime(
          apple,
          settings.meetings.sttProviders,
          apple.id
        );
        return Response.json({ ok: true });
      })
      .mockResolvedValueOnce(
        Response.json({
          preload: {
            available: true,
            cached: true,
            durationMs: 0,
            message: 'Apple SpeechAnalyzer is managed by the native recorder.',
            modelId: null,
            providerId: apple.id,
            status: 'native',
          },
        })
      );

    await act(async () => {
      fireEvent.click(
        screen.getByRole('menuitem', { name: /Apple System Speech/ })
      );
    });

    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/ai/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        meetingSttModelId: '',
        meetingSttProviderId: apple.id,
        meetingSttLanguage: 'auto',
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/v1/stt/runtime/preload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: apple.id }),
    });
    expect(mocks.notify.success).toHaveBeenCalledExactlyOnceWith({
      title: 'Meeting transcription selection saved',
    });
    expect(mocks.notify.success).not.toHaveBeenCalledWith({
      title: 'Meeting transcription model ready',
    });
    expect(mocks.notify.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe(apple.name);
    expect(requests('/api/ai/settings')).toHaveLength(3);
    expect(requests('/v1/stt/runtime')).toHaveLength(2);
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(1);
  });

  test('restores the original saved selection after POST failure without preloading', async () => {
    settings.meetings.sttProviderId = apple.id;
    runtime = backendRuntime(apple, settings.meetings.sttProviders, apple.id);
    await mountSettings();
    const save = Promise.withResolvers<Response>();
    fetchMock.mockImplementationOnce(() => save.promise);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Nemotron 3.5/ }));
    });
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe(nemotron.name);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/ai/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        meetingSttModelId: nemotron.modelId,
        meetingSttProviderId: nemotron.id,
        meetingSttLanguage: 'auto',
      }),
    });

    await act(async () => {
      save.resolve(
        Response.json({ error: 'Settings save failed.' }, { status: 500 })
      );
    });
    const trigger = screen.getByRole('button', {
      name: 'Transcription model',
    }) as HTMLButtonElement;
    expect(trigger.textContent).toBe(apple.name);
    expect(trigger.disabled).toBe(false);
    expect(
      screen.getByRole('menuitem', { name: /Apple System Speech/ }).dataset
        .selected
    ).toBe('true');
    expect(
      screen.getByRole('menuitem', { name: /Nemotron 3.5/ }).dataset.selected
    ).toBe('false');
    expect(requests('/api/ai/settings')).toHaveLength(3);
    expect(requests('/v1/stt/runtime')).toHaveLength(2);
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(0);
    expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
      'Your transcription selection could not be saved. Refresh the status and try again.'
    );
    expect(mocks.notify.error).toHaveBeenCalledExactlyOnceWith({
      title:
        'Your transcription selection could not be saved. Refresh the status and try again.',
    });
    expect(mocks.notify.success).not.toHaveBeenCalled();
    expect(screen.queryByText('Saving and preparing model...')).toBeNull();
  });

  test.each([
    'unavailable',
    'missing_model',
    'unsupported',
    'failure',
  ] as const)(
    'terminal polling clears an unavailable warning but retains a thrown preload error: %s',
    async outcome => {
      await mountSettings();
      const message = 'The selected transcription model could not load.';
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchMock
        .mockImplementationOnce(async () => {
          settings.meetings.sttProviderId = nemotron.id;
          settings.meetings.sttModelId = nemotron.modelId!;
          settings.meetings.localModels = [model('downloading', 0.25)];
          models = settings.meetings.localModels;
          runtime = backendRuntime(
            null,
            settings.meetings.sttProviders,
            nemotron.id
          );
          return Response.json({ ok: true });
        })
        .mockResolvedValueOnce(
          outcome === 'failure'
            ? Response.json({ error: message }, { status: 503 })
            : Response.json({
                preload: { available: false, message, status: outcome },
              })
        );
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Nemotron 3.5/ }));
      });
      const expected =
        outcome === 'failure'
          ? 'Your selection was saved, but the model could not load. Restart Nota or choose another transcription model.'
          : 'This model could not start. Restart Nota or choose another transcription model.';
      const hasError = outcome === 'failure' || outcome === 'unsupported';
      if (hasError)
        expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
          expected
        );
      else expect(screen.queryByRole('alert')).toBeNull();
      expect(mocks.notify.success).not.toHaveBeenCalled();

      await poll();
      if (hasError)
        expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
          expected
        );
      else expect(screen.queryByRole('alert')).toBeNull();
      models = [model('downloaded', 1)];
      runtime = backendRuntime(
        readyNemotron,
        [readyNemotron, apple],
        nemotron.id
      );
      await poll();

      expect(screen.getByText('Downloaded')).toBeTruthy();
      expect(
        within(
          screen.getByRole('menuitem', { name: /Nemotron 3.5/ })
        ).getByText('Ready')
      ).toBeTruthy();
      if (outcome === 'unavailable' || outcome === 'missing_model') {
        expect(screen.queryByRole('alert')).toBeNull();
        expect(mocks.notify.error).not.toHaveBeenCalled();
      } else {
        expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
          expected
        );
        if (outcome === 'failure') {
          expect(mocks.notify.error).toHaveBeenCalledExactlyOnceWith({
            title: expected,
          });
        }
      }
      expect(requests('/v1/stt/runtime/preload')).toHaveLength(1);
      expect(requests('/api/ai/settings')).toHaveLength(3);
    }
  );

  test('hides an unavailable preload warning after the saved provider changes', async () => {
    settings.meetings.sttProviders = [
      { ...nemotron, readiness: { status: 'missing_runtime' } },
      apple,
    ];
    await mountSettings();
    fetchMock
      .mockImplementationOnce(async () => {
        settings.meetings.sttProviderId = nemotron.id;
        settings.meetings.sttModelId = nemotron.modelId!;
        runtime = backendRuntime(
          null,
          settings.meetings.sttProviders,
          nemotron.id
        );
        return Response.json({ ok: true });
      })
      .mockResolvedValueOnce(
        Response.json({
          preload: {
            available: false,
            message: 'Nemotron is not ready.',
            status: 'unavailable',
          },
        })
      );
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Nemotron 3.5/ }));
    });
    expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
      'This model is not ready. Refresh the status or choose another transcription model.'
    );

    settings.meetings.sttProviderId = 'auto';
    settings.meetings.sttModelId = '';
    runtime = backendRuntime();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh transcription status' })
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(autoError)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Transcription model' }).textContent
    ).toBe('Auto (recommended)');
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(1);
  });

  test.each([
    ['queued', 'Model download queued'],
    ['downloading', 'Model downloading'],
    ['downloaded', 'Model already downloaded'],
  ] as const)(
    'accepts HTTP 409 for an already %s model',
    async (status, title) => {
      download = { status, message: '' };
      await mountSettings();
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: `Download ${nemotron.name} transcription model`,
          })
        );
      });

      expect(mocks.notify.success).toHaveBeenCalledWith({ title });
      expect(mocks.notify.error).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    }
  );

  test.each(['blocked', 'planned', 'missing_url', 'error'])(
    'shows the HTTP 409 %s download reason inline instead of reporting success',
    async status => {
      download = { status, message: `Download rejected: ${status}.` };
      await mountSettings();
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', {
            name: `Download ${nemotron.name} transcription model`,
          })
        );
      });

      expect(
        requests(`/v1/stt/models/${nemotron.modelId}/download`)
      ).toHaveLength(1);
      const alert = screen.getByRole('alert');
      expect(alert.firstElementChild?.textContent).toBe(
        'The model download could not start. Check your connection and try Download again.'
      );
      const details = alert.querySelector('details')!;
      expect(details.open).toBe(false);
      expect(details.textContent).toContain(download.message);
      expect(mocks.notify.error).toHaveBeenCalledWith({
        title:
          'The model download could not start. Check your connection and try Download again.',
      });
      expect(mocks.notify.success).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole('button', {
            name: `Download ${nemotron.name} transcription model`,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
    }
  );

  test.each(['queued', 'downloading'] as const)(
    'polls an existing %s download to completion without preload or settings reload',
    async status => {
      settings.meetings.localModels = [model(status, 0.25)];
      models = settings.meetings.localModels;
      await mountSettings();

      expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25');
      expect(requests('/v1/stt/models')).toHaveLength(0);
      models = [model('downloading', 0.6)];
      await poll();
      expect(requests('/v1/stt/models')).toHaveLength(1);
      expect(requests('/v1/stt/runtime')).toHaveLength(2);
      expect(screen.getByRole('progressbar').getAttribute('value')).toBe('60');
      expect(screen.getByText('60 of 100 MB')).toBeTruthy();

      models = [model('downloaded', 1)];
      runtime = backendRuntime(readyNemotron, [readyNemotron, apple]);
      await poll();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.getByText('Downloaded')).toBeTruthy();
      expect(screen.getByText('Automatic selection')).toBeTruthy();
      expect(
        within(
          screen.getByRole('menuitem', { name: /Auto \(recommended\)/ })
        ).getByText('Ready')
      ).toBeTruthy();
      expect(
        within(
          screen.getByRole('menuitem', { name: /Nemotron 3.5/ })
        ).getByText('Ready')
      ).toBeTruthy();
      expect(requests('/api/ai/settings')).toHaveLength(1);
      expect(requests('/v1/stt/models')).toHaveLength(2);
      expect(requests('/v1/stt/runtime')).toHaveLength(3);

      await poll();
      expect(requests('/v1/stt/models')).toHaveLength(2);
      expect(requests('/v1/stt/runtime')).toHaveLength(3);
    }
  );

  test.each(['models', 'runtime'])(
    'shows a %s polling failure and clears it after a successful retry',
    async endpoint => {
      settings.meetings.localModels = [model('downloading', 0.25)];
      await mountSettings();
      if (endpoint === 'models') modelsHttpStatus = 503;
      else runtimeHttpStatus = 503;
      await poll();

      expect(screen.getByRole('alert').firstElementChild?.textContent).toBe(
        'Download status could not be refreshed. Check your connection and refresh the status.'
      );
      expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25');

      modelsHttpStatus = 200;
      runtimeHttpStatus = 200;
      models = [model('downloaded', 1)];
      runtime = backendRuntime(readyNemotron, [readyNemotron, apple]);
      await poll();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText('Downloaded')).toBeTruthy();
    }
  );

  test('waits for model health before requesting runtime readiness during polling', async () => {
    settings.meetings.localModels = [model('downloading', 0.25)];
    models = settings.meetings.localModels;
    await mountSettings();
    const response = Promise.withResolvers<Response>();
    const health = Promise.withResolvers<{ models: typeof models }>();
    fetchMock.mockImplementationOnce(() => response.promise);
    await poll();
    expect(requests('/v1/stt/models')).toHaveLength(1);
    expect(requests('/v1/stt/runtime')).toHaveLength(1);

    const modelsResponse = Response.json({});
    vi.spyOn(modelsResponse, 'json').mockImplementation(() => health.promise);
    await act(async () => {
      response.resolve(modelsResponse);
    });
    expect(requests('/v1/stt/runtime')).toHaveLength(1);
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25');

    runtime = backendRuntime(readyNemotron, [readyNemotron, apple]);
    await act(async () => {
      health.resolve({ models: [model('downloaded', 1)] });
    });
    expect(requests('/v1/stt/runtime')).toHaveLength(2);
    expect(screen.getByText('Downloaded')).toBeTruthy();
    expect(
      within(
        screen.getByRole('menuitem', { name: /Auto \(recommended\)/ })
      ).getByText('Ready')
    ).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(requests('/v1/stt/runtime/preload')).toHaveLength(0);
    await poll();
    expect(requests('/v1/stt/models')).toHaveLength(1);
    expect(requests('/v1/stt/runtime')).toHaveLength(2);
  });

  test('aborts polling and stops scheduling requests when settings unmounts', async () => {
    settings.meetings.localModels = [model('downloading')];
    models = settings.meetings.localModels;
    const view = await mountSettings();
    await poll();
    const signal = requests('/v1/stt/models')[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    view.unmount();
    expect(signal?.aborted).toBe(true);
    const requestCount = fetchMock.mock.calls.length;
    await poll();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });

  test('does not claim Auto is ready when the runtime status request fails', async () => {
    runtimeHttpStatus = 503;
    await mountSettings();

    expect(screen.getByText('Offline')).toBeTruthy();
    expect(
      screen.getByText(
        'The transcription service could not be reached. Restart Nota, then refresh the status.'
      )
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Transcription model',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.queryByText('Ready')).toBeNull();
  });
});

describe('native speech model language controls', () => {
  test.each([
    'whisper-tiny-cpp',
    'whisper-base-cpp',
    'whisper-small-cpp',
    'whisper-medium-cpp',
    'whisper-large-v3-cpp',
  ])('offers only the advertised language choices for %s', async id => {
    const provider = {
      ...readyNemotron,
      id,
      name: id,
      modelId: id.replace(/-cpp$/, '-q5-cpp'),
      transcriptMode: 'vad-chunk' as const,
    };
    const nativeModel = {
      ...model('downloaded', 1, 'selectable'),
      id: provider.modelId,
      languages: ['en', 'fr'],
      streaming: false,
    };
    settings.meetings.sttProviderId = id;
    settings.meetings.sttProviders = [provider];
    settings.meetings.localModels = [nativeModel];
    runtime = backendRuntime(provider, [provider], id);
    await mountSettings();
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('Auto');
    expect(screen.getByRole('menuitem', { name: /^French$/ })).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'French (Canada)' })
    ).toBeNull();
  });

  test('resets an incompatible language between two selectable models', async () => {
    const whisper = {
      ...readyNemotron,
      id: 'whisper-base-cpp',
      name: 'Whisper Base',
      modelId: 'whisper-base-q5-cpp',
      transcriptMode: 'vad-chunk' as const,
    };
    settings.meetings.sttProviderId = nemotron.id;
    settings.meetings.sttLanguage = 'fr-CA';
    settings.meetings.sttProviders = [readyNemotron, whisper];
    settings.meetings.localModels.push({
      ...model('downloaded', 1, 'selectable'),
      id: whisper.modelId,
      languages: ['en', 'fr'],
      streaming: false,
    });
    await mountSettings();
    fetchMock
      .mockImplementationOnce(async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          meetingSttProviderId: 'whisper-base-cpp',
          meetingSttLanguage: 'auto',
        });
        settings.meetings.sttProviderId = whisper.id;
        settings.meetings.sttLanguage = 'auto';
        runtime = backendRuntime(
          whisper,
          settings.meetings.sttProviders,
          whisper.id
        );
        return Response.json({ ok: true });
      })
      .mockImplementationOnce(async () =>
        Response.json({ preload: { available: true, status: 'loaded' } })
      );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Select Whisper Base transcription model',
        })
      );
    });
    expect(mocks.notify.success).toHaveBeenCalledWith({
      title: 'Transcription language reset to Auto for the selected model',
    });
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('Auto');
  });

  test('downloads the selected Apple pack and prevents concurrent model changes', async () => {
    const deviceApple = {
      ...apple,
      languages: ['en-US', 'fr-FR'],
      installedLanguages: ['en-US'],
      systemLocale: 'en-US',
    };
    settings.meetings.sttProviderId = apple.id;
    settings.meetings.sttLanguage = 'fr-FR';
    settings.meetings.sttProviders = [readyNemotron, deviceApple];
    runtime = backendRuntime(
      deviceApple,
      settings.meetings.sttProviders,
      apple.id
    );
    let finish!: () => void;
    mocks.desktop.handler.recording.prepareAppleSpeechLanguage.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    await mountSettings();
    expect(
      screen.getByRole('button', { name: 'Transcription language' }).textContent
    ).toBe('French (France)');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Download Apple speech language pack',
        })
      );
    });
    expect(
      mocks.desktop.handler.recording.prepareAppleSpeechLanguage
    ).toHaveBeenCalledWith('fr-FR');
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Nemotron 3.5/ }));
    });
    expect(
      requests('/api/ai/settings').filter(([, init]) => init?.method === 'POST')
    ).toHaveLength(0);
    deviceApple.installedLanguages.push('fr-FR');
    await act(async () => {
      finish();
    });
    expect(
      screen.queryByRole('button', {
        name: 'Download Apple speech language pack',
      })
    ).toBeNull();
    expect(screen.getByText('Language pack installed')).toBeTruthy();
  });
});
