import { ResetIcon } from '@blocksuite/icons/rc';
import {
  Button,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuTrigger,
  notify,
  Switch,
  Tabs,
} from '@nota/component';
import { SettingHeader, SettingRow } from '@nota/component/setting-components';
import { AIModelService } from '@nota/core/modules/ai-button/services/models';
import { ServerService } from '@nota/core/modules/cloud';
import { FeatureFlagService } from '@nota/core/modules/feature-flag';
import { useLiveData, useServices } from '@nota/infra';
import clsx from 'clsx';
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  canDownloadLocalModel,
  isReleasedLocalModel,
  localModelDownloadFeedback,
  localModelStatusLabel,
  localTextModelSelectionState,
} from './local-model-selection';
import { LocalModelList, localModelName } from './model-list';
import * as styles from './style.css';

type BuiltInProviderName = 'local' | 'openai' | 'anthropic' | 'google';
const openAICompatibleProviderNames = [
  'openrouter',
  'deepseek',
  'xai',
  'mistral',
  'groq',
  'perplexity',
  'custom',
] as const;
type OpenAICompatibleProviderName =
  (typeof openAICompatibleProviderNames)[number];
type ProviderName = BuiltInProviderName | OpenAICompatibleProviderName;
type DirectApiProviderName = Exclude<BuiltInProviderName, 'local'>;
type ImageProviderName = 'local' | 'openai' | 'google';
type EmbeddingMode = 'auto' | 'fallback' | 'semantic';
type CompatibleProviderSettings = {
  baseUrl: string;
  hasKey?: boolean;
  model: string;
};
type CompatibleProviderDraft = CompatibleProviderSettings & {
  apiKey: string;
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

type AIBackendSettings = {
  provider: ProviderName;
  model: string;
  models: {
    defaultModel: string;
    optionalModels: Array<{
      id: string;
      name: string;
      readiness?: 'ready' | 'unavailable' | 'unverified';
      readinessMessage?: string | null;
      reasoningLevels?: string[];
      selectable?: boolean;
      supportsImageAttachments?: boolean;
    }>;
    proModels: Array<{
      id: string;
      name: string;
      readiness?: 'ready' | 'unavailable' | 'unverified';
      readinessMessage?: string | null;
      reasoningLevels?: string[];
      selectable?: boolean;
      supportsImageAttachments?: boolean;
    }>;
  };
  providers: ProviderName[];
  localBaseUrl: string;
  localModel: string;
  openaiModel: string;
  anthropicModel: string;
  googleModel: string;
  compatibleProviders: Record<
    OpenAICompatibleProviderName,
    CompatibleProviderSettings
  >;
  imageProvider: ImageProviderName;
  openaiImageModel: string;
  googleImageModel: string;
  localImageModel: string;
  tools: {
    embeddingAllowRemote: boolean;
    embeddingMode: EmbeddingMode;
    embeddingModel: string;
    enabled: boolean;
    webCrawl: boolean;
    shell: boolean;
    workspaceSearch: boolean;
    maxSteps: number;
  };
  mcp: {
    enabled: boolean;
    config: string;
    toolNames?: string[];
    servers?: Array<{
      blockedToolNames?: string[];
      error?: string;
      name: string;
      toolNames: string[];
      transport: string;
    }>;
  };
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
      localPath?: string;
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
      tier?: 'small' | 'medium' | 'large';
      totalBytes?: number;
      type: 'embedding' | 'stt' | 'text';
      updatedAt?: string;
    }>;
    sttProviders: Array<{
      available: boolean;
      canProduceTranscript?: boolean;
      defaultForPlatform: boolean;
      id: string;
      modelId?: string;
      name: string;
      notes: string;
      transcriptMode?:
        | 'native-streaming'
        | 'planned-streaming'
        | 'unavailable'
        | 'vad-chunk';
      unavailableReason?: string;
    }>;
    transcriptionAvailable: boolean;
  };
  hasKeys: Record<ProviderName, boolean>;
  capabilities: {
    chat: boolean;
    context: boolean;
    imageGeneration: boolean;
    tools: boolean;
    webCrawl: boolean;
    shell: boolean;
    workspaceSearch: boolean;
    mcp: boolean;
    appActions: boolean;
    databaseCreation: boolean;
    meetingTranscription: boolean;
    noteCreation: boolean;
    mindMapCreation: boolean;
  };
};
type LocalModelSettings = AIBackendSettings['meetings']['localModels'][number];

const providerLabels: Record<ProviderName, string> = {
  local: 'Local',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  mistral: 'Mistral',
  groq: 'Groq',
  perplexity: 'Perplexity',
  custom: 'Custom compatible',
};

const directApiProviderLabels: Record<DirectApiProviderName, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
};

const fallbackCompatibleProviders: Record<
  OpenAICompatibleProviderName,
  CompatibleProviderSettings
> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5-mini',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3-mini',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  perplexity: {
    baseUrl: 'https://api.perplexity.ai',
    model: 'sonar',
  },
  custom: {
    baseUrl: '',
    model: '',
  },
};

const imageProviderLabels: Record<ImageProviderName, string> = {
  local: 'Local',
  openai: 'OpenAI',
  google: 'Google',
};

const embeddingModeLabels: Record<EmbeddingMode, string> = {
  auto: 'Auto',
  fallback: 'Keyword fallback',
  semantic: 'Force semantic',
};

const embeddingModeDescriptions: Record<EmbeddingMode, string> = {
  auto: 'Uses semantic embeddings when free memory is healthy, otherwise keeps keyword ranking.',
  fallback: 'Never loads the embedding model. Lowest memory use.',
  semantic:
    'Always tries the local embedding model for semantic workspace search.',
};

