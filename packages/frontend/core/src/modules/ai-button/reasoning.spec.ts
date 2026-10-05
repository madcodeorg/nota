import { describe, expect, test } from 'vitest';

import {
  normalizeAIReasoningLevel,
  reasoningLevelsForModel,
  supportsReasoningLevelSelection,
} from './reasoning';

describe('normalizeAIReasoningLevel', () => {
  test('keeps supported SDK 7 reasoning levels', () => {
    expect(normalizeAIReasoningLevel('none')).toBe('none');
    expect(normalizeAIReasoningLevel('minimal')).toBe('minimal');
    expect(normalizeAIReasoningLevel('xhigh')).toBe('xhigh');
  });

  test('migrates the legacy boolean preference', () => {
    expect(normalizeAIReasoningLevel(true)).toBe('high');
    expect(normalizeAIReasoningLevel(false)).toBe('none');
    expect(normalizeAIReasoningLevel(undefined)).toBe('none');
  });
});

describe('reasoningLevelsForModel', () => {
  test('hides unsupported thinking controls for local ONNX models', () => {
    expect(reasoningLevelsForModel('local:gemma-4-e2b-it-onnx-q4f16')).toEqual([
      'none',
    ]);
  });

  test('matches provider limits for reasoning models', () => {
    expect(reasoningLevelsForModel('openai:gpt-5-mini')).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(reasoningLevelsForModel('openai:gpt-5.1-codex-max')).toContain(
      'xhigh'
    );
    expect(reasoningLevelsForModel('openai:gpt-5.6')).toContain('xhigh');
    expect(
      reasoningLevelsForModel('anthropic:claude-sonnet-4-5-20250929')
    ).toContain('xhigh');
  });

  test('supports reasoning-capable arbitrary compatible models', () => {
    expect(reasoningLevelsForModel('local:qwen3:8b')).toContain('high');
    expect(reasoningLevelsForModel('custom:plain-chat-model')).toEqual([
      'none',
    ]);
  });

  test('prefers backend-advertised levels and retains heuristic fallback', () => {
    expect(
      reasoningLevelsForModel('custom:opaque-model-v2', ['none', 'low', 'high'])
    ).toEqual(['none', 'low', 'high']);
    expect(reasoningLevelsForModel('custom:qwen3-reasoning')).toContain(
      'medium'
    );
  });

  test('only exposes a thinking-level selector for supported models', () => {
    expect(
      supportsReasoningLevelSelection('local:gemma-4-e2b-it-onnx-q4f16')
    ).toBe(false);
    expect(supportsReasoningLevelSelection('custom:plain-chat-model')).toBe(
      false
    );
    expect(supportsReasoningLevelSelection('openai:gpt-5-mini')).toBe(true);
  });
});
