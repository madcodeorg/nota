import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiBackendConfig } from './config';
import {
  assertLocalOnnxTextReady,
  isLocalOnnxTextResident,
  setLocalOnnxTransformersLoaderForTesting,
} from './local-onnx';
import { getLocalModelHealth } from './meetings';
import { requiredFilesFor } from './model-registry';

vi.mock('./device-memory', () => ({
  availableMemoryBytes: () => 7.4 * 1024 ** 3,
}));

const MODEL_ID = 'qwen3.5-2b-onnx-q4f16';
const OTHER_MODEL_ID = 'qwen3.5-0.8b-onnx-q4f16';
let config: AiBackendConfig;

function createPipeline() {
  return Object.assign(async () => [], {
    dispose: vi.fn(async () => {}),
    tokenizer: {},
  });
}

function installRuntime(load = async () => createPipeline()) {
  const pipeline = vi.fn(load);
  setLocalOnnxTransformersLoaderForTesting(async () => ({
    env: {
      allowLocalModels: false,
      allowRemoteModels: true,
      localModelPath: '',
    },
    InterruptableStoppingCriteria: class {
      interrupt() {}
    },
    pipeline,
    TextStreamer: class {},
  }));
  return pipeline;
}

async function health() {
  const result = await getLocalModelHealth(config);
  return {
    device: result.device,
    model: result.models.find(model => model.id === MODEL_ID)!,
  };
}

beforeEach(async () => {
  config = {
    workspaceRoot: await mkdtemp(
      path.join(os.tmpdir(), 'nota-resident-model-')
    ),
  } as AiBackendConfig;
  vi.spyOn(os, 'totalmem').mockReturnValue(32 * 1024 ** 3);
  await Promise.all(
    requiredFilesFor(MODEL_ID).map(async file => {
      const target = path.join(
        config.workspaceRoot,
        '.nota',
        'models',
        MODEL_ID,
        file
      );
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'downloaded fixture');
    })
  );
  installRuntime();
});

afterEach(async () => {
  setLocalOnnxTransformersLoaderForTesting(null);
  vi.restoreAllMocks();
  await rm(config.workspaceRoot, { recursive: true, force: true });
});

describe('local text model residency and RAM fit', () => {
  it('keeps the cold-load RAM guard for a downloaded model', async () => {
    const result = await health();
    expect(result.device.availableRamGb).toBe(7.4);
    expect(result.model.downloadStatus).toBe('downloaded');
    expect(result.model.deviceFit).toBe('low_ram');
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(false);
  });

  it('does not charge an already loaded pipeline its cold-load RAM budget again', async () => {
    await assertLocalOnnxTextReady(config, MODEL_ID);
    const result = await health();
    expect(result.device.availableRamGb).toBe(7.4);
    expect(result.model.deviceFit).toBe('fits');
    expect(result.model.deviceFitReason).toContain('already loaded');
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(true);
    expect(
      isLocalOnnxTextResident(
        { ...config, workspaceRoot: `${config.workspaceRoot}-other` },
        MODEL_ID
      )
    ).toBe(false);
  });

  it('does not treat a pending pipeline as resident', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof createPipeline>>();
    const pipeline = installRuntime(() => pending.promise);
    const ready = assertLocalOnnxTextReady(config, MODEL_ID);
    await vi.waitFor(() => expect(pipeline).toHaveBeenCalledOnce());
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(false);
    expect((await health()).model.deviceFit).toBe('low_ram');
    pending.resolve(createPipeline());
    await ready;
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(true);
  });

  it('keeps failed loads nonresident and subject to the cold-load guard', async () => {
    installRuntime(async () => {
      throw new Error('Model load failed');
    });
    await expect(assertLocalOnnxTextReady(config, MODEL_ID)).rejects.toThrow(
      'Model load failed'
    );
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(false);
    expect((await health()).model.deviceFit).toBe('low_ram');
  });

  it('restores the cold-load guard when another model evicts the pipeline', async () => {
    await assertLocalOnnxTextReady(config, MODEL_ID);
    expect((await health()).model.deviceFit).toBe('fits');
    await assertLocalOnnxTextReady(config, OTHER_MODEL_ID);
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(false);
    expect((await health()).model.deviceFit).toBe('low_ram');
  });

  it('removes residency as soon as disposal starts', async () => {
    await assertLocalOnnxTextReady(config, MODEL_ID);
    setLocalOnnxTransformersLoaderForTesting(null);
    expect(isLocalOnnxTextResident(config, MODEL_ID)).toBe(false);
    expect((await health()).model.deviceFit).toBe('low_ram');
  });
});
