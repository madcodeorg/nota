import { createOpenAI } from '@ai-sdk/openai';
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider';

import {
  type ChatGPTAuth,
  ChatGPTAuthError,
  getChatGPTAuth,
} from './chatgpt-auth';
import type { AiBackendConfig } from './config';

const RESPONSES = 'https://api.openai.com/v1/responses';
const UNSUPPORTED_FIELDS = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
  'previous_response_id',
];
const ALLOWED_TOOLS = new Set([
  'namespace',
  'function',
  'custom',
  'web_search',
  'web_search_preview',
]);

/** The ChatGPT subscription route has a narrower contract than API-key Responses. */
export function prepareChatGPTRequest(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...payload,
    store: false,
    stream: true,
  };
  for (const field of UNSUPPORTED_FIELDS)
    delete (body as Record<string, unknown>)[field];
  if (
    typeof body.reasoning === 'object' &&
    body.reasoning !== null &&
    (body.reasoning as Record<string, unknown>).effort === 'minimal'
  ) {
    body.reasoning = {
      ...(body.reasoning as Record<string, unknown>),
      effort: 'low',
    };
  }
  if (!Array.isArray(body.input))
    throw new Error('ChatGPT requires complete conversation input.');
  body.input = body.input.map(item => {
    if (typeof item !== 'object' || item === null) return item;
    const message = item as Record<string, unknown>;
    return message.role === 'system' ? { ...message, role: 'developer' } : item;
  });
  if (Array.isArray(body.tools)) {
    const tools = body.tools as Record<string, unknown>[];
    if (tools.some(tool => !ALLOWED_TOOLS.has(String(tool.type))))
      throw new Error(
        'This hosted tool is not supported with ChatGPT sign-in.'
      );
    // The SDK natively understands namespaced function tools and keeps the
    // original function names when parsing calls and sending their results.
    const ungrouped = tools.filter(
      tool => tool.type === 'function' || tool.type === 'custom'
    );
    body.tools = tools.filter(
      tool => tool.type !== 'function' && tool.type !== 'custom'
    );
    if (ungrouped.length)
      (body.tools as unknown[]).push({
        type: 'namespace',
        name: 'nota',
        description: 'Nota workspace tools',
        tools: ungrouped,
      });
  }
  return body;
}

class ChatGPTResponseError extends Error {}

function responseError(error: unknown): unknown {
  let current = error;
  for (let i = 0; i < 5 && current instanceof Error; i++) {
    if (
      current instanceof ChatGPTResponseError ||
      current instanceof ChatGPTAuthError
    )
      return new Error(current.message);
    current = current.cause;
  }
  return new Error('ChatGPT inference failed. Retry the request.');
}

/** Reject partial/failed OAuth streams, including errors arriving after text. */
function requireCompletedStream(response: Response): Response {
  if (!response.ok || !response.body) return response;
  let pending = '';
  let completed = false;
  const decoder = new TextDecoder();
  function inspect(event: string) {
    const data = event
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    let value: { type?: string; response?: { error?: { code?: string } } };
    try {
      value = JSON.parse(data);
    } catch {
      throw new ChatGPTResponseError(
        'ChatGPT returned an invalid response stream.'
      );
    }
    if (value.type === 'response.completed') completed = true;
    if (
      value.type === 'response.failed' ||
      value.type === 'response.incomplete' ||
      value.type === 'error'
    ) {
      const code = value.response?.error?.code;
      const error =
        code === 'subscription_sharing_usage_limit_exceeded'
          ? 'ChatGPT plan usage limit reached. Review usage in ChatGPT Settings.'
          : code === 'subscription_sharing_usage_unavailable'
            ? 'ChatGPT plan usage is unavailable for this account. Review app access in ChatGPT Settings.'
            : value.type === 'response.incomplete'
              ? 'ChatGPT returned an incomplete response. Retry the request.'
              : 'ChatGPT inference failed. Retry the request.';
      throw new ChatGPTResponseError(error);
    }
  }
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending = (pending + decoder.decode(chunk, { stream: true })).replace(
          /\r\n/g,
          '\n'
        );
        // A single event should not grow without bound if a server is malformed.
        if (pending.length > 8 * 1024 * 1024)
          throw new ChatGPTResponseError(
            'ChatGPT response event is too large.'
          );
        let boundary: number;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          inspect(pending.slice(0, boundary));
          pending = pending.slice(boundary + 2);
        }
        controller.enqueue(chunk);
      },
      flush() {
        pending += decoder.decode();
        if (pending.trim()) inspect(pending);
        if (!completed)
          throw new ChatGPTResponseError(
            'ChatGPT stream ended before response.completed. Retry the request.'
          );
      },
    })
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function prepareOptions(
  options: LanguageModelV4CallOptions
): LanguageModelV4CallOptions {
  return {
    ...options,
    providerOptions: {
      ...options.providerOptions,
      openai: {
        ...options.providerOptions?.openai,
        store: false,
        systemMessageMode: 'developer',
      },
    },
    tools: options.tools?.map(tool =>
      tool.type === 'function'
        ? {
            ...tool,
            providerOptions: {
              ...tool.providerOptions,
              openai: {
                ...tool.providerOptions?.openai,
                namespace: {
                  name: 'nota',
                  description: 'Nota workspace tools',
                },
              },
            },
          }
        : tool
    ),
  };
}

