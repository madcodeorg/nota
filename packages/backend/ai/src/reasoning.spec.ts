import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { describe, expect, test } from 'vitest';

import {
  modelSupportsReasoning,
  parseReasoningLevel,
  reasoningLevelsForSelection,
  resolveReasoning,
} from './reasoning';

describe('reasoning levels', () => {
  test('accepts SDK 7 levels and legacy booleans', () => {
    expect(parseReasoningLevel('minimal')).toBe('minimal');
    expect(parseReasoningLevel('xhigh')).toBe('xhigh');
    expect(parseReasoningLevel('true')).toBe('high');
    expect(parseReasoningLevel(true)).toBe('high');
    expect(parseReasoningLevel('false')).toBe('none');
    expect(parseReasoningLevel('unknown')).toBeNull();
  });

  test('does not send reasoning to text-only local ONNX models', () => {
    const resolution = resolveReasoning(
      {
        modelId: 'gemma-4-e2b-it-onnx-q4f16',
        provider: 'local',
        runtime: 'local-onnx',
      },
      'high'
    );

    expect(resolution.supported).toBe(false);
    expect(resolution.effective).toBeNull();
    expect(resolution.sdk).toEqual({});
  });

  test('clamps unsupported and excessive OpenAI reasoning', () => {
    expect(
      modelSupportsReasoning({
        modelId: 'gpt-4.1-mini',
        provider: 'openai',
        runtime: 'hosted',
      })
    ).toBe(false);

    const resolution = resolveReasoning(
      {
        modelId: 'gpt-5-mini',
        provider: 'openai',
        runtime: 'hosted',
      },
      'xhigh'
    );
    expect(resolution.effective).toBe('high');
    expect(resolution.sdk.reasoning).toBe('high');

    const codexMax = resolveReasoning(
      {
        modelId: 'gpt-5.1-codex-max',
        provider: 'openai',
        runtime: 'hosted',
      },
      'xhigh'
    );
    expect(codexMax.effective).toBe('xhigh');
    expect(codexMax.sdk.reasoning).toBe('xhigh');
  });

  test('adds provider options needed to display Google thinking', () => {
    const resolution = resolveReasoning(
      {
        modelId: 'gemini-2.5-flash',
        provider: 'google',
        runtime: 'hosted',
      },
      'medium'
    );

    expect(resolution.sdk).toEqual({
      providerOptions: {
        google: {
          thinkingConfig: { includeThoughts: true },
        },
      },
      reasoning: 'medium',
    });
  });

  test.each(['gemini-3.7-flash', 'gemini-3.8-flash-preview'])(
    'advertises supported thinking levels for %s',
    modelId => {
      expect(
        reasoningLevelsForSelection({
          modelId,
          provider: 'google',
          runtime: 'hosted',
        })
      ).toEqual(['low', 'medium', 'high']);
    }
  );

  test.each([
    ['gemini-3.7-flash', 'none'],
    ['gemini-3.7-flash', 'minimal'],
    ['gemini-3.8-flash', 'none'],
    ['gemini-3.8-flash', 'minimal'],
  ])(
    'sends supported low thinking for %s with %s requested',
    async (modelId, requested) => {
      const resolution = resolveReasoning(
        { modelId, provider: 'google', runtime: 'hosted' },
        requested
      );
      expect(resolution.effective).toBe('low');
      let payload: Record<string, unknown> | undefined;
      const google = createGoogleGenerativeAI({
        apiKey: 'test-only-key',
        fetch: async (_url, options) => {
          payload = JSON.parse(String(options?.body));
          return Response.json({
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'Done.' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
            },
          });
        },
      });
      const result = await generateText({
        model: google(modelId),
        prompt: 'Hello.',
        ...resolution.sdk,
      });
      expect(result.text).toBe('Done.');
      expect(payload).toMatchObject({
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: 'low',
            includeThoughts: requested !== 'none',
          },
        },
      });
    }
  );

  test('keeps Anthropic xhigh and recognizes compatible reasoning models', () => {
    const anthropic = resolveReasoning(
      {
        modelId: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        runtime: 'hosted',
      },
      'xhigh'
    );
    expect(anthropic.effective).toBe('xhigh');
    expect(anthropic.sdk.providerOptions).toEqual({
      anthropic: { sendReasoning: true },
    });

    expect(
      modelSupportsReasoning({
        modelId: 'deepseek/deepseek-r1',
        provider: 'openrouter',
        runtime: 'hosted',
      })
    ).toBe(true);
    expect(
      modelSupportsReasoning({
        modelId: 'deepseek-chat',
        provider: 'deepseek',
        runtime: 'hosted',
      })
    ).toBe(false);
  });

  test('publishes the exact levels supported by each model selection', () => {
    expect(
      reasoningLevelsForSelection({
        modelId: 'gemma-4-e2b-it-onnx-q4f16',
        provider: 'local',
        runtime: 'local-onnx',
      })
    ).toEqual(['none']);
    expect(
      reasoningLevelsForSelection({
        modelId: 'gpt-5-mini',
        provider: 'openai',
        runtime: 'hosted',
      })
    ).toEqual(['none', 'minimal', 'low', 'medium', 'high']);
    expect(
      reasoningLevelsForSelection({
        modelId: 'claude-sonnet-4-5-20250929',
        provider: 'anthropic',
        runtime: 'hosted',
      })
    ).toContain('xhigh');
  });
});
