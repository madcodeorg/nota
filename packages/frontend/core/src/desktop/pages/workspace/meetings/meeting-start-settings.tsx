import { useCallback, useEffect, useRef, useState } from 'react';
import { RiSettings3Line } from 'react-icons/ri';

import { meetingLanguageSelection } from '../../../dialogs/setting/general-setting/meetings/provider-selection';
import { meetingMicrophoneWarning } from './meeting-microphone';
import * as styles from './meeting-start-settings.css';

const WHISPER_PROVIDER = /^whisper-(tiny|base|small|medium|large-v3)-cpp$/;
const RECOMMENDED_PROVIDER_ID = 'whisper-large-v3-cpp';
const PROVIDER_ORDER = [
  'whisper-large-v3-cpp',
  'whisper-medium-cpp',
  'whisper-small-cpp',
  'whisper-base-cpp',
  'whisper-tiny-cpp',
];

type DownloadStatus =
  | 'blocked'
  | 'downloaded'
  | 'downloading'
  | 'error'
  | 'missing_url'
  | 'not_started'
  | 'planned'
  | 'queued';

type LocalModel = {
  deviceFit?: 'blocked' | 'fits' | 'low_disk' | 'low_ram' | 'planned';
  deviceFitReason?: string;
  downloadStatus?: DownloadStatus;
  id: string;
  languageDetection?: 'automatic' | 'fixed' | 'selectable';
  languages?: string[];
  progress?: number;
  sizeMb: number;
};

type Provider = {
  canProduceTranscript?: boolean;
  id: string;
  modelId?: string;
  name: string;
};

type Settings = {
  meetings: {
    localModels: LocalModel[];
    sttLanguage?: string;
    sttProviderId: string;
    sttProviders: Provider[];
  };
};

type Runtime = { resolvedProvider: Provider | null };

const languageNames = new Intl.DisplayNames(['en'], {
  type: 'language',
  languageDisplay: 'standard',
});

