import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';

import type { AiBackendConfig } from './config';
import {
  generateLocalOnnxText,
  type LocalOnnxMessage,
  streamLocalOnnxText,
  toLocalOnnxMessagesFromPrompt,
} from './local-onnx';
import {
  localToolCalls,
  localToolInstructions,
  localToolWarnings,
  mayStartLocalToolCall,
} from './local-onnx-tools';

function usage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      cacheRead: undefined,
      cacheWrite: undefined,
      noCache: undefined,
      total: undefined,
    },
    outputTokens: {
      reasoning: undefined,
      text: undefined,
      total: undefined,
    },
  };
}

function finishReason(toolCalls = false): LanguageModelV3FinishReason {
  return {
    raw: toolCalls ? 'tool-calls' : 'stop',
    unified: toolCalls ? 'tool-calls' : 'stop',
  };
}

function unsupportedWarnings(
  options: LanguageModelV3CallOptions
): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = localToolWarnings(options);
  if (options.responseFormat?.type === 'json') {
    warnings.push({
      details:
        'Nota local ONNX models support JSON response format through prompt guidance.',
      feature: 'responseFormat',
      type: 'compatibility',
    });
  }
  return warnings;
}

function responseFormatInstruction(options: LanguageModelV3CallOptions) {
  if (options.responseFormat?.type !== 'json') {
    return null;
  }

  const schema = options.responseFormat.schema
    ? `\nJSON schema:\n${JSON.stringify(options.responseFormat.schema)}`
    : '';
  const name = options.responseFormat.name
    ? ` for ${options.responseFormat.name}`
    : '';
  const description = options.responseFormat.description
    ? `\nOutput description: ${options.responseFormat.description}`
    : '';

  return [
    `Return only valid JSON${name}.`,
    'Do not include Markdown fences, prose, comments, or trailing commas.',
    description,
    schema,
  ]
    .filter(Boolean)
    .join('\n');
}

function localOnnxMessages(
  options: LanguageModelV3CallOptions
): LocalOnnxMessage[] {
  const messages = toLocalOnnxMessagesFromPrompt(options.prompt);
  const instructions = [
    localToolInstructions(options),
    responseFormatInstruction(options),
  ].filter(Boolean);
  if (instructions.length) {
    const system: string[] = [];
    while (messages[0]?.role === 'system') {
      system.push(messages[0].content);
      messages.shift();
    }
    messages.unshift({
      role: 'system',
      content: [...system, ...instructions].join('\n\n'),
    });
  }
  return messages;
}

function extractJsonCandidate(text: string) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return candidate;
  }
  return candidate.slice(start, end + 1);
}

function stripMismatchedClosers(json: string) {
  const stack: Array<'{' | '['> = [];
  let result = '';
  let inString = false;
  let escaping = false;

  for (const char of json) {
    result += char;

    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.at(-1) === expected) {
        stack.pop();
      } else {
        result = result.slice(0, -1);
      }
    }
  }

  for (const opener of stack.reverse()) {
    result += opener === '{' ? '}' : ']';
  }
  return result;
}

function normalizeJsonText(text: string) {
  const candidate = extractJsonCandidate(text).replace(/,\s*([}\]])/g, '$1');
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    const repaired = stripMismatchedClosers(candidate).replace(
      /,\s*([}\]])/g,
      '$1'
    );
    JSON.parse(repaired);
    return repaired;
  }
}

function normalizeTextForResponseFormat(
  text: string,
  options: LanguageModelV3CallOptions
) {
  if (options.responseFormat?.type !== 'json') {
    return text;
  }
  return normalizeJsonText(text);
}

export function createLocalOnnxLanguageModel(input: {
  config: AiBackendConfig;
  modelId: string;
}): LanguageModelV3 {
  return {
    doGenerate: async (
      options: LanguageModelV3CallOptions
    ): Promise<LanguageModelV3GenerateResult> => {
      const text = await generateLocalOnnxText({
        abortSignal: options.abortSignal,
        config: input.config,
        maxNewTokens: options.maxOutputTokens,
        messages: localOnnxMessages(options),
        modelId: input.modelId,
      });
      const calls = localToolCalls(text, options);
      return {
        content: calls ?? [
          { text: normalizeTextForResponseFormat(text, options), type: 'text' },
        ],
        finishReason: finishReason(!!calls),
        response: { modelId: input.modelId, timestamp: new Date() },
        usage: usage(),
        warnings: unsupportedWarnings(options),
      };
    },
    doStream: async options => {
      const textId = `local-onnx-${Date.now()}`;
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start: async controller => {
          controller.enqueue({
            type: 'stream-start',
            warnings: unsupportedWarnings(options),
          });
          let textStarted = false;
          const emitText = (delta: string) => {
            if (!delta) return;
            if (!textStarted) {
              controller.enqueue({ type: 'text-start', id: textId });
              textStarted = true;
            }
            controller.enqueue({ type: 'text-delta', id: textId, delta });
          };
          try {
            let pending = '';
            let streamingText = false;
            const bufferResponse =
              options.responseFormat?.type === 'json' ||
              options.toolChoice?.type === 'required' ||
              options.toolChoice?.type === 'tool';
            const text = await streamLocalOnnxText({
              abortSignal: options.abortSignal,
              config: input.config,
              maxNewTokens: options.maxOutputTokens,
              messages: localOnnxMessages(options),
              modelId: input.modelId,
              onText: delta => {
                if (!streamingText) {
                  pending += delta;
                  if (bufferResponse || mayStartLocalToolCall(pending)) return;
                  streamingText = true;
                  delta = pending;
                  pending = '';
                }
                emitText(delta);
              },
            });
            const calls = streamingText ? null : localToolCalls(text, options);
            if (!calls && !streamingText)
              emitText(normalizeTextForResponseFormat(text, options));
            if (textStarted)
              controller.enqueue({ type: 'text-end', id: textId });
            for (const call of calls ?? []) {
              controller.enqueue({
                type: 'tool-input-start',
                id: call.toolCallId,
                toolName: call.toolName,
              });
              controller.enqueue({
                type: 'tool-input-delta',
                id: call.toolCallId,
                delta: call.input,
              });
              controller.enqueue({
                type: 'tool-input-end',
                id: call.toolCallId,
              });
              controller.enqueue(call);
            }
            controller.enqueue({
              type: 'finish',
              finishReason: finishReason(!!calls),
              usage: usage(),
            });
            controller.close();
          } catch (error) {
            controller.enqueue({ type: 'error', error });
            controller.close();
          }
        },
      });
      return { response: {}, stream };
    },
    modelId: input.modelId,
    provider: 'nota-local-onnx',
    specificationVersion: 'v3',
    supportedUrls: {},
  };
}
