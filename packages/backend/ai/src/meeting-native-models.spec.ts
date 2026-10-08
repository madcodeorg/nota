import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { getLocalModelRegistry, requiredFilesFor } from './model-registry';
import * as native from './native-asr';
import { createServer } from './server';

const token = 'native-model-test';
const envKeys = [
  'NOTA_AI_BACKEND_TOKEN',
  'NOTA_AI_WORKSPACE_ROOT',
  'NOTA_AI_SETTINGS_PATH',
  'NOTA_AI_SEEDED_MODEL_ROOT',
] as const;
const original = envKeys.map(key => process.env[key]);
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let root: string;
let base: string;
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-native-models-'));
  process.env.NOTA_AI_BACKEND_TOKEN = token;
  process.env.NOTA_AI_WORKSPACE_ROOT = root;
  process.env.NOTA_AI_SETTINGS_PATH = path.join(root, 'settings.json');
  process.env.NOTA_AI_SEEDED_MODEL_ROOT = path.join(root, 'no-seeds');
  server = createServer().app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterEach(async () => {
  await request('/v1/stt/apple-speech/bridge', {
    available: false,
    supportedLocales: [],
    installedLocales: [],
    systemLocale: null,
  });
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  await rm(root, { force: true, recursive: true });
  envKeys.forEach((key, i) => {
    if (original[i] === undefined) delete process.env[key];
    else process.env[key] = original[i];
  });
  vi.restoreAllMocks();
});
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
});
function request(route: string, body?: unknown) {
  return fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-nota-backend-token': token,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function install(modelId: string) {
  for (const file of requiredFilesFor(modelId)) {
    const filename = path.join(root, '.nota/models', modelId, file);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, 'native-fixture');
  }
}