function languageName(locale: string) {
  if (locale === 'auto') return 'Auto-detect';
  try {
    return languageNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

function formatSize(sizeMb: number) {
  return sizeMb >= 1000
    ? `${(sizeMb / 1024).toFixed(1)} GB`
    : `${Math.round(sizeMb)} MB`;
}

function shortName(provider: Provider) {
  return provider.name.replace(/\s*Q5$/, '');
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok && response.status !== 409) {
    throw new Error(
      data?.error ?? `AI backend returned HTTP ${response.status}`
    );
  }
  return data;
}

export const MeetingStartSettings = ({ disabled }: { disabled?: boolean }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [micWarning, setMicWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [settingsResponse, runtimeResponse] = await Promise.all([
        fetch('/api/ai/settings'),
        fetch('/v1/stt/runtime'),
      ]);
      if (!settingsResponse.ok) {
        throw new Error(`AI backend returned HTTP ${settingsResponse.status}`);
      }
      setSettings((await settingsResponse.json()) as Settings);
      setRuntime(
        runtimeResponse.ok ? ((await runtimeResponse.json()) as Runtime) : null
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Transcription settings could not be loaded.'
      );
    }
  }, []);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    let disposed = false;
    const check = () => {
      mediaDevices
        .enumerateDevices()
        .then(devices => {
          if (!disposed) setMicWarning(meetingMicrophoneWarning(devices));
        })
        .catch(() => {});
    };
    check();
    mediaDevices.addEventListener?.('devicechange', check);
    return () => {
      disposed = true;
      mediaDevices.removeEventListener?.('devicechange', check);
    };
  }, []);

  const downloading = settings?.meetings.localModels.some(
    model =>
      WHISPER_PROVIDER.test(model.id.replace(/-q5-cpp$/, '-cpp')) &&
      (model.downloadStatus === 'downloading' ||
        model.downloadStatus === 'queued')
  );

  useEffect(() => {
    if (!open) return;
    load().catch(console.error);
  }, [open, load]);

  useEffect(() => {
    if (!open || !downloading) return;
    const timer = window.setInterval(() => {
      load().catch(console.error);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [open, downloading, load]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const meetings = settings?.meetings;
  const providers = (meetings?.sttProviders ?? [])
    .filter(provider => WHISPER_PROVIDER.test(provider.id))
    .sort(
      (a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id)
    );
  const modelOf = (provider?: Provider) =>
    meetings?.localModels.find(model => model.id === provider?.modelId);
  const selectedId = meetings?.sttProviderId ?? 'auto';
  const selected = providers.find(provider => provider.id === selectedId);
  const recommended = providers.find(
    provider => provider.id === RECOMMENDED_PROVIDER_ID
  );
  // Auto resolves to Large v3 once it is installed, so it is the model to
  // prepare for both Auto and an explicit Large v3 choice.
  const target = selectedId === 'auto' ? recommended : selected;
  const targetModel = modelOf(target);
  const targetReady = !!target?.canProduceTranscript;
  const targetDownloading =
    targetModel?.downloadStatus === 'downloading' ||
    targetModel?.downloadStatus === 'queued';
  const language = meetings?.sttLanguage ?? 'auto';
  const languageSource = selected ?? recommended;
  const languages = meetingLanguageSelection(
    languageSource?.id ?? 'auto',
    modelOf(languageSource)
  ).languages;
  const resolvedId = runtime?.resolvedProvider?.id;
  const resolvedName = runtime?.resolvedProvider
    ? shortName(runtime.resolvedProvider)
    : undefined;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'The change could not be saved.'
      );
    } finally {
      setBusy(false);
    }
  };

  const changeProvider = (providerId: string) =>
    run(async () => {
      const provider = providers.find(item => item.id === providerId);
      const keepLanguage =
        language === 'auto' ||
        meetingLanguageSelection(
          providerId,
          modelOf(provider)
        ).languages.includes(language);
      await postJson('/api/ai/settings', {
        meetingSttModelId:
          providerId === 'auto' ? '' : (provider?.modelId ?? ''),
        meetingSttProviderId: providerId,
        meetingSttLanguage: keepLanguage ? language : 'auto',
      });
      // Warm the model so Start does not wait for it.
      postJson('/v1/stt/runtime/preload', { providerId }).catch(console.warn);
    });

  const changeLanguage = (nextLanguage: string) =>
    run(async () => {
      // A fixed language needs a concrete model, so pin what Auto resolves to.
      const pinned =
        selectedId === 'auto' && nextLanguage !== 'auto'
          ? (providers.find(provider => provider.id === resolvedId) ??
            recommended)
          : null;
      await postJson('/api/ai/settings', {
        ...(pinned
          ? {
              meetingSttModelId: pinned.modelId ?? '',
              meetingSttProviderId: pinned.id,
            }
          : {}),
        meetingSttLanguage: nextLanguage,
      });
    });

  const downloadTarget = () =>
    run(async () => {
      if (!targetModel) return;
      await postJson(
        `/v1/stt/models/${encodeURIComponent(targetModel.id)}/download`,
        {}
      );
    });

  const progress =
    typeof targetModel?.progress === 'number'
      ? Math.round(Math.min(1, Math.max(0, targetModel.progress)) * 100)
      : null;
  const fitWarning =
    targetModel?.deviceFit === 'low_ram' ||
    targetModel?.deviceFit === 'low_disk' ||
    targetModel?.deviceFit === 'blocked'
      ? (targetModel.deviceFitReason ??
        'This model may not run well on this device.')
      : null;
  const warnings = micWarning || !targetReady || fitWarning;

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="Meeting transcription settings"
        className={styles.trigger}
        disabled={disabled}
        title="Meeting transcription settings"
        type="button"
        onClick={() => setOpen(value => !value)}
      >
        <RiSettings3Line aria-hidden />
        {micWarning || (meetings && !targetReady) ? (
          <span className={styles.warningDot} />
        ) : null}
      </button>
      {open ? (
        <div
          aria-label="Meeting transcription settings"
          className={styles.panel}
          role="dialog"
        >
          {!meetings ? (
            <div className={styles.hint}>
              {error ?? 'Loading transcription settings'}
            </div>
          ) : (
            <>
              <label className={styles.field}>
                <span className={styles.label}>Transcription model</span>
                <select
                  className={styles.select}
                  disabled={busy}
                  value={selectedId}
                  onChange={event => {
                    changeProvider(event.target.value).catch(console.error);
                  }}
                >
                  <option value="auto">
                    {`Auto${resolvedName ? ` (using ${resolvedName})` : ''}`}
                  </option>
                  {selectedId !== 'auto' && !selected ? (
                    <option value={selectedId}>{selectedId}</option>
                  ) : null}
                  {providers.map(provider => {
                    const model = modelOf(provider);
                    return (
                      <option key={provider.id} value={provider.id}>
                        {shortName(provider)}
                        {provider.id === RECOMMENDED_PROVIDER_ID
                          ? ' (recommended)'
                          : ''}
                        {provider.canProduceTranscript
                          ? ' · ready'
                          : model
                            ? ` · ${formatSize(model.sizeMb)} download`
                            : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Language</span>
                <select
                  className={styles.select}
                  disabled={busy || !languages.length}
                  value={language}
                  onChange={event => {
                    changeLanguage(event.target.value).catch(console.error);
                  }}
                >
                  <option value="auto">{languageName('auto')}</option>
                  {languages.map(code => (
                    <option key={code} value={code}>
                      {languageName(code)}
                    </option>
                  ))}
                </select>
                {language === 'auto' ? (
                  <span className={styles.hint}>
                    Auto-detect can pick the wrong language on short phrases.
                    Choose your language for better accuracy.
                  </span>
                ) : null}
              </label>
              {warnings ? (
                <>
                  {target && !targetReady ? (
                    <div className={styles.warning} role="status">
                      <span>
                        {`${shortName(target)} is not downloaded yet${
                          targetModel
                            ? ` (${formatSize(targetModel.sizeMb)})`
                            : ''
                        }. ${
                          selectedId === 'auto'
                            ? `Meetings use ${resolvedName ?? 'the installed model'} until it is ready.`
                            : 'Download it before you start a meeting.'
                        }`}
                      </span>
                      {targetModel && targetDownloading ? (
                        <span>
                          {`Downloading${progress === null ? '' : ` ${progress}%`}`}
                        </span>
                      ) : targetModel ? (
                        <button
                          className={styles.actionButton}
                          disabled={busy}
                          type="button"
                          onClick={() => {
                            downloadTarget().catch(console.error);
                          }}
                        >
                          {targetModel.downloadStatus === 'error'
                            ? 'Retry download'
                            : 'Download'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {fitWarning ? (
                    <div className={styles.warning} role="status">
                      {fitWarning}
                    </div>
                  ) : null}
                  {micWarning ? (
                    <div className={styles.warning} role="status">
                      {micWarning}
                    </div>
                  ) : null}
                </>
              ) : null}
              {error ? <div className={styles.hint}>{error}</div> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
