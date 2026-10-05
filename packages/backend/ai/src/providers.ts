import { statSync } from 'node:fs';
import path from 'node:path';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ImageModel, LanguageModel } from 'ai';

import {
  type AiBackendConfig,
  type ImageProviderName,
  isOpenAICompatibleProvider,
  mainTextModelForProvider,
  normalizeLocalTextModel,
  OPENAI_COMPATIBLE_PROVIDER_NAMES,
  type OpenAICompatibleProviderName,
  type ProviderName,
} from './config';
import { createLocalOnnxLanguageModel } from './local-onnx-language-model';
import {
  isLocalOnnxTextModel,
  modelRegistry,
  requiredFilesFor,
} from './model-registry';
import { type ReasoningLevel, reasoningLevelsForSelection } from './reasoning';

export type TextModelRuntime =
  | 'local-onnx'
  | 'hosted'
  | 'openai-compatible-local';

export interface ModelSelection {
  model: LanguageModel;
  modelId: string;
  provider: ProviderName;
  runtime: TextModelRuntime;
}

export interface ImageModelSelection {
  model: ImageModel;
  modelId: string;
  provider: ImageProviderName;
}

export type ModelReadiness = 'ready' | 'unavailable' | 'unverified';

export interface ModelCatalogEntry {
  id: string;
  name: string;
  readiness: ModelReadiness;
  readinessMessage: string | null;
  reasoningLevels: ReasoningLevel[];
  selectable: boolean;
  supportsImageAttachments: boolean;
}

export interface LocalModelCatalogHealth {
  deviceFit?: 'blocked' | 'fits' | 'low_disk' | 'low_ram' | 'planned';
  deviceFitReason?: string;
  downloadStatus?:
    | 'blocked'
    | 'downloaded'
    | 'downloading'
    | 'error'
    | 'missing_url'
    | 'not_started'
    | 'planned'
    | 'queued';
  id: string;
  releaseState?: 'blocked' | 'planned' | 'ready';
  runtimeProbe?: {
    canLoad: boolean;
    message: string;
    runtimeAvailable: boolean;
    status: string;
  };
  type: 'embedding' | 'stt' | 'text';
}

type DiscoverableProviderName = 'custom' | 'local';

interface EndpointDiscoveryState {
  available: boolean;
  expiresAt: number;
  models: string[];
  promise: Promise<void> | null;
}

export class AiModelRouter {
  private anthropicProvider!: ReturnType<typeof createAnthropic>;
  private googleProvider!: ReturnType<typeof createGoogleGenerativeAI>;
  private localProvider!: ReturnType<typeof createOpenAICompatible>;
  private openaiProvider!: ReturnType<typeof createOpenAI>;
  private compatibleProviders = new Map<
    OpenAICompatibleProviderName,
    ReturnType<typeof createOpenAICompatible>
  >();
  private discoveryGeneration = 0;
  private readonly endpointDiscovery = new Map<
    DiscoverableProviderName,
    EndpointDiscoveryState
  >();
  private localModelHealth = new Map<string, LocalModelCatalogHealth>();

  constructor(private readonly config: AiBackendConfig) {
    this.refresh();
  }

  refresh() {
    // Settings can replace an endpoint while an old discovery request is still
    // in flight. Invalidate both cached results and those pending writes so a
    // previous endpoint can never leak models into the refreshed catalog.
    this.discoveryGeneration += 1;
    this.endpointDiscovery.clear();
    this.openaiProvider = createOpenAI({
      apiKey: this.config.openaiApiKey || undefined,
    });
    this.anthropicProvider = createAnthropic({
      apiKey: this.config.anthropicApiKey || undefined,
    });
    this.googleProvider = createGoogleGenerativeAI({
      apiKey: this.config.googleApiKey || undefined,
    });
    this.localProvider = createOpenAICompatible({
      name: 'local',
      baseURL: this.config.localBaseUrl,
      apiKey: this.config.localApiKey,
      includeUsage: true,
    });
    this.compatibleProviders = new Map(
      OPENAI_COMPATIBLE_PROVIDER_NAMES.map(provider => {
        const providerConfig = this.config.compatibleProviders[provider];
        return [
          provider,
          createOpenAICompatible({
            name: provider,
            baseURL: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey || undefined,
            includeUsage: true,
          }),
        ];
      })
    );
  }

