import { useCallback, useEffect, useRef, useState } from 'react';

import {
  canDownloadLocalModel,
  isReleasedLocalModel,
  localModelDownloadFeedback,
  localModelStatusLabel,
  localTextModelSelectionState,
} from '../../dialogs/setting/general-setting/ai/local-model-selection';
import {
  type LocalModelInfo,
  localModelName,
} from '../../dialogs/setting/general-setting/ai/model-list';
import {
  meetingLanguageSelection,
  type MeetingProviderSelectionInput,
  meetingProviderSelectionState,
} from '../../dialogs/setting/general-setting/meetings/provider-selection';
import * as styles from './nota-welcome.css';

type Model = LocalModelInfo & {
  languageDetection?: 'automatic' | 'fixed' | 'selectable';
  languages?: string[];
};
type SpeechProvider = MeetingProviderSelectionInput & {
  id: string;
  name: string;
  modelId?: string;
  available?: boolean;
  canProduceTranscript?: boolean;
  defaultForPlatform?: boolean;
  languages?: string[];
  notes?: string;
};
type Settings = {
  provider: string;
  localModel: string;
  meetings: {
    sttProviderId: string;
    sttModelId: string;
    sttLanguage?: string;
    sttProviders: SpeechProvider[];
  };
};
type ModelHealth = {
  models: Model[];
  device?: { availableDiskGb?: number | null };
};
type SpeechRuntime = {
  providers: SpeechProvider[];
  resolvedProvider: SpeechProvider | null;
  transcriptAvailable: boolean;
  autoSelectionError?: string | null;
};

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Setup returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function NotaModelsSetup({
  onContinue,
  onSkip,
  mode = 'all',
  onChatSelected,
  onChatAction,
}: {
  onContinue: () => void;
  onSkip?: () => void;
  mode?: 'all' | 'chat' | 'transcription';
  onChatSelected?: (modelId: string) => void | Promise<void>;
  onChatAction?: (
    modelId: string,
    action: 'download' | 'probe'
  ) => void | Promise<void>;
}) {
  const showChat = mode === 'all' || mode === 'chat';
  const showSpeech = mode === 'all' || mode === 'transcription';
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<ModelHealth>({ models: [] });
  const [runtime, setRuntime] = useState<SpeechRuntime | null>(null);
  const [chatId, setChatId] = useState('');
  const [speechId, setSpeechId] = useState('auto');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const explicitChatActions = useRef(new Set<string>());
  const healthRequest = useRef(0);
  const refreshController = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      read<Settings>('/api/ai/settings', controller.signal),
      read<ModelHealth>('/v1/local/models', controller.signal),
      read<SpeechRuntime>('/v1/stt/runtime', controller.signal),
    ])
      .then(([config, models, speech]) => {
        if (controller.signal.aborted) return;
        if (
          !config.meetings ||
          !Array.isArray(models.models) ||
          !Array.isArray(speech.providers)
        ) {
          throw new Error('Model setup information is incomplete.');
        }
        setSettings(config);
        setHealth(models);
        setRuntime(speech);
        // A saved hosted provider is preserved until the user chooses local AI.
        setChatId(config.provider === 'local' ? config.localModel : '');
        setSpeechId(config.meetings.sttProviderId);
      })
      .catch(error => {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const healthRequestRef = healthRequest;
    return () => {
      mounted.current = false;
      controller.abort();
      refreshController.current?.abort();
      healthRequestRef.current++;
    };
  }, [reload]);

  const refreshHealth = useCallback(async () => {
    if (!mounted.current || mutation.current) return;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const request = ++healthRequest.current;
    try {
      const models = await read<ModelHealth>(
        '/v1/local/models',
        controller.signal
      );
      // Read speech readiness after download health has been refreshed.
      const speech = await read<SpeechRuntime>(
        '/v1/stt/runtime',
        controller.signal
      );
      if (controller.signal.aborted || request !== healthRequest.current)
        return;
      if (!Array.isArray(models.models) || !Array.isArray(speech.providers)) {
        throw new Error('Model setup information is incomplete.');
      }
      setHealth(models);
      setRuntime(speech);
      setLoadError(null);
    } catch (error) {
      if (!controller.signal.aborted && request === healthRequest.current)
        setLoadError(errorMessage(error));
    }
  }, []);

  const activeDownload = health.models.some(
    model =>
      model.downloadStatus === 'queued' ||
      model.downloadStatus === 'downloading'
  );
  useEffect(() => {
    if (!settings) return;
    const whenVisible = () => {
      if (document.visibilityState !== 'hidden')
        refreshHealth().catch(() => undefined);
    };
    window.addEventListener('focus', whenVisible);
    document.addEventListener('visibilitychange', whenVisible);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const poll = async () => {
      await refreshHealth();
      if (!disposed) timer = setTimeout(() => void poll(), 2000);
    };
    if (activeDownload) timer = setTimeout(() => void poll(), 2000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      refreshController.current?.abort();
      window.removeEventListener('focus', whenVisible);
      document.removeEventListener('visibilitychange', whenVisible);
    };
  }, [activeDownload, refreshHealth, settings]);

  const chatModels = health.models.filter(model => model.type === 'text');
  const chat = chatModels.find(model => model.id === chatId);
  const speechProviders = runtime?.providers ?? [];
  const draftAutoPending =
    !!settings &&
    speechId === 'auto' &&
    settings.meetings.sttProviderId !== 'auto';
  const speechProvider =
    speechId === 'auto'
      ? draftAutoPending
        ? undefined
        : (runtime?.resolvedProvider ??
          speechProviders.find(provider => provider.defaultForPlatform))
      : speechProviders.find(provider => provider.id === speechId);
  const speechModel = health.models.find(
    model => model.type === 'stt' && model.id === speechProvider?.modelId
  );
  const chatChanged =
    !!chatId &&
    (settings?.provider !== 'local' || settings.localModel !== chatId);
  const speechChanged =
    !!settings && settings.meetings.sttProviderId !== speechId;
  const chatSelection = chat ? localTextModelSelectionState(chat) : null;
  const speechSelection = speechProvider
    ? meetingProviderSelectionState(speechProvider)
    : null;
  const invalidSelection =
    (showChat && chatChanged && !chatSelection?.selectable) ||
    (showSpeech &&
      speechChanged &&
      speechId !== 'auto' &&
      !speechSelection?.selectable);
  const controlsDisabled = loading || busy !== null || !settings;

  const modelAction = async (model: Model, action: 'download' | 'probe') => {
    if (mutation.current || controlsDisabled) return;
    if (
      action === 'download'
        ? !canDownloadLocalModel(model)
        : !isReleasedLocalModel(model) || model.downloadStatus !== 'downloaded'
    )
      return;
    mutation.current = true;
    refreshController.current?.abort();
    healthRequest.current++;
    setBusy(`${action}:${model.id}`);
    setActionError(null);
    try {
      const response = await fetch(
        `/v1/local/models/${encodeURIComponent(model.id)}/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const result = await response.json().catch(() => null);
      if (action === 'download') {
        const feedback = localModelDownloadFeedback(response.status, result);
        if (!feedback.accepted) throw new Error(feedback.message);
      } else if (
        !response.ok ||
        result?.probe?.status !== 'available' ||
        !result.probe.canLoad ||
        !result.probe.runtimeAvailable
      ) {
        throw new Error(
          result?.probe?.message ??
            result?.error ??
            `Model check failed (HTTP ${response.status}).`
        );
      }
      if (model.type === 'text') {
        explicitChatActions.current.add(model.id);
        // Download monitoring/catalog refresh belongs to the workspace service
        // and must survive navigation away from this optional setup step.
        try {
          await onChatAction?.(model.id, action);
        } catch (error) {
          if (mounted.current)
            setActionError(
              `Model ${action === 'download' ? 'download accepted' : 'check passed'}. Chat model status could not refresh: ${errorMessage(error)}`
            );
        }
      }
    } catch (error) {
      if (mounted.current) setActionError(errorMessage(error));
    } finally {
      mutation.current = false;
      if (mounted.current) {
        await refreshHealth();
        if (mounted.current) setBusy(null);
      }
    }
  };

  const save = async () => {
    if (mutation.current || controlsDisabled || invalidSelection || loadError)
      return;
    const synchronizeCurrentChat =
      showChat &&
      settings.provider === 'local' &&
      chatId === settings.localModel &&
      explicitChatActions.current.has(chatId) &&
      chatSelection?.selectable;
    const shouldSaveChat = showChat && chatChanged;
    const shouldSaveSpeech = showSpeech && speechChanged;
    if (!shouldSaveChat && !shouldSaveSpeech && !synchronizeCurrentChat) {
      onContinue();
      return;
    }
    mutation.current = true;
    refreshController.current?.abort();
    healthRequest.current++;
    setBusy('save');
    setActionError(null);
    try {
      const language = meetingLanguageSelection(
        speechId,
        speechModel ?? speechProvider
      );
      const previousLanguage = settings.meetings.sttLanguage ?? 'auto';
      const nextLanguage =
        language.mode === 'preferred' &&
        (previousLanguage === 'auto' ||
          language.languages.includes(previousLanguage))
          ? previousLanguage
          : 'auto';
      if (shouldSaveChat || shouldSaveSpeech) {
        const response = await fetch('/api/ai/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(shouldSaveChat
              ? {
                  defaultProvider: 'local',
                  defaultModel: chatId,
                  localModel: chatId,
                }
              : {}),
            ...(shouldSaveSpeech
              ? {
                  meetingSttProviderId: speechId,
                  meetingSttModelId:
                    speechId === 'auto' ? '' : (speechProvider?.modelId ?? ''),
                  meetingSttLanguage: nextLanguage,
                }
              : {}),
          }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(
            result?.error ?? `Setup returned HTTP ${response.status}.`
          );
        }
      }
      // A committed backend selection must also reach the renderer catalog
      // when Skip or Start working already closed this step.
      if (shouldSaveChat || synchronizeCurrentChat) {
        await onChatSelected?.(chatId);
        explicitChatActions.current.delete(chatId);
      }
      if (mounted.current) onContinue();
    } catch (error) {
      if (mounted.current) setActionError(errorMessage(error));
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const actions = (model: Model | undefined, name?: string) => {
    if (!model) return null;
    const downloading =
      model.downloadStatus === 'queued' ||
      model.downloadStatus === 'downloading';
    return (
      <div className={styles.actions}>
        {canDownloadLocalModel(model) ? (
          <button
            type="button"
            className={styles.button}
            disabled={controlsDisabled}
            aria-label={`Download ${name ?? localModelName(model.id)}`}
            onClick={() => void modelAction(model, 'download')}
          >
            {model.downloadStatus === 'error' ? 'Retry download' : 'Download'}
          </button>
        ) : null}
        {model.downloadStatus === 'downloaded' &&
        isReleasedLocalModel(model) ? (
          <button
            type="button"
            className={styles.button}
            disabled={controlsDisabled}
            aria-label={`Check ${name ?? localModelName(model.id)}`}
            onClick={() => void modelAction(model, 'probe')}
          >
            Check model
          </button>
        ) : null}
        {downloading ? (
          <span className={styles.detail}>You can continue setup later.</span>
        ) : null}
      </div>
    );
  };
  const requirements = (model: Model | undefined) =>
    model ? (
      <p className={styles.detail}>
        {model.sizeMb.toLocaleString()} MB download · Minimum {model.minRamGb}{' '}
        GB RAM
      </p>
    ) : null;
  const speechReady =
    speechProvider?.available && speechProvider.canProduceTranscript;

  return (
    <section aria-label="AI model choices">
      {loading ? <p role="status">Checking this device…</p> : null}
      <div className={styles.box}>
        {showChat ? (
          <section className={styles.choice}>
            <h3 className={styles.choiceTitle}>Local chat model</h3>
            <p className={styles.detail}>
              Used for Nota AI, note actions and meeting summaries.
            </p>
            <select
              className={styles.select}
              aria-label="Local chat model"
              value={chatId}
              disabled={controlsDisabled}
              onChange={event => setChatId(event.target.value)}
            >
              <option value="">Keep current AI settings</option>
              {chatId && !chat ? (
                <option value={chatId}>{chatId} (current)</option>
              ) : null}
              {chatModels.map(model => (
                <option
                  key={model.id}
                  value={model.id}
                  disabled={
                    !isReleasedLocalModel(model) ||
                    (model.deviceFit !== undefined &&
                      model.deviceFit !== 'fits')
                  }
                >
                  {localModelName(model.id)}
                </option>
              ))}
            </select>
            {requirements(chat)}
            <p className={styles.detail} role="status">
              {chat
                ? busy === `probe:${chat.id}`
                  ? 'Checking model…'
                  : busy === `download:${chat.id}`
                    ? 'Starting download…'
                    : localModelStatusLabel(chat, false)
                : chatId
                  ? 'Current local model is managed outside this model list.'
                  : 'Your current AI settings will be preserved.'}
            </p>
            {chat && chatSelection?.reason ? (
              <p className={styles.detail}>{chatSelection.reason}</p>
            ) : null}
            {actions(chat)}
          </section>
        ) : null}
        {showSpeech ? (
          <section className={styles.choice}>
            <h3 className={styles.choiceTitle}>Transcription model</h3>
            <p className={styles.detail}>
              Turns meeting recordings into text on your device.
            </p>
            <select
              className={styles.select}
              aria-label="Transcription model"
              value={speechId}
              disabled={controlsDisabled}
              onChange={event => setSpeechId(event.target.value)}
            >
              <option value="auto">Auto (recommended)</option>
              {speechId !== 'auto' && !speechProvider ? (
                <option value={speechId}>{speechId} (current)</option>
              ) : null}
              {speechProviders.map(provider => (
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={!meetingProviderSelectionState(provider).selectable}
                >
                  {provider.name}
                </option>
              ))}
            </select>
            {requirements(speechModel)}
            <p className={styles.detail} role="status">
              {draftAutoPending
                ? 'Auto chooses an available local transcription model after you save.'
                : speechReady
                  ? `${speechId === 'auto' ? `${speechProvider.name}: ` : ''}Ready for transcription.`
                  : speechModel
                    ? busy === `probe:${speechModel.id}`
                      ? 'Checking model…'
                      : busy === `download:${speechModel.id}`
                        ? 'Starting download…'
                        : speechModel.downloadStatus === 'downloaded'
                          ? 'Downloaded; transcription runtime is not ready.'
                          : localModelStatusLabel(speechModel, false)
                    : (speechProvider?.unavailableReason ??
                      runtime?.autoSelectionError ??
                      'Transcription is not ready yet.')}
            </p>
            {speechSelection?.reason ? (
              <p className={styles.detail}>{speechSelection.reason}</p>
            ) : null}
            {!speechReady && speechModel?.downloadStatus === 'downloaded' ? (
              <p className={styles.detail}>
                {speechProvider?.unavailableReason ??
                  'The speech runtime still needs to be checked.'}
              </p>
            ) : null}
            {actions(speechModel, speechProvider?.name)}
          </section>
        ) : null}
      </div>
      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError} You can skip model setup and keep writing.
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}
      <div className={styles.bottom}>
        <div className={styles.actions}>
          {onSkip ? (
            <button type="button" className={styles.subtle} onClick={onSkip}>
              Skip for now
            </button>
          ) : null}
          <button
            type="button"
            className={styles.subtle}
            disabled={loading || busy !== null}
            onClick={() =>
              settings ? void refreshHealth() : setReload(value => value + 1)
            }
          >
            {loadError ? 'Retry model status' : 'Refresh status'}
          </button>
        </div>
        <button
          type="button"
          className={styles.primary}
          disabled={controlsDisabled || invalidSelection || !!loadError}
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Saving…' : 'Save and continue'}
        </button>
      </div>
      <p className={styles.caption}>
        Recording access is requested when you record. You can change these
        choices in Settings.
      </p>
    </section>
  );
}
