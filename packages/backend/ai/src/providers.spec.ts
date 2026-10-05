import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, PROVIDER_NAMES } from './config';
import { requiredFilesFor } from './model-registry';
import { AiModelRouter } from './providers';

const environmentKeys = [
  'NOTA_AI_LOCAL_BASE_URL',
  'NOTA_AI_LOCAL_MODEL',
  'NOTA_AI_PROVIDER',
  'NOTA_AI_SETTINGS_PATH',
  'NOTA_AI_WORKSPACE_ROOT',
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map(key => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;
const temporaryRoots: string[] = [];

async function installLocalOnnxModel(workspaceRoot: string, modelId: string) {
  const modelRoot = path.join(workspaceRoot, '.nota', 'models', modelId);
  for (const fileName of requiredFilesFor(modelId)) {
    const filePath = path.join(modelRoot, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'fixture');
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await Promise.all(
    temporaryRoots.splice(0).map(root =>
      rm(root, {
        force: true,
        recursive: true,
      })
    )
  );
});

describe('AI model catalog', () => {
  it.each(['local', 'google'] as const)(
    'migrates retired managed Qwen selections with %s as default',
    async defaultProvider => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), 'nota-qwen-migration-')
      );
      temporaryRoots.push(workspaceRoot);
      const newModel = 'qwen3.5-0.8b-onnx-q4f16';
      await installLocalOnnxModel(workspaceRoot, newModel);
      process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
      process.env.NOTA_AI_SETTINGS_PATH = path.join(
        workspaceRoot,
        'settings.json'
      );
      const router = new AiModelRouter({ ...loadConfig(), defaultProvider });
      for (const requested of [
        'qwen3-0.6b-onnx-q4f16',
        'local:qwen3-0.6b-onnx-q4f16',
      ]) {
        expect(router.select(requested)).toMatchObject({
          provider: 'local',
          modelId: newModel,
          runtime: 'local-onnx',
        });
      }
      expect(router.select('google:qwen3-0.6b-onnx-q4f16')).toMatchObject({
        provider: 'google',
        modelId: 'qwen3-0.6b-onnx-q4f16',
        runtime: 'hosted',
      });
    }
  );
  it('combines installed ONNX and discovered local endpoint models', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-catalog-')
    );
    temporaryRoots.push(workspaceRoot);
    const onnxModelId = 'qwen3.5-0.8b-onnx-q4f16';
    await installLocalOnnxModel(workspaceRoot, onnxModelId);

    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://local-models.test/v1';
    process.env.NOTA_AI_LOCAL_MODEL = 'configured-local';
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ data: [{ id: 'gpt-oss:20b' }, { id: 'llama3.2' }] })
      )
    );

    const config = loadConfig();
    config.openaiApiKey = 'configured-openai-key';
    config.openaiModel = 'configured-local';
    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery();

    expect(catalog.optionalModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `local:${onnxModelId}`,
          readiness: 'unverified',
          reasoningLevels: ['none'],
          selectable: true,
          supportsImageAttachments: false,
        }),
        expect.objectContaining({ id: 'local:configured-local' }),
        expect.objectContaining({ id: 'openai:configured-local' }),
        expect.objectContaining({
          id: 'local:gpt-oss:20b',
          reasoningLevels: ['none', 'minimal', 'low', 'medium', 'high'],
          supportsImageAttachments: true,
        }),
        expect.objectContaining({ id: 'local:llama3.2' }),
      ])
    );
    expect(catalog.defaultModel).toBe('local:configured-local');
    expect(router.select('local:gpt-oss:20b')).toMatchObject({
      modelId: 'gpt-oss:20b',
      provider: 'local',
      runtime: 'openai-compatible-local',
    });
    expect(router.select('openai:configured-local')).toMatchObject({
      modelId: 'configured-local',
      provider: 'openai',
      runtime: 'hosted',
    });
    expect(router.select(`local:${onnxModelId}`)).toMatchObject({
      modelId: onnxModelId,
      provider: 'local',
      runtime: 'local-onnx',
    });
  });

  it('only publishes usable configured providers and installed ONNX models', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-availability-')
    );
    temporaryRoots.push(workspaceRoot);
    const onnxModelId = 'qwen3.5-0.8b-onnx-q4f16';
    await installLocalOnnxModel(workspaceRoot, onnxModelId);

    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://offline-models.test/v1';
    process.env.NOTA_AI_LOCAL_MODEL = onnxModelId;
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    );

    const config = loadConfig();
    config.openaiApiKey = '';
    config.anthropicApiKey = '';
    config.googleApiKey = '';
    config.defaultProvider = 'openai';
    for (const provider of Object.values(config.compatibleProviders)) {
      provider.apiKey = '';
    }
    config.compatibleProviders.custom.baseUrl = '';
    config.compatibleProviders.custom.model = '';

    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery();

    expect(catalog.optionalModels).toEqual([
      expect.objectContaining({ id: `local:${onnxModelId}` }),
    ]);
    expect(
      catalog.optionalModels.every(
        model => !!model.id && !model.id.endsWith(':')
      )
    ).toBe(true);
    expect(catalog.optionalModels.map(model => model.id)).not.toContain(
      `openai:${config.openaiModel}`
    );
    expect(catalog.defaultModel).toBe('');
    expect(() => router.select()).toThrow('configured provider: openai');
  });

  it('does not make an undownloaded ONNX model the catalog default', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-no-default-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://offline-models.test/v1';
    process.env.NOTA_AI_LOCAL_MODEL = 'gemma-4-e2b-it-onnx-q4f16';
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    );

    const config = loadConfig();
    config.openaiApiKey = '';
    config.anthropicApiKey = '';
    config.googleApiKey = '';
    for (const provider of Object.values(config.compatibleProviders)) {
      provider.apiKey = '';
    }
    config.compatibleProviders.custom.baseUrl = '';
    config.compatibleProviders.custom.model = '';

    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery();

    expect(catalog.optionalModels).toEqual([]);
    expect(catalog.defaultModel).toBe('');
    expect(() => router.select()).toThrow('Download or check a local model');
  });

  it('discovers arbitrary custom endpoint models without publishing a blank configured id', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-custom-model-catalog-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://offline-local.test/v1';
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes('custom-models.test')
          ? Response.json({ models: [{ name: 'custom-thinking:latest' }] })
          : new Response(null, { status: 503 })
      )
    );

    const config = loadConfig();
    config.compatibleProviders.custom = {
      apiKey: '',
      baseUrl: 'http://custom-models.test/v1',
      model: '',
    };
    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery();

    expect(catalog.optionalModels).toEqual([
      expect.objectContaining({
        id: 'custom:custom-thinking:latest',
        name: 'Custom custom-thinking:latest',
        readiness: 'ready',
        selectable: true,
      }),
    ]);
    expect(catalog.optionalModels.map(model => model.id)).not.toContain(
      'custom:'
    );
    expect(router.select('custom-thinking:latest')).toMatchObject({
      modelId: 'custom-thinking:latest',
      provider: 'custom',
      runtime: 'hosted',
    });
  });

  it('clears stale endpoint models when provider settings refresh', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-refresh-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://first-models.test/v1';
    process.env.NOTA_AI_LOCAL_MODEL = 'first-configured';
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes('first-models.test')
        ? Response.json({ data: [{ id: 'first-discovered' }] })
        : Response.json({ data: [{ id: 'second-discovered' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = loadConfig();
    const router = new AiModelRouter(config);
    const firstCatalog = await router.modelsWithDiscovery();
    expect(firstCatalog.optionalModels.map(model => model.id)).toEqual(
      expect.arrayContaining([
        'local:first-configured',
        'local:first-discovered',
      ])
    );

    config.localBaseUrl = 'http://second-models.test/v1';
    config.localModel = 'second-configured';
    router.refresh();
    expect(router.models().optionalModels.map(model => model.id)).not.toEqual(
      expect.arrayContaining([
        'local:first-configured',
        'local:first-discovered',
      ])
    );

    const secondCatalog = await router.modelsWithDiscovery();
    expect(secondCatalog.optionalModels.map(model => model.id)).toEqual(
      expect.arrayContaining([
        'local:second-configured',
        'local:second-discovered',
      ])
    );
    expect(secondCatalog.optionalModels.map(model => model.id)).not.toContain(
      'local:first-discovered'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('routes legacy configured and discovered local ids before name heuristics', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-legacy-routing-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_PROVIDER = 'openai';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://legacy-models.test/v1';
    process.env.NOTA_AI_LOCAL_MODEL = 'gpt-local-configured';
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ data: [{ id: 'gpt-local-discovered' }] })
      )
    );

    const config = loadConfig();
    const router = new AiModelRouter(config);
    await router.modelsWithDiscovery();

    expect(router.select('gpt-local-configured')).toMatchObject({
      modelId: 'gpt-local-configured',
      provider: 'local',
      runtime: 'openai-compatible-local',
    });
    expect(router.select('gpt-local-discovered')).toMatchObject({
      modelId: 'gpt-local-discovered',
      provider: 'local',
      runtime: 'openai-compatible-local',
    });
    expect(router.select('gpt-5-mini')).toMatchObject({
      modelId: 'gpt-5-mini',
      provider: 'openai',
      runtime: 'hosted',
    });
  });

  it('advertises a failed local ONNX probe as unavailable and rejects it', async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-model-failed-probe-')
    );
    temporaryRoots.push(workspaceRoot);
    const onnxModelId = 'qwen3.5-0.8b-onnx-q4f16';
    await installLocalOnnxModel(workspaceRoot, onnxModelId);

    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_LOCAL_BASE_URL = 'http://offline-models.test/v1';
    process.env.NOTA_AI_LOCAL_MODEL = onnxModelId;
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    );

    const config = loadConfig();
    config.openaiApiKey = '';
    config.anthropicApiKey = '';
    config.googleApiKey = '';
    for (const provider of Object.values(config.compatibleProviders)) {
      provider.apiKey = '';
    }
    config.compatibleProviders.custom.baseUrl = '';

    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery([
      {
        deviceFit: 'fits',
        downloadStatus: 'downloaded',
        id: onnxModelId,
        releaseState: 'ready',
        runtimeProbe: {
          canLoad: false,
          message: 'The ONNX graph failed to initialize.',
          runtimeAvailable: true,
          status: 'failed',
        },
        type: 'text',
      },
    ]);

    expect(catalog.optionalModels).toEqual([
      expect.objectContaining({
        id: `local:${onnxModelId}`,
        readiness: 'unavailable',
        readinessMessage: 'The ONNX graph failed to initialize.',
        selectable: false,
      }),
    ]);
    expect(catalog.defaultModel).toBe('');
    expect(() => router.select(`local:${onnxModelId}`)).toThrow(
      'The ONNX graph failed to initialize.'
    );
  });
});