  select(requestedModelId?: string): ModelSelection {
    const normalizedModelId =
      requestedModelId?.trim() || this.models().defaultModel;
    if (!normalizedModelId) {
      const setup =
        this.config.defaultProvider === 'local'
          ? 'Download or check a local model, or configure a reachable local endpoint in AI Settings.'
          : 'Check the provider credentials, endpoint, and model in AI Settings.';
      throw new Error(
        `No AI text model is available for the configured provider: ${this.config.defaultProvider}. ${setup}`
      );
    }
    const qualified = this.qualifiedModel(normalizedModelId);
    const provider =
      qualified?.provider ?? this.resolveProvider(normalizedModelId);
    const selectedModelId =
      qualified?.modelId ||
      normalizedModelId ||
      this.modelForProvider(provider);
    const modelId =
      provider === 'local'
        ? normalizeLocalTextModel(selectedModelId)
        : selectedModelId;
    if (!modelId.trim()) {
      throw new Error(`No text model is configured for provider: ${provider}`);
    }
    this.assertModelSelectable(provider, modelId);

    if (isOpenAICompatibleProvider(provider)) {
      const compatibleProvider = this.compatibleProviders.get(provider);
      if (!compatibleProvider) {
        throw new Error(
          `OpenAI-compatible provider is not configured: ${provider}`
        );
      }
      return {
        provider,
        modelId,
        model: compatibleProvider(modelId),
        runtime: 'hosted',
      };
    }

    switch (provider) {
      case 'anthropic':
        return {
          provider,
          modelId,
          model: this.anthropicProvider(modelId),
          runtime: 'hosted',
        };
      case 'google':
        return {
          provider,
          modelId,
          model: this.googleProvider(modelId),
          runtime: 'hosted',
        };
      case 'openai':
        return {
          provider,
          modelId,
          model: this.openaiProvider(modelId),
          runtime: 'hosted',
        };
      case 'local':
        return {
          provider,
          modelId,
          model: isLocalOnnxTextModel(modelId)
            ? createLocalOnnxLanguageModel({
                config: this.config,
                modelId,
              })
            : this.localProvider(modelId),
          runtime: isLocalOnnxTextModel(modelId)
            ? 'local-onnx'
            : 'openai-compatible-local',
        };
    }
  }

  selectImage(requestedModelId?: string): ImageModelSelection {
    const provider = this.resolveImageProvider(requestedModelId);
    const modelId = requestedModelId || this.imageModelForProvider(provider);

    switch (provider) {
      case 'google':
        return { provider, modelId, model: this.googleProvider.image(modelId) };
      case 'openai':
        return { provider, modelId, model: this.openaiProvider.image(modelId) };
      case 'local':
        return {
          provider,
          modelId,
          model: this.localProvider.imageModel(modelId),
        };
    }
  }