const fallbackSettings: AIBackendSettings = {
  provider: 'local',
  model: 'qwen3.5-2b-onnx-q4f16',
  models: {
    defaultModel: 'local:qwen3.5-2b-onnx-q4f16',
    optionalModels: [],
    proModels: [],
  },
  providers: [
    'local',
    'openai',
    'anthropic',
    'google',
    ...openAICompatibleProviderNames,
  ],
  localBaseUrl: 'http://localhost:11434/v1',
  localModel: 'qwen3.5-2b-onnx-q4f16',
  openaiModel: 'gpt-5-mini',
  anthropicModel: 'claude-sonnet-4-5-20250929',
  googleModel: 'gemini-2.5-flash',
  compatibleProviders: fallbackCompatibleProviders,
  imageProvider: 'openai',
  openaiImageModel: 'gpt-image-1-mini',
  googleImageModel: 'imagen-4.0-fast-generate-001',
  localImageModel: 'local-image-model',
  tools: {
    embeddingAllowRemote: false,
    embeddingMode: 'auto',
    embeddingModel: 'all-minilm-l6-v2-embedding',
    enabled: true,
    webCrawl: true,
    shell: false,
    workspaceSearch: true,
    maxSteps: 50,
  },
  mcp: {
    enabled: false,
    config: '{}',
    toolNames: [],
    servers: [],
  },
  meetings: {
    device: undefined,
    localModels: [],
    sttProviders: [],
    transcriptionAvailable: false,
  },
  hasKeys: {
    local: true,
    openai: false,
    anthropic: false,
    google: false,
    openrouter: false,
    deepseek: false,
    xai: false,
    mistral: false,
    groq: false,
    perplexity: false,
    custom: false,
  },
  capabilities: {
    chat: false,
    context: false,
    imageGeneration: false,
    tools: false,
    webCrawl: false,
    shell: false,
    workspaceSearch: false,
    mcp: false,
    appActions: false,
    databaseCreation: false,
    meetingTranscription: false,
    noteCreation: false,
    mindMapCreation: false,
  },
};

function isOpenAICompatibleProvider(
  provider: ProviderName
): provider is OpenAICompatibleProviderName {
  return openAICompatibleProviderNames.includes(
    provider as OpenAICompatibleProviderName
  );
}

function parseQualifiedTextModel(modelId: string) {
  const separator = modelId.indexOf(':');
  if (separator <= 0 || separator === modelId.length - 1) {
    return null;
  }
  const provider = modelId.slice(0, separator) as ProviderName;
  if (!(provider in providerLabels)) {
    return null;
  }
  return {
    modelId: modelId.slice(separator + 1),
    provider,
  };
}

function modelFieldForProvider(provider: BuiltInProviderName) {
  switch (provider) {
    case 'anthropic':
      return 'anthropicModel';
    case 'google':
      return 'googleModel';
    case 'openai':
      return 'openaiModel';
    case 'local':
      return 'localModel';
  }
}

function textModelForProvider(
  settings: AIBackendSettings,
  provider: ProviderName
) {
  if (isOpenAICompatibleProvider(provider)) {
    return settings.compatibleProviders[provider]?.model ?? '';
  }
  return settings[modelFieldForProvider(provider)];
}

function imageModelFieldForProvider(provider: ImageProviderName) {
  switch (provider) {
    case 'google':
      return 'googleImageModel';
    case 'openai':
      return 'openaiImageModel';
    case 'local':
      return 'localImageModel';
  }
}

function apiKeyFieldForProvider(provider: DirectApiProviderName) {
  switch (provider) {
    case 'anthropic':
      return 'anthropicApiKey';
    case 'google':
      return 'googleApiKey';
    case 'openai':
      return 'openaiApiKey';
  }
}

async function fetchAISettings() {
  const response = await fetch('/api/ai/settings');
  if (!response.ok) {
    throw new Error(`AI backend returned HTTP ${response.status}`);
  }
  return (await response.json()) as AIBackendSettings;
}

const SettingsSection = ({
  title,
  children,
}: PropsWithChildren<{ title?: string }>) => (
  <section className={styles.section}>
    {title ? <h2>{title}</h2> : null}
    {children}
  </section>
);

