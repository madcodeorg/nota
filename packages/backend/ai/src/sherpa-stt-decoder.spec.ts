import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createSherpaUtteranceDecoder,
  preloadSherpaRecognizer,
  setSherpaLoaderForTesting,
} from './sherpa-stt';

const MODEL_ROOT = '/mock/stt';
const options = { languageDetectorRoot: '/mock/whisper' };
const pcm = new Int16Array([100, -200, 300]);

function mockNativeModule() {
  const onlineLoad = vi.fn();
  const detectorLoad = vi.fn();
  const compute = vi.fn(() => 'fr');
  const createOnlineStream = vi.fn(() => ({
    setOption: vi.fn(),
    acceptWaveform: vi.fn(),
    inputFinished: vi.fn(),
  }));
  const createOfflineStream = vi.fn(() => ({
    acceptWaveform: vi.fn(
      (_input: { sampleRate: number; samples: Float32Array }) => {}
    ),
    setOption: vi.fn(),
  }));
  const decodeAsync = vi.fn(async () => ({ text: 'Native transcript' }));
  const getResult = vi.fn(() => ({ text: 'Native transcript' }));
  const createOfflineRecognizer = vi.fn(async () => ({
    createStream: createOfflineStream,
    decodeAsync,
  }));
  const native = {
    OfflineRecognizer: { createAsync: createOfflineRecognizer },
    OnlineRecognizer: class {
      constructor() {
        onlineLoad();
      }
      createStream = createOnlineStream;
      decode = vi.fn();
      getResult = getResult;
      isReady = () => false;
    },
    SpokenLanguageIdentification: class {
      constructor() {
        detectorLoad();
      }
      compute = compute;
      createStream = createOfflineStream;
    },
  };
  setSherpaLoaderForTesting(async () => native);
  return {
    compute,
    createOfflineRecognizer,
    createOfflineStream,
    createOnlineStream,
    decodeAsync,
    detectorLoad,
    getResult,
    onlineLoad,
  };
}

let native: ReturnType<typeof mockNativeModule>;

beforeEach(() => {
  native = mockNativeModule();
});

afterEach(() => {
  setSherpaLoaderForTesting(null);
});

describe('native sherpa utterance decoder', () => {
  test('snapshots explicit language on every stream and skips optional detection', async () => {
    const selected = { ...options, language: 'fr-CA' };
    await preloadSherpaRecognizer('nemotron-streaming', MODEL_ROOT, selected);
    const decoder = await createSherpaUtteranceDecoder(
      'nemotron-streaming',
      MODEL_ROOT,
      selected
    );
    selected.language = 'en-US';
    for (let index = 0; index < 2; index++) {
      decoder.pushPcm16(pcm);
      expect(await decoder.finish()).toEqual({
        language: null,
        text: 'Native transcript',
      });
    }
    expect(native.createOnlineStream).toHaveBeenCalledTimes(3);
    for (const result of native.createOnlineStream.mock.results) {
      expect(result.value.setOption).toHaveBeenCalledWith('language', 'fr-CA');
    }
    expect(native.detectorLoad).not.toHaveBeenCalled();
    expect(native.compute).not.toHaveBeenCalled();
  });

  test('sets Auto on every default stream', async () => {
    const decoder = await createSherpaUtteranceDecoder(
      'nemotron-streaming',
      MODEL_ROOT
    );
    await decoder.finish();
    for (const result of native.createOnlineStream.mock.results) {
      expect(result.value.setOption).toHaveBeenCalledWith('language', 'auto');
    }
  });

  test.each(['en', 'xx-XX', '', 'EN-us'])(
    'rejects unsupported locale %s before native loading',
    async language => {
      await expect(
        createSherpaUtteranceDecoder('nemotron-streaming', MODEL_ROOT, {
          language,
        })
      ).rejects.toThrow('Unsupported');
      expect(native.onlineLoad).not.toHaveBeenCalled();
    }
  );

  test('rejects explicit language for other decoders', async () => {
    await expect(
      createSherpaUtteranceDecoder('whisper-offline', MODEL_ROOT, {
        language: 'fr-CA',
      })
    ).rejects.toThrow('requires native Nemotron');
    expect(native.createOfflineRecognizer).not.toHaveBeenCalled();
  });
  test('shares one recognizer load but creates separate utterance streams', async () => {
    await Promise.all([
      createSherpaUtteranceDecoder('nemotron-streaming', MODEL_ROOT),
      createSherpaUtteranceDecoder('nemotron-streaming', MODEL_ROOT),
    ]);
    expect(native.onlineLoad).toHaveBeenCalledOnce();
    expect(native.createOnlineStream).toHaveBeenCalledTimes(2);
    expect(native.createOnlineStream.mock.results[0]?.value).not.toBe(
      native.createOnlineStream.mock.results[1]?.value
    );
  });

  test('never loads a second detector for Nemotron preload or repeated utterances', async () => {
    native.detectorLoad.mockImplementation(() => {
      throw new Error('a second model must not load');
    });
    await preloadSherpaRecognizer('nemotron-streaming', MODEL_ROOT, options);
    const decoder = await createSherpaUtteranceDecoder(
      'nemotron-streaming',
      MODEL_ROOT,
      options
    );
    for (let index = 0; index < 2; index++) {
      decoder.pushPcm16(pcm);
      await expect(decoder.partial()).resolves.toBe('Native transcript');
      await expect(decoder.finish()).resolves.toEqual({
        language: null,
        text: 'Native transcript',
      });
    }
    expect(native.createOnlineStream).toHaveBeenCalledTimes(3);
    expect(native.detectorLoad).not.toHaveBeenCalled();
    expect(native.compute).not.toHaveBeenCalled();
  });

  test('does not swallow failure of the primary Nemotron recognizer', async () => {
    native.getResult.mockImplementation(() => {
      throw new Error('native recognition failed');
    });
    const decoder = await createSherpaUtteranceDecoder(
      'nemotron-streaming',
      MODEL_ROOT,
      options
    );
    decoder.pushPcm16(pcm);
    await expect(decoder.finish()).rejects.toThrow('native recognition failed');
    expect(native.compute).not.toHaveBeenCalled();
  });

  test('keeps Cohere preload strict when its required detector cannot load', async () => {
    native.detectorLoad.mockImplementation(() => {
      throw new Error('required detector load failed');
    });
    await expect(
      preloadSherpaRecognizer('cohere-offline', MODEL_ROOT, options)
    ).rejects.toThrow('required detector load failed');
  });

  test('does not decode Cohere when required language detection fails', async () => {
    native.compute.mockImplementation(() => {
      throw new Error('required detector compute failed');
    });
    const decoder = await createSherpaUtteranceDecoder(
      'cohere-offline',
      MODEL_ROOT,
      options
    );
    decoder.pushPcm16(pcm);
    await expect(decoder.finish()).rejects.toThrow(
      'required detector compute failed'
    );
    expect(native.decodeAsync).not.toHaveBeenCalled();
  });

  test('passes a successfully detected language into Cohere decoding', async () => {
    const decoder = await createSherpaUtteranceDecoder(
      'cohere-offline',
      MODEL_ROOT,
      options
    );
    decoder.pushPcm16(pcm);
    await expect(decoder.finish()).resolves.toEqual({
      language: 'fr',
      text: 'Native transcript',
    });
    const stream = native.createOfflineStream.mock.results[0]?.value;
    expect(stream?.setOption).toHaveBeenCalledWith('language', 'fr');
    expect(native.decodeAsync).toHaveBeenCalledWith(stream);
  });
});