describe('meeting native model integration', () => {
  test.each([
    'cactus-whistle',
    'whisper-tiny-cpp',
    'whisper-base-cpp',
    'whisper-small-cpp',
    'whisper-medium-cpp',
    'whisper-large-v3-cpp',
  ])(
    'saves, provisions and preloads %s with its own runtime',
    async providerId => {
      vi.spyOn(native, 'nativeAsrRuntimeAvailable').mockReturnValue(true);
      const preload = vi.spyOn(native, 'preloadNativeAsr').mockResolvedValue();
      const modelId =
        providerId === 'cactus-whistle'
          ? providerId
          : providerId.replace(/-cpp$/, '-q5-cpp');
      const model = getLocalModelRegistry().find(
        model => model.id === modelId
      )!;
      expect(model.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(model.fileSha256?.[model.files![0]]).toMatch(/^[a-f0-9]{64}$/);
      expect(
        (
          await request('/api/ai/settings', {
            meetingSttProviderId: providerId,
            meetingSttLanguage: 'fr',
          })
        ).status
      ).toBe(200);
      let runtime = await (await request('/v1/stt/runtime')).json();
      expect(
        runtime.providers.find((p: { id: string }) => p.id === providerId)
          .readiness.status
      ).toBe('missing_model');
      await install(modelId);
      expect(
        (await request('/v1/stt/runtime/preload', { providerId })).status
      ).toBe(200);
      expect(preload).toHaveBeenCalledWith(
        model.runtime,
        path.join(root, '.nota/models', modelId, model.files![0])
      );
      runtime = await (await request('/v1/stt/runtime')).json();
      expect(runtime.resolvedProvider).toMatchObject({
        id: providerId,
        transcriptMode: 'vad-chunk',
        readiness: { status: 'available' },
      });
      const reserved = await request('/v1/meetings/reserve', {
        workspaceId: providerId,
      });
      expect(reserved.status).toBe(200);
      const { meeting } = await reserved.json();
      expect(meeting).toMatchObject({
        providerId,
        sttModelId: modelId,
        sttLanguage: 'fr',
      });
      await request(`/v1/meetings/${meeting.id}/stop`, {});
    }
  );

  test('reports a missing helper without confusing it with a missing model', async () => {
    await install('cactus-whistle');
    vi.spyOn(native, 'nativeAsrRuntimeAvailable').mockReturnValue(false);
    const runtime = await (await request('/v1/stt/runtime')).json();
    expect(
      runtime.providers.find((p: { id: string }) => p.id === 'cactus-whistle')
    ).toMatchObject({
      canProduceTranscript: false,
      readiness: {
        status: 'missing_runtime',
        modelComplete: true,
        runtimeAvailable: false,
      },
    });
  });

  test('rejects languages outside Whistle coverage and preserves the previous setting', async () => {
    expect(
      (
        await request('/api/ai/settings', {
          meetingSttProviderId: 'cactus-whistle',
          meetingSttLanguage: 'fr',
        })
      ).status
    ).toBe(200);
    expect(
      (await request('/api/ai/settings', { meetingSttLanguage: 'ja' })).status
    ).toBe(400);
    expect(await (await request('/api/ai/settings')).json()).toMatchObject({
      meetings: { sttProviderId: 'cactus-whistle', sttLanguage: 'fr' },
    });
    expect(
      (
        await request('/api/ai/settings', {
          meetingSttProviderId: 'whisper-small-cpp',
          meetingSttLanguage: 'ja',
        })
      ).status
    ).toBe(200);
  });
});

describe('Apple device language inventory', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: 'darwin',
    });
  });
  const catalog = {
    available: true,
    supportedLocales: ['en-US', 'fr-FR', 'zh-Hant-TW'],
    installedLocales: ['en-US'],
    systemLocale: 'en-US',
  };
  test('accepts only advertised locales and waits for the selected pack to be installed', async () => {
    await request('/v1/stt/apple-speech/bridge', catalog);
    expect(
      (
        await request('/api/ai/settings', {
          meetingSttProviderId: 'apple-speechanalyzer',
          meetingSttLanguage: 'fr-FR',
        })
      ).status
    ).toBe(200);
    const runtime = await (await request('/v1/stt/runtime')).json();
    expect(
      runtime.providers.find(
        (p: { id: string }) => p.id === 'apple-speechanalyzer'
      )
    ).toMatchObject({
      languages: catalog.supportedLocales,
      installedLanguages: ['en-US'],
      readiness: { status: 'missing_model', runtimeAvailable: true },
    });
    expect(
      (
        await request('/v1/meetings/reserve', {
          providerId: 'apple-speechanalyzer',
        })
      ).status
    ).toBe(400);
    expect(
      (await request('/api/ai/settings', { meetingSttLanguage: 'ja-JP' }))
        .status
    ).toBe(400);
    expect(
      (await request('/api/ai/settings', { meetingSttLanguage: 'zh-Hant-TW' }))
        .status
    ).toBe(200);
    await request('/v1/stt/apple-speech/bridge', {
      ...catalog,
      installedLocales: catalog.supportedLocales,
    });
    const reserved = await request('/v1/meetings/reserve', {
      providerId: 'apple-speechanalyzer',
      sttLanguage: 'fr-FR',
    });
    expect(reserved.status).toBe(200);
    const { meeting } = await reserved.json();
    expect(meeting.sttLanguage).toBe('fr-FR');
    await request(`/v1/meetings/${meeting.id}/stop`, {});
  });

  test('snapshots the supported system locale when Auto is selected', async () => {
    await request('/v1/stt/apple-speech/bridge', catalog);
    await request('/api/ai/settings', {
      meetingSttProviderId: 'apple-speechanalyzer',
      meetingSttLanguage: 'auto',
    });
    const reserved = await request('/v1/meetings/reserve', {
      providerId: 'apple-speechanalyzer',
    });
    expect(reserved.status).toBe(200);
    const { meeting } = await reserved.json();
    expect(meeting.sttLanguage).toBe('en-US');
    await request('/v1/stt/apple-speech/bridge', {
      ...catalog,
      systemLocale: 'fr-FR',
    });
    expect(
      await (await request(`/v1/meetings/${meeting.id}`)).json()
    ).toMatchObject({ meeting: { sttLanguage: 'en-US' } });
    await request(`/v1/meetings/${meeting.id}/stop`, {});
  });
});

test('keeps Apple speech unsupported on non-Mac hosts even if a bridge advertises language packs', async () => {
  Object.defineProperty(process, 'platform', {
    ...originalPlatform,
    value: 'linux',
  });
  await request('/v1/stt/apple-speech/bridge', {
    available: true,
    supportedLocales: ['en-US'],
    installedLocales: ['en-US'],
    systemLocale: 'en-US',
  });
  const runtime = await (await request('/v1/stt/runtime')).json();
  expect(
    runtime.providers.find(
      (provider: { id: string }) => provider.id === 'apple-speechanalyzer'
    )
  ).toMatchObject({
    canProduceTranscript: false,
    readiness: { status: 'unsupported', runtimeAvailable: false },
  });
  expect(
    (
      await request('/v1/meetings/reserve', {
        providerId: 'apple-speechanalyzer',
      })
    ).status
  ).toBe(400);
});
