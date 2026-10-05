import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from './config';
import { requiredFilesFor } from './model-registry';
import { createServer } from './server';

const TOKEN = 'test-nota-settings-token';
const environmentKeys = [
  'NOTA_AI_BACKEND_TOKEN',
  'NOTA_AI_LOCAL_MODEL',
  'NOTA_AI_PROVIDER',
  'NOTA_AI_SETTINGS_PATH',
  'NOTA_AI_TOOL_MAX_STEPS',
  'NOTA_AI_WORKSPACE_ROOT',
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map(key => [key, process.env[key]])
) as Record<(typeof environmentKeys)[number], string | undefined>;

let workspaceRoot = '';
let baseUrl = '';
let server: ReturnType<ReturnType<typeof createServer>['app']['listen']>;

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'nota-ai-settings-'));
  process.env.NOTA_AI_BACKEND_TOKEN = TOKEN;
  process.env.NOTA_AI_PROVIDER = 'local';
  process.env.NOTA_AI_LOCAL_MODEL = 'gemma-4-e2b-it-onnx-q4f16';
  process.env.NOTA_AI_SETTINGS_PATH = path.join(
    workspaceRoot,
    'ai-settings.json'
  );
  process.env.NOTA_AI_WORKSPACE_ROOT = workspaceRoot;
  delete process.env.NOTA_AI_TOOL_MAX_STEPS;

  const { app } = createServer();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
  await rm(workspaceRoot, { force: true, recursive: true });
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function postSettings(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/ai/settings`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-nota-backend-token': TOKEN,
    },
    method: 'POST',
  });
}

function getSettings() {
  return fetch(`${baseUrl}/api/ai/settings`, {
    headers: { 'x-nota-backend-token': TOKEN },
  });
}

async function installLocalOnnxFixture(modelId: string) {
  const modelRoot = path.join(workspaceRoot, '.nota', 'models', modelId);
  for (const fileName of requiredFilesFor(modelId)) {
    const filePath = path.join(modelRoot, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'invalid-onnx-fixture');
  }
}

describe('AI tool round budget settings', () => {
  it('defaults to 50 rounds', async () => {
    expect(loadConfig().toolMaxSteps).toBe(50);
    expect(await (await getSettings()).json()).toMatchObject({
      tools: { maxSteps: 50 },
    });
  });

  it.each([
    [50, 50],
    [100, 50],
    [0, 1],
    [4, 4],
    [4.9, 4],
  ])('persists a requested budget of %s as %s', async (requested, expected) => {
    const response = await postSettings({ toolMaxSteps: requested });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(loadConfig().toolMaxSteps).toBe(expected);
    expect(await (await getSettings()).json()).toMatchObject({
      tools: { maxSteps: expected },
    });
  });

  it.each([
    ['100', 50],
    ['0', 1],
    ['4.9', 4],
  ])('bounds the environment budget %s to %s', (requested, expected) => {
    process.env.NOTA_AI_TOOL_MAX_STEPS = requested;
    expect(loadConfig().toolMaxSteps).toBe(expected);
  });
});

describe('AI settings model selection', () => {
  it('roundtrips preferred language and rejects invalid or incompatible changes atomically', async () => {
    expect(loadConfig().meetingSttLanguage).toBe('auto');
    expect((await postSettings({ meetingSttLanguage: 'fr-CA' })).status).toBe(
      400
    );
    expect(
      (
        await postSettings({
          meetingSttProviderId: 'nemotron-sherpa',
          meetingSttLanguage: 'fr-CA',
        })
      ).status
    ).toBe(200);
    expect(loadConfig().meetingSttLanguage).toBe('fr-CA');
    expect(await (await getSettings()).json()).toMatchObject({
      meetings: { sttLanguage: 'fr-CA' },
    });
    for (const body of [
      { meetingSttLanguage: 'xx-XX' },
      { meetingSttLanguage: 42 },
      { meetingSttLanguage: null },
      { meetingSttProviderId: 'whisper-tiny-en-onnx' },
      { meetingSttProviderId: 'auto' },
    ]) {
      expect((await postSettings(body)).status).toBe(400);
      expect(loadConfig().meetingSttLanguage).toBe('fr-CA');
      expect(loadConfig().meetingSttProviderId).toBe('nemotron-sherpa');
    }
    expect(
      (
        await postSettings({
          meetingSttProviderId: 'whisper-tiny-en-onnx',
          meetingSttLanguage: 'auto',
        })
      ).status
    ).toBe(200);
    expect(loadConfig().meetingSttLanguage).toBe('auto');
  });

  it.each([null, 42, 'xx-XX'])(
    'repairs invalid persisted language %s without losing unrelated settings',
    async language => {
      await writeFile(
        process.env.NOTA_AI_SETTINGS_PATH!,
        JSON.stringify({
          settings: {
            meetingSttLanguage: language,
            meetingSttProviderId: 'nemotron-sherpa',
            toolsEnabled: false,
          },
        })
      );
      expect(loadConfig()).toMatchObject({
        meetingSttLanguage: 'auto',
        toolsEnabled: false,
      });
    }
  );
  it('rejects an undownloaded curated ONNX model as the default', async () => {
    const response = await postSettings({
      defaultModel: 'qwen3.5-0.8b-onnx-q4f16',
      defaultProvider: 'local',
      localModel: 'qwen3.5-0.8b-onnx-q4f16',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Download qwen3.5-0.8b-onnx-q4f16'),
    });
  });

  it('still permits arbitrary models served by a custom local endpoint', async () => {
    const response = await postSettings({
      defaultModel: 'my-local-model',
      defaultProvider: 'local',
      localModel: 'my-local-model',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      model: 'my-local-model',
      provider: 'local',
    });
  });

  it('allows unrelated settings updates while a legacy local model is missing', async () => {
    const response = await postSettings({ toolsEnabled: false });

    expect(response.status).toBe(200);
  });

  it('removes a failed local probe from direct chat and the advertised catalog', async () => {
    const modelId = 'qwen3.5-0.8b-onnx-q4f16';
    await installLocalOnnxFixture(modelId);

    const probeResponse = await fetch(
      `${baseUrl}/v1/local/models/${encodeURIComponent(modelId)}/probe`,
      {
        headers: { 'x-nota-backend-token': TOKEN },
        method: 'POST',
      }
    );
    expect(probeResponse.status).toBe(409);
    const probePayload = (await probeResponse.json()) as {
      probe: { canLoad: boolean; message: string };
    };
    expect(probePayload.probe.canLoad).toBe(false);

    const sessionResponse = await fetch(`${baseUrl}/graphql`, {
      body: JSON.stringify({
        operationName: 'createCopilotSessionWithHistory',
        variables: {
          options: {
            promptName: 'Chat With Nota AI',
            workspaceId: 'probe-workspace',
          },
        },
      }),
      headers: {
        'content-type': 'application/json',
        'x-nota-backend-token': TOKEN,
      },
      method: 'POST',
    });
    const sessionPayload = (await sessionResponse.json()) as {
      data: { createCopilotSessionWithHistory: { sessionId: string } };
    };
    const sessionId =
      sessionPayload.data.createCopilotSessionWithHistory.sessionId;
    const streamResponse = await fetch(
      `${baseUrl}/api/ai/chat/${sessionId}/stream?modelId=${encodeURIComponent(`local:${modelId}`)}`,
      { headers: { 'x-nota-backend-token': TOKEN } }
    );
    expect(await streamResponse.text()).toContain(probePayload.probe.message);

    const settingsResponse = await getSettings();
    expect(settingsResponse.ok).toBe(true);
    const settings = (await settingsResponse.json()) as {
      models: {
        optionalModels: Array<{
          id: string;
          readiness: string;
          readinessMessage: string | null;
          selectable: boolean;
        }>;
      };
    };
    expect(settings.models.optionalModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `local:${modelId}`,
          readiness: 'unavailable',
          readinessMessage: probePayload.probe.message,
          selectable: false,
        }),
      ])
    );
  });
});
