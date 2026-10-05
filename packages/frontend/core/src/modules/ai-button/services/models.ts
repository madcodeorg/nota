import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/affine/shared/utils';
import { getPromptModelsQuery } from '@nota/graphql';
import { LiveData, Service } from '@nota/infra';
import { computed, type ReadonlySignal, signal } from '@preact/signals-core';

import type { GraphQLService } from '../../cloud';
import type { GlobalStateService } from '../../storage';
import { AI_REASONING_LEVELS, type AIReasoningLevel } from '../reasoning';

const AI_MODEL_ID_KEY = 'AIModelId';
const DEFAULT_CHAT_PROMPT = 'Chat With Nota AI';
const QUALIFIED_MODEL_PROVIDERS = new Set([
  'anthropic',
  'custom',
  'deepseek',
  'google',
  'groq',
  'local',
  'mistral',
  'openai',
  'openrouter',
  'perplexity',
  'xai',
]);

const TERMINAL_LOCAL_MODEL_DOWNLOAD_STATUSES = new Set([
  'blocked',
  'downloaded',
  'error',
  'missing_url',
  'planned',
]);

type LocalModelDownloadFetcher = (
  input: string,
  init: { signal: AbortSignal }
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

interface MonitorLocalModelDownloadOptions {
  fetcher?: LocalModelDownloadFetcher;
  modelId: string;
  refreshModels: () => Promise<void>;
  retryIntervalMs?: number;
  signal: AbortSignal;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

function waitForDownloadPoll(delayMs: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function localModelDownloadStatus(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const download = (payload as { download?: unknown }).download;
  if (!download || typeof download !== 'object') return null;
  const status = (download as { downloadStatus?: unknown }).downloadStatus;
  return typeof status === 'string' ? status : null;
}

export async function monitorLocalModelDownload({
  fetcher = fetch,
  modelId,
  refreshModels,
  retryIntervalMs = 1000,
  signal,
  wait = waitForDownloadPoll,
}: MonitorLocalModelDownloadOptions) {
  const url = `/v1/local/models/${encodeURIComponent(modelId)}/download`;
  while (!signal.aborted) {
    try {
      const response = await fetcher(url, { signal });
      if (response.ok) {
        const status = localModelDownloadStatus(await response.json());
        if (status === 'downloaded') {
          await refreshModels();
          return;
        }
        if (status && TERMINAL_LOCAL_MODEL_DOWNLOAD_STATUSES.has(status)) {
          return;
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await wait(retryIntervalMs, signal);
  }
}

export function supportsAIModelImageAttachments(
  modelId?: string,
  advertisedSupport?: boolean
) {
  if (typeof advertisedSupport === 'boolean') {
    return advertisedSupport;
  }
  if (!modelId) return true;
  const separator = modelId.indexOf(':');
  if (separator <= 0 || separator === modelId.length - 1) return true;
  const provider = modelId.slice(0, separator);
  const unqualifiedModelId = modelId.slice(separator + 1).toLowerCase();
  return !(
    provider === 'local' && /(?:^|-)onnx(?:-|$)/.test(unqualifiedModelId)
  );
}

export function migrateAIModelId(
  selectedModelId: string,
  availableModelIds: string[]
) {
  if (availableModelIds.includes(selectedModelId)) {
    return selectedModelId;
  }

  const separator = selectedModelId.indexOf(':');
  if (
    separator > 0 &&
    QUALIFIED_MODEL_PROVIDERS.has(selectedModelId.slice(0, separator))
  ) {
    return null;
  }

  const suffixMatches = availableModelIds.filter(modelId => {
    const separator = modelId.indexOf(':');
    return separator > 0 && modelId.slice(separator + 1) === selectedModelId;
  });
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

export interface AIModel {
  category: string;
  id: string;
  isDefault: boolean;
  name: string;
  readiness?: 'ready' | 'unavailable' | 'unverified';
  readinessMessage?: string | null;
  reasoningLevels?: AIReasoningLevel[];
  selectable: boolean;
  supportsImageAttachments?: boolean;
  version: string;
}

export interface AIModelCatalogMetadata {
  id: string;
  readiness?: 'ready' | 'unavailable' | 'unverified';
  readinessMessage?: string | null;
  reasoningLevels?: AIReasoningLevel[];
  selectable?: boolean;
  supportsImageAttachments?: boolean;
}

type PromptModel = AIModelCatalogMetadata & { name: string };

const validReasoningLevels = new Set<string>(AI_REASONING_LEVELS);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function preferDefined<T>(primary: T | undefined, fallback: T | undefined) {
  return primary === undefined ? fallback : primary;
}

function modelMetadata(value: unknown): AIModelCatalogMetadata | null {
  const candidate = record(value);
  if (!candidate || typeof candidate.id !== 'string') return null;
  const readiness =
    candidate.readiness === 'ready' ||
    candidate.readiness === 'unavailable' ||
    candidate.readiness === 'unverified'
      ? candidate.readiness
      : undefined;
  const reasoningLevels = Array.isArray(candidate.reasoningLevels)
    ? candidate.reasoningLevels.filter(
        (level): level is AIReasoningLevel =>
          typeof level === 'string' && validReasoningLevels.has(level)
      )
    : undefined;
  return {
    id: candidate.id,
    readiness,
    readinessMessage:
      typeof candidate.readinessMessage === 'string' ||
      candidate.readinessMessage === null
        ? candidate.readinessMessage
        : undefined,
    reasoningLevels: reasoningLevels?.length ? reasoningLevels : undefined,
    selectable:
      typeof candidate.selectable === 'boolean'
        ? candidate.selectable
        : undefined,
    supportsImageAttachments:
      typeof candidate.supportsImageAttachments === 'boolean'
        ? candidate.supportsImageAttachments
        : undefined,
  };
}

function unavailableLocalModelReason(value: unknown) {
  const health = record(value);
  if (!health || typeof health.id !== 'string' || health.type !== 'text') {
    return null;
  }
  if (
    health.releaseState === 'blocked' ||
    health.deviceFit === 'blocked' ||
    health.downloadStatus === 'blocked'
  ) {
    return typeof health.deviceFitReason === 'string'
      ? health.deviceFitReason
      : 'This local model is blocked.';
  }
  if (
    health.releaseState === 'planned' ||
    health.deviceFit === 'planned' ||
    health.downloadStatus === 'planned'
  ) {
    return typeof health.deviceFitReason === 'string'
      ? health.deviceFitReason
      : 'This local model is not ready yet.';
  }
  if (health.deviceFit === 'low_ram' || health.deviceFit === 'low_disk') {
    return typeof health.deviceFitReason === 'string'
      ? health.deviceFitReason
      : 'This device does not currently meet the model requirements.';
  }
  if (
    typeof health.downloadStatus === 'string' &&
    health.downloadStatus !== 'downloaded'
  ) {
    return 'Download this local model before using it in chat.';
  }
  const probe = record(health.runtimeProbe);
  if (
    probe &&
    (probe.status !== 'available' ||
      probe.runtimeAvailable !== true ||
      probe.canLoad !== true)
  ) {
    return typeof probe.message === 'string'
      ? probe.message
      : 'The local ONNX runtime cannot load this model.';
  }
  return null;
}

export function readAIModelCatalogMetadata(
  payload: unknown
): AIModelCatalogMetadata[] {
  const root = record(payload);
  const models = record(root?.models);
  const advertised = Array.isArray(models?.optionalModels)
    ? models.optionalModels
        .map(modelMetadata)
        .filter((model): model is AIModelCatalogMetadata => !!model)
    : [];
  const meetings = record(root?.meetings);
  const localModels = Array.isArray(meetings?.localModels)
    ? meetings.localModels
    : [];
  const unavailableById = new Map<string, string>();
  for (const localModel of localModels) {
    const health = record(localModel);
    const reason = unavailableLocalModelReason(localModel);
    if (reason && typeof health?.id === 'string') {
      unavailableById.set(health.id, reason);
    }
  }

  return advertised.map(model => {
    const separator = model.id.indexOf(':');
    const provider = separator > 0 ? model.id.slice(0, separator) : '';
    const unqualifiedId = separator > 0 ? model.id.slice(separator + 1) : '';
    const unavailableReason =
      provider === 'local' ? unavailableById.get(unqualifiedId) : undefined;
    return unavailableReason
      ? {
          ...model,
          readiness: 'unavailable',
          readinessMessage: unavailableReason,
          selectable: false,
        }
      : model;
  });
}

export function mergeAIModelCatalog(
  promptModels: PromptModel[],
  defaultModelId: string,
  metadata: AIModelCatalogMetadata[] = []
): AIModel[] {
  const metadataById = new Map(metadata.map(model => [model.id, model]));
  const merged = promptModels.map(model => {
    const [category] = model.name.split(' ');
    const version = model.name.slice(category.length + 1);
    const promptAdvertised = modelMetadata(model);
    const settingsAdvertised = metadataById.get(model.id);
    const readiness = preferDefined(
      settingsAdvertised?.readiness,
      promptAdvertised?.readiness
    );
    const readinessMessage = preferDefined(
      settingsAdvertised?.readinessMessage,
      promptAdvertised?.readinessMessage
    );
    const reasoningLevels = preferDefined(
      settingsAdvertised?.reasoningLevels,
      promptAdvertised?.reasoningLevels
    );
    const selectable = preferDefined(
      settingsAdvertised?.selectable,
      promptAdvertised?.selectable
    );
    const supportsImageAttachments = preferDefined(
      settingsAdvertised?.supportsImageAttachments,
      promptAdvertised?.supportsImageAttachments
    );
    return {
      category,
      id: model.id,
      isDefault: model.id === defaultModelId,
      name: model.name,
      readiness,
      readinessMessage,
      reasoningLevels,
      selectable: selectable !== false,
      supportsImageAttachments,
      version,
    } satisfies AIModel;
  });
  const selectable = merged.filter(model => model.selectable);
  if (!selectable.some(model => model.isDefault) && selectable[0]) {
    selectable[0] = { ...selectable[0], isDefault: true };
  }
  return selectable;
}

export class AIModelService extends Service {
  modelId: ReadonlySignal<string | undefined>;

  models: Signal<AIModel[]> = signal([]);

  private readonly storedModelId: Signal<string | undefined>;

  private readonly localModelDownloadMonitors = new Map<
    string,
    AbortController
  >();

  private readonly modelId$ = LiveData.from(
    this.globalStateService.globalState.watch<string>(AI_MODEL_ID_KEY),
    undefined
  );

  constructor(
    private readonly globalStateService: GlobalStateService,
    private readonly gqlService: GraphQLService
  ) {
    super();

    const { signal: storedModelId, cleanup } = createSignalFromObservable<
      string | undefined
    >(this.modelId$, undefined);
    this.storedModelId = storedModelId;
    this.modelId = computed(() => {
      if (!this.models.value.length) {
        return undefined;
      }
      const selectedModelId = this.storedModelId.value;
      return selectedModelId &&
        this.models.value.some(model => model.id === selectedModelId)
        ? selectedModelId
        : undefined;
    });
    this.disposables.push(cleanup);
    this.disposables.push(() => {
      for (const controller of this.localModelDownloadMonitors.values()) {
        controller.abort();
      }
      this.localModelDownloadMonitors.clear();
    });

    this.init().catch(err => {
      console.error(err);
    });
  }

  resetModel = () => {
    this.globalStateService.globalState.set(AI_MODEL_ID_KEY, undefined);
  };

  setModel = (modelId: string) => {
    const model = this.models.value.find(model => model.id === modelId);
    if (!model) {
      return;
    }
    this.globalStateService.globalState.set(AI_MODEL_ID_KEY, modelId);
  };

  private readonly init = async () => {
    await this.initModels();
  };

  refreshModels = async () => {
    await this.initModels();
  };

  watchLocalModelDownload = (modelId: string) => {
    if (!modelId || this.localModelDownloadMonitors.has(modelId)) return;
    const controller = new AbortController();
    this.localModelDownloadMonitors.set(modelId, controller);
    monitorLocalModelDownload({
      modelId,
      refreshModels: this.refreshModels,
      signal: controller.signal,
    })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.error('Failed to refresh the local model catalog', error);
        }
      })
      .finally(() => {
        if (this.localModelDownloadMonitors.get(modelId) === controller) {
          this.localModelDownloadMonitors.delete(modelId);
        }
      });
  };

  private readonly initModels = async (prompt?: string) => {
    const promptName = prompt || DEFAULT_CHAT_PROMPT;
    const [models, metadata] = await Promise.all([
      this.getModelsByPrompt(promptName),
      this.getAdvertisedModelMetadata(),
    ]);
    if (models) {
      const { defaultModel, optionalModels } = models;
      this.models.value = mergeAIModelCatalog(
        optionalModels,
        defaultModel,
        metadata
      );

      const selectedModelId = this.storedModelId.value;
      if (selectedModelId) {
        const migratedModelId = migrateAIModelId(
          selectedModelId,
          this.models.value.map(model => model.id)
        );
        if (migratedModelId && migratedModelId !== selectedModelId) {
          this.globalStateService.globalState.set(
            AI_MODEL_ID_KEY,
            migratedModelId
          );
        } else if (!migratedModelId) {
          this.resetModel();
        }
      }
    }
  };

  private readonly getModelsByPrompt = async (promptName: string) => {
    return this.gqlService
      .gql({
        query: getPromptModelsQuery,
        variables: { promptName },
      })
      .then(res => res.currentUser?.copilot?.models);
  };

  private readonly getAdvertisedModelMetadata = async () => {
    try {
      const response = await fetch('/api/ai/settings');
      if (!response.ok) return [];
      return readAIModelCatalogMetadata(await response.json());
    } catch {
      // Cloud and older backends do not expose the local catalog extension.
      // Keep the GraphQL catalog usable through the compatibility heuristics.
      return [];
    }
  };
}
