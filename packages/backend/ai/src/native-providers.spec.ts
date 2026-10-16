import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { generateText, stepCountIs, streamText, tool } from 'ai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

import {
  loadConfig,
  OPENAI_COMPATIBLE_PROVIDER_NAMES,
  saveConfig,
  updateConfig,
} from './config';
import * as nativeProviders from './native-providers';
import { providerConfigurationError } from './native-providers';
import { AiModelRouter } from './providers';
import { resolveReasoning } from './reasoning';

// Resolve from Vertex: it can carry a different google-auth-library version
// from the root. Mock that exact implementation before any auth operation.
const vertexRequire = createRequire(
  import.meta.resolve('@ai-sdk/google-vertex')
);
const { GoogleAuth } = vertexRequire(
  'google-auth-library'
) as typeof import('google-auth-library');

const chatgpt = vi.hoisted(() => ({
  connected: false,
  models: [] as Array<{ id: string; name: string }>,
}));
vi.mock('./chatgpt-auth', () => ({
  getChatGPTAuth: () => ({
    status: () => ({
      connected: chatgpt.connected,
      planEnabled: chatgpt.connected,
    }),
    getCachedModels: () => chatgpt.models,
  }),
}));
vi.mock('./chatgpt-provider', () => ({ createChatGPTLanguageModel: vi.fn() }));