/** generateText still uses the required OAuth SSE path, including meeting summaries. */
async function aggregate(
  result: LanguageModelV4StreamResult
): Promise<LanguageModelV4GenerateResult> {
  const content: LanguageModelV4Content[] = [];
  const text = new Map<
    string,
    Extract<LanguageModelV4Content, { type: 'text' }>
  >();
  const reasoning = new Map<
    string,
    Extract<LanguageModelV4Content, { type: 'reasoning' }>
  >();
  let finish:
    | Extract<LanguageModelV4StreamPart, { type: 'finish' }>
    | undefined;
  let response: LanguageModelV4GenerateResult['response'] = result.response;
  let warnings: LanguageModelV4GenerateResult['warnings'] = [];
  const reader = result.stream.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const part = item.value;
      switch (part.type) {
        case 'text-start': {
          const value: Extract<LanguageModelV4Content, { type: 'text' }> = {
            type: 'text',
            text: '',
            providerMetadata: part.providerMetadata,
          };
          text.set(part.id, value);
          content.push(value);
          break;
        }
        case 'text-delta': {
          const value = text.get(part.id);
          if (!value)
            throw new Error('ChatGPT returned text without a start event.');
          value.text += part.delta;
          if (part.providerMetadata)
            value.providerMetadata = part.providerMetadata;
          break;
        }
        case 'text-end': {
          const value = text.get(part.id);
          if (value && part.providerMetadata)
            value.providerMetadata = part.providerMetadata;
          break;
        }
        case 'reasoning-start': {
          const value: Extract<LanguageModelV4Content, { type: 'reasoning' }> =
            {
              type: 'reasoning',
              text: '',
              providerMetadata: part.providerMetadata,
            };
          reasoning.set(part.id, value);
          content.push(value);
          break;
        }
        case 'reasoning-delta': {
          const value = reasoning.get(part.id);
          if (!value)
            throw new Error(
              'ChatGPT returned reasoning without a start event.'
            );
          value.text += part.delta;
          if (part.providerMetadata)
            value.providerMetadata = part.providerMetadata;
          break;
        }
        case 'reasoning-end': {
          const value = reasoning.get(part.id);
          if (value && part.providerMetadata)
            value.providerMetadata = part.providerMetadata;
          break;
        }
        case 'stream-start':
          warnings = part.warnings;
          break;
        case 'response-metadata': {
          const { type: _, ...metadata } = part;
          response = { ...response, ...metadata };
          break;
        }
        case 'finish':
          finish = part;
          break;
        case 'error':
          throw part.error instanceof Error
            ? part.error
            : new Error('ChatGPT inference failed.');
        case 'tool-call':
        case 'tool-result':
        case 'tool-approval-request':
        case 'source':
        case 'file':
        case 'reasoning-file':
        case 'custom':
          content.push(part);
          break;
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!finish || finish.finishReason.unified === 'error')
    throw new Error('ChatGPT did not complete the response.');
  return {
    content,
    finishReason: finish.finishReason,
    usage: finish.usage,
    providerMetadata: finish.providerMetadata,
    request: result.request,
    response,
    warnings,
  };
}

export function createChatGPTLanguageModel(
  config: Pick<AiBackendConfig, 'settingsPath'>,
  modelId: string,
  auth: ChatGPTAuth = getChatGPTAuth(config)
): LanguageModelV4 {
  const sessionVersion = auth.getSessionVersion();
  function assertSession() {
    if (auth.getSessionVersion() !== sessionVersion)
      throw new Error('ChatGPT account changed. Start a new request.');
  }
  const provider = createOpenAI({
    // The SDK requires an API key value, but this placeholder is overwritten
    // backend-side on every request. A user's OpenAI API key is never used.
    apiKey: 'nota-chatgpt-oauth',
    baseURL: 'https://api.openai.com/v1',
    fetch: async (input, init) => {
      assertSession();
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (
        url !== RESPONSES ||
        init?.method !== 'POST' ||
        typeof init.body !== 'string'
      )
        throw new Error('Unsupported ChatGPT inference request.');
      const payload = prepareChatGPTRequest(JSON.parse(init.body));
      return requireCompletedStream(
        await auth.fetchAuthorized(RESPONSES, {
          ...init,
          body: JSON.stringify(payload),
        })
      );
    },
  });
  const model = provider.responses(modelId);
  const doStream = async (options: LanguageModelV4CallOptions) => {
    assertSession();
    if (!auth.getCachedModels().some(model => model.id === modelId))
      throw new Error(
        'Refresh the ChatGPT model catalog and select an available model.'
      );
    let result: LanguageModelV4StreamResult;
    try {
      result = await model.doStream(prepareOptions(options));
    } catch (error) {
      throw responseError(error);
    }
    const reader = result.stream.getReader();
    return {
      ...result,
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        async pull(controller) {
          try {
            const item = await reader.read();
            if (item.done) controller.close();
            else
              controller.enqueue(
                item.value.type === 'error'
                  ? { type: 'error', error: responseError(item.value.error) }
                  : item.value
              );
          } catch (error) {
            controller.error(responseError(error));
          }
        },
        async cancel(reason) {
          await reader.cancel(reason);
        },
      }),
    };
  };
  return {
    specificationVersion: 'v4',
    provider: 'chatgpt',
    modelId,
    supportedUrls: model.supportedUrls,
    doStream,
    doGenerate: async options => aggregate(await doStream(options)),
  };
}
