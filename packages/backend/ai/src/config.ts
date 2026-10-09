import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateMeetingSttLanguage,
  validateMeetingSttLanguageProvider,
} from './sherpa-stt.js';

export type BuiltInProviderName = 'openai' | 'anthropic' | 'google' | 'local';
export const OPENAI_COMPATIBLE_PROVIDER_NAMES = [
  'openrouter',
  'deepseek',
  'xai',
  'mistral',
  'groq',
  'perplexity',
  'custom',
] as const;
export type OpenAICompatibleProviderName =
  (typeof OPENAI_COMPATIBLE_PROVIDER_NAMES)[number];
export type ProviderName = BuiltInProviderName | OpenAICompatibleProviderName;
export type ImageProviderName = 'openai' | 'google' | 'local';
export type EmbeddingMode = 'auto' | 'fallback' | 'semantic';

export interface OpenAICompatibleProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const PROVIDER_NAMES: ProviderName[] = [
  'local',
  'openai',
  'anthropic',
  'google',
  ...OPENAI_COMPATIBLE_PROVIDER_NAMES,
];

const DEFAULT_WORKSPACE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);

export interface AiBackendConfig {
  host: string;
  port: number;
  settingsPath: string;
  workspaceRoot: string;
  defaultProvider: ProviderName;
  defaultModel: string;
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  googleApiKey: string;
  googleModel: string;
  compatibleProviders: Record<
    OpenAICompatibleProviderName,
    OpenAICompatibleProviderConfig
  >;
  localModel: string;
  imageProvider: ImageProviderName;
  openaiImageModel: string;
  googleImageModel: string;
  localImageModel: string;
  localBaseUrl: string;
  localApiKey: string;
  embeddingAllowRemote: boolean;
  embeddingMode: EmbeddingMode;
  embeddingModel: string;
  toolsEnabled: boolean;
  webCrawlToolEnabled: boolean;
  shellToolEnabled: boolean;
  workspaceSearchToolEnabled: boolean;
  mcpEnabled: boolean;
  mcpConfig: string;
  meetingSttModelId: string;
  meetingSttLanguage: string;
  meetingSttProviderId: string;
  toolMaxSteps: number;
}

type PersistedAiBackendSettings = Partial<
  Pick<
    AiBackendConfig,
    | 'anthropicModel'
    | 'anthropicApiKey'
    | 'defaultModel'
    | 'embeddingAllowRemote'
    | 'embeddingMode'
    | 'embeddingModel'
    | 'defaultProvider'
    | 'googleImageModel'
    | 'googleApiKey'
    | 'googleModel'
    | 'imageProvider'
    | 'localBaseUrl'
    | 'localImageModel'
    | 'localModel'
    | 'mcpConfig'
    | 'mcpEnabled'
    | 'meetingSttModelId'
    | 'meetingSttLanguage'
    | 'meetingSttProviderId'
    | 'openaiImageModel'
    | 'openaiApiKey'
    | 'openaiModel'
    | 'shellToolEnabled'
    | 'toolMaxSteps'
    | 'toolsEnabled'
    | 'webCrawlToolEnabled'
    | 'workspaceSearchToolEnabled'
  >
> & {
  compatibleProviders?: Partial<
    Record<
      OpenAICompatibleProviderName,
      Partial<OpenAICompatibleProviderConfig>
    >
  >;
};

