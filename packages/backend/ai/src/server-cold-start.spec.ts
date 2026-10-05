import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSttProviderManifests, selectMeetingSttProvider } from './meetings';
import { localModelById, requiredFilesFor } from './model-registry';
import { createServer } from './server';

vi.mock('./device-memory', () => ({
  availableMemoryBytes: () => 64 * 1024 ** 3,
}));

const originalEnvironment = {
  backendToken: process.env.NOTA_AI_BACKEND_TOKEN,
  meetingProvider: process.env.NOTA_MEETING_STT_PROVIDER,
  localModel: process.env.NOTA_AI_LOCAL_MODEL,
  provider: process.env.NOTA_AI_PROVIDER,
  seededModelRoot: process.env.NOTA_AI_SEEDED_MODEL_ROOT,
  settingsPath: process.env.NOTA_AI_SETTINGS_PATH,
  workspaceRoot: process.env.NOTA_AI_WORKSPACE_ROOT,
};

let temporaryRoot = '';

afterEach(async () => {
  for (const [name, value] of Object.entries({
    NOTA_AI_BACKEND_TOKEN: originalEnvironment.backendToken,
    NOTA_AI_LOCAL_MODEL: originalEnvironment.localModel,
    NOTA_AI_PROVIDER: originalEnvironment.provider,
    NOTA_AI_SEEDED_MODEL_ROOT: originalEnvironment.seededModelRoot,
    NOTA_AI_SETTINGS_PATH: originalEnvironment.settingsPath,
    NOTA_AI_WORKSPACE_ROOT: originalEnvironment.workspaceRoot,
    NOTA_MEETING_STT_PROVIDER: originalEnvironment.meetingProvider,
  })) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  if (temporaryRoot) {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

describe('AI backend cold start', () => {
  it('recommends Whistle on Apple Silicon and keeps Apple Speech manual-only', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-ai-stt-auto-'));
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      '.nota',
      'ai-settings.json'
    );
    process.env.NOTA_AI_BACKEND_TOKEN = 'native-stt-auto-token';
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
    process.env.NOTA_MEETING_STT_PROVIDER = 'auto';

    const { config } = createServer();
    const providers = await getSttProviderManifests(config, 'darwin');
    expect(
      providers.find(provider => provider.id === 'nemotron-sherpa')
    ).toMatchObject({
      name: 'Nemotron 3.5 — Fast live captions',
      defaultForPlatform: process.arch !== 'arm64',
      notes: expect.stringContaining('32 ready locales'),
    });
    expect(
      providers.find(provider => provider.id === 'parakeet-sherpa')
        ?.defaultForPlatform
    ).toBe(false);
    expect(
      providers.find(provider => provider.id === 'apple-speechanalyzer')
    ).toMatchObject({
      name: 'Apple System Speech — Manual only',
      notes: expect.stringContaining('Apple-supported'),
    });
    const availableProviders = providers.map(provider =>
      provider.id === 'parakeet-sherpa' ||
      provider.id === 'apple-speechanalyzer'
        ? { ...provider, available: true, canProduceTranscript: true }
        : provider
    );

    const selection = selectMeetingSttProvider({
      config,
      platform: 'darwin',
      providers: availableProviders,
      requestedProviderId: 'auto',
    });
    expect(selection.error).toBeNull();
    expect(selection.provider?.id).toBe('parakeet-sherpa');

    const nativeFallbackProviders = providers.map(provider =>
      provider.id === 'apple-speechanalyzer' ||
      provider.id === 'nemotron-sherpa'
        ? { ...provider, available: true, canProduceTranscript: true }
        : { ...provider, available: false, canProduceTranscript: false }
    );
    config.meetingSttProviderId = 'apple-speechanalyzer';
    const autoFallback = selectMeetingSttProvider({
      config,
      platform: 'darwin',
      providers: nativeFallbackProviders,
      requestedProviderId: 'auto',
    });
    expect(autoFallback.provider?.id).toBe('nemotron-sherpa');

    const explicitApple = selectMeetingSttProvider({
      config,
      platform: 'darwin',
      providers: nativeFallbackProviders,
      requestedProviderId: 'apple-speechanalyzer',
    });
    expect(explicitApple.provider?.id).toBe('apple-speechanalyzer');
  });

  it.each(['darwin', 'win32', 'linux'] as const)(
    'installs Nemotron and Tiny before ready and chooses native streaming on %s',
    async platform => {
      temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), 'nota-ai-seed-pair-')
      );
      const workspaceRoot = path.join(temporaryRoot, 'workspace');
      const seedRoot = path.join(temporaryRoot, 'seed');
      const modelIds = [
        'sherpa-nemotron-3.5-streaming-560ms-int8',
        'whisper-tiny-en-onnx-q4',
      ];
      for (const modelId of modelIds) {
        for (const fileName of requiredFilesFor(modelId)) {
          const filePath = path.join(seedRoot, modelId, fileName);
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, `seed:${fileName}`);
        }
      }
      process.env.NOTA_AI_BACKEND_TOKEN = 'seed-pair-token';
      process.env.NOTA_AI_SEEDED_MODEL_ROOT = seedRoot;
      process.env.NOTA_AI_SETTINGS_PATH = path.join(
        workspaceRoot,
        '.nota',
        'ai-settings.json'
      );
      process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
      process.env.NOTA_MEETING_STT_PROVIDER = 'auto';

      const { config, ready } = createServer();
      await ready;
      for (const modelId of modelIds) {
        for (const fileName of requiredFilesFor(modelId)) {
          await expect(
            stat(path.join(workspaceRoot, '.nota', 'models', modelId, fileName))
          ).resolves.toMatchObject({});
        }
      }
      const providers = await getSttProviderManifests(config, platform);
      for (const modelId of modelIds) {
        expect(
          providers.find(provider => provider.modelId === modelId)?.readiness
            ?.modelComplete
        ).toBe(true);
      }
      expect(
        providers
          .filter(provider => provider.defaultForPlatform)
          .map(provider => provider.id)
      ).toEqual([
        platform !== 'darwin' || process.arch === 'arm64'
          ? 'cactus-whistle'
          : 'nemotron-sherpa',
      ]);

      // Synthetic files test seed installation, not native inference or target OS support.
      const selectable = providers.map(provider => ({
        ...provider,
        available: modelIds.includes(provider.modelId ?? ''),
        canProduceTranscript: modelIds.includes(provider.modelId ?? ''),
      }));
      expect(
        selectMeetingSttProvider({ config, platform, providers: selectable })
      ).toMatchObject({
        error: null,
        provider: { id: 'nemotron-sherpa' },
        requestedProviderId: 'auto',
      });
      config.meetingSttProviderId = 'whisper-tiny-en-onnx';
      expect(
        selectMeetingSttProvider({ config, platform, providers: selectable })
          .provider?.id
      ).toBe('whisper-tiny-en-onnx');
    }
  );

  it.each(['darwin', 'win32', 'linux'] as const)(
    'installs bundled Whisper before ready on %s, skips an unavailable Auto preference, and keeps explicit selection strict',
    async platform => {
      temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-ai-cold-'));
      const workspaceRoot = path.join(temporaryRoot, 'workspace');
      const seedRoot = path.join(temporaryRoot, 'seed');
      const modelId = 'whisper-tiny-en-onnx-q4';
      const model = localModelById(modelId);
      expect(model?.type).toBe('stt');

      for (const fileName of requiredFilesFor(modelId)) {
        const filePath = path.join(seedRoot, modelId, fileName);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, `seed:${fileName}`);
      }

      process.env.NOTA_AI_BACKEND_TOKEN = 'cold-start-token';
      process.env.NOTA_AI_SEEDED_MODEL_ROOT = seedRoot;
      process.env.NOTA_AI_SETTINGS_PATH = path.join(
        workspaceRoot,
        '.nota',
        'ai-settings.json'
      );
      process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
      process.env.NOTA_MEETING_STT_PROVIDER = 'nemotron-onnx';

      const { config, ready } = createServer();
      await ready;
      expect(config.meetingSttProviderId).toBe('nemotron-sherpa');
      expect(config.meetingSttModelId).toBe(
        'sherpa-nemotron-3.5-streaming-560ms-int8'
      );

      for (const fileName of requiredFilesFor(modelId)) {
        await expect(
          stat(path.join(workspaceRoot, '.nota', 'models', modelId, fileName))
        ).resolves.toMatchObject({});
      }

      const providers = await getSttProviderManifests(config, platform);
      const unavailablePreference = providers.find(
        provider => provider.id === 'nemotron-sherpa'
      );
      expect(unavailablePreference).toMatchObject({
        available: false,
        canProduceTranscript: false,
        readiness: { modelComplete: false, status: 'missing_model' },
        unavailableReason: expect.any(String),
      });
      expect(
        providers.find(provider => provider.id === 'whisper-tiny-en-onnx')
          ?.readiness?.modelComplete
      ).toBe(true);

      // These synthetic seed files prove installation, not native decoding.
      // Override only Tiny's selector-facing availability to test routing
      // independently of the host runtime; leave reported readiness untouched.
      const availableProviders = providers.map(provider =>
        provider.id === 'whisper-tiny-en-onnx'
          ? { ...provider, available: true, canProduceTranscript: true }
          : provider
      );

      const selection = selectMeetingSttProvider({
        config,
        platform,
        providers: availableProviders,
        requestedProviderId: 'auto',
      });
      expect(selection).toMatchObject({
        error: null,
        provider: { id: 'whisper-tiny-en-onnx', modelId },
        requestedProviderId: 'auto',
      });

      const explicitSelection = selectMeetingSttProvider({
        config,
        platform,
        providers: availableProviders,
        requestedProviderId: 'nemotron-sherpa',
      });
      expect(explicitSelection).toEqual({
        error: unavailablePreference?.unavailableReason,
        provider: null,
        requestedProviderId: 'nemotron-sherpa',
      });
    }
  );

  it('refreshes the first-chat catalog after installing a seeded text model', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-ai-cold-text-'));
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const seedRoot = path.join(temporaryRoot, 'seed');
    const modelId = 'qwen3.5-0.8b-onnx-q4f16';

    for (const fileName of requiredFilesFor(modelId)) {
      const filePath = path.join(seedRoot, modelId, fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `seed:${fileName}`);
    }

    process.env.NOTA_AI_BACKEND_TOKEN = 'cold-start-text-token';
    process.env.NOTA_AI_LOCAL_MODEL = modelId;
    process.env.NOTA_AI_PROVIDER = 'local';
    process.env.NOTA_AI_SEEDED_MODEL_ROOT = seedRoot;
    process.env.NOTA_AI_SETTINGS_PATH = path.join(
      workspaceRoot,
      '.nota',
      'ai-settings.json'
    );
    process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;

    const { app } = createServer();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });

    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      // Send the first consumer request immediately. The startup middleware
      // must wait for both seed installation and catalog-health refresh.
      const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
        body: JSON.stringify({
          operationName: 'createCopilotSessionWithHistory',
          variables: {
            options: {
              promptName: 'Chat With Nota AI',
              workspaceId: 'cold-start-workspace',
            },
          },
        }),
        headers: {
          'content-type': 'application/json',
          'x-nota-backend-token': 'cold-start-text-token',
        },
        method: 'POST',
      });
      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          createCopilotSessionWithHistory: {
            model: `local:${modelId}`,
            optionalModels: expect.arrayContaining([`local:${modelId}`]),
          },
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    }
  });
});
