import {
  ArrowRightSmallIcon,
  DoneIcon,
  DownloadIcon,
  ResetIcon,
} from '@blocksuite/icons/rc';
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  notify,
  Progress,
  useConfirmModal,
} from '@nota/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@nota/component/setting-components';
import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { GoogleAuthService } from '@nota/core/modules/google-auth';
import {
  IntegrationService,
  presentLocalCalendarPermission,
} from '@nota/core/modules/integration';
import {
  meetingPermissionRecovery,
  meetingPermissionSettingsFailure,
  openRecordingPermissionSettings,
  shouldProbeSystemAudioOnFocus,
} from '@nota/core/modules/media/meeting-permission-refresh';
import {
  type MeetingMediaAccessStatus,
  type MeetingPermissionReport,
  MeetingSettingsService,
} from '@nota/core/modules/media/services/meeting-settings';
import type { MeetingSettingsSchema } from '@nota/electron/main/shared-state-schema';
import { useI18n } from '@nota/i18n';
import { useLiveData, useService } from '@nota/infra';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  meetingDownloadFeedback,
  meetingLanguageSelection,
  meetingProviderSelectionState,
} from './provider-selection';
import * as styles from './styles.css';

const RecordingModes: MeetingSettingsSchema['recordingMode'][] = [
  'prompt',
  'auto-start',
  'none',
];