const PERSISTED_SETTINGS_VERSION = 1;
const DEFAULT_LOCAL_TEXT_MODEL = 'qwen3.5-2b-gguf-q4km';
const DEFAULT_EMBEDDING_MODEL = 'all-minilm-l6-v2-embedding';
const LEGACY_EMBEDDING_MODELS: Record<string, string> = {
  'Xenova/all-MiniLM-L6-v2': DEFAULT_EMBEDDING_MODEL,
};
// Saved settings that name a retired ONNX chat model move to the nearest
// llama.cpp (GPU) model of similar size.
const LEGACY_LOCAL_TEXT_MODELS: Record<string, string> = {
  'qwen3-0.6b-onnx-q4f16': 'qwen3.5-0.8b-gguf-q4km',
  'qwen3.5-0.8b-onnx-q4f16': 'qwen3.5-0.8b-gguf-q4km',
  'lfm2.5-230m-onnx-q4': 'qwen3.5-0.8b-gguf-q4km',
  'lfm2.5-350m-onnx-q4f16': 'qwen3.5-0.8b-gguf-q4km',
  'qwen3.5-2b-onnx-q4f16': 'qwen3.5-2b-gguf-q4km',
  'lfm2.5-1.2b-instruct-onnx-q4f16': 'qwen3.5-2b-gguf-q4km',
  'lfm2.5-2.6b-onnx-q4f16': 'qwen3.5-2b-gguf-q4km',
  'smollm3-3b-onnx-q4f16': 'qwen3.5-2b-gguf-q4km',
  'gemma-4-e2b-qat-mobile-onnx': 'qwen3.5-2b-gguf-q4km',
  'gemma-4-e2b-it-onnx-q4f16': 'qwen3.5-2b-gguf-q4km',
  'qwen3.5-4b-onnx-q4f16': 'qwen3.5-4b-gguf-q4km',
  'gemma-4-e4b-qat-mobile-onnx': 'gemma-4-e4b-it-gguf-q4',
  'gemma-4-e4b-it-onnx-q4f16': 'gemma-4-e4b-it-gguf-q4',
};
const SELECTABLE_MEETING_STT_PROVIDERS = new Set([
  'whisper-tiny-cpp',
  'whisper-base-cpp',
  'whisper-small-cpp',
  'whisper-medium-cpp',
  'whisper-large-v3-cpp',
  'apple-speechanalyzer',
  'auto',
  'cohere-onnx',
  'distil-whisper-large-v3-5-onnx',
  'moonshine-base-onnx',
  'nemotron-sherpa',
  'parakeet-sherpa',
  'whisper-tiny-en-onnx',
]);

