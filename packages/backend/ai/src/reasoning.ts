import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

import { isOpenAICompatibleProvider, type ProviderName } from './config';
import type { ModelSelection } from './providers';

export const REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

type ReasoningSelection = Pick<
  ModelSelection,
  'modelId' | 'provider' | 'runtime'
>;

export interface ReasoningResolution {
  effective: ReasoningLevel | null;
  requested: ReasoningLevel | null;
  supported: boolean;
  sdk: Pick<LanguageModelV4CallOptions, 'providerOptions' | 'reasoning'>;
}

const reasoningLevelSet = new Set<string>(REASONING_LEVELS);

export function parseReasoningLevel(value: unknown): ReasoningLevel | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === true) return 'high';
  if (candidate === false || candidate == null) return null;
  if (typeof candidate !== 'string') return null;

  const normalized = candidate.trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(normalized)) return 'high';
  if (['false', '0', 'off', 'no'].includes(normalized)) return 'none';
  return reasoningLevelSet.has(normalized)
    ? (normalized as ReasoningLevel)
    : null;
}

function isOpenAIReasoningModel(modelId: string) {
  return (
    modelId.startsWith('o1') ||
    modelId.startsWith('o3') ||
    modelId.startsWith('o4-mini') ||
    (modelId.startsWith('gpt-5') && !modelId.startsWith('gpt-5-chat')) ||
    modelId.startsWith('gpt-6') ||
    modelId.startsWith('gpt-daybreak')
  );
}

function isAnthropicReasoningModel(modelId: string) {
  return (
    /claude-3[.-]7/.test(modelId) ||
    /claude-(?:sonnet|opus|haiku)-[45]/.test(modelId) ||
    /claude-[45](?:[.-]|$)/.test(modelId) ||
    /claude-fable-5/.test(modelId)
  );
}

function isGoogleReasoningModel(modelId: string) {
  return (
    /gemini-2[.-]5/.test(modelId) ||
    /gemini-3(?:[.-]|$)/.test(modelId) ||
    /gemini-2[.-]0.*thinking/.test(modelId)
  );
}

function requiresGoogleLowThinking(selection: ReasoningSelection) {
  return (
    (selection.provider === 'google' ||
      selection.provider === 'google-vertex') &&
    /^gemini-3[.-][78]-flash(?:-|$)/.test(selection.modelId.toLowerCase())
  );
}

function isCompatibleReasoningModel(modelId: string) {
  return (
    isOpenAIReasoningModel(modelId) ||
    isAnthropicReasoningModel(modelId) ||
    isGoogleReasoningModel(modelId) ||
    /(?:^|[/_.:-])(?:deepseek-)?r1(?:$|[/_.:-])/.test(modelId) ||
    /deepseek-reasoner/.test(modelId) ||
    /(?:reasoning|thinking|qwq|qwen3|gpt-oss|magistral)/.test(modelId) ||
    /grok-(?:3-mini|4)(?:[.-]|$)/.test(modelId)
  );
}

/** Proxy vendor prefixes describe capabilities; the original ID is still
 * sent unchanged to the provider. Never strip an arbitrary owner namespace. */
export function modelIdForCapabilities(
  provider: ProviderName,
  modelId: string
) {
  const normalized = modelId.toLowerCase();
  if (
    [
      'ai-gateway',
      'openrouter',
      'custom',
      'google-vertex-maas',
      'google-vertex-xai',
    ].includes(provider)
  )
    return normalized.replace(/^(?:openai|anthropic|google|xai)\//, '');
  return normalized;
}

function isAnthropicProvider(provider: ProviderName) {
  return (
    provider === 'anthropic' ||
    provider === 'google-vertex-anthropic' ||
    provider === 'anthropic-aws'
  );
}

export function modelSupportsReasoning(selection: ReasoningSelection) {
  if (selection.runtime === 'local-onnx') return false;
  // Vertex's Grok API selects reasoning via the model ID. Its official
  // adapter removes reasoning_effort, so adjustable levels are unsupported.
  if (selection.provider === 'google-vertex-xai') return false;

  const modelId = modelIdForCapabilities(selection.provider, selection.modelId);
  if (isAnthropicProvider(selection.provider))
    return isAnthropicReasoningModel(modelId);
  if (isOpenAICompatibleProvider(selection.provider))
    return isCompatibleReasoningModel(modelId);
  switch (selection.provider) {
    case 'openai':
      return isOpenAIReasoningModel(modelId);
    case 'google':
      return isGoogleReasoningModel(modelId);
    case 'local':
    case 'chatgpt':
      return isCompatibleReasoningModel(modelId);
  }
}

export function reasoningLevelsForSelection(
  selection: ReasoningSelection
): ReasoningLevel[] {
  if (!modelSupportsReasoning(selection)) {
    return ['none'];
  }

  if (requiresGoogleLowThinking(selection)) {
    return ['low', 'medium', 'high'];
  }

  const normalizedModelId = selection.modelId.toLowerCase();
  const supportsExtraHigh =
    isAnthropicProvider(selection.provider) ||
    ((selection.provider === 'openai' || selection.provider === 'chatgpt') &&
      (normalizedModelId === 'gpt-5.1-codex-max' ||
        /^gpt-(?:5[.-](?:6|[7-9])|6|daybreak)/.test(normalizedModelId)));

  return supportsExtraHigh
    ? [...REASONING_LEVELS]
    : REASONING_LEVELS.filter(level => level !== 'xhigh');
}

function clampReasoningLevel(
  selection: ReasoningSelection,
  requested: ReasoningLevel
): ReasoningLevel {
  if (
    requiresGoogleLowThinking(selection) &&
    (requested === 'none' || requested === 'minimal')
  ) {
    return 'low';
  }
  if (requested !== 'xhigh') return requested;

  // Anthropic maps xhigh to adaptive effort or its largest token budget.
  // Other providers only accept xhigh on a narrower set of models, so use
  // high until the model catalog can advertise support explicitly.
  if (isAnthropicProvider(selection.provider)) return requested;
  if (
    (selection.provider === 'openai' || selection.provider === 'chatgpt') &&
    (selection.modelId.toLowerCase() === 'gpt-5.1-codex-max' ||
      /^gpt-(?:5[.-](?:6|[7-9])|6|daybreak)/.test(
        selection.modelId.toLowerCase()
      ))
  ) {
    return requested;
  }
  return 'high';
}

export function resolveReasoning(
  selection: ReasoningSelection,
  value: unknown
): ReasoningResolution {
  const requested = parseReasoningLevel(value);
  const supported = modelSupportsReasoning(selection);
  if (requested === null || !supported) {
    return {
      effective: null,
      requested,
      supported,
      sdk: {},
    };
  }

  const effective = clampReasoningLevel(selection, requested);
  const providerOptions: LanguageModelV4CallOptions['providerOptions'] =
    selection.provider === 'google' || selection.provider === 'google-vertex'
      ? {
          [selection.provider === 'google-vertex' ? 'googleVertex' : 'google']:
            {
              thinkingConfig: {
                includeThoughts: requested !== 'none',
              },
            },
        }
      : isAnthropicProvider(selection.provider)
        ? {
            anthropic: {
              sendReasoning: effective !== 'none',
            },
          }
        : undefined;

  return {
    effective,
    requested,
    supported,
    sdk: {
      providerOptions,
      reasoning: effective,
    },
  };
}
