import type { ReadonlySignal } from '@preact/signals-core';

export const AI_REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export type AIReasoningLevel = (typeof AI_REASONING_LEVELS)[number];
export type LegacyAIReasoningPreference = AIReasoningLevel | boolean;

export interface AIReasoningConfig {
  enabled: ReadonlySignal<boolean | undefined>;
  level?: ReadonlySignal<AIReasoningLevel>;
  setEnabled: (state: boolean) => void;
  setLevel?: (level: AIReasoningLevel) => void;
}

const reasoningLevelSet = new Set<string>(AI_REASONING_LEVELS);

function splitQualifiedModelId(modelId: string) {
  const separator = modelId.indexOf(':');
  if (separator <= 0 || separator === modelId.length - 1) {
    return { modelId, provider: '' };
  }
  return {
    modelId: modelId.slice(separator + 1),
    provider: modelId.slice(0, separator),
  };
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

export function reasoningLevelsForModel(
  modelId?: string,
  advertisedLevels?: readonly AIReasoningLevel[]
) {
  if (advertisedLevels?.length) {
    const validLevels = [...new Set(advertisedLevels)].filter(level =>
      reasoningLevelSet.has(level)
    );
    if (validLevels.length) {
      return validLevels;
    }
  }

  if (!modelId) {
    return ['none'] as AIReasoningLevel[];
  }

  const qualified = splitQualifiedModelId(modelId);
  const normalizedModelId = qualified.modelId.toLowerCase();
  const supported =
    qualified.provider === 'openai'
      ? isOpenAIReasoningModel(normalizedModelId)
      : qualified.provider === 'anthropic'
        ? isAnthropicReasoningModel(normalizedModelId)
        : qualified.provider === 'google'
          ? isGoogleReasoningModel(normalizedModelId)
          : qualified.provider === 'local' &&
              /(?:^|-)onnx(?:-|$)/.test(normalizedModelId)
            ? false
            : isCompatibleReasoningModel(normalizedModelId);

  if (!supported) {
    return ['none'] as AIReasoningLevel[];
  }

  const supportsExtraHigh =
    qualified.provider === 'anthropic' ||
    (qualified.provider === 'openai' &&
      (normalizedModelId === 'gpt-5.1-codex-max' ||
        /^gpt-5[.-](?:6|[7-9])/.test(normalizedModelId)));
  return supportsExtraHigh
    ? [...AI_REASONING_LEVELS]
    : AI_REASONING_LEVELS.filter(level => level !== 'xhigh');
}

export function supportsReasoningLevelSelection(
  modelId?: string,
  advertisedLevels?: readonly AIReasoningLevel[]
) {
  return reasoningLevelsForModel(modelId, advertisedLevels).length > 1;
}

export function normalizeAIReasoningLevel(
  value: LegacyAIReasoningPreference | null | undefined
): AIReasoningLevel {
  if (value === true) return 'high';
  if (value === false || value == null) return 'none';
  return reasoningLevelSet.has(value) ? value : 'none';
}

export function reasoningLevelFromConfig(
  config: AIReasoningConfig
): AIReasoningLevel {
  return config.level?.value ?? (config.enabled.value ? 'high' : 'none');
}

export function setReasoningLevelOnConfig(
  config: AIReasoningConfig,
  level: AIReasoningLevel
) {
  if (config.setLevel) {
    config.setLevel(level);
    return;
  }
  config.setEnabled(level !== 'none');
}
