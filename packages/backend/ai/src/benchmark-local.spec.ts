import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_BENCHMARK_CASES,
  parseLocalBenchmarkArgs,
  runLocalBenchmark,
} from './benchmark-local';
import type { AiBackendConfig } from './config';
import type { streamLocalOnnxText } from './local-onnx';

describe('offline local model benchmark', () => {
  it('defaults to the repository model cache independent of the shell directory', () => {
    expect(
      parseLocalBenchmarkArgs(['--model=qwen3.5-0.8b-onnx-q4f16']).workspaceRoot
    ).toBe(
      path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
    );
  });

  it('requires a managed text model and a bounded token limit', () => {
    expect(() => parseLocalBenchmarkArgs([])).toThrow('--model');
    expect(() => parseLocalBenchmarkArgs(['--model', 'openai:gpt-5'])).toThrow(
      '--model'
    );
    expect(() =>
      parseLocalBenchmarkArgs([
        '--model',
        'qwen3.5-0.8b-onnx-q4f16',
        '--max-new-tokens',
        '0',
      ])
    ).toThrow('--max-new-tokens');
    expect(
      parseLocalBenchmarkArgs([
        '--model=qwen3.5-0.8b-onnx-q4f16',
        '--workspace-root=/tmp/nota-benchmark',
      ])
    ).toEqual({
      modelId: 'qwen3.5-0.8b-onnx-q4f16',
      maxNewTokens: 192,
      workspaceRoot: '/tmp/nota-benchmark',
    });
  });

  it('repeats the cold task warm and records outputs for manual review', async () => {
    const config = { workspaceRoot: '/tmp/unused' } as AiBackendConfig;
    const generate = vi.fn<typeof streamLocalOnnxText>(async input => {
      input.onText(' ');
      input.onText('Synthetic answer.');
      return 'Synthetic answer.';
    });
    const report = await runLocalBenchmark(
      { config, modelId: 'qwen3.5-0.8b-onnx-q4f16', maxNewTokens: 96 },
      generate
    );

    expect(generate).toHaveBeenCalledTimes(LOCAL_BENCHMARK_CASES.length + 1);
    expect(generate.mock.calls[0][0].messages).toEqual(
      generate.mock.calls[1][0].messages
    );
    expect(report.results.map(result => result.phase)).toEqual([
      'cold',
      'warm',
      'warm',
      'warm',
      'warm',
    ]);
    expect(report.results[0]).toMatchObject({
      case: 'rewrite',
      firstTextMs: expect.any(Number),
      totalMs: expect.any(Number),
      processPeakRssMiB: expect.any(Number),
      output: 'Synthetic answer.',
      review: expect.any(String),
    });
    for (const [input] of generate.mock.calls) {
      expect(input.config).toBe(config);
      expect(input.maxNewTokens).toBe(96);
    }
  });

  it('does not invent first-text timing when the runtime never streams', async () => {
    const report = await runLocalBenchmark(
      {
        config: {} as AiBackendConfig,
        modelId: 'qwen3.5-0.8b-onnx-q4f16',
        maxNewTokens: 64,
      },
      async () => 'Final answer only.'
    );
    expect(report.results.every(result => result.firstTextMs === null)).toBe(
      true
    );
  });

  it('surfaces runtime failures instead of reporting a successful benchmark', async () => {
    await expect(
      runLocalBenchmark(
        {
          config: {} as AiBackendConfig,
          modelId: 'qwen3.5-0.8b-onnx-q4f16',
          maxNewTokens: 64,
        },
        async () => {
          throw new Error('Model failed to load');
        }
      )
    ).rejects.toThrow('Model failed to load');
  });
});
