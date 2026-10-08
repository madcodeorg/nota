import { useCallback, useEffect, useRef, useState } from 'react';

export interface SetupReadiness {
  status: 'checking' | 'ready' | 'downloading' | 'action-required';
  detail: string;
  requirements?: string;
}
interface LocalModel {
  id: string;
  type: 'text' | 'stt' | 'embedding';
  sizeMb?: number;
  minRamGb?: number;
  downloadStatus?: string;
  progress?: number;
  runtimeProbe?: {
    modelId: string;
    status: string;
    canLoad: boolean;
    runtimeAvailable: boolean;
  };
}
interface BackendSettings {
  provider?: string;
  model?: string;
  localModel?: string;
  models?: {
    optionalModels?: { id: string; readiness?: string }[];
    proModels?: { id: string; readiness?: string }[];
  };
  meetings?: { sttModelId?: string };
}
interface ModelHealth {
  models: LocalModel[];
  device?: { availableDiskGb?: number | null };
}
interface SpeechRuntime {
  transcriptAvailable?: boolean;
  resolvedProvider?: { name?: string; modelId?: string } | null;
}

const checking: SetupReadiness = {
  status: 'checking',
  detail: 'Checking this device…',
};
const unavailable: SetupReadiness = {
  status: 'action-required',
  detail: 'Status unavailable. Check settings or keep writing.',
};

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Status returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function modelState(
  model: LocalModel | undefined,
  health: ModelHealth
): SetupReadiness {
  if (!model) {
    return {
      status: 'action-required',
      detail: 'Choose a model in AI settings.',
    };
  }
  const availableDiskGb = health.device?.availableDiskGb;
  const requirements = [
    typeof model.sizeMb === 'number' && Number.isFinite(model.sizeMb)
      ? `Download: ${Math.round(model.sizeMb)} MB`
      : null,
    Number.isFinite(model.minRamGb)
      ? `Minimum RAM: ${model.minRamGb} GB`
      : null,
    typeof availableDiskGb === 'number' && Number.isFinite(availableDiskGb)
      ? `Free disk: ${availableDiskGb.toFixed(1)} GB`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const probe = model.runtimeProbe;
  if (
    probe?.modelId === model.id &&
    probe.status === 'available' &&
    probe.canLoad &&
    probe.runtimeAvailable &&
    model.downloadStatus === 'downloaded'
  ) {
    return {
      status: 'ready',
      detail: 'Verified on this device.',
      requirements,
    };
  }
  if (
    model.downloadStatus === 'downloading' ||
    model.downloadStatus === 'queued'
  ) {
    const progress =
      typeof model.progress === 'number' && Number.isFinite(model.progress)
        ? ` (${Math.round(Math.min(1, Math.max(0, model.progress)) * 100)}%)`
        : '';
    return {
      status: 'downloading',
      detail: `Downloading${progress}. You can keep writing.`,
      requirements,
    };
  }
  return {
    status: 'action-required',
    detail:
      model.downloadStatus === 'downloaded'
        ? 'Downloaded; runtime check needed in settings.'
        : 'Review model and download options in settings.',
    requirements,
  };
}

/** Read-only readiness. Opening setup never downloads models or requests access. */
export function useSetupReadiness() {
  const [ai, setAI] = useState(checking);
  const [meetings, setMeetings] = useState(checking);
  const request = useRef(0);
  const [refresh, setRefresh] = useState(0);
  const retry = useCallback(() => setRefresh(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++request.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = () => {
      if (controller.signal.aborted || request.current !== current) return;
      setAI(unavailable);
      setMeetings(unavailable);
    };
    const load = async () => {
      // Match AI/Meetings settings. Electron's protocol proxy resolves the
      // local backend origin and authenticates these requests in the main process.
      const [settings, models, speech] = await Promise.allSettled([
        json<BackendSettings>('/api/ai/settings', controller.signal),
        json<ModelHealth>('/v1/local/models', controller.signal),
        json<SpeechRuntime>('/v1/stt/runtime', controller.signal),
      ]);
      if (controller.signal.aborted || request.current !== current) return;
      let nextAI = unavailable;
      let nextMeetings = unavailable;
      const health = models.status === 'fulfilled' ? models.value : undefined;
      const config =
        settings.status === 'fulfilled' ? settings.value : undefined;
      if (health && Array.isArray(health.models) && config) {
        const modelId = (config.localModel || config.model)?.replace(
          /^local:/,
          ''
        );
        const model = health.models.find(
          item => item.type === 'text' && item.id === modelId
        );
        nextAI = modelState(model, health);
        if (config.provider !== 'local') {
          nextAI = {
            status: 'action-required',
            detail: 'Select Local in AI settings to use AI on this device.',
            requirements: nextAI.requirements,
          };
        } else if (!model) {
          const advertised = [
            ...(config.models?.optionalModels ?? []),
            ...(config.models?.proModels ?? []),
          ].find(item => item.id === modelId || item.id === `local:${modelId}`);
          if (advertised?.readiness === 'ready') {
            nextAI = { status: 'ready', detail: 'Local runtime is ready.' };
          }
        }
      }
      if (speech.status === 'fulfilled') {
        if (speech.value.transcriptAvailable === true) {
          nextMeetings = {
            status: 'ready',
            detail: `${speech.value.resolvedProvider?.name ?? 'Local transcription'} is ready. Recording permissions are checked when you record.`,
          };
        } else if (health && Array.isArray(health.models)) {
          const modelId =
            speech.value.resolvedProvider?.modelId ||
            config?.meetings?.sttModelId;
          nextMeetings = modelState(
            health.models.find(
              item => item.type === 'stt' && item.id === modelId
            ),
            health
          );
          // A model probe alone cannot establish selected speech readiness.
          if (nextMeetings.status === 'ready') {
            nextMeetings = {
              ...nextMeetings,
              status: 'action-required',
              detail: 'Select and check a transcription provider in settings.',
            };
          }
        }
      }
      setAI(nextAI);
      setMeetings(nextMeetings);
      if (
        nextAI.status === 'downloading' ||
        nextMeetings.status === 'downloading'
      ) {
        timer = setTimeout(() => {
          load().catch(failed);
        }, 5000);
      }
    };
    load().catch(failed);
    window.addEventListener('focus', retry);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', retry);
    };
  }, [refresh, retry]);

  return { ai, meetings, retry };
}
