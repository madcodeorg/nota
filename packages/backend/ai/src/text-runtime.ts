import { generateText, type ModelMessage, Output } from 'ai';
import type { z } from 'zod';

import type { AiBackendConfig } from './config';
import { assertLocalOnnxTextReady } from './local-onnx';
import type { ModelSelection } from './providers';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function assertBackendTextModelAvailable(
  config: AiBackendConfig,
  selected: ModelSelection
) {
  if (selected.provider === 'openai' && !config.openaiApiKey) {
    throw new Error('OpenAI is selected, but OPENAI_API_KEY is missing.');
  }
  if (selected.provider === 'anthropic' && !config.anthropicApiKey) {
    throw new Error('Anthropic is selected, but ANTHROPIC_API_KEY is missing.');
  }
  if (selected.provider === 'google' && !config.googleApiKey) {
    throw new Error(
      'Google is selected, but GOOGLE_GENERATIVE_AI_API_KEY is missing.'
    );
  }
  if (selected.provider !== 'local') {
    return;
  }

  if (selected.runtime === 'local-onnx') {
    await assertLocalOnnxTextReady(config, selected.modelId);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const baseUrl = config.localBaseUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.localApiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Local AI provider responded with HTTP ${response.status}`
      );
    }
  } catch (error) {
    throw new Error(
      `Local AI provider is not available at ${config.localBaseUrl}. ${errorMessage(
        error
      )}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateBackendText(input: {
  config: AiBackendConfig;
  maxOutputTokens?: number;
  messages?: ModelMessage[];
  prompt?: string;
  selected: ModelSelection;
  system: string;
}) {
  await assertBackendTextModelAvailable(input.config, input.selected);

  const result = await generateText(
    input.messages
      ? {
          model: input.selected.model,
          maxOutputTokens: input.maxOutputTokens,
          maxRetries: 0,
          messages: input.messages,
          system: input.system,
        }
      : {
          model: input.selected.model,
          maxOutputTokens: input.maxOutputTokens,
          maxRetries: 0,
          prompt: input.prompt ?? '',
          system: input.system,
        }
  );

  return {
    model: input.selected.modelId,
    provider: input.selected.provider,
    runtime: input.selected.runtime,
    text: result.text,
  };
}

export async function generateBackendObject<
  TSchema extends z.ZodTypeAny,
>(input: {
  config: AiBackendConfig;
  description?: string;
  maxOutputTokens?: number;
  name?: string;
  prompt: string;
  schema: TSchema;
  selected: ModelSelection;
  system: string;
}) {
  await assertBackendTextModelAvailable(input.config, input.selected);

  const result = await generateText({
    model: input.selected.model,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: 0,
    output: Output.object({
      description: input.description,
      name: input.name,
      schema: input.schema,
    }),
    prompt: input.prompt,
    system: input.system,
  });

  return {
    model: input.selected.modelId,
    provider: input.selected.provider,
    runtime: input.selected.runtime,
    structured: result.output as z.infer<TSchema>,
  };
}
