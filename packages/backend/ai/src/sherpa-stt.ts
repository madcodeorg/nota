import { availableParallelism } from 'node:os';
import path from 'node:path';

export {
  validateMeetingSttLanguage,
  validateMeetingSttLanguageProvider,
} from './meeting-stt-language';
import {
  validateMeetingSttLanguage,
  validateMeetingSttLanguageProvider,
} from './meeting-stt-language';

export type SherpaModelKind =
  | 'cohere-offline'
  | 'distil-whisper-offline'
  | 'moonshine-offline'
  | 'nemotron-streaming'
  | 'parakeet-offline'
  | 'whisper-offline';

export interface SherpaRecognition {
  language: string | null;
  text: string;
}

export interface SherpaUtteranceDecoder {
  readonly executionProvider: string;
  readonly supportsPartials: boolean;
  finish(): Promise<SherpaRecognition>;
  partial(): Promise<string | null>;
  pushPcm16(pcm: Int16Array): void;
}

export interface SherpaDecoderOptions {
  language?: string;
  languageDetectorRoot?: string;
}

interface SherpaResult {
  lang?: string;
  text?: string;
  timestamps?: number[];
  tokens?: string[];
}

interface SherpaOnlineStream {
  setOption(key: string, value: string): void;
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream;
  decode(stream: SherpaOnlineStream): void;
  getResult(stream: SherpaOnlineStream): SherpaResult;
  isReady(stream: SherpaOnlineStream): boolean;
}

interface SherpaOfflineStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  setOption(key: string, value: string): void;
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream;
  decodeAsync(stream: SherpaOfflineStream): Promise<SherpaResult>;
}

interface SherpaLanguageIdentifier {
  compute(stream: SherpaOfflineStream): string;
  createStream(): SherpaOfflineStream;
}

interface SherpaModule {
  OfflineRecognizer: {
    createAsync(
      config: Record<string, unknown>
    ): Promise<SherpaOfflineRecognizer>;
  };
  OnlineRecognizer: new (
    config: Record<string, unknown>
  ) => SherpaOnlineRecognizer;
  SpokenLanguageIdentification: new (
    config: Record<string, unknown>
  ) => SherpaLanguageIdentifier;
}

type SherpaRecognizer =
  | { kind: 'nemotron-streaming'; recognizer: SherpaOnlineRecognizer }
  | {
      kind: Exclude<SherpaModelKind, 'nemotron-streaming'>;
      recognizer: SherpaOfflineRecognizer;
    };

const COHERE_LANGUAGES = new Set([
  'ar',
  'de',
  'el',
  'en',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'nl',
  'pl',
  'pt',
  'vi',
  'zh',
]);
const recognizers = new Map<string, Promise<SherpaRecognizer>>();
const languageIdentifiers = new Map<
  string,
  Promise<SherpaLanguageIdentifier>
>();
let sherpaModule: Promise<SherpaModule> | null = null;

function modelKey(kind: SherpaModelKind, modelRoot: string) {
  return `${kind}:${modelRoot}`;
}

function numThreads() {
  return Math.max(2, Math.min(4, availableParallelism()));
}

function featureConfig() {
  return {
    featureDim: 80,
    sampleRate: 16_000,
  };
}

function transducerModelConfig(modelRoot: string) {
  return {
    decoder: path.join(modelRoot, 'decoder.int8.onnx'),
    encoder: path.join(modelRoot, 'encoder.int8.onnx'),
    joiner: path.join(modelRoot, 'joiner.int8.onnx'),
  };
}

function transducerRecognizerConfig(modelRoot: string) {
  return {
    featConfig: featureConfig(),
    modelConfig: {
      debug: 0,
      modelType: 'nemo_transducer',
      numThreads: numThreads(),
      provider: 'cpu',
      tokens: path.join(modelRoot, 'tokens.txt'),
      transducer: transducerModelConfig(modelRoot),
    },
  };
}

