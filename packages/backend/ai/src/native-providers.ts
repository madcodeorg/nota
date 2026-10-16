import { createAlibaba } from '@ai-sdk/alibaba';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropicAws } from '@ai-sdk/anthropic-aws';
import { createAzure } from '@ai-sdk/azure';
import { createBaseten } from '@ai-sdk/baseten';
import { createCerebras } from '@ai-sdk/cerebras';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepInfra } from '@ai-sdk/deepinfra';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createFireworks } from '@ai-sdk/fireworks';
import { createGateway } from '@ai-sdk/gateway';
import { createVertex } from '@ai-sdk/google-vertex';
import { createGoogleVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { createGoogleVertexMaas } from '@ai-sdk/google-vertex/maas';
import { createGoogleVertexXai } from '@ai-sdk/google-vertex/xai';
import { createGroq } from '@ai-sdk/groq';
import { createHuggingFace } from '@ai-sdk/huggingface';
import { createMiniMax } from '@ai-sdk/minimax';
import { createMistral } from '@ai-sdk/mistral';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createOpenResponses } from '@ai-sdk/open-responses';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createXai } from '@ai-sdk/xai';
import { createZai } from '@ai-sdk/zai';
import type { LanguageModel } from 'ai';

import type {
  OpenAICompatibleProviderConfig,
  OpenAICompatibleProviderName,
} from './config';

const factories = {
  alibaba: createAlibaba,
  baseten: createBaseten,
  cerebras: createCerebras,
  cohere: createCohere,
  deepinfra: createDeepInfra,
  deepseek: createDeepSeek,
  fireworks: createFireworks,
  groq: createGroq,
  huggingface: createHuggingFace,
  minimax: createMiniMax,
  mistral: createMistral,
  moonshotai: createMoonshotAI,
  perplexity: createPerplexity,
  togetherai: createTogetherAI,
  xai: createXai,
  zai: createZai,
  'ai-gateway': createGateway,
};

/** Provider configuration is local. Cloud credentials are resolved by the
 * official adapters, never copied from ambient AWS/Google auth into settings. */
export function providerConfigurationError(
  provider: OpenAICompatibleProviderName,
  config: OpenAICompatibleProviderConfig
): string | null {
  if (provider === 'custom' || provider === 'open-responses') {
    return config.baseUrl.trim() ? null : 'Configure an endpoint URL.';
  }
  if (provider === 'azure') {
    if (!config.baseUrl.trim() && !config.resourceName?.trim())
      return 'Configure an Azure resource name or base URL.';
    return config.apiKey.trim() ? null : 'Configure your Azure API key.';
  }
  if (provider === 'google-vertex') {
    if (config.apiKey.trim()) return null; // Official Vertex express mode.
    return config.project?.trim() && config.location?.trim()
      ? null
      : 'Configure Vertex project and location with Google application default credentials, or a Vertex API key.';
  }
  if (provider.startsWith('google-vertex-')) {
    if (config.apiKey.trim())
      return 'This Vertex adapter does not support API keys. Remove the key and use Google application default credentials.';
    return config.project?.trim() && config.location?.trim()
      ? null
      : 'Configure Vertex project and location with Google application default credentials.';
  }
  if (provider === 'amazon-bedrock' || provider === 'anthropic-aws') {
    if (!config.region?.trim()) return 'Configure the AWS region.';
    if (provider === 'anthropic-aws' && !config.workspaceId?.trim())
      return 'Configure the Anthropic AWS workspace ID.';
    if (
      config.apiKey.trim() ||
      (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    )
      return null;
    return 'Configure your service API key or AWS credentials in the backend environment.';
  }
  return config.apiKey.trim() ? null : 'Configure your API key.';
}

export function createNativeTextProvider(
  provider: OpenAICompatibleProviderName,
  config: OpenAICompatibleProviderConfig
): ((modelId: string) => LanguageModel) | null {
  const options = {
    apiKey: config.apiKey || undefined,
    baseURL: config.baseUrl || undefined,
  };
  if (provider === 'azure') {
    const azure = createAzure({
      ...options,
      resourceName: config.resourceName || undefined,
    });
    return modelId => azure[config.apiMode ?? 'responses'](modelId);
  }
  if (provider === 'amazon-bedrock')
    return createAmazonBedrock({ ...options, region: config.region });
  if (provider === 'anthropic-aws')
    return createAnthropicAws({
      ...options,
      region: config.region,
      workspaceId: config.workspaceId,
    });
  if (provider === 'google-vertex')
    return createVertex({
      ...options,
      project: config.project,
      location: config.location,
    });
  const vertexOptions = {
    baseURL: options.baseURL,
    project: config.project,
    location: config.location,
  };
  if (provider === 'google-vertex-anthropic')
    return createGoogleVertexAnthropic(vertexOptions);
  if (provider === 'google-vertex-maas')
    return createGoogleVertexMaas(vertexOptions);
  if (provider === 'google-vertex-xai')
    return createGoogleVertexXai(vertexOptions);
  if (provider === 'open-responses') {
    // This API takes the complete responses POST URL, not a /v1 base URL.
    return config.baseUrl
      ? createOpenResponses({
          apiKey: options.apiKey,
          name: 'open-responses',
          url: config.baseUrl,
        })
      : null;
  }
  if (provider in factories)
    return factories[provider as keyof typeof factories](options);
  return null;
}

export const PROVIDER_LABELS: Record<OpenAICompatibleProviderName, string> = {
  openrouter: 'OpenRouter',
  custom: 'Custom',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  mistral: 'Mistral',
  groq: 'Groq',
  perplexity: 'Perplexity',
  alibaba: 'Alibaba',
  baseten: 'Baseten',
  cerebras: 'Cerebras',
  cohere: 'Cohere',
  deepinfra: 'DeepInfra',
  fireworks: 'Fireworks',
  huggingface: 'Hugging Face',
  minimax: 'MiniMax',
  moonshotai: 'Moonshot AI',
  togetherai: 'Together AI',
  zai: 'Z.AI',
  'ai-gateway': 'Vercel AI Gateway',
  'open-responses': 'Open Responses',
  azure: 'Azure OpenAI',
  'amazon-bedrock': 'Amazon Bedrock',
  'google-vertex': 'Google Vertex',
  'google-vertex-anthropic': 'Google Vertex Anthropic',
  'google-vertex-maas': 'Google Vertex MaaS',
  'google-vertex-xai': 'Google Vertex xAI',
  'anthropic-aws': 'Anthropic on AWS',
};

/** Only providers with a documented model-list API are queried. A manual
 * model remains usable if listing fails or the provider has no listing API. */
export async function discoverGatewayModels(
  config: OpenAICompatibleProviderConfig
) {
  const response = await createGateway({
    apiKey: config.apiKey || undefined,
    baseURL: config.baseUrl || undefined,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(2_000) }),
  }).getAvailableModels();
  return response.models
    .filter(model => !model.modelType || model.modelType === 'language')
    .map(model => model.id);
}