const languageNames = new Intl.DisplayNames(['en'], {
  type: 'language',
  languageDisplay: 'standard',
});
function transcriptionLanguageName(locale: string) {
  if (locale === 'auto') return 'Auto';
  // Nemotron uses ar-AR as its Arabic model token, not Argentina's locale.
  if (locale === 'ar-AR') return 'Arabic';
  try {
    return languageNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

const RecordingSaveModes: MeetingSettingsSchema['recordingSavingMode'][] = [
  'new-doc',
  'journal-today',
];

const RecordingSaveModeLabels: Record<
  MeetingSettingsSchema['recordingSavingMode'],
  string
> = {
  'new-doc': 'New doc',
  'journal-today': "Today's journal",
};

type LocalModelDownloadStatus =
  | 'blocked'
  | 'downloaded'
  | 'downloading'
  | 'error'
  | 'missing_url'
  | 'not_started'
  | 'planned'
  | 'queued';

type MeetingAiBackendSettings = {
  meetings: {
    device?: {
      arch: string;
      availableDiskGb: number | null;
      availableRamGb: number;
      executionProviders: string[];
      modelRoot: string;
      platform: string;
      recommendedSummaryTier: 'large' | 'medium' | 'small';
      totalRamGb: number;
    };
    localModels: Array<{
      bytesDownloaded?: number;
      deviceFit?: 'blocked' | 'fits' | 'low_disk' | 'low_ram' | 'planned';
      deviceFitReason?: string;
      downloadStatus?: LocalModelDownloadStatus;
      id: string;
      languageDetection?: 'automatic' | 'fixed' | 'selectable';
      languages?: string[];
      minRamGb: number;
      notes?: string;
      progress?: number;
      releaseState?: 'blocked' | 'planned' | 'ready';
      runtimeProbe?: {
        canLoad: boolean;
        checkedAt: string;
        message: string;
        modelId: string;
        runtimeAvailable: boolean;
        runtimeId: string;
        status:
          | 'available'
          | 'failed'
          | 'missing_model'
          | 'missing_runtime'
          | 'planned'
          | 'unsupported';
      };
      runtime: string;
      sizeMb: number;
      streaming?: boolean;
      sttProviderId?: string;
      tier?: 'small' | 'medium' | 'large';
      totalBytes?: number;
      type: 'embedding' | 'stt' | 'text';
    }>;
    sttModelId: string;
    sttLanguage?: string;
    sttProviderId: string;
    sttProviders: Array<{
      available: boolean;
      canProduceTranscript?: boolean;
      defaultForPlatform: boolean;
      id: string;
      modelId?: string;
      name: string;
      notes: string;
      languages?: string[];
      installedLanguages?: string[];
      systemLocale?: string | null;
      streaming?: boolean;
      readiness?: {
        modelId?: string;
        reason?: string | null;
        status:
          | 'available'
          | 'failed'
          | 'missing_model'
          | 'missing_runtime'
          | 'planned'
          | 'unsupported';
      };
      transcriptMode?:
        | 'native-streaming'
        | 'planned-streaming'
        | 'unavailable'
        | 'vad-chunk';
      unavailableReason?: string;
    }>;
    transcriptionAvailable: boolean;
  };
};

type MeetingSttProvider =
  MeetingAiBackendSettings['meetings']['sttProviders'][number];

type MeetingSttRuntime = {
  resolvedProvider: MeetingSttProvider | null;
  transcriptAvailable: boolean;
  autoSelectionError?: string | null;
};

type TranscriptionIssue = { message: string; details?: string };

function transcriptionIssue(
  message: string,
  error?: unknown
): TranscriptionIssue {
  return {
    message,
    details:
      error == null
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

const fallbackMeetingAiSettings: MeetingAiBackendSettings = {
  meetings: {
    localModels: [],
    sttModelId: '',
    sttProviderId: 'auto',
    sttProviders: [],
    transcriptionAvailable: false,
  },
};

function canDownloadLocalModel(status?: LocalModelDownloadStatus) {
  return status === 'not_started' || status === 'error';
}

function speechModelNeedsDownload(
  provider: MeetingSttProvider,
  status?: LocalModelDownloadStatus
) {
  return (
    provider.readiness?.status === 'missing_model' ||
    (!provider.canProduceTranscript &&
      !provider.readiness &&
      status === 'not_started')
  );
}

function transcriptModeLabel(
  mode?: NonNullable<
    MeetingAiBackendSettings['meetings']['sttProviders'][number]['transcriptMode']
  >
) {
  switch (mode) {
    case 'native-streaming':
      return 'Live partials';
    case 'vad-chunk':
      return 'Final after each phrase';
    case 'planned-streaming':
      return 'Coming soon';
    case 'unavailable':
    default:
      return 'Unavailable';
  }
}

function providerStatusLabel(provider: MeetingSttProvider) {
  if (provider.canProduceTranscript) {
    return 'Ready';
  }
  switch (provider.readiness?.status) {
    case 'missing_model':
      return 'Download required';
    case 'missing_runtime':
      return 'Runtime missing';
    case 'unsupported':
      return 'Unsupported';
    case 'planned':
      return 'Planned';
    case 'failed':
      return 'Failed';
    case 'available':
      return provider.available ? 'Ready' : 'Unavailable';
    case undefined:
    default:
      return provider.available ? 'Ready' : 'Unavailable';
  }
}

function localModelStateLabel(status?: LocalModelDownloadStatus | 'ready') {
  switch (status) {
    case 'downloaded':
    case 'ready':
      return 'Downloaded';
    case 'downloading':
      return 'Downloading';
    case 'queued':
      return 'Queued';
    case 'blocked':
      return 'Blocked';
    case 'planned':
      return 'Planned';
    case 'error':
      return 'Retry download';
    case 'missing_url':
      return 'Unavailable';
    case 'not_started':
    case undefined:
    default:
      return 'Not downloaded';
  }
}

function localModelFitLabel(
  fit?: NonNullable<
    MeetingAiBackendSettings['meetings']['localModels'][number]['deviceFit']
  >
) {
  switch (fit) {
    case 'fits':
      return 'Fits device';
    case 'low_disk':
      return 'Low disk';
    case 'low_ram':
      return 'Low RAM';
    case 'blocked':
      return 'Blocked';
    case 'planned':
      return 'Planned';
    case undefined:
    default:
      return '';
  }
}

function transcriptionLanguageLabel(
  provider: MeetingSttProvider,
  model?: MeetingAiBackendSettings['meetings']['localModels'][number]
) {
  if (provider.id === 'auto') return 'Multilingual when supported';
  if (provider.id === 'apple-speechanalyzer')
    return provider.languages?.length
      ? `${provider.languages.length} device locales`
      : 'System language';
  if (
    model?.languageDetection === 'automatic' ||
    model?.languageDetection === 'selectable'
  ) {
    if (model.languages?.includes('multilingual')) {
      return 'Auto multilingual';
    }
    const languageCount = model.languages?.length ?? 0;
    return languageCount > 1
      ? `Auto · ${languageCount} ${provider.id === 'nemotron-sherpa' ? 'locales' : 'languages'}`
      : 'Auto language';
  }
  if (model?.languageDetection === 'fixed') {
    return model.languages?.[0] === 'en'
      ? 'English only'
      : `${transcriptionLanguageName(model.languages?.[0] ?? 'Fixed language')} only`;
  }
  return 'Model language';
}

function transcriptionModeDescription(
  provider: MeetingSttProvider,
  model?: MeetingAiBackendSettings['meetings']['localModels'][number]
) {
  // Describe an integrated model's caption behavior before download, while
  // readiness is reported separately. Do not promise partials for a planned
  // provider just because its model declares streaming support.
  if (
    provider.transcriptMode === 'unavailable' &&
    provider.readiness?.status === 'missing_model'
  ) {
    return provider.streaming || model?.streaming
      ? 'Live partials'
      : 'Final after each phrase';
  }
  return transcriptModeLabel(provider.transcriptMode);
}

async function fetchMeetingAiSettings() {
  const response = await fetch('/api/ai/settings');
  if (!response.ok) {
    throw new Error(`AI backend returned HTTP ${response.status}`);
  }
  return (await response.json()) as MeetingAiBackendSettings;
}

async function fetchMeetingSttRuntime() {
  const response = await fetch('/v1/stt/runtime');
  if (!response.ok) {
    throw new Error(`Transcription status returned HTTP ${response.status}`);
  }
  return (await response.json()) as MeetingSttRuntime;
}

async function preloadMeetingSttRuntime(providerId: string) {
  const response = await fetch('/v1/stt/runtime/preload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.error || `AI backend returned HTTP ${response.status}`
    );
  }
  return data as {
    preload: {
      available: boolean;
      cached: boolean;
      durationMs: number;
      message: string | null;
      modelId: string | null;
      providerId: string | null;
      status: string;
    };
  };
}

const RecordingModeMenu = () => {
  const meetingSettingsService = useService(MeetingSettingsService);
  const settings = useLiveData(meetingSettingsService.settings$);
  const t = useI18n();

  const options = useMemo(() => {
    return RecordingModes.map(mode => ({
      label: t[`com.affine.settings.meetings.record.recording-mode.${mode}`](),
      value: mode,
    }));
  }, [t]);

  const currentMode = settings.recordingMode;

  const handleRecordingModeChange = useCallback(
    (mode: MeetingSettingsSchema['recordingMode']) => {
      meetingSettingsService.setRecordingMode(mode);
    },
    [meetingSettingsService]
  );

  return (
    <Menu
      items={options.map(option => {
        return (
          <MenuItem
            key={option.value}
            title={option.label}
            onSelect={() => handleRecordingModeChange(option.value)}
            data-selected={currentMode === option.value}
          >
            {option.label}
          </MenuItem>
        );
      })}
    >
      <MenuTrigger className={styles.settingMenu} block={true}>
        {options.find(option => option.value === currentMode)?.label}
      </MenuTrigger>
    </Menu>
  );
};

const RecordingSaveModeMenu = () => {
  const meetingSettingsService = useService(MeetingSettingsService);
  const settings = useLiveData(meetingSettingsService.settings$);
  const currentMode = settings.recordingSavingMode;

  const handleRecordingSaveModeChange = useCallback(
    (mode: MeetingSettingsSchema['recordingSavingMode']) => {
      meetingSettingsService.setRecordingSavingMode(mode);
    },
    [meetingSettingsService]
  );

  return (
    <Menu
      items={RecordingSaveModes.map(mode => (
        <MenuItem
          key={mode}
          title={RecordingSaveModeLabels[mode]}
          onSelect={() => handleRecordingSaveModeChange(mode)}
          data-selected={currentMode === mode}
        >
          {RecordingSaveModeLabels[mode]}
        </MenuItem>
      ))}
    >
      <MenuTrigger className={styles.settingMenu} block={true}>
        {RecordingSaveModeLabels[currentMode]}
      </MenuTrigger>
    </Menu>
  );
};

// Add the PermissionSettingRow component
interface PermissionSettingRowProps {
  nameKey: string;
  descriptionKey: string;
  permissionSettingKey: string;
  permissionClient?: MeetingPermissionReport['permissionClient'];
  hasPermission: boolean;
  pendingStartupCheck?: boolean;
  status?: MeetingMediaAccessStatus;
  onOpenPermissionSetting: () => void | Promise<void>;
  onOpenSystemSettings?: () => void | Promise<void>;
}

function permissionClientContext(
  permissionClient?: MeetingPermissionReport['permissionClient']
) {
  if (environment.isMacOs && permissionClient?.kind === 'development-host') {
    return {
      separateInstalledApp:
        ' Installed Nota has separate macOS permissions and was not checked.',
      subject: `${permissionClient.displayName} (local development)`,
    };
  }
  return {
    separateInstalledApp: '',
    subject: permissionClient
      ? `${permissionClient.displayName} (this running build)`
      : 'this app',
  };
}

function permissionClientTechnicalLabel(
  permissionClient?: MeetingPermissionReport['permissionClient']
) {
  if (!permissionClient) {
    return null;
  }
  return [permissionClient.displayName, permissionClient.bundleIdentifier]
    .filter(Boolean)
    .join(' · ');
}

const PermissionSettingRow = ({
  nameKey,
  descriptionKey,
  permissionSettingKey,
  permissionClient,
  hasPermission,
  pendingStartupCheck = false,
  status,
  onOpenPermissionSetting,
  onOpenSystemSettings,
}: PermissionSettingRowProps) => {
  const t = useI18n();
  const permissionClientLabel =
    permissionClientTechnicalLabel(permissionClient);
  const openSettingsLabel =
    t['com.affine.cmdk.affine.navigation.open-settings']();
  const actionLabel =
    environment.isWindows || status === 'denied' || status === 'restricted'
      ? openSettingsLabel
      : status === 'unknown'
        ? 'Check access'
        : t[permissionSettingKey]();
  const name = t[nameKey]();

  const handleClick = () => {
    const result = onOpenPermissionSetting();
    if (result instanceof Promise) {
      result.catch(error => {
        console.error('Error opening permission setting:', error);
      });
    }
  };

  const handleOpenSystemSettings = () => {
    const result = onOpenSystemSettings?.();
    if (result instanceof Promise) {
      result.catch(error => {
        console.error('Error opening system permission setting:', error);
      });
    }
  };

  return (
    <SettingRow
      name={name}
      desc={
        <>
          {t[descriptionKey]()}
          {permissionClientLabel ? ` ${permissionClientLabel}.` : null}
        </>
      }
    >
      {hasPermission ? (
        <span
          aria-label={`${name} access granted`}
          className={styles.permissionGranted}
          role="status"
        >
          <DoneIcon className={styles.permissionGrantedIcon} />
          Allowed
        </span>
      ) : (
        <div className={styles.permissionActions}>
          {pendingStartupCheck ? (
            <span role="status" className={styles.permissionGranted}>
              Checked on start
            </span>
          ) : null}
          <Button onClick={handleClick}>
            {pendingStartupCheck ? 'Test access' : actionLabel}
          </Button>
          {status === 'unknown' && onOpenSystemSettings ? (
            <Button onClick={handleOpenSystemSettings}>
              {openSettingsLabel}
            </Button>
          ) : null}
        </div>
      )}
    </SettingRow>
  );
};

const MeetingsSettingsMain = () => {
  const t = useI18n();
  const meetingSettingsService = useService(MeetingSettingsService);
  const desktopApiService = useService(DesktopApiService);
  const calendar = useService(IntegrationService).calendar;
  const localCalendarStatus = useLiveData(calendar.localCalendarStatus$);
  const localCalendarPermission = useMemo(
    () => presentLocalCalendarPermission(localCalendarStatus),
    [localCalendarStatus]
  );
  const [calendarBusy, setCalendarBusy] = useState(false);
  const googleAuth = useService(GoogleAuthService);
  const googleStatus = useLiveData(googleAuth.session.status$);
  const googleUser = useLiveData(googleAuth.session.userInfo$);
  const { openConfirmModal } = useConfirmModal();
  const [googleCalendarBusy, setGoogleCalendarBusy] = useState(false);
  const [recordingFeatureAvailable, setRecordingFeatureAvailable] =
    useState(false);
  const [aiSettings, setAiSettings] = useState<MeetingAiBackendSettings>(
    fallbackMeetingAiSettings
  );
  const [aiSettingsError, setAiSettingsError] = useState<string | null>(null);
  const [aiSettingsLoading, setAiSettingsLoading] = useState(true);
  const [aiSettingsSaving, setAiSettingsSaving] = useState(false);
  const [sttRuntime, setSttRuntime] = useState<MeetingSttRuntime | null>(null);
  const [modelActionError, setModelActionError] =
    useState<TranscriptionIssue | null>(null);
  const [preloadWarning, setPreloadWarning] = useState<{
    providerId: string;
    message: string;
    status: string;
  } | null>(null);
  const [progressError, setProgressError] = useState<string | null>(null);
  const settingsRequestRef = useRef(0);
  const providerChangeInFlightRef = useRef(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(
    null
  );
  const [meetingSttProviderId, setMeetingSttProviderId] = useState(
    fallbackMeetingAiSettings.meetings.sttProviderId
  );
  const [permissions, setPermissions] = useState<MeetingPermissionReport>();
  const probeSystemAudioOnNextFocusRef = useRef(false);
  const permissionFocusRefreshRef = useRef<Promise<void> | null>(null);
  const pendingPermissionSettingsReturnRef = useRef(false);

  useEffect(() => {
    meetingSettingsService
      .isRecordingFeatureAvailable()
      .then(available => {
        setRecordingFeatureAvailable(available ?? false);
      })
      .catch(() => {
        setRecordingFeatureAvailable(false);
      });
    meetingSettingsService
      .checkMeetingPermissions()
      .then(permission => {
        setPermissions(permission);
      })
      .catch(err => console.log(err));
  }, [meetingSettingsService]);

  useEffect(() => {
    calendar.refreshLocalCalendarStatus().catch(() => undefined);
  }, [calendar]);

  useEffect(() => {
    let disposed = false;
    const refreshWhenActive = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      if (permissionFocusRefreshRef.current) {
        pendingPermissionSettingsReturnRef.current ||=
          probeSystemAudioOnNextFocusRef.current;
        return;
      }

      pendingPermissionSettingsReturnRef.current = false;
      const probeSystemAudio = shouldProbeSystemAudioOnFocus(
        probeSystemAudioOnNextFocusRef.current
      );
      probeSystemAudioOnNextFocusRef.current = false;
      const refresh = meetingSettingsService
        .checkMeetingPermissions({
          probeSystemAudio,
        })
        .then(permission => {
          setPermissions(permission);
        })
        .catch(() => undefined)
        .finally(() => {
          if (permissionFocusRefreshRef.current === refresh) {
            permissionFocusRefreshRef.current = null;
            if (
              !disposed &&
              pendingPermissionSettingsReturnRef.current &&
              document.visibilityState !== 'hidden' &&
              document.hasFocus()
            ) {
              refreshWhenActive();
            }
          }
        });
      permissionFocusRefreshRef.current = refresh;
    };

    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [meetingSettingsService]);

  useEffect(() => {
    const refreshWhenActive = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      calendar.refreshLocalCalendarStatus().catch(() => undefined);
    };

    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [calendar]);

  const handleConnectCalendar = useAsyncCallback(async () => {
    setCalendarBusy(true);
    try {
      const status = await calendar.requestLocalCalendarAccess();
      if (status.authorized) {
        notify.success({ title: 'Apple Calendar connected' });
        return;
      }
      const nextPermission = presentLocalCalendarPermission(status);
      if (
        nextPermission.action === 'request-full-access' ||
        nextPermission.action === 'open-settings'
      ) {
        await calendar.openLocalCalendarSettings().catch(() => undefined);
      }
      notify.warning({
        title: nextPermission.title,
        message: nextPermission.description,
      });
    } catch (error) {
      notify.error({
        title: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCalendarBusy(false);
    }
  }, [calendar]);

  const handleOpenCalendarSettings = useAsyncCallback(async () => {
    setCalendarBusy(true);
    try {
      await calendar.openLocalCalendarSettings();
    } catch (error) {
      notify.error({
        title: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCalendarBusy(false);
    }
  }, [calendar]);

  const handleRetryCalendarStatus = useAsyncCallback(async () => {
    setCalendarBusy(true);
    try {
      await calendar.refreshLocalCalendarStatus();
    } catch (error) {
      notify.error({
        title: 'Apple Calendar check failed',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCalendarBusy(false);
    }
  }, [calendar]);

  const handleCalendarPermissionAction = useCallback(() => {
    switch (localCalendarPermission.action) {
      case 'connect':
      case 'request-full-access':
        return handleConnectCalendar();
      case 'open-settings':
        return handleOpenCalendarSettings();
      case 'retry':
        return handleRetryCalendarStatus();
      case null:
        return Promise.resolve();
    }
  }, [
    handleConnectCalendar,
    handleOpenCalendarSettings,
    handleRetryCalendarStatus,
    localCalendarPermission.action,
  ]);

  const handleConnectGoogleCalendar = useAsyncCallback(async () => {
    setGoogleCalendarBusy(true);
    try {
      if (googleAuth.session.status$.value !== 'connected') {
        // Same Google sign-in used for Drive; the OAuth grant already includes
        // the read-only Calendar scope, so this needs no macOS permission.
        await googleAuth.connect();
      }
      // Register the now-available Google calendars so events flow into the
      // workspace and meetings list without waiting for a manual refresh.
      await calendar.loadAccountCalendars().catch(() => undefined);
      await calendar.revalidateWorkspaceCalendars().catch(() => undefined);
      notify.success({ title: 'Google Calendar connected' });
    } catch (error) {
      notify.error({
        title: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setGoogleCalendarBusy(false);
    }
  }, [calendar, googleAuth]);

  const handleDisconnectGoogle = useCallback(() => {
    openConfirmModal({
      title: 'Disconnect Google?',
      children:
        'This disconnects both Google Calendar and Drive on this device. Your local Nota notes stay available.',
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      confirmButtonOptions: { variant: 'error' },
      onConfirm: async () => {
        try {
          await googleAuth.disconnect();
          notify.success({ title: 'Google disconnected' });
        } catch (error) {
          notify.error({
            title: 'Google could not be disconnected',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
  }, [googleAuth, openConfirmModal]);

  const loadMeetingAiSettings = useCallback(async () => {
    const requestId = ++settingsRequestRef.current;
    setAiSettingsLoading(true);
    try {
      const next = await fetchMeetingAiSettings();
      if (requestId !== settingsRequestRef.current) return;
      const runtime = await fetchMeetingSttRuntime();
      if (requestId !== settingsRequestRef.current) return;
      setAiSettings(next);
      setSttRuntime(runtime);
      setMeetingSttProviderId(next.meetings.sttProviderId);
      setAiSettingsError(null);
      setProgressError(null);
    } catch (error) {
      if (requestId !== settingsRequestRef.current) return;
      setAiSettingsError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      if (requestId === settingsRequestRef.current) setAiSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestCounter = settingsRequestRef;
    loadMeetingAiSettings().catch(console.error);
    return () => {
      requestCounter.current++;
    };
  }, [loadMeetingAiSettings]);

  const sttModels = useMemo(
    () => aiSettings.meetings.localModels.filter(model => model.type === 'stt'),
    [aiSettings.meetings.localModels]
  );

  const sttModelById = useMemo(() => {
    return new Map(sttModels.map(model => [model.id, model]));
  }, [sttModels]);

  const hasActiveDownload = sttModels.some(
    model =>
      model.downloadStatus === 'queued' ||
      model.downloadStatus === 'downloading'
  );

  useEffect(() => {
    if (!hasActiveDownload || aiSettingsLoading || aiSettingsSaving) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const modelsResponse = await fetch('/v1/stt/models', {
          signal: controller.signal,
        });
        if (!modelsResponse.ok) {
          throw new Error('Download status could not be refreshed.');
        }
        const health = (await modelsResponse.json()) as {
          models: MeetingAiBackendSettings['meetings']['localModels'];
        };
        if (controller.signal.aborted) return;
        // Read readiness after model health so a completed download cannot
        // stop polling with a runtime snapshot from before completion.
        const runtimeResponse = await fetch('/v1/stt/runtime', {
          signal: controller.signal,
        });
        if (!runtimeResponse.ok) {
          throw new Error('Download status could not be refreshed.');
        }
        const runtime = (await runtimeResponse.json()) as MeetingSttRuntime & {
          providers: MeetingSttProvider[];
        };
        if (controller.signal.aborted) return;
        setAiSettings(current => ({
          ...current,
          meetings: {
            ...current.meetings,
            localModels: health.models,
            sttProviders: runtime.providers,
          },
        }));
        setSttRuntime(runtime);
        setProgressError(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setProgressError(
            error instanceof Error ? error.message : String(error)
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => {
            refresh().catch(console.error);
          }, 2000);
        }
      }
    };
    timer = setTimeout(() => {
      refresh().catch(console.error);
    }, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [hasActiveDownload, aiSettingsLoading, aiSettingsSaving]);

  const providerCards = useMemo<MeetingSttProvider[]>(
    () => [
      {
        available: sttRuntime?.transcriptAvailable ?? false,
        canProduceTranscript: sttRuntime?.transcriptAvailable ?? false,
        defaultForPlatform: false,
        id: 'auto',
        name: 'Auto (recommended)',
        modelId: sttRuntime?.resolvedProvider?.modelId,
        notes: sttRuntime?.transcriptAvailable
          ? `Using ${sttRuntime.resolvedProvider?.name ?? 'a ready local model'}.`
          : (sttRuntime?.autoSelectionError ??
            'No automatic transcription model is ready.'),
        transcriptMode: sttRuntime?.resolvedProvider?.transcriptMode,
      } satisfies MeetingSttProvider,
      ...aiSettings.meetings.sttProviders.toSorted(
        (a, b) => Number(b.defaultForPlatform) - Number(a.defaultForPlatform)
      ),
    ],
    [aiSettings.meetings.sttProviders, sttRuntime]
  );
  const selectedProvider = providerCards.find(
    provider => provider.id === meetingSttProviderId
  );
  const recommendedProvider = providerCards.find(
    provider => provider.defaultForPlatform
  );
  const primaryProvider =
    selectedProvider?.id === 'auto'
      ? (sttRuntime?.resolvedProvider ?? recommendedProvider)
      : selectedProvider;
  const primaryModel = sttModelById.get(primaryProvider?.modelId ?? '');
  const languageSelection = meetingLanguageSelection(
    meetingSttProviderId,
    primaryModel ?? primaryProvider
  );
  const languageOptions = languageSelection.languages.toSorted((a, b) =>
    transcriptionLanguageName(a).localeCompare(transcriptionLanguageName(b))
  );
  const appleLanguage =
    (aiSettings.meetings.sttLanguage ?? 'auto') === 'auto'
      ? primaryProvider?.systemLocale
      : aiSettings.meetings.sttLanguage;
  const appleLanguageInstalled =
    !!appleLanguage &&
    primaryProvider?.installedLanguages?.includes(appleLanguage);
  const languageName = (locale: string) =>
    locale === 'auto' && meetingSttProviderId === 'apple-speechanalyzer'
      ? 'Mac system language'
      : transcriptionLanguageName(locale);
  const languageDescription =
    languageSelection.mode === 'preferred'
      ? meetingSttProviderId === 'apple-speechanalyzer'
        ? 'Choose a language supported by your Mac. Download its speech pack for offline transcription.'
        : 'Choose Auto or a preferred language for new meetings. Existing meetings keep their language setting.'
      : languageSelection.mode === 'follow-model'
        ? 'Language follows the model selected by Auto. Choose a model to set a supported language preference.'
        : languageSelection.mode === 'system'
          ? 'Apple Speech currently uses your Mac’s system locale. Apple manages the available speech language packs.'
          : languageSelection.mode === 'fixed'
            ? 'This model supports a fixed language. Choose a multilingual model for other languages.'
            : languageSelection.mode === 'automatic'
              ? 'This model detects the spoken language automatically. No language selection is needed.'
              : 'Language support will appear when model information is available.';
  const selectedRuntimeReady =
    sttRuntime?.transcriptAvailable &&
    (meetingSttProviderId === 'auto' ||
      sttRuntime.resolvedProvider?.id === meetingSttProviderId);
  const visiblePreloadWarning =
    preloadWarning?.providerId === meetingSttProviderId &&
    !selectedRuntimeReady &&
    preloadWarning.status !== 'missing_model' &&
    (!primaryProvider ||
      !speechModelNeedsDownload(primaryProvider, primaryModel?.downloadStatus))
      ? preloadWarning.message
      : null;
  const visibleModelError =
    modelActionError ??
    (visiblePreloadWarning
      ? transcriptionIssue(
          'This model is not ready. Refresh the status or choose another transcription model.',
          visiblePreloadWarning
        )
      : null) ??
    (progressError
      ? transcriptionIssue(
          'Download status could not be refreshed. Check your connection and refresh the status.',
          progressError
        )
      : null);

  const handleSttProviderChange = useCallback(
    async (providerId: string) => {
      const provider = aiSettings.meetings.sttProviders.find(
        item => item.id === providerId
      );
      if (
        providerChangeInFlightRef.current ||
        aiSettingsLoading ||
        aiSettingsSaving ||
        aiSettingsError ||
        downloadingModelId !== null ||
        (providerId !== 'auto' &&
          (!provider || !meetingProviderSelectionState(provider).selectable))
      ) {
        return;
      }
      const targetLanguage = meetingLanguageSelection(
        providerId,
        sttModelById.get(provider?.modelId ?? '') ?? provider
      );
      const currentLanguage = aiSettings.meetings.sttLanguage ?? 'auto';
      const nextLanguage =
        targetLanguage.mode === 'preferred' &&
        (currentLanguage === 'auto' ||
          targetLanguage.languages.includes(currentLanguage))
          ? currentLanguage
          : 'auto';
      providerChangeInFlightRef.current = true;
      setMeetingSttProviderId(providerId);
      setModelActionError(null);
      setPreloadWarning(null);
      settingsRequestRef.current++;
      setAiSettingsSaving(true);
      try {
        const response = await fetch('/api/ai/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            meetingSttModelId:
              providerId === 'auto' ? '' : (provider?.modelId ?? ''),
            meetingSttProviderId: providerId,
            meetingSttLanguage: nextLanguage,
          }),
        });
        if (!response.ok) {
          throw new Error(`AI backend returned HTTP ${response.status}`);
        }
        if (nextLanguage !== currentLanguage) {
          notify.success({
            title:
              'Transcription language reset to Auto for the selected model',
          });
        }
        let preloadError: unknown = null;
        const preload = await preloadMeetingSttRuntime(providerId).catch(
          error => {
            preloadError = error;
            console.warn('Failed to preload meeting STT runtime', error);
            return null;
          }
        );
        await loadMeetingAiSettings();
        if (preloadError) {
          const issue = transcriptionIssue(
            'Your selection was saved, but the model could not load. Restart Nota or choose another transcription model.',
            preloadError
          );
          setModelActionError(issue);
          notify.error({
            title: issue.message,
          });
        } else if (!preload?.preload.available) {
          const message =
            preload?.preload.message ??
            'Selection saved. Transcription is not ready yet.';
          if (
            preload?.preload.status === 'missing_model' ||
            preload?.preload.status === 'unavailable'
          ) {
            setPreloadWarning({
              providerId,
              message,
              status: preload.preload.status,
            });
          } else {
            setModelActionError(
              transcriptionIssue(
                'This model could not start. Restart Nota or choose another transcription model.',
                message
              )
            );
          }
        } else {
          notify.success({
            title:
              preload.preload.status === 'native'
                ? 'Meeting transcription selection saved'
                : 'Meeting transcription model ready',
          });
        }
      } catch (error) {
        setMeetingSttProviderId(aiSettings.meetings.sttProviderId);
        const issue = transcriptionIssue(
          'Your transcription selection could not be saved. Refresh the status and try again.',
          error
        );
        setModelActionError(issue);
        await loadMeetingAiSettings().catch(console.error);
        notify.error({
          title: issue.message,
        });
      } finally {
        providerChangeInFlightRef.current = false;
        setAiSettingsSaving(false);
      }
    },
    [
      aiSettings.meetings.sttLanguage,
      aiSettings.meetings.sttProviderId,
      aiSettings.meetings.sttProviders,
      aiSettingsError,
      aiSettingsLoading,
      aiSettingsSaving,
      downloadingModelId,
      loadMeetingAiSettings,
      sttModelById,
    ]
  );

  const openPermissionSettings = useCallback(
    async (type: 'systemAudio' | 'microphone') => {
      await openRecordingPermissionSettings(
        type,
        () => meetingSettingsService.showRecordingPermissionSetting(type),
        value => {
          probeSystemAudioOnNextFocusRef.current = value;
        },
        () =>
          notify.warning(
            meetingPermissionSettingsFailure(environment.isWindows)
          )
      );
    },
    [meetingSettingsService]
  );

  const handleOpenPermissionSetting = useAsyncCallback(
    async (type: 'systemAudio' | 'microphone') => {
      const current = await meetingSettingsService.checkMeetingPermissions();
      setPermissions(current);
      if (current?.[type] && current.statuses[type] === 'granted') {
        return;
      }

      const currentStatus = current?.statuses[type];
      if (
        environment.isWindows ||
        currentStatus === 'denied' ||
        currentStatus === 'restricted'
      ) {
        await openPermissionSettings(type);
        return;
      }

      await meetingSettingsService.askForMeetingPermission(type);
      const next = await meetingSettingsService.checkMeetingPermissions();
      setPermissions(next);
      if (next?.[type] && next.statuses[type] === 'granted') {
        return;
      }

      const nextStatus = next?.statuses[type];
      if (nextStatus === 'denied' || nextStatus === 'restricted') {
        await openPermissionSettings(type);
        return;
      }

      const label = type === 'systemAudio' ? 'System Audio' : 'Microphone';
      const { separateInstalledApp, subject } = permissionClientContext(
        next?.permissionClient
      );
      notify.warning({
        title: `${label} access not verified`,
        message: `${meetingPermissionRecovery(type, next, environment.isWindows).message} Access was checked for ${subject}.${separateInstalledApp}`,
      });
    },
    [meetingSettingsService, openPermissionSettings]
  );

  const handleOpenSavedRecordings = useAsyncCallback(async () => {
    await meetingSettingsService.openSavedRecordings();
  }, [meetingSettingsService]);

  const handleRestartApp = useAsyncCallback(async () => {
    await desktopApiService.handler.ui.restartApp();
  }, [desktopApiService]);

  const handleDownloadModel = useCallback(
    async (modelId: string) => {
      setDownloadingModelId(modelId);
      setModelActionError(null);
      try {
        const response = await fetch(
          `/v1/stt/models/${encodeURIComponent(modelId)}/download`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          }
        );
        const data = await response.json().catch(() => null);
        const feedback = meetingDownloadFeedback(response.status, data);
        await loadMeetingAiSettings();
        if (!feedback.accepted) throw new Error(feedback.message);
        notify.success({ title: feedback.message });
      } catch (error) {
        const issue = transcriptionIssue(
          'The model download could not start. Check your connection and try Download again.',
          error
        );
        setModelActionError(issue);
        notify.error({
          title: issue.message,
        });
      } finally {
        setDownloadingModelId(null);
      }
    },
    [loadMeetingAiSettings]
  );

  const handlePrepareAppleLanguage = async () => {
    if (
      providerChangeInFlightRef.current ||
      aiSettingsSaving ||
      aiSettingsLoading ||
      aiSettingsError ||
      downloadingModelId !== null ||
      !appleLanguage
    )
      return;
    const recording = desktopApiService.handler.recording as unknown as {
      prepareAppleSpeechLanguage?: (locale: string) => Promise<unknown>;
    };
    if (!recording?.prepareAppleSpeechLanguage) {
      setModelActionError(
        transcriptionIssue(
          'Apple speech language setup is unavailable in this app. Update Nota and try again.'
        )
      );
      return;
    }
    providerChangeInFlightRef.current = true;
    settingsRequestRef.current++;
    setAiSettingsSaving(true);
    setModelActionError(null);
    try {
      await recording.prepareAppleSpeechLanguage(appleLanguage);
      await loadMeetingAiSettings();
    } catch (error) {
      setModelActionError(
        transcriptionIssue(
          'The speech language pack could not be downloaded. Check your connection and try again.',
          error
        )
      );
    } finally {
      providerChangeInFlightRef.current = false;
      setAiSettingsSaving(false);
    }
  };

  const handleSttLanguageChange = async (language: string) => {
    if (
      providerChangeInFlightRef.current ||
      aiSettingsSaving ||
      aiSettingsLoading ||
      aiSettingsError ||
      downloadingModelId !== null ||
      languageSelection.mode !== 'preferred' ||
      (language !== 'auto' && !languageOptions.includes(language))
    )
      return;
    providerChangeInFlightRef.current = true;
    settingsRequestRef.current++;
    setAiSettingsSaving(true);
    setModelActionError(null);
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ meetingSttLanguage: language }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error ?? `AI backend returned HTTP ${response.status}`
        );
      }
      await loadMeetingAiSettings();
    } catch (error) {
      setModelActionError(
        transcriptionIssue(
          'Your transcription language could not be saved. Refresh the status and try again.',
          error
        )
      );
    } finally {
      providerChangeInFlightRef.current = false;
      setAiSettingsSaving(false);
    }
  };

  const renderProvider = (provider: MeetingSttProvider) => {
    const model = provider.modelId
      ? sttModelById.get(provider.modelId)
      : undefined;
    const downloadBusy =
      model?.downloadStatus === 'queued' ||
      model?.downloadStatus === 'downloading';
    const canDownload =
      !!model &&
      (canDownloadLocalModel(model.downloadStatus) ||
        (model.downloadStatus === 'downloaded' &&
          provider.readiness?.status === 'missing_model')) &&
      model.releaseState !== 'planned' &&
      model.releaseState !== 'blocked';
    const selectionState = meetingProviderSelectionState(provider);
    const progress =
      typeof model?.progress === 'number' && Number.isFinite(model.progress)
        ? Math.min(100, Math.max(0, Math.round(model.progress * 100)))
        : 0;
    const needsDownload = speechModelNeedsDownload(
      provider,
      model?.downloadStatus
    );
    const detail = downloadBusy
      ? 'Your model is downloading. Transcription will be available when it finishes.'
      : model?.downloadStatus === 'error'
        ? 'The model download could not finish. Try downloading it again.'
        : needsDownload
          ? 'Download this model to use it for transcription.'
          : provider.readiness?.status === 'missing_runtime'
            ? 'This model’s speech runtime is unavailable. Update Nota or choose another transcription model.'
            : provider.readiness?.status === 'failed'
              ? 'This model could not start. Restart Nota or choose another transcription model.'
              : provider.readiness?.status === 'unsupported'
                ? 'This model is not supported on this device.'
                : provider.readiness?.status === 'planned'
                  ? 'This model is not available yet.'
                  : !provider.canProduceTranscript
                    ? 'This model is not ready. Refresh the status or choose another transcription model.'
                    : null;
    const technicalDetails =
      !needsDownload && !downloadBusy && !provider.canProduceTranscript
        ? (provider.readiness?.reason ?? provider.unavailableReason)
        : null;

    return (
      <div className={styles.providerRow} key={provider.id}>
        <div className={styles.providerCardHeader}>
          <span className={styles.providerName}>{provider.name}</span>
          <span
            className={clsx(styles.modelBadge, {
              [styles.modelBadgeMuted]: !provider.canProduceTranscript,
            })}
          >
            {providerStatusLabel(provider)}
          </span>
        </div>
        <div className={styles.providerMeta}>
          {transcriptionModeDescription(provider, model)}
          {' · '}
          {transcriptionLanguageLabel(provider, model)}
          {model ? ` · ${model.sizeMb} MB download` : ''}
        </div>
        {model ? (
          <div className={styles.providerMeta}>
            Device minimum: {model.minRamGb} GB RAM
          </div>
        ) : null}
        {detail ? (
          <div className={styles.providerDescription}>{detail}</div>
        ) : null}
        {technicalDetails ? (
          <details className={styles.providerDescription}>
            <summary>Technical details</summary>
            <div>{technicalDetails}</div>
          </details>
        ) : null}
        {model ? (
          <div className={styles.providerFooter}>
            <span className={styles.providerMeta}>
              {localModelStateLabel(model.downloadStatus)}
              {model.deviceFit && model.deviceFit !== 'fits'
                ? ` · ${localModelFitLabel(model.deviceFit)}`
                : ''}
            </span>
            {provider.id !== primaryProvider?.id ? (
              <Button
                aria-label={`Select ${provider.name} transcription model`}
                disabled={
                  !selectionState.selectable ||
                  aiSettingsLoading ||
                  aiSettingsSaving ||
                  !!aiSettingsError ||
                  downloadingModelId !== null
                }
                onClick={() => {
                  handleSttProviderChange(provider.id).catch(console.error);
                }}
              >
                Use model
              </Button>
            ) : null}
            {canDownload ? (
              <Button
                prefix={<DownloadIcon />}
                aria-label={`Download ${provider.name} transcription model`}
                disabled={
                  aiSettingsLoading ||
                  aiSettingsSaving ||
                  !!aiSettingsError ||
                  downloadingModelId !== null
                }
                loading={downloadingModelId === model.id}
                onClick={() => {
                  handleDownloadModel(model.id).catch(console.error);
                }}
              >
                {model.downloadStatus === 'error'
                  ? 'Retry download'
                  : 'Download'}
              </Button>
            ) : null}
          </div>
        ) : null}
        {downloadBusy ? (
          <div aria-label={`${provider.name} download`} role="group">
            <Progress readonly value={progress} />
            {model?.totalBytes ? (
              <div className={styles.providerMeta}>
                {Math.round((model.bytesDownloaded ?? 0) / 1024 / 1024)} of{' '}
                {Math.round(model.totalBytes / 1024 / 1024)} MB
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.meetingWrapper}>
      <SettingHeader
        title={t['com.affine.settings.meetings']()}
        subtitle="Transcription, calendars, and recording"
      />

      <section
        className={styles.transcriptionSection}
        aria-label="Transcription"
      >
        <SettingRow
          name="Transcription service"
          desc={
            aiSettingsError
              ? 'The transcription service could not be reached. Restart Nota, then refresh the status.'
              : 'On-device speech recognition'
          }
        >
          <div className={styles.connectedActions}>
            <span
              aria-live="polite"
              role="status"
              className={clsx(styles.status, {
                [styles.mutedStatus]: aiSettingsError || aiSettingsLoading,
              })}
            >
              {aiSettingsLoading
                ? 'Checking'
                : aiSettingsError
                  ? 'Offline'
                  : 'Online'}
            </span>
            <IconButton
              icon={<ResetIcon />}
              aria-label="Refresh transcription status"
              tooltip="Refresh transcription status"
              disabled={
                aiSettingsLoading ||
                aiSettingsSaving ||
                downloadingModelId !== null
              }
              onClick={() => {
                loadMeetingAiSettings().catch(console.error);
              }}
            />
          </div>
        </SettingRow>
        <div className={styles.modelSettingsCard}>
          <div className={styles.transcriptionControls}>
            <SettingRow
              name="Transcription model"
              desc="Choose a local model for new meetings."
              spreadCol={false}
              className={styles.transcriptionControl}
            >
              <Menu
                contentOptions={{ className: styles.providerMenuContent }}
                items={providerCards.map(provider => {
                  const model = sttModelById.get(provider.modelId ?? '');
                  return (
                    <MenuItem
                      key={provider.id}
                      title={provider.name}
                      disabled={
                        !meetingProviderSelectionState(provider).selectable
                      }
                      aria-disabled={
                        !meetingProviderSelectionState(provider).selectable
                      }
                      checked={provider.id === meetingSttProviderId}
                      data-selected={provider.id === meetingSttProviderId}
                      onSelect={() => {
                        handleSttProviderChange(provider.id).catch(
                          console.error
                        );
                      }}
                    >
                      <span className={styles.menuOption}>
                        <span>{provider.name}</span>
                        <span className={styles.providerMeta}>
                          {provider.id === 'auto' &&
                          meetingSttProviderId !== 'auto'
                            ? 'Automatic selection'
                            : providerStatusLabel(provider)}
                        </span>
                        {provider.id !== 'auto' ? (
                          <span className={styles.providerMeta}>
                            {transcriptionModeDescription(provider, model)}
                            {' · '}
                            {transcriptionLanguageLabel(provider, model)}
                            {model ? ` · ${model.sizeMb} MB download` : ''}
                          </span>
                        ) : null}
                      </span>
                    </MenuItem>
                  );
                })}
              >
                <MenuTrigger
                  className={styles.providerMenu}
                  block
                  aria-label="Transcription model"
                  disabled={
                    aiSettingsLoading ||
                    aiSettingsSaving ||
                    !!aiSettingsError ||
                    downloadingModelId !== null
                  }
                >
                  {aiSettingsLoading && !selectedProvider
                    ? 'Loading models...'
                    : (selectedProvider?.name ?? meetingSttProviderId)}
                </MenuTrigger>
              </Menu>
            </SettingRow>
            <SettingRow
              name="Transcription language"
              desc={languageDescription}
              spreadCol={false}
              className={styles.transcriptionControl}
            >
              {languageSelection.mode === 'preferred' ? (
                <Menu
                  contentOptions={{ className: styles.providerMenuContent }}
                  items={['auto', ...languageOptions].map(language => (
                    <MenuItem
                      key={language}
                      checked={
                        language === (aiSettings.meetings.sttLanguage ?? 'auto')
                      }
                      onSelect={() => {
                        handleSttLanguageChange(language).catch(console.error);
                      }}
                    >
                      {languageName(language)}
                    </MenuItem>
                  ))}
                >
                  <MenuTrigger
                    className={styles.providerMenu}
                    block
                    aria-label="Transcription language"
                    disabled={
                      aiSettingsLoading ||
                      aiSettingsSaving ||
                      !!aiSettingsError ||
                      downloadingModelId !== null
                    }
                  >
                    {languageName(aiSettings.meetings.sttLanguage ?? 'auto')}
                  </MenuTrigger>
                </Menu>
              ) : (
                <div
                  className={styles.readonlyLanguage}
                  role="status"
                  aria-label="Transcription language mode"
                >
                  {languageSelection.mode === 'system'
                    ? 'Mac system language'
                    : languageSelection.mode === 'fixed'
                      ? transcriptionLanguageName(
                          languageOptions[0] ?? 'Unknown'
                        )
                      : languageSelection.mode === 'unknown'
                        ? 'Not available'
                        : 'Automatic detection'}
                </div>
              )}
              {meetingSttProviderId === 'apple-speechanalyzer' &&
              languageSelection.mode === 'preferred' ? (
                <div className={styles.providerFooter}>
                  <span className={styles.providerMeta}>
                    {appleLanguageInstalled
                      ? 'Language pack installed'
                      : 'Language pack download required'}
                  </span>
                  {!appleLanguageInstalled && appleLanguage ? (
                    <Button
                      aria-label="Download Apple speech language pack"
                      disabled={
                        aiSettingsLoading ||
                        aiSettingsSaving ||
                        !!aiSettingsError ||
                        downloadingModelId !== null
                      }
                      onClick={() => {
                        handlePrepareAppleLanguage().catch(console.error);
                      }}
                    >
                      Download language pack
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {languageSelection.mode === 'automatic' &&
              languageOptions.length > 1 ? (
                <details className={styles.languageCoverage}>
                  <summary>
                    Supported languages ({languageOptions.length})
                  </summary>
                  <ul className={styles.languageList}>
                    {languageOptions.map(language => (
                      <li key={language}>{languageName(language)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </SettingRow>
          </div>
          {meetingSttProviderId === 'auto' &&
          !aiSettingsLoading &&
          !aiSettingsError ? (
            <div className={styles.autoStatus} role="status">
              {sttRuntime?.transcriptAvailable
                ? 'Automatic selection'
                : 'No automatic transcription model is ready.'}
            </div>
          ) : null}
          {!aiSettingsError && primaryProvider ? (
            <div
              className={styles.selectedModel}
              aria-label="Selected transcription model"
            >
              {renderProvider(primaryProvider)}
            </div>
          ) : null}
          {visibleModelError ? (
            <div className={styles.actionError} role="alert">
              <div>{visibleModelError.message}</div>
              {visibleModelError.details ? (
                <details>
                  <summary>Technical details</summary>
                  <div>{visibleModelError.details}</div>
                </details>
              ) : null}
            </div>
          ) : null}
          <span className={styles.savingHint} role="status" aria-live="polite">
            {aiSettingsSaving ? 'Saving and preparing model...' : ''}
          </span>
        </div>
        <details className={styles.otherModels}>
          <summary>Other speech models</summary>
          {providerCards
            .filter(
              provider =>
                provider.id !== 'auto' && provider.id !== primaryProvider?.id
            )
            .map(renderProvider)}
        </details>
      </section>

      <SettingWrapper title="Calendar">
        <SettingRow
          name="Google Calendar"
          desc={
            googleStatus === 'connected'
              ? `Showing upcoming meetings from ${
                  googleUser?.email ?? 'your Google account'
                }.`
              : 'Show upcoming meetings from Google Calendar. Uses the same Google sign-in as Drive — no extra system permission needed.'
          }
        >
          {googleStatus === 'connected' ? (
            <div className={styles.connectedActions}>
              <span className={styles.status}>Connected</span>
              <Button
                title="Disconnects Google Calendar and Drive on this device"
                onClick={handleDisconnectGoogle}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              loading={googleCalendarBusy || googleStatus === 'connecting'}
              onClick={handleConnectGoogleCalendar}
            >
              Connect
            </Button>
          )}
        </SettingRow>
        {environment.isMacOs && (
          <SettingRow
            name="Apple Calendar"
            desc={localCalendarPermission.description}
          >
            {localCalendarPermission.connected ? (
              <Button
                loading={calendarBusy}
                onClick={handleOpenCalendarSettings}
              >
                Open settings
              </Button>
            ) : localCalendarPermission.action ? (
              <Button
                loading={calendarBusy}
                onClick={() => {
                  Promise.resolve(handleCalendarPermissionAction()).catch(
                    console.error
                  );
                }}
              >
                {localCalendarPermission.actionLabel}
              </Button>
            ) : (
              <Button disabled>
                {localCalendarStatus ? 'Unavailable' : 'Checking…'}
              </Button>
            )}
          </SettingRow>
        )}
      </SettingWrapper>

      {recordingFeatureAvailable && (
        <>
          <SettingWrapper
            title={t['com.affine.settings.meetings.record.header']()}
          >
            <SettingRow
              name={t['com.affine.settings.meetings.record.recording-mode']()}
              desc={t[
                'com.affine.settings.meetings.record.recording-mode.description'
              ]()}
            >
              <RecordingModeMenu />
            </SettingRow>
            <SettingRow
              name={t['com.affine.settings.meetings.record.save-mode']()}
              desc="After recording stops, Nota automatically saves the finalized transcript here."
            >
              <RecordingSaveModeMenu />
            </SettingRow>
            <SettingRow
              name={t['com.affine.settings.meetings.record.open-saved-file']()}
              desc={t[
                'com.affine.settings.meetings.record.open-saved-file.description'
              ]()}
            >
              <IconButton
                aria-label={t[
                  'com.affine.settings.meetings.record.open-saved-file'
                ]()}
                title={t[
                  'com.affine.settings.meetings.record.open-saved-file'
                ]()}
                icon={<ArrowRightSmallIcon />}
                onClick={handleOpenSavedRecordings}
              />
            </SettingRow>
          </SettingWrapper>
          {(environment.isMacOs || environment.isWindows) && (
            <SettingWrapper
              title={t['com.affine.settings.meetings.privacy.header']()}
            >
              {environment.isMacOs && (
                <PermissionSettingRow
                  nameKey="com.affine.settings.meetings.privacy.screen-system-audio-recording"
                  descriptionKey="com.affine.settings.meetings.privacy.screen-system-audio-recording.description"
                  permissionSettingKey="com.affine.settings.meetings.privacy.screen-system-audio-recording.permission-setting"
                  hasPermission={permissions?.systemAudio || false}
                  pendingStartupCheck={
                    permissions?.systemAudioAccessSource === 'not-checked' &&
                    permissions.statuses.systemAudio === 'unknown' &&
                    permissions.runtime.available &&
                    !permissions.systemAudio &&
                    !permissions.reasons.systemAudio
                  }
                  permissionClient={permissions?.permissionClient}
                  status={permissions?.statuses.systemAudio}
                  onOpenPermissionSetting={() =>
                    handleOpenPermissionSetting('systemAudio')
                  }
                  onOpenSystemSettings={() =>
                    openPermissionSettings('systemAudio')
                  }
                />
              )}
              <PermissionSettingRow
                nameKey="com.affine.settings.meetings.privacy.microphone"
                descriptionKey="com.affine.settings.meetings.privacy.microphone.description"
                permissionSettingKey="com.affine.settings.meetings.privacy.microphone.permission-setting"
                hasPermission={permissions?.microphone || false}
                permissionClient={permissions?.permissionClient}
                status={permissions?.statuses.microphone}
                onOpenPermissionSetting={() =>
                  handleOpenPermissionSetting('microphone')
                }
              />
            </SettingWrapper>
          )}

          <SettingWrapper>
            <SettingRow
              name={t['com.affine.settings.meetings.privacy.issues']()}
              desc={t[
                'com.affine.settings.meetings.privacy.issues.description'
              ]()}
            >
              <Button onClick={handleRestartApp}>
                {t['com.affine.settings.meetings.privacy.issues.restart']()}
              </Button>
            </SettingRow>
          </SettingWrapper>
        </>
      )}
    </div>
  );
};

export const MeetingsSettings = () => {
  return <MeetingsSettingsMain />;
};