function offlineRecognizerConfig(
  kind: Exclude<SherpaModelKind, 'nemotron-streaming' | 'parakeet-offline'>,
  modelRoot: string
) {
  const shared = {
    debug: 0,
    numThreads: numThreads(),
    provider: 'cpu',
  };
  if (kind === 'whisper-offline') {
    return {
      featConfig: featureConfig(),
      modelConfig: {
        ...shared,
        tokens: path.join(modelRoot, 'tiny-tokens.txt'),
        whisper: {
          decoder: path.join(modelRoot, 'tiny-decoder.int8.onnx'),
          encoder: path.join(modelRoot, 'tiny-encoder.int8.onnx'),
          language: '',
          tailPaddings: -1,
          task: 'transcribe',
        },
      },
    };
  }
  if (kind === 'distil-whisper-offline') {
    return {
      featConfig: featureConfig(),
      modelConfig: {
        ...shared,
        tokens: path.join(modelRoot, 'distil-large-v3.5-tokens.txt'),
        whisper: {
          decoder: path.join(modelRoot, 'distil-large-v3.5-decoder.int8.onnx'),
          encoder: path.join(modelRoot, 'distil-large-v3.5-encoder.int8.onnx'),
          language: 'en',
          tailPaddings: -1,
          task: 'transcribe',
        },
      },
    };
  }
  if (kind === 'moonshine-offline') {
    return {
      featConfig: featureConfig(),
      modelConfig: {
        ...shared,
        moonshine: {
          encoder: path.join(modelRoot, 'encoder_model.ort'),
          mergedDecoder: path.join(modelRoot, 'decoder_model_merged.ort'),
        },
        tokens: path.join(modelRoot, 'tokens.txt'),
      },
    };
  }
  return {
    featConfig: featureConfig(),
    modelConfig: {
      ...shared,
      cohereTranscribe: {
        decoder: path.join(modelRoot, 'decoder.int8.onnx'),
        encoder: path.join(modelRoot, 'encoder.int8.onnx'),
        useItn: 1,
        usePunct: 1,
      },
      tokens: path.join(modelRoot, 'tokens.txt'),
    },
  };
}

async function defaultSherpaLoader(): Promise<SherpaModule> {
  const dynamicImport = new Function(
    'specifier',
    'return import(specifier)'
  ) as (specifier: string) => Promise<SherpaModule | { default: SherpaModule }>;
  const imported = await dynamicImport('sherpa-onnx-node');
  return 'default' in imported ? imported.default : imported;
}

let sherpaLoader = defaultSherpaLoader;

export function setSherpaLoaderForTesting(
  loader: (() => Promise<SherpaModule>) | null
) {
  sherpaLoader = loader ?? defaultSherpaLoader;
  sherpaModule = null;
  recognizers.clear();
  languageIdentifiers.clear();
}

async function importSherpa(): Promise<SherpaModule> {
  sherpaModule ??= sherpaLoader();
  return sherpaModule;
}

async function loadRecognizer(
  kind: SherpaModelKind,
  modelRoot: string
): Promise<SherpaRecognizer> {
  const key = modelKey(kind, modelRoot);
  const existing = recognizers.get(key);
  if (existing) {
    return existing;
  }

  const load = (async (): Promise<SherpaRecognizer> => {
    const sherpa = await importSherpa();
    if (kind === 'nemotron-streaming') {
      return {
        kind,
        recognizer: new sherpa.OnlineRecognizer({
          ...transducerRecognizerConfig(modelRoot),
          decodingMethod: 'greedy_search',
          enableEndpoint: 0,
        }),
      };
    }
    const config =
      kind === 'parakeet-offline'
        ? transducerRecognizerConfig(modelRoot)
        : offlineRecognizerConfig(kind, modelRoot);
    return {
      kind,
      recognizer: await sherpa.OfflineRecognizer.createAsync(config),
    };
  })();

  recognizers.set(key, load);
  try {
    return await load;
  } catch (error) {
    recognizers.delete(key);
    throw error;
  }
}

async function loadLanguageIdentifier(modelRoot: string) {
  const existing = languageIdentifiers.get(modelRoot);
  if (existing) {
    return existing;
  }
  const load = (async () => {
    const sherpa = await importSherpa();
    return new sherpa.SpokenLanguageIdentification({
      debug: 0,
      numThreads: Math.max(1, Math.min(2, availableParallelism())),
      provider: 'cpu',
      whisper: {
        decoder: path.join(modelRoot, 'tiny-decoder.int8.onnx'),
        encoder: path.join(modelRoot, 'tiny-encoder.int8.onnx'),
      },
    });
  })();
  languageIdentifiers.set(modelRoot, load);
  try {
    return await load;
  } catch (error) {
    languageIdentifiers.delete(modelRoot);
    throw error;
  }
}

function pcm16ToFloat32(pcm: Int16Array) {
  const samples = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index++) {
    const sample = pcm[index] ?? 0;
    samples[index] = sample < 0 ? sample / 32_768 : sample / 32_767;
  }
  return samples;
}

function concatenatePcm16(buffers: Int16Array[], totalSamples: number) {
  const samples = new Float32Array(totalSamples);
  let cursor = 0;
  for (const buffer of buffers) {
    samples.set(pcm16ToFloat32(buffer), cursor);
    cursor += buffer.length;
  }
  return samples;
}

function recognition(result: SherpaResult, fallbackLanguage?: string) {
  return {
    language: result.lang?.trim() || fallbackLanguage || null,
    text: (result.text ?? '').trim(),
  } satisfies SherpaRecognition;
}

