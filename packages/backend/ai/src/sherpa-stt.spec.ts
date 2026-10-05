import { describe, expect, test } from 'vitest';

import { getLocalModelRegistry } from './model-registry.js';

describe('native sherpa STT registry', () => {
  test('routes every selectable local speech model through its native decoder', () => {
    const models = new Map(
      getLocalModelRegistry()
        .filter(model => model.type === 'stt')
        .map(model => [model.id, model])
    );

    expect(models.get('whisper-tiny-en-onnx-q4')).toMatchObject({
      languageDetection: 'automatic',
      runtime: 'sherpa-onnx',
      sherpaKind: 'whisper-offline',
    });
    expect(models.get('moonshine-base-onnx-q4')).toMatchObject({
      languageDetection: 'fixed',
      languages: ['en'],
      runtime: 'sherpa-onnx',
      sherpaKind: 'moonshine-offline',
    });
    expect(models.get('distil-whisper-large-v3-5-onnx-q4')).toMatchObject({
      languageDetection: 'fixed',
      languages: ['en'],
      runtime: 'sherpa-onnx',
      sherpaKind: 'distil-whisper-offline',
    });
    expect(models.get('cohere-transcribe-03-2026-onnx')).toMatchObject({
      languageDetection: 'automatic',
      languageDetectorModelId: 'whisper-tiny-en-onnx-q4',
      runtime: 'sherpa-onnx',
      sherpaKind: 'cohere-offline',
    });

    const nemotron = models.get('sherpa-nemotron-3.5-streaming-560ms-int8');
    expect(nemotron).toMatchObject({
      languageDetection: 'automatic',
      runtime: 'sherpa-onnx',
      sherpaKind: 'nemotron-streaming',
    });
    expect(nemotron?.languageDetectorModelId).toBeUndefined();
    expect(nemotron?.languages).toHaveLength(32);
    expect(nemotron?.languages).toEqual(
      expect.arrayContaining(['en-US', 'fr-CA', 'ja-JP', 'uk-UA', 'zh-CN'])
    );
  });
});
