import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';

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
    (modelId.startsWith('gpt-5') && !modelId.startsWith('gpt-5-chat'))
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
    selection.provider === 'google' &&
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

export function modelSupportsReasoning(selection: ReasoningSelection) {
  if (selection.runtime === 'local-onnx') return false;

  const modelId = selection.modelId.toLowerCase();
  switch (selection.provider) {
    case 'openai':
      return isOpenAIReasoningModel(modelId);
    case 'anthropic':
      return isAnthropicReasoningModel(modelId);
    case 'google':
      return isGoogleReasoningModel(modelId);
    case 'local':
    case 'openrouter':
    case 'deepseek':
    case 'xai':
    case 'mistral':
    case 'groq':
    case 'perplexity':
    case 'custom':
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
    selection.provider === 'anthropic' ||
    (selection.provider === 'openai' &&
      (normalizedModelId === 'gpt-5.1-codex-max' ||
        /^gpt-5[.-](?:6|[7-9])/.test(normalizedModelId)));

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
  if (selection.provider === 'anthropic') return requested;
  if (
    selection.provider === 'openai' &&
    (selection.modelId.toLowerCase() === 'gpt-5.1-codex-max' ||
      /^gpt-5[.-](?:6|[7-9])/.test(selection.modelId.toLowerCase()))
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
    selection.provider === 'google'
      ? {
          google: {
            thinkingConfig: {
              includeThoughts: requested !== 'none',
            },
          },
        }
      : selection.provider === 'anthropic'
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