  models(localModelHealth?: readonly LocalModelCatalogHealth[]) {
    if (localModelHealth) {
      this.localModelHealth = new Map(
        localModelHealth
          .filter(model => model.type === 'text')
          .map(model => [model.id, model])
      );
    }

    const models: ModelCatalogEntry[] = [];
    const addModel = (
      provider: ProviderName,
      modelId: string,
      providerLabel: string
    ) => {
      const normalizedModelId = modelId.trim();
      if (!normalizedModelId) return;
      const runtime = this.runtimeForModel(provider, normalizedModelId);
      const readiness =
        runtime === 'local-onnx'
          ? this.localOnnxReadiness(normalizedModelId)
          : {
              readiness: 'ready' as const,
              readinessMessage: null,
              selectable: true,
            };
      models.push({
        id: this.qualifyModel(provider, normalizedModelId),
        name: `${providerLabel} ${normalizedModelId}`,
        ...readiness,
        reasoningLevels: reasoningLevelsForSelection({
          modelId: normalizedModelId,
          provider,
          runtime,
        }),
        supportsImageAttachments: runtime !== 'local-onnx',
      });
    };

    if (this.config.openaiApiKey.trim()) {
      addModel('openai', this.config.openaiModel, 'OpenAI');
    }
    if (this.config.anthropicApiKey.trim()) {
      addModel('anthropic', this.config.anthropicModel, 'Anthropic');
    }
    if (this.config.googleApiKey.trim()) {
      addModel('google', this.config.googleModel, 'Google');
    }

    for (const provider of OPENAI_COMPATIBLE_PROVIDER_NAMES) {
      if (provider === 'custom') continue;
      const providerConfig = this.config.compatibleProviders[provider];
      if (!providerConfig.apiKey.trim() || !providerConfig.baseUrl.trim()) {
        continue;
      }
      addModel(provider, providerConfig.model, this.providerName(provider));
    }

    for (const provider of ['local', 'custom'] as const) {
      const discovery = this.endpointDiscovery.get(provider);
      if (!discovery?.available) continue;
      const configuredModel =
        provider === 'local'
          ? this.config.localModel
          : this.config.compatibleProviders.custom.model;
      addModel(
        provider,
        configuredModel,
        this.providerNameForCatalog(provider)
      );
      for (const modelId of discovery.models) {
        addModel(provider, modelId, this.providerNameForCatalog(provider));
      }
    }

    for (const model of modelRegistry) {
      if (model.type === 'text' && this.localOnnxModelInstalled(model.id)) {
        addModel('local', model.id, 'Local');
      }
    }

    const uniqueModels = models.filter(
      (model, index, all) =>
        all.findIndex(candidate => candidate.id === model.id) === index
    );
    const configuredDefaultModel = mainTextModelForProvider(this.config).trim();
    const configuredDefaultId = configuredDefaultModel
      ? this.qualifyModel(this.config.defaultProvider, configuredDefaultModel)
      : null;
    const configuredDefaultAvailable = configuredDefaultModel
      ? this.configuredModelAvailable(
          this.config.defaultProvider,
          configuredDefaultModel
        )
      : false;
    const configuredDefaultEntry = configuredDefaultId
      ? uniqueModels.find(model => model.id === configuredDefaultId)
      : undefined;
    // Saved credentials expose optional models, not permission to switch providers.
    const defaultModel =
      (configuredDefaultId &&
      (configuredDefaultEntry?.selectable === true ||
        (!configuredDefaultEntry && configuredDefaultAvailable !== false))
        ? configuredDefaultId
        : uniqueModels.find(
            model =>
              model.selectable &&
              this.qualifiedModel(model.id)?.provider ===
                this.config.defaultProvider
          )?.id) ?? '';

    return {
      defaultModel,
      optionalModels: uniqueModels,
      proModels: [],
    };
  }

  private configuredModelAvailable(
    provider: ProviderName,
    modelId: string
  ): boolean | undefined {
    if (!modelId.trim()) return false;
    switch (provider) {
      case 'openai':
        return !!this.config.openaiApiKey.trim();
      case 'anthropic':
        return !!this.config.anthropicApiKey.trim();
      case 'google':
        return !!this.config.googleApiKey.trim();
      case 'local':
        return isLocalOnnxTextModel(modelId)
          ? this.localOnnxModelInstalled(modelId) &&
              this.localOnnxReadiness(modelId).selectable
          : this.endpointDiscovery.get('local')?.available;
      case 'custom':
        return this.endpointDiscovery.get('custom')?.available;
      case 'openrouter':
      case 'deepseek':
      case 'xai':
      case 'mistral':
      case 'groq':
      case 'perplexity': {
        const config = this.config.compatibleProviders[provider];
        return !!config.apiKey.trim() && !!config.baseUrl.trim();
      }
    }
  }

  async modelsWithDiscovery(
    localModelHealth?: readonly LocalModelCatalogHealth[]
  ) {
    await Promise.all([
      this.discoverEndpointModels('local'),
      this.discoverEndpointModels('custom'),
    ]);
    return this.models(localModelHealth);
  }

  private assertModelSelectable(provider: ProviderName, modelId: string) {
    if (provider !== 'local' || !isLocalOnnxTextModel(modelId)) {
      return;
    }
    const readiness = this.localOnnxReadiness(modelId);
    if (!readiness.selectable) {
      throw new Error(
        readiness.readinessMessage ||
          `Local ONNX model ${modelId} is not ready to run.`
      );
    }
  }