let root: string;
beforeEach(async () => {
  vi.spyOn(GoogleAuth.prototype, 'getClient').mockResolvedValue({
    getAccessToken: async () => ({ token: 'test-adc-token' }),
  } as Awaited<ReturnType<typeof GoogleAuth.prototype.getClient>>);
  chatgpt.connected = false;
  chatgpt.models = [];
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-native-providers-'));
  vi.stubEnv('NOTA_AI_SETTINGS_PATH', path.join(root, 'settings.json'));
  vi.stubEnv('NOTA_AI_WORKSPACE_ROOT', root);
  vi.stubEnv(
    'GOOGLE_APPLICATION_CREDENTIALS',
    path.join(root, 'fixture-adc-only.json')
  );
  vi.stubEnv('CLOUDSDK_CONFIG', root);
  vi.stubEnv('NOTA_AI_PROVIDER', 'local');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function fixture() {
  const config = loadConfig();
  config.openaiApiKey = '';
  config.googleApiKey = '';
  config.anthropicApiKey = '';
  for (const settings of Object.values(config.compatibleProviders))
    Object.assign(settings, { apiKey: '', baseUrl: '', model: '' });
  return config;
}

describe('native provider parity', () => {
  test.each(
    OPENAI_COMPATIBLE_PROVIDER_NAMES.filter(
      provider => !['custom', 'openrouter'].includes(provider)
    )
  )(
    'routes an arbitrary qualified %s model through a native adapter',
    provider => {
      const config = fixture();
      Object.assign(config.compatibleProviders[provider], {
        apiKey: provider.startsWith('google-vertex-') ? '' : 'test-only-key',
        model: 'owner/model:v1',
        region: 'us-east-1',
        project: 'test-project',
        location: 'us-central1',
        resourceName: 'test-resource',
        workspaceId: 'wrkspc_test',
      });
      if (provider === 'open-responses')
        config.compatibleProviders[provider].baseUrl =
          'https://responses.test/v1/responses';
      config.defaultProvider = provider;
      const router = new AiModelRouter(config);
      const selection = router.select(`${provider}:owner/model:v1`);
      expect(selection).toMatchObject({
        provider,
        modelId: 'owner/model:v1',
        runtime: 'hosted',
      });
      expect(typeof selection.model).toBe('object');
      expect(selection.model).toMatchObject({
        specificationVersion: 'v4',
        modelId: 'owner/model:v1',
      });
      expect(router.models().optionalModels).toContainEqual(
        expect.objectContaining({
          id: `${provider}:owner/model:v1`,
          readiness: 'unverified',
          supportsImageAttachments: false,
        })
      );
      expect(router.models().defaultModel).toBe(`${provider}:owner/model:v1`);
    }
  );

  test('retains keys and cloud fields across unrelated saves and supports explicit key removal', async () => {
    const config = fixture();
    updateConfig(config, {
      defaultProvider: 'amazon-bedrock',
      compatibleProviders: {
        'amazon-bedrock': {
          apiKey: 'test-only-key',
          model: 'owner.custom:model',
          region: 'eu-west-1',
        },
      },
      chatgptModel: 'owner-codex',
    });
    updateConfig(config, {
      compatibleProviders: { 'amazon-bedrock': { model: 'owner.next:model' } },
      toolMaxSteps: 3,
    });
    saveConfig(config);
    const restored = loadConfig();
    expect(restored.compatibleProviders['amazon-bedrock']).toMatchObject({
      apiKey: 'test-only-key',
      model: 'owner.next:model',
      region: 'eu-west-1',
    });
    expect(restored.chatgptModel).toBe('owner-codex');
    const persisted = JSON.parse(await readFile(config.settingsPath, 'utf8'));
    expect(persisted.settings.defaultProvider).toBe('amazon-bedrock');
    updateConfig(restored, {
      compatibleProviders: { 'amazon-bedrock': { apiKey: '' } },
    });
    expect(restored.compatibleProviders['amazon-bedrock'].apiKey).toBe('');
    expect(restored.compatibleProviders['amazon-bedrock'].region).toBe(
      'eu-west-1'
    );
  });

  test.each([
    'google-vertex-anthropic',
    'google-vertex-maas',
    'google-vertex-xai',
  ] as const)(
    '%s requires ADC project and location and rejects unsupported API keys',
    provider => {
      const config = fixture();
      const settings = config.compatibleProviders[provider];
      expect(providerConfigurationError(provider, settings)).toContain(
        'project and location'
      );
      Object.assign(settings, {
        project: 'project-test',
        location: 'global',
        model: 'owner/model',
      });
      expect(providerConfigurationError(provider, settings)).toBeNull();
      settings.apiKey = 'unsupported-test-key';
      expect(providerConfigurationError(provider, settings)).toContain(
        'does not support API keys'
      );
      expect(() =>
        new AiModelRouter(config).select(`${provider}:owner/model`)
      ).toThrow('does not support API keys');
    }
  );

  test.each([
    ['google-vertex-anthropic', 'claude-sonnet-4-5'],
    ['google-vertex', 'gemini-3.8-flash'],
    ['google-vertex-xai', 'xai/grok-4.1-fast-reasoning'],
    ['xai', 'grok-vision'],
    ['openrouter', 'openai/gpt-4o'],
    ['ai-gateway', 'openai/gpt-5'],
    ['custom', 'gpt-4o'],
  ] as const)('preserves known %s image-capable models', (provider, model) => {
    const config = fixture();
    Object.assign(config.compatibleProviders[provider], {
      apiKey: provider.startsWith('google-vertex-') ? '' : 'test',
      project: 'test-project',
      location: 'global',
      model,
      baseUrl: provider === 'custom' ? 'https://custom.test/v1' : '',
    });
    expect(new AiModelRouter(config).models().optionalModels).toContainEqual(
      expect.objectContaining({
        id: `${provider}:${model}`,
        supportsImageAttachments: true,
      })
    );
    config.compatibleProviders[provider].model = 'owner/gpt-4o';
    expect(new AiModelRouter(config).models().optionalModels).toContainEqual(
      expect.objectContaining({
        id: `${provider}:owner/gpt-4o`,
        supportsImageAttachments: false,
      })
    );
  });

  test('advertises known ChatGPT image families from the account catalog', () => {
    const config = fixture();
    chatgpt.connected = true;
    chatgpt.models = [{ id: 'gpt-5-codex', name: 'GPT' }];
    config.chatgptModel = 'gpt-5-codex';
    expect(new AiModelRouter(config).models().optionalModels).toContainEqual(
      expect.objectContaining({
        id: 'chatgpt:gpt-5-codex',
        supportsImageAttachments: true,
      })
    );
  });

  test.each([
    ['xai', 'grok-4-1'],
    ['google-vertex-xai', 'xai/grok-4-1'],
    ['openrouter', 'xai/grok-4-1'],
    ['ai-gateway', 'xai/grok-4-1'],
    ['custom', 'grok-4-1'],
    ['openai', 'o1-mini'],
    ['openai', 'o1-preview-2024-09-12'],
    ['azure', 'o1-mini'],
    ['chatgpt', 'o1-preview'],
    ['openrouter', 'openai/o1-mini'],
    ['ai-gateway', 'openai/o1-preview'],
    ['custom', 'o1-mini'],
  ] as const)(
    'does not advertise image input for text-only %s model %s',
    (provider, model) => {
      const config = fixture();
      if (provider === 'openai') {
        config.openaiApiKey = 'test';
        config.openaiModel = model;
      } else if (provider === 'chatgpt') {
        chatgpt.connected = true;
        chatgpt.models = [{ id: model, name: model }];
        config.chatgptModel = model;
      } else {
        Object.assign(config.compatibleProviders[provider], {
          apiKey: provider === 'google-vertex-xai' ? '' : 'test',
          project: 'test-project',
          location: 'global',
          resourceName: 'test-resource',
          baseUrl: provider === 'custom' ? 'https://custom.test/v1' : '',
          model,
        });
      }
      expect(new AiModelRouter(config).models().optionalModels).toContainEqual(
        expect.objectContaining({
          id: `${provider}:${model}`,
          supportsImageAttachments: false,
        })
      );
    }
  );

  test.each(['grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning'])(
    'retains image input for known xAI variant %s',
    model => {
      const config = fixture();
      Object.assign(config.compatibleProviders.xai, { apiKey: 'test', model });
      expect(new AiModelRouter(config).models().optionalModels).toContainEqual(
        expect.objectContaining({
          id: `xai:${model}`,
          supportsImageAttachments: true,
        })
      );
    }
  );

  test('loads shared Vertex project/location defaults and provider-specific overrides', () => {
    vi.stubEnv('GOOGLE_VERTEX_PROJECT', 'shared-project');
    vi.stubEnv('GOOGLE_VERTEX_LOCATION', 'global');
    vi.stubEnv('NOTA_AI_GOOGLE_VERTEX_ANTHROPIC_LOCATION', 'us-east5');
    const config = loadConfig();
    for (const provider of [
      'google-vertex-anthropic',
      'google-vertex-maas',
      'google-vertex-xai',
    ] as const) {
      expect(config.compatibleProviders[provider]).toMatchObject({
        project: 'shared-project',
        location:
          provider === 'google-vertex-anthropic' ? 'us-east5' : 'global',
      });
    }
  });

  test('persists Azure API mode and rejects invalid values without losing the saved mode', () => {
    const config = fixture();
    updateConfig(config, {
      compatibleProviders: { azure: { apiMode: 'chat' } },
    });
    updateConfig(config, {
      compatibleProviders: { azure: { model: 'custom-deployment' } },
    });
    saveConfig(config);
    expect(loadConfig().compatibleProviders.azure.apiMode).toBe('chat');
    expect(() =>
      updateConfig(config, {
        compatibleProviders: { azure: { apiMode: 'invalid' as 'chat' } },
      })
    ).toThrow('Azure API mode');
    expect(config.compatibleProviders.azure.apiMode).toBe('chat');
    vi.stubEnv('NOTA_AI_SETTINGS_PATH', path.join(root, 'fresh-settings.json'));
    vi.stubEnv('NOTA_AI_AZURE_API_MODE', 'deepseek');
    expect(loadConfig().compatibleProviders.azure.apiMode).toBe('deepseek');
  });

  test.each([undefined, 'responses', 'chat', 'deepseek'] as const)(
    'routes Azure API mode %s to its official API',
    async apiMode => {
      const config = fixture();
      Object.assign(config.compatibleProviders.azure, {
        apiKey: 'test-only-key',
        resourceName: 'test-resource',
        model: 'owner-deployment',
        apiMode,
      });
      let target = '';
      let payload: Record<string, unknown> = {};
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, options) => {
          target = String(url);
          payload = JSON.parse(String(options.body));
          return apiMode === 'chat' || apiMode === 'deepseek'
            ? Response.json({
                id: 'test',
                object: 'chat.completion',
                created: 1,
                model: 'owner-deployment',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Done.' },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                },
              })
            : Response.json({
                id: 'test',
                created_at: 1,
                model: 'owner-deployment',
                output: [
                  {
                    id: 'message-test',
                    type: 'message',
                    role: 'assistant',
                    content: [
                      { type: 'output_text', text: 'Done.', annotations: [] },
                    ],
                  },
                ],
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
              });
        })
      );
      const result = await generateText({
        model: new AiModelRouter(config).select('azure:owner-deployment').model,
        prompt: 'Hello.',
      });
      expect(result.text).toBe('Done.');
      expect(payload.model).toBe('owner-deployment');
      expect(target).toContain(
        apiMode === 'chat' || apiMode === 'deepseek'
          ? '/chat/completions'
          : '/responses'
      );
      expect(target).toContain('test-resource.openai.azure.com');
    }
  );

  test.each([
    [
      'google-vertex-anthropic',
      'claude-sonnet-4-5',
      '/publishers/anthropic/models/claude-sonnet-4-5:rawPredict',
    ],
    [
      'google-vertex-maas',
      'openai/gpt-oss-120b-maas',
      '/endpoints/openapi/chat/completions',
    ],
    [
      'google-vertex-xai',
      'xai/grok-4.1-fast-reasoning',
      '/endpoints/openapi/chat/completions',
    ],
  ] as const)(
    'sends %s requests to the official endpoint using ADC',
    async (provider, modelId, suffix) => {
      const config = fixture();
      Object.assign(config.compatibleProviders[provider], {
        project: 'test-project',
        location: 'global',
        model: modelId,
      });
      let target = '';
      let payload: Record<string, unknown> = {};
      let headers = new Headers();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url, options) => {
          target = String(url);
          payload = JSON.parse(String(options.body));
          headers = new Headers(options.headers);
          return provider === 'google-vertex-anthropic'
            ? Response.json({
                id: 'test',
                type: 'message',
                role: 'assistant',
                model: modelId,
                content: [{ type: 'text', text: 'Done.' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1, output_tokens: 1 },
              })
            : Response.json({
                id: 'test',
                object: 'chat.completion',
                created: 1,
                model: modelId,
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'Done.' },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                },
              });
        })
      );
      const result = await generateText({
        model: new AiModelRouter(config).select(`${provider}:${modelId}`).model,
        prompt: 'Hello.',
        ...resolveReasoning({ provider, modelId, runtime: 'hosted' }, 'high')
          .sdk,
      });
      expect(result.text).toBe('Done.');
      expect(target).toBe(
        `https://aiplatform.googleapis.com/v1/projects/test-project/locations/global${suffix}`
      );
      expect(headers.get('authorization')).toBe('Bearer test-adc-token');
      expect(payload).not.toHaveProperty('generationConfig');
      if (provider === 'google-vertex-anthropic') {
        expect(payload.anthropic_version).toBe('vertex-2023-10-16');
        expect(payload).not.toHaveProperty('model');
        expect(payload.thinking).toBeDefined();
      } else {
        expect(payload.model).toBe(modelId);
        if (provider === 'google-vertex-xai')
          expect(payload).not.toHaveProperty('reasoning_effort');
        else expect(payload.reasoning_effort).toBe('high');
      }
    }
  );

  test('streams Vertex Anthropic through streamRawPredict', async () => {
    const config = fixture();
    const modelId = 'claude-sonnet-4-5';
    Object.assign(config.compatibleProviders['google-vertex-anthropic'], {
      project: 'test-project',
      location: 'global',
      model: modelId,
    });
    let target = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async url => {
        target = String(url);
        const events = [
          {
            type: 'message_start',
            message: {
              id: 'test',
              type: 'message',
              role: 'assistant',
              model: modelId,
              content: [],
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Done.' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 1 },
          },
          { type: 'message_stop' },
        ];
        return new Response(
          events
            .map(
              event =>
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
            )
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } }
        );
      })
    );
    const result = streamText({
      model: new AiModelRouter(config).select(
        `google-vertex-anthropic:${modelId}`
      ).model,
      prompt: 'Hello.',
    });
    expect(await result.text).toBe('Done.');
    expect(target).toBe(
      'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/anthropic/models/claude-sonnet-4-5:streamRawPredict'
    );
  });

  test('does not discover unrelated hosted providers or require listing for a manual custom model', async () => {
    const config = fixture();
    config.defaultProvider = 'mistral';
    config.compatibleProviders.mistral = {
      apiKey: 'test-key',
      baseUrl: '',
      model: 'owner-version',
    };
    config.compatibleProviders.custom = {
      apiKey: '',
      baseUrl: 'http://custom.test/v1',
      model: 'manual-custom',
    };
    const request = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', request);
    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery();
    expect(catalog.defaultModel).toBe('mistral:owner-version');
    expect(catalog.optionalModels).toContainEqual(
      expect.objectContaining({ id: 'custom:manual-custom' })
    );
    expect(request.mock.calls.length).toBeLessThanOrEqual(2);
    await expect(router.discoverModels('mistral')).rejects.toThrow(
      'Enter the model or deployment ID'
    );
    expect(router.select('custom:manual-custom').modelId).toBe('manual-custom');
  });

  test('distinguishes cloud configuration from credentials instead of inventing shared key auth', () => {
    const settings = { apiKey: '', baseUrl: '', model: 'model' };
    expect(providerConfigurationError('azure', settings)).toContain('resource');
    expect(providerConfigurationError('amazon-bedrock', settings)).toContain(
      'region'
    );
    expect(
      providerConfigurationError('anthropic-aws', {
        ...settings,
        region: 'us-east-1',
      })
    ).toContain('workspace');
    expect(providerConfigurationError('google-vertex', settings)).toContain(
      'project'
    );
    expect(
      providerConfigurationError('google-vertex', {
        ...settings,
        project: 'owner-project',
        location: 'us-central1',
      })
    ).toBeNull();
    expect(
      providerConfigurationError('google-vertex', {
        ...settings,
        apiKey: 'test-express-key',
      })
    ).toBeNull();
  });

  test('sends Mistral model IDs through its native chat API with a mocked request', async () => {
    const config = fixture();
    config.compatibleProviders.mistral = {
      apiKey: 'test-only-key',
      baseUrl: 'https://mistral.test/v1',
      model: 'owner-model-v9',
    };
    let payload: unknown;
    let target: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        target = String(url);
        payload = JSON.parse(String(options.body));
        return Response.json({
          id: 'test',
          object: 'chat.completion',
          created: 1,
          model: 'owner-model-v9',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Done.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      })
    );
    const result = await generateText({
      model: new AiModelRouter(config).select('mistral:owner-model-v9').model,
      prompt: 'Hello',
      maxRetries: 0,
    });
    expect(result.text).toBe('Done.');
    expect(target).toBe('https://mistral.test/v1/chat/completions');
    expect(payload).toMatchObject({
      model: 'owner-model-v9',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    });
  });
  test('a native model participates in the SDK tool-result loop without a separate agent runtime', async () => {
    const config = fixture();
    config.compatibleProviders.mistral = {
      apiKey: 'test-only-key',
      baseUrl: 'https://mistral.test/v1',
      model: 'owner-model',
    };
    const bodies: Array<{
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        bodies.push(JSON.parse(String(options.body)));
        return Response.json({
          id: 'test',
          object: 'chat.completion',
          created: 1,
          model: 'owner-model',
          choices: [
            {
              index: 0,
              message:
                bodies.length === 1
                  ? {
                      role: 'assistant',
                      content: '',
                      tool_calls: [
                        {
                          id: 'call-1',
                          type: 'function',
                          function: {
                            name: 'lookup',
                            arguments: '{"query":"launch"}',
                          },
                        },
                      ],
                    }
                  : { role: 'assistant', content: 'Launch is ready.' },
              finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      })
    );
    const execute = vi.fn(async ({ query }: { query: string }) => ({
      query,
      status: 'ready',
    }));
    const result = await generateText({
      model: new AiModelRouter(config).select('mistral:owner-model').model,
      prompt: 'Look up launch',
      tools: {
        lookup: tool({ inputSchema: z.object({ query: z.string() }), execute }),
      },
      stopWhen: stepCountIs(3),
      maxRetries: 0,
    });
    expect(result.text).toBe('Launch is ready.');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ query: 'launch' });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages).toContainEqual(
      expect.objectContaining({ role: 'tool' })
    );
  });

  test('gateway discovery is selected-provider scoped, cached and reset on settings refresh', async () => {
    const config = fixture();
    config.compatibleProviders['ai-gateway'] = {
      apiKey: 'test-only-key',
      baseUrl: '',
      model: 'owner/manual',
    };
    const discover = vi
      .spyOn(nativeProviders, 'discoverGatewayModels')
      .mockResolvedValue(['owner/discovered']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const router = new AiModelRouter(config);
    await router.modelsWithDiscovery();
    expect(discover).not.toHaveBeenCalled();
    config.defaultProvider = 'ai-gateway';
    await router.modelsWithDiscovery();
    await router.modelsWithDiscovery();
    expect(discover).toHaveBeenCalledTimes(1);
    expect(router.models().defaultModel).toBe('ai-gateway:owner/manual');
    expect(router.models().optionalModels).toContainEqual(
      expect.objectContaining({ id: 'ai-gateway:owner/discovered' })
    );
    router.refresh();
    discover.mockRejectedValue(new Error('offline'));
    await router.modelsWithDiscovery();
    expect(router.models().defaultModel).toBe('ai-gateway:owner/manual');
    expect(router.models().optionalModels.map(model => model.id)).not.toContain(
      'ai-gateway:owner/discovered'
    );
    await expect(router.discoverModels('ai-gateway')).rejects.toThrow(
      'configured model can still be used'
    );
  });
  test('only offers ChatGPT models from the connected account catalog', () => {
    const config = fixture();
    config.defaultProvider = 'chatgpt';
    config.chatgptModel = 'missing-manual';
    chatgpt.connected = true;
    chatgpt.models = [{ id: 'available-codex', name: 'Available Codex' }];
    const router = new AiModelRouter(config);
    expect(router.models().optionalModels).toContainEqual(
      expect.objectContaining({
        id: 'chatgpt:missing-manual',
        selectable: false,
        readiness: 'unavailable',
      })
    );
    expect(router.models().defaultModel).toBe('chatgpt:available-codex');
    expect(() => router.select('chatgpt:missing-manual')).toThrow(
      'select an available model'
    );
    chatgpt.connected = false;
    expect(router.models().defaultModel).toBe('');
    expect(() => router.select('chatgpt:available-codex')).toThrow(
      'eligible ChatGPT'
    );
  });

  test('preserves known built-in vision families without claiming arbitrary model vision', () => {
    const config = fixture();
    config.openaiApiKey = 'test';
    config.openaiModel = 'gpt-5-mini';
    config.googleApiKey = 'test';
    config.googleModel = 'gemini-3.8-flash';
    config.anthropicApiKey = 'test';
    config.anthropicModel = 'claude-sonnet-4-5';
    const router = new AiModelRouter(config);
    const initial = router
      .models()
      .optionalModels.filter(model => !model.id.startsWith('local:'));
    expect(initial).toHaveLength(3);
    expect(initial.every(model => model.supportsImageAttachments)).toBe(true);
    config.openaiModel = 'owner-special-text-model';
    expect(
      router
        .models()
        .optionalModels.find(
          model => model.id === 'openai:owner-special-text-model'
        )?.supportsImageAttachments
    ).toBe(false);
  });
  test.each([
    ['togetherai', 'TOGETHER_API_KEY'],
    ['moonshotai', 'MOONSHOT_API_KEY'],
    ['huggingface', 'HUGGINGFACE_API_KEY'],
  ] as const)(
    'honors the official %s API key environment alias',
    (provider, name) => {
      vi.stubEnv(name, 'test-only-key');
      vi.stubEnv(`NOTA_AI_${provider.toUpperCase()}_API_KEY`, undefined);
      expect(loadConfig().compatibleProviders[provider].apiKey).toBe(
        'test-only-key'
      );
    }
  );
});
