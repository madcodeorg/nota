import { describe, expect, it } from 'vitest';

import { localModelById, modelRegistry } from './model-registry';

describe('local model registry', () => {
  it('keeps native Nemotron and retires the legacy INT4 download', () => {
    expect(localModelById('nemotron-3.5-asr-streaming-int4')).toBeNull();
    expect(
      localModelById('sherpa-nemotron-3.5-streaming-560ms-int8')
    ).toMatchObject({
      runtime: 'sherpa-onnx',
      sherpaKind: 'nemotron-streaming',
      streaming: true,
      releaseState: 'ready',
    });
  });

  it.each(modelRegistry)(
    'has valid populated SHA-256 checksums for $id',
    model => {
      const checksums = [
        ['sha256', model.sha256],
        ...Object.entries(model.fileSha256 ?? {}),
      ];

      for (const [field, checksum] of checksums) {
        if (checksum === '') continue;
        expect(checksum, `${model.id}: ${field}`).toMatch(/^[a-f0-9]{64}$/i);
      }
    }
  );

  it('matches the upstream Gemma 4 E4B q4f16 decoder data SHA-256', () => {
    // Upstream LFS metadata, not the Git blob ID:
    // https://huggingface.co/api/models/onnx-community/gemma-4-E4B-it-ONNX/revision/843f250f23bc91754def1e0f0db390dacd1e6b05?blobs=true
    expect(
      localModelById('gemma-4-e4b-it-onnx-q4f16')?.fileSha256?.[
        'onnx/decoder_model_merged_q4f16.onnx_data'
      ]
    ).toBe('b6aa13eab3ecdf4721293e93c806c279ca0516956187f7aec63ee90ec7216e73');
  });

  it('replaces Qwen3 0.6B with a pinned standard Qwen3.5 export', () => {
    expect(localModelById('qwen3-0.6b-onnx-q4f16')).toBeNull();
    const model = localModelById('qwen3.5-0.8b-onnx-q4f16');
    expect(model?.revision).toBe('c0d619322dad7c4441a8841a53fc59772ddddcc0');
    expect(model?.repoId).toBe('onnx-community/Qwen3.5-0.8B-ONNX');
    expect(
      model?.fileSha256?.['onnx/decoder_model_merged_q4f16.onnx_data']
    ).toBe('468cf83a51e81e27ffb4210268b1b09979e68dd128ad5fe347e5d08721cecc41');
  });

  it.each(modelRegistry.filter(model => /^(qwen3\.5|lfm2\.5)-/.test(model.id)))(
    'pins and verifies every required file for $id',
    model => {
      expect(model.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(Object.keys(model.fileSha256 ?? {}).sort()).toEqual(
        [...(model.files ?? [])].sort()
      );
      expect(model.files?.some(file => file.includes('vision_encoder'))).toBe(
        false
      );
      expect(model.contextWindowTokens).toBeGreaterThanOrEqual(32768);
    }
  );

  it('exposes context limits and use guidance for all managed chat models', () => {
    for (const model of modelRegistry.filter(model => model.type === 'text')) {
      expect(model.contextWindowTokens).toBeGreaterThan(0);
      expect(model.usageGuidance).toBeTruthy();
    }
    expect(
      localModelById('lfm2.5-1.2b-instruct-onnx-q4f16')?.contextWindowTokens
    ).toBe(32768);
    expect(localModelById('lfm2.5-2.6b-onnx-q4f16')?.contextWindowTokens).toBe(
      128000
    );
  });

  it.each(['gemma-4-e2b-it-onnx-q4f16', 'gemma-4-e4b-it-onnx-q4f16'])(
    'uses the official Apache 2.0 license for %s',
    modelId => {
      // https://ai.google.dev/gemma/docs/gemma_4_license
      expect(localModelById(modelId)?.license).toBe('apache-2.0');
    }
  );
});