  private localOnnxReadiness(
    modelId: string
  ): Pick<ModelCatalogEntry, 'readiness' | 'readinessMessage' | 'selectable'> {
    const health = this.localModelHealth.get(modelId);
    if (!health) {
      return {
        readiness: 'unverified',
        readinessMessage:
          'Downloaded locally; run the model check to verify this device.',
        selectable: true,
      };
    }

    const unavailable = (message: string) => ({
      readiness: 'unavailable' as const,
      readinessMessage: message,
      selectable: false,
    });
    if (
      health.releaseState === 'blocked' ||
      health.deviceFit === 'blocked' ||
      health.downloadStatus === 'blocked'
    ) {
      return unavailable(
        health.deviceFitReason || 'This local model is blocked.'
      );
    }
    if (
      health.releaseState === 'planned' ||
      health.deviceFit === 'planned' ||
      health.downloadStatus === 'planned'
    ) {
      return unavailable(
        health.deviceFitReason || 'This local model is not release-ready yet.'
      );
    }
    if (health.deviceFit === 'low_ram' || health.deviceFit === 'low_disk') {
      return unavailable(
        health.deviceFitReason ||
          'This device does not currently meet the model requirements.'
      );
    }
    if (health.downloadStatus && health.downloadStatus !== 'downloaded') {
      return unavailable('Download this local model before using it in chat.');
    }

    const probe = health.runtimeProbe;
    if (!probe) {
      return {
        readiness: 'unverified',
        readinessMessage:
          'Downloaded locally; run the model check to verify this device.',
        selectable: true,
      };
    }
    if (
      probe.status !== 'available' ||
      !probe.runtimeAvailable ||
      !probe.canLoad
    ) {
      return unavailable(
        probe.message || 'The local ONNX runtime cannot load this model.'
      );
    }
    return {
      readiness: 'ready',
      readinessMessage: null,
      selectable: true,
    };
  }

  private runtimeForModel(
    provider: ProviderName,
    modelId: string
  ): TextModelRuntime {
    if (provider !== 'local') {
      return 'hosted';
    }
    return isLocalOnnxTextModel(modelId)
      ? 'local-onnx'
      : 'openai-compatible-local';
  }