async function detectLanguage(
  modelRoot: string,
  samples: Float32Array
): Promise<string> {
  const identifier = await loadLanguageIdentifier(modelRoot);
  const stream = identifier.createStream();
  stream.acceptWaveform({ sampleRate: 16_000, samples });
  return identifier.compute(stream).trim().toLowerCase();
}

export function isSherpaRecognizerCached(
  kind: SherpaModelKind,
  modelRoot: string
) {
  return recognizers.has(modelKey(kind, modelRoot));
}

export async function sherpaRuntimeAvailable() {
  try {
    await importSherpa();
    return true;
  } catch {
    return false;
  }
}

export async function preloadSherpaRecognizer(
  kind: SherpaModelKind,
  modelRoot: string,
  options: SherpaDecoderOptions = {}
) {
  const language = validateMeetingSttLanguage(options.language);
  if (kind === 'nemotron-streaming')
    validateMeetingSttLanguageProvider(language, 'nemotron-sherpa');
  if (language !== 'auto' && kind !== 'nemotron-streaming') {
    throw new Error(
      'Selected transcription language requires native Nemotron.'
    );
  }
  await loadRecognizer(kind, modelRoot);
  if (
    options.languageDetectorRoot &&
    kind !== 'nemotron-streaming' &&
    language === 'auto'
  ) {
    await loadLanguageIdentifier(options.languageDetectorRoot);
  }
}

export async function createSherpaUtteranceDecoder(
  kind: SherpaModelKind,
  modelRoot: string,
  options: SherpaDecoderOptions = {}
): Promise<SherpaUtteranceDecoder> {
  const language = validateMeetingSttLanguage(options.language);
  if (kind === 'nemotron-streaming')
    validateMeetingSttLanguageProvider(language, 'nemotron-sherpa');
  if (language !== 'auto' && kind !== 'nemotron-streaming') {
    throw new Error(
      'Selected transcription language requires native Nemotron.'
    );
  }
  const loaded = await loadRecognizer(kind, modelRoot);
  if (loaded.kind === 'nemotron-streaming') {
    const recognizer = loaded.recognizer;
    const createStream = () => {
      const next = recognizer.createStream();
      next.setOption('language', language);
      return next;
    };
    let stream = createStream();
    let lastText = '';

    const decodeReady = () => {
      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }
      return (recognizer.getResult(stream).text ?? '').trim();
    };

    return {
      executionProvider: 'sherpa-onnx/cpu',
      supportsPartials: true,
      pushPcm16(pcm) {
        stream.acceptWaveform({
          sampleRate: 16_000,
          samples: pcm16ToFloat32(pcm),
        });
      },
      async partial() {
        const text = decodeReady();
        if (!text || text === lastText) {
          return null;
        }
        lastText = text;
        return text;
      },
      async finish() {
        stream.acceptWaveform({
          sampleRate: 16_000,
          samples: new Float32Array(4_800),
        });
        stream.inputFinished();
        const text = decodeReady();
        // The current native binding filters Nemotron's language tag. Keep
        // metadata unknown rather than guess with a second speech model.
        stream = createStream();
        lastText = '';
        return { language: null, text };
      },
    };
  }

  const recognizer = loaded.recognizer;
  let buffers: Int16Array[] = [];
  let totalSamples = 0;
  return {
    executionProvider: 'sherpa-onnx/cpu',
    supportsPartials: false,
    pushPcm16(pcm) {
      buffers.push(pcm);
      totalSamples += pcm.length;
    },
    async partial() {
      return null;
    },
    async finish() {
      if (!totalSamples) {
        return { language: null, text: '' };
      }
      const samples = concatenatePcm16(buffers, totalSamples);
      buffers = [];
      totalSamples = 0;
      const stream = recognizer.createStream();
      let detectedLanguage: string | undefined;
      if (loaded.kind === 'cohere-offline') {
        if (!options.languageDetectorRoot) {
          throw new Error(
            'Cohere automatic language detection requires the multilingual Whisper Tiny model.'
          );
        }
        detectedLanguage = await detectLanguage(
          options.languageDetectorRoot,
          samples
        );
        if (!COHERE_LANGUAGES.has(detectedLanguage)) {
          throw new Error(
            `Cohere Transcribe does not support the detected language ${detectedLanguage || 'unknown'}.`
          );
        }
        stream.setOption('language', detectedLanguage);
      }
      stream.acceptWaveform({ sampleRate: 16_000, samples });
      const result = await recognizer.decodeAsync(stream);
      const fixedLanguage =
        loaded.kind === 'distil-whisper-offline' ||
        loaded.kind === 'moonshine-offline'
          ? 'en'
          : detectedLanguage;
      return recognition(result, fixedLanguage);
    },
  };
}