describe('provider-scoped default selection', () => {
  async function createConfig() {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'nota-provider-privacy-')
    );
    temporaryRoots.push(workspaceRoot);
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    const config = loadConfig();
    config.defaultProvider = 'local';
    config.localModel = 'gemma-4-e2b-it-onnx-q4f16';
    config.localBaseUrl = 'http://offline-local.test/v1';
    config.openaiApiKey = 'configured-openai-key';
    config.openaiModel = 'gpt-5-mini';
    config.anthropicApiKey = '';
    config.googleApiKey = '';
    for (const provider of Object.values(config.compatibleProviders)) {
      provider.apiKey = '';
    }
    config.compatibleProviders.custom.baseUrl = 'http://offline-custom.test/v1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    );
    return config;
  }

  it('does not select hosted when the local default is missing and a hosted key is saved', async () => {
    const config = await createConfig();
    const router = new AiModelRouter(config);
    const beforeDiscovery = router.models();
    const catalog = await router.modelsWithDiscovery();

    for (const models of [beforeDiscovery, catalog]) {
      expect(models.defaultModel).toBe('');
      expect(models.optionalModels).toEqual([
        expect.objectContaining({
          id: 'openai:gpt-5-mini',
          selectable: true,
        }),
      ]);
    }
    for (const requestedModel of [undefined, '', '   ']) {
      expect(() => router.select(requestedModel)).toThrow(
        'configured provider: local'
      );
      expect(() => router.select(requestedModel)).toThrow('AI Settings');
    }
  });

  it('does not select hosted when the local default fails its runtime probe', async () => {
    const config = await createConfig();
    await installLocalOnnxModel(config.workspaceRoot, config.localModel);
    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery([
      {
        id: config.localModel,
        type: 'text',
        downloadStatus: 'downloaded',
        runtimeProbe: {
          canLoad: false,
          message: 'The ONNX graph failed to initialize.',
          runtimeAvailable: true,
          status: 'failed',
        },
      },
    ]);

    expect(catalog.defaultModel).toBe('');
    expect(catalog.optionalModels).toEqual([
      expect.objectContaining({ id: 'openai:gpt-5-mini', selectable: true }),
      expect.objectContaining({
        id: `local:${config.localModel}`,
        readiness: 'unavailable',
        selectable: false,
      }),
    ]);
    expect(() => router.select()).toThrow('configured provider: local');
    expect(() => router.select(`local:${config.localModel}`)).toThrow(
      'The ONNX graph failed to initialize.'
    );
  });

  it('uses a ready local alternative before a saved hosted provider', async () => {
    const config = await createConfig();
    const alternativeModel = 'qwen3.5-0.8b-onnx-q4f16';
    await installLocalOnnxModel(config.workspaceRoot, alternativeModel);
    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery([
      {
        id: alternativeModel,
        type: 'text',
        downloadStatus: 'downloaded',
        runtimeProbe: {
          canLoad: true,
          message: 'Ready.',
          runtimeAvailable: true,
          status: 'available',
        },
      },
    ]);

    expect(catalog.defaultModel).toBe(`local:${alternativeModel}`);
    expect(catalog.optionalModels).toEqual([
      expect.objectContaining({ id: 'openai:gpt-5-mini', selectable: true }),
      expect.objectContaining({
        id: `local:${alternativeModel}`,
        readiness: 'ready',
        selectable: true,
      }),
    ]);
    for (const requestedModel of [undefined, '', '   ']) {
      expect(router.select(requestedModel)).toMatchObject({
        modelId: alternativeModel,
        provider: 'local',
        runtime: 'local-onnx',
      });
    }
  });

  it('allows an explicitly qualified hosted model when the local default is unavailable', async () => {
    const config = await createConfig();
    const router = new AiModelRouter(config);
    await router.modelsWithDiscovery();

    expect(router.select('openai:gpt-5-mini')).toMatchObject({
      modelId: 'gpt-5-mini',
      provider: 'openai',
      runtime: 'hosted',
    });
    expect(config.defaultProvider).toBe('local');
    expect(router.models().defaultModel).toBe('');
  });

  it.each(PROVIDER_NAMES.filter(provider => provider !== 'local'))(
    'does not switch from unavailable %s to another provider',
    async provider => {
      const config = await createConfig();
      config.defaultProvider = provider;
      config.anthropicApiKey = 'configured-anthropic-key';
      if (provider === 'openai') config.openaiApiKey = '';
      if (provider === 'anthropic') config.anthropicApiKey = '';
      await installLocalOnnxModel(config.workspaceRoot, config.localModel);
      const router = new AiModelRouter(config);
      const catalog = await router.modelsWithDiscovery();

      expect(catalog.optionalModels.some(model => model.selectable)).toBe(true);
      expect(catalog.defaultModel).toBe('');
      expect(() => router.select()).toThrow(`configured provider: ${provider}`);
    }
  );

  it('uses a discovered alternative from the selected custom provider', async () => {
    const config = await createConfig();
    config.defaultProvider = 'custom';
    config.compatibleProviders.custom.model = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes('offline-custom.test')
          ? Response.json({ data: [{ id: 'custom-thinking:latest' }] })
          : new Response(null, { status: 503 })
      )
    );
    const router = new AiModelRouter(config);
    const catalog = await router.modelsWithDiscovery();

    expect(catalog.defaultModel).toBe('custom:custom-thinking:latest');
    expect(catalog.optionalModels).toEqual([
      expect.objectContaining({ id: 'openai:gpt-5-mini', selectable: true }),
      expect.objectContaining({
        id: 'custom:custom-thinking:latest',
        selectable: true,
      }),
    ]);
    expect(router.select()).toMatchObject({
      modelId: 'custom-thinking:latest',
      provider: 'custom',
      runtime: 'hosted',
    });
  });
});