function readNumber(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readSettingsPath(workspaceRoot: string) {
  return path.join(workspaceRoot, '.nota', 'ai-settings.json');
}

function readStringSetting(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOptionalStringSetting(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function readPersistedMeetingLanguage(
  value: unknown,
  provider: string | undefined
) {
  try {
    const language = validateMeetingSttLanguage(value);
    validateMeetingSttLanguageProvider(language, provider ?? 'auto');
    return language;
  } catch {
    return 'auto';
  }
}

export function normalizeLocalTextModel(value: string | undefined) {
  if (!value) {
    return DEFAULT_LOCAL_TEXT_MODEL;
  }
  return LEGACY_LOCAL_TEXT_MODELS[value] ?? value;
}

function normalizeEmbeddingModel(value: string | undefined) {
  if (!value) {
    return DEFAULT_EMBEDDING_MODEL;
  }
  return LEGACY_EMBEDDING_MODELS[value] ?? value;
}

export function isOpenAICompatibleProvider(
  value: string | undefined
): value is OpenAICompatibleProviderName {
  return OPENAI_COMPATIBLE_PROVIDER_NAMES.includes(
    value as OpenAICompatibleProviderName
  );
}

function readCompatibleProviderSettings(value: unknown) {
  const providers: PersistedAiBackendSettings['compatibleProviders'] = {};
  if (!value || typeof value !== 'object') {
    return providers;
  }

  const settings = value as Record<string, unknown>;
  for (const provider of OPENAI_COMPATIBLE_PROVIDER_NAMES) {
    const providerSettings = settings[provider];
    if (!providerSettings || typeof providerSettings !== 'object') {
      continue;
    }

    const item = providerSettings as Record<string, unknown>;
    providers[provider] = {
      apiKey: readOptionalStringSetting(item.apiKey),
      baseUrl: readOptionalStringSetting(item.baseUrl),
      model: readStringSetting(item.model),
    };
  }
  return providers;
}

function compatibleProviderEnvName(provider: OpenAICompatibleProviderName) {
  switch (provider) {
    case 'openrouter':
      return 'OPENROUTER';
    case 'deepseek':
      return 'DEEPSEEK';
    case 'xai':
      return 'XAI';
    case 'mistral':
      return 'MISTRAL';
    case 'groq':
      return 'GROQ';
    case 'perplexity':
      return 'PERPLEXITY';
    case 'custom':
      return 'CUSTOM';
  }
}

function defaultCompatibleProviderSettings(): Record<
  OpenAICompatibleProviderName,
  OpenAICompatibleProviderConfig
> {
  const defaults: Record<
    OpenAICompatibleProviderName,
    OpenAICompatibleProviderConfig
  > = {
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      baseUrl:
        process.env.NOTA_AI_OPENROUTER_BASE_URL ??
        'https://openrouter.ai/api/v1',
      model: process.env.NOTA_AI_OPENROUTER_MODEL ?? 'openai/gpt-5-mini',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
      baseUrl:
        process.env.NOTA_AI_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
      model: process.env.NOTA_AI_DEEPSEEK_MODEL ?? 'deepseek-chat',
    },
    xai: {
      apiKey: process.env.XAI_API_KEY ?? '',
      baseUrl: process.env.NOTA_AI_XAI_BASE_URL ?? 'https://api.x.ai/v1',
      model: process.env.NOTA_AI_XAI_MODEL ?? 'grok-3-mini',
    },
    mistral: {
      apiKey: process.env.MISTRAL_API_KEY ?? '',
      baseUrl:
        process.env.NOTA_AI_MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
      model: process.env.NOTA_AI_MISTRAL_MODEL ?? 'mistral-small-latest',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY ?? '',
      baseUrl:
        process.env.NOTA_AI_GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
      model: process.env.NOTA_AI_GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    },
    perplexity: {
      apiKey: process.env.PERPLEXITY_API_KEY ?? '',
      baseUrl:
        process.env.NOTA_AI_PERPLEXITY_BASE_URL ?? 'https://api.perplexity.ai',
      model: process.env.NOTA_AI_PERPLEXITY_MODEL ?? 'sonar',
    },
    custom: {
      apiKey: process.env.NOTA_AI_CUSTOM_API_KEY ?? '',
      baseUrl: process.env.NOTA_AI_CUSTOM_BASE_URL ?? '',
      model: process.env.NOTA_AI_CUSTOM_MODEL ?? '',
    },
  };

  for (const provider of OPENAI_COMPATIBLE_PROVIDER_NAMES) {
    const envPrefix = compatibleProviderEnvName(provider);
    defaults[provider] = {
      apiKey:
        process.env[`NOTA_AI_${envPrefix}_API_KEY`] ??
        defaults[provider].apiKey,
      baseUrl:
        process.env[`NOTA_AI_${envPrefix}_BASE_URL`] ??
        defaults[provider].baseUrl,
      model:
        process.env[`NOTA_AI_${envPrefix}_MODEL`] ?? defaults[provider].model,
    };
  }

  return defaults;
}

export function readEmbeddingMode(value: string | undefined): EmbeddingMode {
  switch (value) {
    case 'fallback':
    case 'semantic':
      return value;
    case 'auto':
    default:
      return 'auto';
  }
}

function normalizeMeetingSttProvider(value: string | undefined) {
  if (value === 'nemotron-onnx') {
    return 'nemotron-sherpa';
  }
  // Whistle was removed; saved selections move to Whisper Base.
  if (value === 'cactus-whistle') {
    return 'whisper-base-cpp';
  }
  if (!value) {
    return defaultMeetingSttProvider();
  }
  return SELECTABLE_MEETING_STT_PROVIDERS.has(value)
    ? value
    : defaultMeetingSttProvider();
}

function normalizeMeetingSttModel(value: string | undefined) {
  if (value === 'nemotron-3.5-asr-streaming-int4')
    return 'sherpa-nemotron-3.5-streaming-560ms-int8';
  return value === 'cactus-whistle' ? 'whisper-base-q5-cpp' : value;
}

function readBooleanSetting(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumberSetting(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function loadPersistedSettings(
  settingsPath: string
): PersistedAiBackendSettings {
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      settings?: Record<string, unknown>;
    };
    const settings =
      parsed && typeof parsed === 'object' && parsed.settings
        ? parsed.settings
        : {};
    const defaultProvider = readStringSetting(settings.defaultProvider);
    const imageProvider = readStringSetting(settings.imageProvider);

    return {
      anthropicModel: readStringSetting(settings.anthropicModel),
      anthropicApiKey: readOptionalStringSetting(settings.anthropicApiKey),
      defaultModel: readStringSetting(settings.defaultModel),
      embeddingAllowRemote: readBooleanSetting(settings.embeddingAllowRemote),
      embeddingMode: readEmbeddingMode(
        readStringSetting(settings.embeddingMode)
      ),
      embeddingModel: normalizeEmbeddingModel(
        readStringSetting(settings.embeddingModel)
      ),
      defaultProvider: defaultProvider
        ? readProvider(defaultProvider)
        : undefined,
      googleImageModel: readStringSetting(settings.googleImageModel),
      googleApiKey: readOptionalStringSetting(settings.googleApiKey),
      googleModel: readStringSetting(settings.googleModel),
      compatibleProviders: readCompatibleProviderSettings(
        settings.compatibleProviders
      ),
      imageProvider: imageProvider
        ? readImageProvider(imageProvider)
        : undefined,
      localBaseUrl: readStringSetting(settings.localBaseUrl),
      localImageModel: readStringSetting(settings.localImageModel),
      localModel: readStringSetting(settings.localModel),
      mcpConfig: readStringSetting(settings.mcpConfig),
      mcpEnabled: readBooleanSetting(settings.mcpEnabled),
      meetingSttModelId: normalizeMeetingSttModel(
        settings.meetingSttProviderId === 'nemotron-onnx'
          ? (readStringSetting(settings.meetingSttModelId) ??
              defaultMeetingSttModel('nemotron-sherpa'))
          : readOptionalStringSetting(settings.meetingSttModelId)
      ),
      meetingSttLanguage: readPersistedMeetingLanguage(
        settings.meetingSttLanguage,
        normalizeMeetingSttProvider(
          readStringSetting(settings.meetingSttProviderId)
        )
      ),
      meetingSttProviderId: normalizeMeetingSttProvider(
        readStringSetting(settings.meetingSttProviderId)
      ),
      openaiImageModel: readStringSetting(settings.openaiImageModel),
      openaiApiKey: readOptionalStringSetting(settings.openaiApiKey),
      openaiModel: readStringSetting(settings.openaiModel),
      shellToolEnabled: readBooleanSetting(settings.shellToolEnabled),
      toolMaxSteps: readNumberSetting(settings.toolMaxSteps),
      toolsEnabled: readBooleanSetting(settings.toolsEnabled),
      webCrawlToolEnabled: readBooleanSetting(settings.webCrawlToolEnabled),
      workspaceSearchToolEnabled: readBooleanSetting(
        settings.workspaceSearchToolEnabled
      ),
    };
  } catch {
    return {};
  }
}

export function readProvider(value: string | undefined): ProviderName {
  switch (value) {
    case 'anthropic':
    case 'google':
    case 'local':
    case 'openai':
    case 'openrouter':
    case 'deepseek':
    case 'xai':
    case 'mistral':
    case 'groq':
    case 'perplexity':
    case 'custom':
      return value;
    default:
      return 'local';
  }
}

export function readImageProvider(
  value: string | undefined
): ImageProviderName {
  switch (value) {
    case 'google':
    case 'local':
    case 'openai':
      return value;
    default:
      if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google';
      if (process.env.OPENAI_API_KEY) return 'openai';
      return 'openai';
  }
}

export function mainTextModelForProvider(
  config: AiBackendConfig,
  provider: ProviderName = config.defaultProvider
) {
  switch (provider) {
    case 'anthropic':
      return config.anthropicModel;
    case 'google':
      return config.googleModel;
    case 'openai':
      return config.openaiModel;
    case 'local':
      return config.localModel;
    case 'openrouter':
    case 'deepseek':
    case 'xai':
    case 'mistral':
    case 'groq':
    case 'perplexity':
    case 'custom':
      return config.compatibleProviders[provider].model;
  }
}

export function updateConfig(
  config: AiBackendConfig,
  input: Partial<{
    defaultProvider: string;
    defaultModel: string;
    openaiApiKey: string;
    openaiModel: string;
    anthropicApiKey: string;
    anthropicModel: string;
    googleApiKey: string;
    googleModel: string;
    compatibleProviders: PersistedAiBackendSettings['compatibleProviders'];
    localModel: string;
    imageProvider: string;
    openaiImageModel: string;
    googleImageModel: string;
    localImageModel: string;
    localBaseUrl: string;
    localApiKey: string;
    embeddingAllowRemote: boolean;
    embeddingMode: string;
    embeddingModel: string;
    toolsEnabled: boolean;
    webCrawlToolEnabled: boolean;
    shellToolEnabled: boolean;
    workspaceSearchToolEnabled: boolean;
    mcpEnabled: boolean;
    mcpConfig: string;
    meetingSttModelId: string;
    meetingSttLanguage: string;
    meetingSttProviderId: string;
    toolMaxSteps: number;
  }>
) {
  const language = validateMeetingSttLanguage(
    input.meetingSttLanguage !== undefined
      ? input.meetingSttLanguage
      : config.meetingSttLanguage
  );
  const languageProvider = normalizeMeetingSttProvider(
    input.meetingSttProviderId ?? config.meetingSttProviderId
  );
  validateMeetingSttLanguageProvider(language, languageProvider);
  config.meetingSttLanguage = language;
  if (input.defaultProvider !== undefined) {
    config.defaultProvider = readProvider(input.defaultProvider);
  }
  if (input.defaultModel) {
    config.defaultModel = input.defaultModel;
  }
  if (input.openaiModel) {
    config.openaiModel = input.openaiModel;
  }
  if (input.openaiApiKey !== undefined) {
    config.openaiApiKey = input.openaiApiKey.trim();
  }
  if (input.anthropicModel) {
    config.anthropicModel = input.anthropicModel;
  }
  if (input.anthropicApiKey !== undefined) {
    config.anthropicApiKey = input.anthropicApiKey.trim();
  }
  if (input.googleModel) {
    config.googleModel = input.googleModel;
  }
  if (input.googleApiKey !== undefined) {
    config.googleApiKey = input.googleApiKey.trim();
  }
  if (input.compatibleProviders) {
    for (const provider of OPENAI_COMPATIBLE_PROVIDER_NAMES) {
      const providerSettings = input.compatibleProviders[provider];
      if (!providerSettings) {
        continue;
      }

      const current = config.compatibleProviders[provider];
      config.compatibleProviders[provider] = {
        apiKey:
          providerSettings.apiKey !== undefined
            ? providerSettings.apiKey.trim()
            : current.apiKey,
        baseUrl:
          providerSettings.baseUrl !== undefined
            ? providerSettings.baseUrl.trim()
            : current.baseUrl,
        model: providerSettings.model?.trim() || current.model,
      };
    }
  }
  if (input.localModel) {
    config.localModel = normalizeLocalTextModel(input.localModel);
  }
  if (input.imageProvider !== undefined) {
    config.imageProvider = readImageProvider(input.imageProvider);
  }
  if (input.openaiImageModel) {
    config.openaiImageModel = input.openaiImageModel;
  }
  if (input.googleImageModel) {
    config.googleImageModel = input.googleImageModel;
  }
  if (input.localImageModel) {
    config.localImageModel = input.localImageModel;
  }
  if (input.localBaseUrl) {
    config.localBaseUrl = input.localBaseUrl;
  }
  if (input.localApiKey) {
    config.localApiKey = input.localApiKey;
  }
  if (input.embeddingAllowRemote !== undefined) {
    config.embeddingAllowRemote = input.embeddingAllowRemote;
  }
  if (input.embeddingMode !== undefined) {
    config.embeddingMode = readEmbeddingMode(input.embeddingMode);
  }
  if (input.embeddingModel) {
    config.embeddingModel = normalizeEmbeddingModel(input.embeddingModel);
  }
  if (input.toolsEnabled !== undefined) {
    config.toolsEnabled = input.toolsEnabled;
  }
  if (input.webCrawlToolEnabled !== undefined) {
    config.webCrawlToolEnabled = input.webCrawlToolEnabled;
  }
  if (input.shellToolEnabled !== undefined) {
    config.shellToolEnabled = input.shellToolEnabled;
  }
  if (input.workspaceSearchToolEnabled !== undefined) {
    config.workspaceSearchToolEnabled = input.workspaceSearchToolEnabled;
  }
  if (input.mcpEnabled !== undefined) {
    config.mcpEnabled = input.mcpEnabled;
  }
  if (input.mcpConfig !== undefined) {
    config.mcpConfig = input.mcpConfig;
  }
  if (input.meetingSttModelId !== undefined) {
    config.meetingSttModelId =
      normalizeMeetingSttModel(input.meetingSttModelId) ??
      input.meetingSttModelId;
  } else if (input.meetingSttProviderId === 'nemotron-onnx') {
    config.meetingSttModelId = defaultMeetingSttModel('nemotron-sherpa');
  }
  if (input.meetingSttProviderId) {
    config.meetingSttProviderId = normalizeMeetingSttProvider(
      input.meetingSttProviderId
    );
  }
  if (input.toolMaxSteps !== undefined && Number.isFinite(input.toolMaxSteps)) {
    config.toolMaxSteps = Math.max(
      1,
      Math.min(50, Math.floor(input.toolMaxSteps))
    );
  }

  if (
    input.defaultProvider !== undefined ||
    input.defaultModel ||
    input.anthropicModel ||
    input.googleModel ||
    input.compatibleProviders ||
    input.openaiModel ||
    input.localModel
  ) {
    config.defaultModel = mainTextModelForProvider(config);
  }
}

export function saveConfig(config: AiBackendConfig) {
  const settings: PersistedAiBackendSettings = {
    anthropicApiKey: config.anthropicApiKey,
    anthropicModel: config.anthropicModel,
    defaultModel: config.defaultModel,
    embeddingAllowRemote: config.embeddingAllowRemote,
    embeddingMode: config.embeddingMode,
    embeddingModel: config.embeddingModel,
    defaultProvider: config.defaultProvider,
    googleApiKey: config.googleApiKey,
    googleImageModel: config.googleImageModel,
    googleModel: config.googleModel,
    compatibleProviders: config.compatibleProviders,
    imageProvider: config.imageProvider,
    localBaseUrl: config.localBaseUrl,
    localImageModel: config.localImageModel,
    localModel: config.localModel,
    mcpConfig: config.mcpConfig,
    mcpEnabled: config.mcpEnabled,
    meetingSttModelId: config.meetingSttModelId,
    meetingSttLanguage: config.meetingSttLanguage,
    meetingSttProviderId: config.meetingSttProviderId,
    openaiApiKey: config.openaiApiKey,
    openaiImageModel: config.openaiImageModel,
    openaiModel: config.openaiModel,
    shellToolEnabled: config.shellToolEnabled,
    toolMaxSteps: config.toolMaxSteps,
    toolsEnabled: config.toolsEnabled,
    webCrawlToolEnabled: config.webCrawlToolEnabled,
    workspaceSearchToolEnabled: config.workspaceSearchToolEnabled,
  };

  mkdirSync(path.dirname(config.settingsPath), { recursive: true });
  writeFileSync(
    config.settingsPath,
    JSON.stringify(
      {
        version: PERSISTED_SETTINGS_VERSION,
        updatedAt: new Date().toISOString(),
        settings,
      },
      null,
      2
    )
  );
}

function defaultMeetingSttProvider() {
  return 'auto';
}

function defaultMeetingSttModel(providerId: string) {
  if (/^whisper-(tiny|base|small|medium|large-v3)-cpp$/.test(providerId))
    return providerId.replace(/-cpp$/, '-q5-cpp');
  switch (providerId) {
    case 'cohere-onnx':
      return 'cohere-transcribe-03-2026-onnx';
    case 'distil-whisper-large-v3-5-onnx':
      return 'distil-whisper-large-v3-5-onnx-q4';
    case 'moonshine-base-onnx':
      return 'moonshine-base-onnx-q4';
    case 'nemotron-sherpa':
      return 'sherpa-nemotron-3.5-streaming-560ms-int8';
    case 'parakeet-sherpa':
      return 'sherpa-parakeet-tdt-0.6b-v3-int8';
    case 'whisper-tiny-en-onnx':
      return 'whisper-tiny-en-onnx-q4';
    case 'apple-speechanalyzer':
    case 'auto':
    default:
      return '';
  }
}

export function loadConfig(): AiBackendConfig {
  const workspaceRoot =
    process.env.NOTA_AI_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
  const settingsPath =
    process.env.NOTA_AI_SETTINGS_PATH ?? readSettingsPath(workspaceRoot);
  const defaultProvider = readProvider(process.env.NOTA_AI_PROVIDER);
  const imageProvider = readImageProvider(process.env.NOTA_AI_IMAGE_PROVIDER);
  const compatibleProviders = defaultCompatibleProviderSettings();
  const modelByProvider = {
    openai: process.env.NOTA_AI_OPENAI_MODEL ?? 'gpt-5-mini',
    anthropic:
      process.env.NOTA_AI_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929',
    google: process.env.NOTA_AI_GOOGLE_MODEL ?? 'gemini-2.5-flash',
    local: normalizeLocalTextModel(process.env.NOTA_AI_LOCAL_MODEL),
    openrouter: compatibleProviders.openrouter.model,
    deepseek: compatibleProviders.deepseek.model,
    xai: compatibleProviders.xai.model,
    mistral: compatibleProviders.mistral.model,
    groq: compatibleProviders.groq.model,
    perplexity: compatibleProviders.perplexity.model,
    custom: compatibleProviders.custom.model,
  } satisfies Record<ProviderName, string>;
  const meetingSttProviderId = normalizeMeetingSttProvider(
    process.env.NOTA_MEETING_STT_PROVIDER ?? defaultMeetingSttProvider()
  );

  const config: AiBackendConfig = {
    host: process.env.NOTA_AI_HOST ?? '127.0.0.1',
    port: readNumber('NOTA_AI_PORT', 3010),
    settingsPath,
    workspaceRoot,
    defaultProvider,
    defaultModel: process.env.NOTA_AI_MODEL ?? modelByProvider[defaultProvider],
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: modelByProvider.openai,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: modelByProvider.anthropic,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    googleModel: modelByProvider.google,
    compatibleProviders,
    localModel: normalizeLocalTextModel(modelByProvider.local),
    imageProvider,
    openaiImageModel:
      process.env.NOTA_AI_OPENAI_IMAGE_MODEL ?? 'gpt-image-1-mini',
    googleImageModel:
      process.env.NOTA_AI_GOOGLE_IMAGE_MODEL ?? 'imagen-4.0-fast-generate-001',
    localImageModel:
      process.env.NOTA_AI_LOCAL_IMAGE_MODEL ?? 'local-image-model',
    localBaseUrl:
      process.env.NOTA_AI_LOCAL_BASE_URL ?? 'http://localhost:11434/v1',
    localApiKey: process.env.NOTA_AI_LOCAL_API_KEY ?? 'ollama',
    embeddingAllowRemote: readBoolean('NOTA_AI_EMBEDDING_ALLOW_REMOTE', false),
    embeddingMode: readEmbeddingMode(process.env.NOTA_AI_EMBEDDING_MODE),
    embeddingModel: normalizeEmbeddingModel(
      process.env.NOTA_AI_EMBEDDING_MODEL
    ),
    toolsEnabled: readBoolean('NOTA_AI_TOOLS_ENABLED', true),
    webCrawlToolEnabled: readBoolean('NOTA_AI_WEB_CRAWL_TOOL_ENABLED', true),
    shellToolEnabled: readBoolean('NOTA_AI_SHELL_TOOL_ENABLED', false),
    workspaceSearchToolEnabled: readBoolean(
      'NOTA_AI_WORKSPACE_SEARCH_TOOL_ENABLED',
      true
    ),
    mcpEnabled: readBoolean('NOTA_AI_MCP_ENABLED', false),
    mcpConfig: process.env.NOTA_AI_MCP_CONFIG ?? '{}',
    meetingSttProviderId,
    meetingSttLanguage: 'auto',
    meetingSttModelId:
      normalizeMeetingSttModel(process.env.NOTA_MEETING_STT_MODEL) ??
      defaultMeetingSttModel(meetingSttProviderId),
    toolMaxSteps: Math.max(
      1,
      Math.min(50, Math.floor(readNumber('NOTA_AI_TOOL_MAX_STEPS', 50)))
    ),
  };

  updateConfig(config, loadPersistedSettings(settingsPath));
  return config;
}
