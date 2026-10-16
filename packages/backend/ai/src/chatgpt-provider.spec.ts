import type {
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { generateText, stepCountIs, tool } from 'ai';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import type { ChatGPTAuth } from './chatgpt-auth';
import {
  createChatGPTLanguageModel,
  prepareChatGPTRequest,
} from './chatgpt-provider';

const usage = { input_tokens: 6, output_tokens: 2 };
const completed = { type: 'response.completed', response: { usage } };
const created = {
  type: 'response.created',
  response: { id: 'response-fixture', created_at: 1, model: 'fixture-chat' },
};
const textEvents = [
  created,
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'message', id: 'message-fixture' },
  },
  {
    type: 'response.output_text.delta',
    item_id: 'message-fixture',
    delta: 'Hello ',
  },
  {
    type: 'response.output_text.delta',
    item_id: 'message-fixture',
    delta: 'Nota',
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: { type: 'message', id: 'message-fixture' },
  },
];
function sse(events: unknown[], split = false) {
  const text = events
    .map(event => `data: ${JSON.stringify(event)}\r\n\r\n`)
    .join('');
  const chunks = split
    ? [...text].map(character => new TextEncoder().encode(character))
    : events.map(event =>
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\n\r\n`)
      );
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(chunk));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}
function fixture(events: unknown[], split = false) {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    init: RequestInit;
  }[] = [];
  let sessionVersion = 0;
  const auth = {
    getSessionVersion: () => sessionVersion,
    getCachedModels: () => [{ id: 'fixture-chat', name: 'Fixture chat' }],
    fetchAuthorized: vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string), init });
      return sse(events, split);
    }),
  } as unknown as ChatGPTAuth;
  const model = createChatGPTLanguageModel(
    { settingsPath: '/fixture/settings.json' },
    'fixture-chat',
    auth
  );
  const options: LanguageModelV4CallOptions = {
    prompt: [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: [{ type: 'text', text: 'Hi.' }] },
    ],
  };
  return {
    model,
    calls,
    options,
    auth,
    switchAccount() {
      sessionVersion++;
    },
  };
}
async function collect(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const parts: LanguageModelV4StreamPart[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return parts;
}

describe('ChatGPT Responses AI SDK transport', () => {
  test('uses native streaming for generateText, developer context, and required subscription request settings', async () => {
    const f = fixture([...textEvents, completed], true);
    const result = await f.model.doGenerate({
      ...f.options,
      temperature: 0.7,
      topP: 1,
      maxOutputTokens: 300,
      providerOptions: {
        openai: {
          previousResponseId: 'old-response',
          store: true,
          user: 'forbidden',
        },
      },
    });
    expect(result.content).toContainEqual(
      expect.objectContaining({ type: 'text', text: 'Hello Nota' })
    );
    expect(result.finishReason.unified).toBe('stop');
    expect(result.usage.inputTokens.total).toBe(6);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect(f.calls[0].body).toMatchObject({
      model: 'fixture-chat',
      store: false,
      stream: true,
    });
    for (const name of [
      'temperature',
      'top_p',
      'max_output_tokens',
      'user',
      'previous_response_id',
    ])
      expect(f.calls[0].body).not.toHaveProperty(name);
    expect(f.calls[0].body.input).toContainEqual(
      expect.objectContaining({ role: 'developer' })
    );
    expect(f.calls[0].body.input).not.toContainEqual(
      expect.objectContaining({ role: 'system' })
    );
  });

  test('maps minimal reasoning effort to low for ChatGPT Responses compatibility', () => {
    const prepared = prepareChatGPTRequest({
      model: 'gpt-5.6-luna',
      input: [{ role: 'user', content: 'Hi' }],
      reasoning: { effort: 'minimal', summary: 'detailed' },
    });
    expect(prepared.reasoning).toEqual({
      effort: 'low',
      summary: 'detailed',
    });
  });

  test('groups SDK tools into a namespace and preserves tool call names and subsequent results', async () => {
    const tool = {
      type: 'function_call',
      id: 'function-fixture',
      call_id: 'call-fixture',
      name: 'search_notes',
      namespace: 'nota',
      status: 'completed',
      arguments: '{"query":"onboarding"}',
    };
    const f = fixture([
      created,
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...tool, arguments: '' },
      },
      { type: 'response.output_item.done', output_index: 0, item: tool },
      completed,
    ]);
    const options: LanguageModelV4CallOptions = {
      ...f.options,
      tools: [
        {
          type: 'function',
          name: 'search_notes',
          description: 'Search notes',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
        },
      ],
    };
    const result = await f.model.doGenerate(options);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCallId: 'call-fixture',
        toolName: 'search_notes',
        input: '{"query":"onboarding"}',
      })
    );
    expect(f.calls[0].body.tools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'nota',
        tools: [
          expect.objectContaining({ type: 'function', name: 'search_notes' }),
        ],
      }),
    ]);
    await f.model.doGenerate({
      ...options,
      prompt: [
        ...options.prompt,
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-fixture',
              toolName: 'search_notes',
              input: { query: 'onboarding' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-fixture',
              toolName: 'search_notes',
              output: { type: 'text', value: 'Found onboarding notes.' },
            },
          ],
        },
      ],
    });
    expect(f.calls[1].body.input).toContainEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call-fixture',
        output: 'Found onboarding notes.',
      })
    );
  });

  test.each([
    {
      terminal: {
        type: 'response.failed',
        sequence_number: 9,
        response: {
          error: {
            code: 'subscription_sharing_usage_limit_exceeded',
            message: 'Fixture limit',
          },
        },
      },
      message: 'usage limit reached',
    },
    {
      terminal: {
        type: 'response.incomplete',
        response: {
          usage,
          incomplete_details: { reason: 'max_output_tokens' },
        },
      },
      message: 'incomplete response',
    },
    { terminal: undefined, message: 'before response.completed' },
  ])(
    'fails nonstream helpers on $message after partial text',
    async ({ terminal, message }) => {
      const f = fixture([...textEvents, ...(terminal ? [terminal] : [])]);
      await expect(f.model.doGenerate(f.options)).rejects.toThrow(message);
    }
  );

  test('streaming requires completed terminal event and surfaces failure instead of a successful finish', async () => {
    const f = fixture([
      ...textEvents,
      {
        type: 'response.failed',
        sequence_number: 9,
        response: {
          error: {
            code: 'subscription_sharing_usage_unavailable',
            message: 'Fixture unavailable',
          },
        },
      },
    ]);
    await expect(
      (async () => {
        const result = await f.model.doStream(f.options);
        return collect(result.stream);
      })()
    ).rejects.toThrow('plan usage is unavailable');
  });

  test('removes unsupported request fields and rejects unsupported hosted tools', () => {
    const forbidden = [
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
    const body = prepareChatGPTRequest({
      input: [{ type: 'message', role: 'system', content: 'Context' }],
      ...Object.fromEntries(forbidden.map(name => [name, true])),
    });
    forbidden.forEach(name => expect(body).not.toHaveProperty(name));
    expect(body.input).toEqual([
      { type: 'message', role: 'developer', content: 'Context' },
    ]);
    expect(() =>
      prepareChatGPTRequest({ input: [], tools: [{ type: 'tool_search' }] })
    ).toThrow('hosted tool is not supported');
    expect(() =>
      prepareChatGPTRequest({
        input: [],
        tools: [{ type: 'image_generation' }],
      })
    ).toThrow('hosted tool is not supported');
  });

  test('SDK transport errors do not expose raw response objects or credential-bearing error bodies', async () => {
    const f = fixture([]);
    vi.mocked(f.auth.fetchAuthorized).mockResolvedValueOnce(
      Response.json(
        {
          error: { message: 'Invalid bearer fixture-secret-must-stay-private' },
        },
        { status: 401 }
      )
    );
    let error: unknown;
    try {
      await f.model.doGenerate(f.options);
    } catch (value) {
      error = value;
    }
    expect(error).toMatchObject({
      message: 'ChatGPT inference failed. Retry the request.',
    });
    expect(String(error)).not.toContain('fixture-secret');
    expect(error).not.toHaveProperty('responseBody');
    expect(error).not.toHaveProperty('cause');
  });

  test('AI SDK tool execution cannot switch the account used for the next agent round', async () => {
    const call = {
      type: 'function_call',
      id: 'function-fixture',
      call_id: 'call-fixture',
      name: 'search_notes',
      namespace: 'nota',
      status: 'completed',
      arguments: '{"query":"onboarding"}',
    };
    const f = fixture([
      created,
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...call, arguments: '' },
      },
      { type: 'response.output_item.done', output_index: 0, item: call },
      completed,
    ]);
    await expect(
      generateText({
        model: f.model,
        prompt: 'Search onboarding notes.',
        stopWhen: stepCountIs(3),
        tools: {
          search_notes: tool({
            description: 'Search workspace notes.',
            inputSchema: z.object({ query: z.string() }),
            execute: async () => {
              f.switchAccount();
              return 'Found onboarding notes.';
            },
          }),
        },
      })
    ).rejects.toThrow('account changed');
    expect(f.calls).toHaveLength(1);
  });

  test('binds all rounds of a selected agent model to one account session', async () => {
    const f = fixture([...textEvents, completed]);
    await f.model.doGenerate(f.options);
    expect(f.calls).toHaveLength(1);
    f.switchAccount();
    await expect(f.model.doGenerate(f.options)).rejects.toThrow(
      'account changed'
    );
    f.switchAccount(); // Switching back must not resurrect the original turn.
    await expect(f.model.doStream(f.options)).rejects.toThrow(
      'account changed'
    );
    expect(f.calls).toHaveLength(1);
  });

  test('rejects models outside the signed-in account catalog without API-key fallback', async () => {
    const f = fixture([...textEvents, completed]);
    const model = createChatGPTLanguageModel(
      { settingsPath: '/fixture/settings.json' },
      'unavailable-model',
      f.auth
    );
    await expect(model.doGenerate(f.options)).rejects.toThrow(
      'select an available model'
    );
    expect(f.calls).toEqual([]);
  });
});
