import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from './config';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'nota-chat-config-'));
  vi.stubEnv('NOTA_AI_WORKSPACE_ROOT', root);
  vi.stubEnv('NOTA_AI_SETTINGS_PATH', path.join(root, 'settings.json'));
  vi.stubEnv('NOTA_AI_PROVIDER', 'local');
  vi.stubEnv('NOTA_AI_LOCAL_MODEL', undefined);
  vi.stubEnv('NOTA_AI_MODEL', undefined);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('managed chat model defaults and migration', () => {
  it('uses Qwen3.5 2B for fresh local configurations', () => {
    expect(loadConfig()).toMatchObject({
      localModel: 'qwen3.5-2b-gguf-q4km',
      defaultModel: 'qwen3.5-2b-gguf-q4km',
      embeddingModel: 'all-minilm-l6-v2-embedding',
    });
  });

  it('migrates a saved Qwen3 0.6B choice without changing its provider', async () => {
    await writeFile(
      path.join(root, 'settings.json'),
      JSON.stringify({
        settings: {
          defaultProvider: 'google',
          localModel: 'qwen3-0.6b-onnx-q4f16',
        },
      })
    );
    expect(loadConfig()).toMatchObject({
      defaultProvider: 'google',
      localModel: 'qwen3.5-0.8b-gguf-q4km',
    });
  });

  it('moves retired ONNX chat models to the nearest GPU model', async () => {
    for (const [saved, expected] of [
      ['lfm2.5-230m-onnx-q4', 'qwen3.5-0.8b-gguf-q4km'],
      ['gemma-4-e2b-it-onnx-q4f16', 'qwen3.5-2b-gguf-q4km'],
      ['gemma-4-e4b-it-onnx-q4f16', 'gemma-4-e4b-it-gguf-q4'],
    ]) {
      await writeFile(
        path.join(root, 'settings.json'),
        JSON.stringify({ settings: { localModel: saved } })
      );
      expect(loadConfig().localModel).toBe(expected);
    }
  });

  it('preserves an existing GGUF selection', async () => {
    await writeFile(
      path.join(root, 'settings.json'),
      JSON.stringify({
        settings: { localModel: 'gemma-4-12b-it-gguf-q4' },
      })
    );
    expect(loadConfig().localModel).toBe('gemma-4-12b-it-gguf-q4');
  });
});