export const AISettingsPanel = ({
  scope = 'all',
}: {
  scope?: 'all' | 'embeddings';
} = {}) => {
  const embeddingOnly = scope === 'embeddings';
  const { aIModelService, featureFlagService, serverService } = useServices({
    AIModelService,
    FeatureFlagService,
    ServerService,
  });
  const aiModelService = aIModelService;
  const serverFeatures = useLiveData(serverService.server.features$);
  const enableAI = useLiveData(featureFlagService.flags.enable_ai.$);
  const [settings, setSettings] = useState<AIBackendSettings>(fallbackSettings);
  const [provider, setProvider] = useState<ProviderName>('local');
  const [model, setModel] = useState(fallbackSettings.model);
  const [imageProvider, setImageProvider] = useState<ImageProviderName>(
    fallbackSettings.imageProvider
  );
  const [imageModel, setImageModel] = useState(
    fallbackSettings[imageModelFieldForProvider(fallbackSettings.imageProvider)]
  );
  const [customLocalModel, setCustomLocalModel] = useState(false);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<
    Record<DirectApiProviderName, string>
  >({
    openai: '',
    anthropic: '',
    google: '',
  });
  const [compatibleProviderDrafts, setCompatibleProviderDrafts] = useState<
    Record<OpenAICompatibleProviderName, CompatibleProviderDraft>
  >(
    Object.fromEntries(
      openAICompatibleProviderNames.map(item => [
        item,
        {
          ...fallbackCompatibleProviders[item],
          apiKey: '',
        },
      ])
    ) as Record<OpenAICompatibleProviderName, CompatibleProviderDraft>
  );
  const [localBaseUrl, setLocalBaseUrl] = useState(
    fallbackSettings.localBaseUrl
  );
  const [toolsEnabled, setToolsEnabled] = useState(
    fallbackSettings.tools.enabled
  );
  const [embeddingModel, setEmbeddingModel] = useState(
    fallbackSettings.tools.embeddingModel
  );
  const [embeddingMode, setEmbeddingMode] = useState<EmbeddingMode>(
    fallbackSettings.tools.embeddingMode
  );
  const [embeddingAllowRemote, setEmbeddingAllowRemote] = useState(
    fallbackSettings.tools.embeddingAllowRemote
  );
  const [webCrawlToolEnabled, setWebCrawlToolEnabled] = useState(
    fallbackSettings.tools.webCrawl
  );
  const [shellToolEnabled, setShellToolEnabled] = useState(
    fallbackSettings.tools.shell
  );
  const [workspaceSearchToolEnabled, setWorkspaceSearchToolEnabled] = useState(
    fallbackSettings.tools.workspaceSearch
  );
  const [toolMaxSteps, setToolMaxSteps] = useState(
    String(fallbackSettings.tools.maxSteps)
  );
  const [mcpEnabled, setMcpEnabled] = useState(fallbackSettings.mcp.enabled);
  const [mcpConfig, setMcpConfig] = useState(fallbackSettings.mcp.config);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(
    null
  );
  const [probingModelId, setProbingModelId] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [modelActionError, setModelActionError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const healthRequestRef = useRef(0);
  const modelActionRef = useRef(false);
  const pendingTextDownloadsRef = useRef(new Set<string>());
  const saveRef = useRef(false);
  const controlsDisabled = loading || saving || !!backendError;

  useEffect(() => {
    const requestCounter = requestRef;
    const healthRequestCounter = healthRequestRef;
    return () => {
      requestCounter.current++;
      healthRequestCounter.current++;
    };
  }, []);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    healthRequestRef.current++;
    setLoading(true);
    try {
      const fetched = await fetchAISettings();
      if (request !== requestRef.current) return;
      const next: AIBackendSettings = {
        ...fallbackSettings,
        ...fetched,
        compatibleProviders: {
          ...fallbackCompatibleProviders,
          ...fetched.compatibleProviders,
        },
        hasKeys: {
          ...fallbackSettings.hasKeys,
          ...fetched.hasKeys,
        },
        providers: fetched.providers?.length
          ? fetched.providers
          : fallbackSettings.providers,
      };
      const nextLocalModelIsCustom = !next.meetings.localModels.some(
        item => item.type === 'text' && item.id === next.localModel
      );
      setSettings(next);
      setProvider(next.provider);
      setModel(next.model);
      setImageProvider(next.imageProvider);
      setImageModel(next[imageModelFieldForProvider(next.imageProvider)]);
      setCustomLocalModel(next.provider === 'local' && nextLocalModelIsCustom);
      setApiKeyDrafts({
        openai: '',
        anthropic: '',
        google: '',
      });
      setCompatibleProviderDrafts(
        Object.fromEntries(
          openAICompatibleProviderNames.map(item => [
            item,
            {
              ...(next.compatibleProviders[item] ??
                fallbackCompatibleProviders[item]),
              apiKey: '',
            },
          ])
        ) as Record<OpenAICompatibleProviderName, CompatibleProviderDraft>
      );
      setLocalBaseUrl(next.localBaseUrl);
      setToolsEnabled(next.tools.enabled);
      setEmbeddingModel(next.tools.embeddingModel);
      setEmbeddingMode(next.tools.embeddingMode ?? 'auto');
      setEmbeddingAllowRemote(next.tools.embeddingAllowRemote);
      setWebCrawlToolEnabled(next.tools.webCrawl);
      setShellToolEnabled(next.tools.shell);
      setWorkspaceSearchToolEnabled(next.tools.workspaceSearch);
      setToolMaxSteps(String(next.tools.maxSteps));
      setMcpEnabled(next.mcp.enabled);
      setMcpConfig(next.mcp.config);
      await aiModelService.refreshModels().catch((error: unknown) => {
        console.error('Failed to refresh the chat model catalog', error);
      });
      if (request === requestRef.current) setBackendError(null);
    } catch (error) {
      if (request === requestRef.current) {
        setBackendError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [aiModelService]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const selectedConnectionState = useMemo(
    () => settings.hasKeys[provider] ?? false,
    [provider, settings.hasKeys]
  );
  const selectedApiKeyState = useMemo(
    () =>
      isOpenAICompatibleProvider(provider)
        ? !!settings.compatibleProviders[provider]?.hasKey
        : (settings.hasKeys[provider] ?? false),
    [provider, settings.compatibleProviders, settings.hasKeys]
  );
  const localTextModels = useMemo(
    () =>
      settings.meetings.localModels
        .filter(model => model.type === 'text' && isReleasedLocalModel(model))
        .sort((a, b) => {
          const tierOrder = { small: 0, medium: 1, large: 2 };
          return tierOrder[a.tier ?? 'large'] - tierOrder[b.tier ?? 'large'];
        }),
    [settings.meetings.localModels]
  );
  const embeddingModels = useMemo(
    () =>
      settings.meetings.localModels
        .filter(
          model => model.type === 'embedding' && isReleasedLocalModel(model)
        )
        .sort((a, b) => a.sizeMb - b.sizeMb),
    [settings.meetings.localModels]
  );
  const selectedLocalModel = useMemo(
    () =>
      settings.meetings.localModels.find(
        item => item.type === 'text' && item.id === model
      ) ?? null,
    [settings.meetings.localModels, model]
  );
  const selectedLocalModelState = selectedLocalModel
    ? localTextModelSelectionState(selectedLocalModel)
    : null;
  const localTextModelSelectionInvalid =
    !embeddingOnly &&
    provider === 'local' &&
    !customLocalModel &&
    (provider !== settings.provider || model !== settings.model) &&
    (!selectedLocalModelState || !selectedLocalModelState.selectable);
  const localModelMenuLabel = customLocalModel
    ? 'Local endpoint'
    : selectedLocalModel
      ? localModelName(selectedLocalModel.id)
      : loading
        ? 'Loading models...'
        : 'No model selected';
  const selectedQualifiedModelId = `${provider}:${model}`;
  const availableChatModelLabel =
    (settings.models.optionalModels.find(
      item => item.id === selectedQualifiedModelId
    )?.name ??
      model) ||
    'Choose model';
  const providerCatalogModels = settings.models.optionalModels.filter(item => {
    const selection = parseQualifiedTextModel(item.id);
    return (
      selection?.provider === provider &&
      (provider !== 'local' ||
        !settings.meetings.localModels.some(
          local => local.type === 'text' && local.id === selection.modelId
        ))
    );
  });
  const selectedEmbeddingModel = useMemo(
    () => embeddingModels.find(item => item.id === embeddingModel) ?? null,
    [embeddingModel, embeddingModels]
  );
  const embeddingModelMenuLabel = selectedEmbeddingModel
    ? localModelName(selectedEmbeddingModel.id)
    : embeddingModel || 'Choose model';
  const onToggleAI = useCallback(
    (checked: boolean) => {
      featureFlagService.flags.enable_ai.set(checked);
    },
    [featureFlagService]
  );

  const onProviderChange = useCallback(
    (nextProvider: ProviderName) => {
      if (controlsDisabled || saveRef.current) return;
      setProvider(nextProvider);
      const nextModel = isOpenAICompatibleProvider(nextProvider)
        ? compatibleProviderDrafts[nextProvider].model
        : textModelForProvider(settings, nextProvider);
      setModel(nextModel);
      setCustomLocalModel(
        nextProvider === 'local' &&
          !!nextModel &&
          !settings.meetings.localModels.some(
            item => item.type === 'text' && item.id === nextModel
          )
      );
    },
    [compatibleProviderDrafts, controlsDisabled, settings]
  );

  const onImageProviderChange = useCallback(
    (nextProvider: ImageProviderName) => {
      if (controlsDisabled || saveRef.current) return;
      setImageProvider(nextProvider);
      setImageModel(settings[imageModelFieldForProvider(nextProvider)]);
    },
    [controlsDisabled, settings]
  );

  const onUseLocalTextModel = useCallback(
    (modelId: string) => {
      if (controlsDisabled || saveRef.current) return;
      const localModel = localTextModels.find(item => item.id === modelId);
      if (!localModel || !localTextModelSelectionState(localModel).selectable) {
        return;
      }
      setProvider('local');
      setModel(modelId);
      setCustomLocalModel(false);
    },
    [controlsDisabled, localTextModels]
  );

  const onUseAvailableChatModel = useCallback(
    (qualifiedModelId: string) => {
      if (controlsDisabled || saveRef.current) return;
      const catalogModel = settings.models.optionalModels.find(
        item => item.id === qualifiedModelId
      );
      if (!catalogModel || catalogModel.selectable === false) {
        return;
      }
      const selection = parseQualifiedTextModel(qualifiedModelId);
      if (!selection) {
        return;
      }
      const localModel =
        selection.provider === 'local'
          ? settings.meetings.localModels.find(
              item => item.type === 'text' && item.id === selection.modelId
            )
          : undefined;
      if (localModel && !localTextModelSelectionState(localModel).selectable) {
        return;
      }
      setProvider(selection.provider);
      setModel(selection.modelId);
      if (isOpenAICompatibleProvider(selection.provider)) {
        const compatibleProvider = selection.provider;
        setCompatibleProviderDrafts(current => ({
          ...current,
          [compatibleProvider]: {
            ...current[compatibleProvider],
            model: selection.modelId,
          },
        }));
      }
      setCustomLocalModel(
        selection.provider === 'local' &&
          !settings.meetings.localModels.some(
            item => item.type === 'text' && item.id === selection.modelId
          )
      );
    },
    [
      controlsDisabled,
      settings.meetings.localModels,
      settings.models.optionalModels,
    ]
  );

  const onUseEmbeddingModel = useCallback(
    (modelId: string) => {
      if (controlsDisabled || saveRef.current) return;
      const candidate = embeddingModels.find(item => item.id === modelId);
      if (candidate && localTextModelSelectionState(candidate).selectable) {
        setEmbeddingModel(modelId);
      }
    },
    [controlsDisabled, embeddingModels]
  );

  const onApiKeyDraftChange = useCallback(
    (item: DirectApiProviderName, value: string) => {
      setApiKeyDrafts(current => ({
        ...current,
        [item]: value,
      }));
    },
    []
  );

  const onCompatibleProviderDraftChange = useCallback(
    (
      item: OpenAICompatibleProviderName,
      field: keyof CompatibleProviderDraft,
      value: string
    ) => {
      setCompatibleProviderDrafts(current => ({
        ...current,
        [item]: {
          ...current[item],
          [field]: value,
        },
      }));
      if (item === provider && field === 'model') {
        setModel(value);
      }
    },
    [provider]
  );

  const onTextModelChange = useCallback(
    (value: string) => {
      setModel(value);
      if (isOpenAICompatibleProvider(provider)) {
        onCompatibleProviderDraftChange(provider, 'model', value);
      }
    },
    [onCompatibleProviderDraftChange, provider]
  );

  const refreshModelHealth = useCallback(async (signal?: AbortSignal) => {
    const request = ++healthRequestRef.current;
    try {
      const response = await fetch('/v1/local/models', { signal });
      if (!response.ok) {
        throw new Error(`Model status returned HTTP ${response.status}`);
      }
      const health = (await response.json()) as {
        device: AIBackendSettings['meetings']['device'];
        models: LocalModelSettings[];
      };
      if (!Array.isArray(health.models)) {
        throw new Error('Model status response was incomplete.');
      }
      if (signal?.aborted || request !== healthRequestRef.current) return;
      // Health updates must never replace unsaved provider, key, or tool drafts.
      setSettings(current => ({
        ...current,
        meetings: {
          ...current.meetings,
          device: health.device,
          localModels: health.models,
        },
      }));
      setHealthError(null);
    } catch (error) {
      if (signal?.aborted || request !== healthRequestRef.current) return;
      setHealthError(error instanceof Error ? error.message : String(error));
    }
  }, []);
  const hasActiveDownload = settings.meetings.localModels.some(
    item =>
      item.downloadStatus === 'queued' || item.downloadStatus === 'downloading'
  );
  useEffect(() => {
    let refreshCatalog = false;
    for (const item of settings.meetings.localModels) {
      if (item.type !== 'text') continue;
      if (
        item.downloadStatus === 'queued' ||
        item.downloadStatus === 'downloading'
      ) {
        pendingTextDownloadsRef.current.add(item.id);
      } else if (
        pendingTextDownloadsRef.current.delete(item.id) &&
        item.downloadStatus === 'downloaded'
      ) {
        refreshCatalog = true;
      }
    }
    if (refreshCatalog) {
      aiModelService.refreshModels().catch((error: unknown) => {
        console.error('Failed to refresh the chat model catalog', error);
      });
    }
  }, [aiModelService, settings.meetings.localModels]);
  useEffect(() => {
    if (!hasActiveDownload || loading) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polling = false;
    const poll = async () => {
      if (polling || controller.signal.aborted) return;
      polling = true;
      clearTimeout(timer);
      try {
        await refreshModelHealth(controller.signal);
      } finally {
        polling = false;
        if (!controller.signal.aborted) {
          timer = setTimeout(() => {
            poll().catch(console.error);
          }, 2000);
        }
      }
    };
    const refreshWhenActive = () => {
      if (document.visibilityState === 'hidden') return;
      // Electron may delay the polling timer while the window is backgrounded.
      poll().catch(console.error);
    };
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    timer = setTimeout(() => {
      poll().catch(console.error);
    }, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [hasActiveDownload, loading, refreshModelHealth]);

  const onDownloadModel = useCallback(
    async (modelId: string) => {
      const candidate = settings.meetings.localModels.find(
        item => item.id === modelId
      );
      if (
        modelActionRef.current ||
        saveRef.current ||
        controlsDisabled ||
        !candidate ||
        !canDownloadLocalModel(candidate)
      )
        return;
      modelActionRef.current = true;
      setDownloadingModelId(modelId);
      setModelActionError(null);
      try {
        const response = await fetch(
          `/v1/local/models/${encodeURIComponent(modelId)}/download`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          }
        );
        const body = await response.json().catch(() => null);
        const feedback = localModelDownloadFeedback(response.status, body);
        if (!feedback.accepted) throw new Error(feedback.message);
        if (
          body?.download?.status === 'queued' ||
          body?.download?.status === 'downloading'
        ) {
          setSettings(current => ({
            ...current,
            meetings: {
              ...current.meetings,
              localModels: current.meetings.localModels.map(item =>
                item.id === modelId
                  ? { ...item, downloadStatus: body.download.status }
                  : item
              ),
            },
          }));
          if (candidate.type === 'text')
            pendingTextDownloadsRef.current.add(modelId);
        }
        await refreshModelHealth();
        notify.success({ title: feedback.message });
      } catch (error) {
        setModelActionError(
          error instanceof Error ? error.message : String(error)
        );
        notify.error({
          title: error instanceof Error ? error.message : String(error),
        });
      } finally {
        modelActionRef.current = false;
        setDownloadingModelId(null);
      }
    },
    [controlsDisabled, settings.meetings.localModels, refreshModelHealth]
  );

  const onProbeModel = useCallback(
    async (modelId: string) => {
      const candidate = settings.meetings.localModels.find(
        item => item.id === modelId
      );
      if (
        modelActionRef.current ||
        saveRef.current ||
        controlsDisabled ||
        !candidate ||
        !isReleasedLocalModel(candidate) ||
        candidate.downloadStatus !== 'downloaded'
      )
        return;
      modelActionRef.current = true;
      setProbingModelId(modelId);
      setModelActionError(null);
      try {
        const response = await fetch(
          `/v1/local/models/${encodeURIComponent(modelId)}/probe`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          }
        );
        const result = (await response.json()) as {
          error?: string;
          probe?: LocalModelSettings['runtimeProbe'];
        };
        if (result.probe) {
          setSettings(current => ({
            ...current,
            meetings: {
              ...current.meetings,
              localModels: current.meetings.localModels.map(item =>
                item.id === modelId
                  ? { ...item, runtimeProbe: result.probe }
                  : item
              ),
            },
          }));
        }
        await refreshModelHealth();
        if (
          !response.ok ||
          result.probe?.status !== 'available' ||
          !result.probe.canLoad ||
          !result.probe.runtimeAvailable
        ) {
          throw new Error(
            result.probe?.message ??
              result.error ??
              `Model check failed (HTTP ${response.status}).`
          );
        }
        notify.success({
          title: 'Model check passed',
          message: result.probe?.message,
        });
      } catch (error) {
        setModelActionError(
          error instanceof Error ? error.message : String(error)
        );
        notify.error({
          title: error instanceof Error ? error.message : String(error),
        });
      } finally {
        modelActionRef.current = false;
        setProbingModelId(null);
      }
    },
    [controlsDisabled, settings.meetings.localModels, refreshModelHealth]
  );

  const onSave = useCallback(async () => {
    if (saveRef.current || controlsDisabled || modelActionRef.current) return;
    saveRef.current = true;
    setSaving(true);
    setModelActionError(null);
    try {
      if (localTextModelSelectionInvalid) {
        throw new Error(
          selectedLocalModelState?.reason ??
            'Download and select an available local model before saving.'
        );
      }
      if (!embeddingOnly && !model.trim()) {
        throw new Error('Enter a model ID before saving.');
      }
      if (
        !embeddingOnly &&
        customLocalModel &&
        settings.meetings.localModels.some(
          item => item.type === 'text' && item.id === model
        )
      ) {
        throw new Error(
          'This model ID belongs to a managed local model. Select it from Chat model instead.'
        );
      }
      const imageModelField = imageModelFieldForProvider(imageProvider);
      const apiKeyUpdates = (
        Object.keys(apiKeyDrafts) as DirectApiProviderName[]
      )
        .filter(item => apiKeyDrafts[item].trim())
        .reduce<Record<string, string>>((updates, item) => {
          updates[apiKeyFieldForProvider(item)] = apiKeyDrafts[item].trim();
          return updates;
        }, {});
      const textSelectionChanged =
        provider !== settings.provider || model !== settings.model;
      const textModelUpdate = isOpenAICompatibleProvider(provider)
        ? {
            compatibleProviders: {
              [provider]: {
                apiKey: compatibleProviderDrafts[provider].apiKey.trim()
                  ? compatibleProviderDrafts[provider].apiKey.trim()
                  : undefined,
                baseUrl: compatibleProviderDrafts[provider].baseUrl.trim(),
                model: model.trim(),
              },
            },
          }
        : textSelectionChanged
          ? { [modelFieldForProvider(provider)]: model }
          : {};
      const response = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(embeddingOnly
            ? {}
            : {
                ...(textSelectionChanged
                  ? {
                      defaultProvider: provider,
                      defaultModel: model,
                    }
                  : {}),
                ...textModelUpdate,
                ...apiKeyUpdates,
                localBaseUrl,
              }),
          ...(!embeddingOnly
            ? {
                imageProvider,
                [imageModelField]: imageModel,
                webCrawlToolEnabled,
                shellToolEnabled,
                toolMaxSteps: Number(toolMaxSteps),
                mcpEnabled,
                mcpConfig,
              }
            : {}),
          toolsEnabled,
          embeddingAllowRemote,
          embeddingMode,
          embeddingModel,
          workspaceSearchToolEnabled,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error || `AI backend returned HTTP ${response.status}`
        );
      }
      await load();
      notify.success({ title: 'AI settings saved' });
    } catch (error) {
      setModelActionError(
        error instanceof Error ? error.message : String(error)
      );
      notify.error({
        title: error instanceof Error ? error.message : String(error),
      });
    } finally {
      saveRef.current = false;
      setSaving(false);
    }
  }, [
    apiKeyDrafts,
    compatibleProviderDrafts,
    controlsDisabled,
    customLocalModel,
    load,
    embeddingOnly,
    embeddingAllowRemote,
    embeddingMode,
    embeddingModel,
    imageModel,
    imageProvider,
    localBaseUrl,
    localTextModelSelectionInvalid,
    mcpConfig,
    mcpEnabled,
    model,
    provider,
    selectedLocalModelState?.reason,
    settings.meetings.localModels,
    settings.model,
    settings.provider,
    shellToolEnabled,
    toolMaxSteps,
    toolsEnabled,
    webCrawlToolEnabled,
    workspaceSearchToolEnabled,
  ]);

  const embeddingStatus =
    !toolsEnabled || !workspaceSearchToolEnabled
      ? 'Disabled'
      : embeddingMode === 'fallback'
        ? 'Fallback only'
        : selectedEmbeddingModel
          ? localModelStatusLabel(selectedEmbeddingModel, true)
          : 'Not verified';
  const embeddingStatusDescription =
    embeddingMode === 'fallback'
      ? 'Semantic embeddings disabled.'
      : (selectedEmbeddingModel?.deviceFitReason ??
        selectedEmbeddingModel?.runtimeProbe?.message);

  const saveSettings = (
    <div className={styles.saveBar}>
      {modelActionError || healthError ? (
        <div role="alert" className={styles.error}>
          {modelActionError ?? healthError}
        </div>
      ) : null}
      <div className={styles.actions}>
        <IconButton
          icon={<ResetIcon />}
          tooltip="Refresh model status"
          aria-label="Refresh model status"
          onClick={() => {
            if (backendError) load().catch(console.error);
            else refreshModelHealth().catch(console.error);
          }}
          disabled={loading || saving}
        />
        <Button
          variant="primary"
          onClick={() => {
            onSave().catch(console.error);
          }}
          disabled={
            loading ||
            saving ||
            downloadingModelId !== null ||
            probingModelId !== null ||
            !!backendError ||
            localTextModelSelectionInvalid
          }
          loading={saving}
        >
          Save changes
        </Button>
      </div>
    </div>
  );

  const embeddingSettings = (
    <SettingsSection title="Workspace search">
      <SettingRow name="Enable AI tools">
        <Switch
          checked={toolsEnabled}
          aria-label="Enable AI tools"
          disabled={controlsDisabled}
          onChange={setToolsEnabled}
        />
      </SettingRow>
      <SettingRow name="Workspace search">
        <Switch
          checked={workspaceSearchToolEnabled}
          aria-label="Workspace search"
          disabled={controlsDisabled || !toolsEnabled}
          onChange={setWorkspaceSearchToolEnabled}
        />
      </SettingRow>
      <SettingRow
        name="Search mode"
        desc={embeddingModeDescriptions[embeddingMode]}
      >
        <Menu
          contentOptions={{ align: 'end', className: styles.menuContent }}
          items={(['auto', 'fallback', 'semantic'] as const).map(item => (
            <MenuItem
              key={item}
              selected={item === embeddingMode}
              onSelect={() => {
                if (!controlsDisabled && !saveRef.current)
                  setEmbeddingMode(item);
              }}
            >
              {embeddingModeLabels[item]}
            </MenuItem>
          ))}
        >
          <MenuTrigger
            aria-label="Search mode"
            disabled={controlsDisabled}
            className={styles.menuTrigger}
          >
            {embeddingModeLabels[embeddingMode]}
          </MenuTrigger>
        </Menu>
      </SettingRow>
      <SettingRow
        name="Embedding model"
        desc="Small local semantic model for workspace search. Download it once for offline use."
      >
        {embeddingModels.length ? (
          <Menu
            contentOptions={{ align: 'end', className: styles.menuContent }}
            items={embeddingModels.map(item => (
              <MenuItem
                key={item.id}
                selected={item.id === embeddingModel}
                disabled={!localTextModelSelectionState(item).selectable}
                aria-disabled={!localTextModelSelectionState(item).selectable}
                onSelect={() => onUseEmbeddingModel(item.id)}
              >
                {localModelName(item.id)}
              </MenuItem>
            ))}
          >
            <MenuTrigger
              aria-label="Embedding model"
              disabled={controlsDisabled}
              className={styles.menuTrigger}
            >
              {embeddingModelMenuLabel}
            </MenuTrigger>
          </Menu>
        ) : (
          <Input
            className={styles.rowControl}
            value={embeddingModel}
            aria-label="Embedding model"
            disabled={
              controlsDisabled || !toolsEnabled || !workspaceSearchToolEnabled
            }
            onChange={setEmbeddingModel}
          />
        )}
      </SettingRow>
      <SettingRow name="Embedding status" desc={embeddingStatusDescription}>
        <span
          aria-live="polite"
          role="status"
          className={clsx(styles.status, {
            [styles.mutedStatus]:
              embeddingMode === 'fallback' || !workspaceSearchToolEnabled,
          })}
        >
          {embeddingStatus}
        </span>
      </SettingRow>
      <SettingRow
        name="Automatic model downloads"
        desc="Allow network downloads when an embedding model is missing."
      >
        <Switch
          checked={embeddingAllowRemote}
          aria-label="Automatic model downloads"
          disabled={
            controlsDisabled ||
            !toolsEnabled ||
            !workspaceSearchToolEnabled ||
            embeddingMode === 'fallback'
          }
          onChange={setEmbeddingAllowRemote}
        />
      </SettingRow>
    </SettingsSection>
  );

  const embeddingModelDownloads = embeddingModels.length ? (
    <SettingsSection title="Local embedding model">
      <LocalModelList
        models={embeddingModels}
        selectedModelId={embeddingModel}
        disabled={
          controlsDisabled ||
          downloadingModelId !== null ||
          probingModelId !== null
        }
        downloadingModelId={downloadingModelId}
        probingModelId={probingModelId}
        onSelect={onUseEmbeddingModel}
        onDownload={id => {
          onDownloadModel(id).catch(console.error);
        }}
        onProbe={id => {
          onProbeModel(id).catch(console.error);
        }}
      />
    </SettingsSection>
  ) : null;

  if (embeddingOnly) {
    return (
      <div className={styles.panel}>
        <SettingHeader
          title="Embeddings"
          subtitle="Control local semantic workspace search without adding another always-on model."
          data-testid="embedding-settings-title"
        />
        {backendError ? (
          <div role="alert" className={styles.error}>
            {backendError}
          </div>
        ) : null}
        {embeddingSettings}
        {embeddingModelDownloads}
        {saveSettings}
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <SettingHeader title="AI & Models" data-testid="ai-settings-title" />
      <SettingsSection>
        <SettingRow name="AI in Nota">
          <Switch
            checked={!!enableAI}
            aria-label="AI in Nota"
            disabled={!serverFeatures?.copilot}
            onChange={onToggleAI}
          />
        </SettingRow>
        <SettingRow
          name="Backend"
          desc={backendError ? backendError : undefined}
        >
          <span
            aria-live="polite"
            role="status"
            className={clsx(styles.status, {
              [styles.mutedStatus]: backendError || loading,
            })}
          >
            {loading ? 'Checking' : backendError ? 'Offline' : 'Online'}
          </span>
        </SettingRow>
      </SettingsSection>

      <Tabs.Root defaultValue="models">
        <Tabs.List aria-label="AI settings sections">
          <Tabs.Trigger value="models">Models</Tabs.Trigger>
          <Tabs.Trigger value="search">Search</Tabs.Trigger>
          <Tabs.Trigger value="advanced">Advanced</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="models" className={styles.tabContent}>
          <SettingsSection title="Chat model">
            <SettingRow
              name="Provider"
              desc={
                provider === 'local'
                  ? 'On-device'
                  : provider === 'custom' && selectedConnectionState
                    ? 'A compatible endpoint is configured.'
                    : selectedApiKeyState
                      ? 'A saved key is available for this provider.'
                      : isOpenAICompatibleProvider(provider)
                        ? 'Add an API key and confirm the base URL to use this provider.'
                        : 'Add an API key to use this provider.'
              }
            >
              <Menu
                contentOptions={{ align: 'end', className: styles.menuContent }}
                items={settings.providers.map(item => (
                  <MenuItem
                    key={item}
                    selected={item === provider}
                    onSelect={() => onProviderChange(item)}
                  >
                    {providerLabels[item]}
                  </MenuItem>
                ))}
              >
                <MenuTrigger
                  aria-label="Provider"
                  disabled={controlsDisabled}
                  className={styles.menuTrigger}
                >
                  {providerLabels[provider]}
                </MenuTrigger>
              </Menu>
            </SettingRow>

            {(provider !== 'local' || customLocalModel) &&
            providerCatalogModels.length ? (
              <SettingRow
                name="Configured models"
                desc="Configuration does not verify access or successful generation."
              >
                <Menu
                  contentOptions={{
                    align: 'end',
                    className: styles.menuContent,
                  }}
                  items={providerCatalogModels.map(item => (
                    <MenuItem
                      disabled={item.selectable === false}
                      aria-disabled={item.selectable === false}
                      key={item.id}
                      selected={item.id === selectedQualifiedModelId}
                      onSelect={() => onUseAvailableChatModel(item.id)}
                    >
                      {item.name}
                      {item.selectable === false ? ' - Unavailable' : null}
                    </MenuItem>
                  ))}
                >
                  <MenuTrigger
                    aria-label="Configured models"
                    disabled={controlsDisabled}
                    className={styles.menuTrigger}
                  >
                    {availableChatModelLabel}
                  </MenuTrigger>
                </Menu>
              </SettingRow>
            ) : null}

            {provider === 'local' ? (
              <>
                <SettingRow
                  name="Model"
                  desc={
                    customLocalModel
                      ? 'OpenAI-compatible local endpoint'
                      : selectedLocalModel
                        ? localModelStatusLabel(selectedLocalModel, false)
                        : 'No local model selected'
                  }
                >
                  <Menu
                    contentOptions={{
                      align: 'end',
                      className: styles.menuContent,
                    }}
                    items={[
                      ...localTextModels.map(localModelItem => {
                        const selectionState =
                          localTextModelSelectionState(localModelItem);
                        return (
                          <MenuItem
                            disabled={!selectionState.selectable}
                            aria-disabled={!selectionState.selectable}
                            key={localModelItem.id}
                            selected={
                              !customLocalModel && localModelItem.id === model
                            }
                            onSelect={() =>
                              onUseLocalTextModel(localModelItem.id)
                            }
                          >
                            {localModelName(localModelItem.id)} -{' '}
                            {localModelStatusLabel(localModelItem, false)}
                          </MenuItem>
                        );
                      }),
                      <MenuItem
                        key="custom-local-model"
                        selected={customLocalModel}
                        onSelect={() => {
                          if (controlsDisabled || saveRef.current) return;
                          if (!customLocalModel) setModel('');
                          setCustomLocalModel(true);
                        }}
                      >
                        Local endpoint
                      </MenuItem>,
                    ]}
                  >
                    <MenuTrigger
                      aria-label="Chat model"
                      disabled={controlsDisabled}
                      className={styles.menuTrigger}
                    >
                      {localModelMenuLabel}
                    </MenuTrigger>
                  </Menu>
                </SettingRow>
                {!customLocalModel && selectedLocalModelState?.reason ? (
                  <div className={styles.notice} role="status">
                    {selectedLocalModelState.reason}
                  </div>
                ) : null}
                {customLocalModel ? (
                  <>
                    <SettingRow name="Model ID">
                      <Input
                        className={styles.rowControl}
                        value={model}
                        aria-label="Model ID"
                        disabled={controlsDisabled}
                        onChange={setModel}
                      />
                    </SettingRow>
                    <SettingRow name="Local endpoint">
                      <Input
                        className={styles.rowControl}
                        value={localBaseUrl}
                        aria-label="Local endpoint"
                        disabled={controlsDisabled}
                        onChange={setLocalBaseUrl}
                      />
                    </SettingRow>
                  </>
                ) : null}
              </>
            ) : isOpenAICompatibleProvider(provider) ? (
              <>
                <SettingRow
                  name={`${providerLabels[provider]} API key`}
                  desc={
                    provider === 'custom'
                      ? 'Optional for local or private compatible endpoints. Saved locally and hidden after save.'
                      : 'Saved locally in .nota/ai-settings.json and never returned by GET settings.'
                  }
                >
                  <Input
                    className={styles.rowControl}
                    type="password"
                    aria-label={`${providerLabels[provider]} API key`}
                    value={compatibleProviderDrafts[provider].apiKey}
                    placeholder={
                      selectedApiKeyState
                        ? 'Saved'
                        : provider === 'custom'
                          ? 'Optional'
                          : 'Paste API key'
                    }
                    disabled={controlsDisabled}
                    autoComplete="off"
                    onChange={value =>
                      onCompatibleProviderDraftChange(provider, 'apiKey', value)
                    }
                  />
                </SettingRow>
                <SettingRow
                  name="Base URL"
                  desc="OpenAI-compatible API root. Presets can be edited when a provider uses a proxy or self-hosted gateway."
                >
                  <Input
                    className={styles.rowControl}
                    value={compatibleProviderDrafts[provider].baseUrl}
                    aria-label="Base URL"
                    disabled={controlsDisabled}
                    onChange={value =>
                      onCompatibleProviderDraftChange(
                        provider,
                        'baseUrl',
                        value
                      )
                    }
                  />
                </SettingRow>
                <SettingRow name="Model">
                  <Input
                    className={styles.rowControl}
                    value={model}
                    aria-label="Model ID"
                    disabled={controlsDisabled}
                    onChange={onTextModelChange}
                  />
                </SettingRow>
              </>
            ) : (
              <>
                <SettingRow
                  name={`${directApiProviderLabels[provider]} API key`}
                  desc="Saved locally in .nota/ai-settings.json and never returned by GET settings."
                >
                  <Input
                    className={styles.rowControl}
                    type="password"
                    aria-label={`${directApiProviderLabels[provider]} API key`}
                    value={apiKeyDrafts[provider]}
                    placeholder={
                      selectedApiKeyState ? 'Saved' : 'Paste API key'
                    }
                    disabled={controlsDisabled}
                    autoComplete="off"
                    onChange={value => onApiKeyDraftChange(provider, value)}
                  />
                </SettingRow>
                <SettingRow name="Model">
                  <Input
                    className={styles.rowControl}
                    value={model}
                    aria-label="Model ID"
                    disabled={controlsDisabled}
                    onChange={onTextModelChange}
                  />
                </SettingRow>
              </>
            )}
          </SettingsSection>

          <SettingsSection title="Local model library">
            {settings.meetings.device ? (
              <div className={styles.device}>
                {settings.meetings.device.platform} /{' '}
                {settings.meetings.device.arch}
                {' / '}
                {settings.meetings.device.availableRamGb.toFixed(1)} GB RAM
                available
              </div>
            ) : null}
            <LocalModelList
              models={localTextModels}
              selectedModelId={
                provider === 'local' && !customLocalModel ? model : null
              }
              disabled={
                controlsDisabled ||
                downloadingModelId !== null ||
                probingModelId !== null
              }
              downloadingModelId={downloadingModelId}
              probingModelId={probingModelId}
              onSelect={onUseLocalTextModel}
              onDownload={id => {
                onDownloadModel(id).catch(console.error);
              }}
              onProbe={id => {
                onProbeModel(id).catch(console.error);
              }}
            />
          </SettingsSection>
        </Tabs.Content>
        <Tabs.Content value="search" className={styles.tabContent}>
          {embeddingSettings}
          {embeddingModelDownloads}
        </Tabs.Content>
        <Tabs.Content value="advanced" className={styles.tabContent}>
          <SettingsSection title="Image Generation">
            <SettingRow
              name="Image provider"
              desc={
                imageProvider === 'local'
                  ? 'Uses the local image endpoint configured in the AI backend.'
                  : imageProvider === 'openai'
                    ? 'Uses the saved OpenAI API key.'
                    : 'Uses the saved Google API key.'
              }
            >
              <Menu
                contentOptions={{ align: 'end', className: styles.menuContent }}
                items={(['local', 'openai', 'google'] as const).map(item => (
                  <MenuItem
                    key={item}
                    selected={item === imageProvider}
                    onSelect={() => onImageProviderChange(item)}
                  >
                    {imageProviderLabels[item]}
                  </MenuItem>
                ))}
              >
                <MenuTrigger
                  aria-label="Image provider"
                  disabled={controlsDisabled}
                  className={styles.menuTrigger}
                >
                  {imageProviderLabels[imageProvider]}
                </MenuTrigger>
              </Menu>
            </SettingRow>
            <SettingRow name="Image model">
              <Input
                className={styles.rowControl}
                value={imageModel}
                aria-label="Image model"
                disabled={controlsDisabled}
                onChange={setImageModel}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="Tools">
            <SettingRow name="Enable tools">
              <Switch
                checked={toolsEnabled}
                aria-label="Enable tools"
                disabled={controlsDisabled}
                onChange={setToolsEnabled}
              />
            </SettingRow>
            <SettingRow
              name="Web crawl"
              desc="Fetches one public http or https page and returns readable text."
            >
              <Switch
                checked={webCrawlToolEnabled}
                aria-label="Web crawl"
                disabled={controlsDisabled || !toolsEnabled}
                onChange={setWebCrawlToolEnabled}
              />
            </SettingRow>
            <SettingRow
              name="Restricted shell"
              desc="Read-only commands inside the Nota workspace only. Disabled by default."
            >
              <Switch
                checked={shellToolEnabled}
                aria-label="Restricted shell"
                disabled={controlsDisabled || !toolsEnabled}
                onChange={setShellToolEnabled}
              />
            </SettingRow>
            <SettingRow
              name="Max tool steps"
              desc="Allows 1–50 tool rounds, followed by a final answer if the limit is reached."
            >
              <Input
                className={styles.rowControl}
                value={toolMaxSteps}
                aria-label="Max tool steps"
                type="number"
                min={1}
                max={50}
                disabled={controlsDisabled || !toolsEnabled}
                onChange={setToolMaxSteps}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="MCP">
            <SettingRow name="Enable MCP config">
              <Switch
                checked={mcpEnabled}
                aria-label="Enable MCP config"
                disabled={controlsDisabled || !toolsEnabled}
                onChange={setMcpEnabled}
              />
            </SettingRow>
            <SettingRow
              name="MCP config"
              desc="JSON config for local MCP servers. Annotated read tools are exposed directly; write tools stay approval-gated."
              spreadCol
            >
              <textarea
                className={styles.textarea}
                value={mcpConfig}
                aria-label="MCP config"
                disabled={controlsDisabled || !toolsEnabled || !mcpEnabled}
                spellCheck={false}
                onChange={event => setMcpConfig(event.currentTarget.value)}
              />
            </SettingRow>
            {settings.mcp.toolNames?.length ? (
              <SettingRow
                name="Loaded MCP tools"
                desc={settings.mcp.toolNames.slice(0, 8).join(', ')}
              >
                <div className={styles.capability}>
                  <span className={styles.dot} />
                  {settings.mcp.toolNames.length}
                </div>
              </SettingRow>
            ) : null}
            {settings.mcp.servers?.map(server => (
              <SettingRow
                key={server.name}
                name={server.name}
                desc={
                  server.error ||
                  `${server.transport} server, ${
                    server.toolNames.length
                  } read tools loaded${
                    server.blockedToolNames?.length
                      ? `, ${server.blockedToolNames.length} write tools blocked`
                      : ''
                  }`
                }
              >
                <div className={styles.capability}>
                  <span
                    className={clsx(styles.dot, {
                      [styles.pendingDot]: !!server.error,
                    })}
                  />
                  {server.error
                    ? 'Error'
                    : server.blockedToolNames?.length
                      ? 'Gated'
                      : 'Ready'}
                </div>
              </SettingRow>
            ))}
          </SettingsSection>
        </Tabs.Content>
      </Tabs.Root>
      {saveSettings}
    </div>
  );
};