  private async discoverEndpointModels(provider: DiscoverableProviderName) {
    const endpoint = this.endpointConfig(provider);
    if (!endpoint.baseUrl) {
      return;
    }

    const now = Date.now();
    const state = this.endpointDiscovery.get(provider) ?? {
      available: false,
      expiresAt: 0,
      models: [],
      promise: null,
    };
    this.endpointDiscovery.set(provider, state);
    if (now < state.expiresAt) {
      return;
    }
    if (state.promise) {
      return state.promise;
    }

    const generation = this.discoveryGeneration;
    const discovery = (async () => {
      let available = false;
      let discoveredModels: string[] = [];
      try {
        const baseUrl = endpoint.baseUrl.endsWith('/')
          ? endpoint.baseUrl
          : `${endpoint.baseUrl}/`;
        const response = await fetch(new URL('models', baseUrl), {
          headers: endpoint.apiKey
            ? { Authorization: `Bearer ${endpoint.apiKey}` }
            : undefined,
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          data?: Array<{ id?: unknown }>;
          models?: Array<{ id?: unknown; model?: unknown; name?: unknown }>;
        };
        const modelIds = [
          ...(payload.data ?? []).map(item => item.id),
          ...(payload.models ?? []).map(
            item => item.id ?? item.model ?? item.name
          ),
        ]
          .filter((id): id is string => typeof id === 'string' && !!id.trim())
          .map(id => id.trim());
        available = true;
        discoveredModels = [...new Set(modelIds)].sort();
      } catch {
        // Optional OpenAI-compatible endpoints are omitted when unavailable.
      } finally {
        if (generation === this.discoveryGeneration) {
          state.available = available;
          state.models = discoveredModels;
          state.expiresAt = Date.now() + 30_000;
          state.promise = null;
        }
      }
    })();
    state.promise = discovery;
    return discovery;
  }

  private endpointConfig(provider: DiscoverableProviderName) {
    if (provider === 'local') {
      return {
        apiKey: this.config.localApiKey.trim(),
        baseUrl: this.config.localBaseUrl.trim(),
      };
    }
    const custom = this.config.compatibleProviders.custom;
    return {
      apiKey: custom.apiKey.trim(),
      baseUrl: custom.baseUrl.trim(),
    };
  }

  private localOnnxModelInstalled(modelId: string) {
    const requiredFiles = requiredFilesFor(modelId);
    if (!requiredFiles.length) {
      return false;
    }
    const modelRoot = path.join(
      this.config.workspaceRoot,
      '.nota',
      'models',
      modelId
    );
    return requiredFiles.every(fileName => {
      try {
        return statSync(path.join(modelRoot, fileName)).isFile();
      } catch {
        return false;
      }
    });
  }

  private providerName(provider: OpenAICompatibleProviderName) {
    switch (provider) {
      case 'openrouter':
        return 'OpenRouter';
      case 'deepseek':
        return 'DeepSeek';
      case 'xai':
        return 'xAI';
      case 'mistral':
        return 'Mistral';
      case 'groq':
        return 'Groq';
      case 'perplexity':
        return 'Perplexity';
      case 'custom':
        return 'Custom';
    }
  }

  private providerNameForCatalog(provider: DiscoverableProviderName) {
    return provider === 'local' ? 'Local' : this.providerName(provider);
  }

  private qualifyModel(provider: ProviderName, modelId: string) {
    return `${provider}:${modelId}`;
  }

  private qualifiedModel(modelId?: string) {
    if (!modelId) {
      return null;
    }
    const separator = modelId.indexOf(':');
    if (separator <= 0 || separator === modelId.length - 1) {
      return null;
    }
    const provider = modelId.slice(0, separator);
    const qualifiedModelId = modelId.slice(separator + 1);
    if (
      provider === 'openai' ||
      provider === 'anthropic' ||
      provider === 'google' ||
      provider === 'local' ||
      isOpenAICompatibleProvider(provider)
    ) {
      return {
        modelId: qualifiedModelId,
        provider,
      } satisfies { modelId: string; provider: ProviderName };
    }
    return null;
  }

  private resolveProvider(modelId?: string): ProviderName {
    if (!modelId) return this.config.defaultProvider;
    if (modelId === this.modelForProvider(this.config.defaultProvider)) {
      return this.config.defaultProvider;
    }
    if (
      modelId === this.config.localModel ||
      isLocalOnnxTextModel(modelId) ||
      this.endpointDiscovery.get('local')?.models.includes(modelId)
    ) {
      return 'local';
    }
    if (this.endpointDiscovery.get('custom')?.models.includes(modelId)) {
      return 'custom';
    }
    const compatibleProvider = OPENAI_COMPATIBLE_PROVIDER_NAMES.find(
      provider => modelId === this.config.compatibleProviders[provider].model
    );
    if (compatibleProvider) {
      return compatibleProvider;
    }
    if (modelId === this.config.openaiModel || modelId.startsWith('gpt-')) {
      return 'openai';
    }
    if (
      modelId === this.config.anthropicModel ||
      modelId.startsWith('claude-')
    ) {
      return 'anthropic';
    }
    if (modelId === this.config.googleModel || modelId.startsWith('gemini-')) {
      return 'google';
    }
    if (modelId.startsWith('deepseek-')) {
      return 'deepseek';
    }
    if (modelId.startsWith('grok-')) {
      return 'xai';
    }
    if (
      modelId.startsWith('mistral-') ||
      modelId.startsWith('ministral-') ||
      modelId.includes('mixtral')
    ) {
      return 'mistral';
    }
    if (modelId.startsWith('sonar')) {
      return 'perplexity';
    }
    return 'local';
  }

  private resolveImageProvider(modelId?: string): ImageProviderName {
    if (!modelId) return this.config.imageProvider;
    if (
      modelId === this.config.openaiImageModel ||
      modelId.startsWith('gpt-image-') ||
      modelId.startsWith('dall-e-') ||
      modelId.startsWith('chatgpt-image-')
    ) {
      return 'openai';
    }
    if (
      modelId === this.config.googleImageModel ||
      modelId.startsWith('imagen-') ||
      modelId.startsWith('gemini-')
    ) {
      return 'google';
    }
    return 'local';
  }

  private modelForProvider(provider: ProviderName) {
    switch (provider) {
      case 'anthropic':
        return this.config.anthropicModel;
      case 'google':
        return this.config.googleModel;
      case 'openai':
        return this.config.openaiModel;
      case 'local':
        return this.config.localModel;
      case 'openrouter':
      case 'deepseek':
      case 'xai':
      case 'mistral':
      case 'groq':
      case 'perplexity':
      case 'custom':
        return this.config.compatibleProviders[provider].model;
    }
  }

  private imageModelForProvider(provider: ImageProviderName) {
    switch (provider) {
      case 'google':
        return this.config.googleImageModel;
      case 'openai':
        return this.config.openaiImageModel;
      case 'local':
        return this.config.localImageModel;
    }
  }
}
