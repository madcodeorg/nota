import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express, { type Request, type Response } from 'express';
import multer from 'multer';

import type { AiBackendConfig } from './config';
import { availableMemoryBytes } from './device-memory';
import {
  assertLocalOnnxTextReady,
  onnxTextRuntimeAvailable,
} from './local-onnx';
import {
  MeetingAudioVadBuffer,
  type MeetingFallbackAudioChunk,
  MeetingFallbackAudioSpool,
  type MeetingNormalizedAudioFrame,
  mergeMeetingAudioFrames as mergeFramesToChunk,
} from './meeting-audio-spool';
import {
  createMeetingCapturePipeline,
  type MeetingCaptureMetrics,
  type MeetingUtteranceDecoder,
} from './meeting-capture-pipeline';
import { MeetingFinalizationTracker } from './meeting-finalization';
import { generateMeetingSummary } from './meeting-summary';
import {
  createMeetingSileroVad,
  resolveMeetingVadAsset,
  verifyMeetingVadFile,
} from './meeting-vad';
import {
  getLocalModelRegistry,
  isLocalOnnxTextModel,
  type LocalModelManifest,
} from './model-registry';
import {
  createNativeAsrDecoder,
  isNativeAsrCached,
  type NativeAsrRuntime,
  nativeAsrRuntimeAvailable,
  preloadNativeAsr,
} from './native-asr';
import type { AiModelRouter } from './providers';
import {
  createSherpaUtteranceDecoder,
  isSherpaRecognizerCached,
  preloadSherpaRecognizer,
  type SherpaModelKind,
  sherpaRuntimeAvailable,
  validateMeetingSttLanguage,
  validateMeetingSttLanguageProvider,
} from './sherpa-stt';
import type { CopilotStore } from './store';
import {
  deleteWorkspaceContentDocuments,
  probeEmbeddingModel,
  upsertWorkspaceContentDocuments,
} from './workspace-search';

export {
  initialMixedCaptureSpeechGate,
  shouldFinalizeMixedCaptureUtterance,
} from './meeting-capture-pipeline';

type PlatformId = 'darwin' | 'win32' | 'linux' | NodeJS.Platform;
type SttProviderId =
  | 'cactus-whistle'
  | 'whisper-tiny-cpp'
  | 'whisper-base-cpp'
  | 'whisper-small-cpp'
  | 'whisper-medium-cpp'
  | 'whisper-large-v3-cpp'
  | 'apple-speechanalyzer'
  | 'cohere-onnx'
  | 'distil-whisper-large-v3-5-onnx'
  | 'moonshine-base-onnx'
  | 'nemotron-sherpa'
  | 'parakeet-sherpa'
  | 'whisper-tiny-en-onnx';
type SttTranscriptMode =
  | 'native-streaming'
  | 'planned-streaming'
  | 'unavailable'
  | 'vad-chunk';
type TranscriptSource = 'mic' | 'system';
type TranscriptSegmentType = 'final' | 'partial';
type SttRuntimeStatus =
  | 'starting'
  | 'running'
  | 'finalizing'
  | 'unavailable'
  | 'stopped'
  | 'error';

const CHUNKED_ONNX_STT_PROVIDER_IDS = new Set<SttProviderId>([
  'cohere-onnx',
  'distil-whisper-large-v3-5-onnx',
  'moonshine-base-onnx',
  'whisper-tiny-en-onnx',
]);

const KNOWN_STT_PROVIDER_IDS = new Set<SttProviderId>([
  'cactus-whistle',
  'whisper-tiny-cpp',
  'whisper-base-cpp',
  'whisper-small-cpp',
  'whisper-medium-cpp',
  'whisper-large-v3-cpp',
  'apple-speechanalyzer',
  'cohere-onnx',
  'distil-whisper-large-v3-5-onnx',
  'moonshine-base-onnx',
  'nemotron-sherpa',
  'parakeet-sherpa',
  'whisper-tiny-en-onnx',
]);

function isChunkedOnnxProviderId(id: string): id is SttProviderId {
  return CHUNKED_ONNX_STT_PROVIDER_IDS.has(id as SttProviderId);
}

function isKnownSttProviderId(id: unknown): id is SttProviderId {
  return (
    typeof id === 'string' && KNOWN_STT_PROVIDER_IDS.has(id as SttProviderId)
  );
}

function nativeAsrRuntime(
  model: LocalModelManifest | null | undefined
): NativeAsrRuntime | null {
  return model?.runtime === 'cactus-needle' || model?.runtime === 'whisper.cpp'
    ? model.runtime
    : null;
}
function nativeAsrModelPath(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  const file = model.files?.[0];
  if (!file) throw new Error(`No model file is registered for ${model.id}.`);
  return safeModelFilePath(config, model, file);
}

function sherpaKindForModel(
  model: LocalModelManifest | null | undefined
): SherpaModelKind | null {
  return model?.runtime === 'sherpa-onnx' && model.sherpaKind
    ? model.sherpaKind
    : null;
}

interface SttProviderManifest {
  id: SttProviderId;
  name: string;
  platform: Array<'macos' | 'ios' | 'windows' | 'linux'>;
  local: boolean;
  streaming: boolean;
  downloadRequired: boolean;
  defaultForPlatform: boolean;
  available: boolean;
  canProduceTranscript: boolean;
  readiness?: SttProviderReadiness;
  transcriptMode: SttTranscriptMode;
  unavailableReason?: string;
  modelId?: string;
  notes: string;
  languages?: string[];
  installedLanguages?: string[];
  systemLocale?: string | null;
}

interface BaseSttProviderManifest extends Omit<
  SttProviderManifest,
  | 'available'
  | 'canProduceTranscript'
  | 'readiness'
  | 'transcriptMode'
  | 'unavailableReason'
> {
  unavailableReason?: string;
}

interface SttProviderReadiness {
  available: boolean;
  canStart: boolean;
  modelComplete: boolean;
  modelId?: string;
  modelPath?: string;
  reason: string | null;
  runtimeAvailable: boolean;
  runtimeId: LocalModelManifest['runtime'] | 'apple-speech';
  status: 'available' | 'missing_model' | 'missing_runtime' | 'unsupported';
}

interface AppleSpeechBridgeState {
  supportedLocales?: string[];
  installedLocales?: string[];
  systemLocale?: string | null;
  available: boolean;
  reason: string | null;
  registeredAt: string | null;
  updatedAt: string | null;
  version: string | null;
}

interface LocalModelHealth extends LocalModelManifest {
  bytesDownloaded: number;
  deviceFit: 'blocked' | 'fits' | 'low_disk' | 'low_ram' | 'planned';
  deviceFitReason: string;
  downloadStatus: LocalModelDownloadStatus;
  localPath: string;
  progress: number;
  runtimeProbe?: LocalModelRuntimeProbe;
  totalBytes: number;
  updatedAt?: string;
}

type LocalModelDownloadStatus =
  | 'blocked'
  | 'downloaded'
  | 'downloading'
  | 'error'
  | 'missing_url'
  | 'not_started'
  | 'planned'
  | 'queued';

type LocalModelChecksumStatus =
  | 'missing'
  | 'mismatch'
  | 'not_configured'
  | 'verified';

type LocalModelRuntimeProbeStatus =
  | 'available'
  | 'failed'
  | 'missing_model'
  | 'missing_runtime'
  | 'planned'
  | 'unsupported';

interface LocalModelRuntimeProbe {
  canLoad: boolean;
  checkedAt: string;
  message: string;
  modelId: string;
  modelPath: string;
  runtimeAvailable: boolean;
  runtimeId: LocalModelManifest['runtime'];
  status: LocalModelRuntimeProbeStatus;
}

interface LocalModelDeviceHealth {
  arch: string;
  availableDiskGb: number | null;
  availableRamGb: number;
  executionProviders: string[];
  modelRoot: string;
  platform: NodeJS.Platform;
  recommendedSummaryTier: 'large' | 'medium' | 'small';
  totalRamGb: number;
}

interface MeetingSession {
  id: string;
  // Retain original transcription provenance in saved meetings. Recovery uses
  // the current native provider instead of loading the retired legacy decoder.
  providerId: SttProviderId | 'nemotron-onnx';
  sttModelId: string;
  readonly sttLanguage?: string;
  workspaceId: string | null;
  docId: string | null;
  microphoneRecordingPath: string | null;
  recordingDurationMs: number | null;
  recordingPath: string | null;
  savedTranscriptSegmentIds: string[];
  savedTranscriptSegmentSnapshots?: Record<string, string>;
  status: 'recording' | 'stopped';
  summary: string | null;
  summaryDocIds: string[];
  transcriptSaveInitialized: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TranscriptSegment {
  id: string;
  meetingId: string;
  type: TranscriptSegmentType;
  text: string;
  startMs: number;
  endMs: number;
  source: TranscriptSource;
  language?: string;
  confidence?: number;
  createdAt: string;
}

interface AudioFrame {
  channels: number;
  encoding: 'f32le';
  endMs: number;
  id: string | null;
  level: number;
  pcm: Buffer;
  sampleRate: number;
  source: TranscriptSource;
  startMs: number;
}

type NormalizedAudioFrame = MeetingNormalizedAudioFrame;

type SttAudioChunk = MeetingFallbackAudioChunk;

interface SttState {
  audioFrames: number;
  audioFramesBySource: Record<TranscriptSource, number>;
  completedSpeechChunks: number;
  // Decode wall-clock per second of audio processed (< 1 is faster than
  // real time). Reported so slow devices are visible instead of silently
  // building a transcription backlog.
  decodeRealtimeFactor: number | null;
  pipeline?: MeetingCaptureMetrics & { queuedAudioMs: number };
  // Most recent language code reported by an automatic/fixed local decoder.
  detectedLanguage: string | null;
  // ONNX execution provider the live decoder actually initialized with.
  executionProvider: string | null;
  failedSpeechChunks: number;
  lastNormalizedAudioFrameAt: string | null;
  lastSpeechChunkAt: string | null;
  lastAudioFrameAt: string | null;
  lastAudioFrameLevel: number | null;
  lastAudioFrameSource: TranscriptSource | null;
  message: string | null;
  normalizedAudioFrames: number;
  requestedProviderId: SttProviderId | 'auto';
  providerId: SttProviderId;
  queuedSpeechChunks: number;
  readiness: SttProviderReadiness | null;
  speechChunks: number;
  status: SttRuntimeStatus;
}

interface SttProviderSession {
  pushAudioFrame(frame: NormalizedAudioFrame): Promise<void>;
  pushAudioChunk?(chunk: SttAudioChunk): Promise<void>;
  stop(): Promise<void>;
}

type SttRuntimePreloadStatus =
  | 'cached'
  | 'loaded'
  | 'missing_model'
  | 'native'
  | 'unavailable'
  | 'unsupported';

interface SttRuntimePreloadResult {
  available: boolean;
  cached: boolean;
  durationMs: number;
  message: string | null;
  modelId: string | null;
  providerId: string | null;
  providerName: string | null;
  requestedProviderId: SttProviderId | 'auto';
  status: SttRuntimePreloadStatus;
}

type AsrPipeline = ((
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<unknown>) & {
  dispose?: () => Promise<void> | void;
};

type OrtTensorData = Float32Array | BigInt64Array | Int32Array;
type OrtTensorLike = {
  data: ArrayLike<number | bigint>;
  dims?: readonly number[];
  type?: string;
};
type OrtInferenceSession = {
  inputMetadata?:
    | Record<
        string,
        {
          dimensions?: ReadonlyArray<number | string | null>;
          shape?: ReadonlyArray<number | string | null>;
          type?: string;
        }
      >
    | Array<{
        dimensions?: ReadonlyArray<number | string | null>;
        name?: string;
        shape?: ReadonlyArray<number | string | null>;
        type?: string;
      }>;
  inputNames?: string[];
  outputNames?: string[];
  release?: () => Promise<void> | void;
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
};
type OrtModule = {
  InferenceSession: {
    create(
      modelPath: string,
      options?: Record<string, unknown>
    ): Promise<OrtInferenceSession>;
  };
  Tensor: new (
    type: 'float32' | 'int32' | 'int64',
    data: OrtTensorData,
    dims: readonly number[]
  ) => unknown;
};

interface SileroVadRuntime {
  ort: OrtModule;
  vad: OrtInferenceSession;
}

interface MeetingRuntime {
  audioOperation: Promise<void>;
  clients: Set<Response>;
  fallbackAudioSpool: MeetingFallbackAudioSpool;
  meeting: MeetingSession;
  partialSegment: TranscriptSegment | null;
  provider: SttProviderManifest;
  stt: SttState;
  sttSession: SttProviderSession | null;
  transcriptSegments: TranscriptSegment[];
  vad: Record<TranscriptSource, MeetingAudioVadBuffer>;
}

const meetings = new Map<string, MeetingRuntime>();

function withMeetingAudioOperation<T>(
  runtime: MeetingRuntime,
  operation: () => Promise<T>
) {
  const result = runtime.audioOperation.then(operation);
  runtime.audioOperation = result.then(
    () => {},
    () => {}
  );
  return result;
}

interface PersistedMeetingRuntime {
  meeting: MeetingSession;
  partialSegment: TranscriptSegment | null;
  stt: SttState;
  transcriptSegments: TranscriptSegment[];
}

interface PersistedMeetingsFile {
  meetings?: PersistedMeetingRuntime[];
  updatedAt?: string;
  version?: number;
}

let meetingsLoading: Promise<void> | null = null;

export interface LocalModelDownloadJob {
  bytesDownloaded: number;
  localPath: string;
  message: string;
  modelId: string;
  progress: number;
  requestedAt: string;
  status: LocalModelDownloadStatus;
  totalBytes: number;
  updatedAt: string;
}

const modelDownloads = new Map<string, LocalModelDownloadJob>();
let modelDownloadsLoaded = false;
let modelDownloadsSaveQueue = Promise.resolve();
const activeModelDownloads = new Map<string, Promise<void>>();
const startingModelDownloads = new Map<
  string,
  Promise<LocalModelDownloadJob>
>();
const localModelRuntimeProbes = new Map<string, LocalModelRuntimeProbe>();
const sileroVadRuntimes = new Map<string, Promise<SileroVadRuntime>>();
const sttPipelines = new Map<string, Promise<AsrPipeline>>();
const sttRuntimeUnloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
const stoppedMeetingFinalizations = new MeetingFinalizationTracker();
const STT_MODEL_KEEP_WARM_MS = 10 * 60 * 1000;
const appleSpeechBridge: AppleSpeechBridgeState = {
  available: false,
  reason: 'Apple SpeechAnalyzer bridge has not registered yet.',
  registeredAt: null,
  updatedAt: null,
  version: null,
};
const transcriptionUpload = multer({
  limits: {
    fileSize: 1024 * 1024 * 256,
    files: 1,
  },
  storage: multer.memoryStorage(),
});

const modelRegistry = getLocalModelRegistry();

function roundGb(bytes: number) {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

function executionProvidersForPlatform(platform: NodeJS.Platform) {
  switch (platform) {
    case 'darwin':
      return ['coreml', 'cpu'];
    case 'win32':
      return ['directml', 'cpu'];
    case 'linux':
      return ['cuda', 'cpu'];
    default:
      return ['cpu'];
  }
}

function recommendedSummaryTier(availableRamGb: number) {
  if (availableRamGb >= 16) return 'large';
  if (availableRamGb >= 8) return 'medium';
  return 'small';
}

function fitModelToDevice(
  model: LocalModelManifest,
  device: LocalModelDeviceHealth
): Pick<LocalModelHealth, 'deviceFit' | 'deviceFitReason'> {
  if (model.releaseState === 'blocked') {
    return {
      deviceFit: 'blocked',
      deviceFitReason:
        model.notes ??
        'This model is blocked until a trusted package is ready.',
    };
  }

  if (device.availableRamGb < model.minRamGb) {
    return {
      deviceFit: 'low_ram',
      deviceFitReason: `Needs ${model.minRamGb}GB RAM target; this device currently reports ${device.availableRamGb}GB available.`,
    };
  }

  if (
    device.availableDiskGb !== null &&
    model.sizeMb > 0 &&
    device.availableDiskGb < (model.sizeMb / 1024) * 1.25
  ) {
    return {
      deviceFit: 'low_disk',
      deviceFitReason: `Needs about ${Math.ceil(
        (model.sizeMb / 1024) * 1.25
      )}GB free disk including download overhead; this device reports ${device.availableDiskGb}GB.`,
    };
  }

  if (model.releaseState === 'planned') {
    return {
      deviceFit: 'planned',
      deviceFitReason:
        'This device can run the tier, but the model download/runtime path is not wired yet.',
    };
  }

  return {
    deviceFit: 'fits',
    deviceFitReason: 'This device meets the local RAM and disk targets.',
  };
}

function safeModelPath(config: AiBackendConfig, model: LocalModelManifest) {
  return path.join(config.workspaceRoot, '.nota', 'models', model.id);
}

function safeModelFilePath(
  config: AiBackendConfig,
  model: LocalModelManifest,
  fileName: string
) {
  const modelRoot = safeModelPath(config, model);
  const filePath = path.join(modelRoot, fileName);
  const relative = path.relative(modelRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe model file path: ${fileName}`);
  }
  return filePath;
}

function sttUnloadKey(kind: 'silero' | 'transformers', cacheKey: string) {
  return `${kind}:${cacheKey}`;
}

function cancelSttRuntimeUnload(unloadKey: string) {
  const timer = sttRuntimeUnloadTimers.get(unloadKey);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  sttRuntimeUnloadTimers.delete(unloadKey);
}

function scheduleSttRuntimeUnload(
  unloadKey: string,
  unload: () => Promise<void>
) {
  cancelSttRuntimeUnload(unloadKey);
  const timer = setTimeout(() => {
    sttRuntimeUnloadTimers.delete(unloadKey);
    unload().catch(unloadError => {
      console.warn('Failed to unload idle STT runtime', unloadError);
    });
  }, STT_MODEL_KEEP_WARM_MS);
  const maybeNodeTimer = timer as { unref?: () => void };
  maybeNodeTimer.unref?.();
  sttRuntimeUnloadTimers.set(unloadKey, timer);
}

async function releaseOrtSession(session: OrtInferenceSession) {
  await session.release?.();
}

async function loadSileroVadRuntime(
  config: AiBackendConfig
): Promise<SileroVadRuntime | null> {
  const filePath = await resolveMeetingVadAsset(config.workspaceRoot, [
    ...modelRegistry
      .filter(model => model.type === 'stt')
      .map(model => safeModelPath(config, model)),
    // Migrate just the verified VAD asset from an older install. Its ASR
    // model is retired; downloaded files remain owned by the user.
    path.join(
      config.workspaceRoot,
      '.nota',
      'models',
      'nemotron-3.5-asr-streaming-int4'
    ),
  ]);
  if (!filePath) return null;

  cancelSttRuntimeUnload(sttUnloadKey('silero', filePath));
  const existing = sileroVadRuntimes.get(filePath);
  if (existing) {
    return existing;
  }
  const load = (async () => {
    const ort = await importOnnxRuntimeNode();
    const vad = await createOrtSessionWithFallback(ort, filePath);
    return { ort, vad: vad.session } satisfies SileroVadRuntime;
  })();
  sileroVadRuntimes.set(filePath, load);
  try {
    return await load;
  } catch (error) {
    sileroVadRuntimes.delete(filePath);
    throw error;
  }
}

function modelDownloadsPath(config: AiBackendConfig) {
  return path.join(config.workspaceRoot, '.nota', 'models', 'downloads.json');
}

function modelFileNames(model: LocalModelManifest) {
  return model.files ?? [];
}

function expectedFileSha256(model: LocalModelManifest, fileName: string) {
  const fileHash = model.fileSha256?.[fileName];
  const fallbackHash =
    modelFileNames(model).length === 1 && model.sha256 ? model.sha256 : '';
  const hash = (fileHash || fallbackHash).trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function checksumStatus(
  filePath: string,
  expectedSha256: string | null
): Promise<LocalModelChecksumStatus> {
  if (!expectedSha256) {
    return 'not_configured';
  }

  try {
    const actualSha256 = await sha256File(filePath);
    return actualSha256 === expectedSha256 ? 'verified' : 'mismatch';
  } catch {
    return 'missing';
  }
}

function hfFileUrl(model: LocalModelManifest, fileName: string) {
  if (!model.repoId) {
    throw new Error(`Model ${model.id} does not declare a Hugging Face repo.`);
  }
  const revision = model.revision ?? 'main';
  const encodedFile = fileName.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${model.repoId}/resolve/${encodeURIComponent(
    revision
  )}/${encodedFile}`;
}

function hfHeaders() {
  const token = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'User-Agent': 'NotaAIBackend/0.1',
  };
}

function hfResponseError(
  model: LocalModelManifest,
  fileName: string,
  status: number
) {
  const fileUrl = hfFileUrl(model, fileName);
  if (status === 401 || status === 403) {
    return new Error(
      `Failed to access ${fileName}: Hugging Face returned HTTP ${status}. If this model is gated, set HF_TOKEN or HUGGING_FACE_HUB_TOKEN before downloading. URL: ${fileUrl}`
    );
  }
  if (status === 404) {
    return new Error(
      `Failed to access ${fileName}: Hugging Face returned HTTP 404. Check the model registry file list for ${model.id}. URL: ${fileUrl}`
    );
  }
  return new Error(
    `Failed to access ${fileName}: Hugging Face returned HTTP ${status}. URL: ${fileUrl}`
  );
}

function contentRangeSize(value: string | null) {
  if (!value) {
    return null;
  }
  const match = value.match(/\/(\d+)$/);
  if (!match?.[1]) {
    return null;
  }
  const size = Number(match[1]);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function parseContentRange(value: string | null) {
  if (!value) {
    return null;
  }
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    end < start ||
    (total !== null &&
      (!Number.isSafeInteger(total) || total <= end || total <= 0))
  ) {
    return null;
  }
  return { end, start, total };
}

function contentLengthSize(value: string | null) {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : null;
}

async function localModelFilesStatus(
  config: AiBackendConfig,
  model: LocalModelManifest,
  options: { verifyChecksums?: boolean } = {}
) {
  const files = modelFileNames(model);
  if (!files.length) {
    return {
      bytesDownloaded: 0,
      complete: false,
    };
  }

  let bytesDownloaded = 0;
  for (const fileName of files) {
    try {
      const file = await stat(safeModelFilePath(config, model, fileName));
      if (!file.isFile()) {
        return { bytesDownloaded, complete: false };
      }
      if (options.verifyChecksums) {
        const expectedSha256 = expectedFileSha256(model, fileName);
        if (expectedSha256) {
          const status = await checksumStatus(
            safeModelFilePath(config, model, fileName),
            expectedSha256
          );
          if (status !== 'verified') {
            return { bytesDownloaded, complete: false };
          }
        }
      }
      bytesDownloaded += file.size;
    } catch {
      return { bytesDownloaded, complete: false };
    }
  }

  return {
    bytesDownloaded,
    complete: true,
  };
}

async function ensureModelDownloadsLoaded(config: AiBackendConfig) {
  if (modelDownloadsLoaded) {
    return;
  }
  modelDownloadsLoaded = true;

  try {
    const raw = await readFile(modelDownloadsPath(config), 'utf8');
    const parsed = JSON.parse(raw) as { downloads?: LocalModelDownloadJob[] };
    if (!Array.isArray(parsed.downloads)) {
      return;
    }

    for (const job of parsed.downloads) {
      if (
        typeof job.modelId === 'string' &&
        typeof job.status === 'string' &&
        typeof job.localPath === 'string'
      ) {
        modelDownloads.set(job.modelId, {
          bytesDownloaded: Number(job.bytesDownloaded) || 0,
          localPath: job.localPath,
          message: typeof job.message === 'string' ? job.message : '',
          modelId: job.modelId,
          progress: Number(job.progress) || 0,
          requestedAt:
            typeof job.requestedAt === 'string' ? job.requestedAt : now(),
          status: job.status as LocalModelDownloadStatus,
          totalBytes: Number(job.totalBytes) || 0,
          updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : now(),
        });
      }
    }
  } catch {
    // Missing or invalid local status cache should not block meeting startup.
  }
}

function saveModelDownloads(config: AiBackendConfig) {
  const filePath = modelDownloadsPath(config);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const payload = JSON.stringify(
    {
      downloads: [...modelDownloads.values()],
    },
    null,
    2
  );
  const save = modelDownloadsSaveQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(tempPath, payload);
      await rename(tempPath, filePath);
    });
  modelDownloadsSaveQueue = save;
  return save;
}

async function setModelDownloadJob(
  config: AiBackendConfig,
  model: LocalModelManifest,
  input: {
    bytesDownloaded?: number;
    message: string;
    progress?: number;
    status: LocalModelDownloadStatus;
    totalBytes?: number;
  }
) {
  await ensureModelDownloadsLoaded(config);
  const timestamp = now();
  const totalBytes =
    input.totalBytes ?? (model.sizeMb > 0 ? model.sizeMb * 1024 * 1024 : 0);
  const job: LocalModelDownloadJob = {
    bytesDownloaded: input.bytesDownloaded ?? 0,
    localPath: safeModelPath(config, model),
    message: input.message,
    modelId: model.id,
    progress:
      input.progress ??
      (input.status === 'downloaded'
        ? 1
        : input.status === 'queued'
          ? 0.01
          : 0),
    requestedAt: modelDownloads.get(model.id)?.requestedAt ?? timestamp,
    status: input.status,
    totalBytes,
    updatedAt: timestamp,
  };
  modelDownloads.set(model.id, job);
  await saveModelDownloads(config);
  return job;
}

async function modelDownloadStatus(
  config: AiBackendConfig,
  model: LocalModelManifest
): Promise<
  Pick<
    LocalModelHealth,
    | 'bytesDownloaded'
    | 'downloadStatus'
    | 'localPath'
    | 'progress'
    | 'totalBytes'
    | 'updatedAt'
  >
> {
  await ensureModelDownloadsLoaded(config);
  const active = activeModelDownloads.has(model.id);
  const requested = modelDownloads.get(model.id);
  if (active && requested) {
    return {
      bytesDownloaded: requested.bytesDownloaded,
      downloadStatus: 'downloading',
      localPath: requested.localPath,
      progress: requested.progress,
      totalBytes: requested.totalBytes,
      updatedAt: requested.updatedAt,
    };
  }

  const localPath = safeModelPath(config, model);
  const totalBytes = model.sizeMb > 0 ? model.sizeMb * 1024 * 1024 : 0;
  const base = {
    bytesDownloaded: 0,
    localPath,
    progress: 0,
    totalBytes,
  };

  const localFiles = await localModelFilesStatus(config, model);
  if (localFiles.complete) {
    return {
      ...base,
      bytesDownloaded: localFiles.bytesDownloaded,
      downloadStatus: 'downloaded',
      progress: 1,
      totalBytes: Math.max(totalBytes, localFiles.bytesDownloaded),
    };
  }

  if (requested) {
    return {
      bytesDownloaded: requested.bytesDownloaded,
      downloadStatus: requested.status,
      localPath: requested.localPath,
      progress: requested.progress,
      totalBytes: requested.totalBytes,
      updatedAt: requested.updatedAt,
    };
  }

  if (model.releaseState === 'blocked') {
    return {
      ...base,
      downloadStatus: 'blocked',
    };
  }

  if (!model.downloadUrl) {
    return {
      ...base,
      downloadStatus: 'missing_url',
    };
  }

  if (model.releaseState === 'planned') {
    return {
      ...base,
      downloadStatus: 'planned',
    };
  }

  return {
    ...base,
    downloadStatus: 'not_started',
  };
}

async function modelDownloadFileStatuses(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  return Promise.all(
    modelFileNames(model).map(async fileName => {
      const expectedSha256 = expectedFileSha256(model, fileName);
      try {
        const filePath = safeModelFilePath(config, model, fileName);
        const file = await stat(filePath);
        const downloaded = file.isFile();
        return {
          checksumStatus: downloaded
            ? await checksumStatus(filePath, expectedSha256)
            : expectedSha256
              ? 'missing'
              : 'not_configured',
          expectedSha256,
          fileName,
          downloaded,
          size: downloaded ? file.size : 0,
        };
      } catch {
        return {
          checksumStatus: expectedSha256 ? 'missing' : 'not_configured',
          expectedSha256,
          fileName,
          downloaded: false,
          size: 0,
        };
      }
    })
  );
}

async function resolveRemoteFileSize(
  model: LocalModelManifest,
  fileName: string
) {
  const url = hfFileUrl(model, fileName);
  const head = await fetch(url, {
    headers: hfHeaders(),
    method: 'HEAD',
    redirect: 'follow',
  });

  if (head.ok) {
    const length = contentLengthSize(head.headers.get('content-length'));
    if (length) {
      return length;
    }
  } else if (![405, 501].includes(head.status)) {
    throw hfResponseError(model, fileName, head.status);
  }

  const range = await fetch(url, {
    headers: {
      ...hfHeaders(),
      Range: 'bytes=0-0',
    },
    method: 'GET',
    redirect: 'follow',
  });
  if (!range.ok && range.status !== 206) {
    throw hfResponseError(model, fileName, range.status);
  }

  return (
    contentRangeSize(range.headers.get('content-range')) ??
    contentLengthSize(range.headers.get('content-length'))
  );
}

async function resolveModelDownloadPlan(model: LocalModelManifest) {
  const files = modelFileNames(model);
  if (!files.length) {
    throw new Error(`Model ${model.id} does not declare downloadable files.`);
  }

  const entries = await Promise.all(
    files.map(async fileName => ({
      expectedSha256: expectedFileSha256(model, fileName),
      fileName,
      size: await resolveRemoteFileSize(model, fileName),
      url: hfFileUrl(model, fileName),
    }))
  );
  const knownTotalBytes = entries.reduce(
    (total, entry) => total + (entry.size ?? 0),
    0
  );
  const fallbackTotalBytes =
    model.sizeMb > 0 ? model.sizeMb * 1024 * 1024 : knownTotalBytes;

  return {
    entries,
    totalBytes: knownTotalBytes || fallbackTotalBytes,
  };
}

async function saveDownloadProgress(
  config: AiBackendConfig,
  model: LocalModelManifest,
  job: LocalModelDownloadJob
) {
  modelDownloads.set(model.id, {
    ...job,
    updatedAt: now(),
  });
  await saveModelDownloads(config);
}

export async function downloadModelFile(input: {
  config: AiBackendConfig;
  fileName: string;
  job: LocalModelDownloadJob;
  model: LocalModelManifest;
  onBytes: (bytes: number) => Promise<void>;
  size: number | null;
  url: string;
}) {
  const filePath = safeModelFilePath(input.config, input.model, input.fileName);
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    const existing = await stat(filePath);
    if (existing.isFile()) {
      if (input.size !== null && existing.size === input.size) {
        const expectedSha256 = expectedFileSha256(input.model, input.fileName);
        if (expectedSha256) {
          const status = await checksumStatus(filePath, expectedSha256);
          if (status === 'verified') {
            await input.onBytes(existing.size);
            return;
          }
        } else {
          await input.onBytes(existing.size);
          return;
        }
      }

      // Windows rename does not replace an existing destination. Remove any
      // final file that was not accepted above before promoting the download.
      await unlink(filePath);
    }
  } catch (existingError) {
    if ((existingError as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw existingError;
    }
  }

  const tempPath = `${filePath}.download`;
  let resumeBytes = 0;
  try {
    const partial = await stat(tempPath);
    if (partial.isFile() && partial.size > 0) {
      if (input.size !== null && partial.size === input.size) {
        const expectedSha256 = expectedFileSha256(input.model, input.fileName);
        if (
          !expectedSha256 ||
          (await checksumStatus(tempPath, expectedSha256)) === 'verified'
        ) {
          await rename(tempPath, filePath);
          await input.onBytes(partial.size);
          return;
        }
        await unlink(tempPath).catch(() => {});
      } else if (input.size === null || partial.size < input.size) {
        resumeBytes = partial.size;
      } else {
        await unlink(tempPath).catch(() => {});
      }
    }
  } catch {
    // There is no partial download to resume.
  }
  const response = await fetch(input.url, {
    headers: {
      ...hfHeaders(),
      ...(resumeBytes ? { Range: `bytes=${resumeBytes}-` } : {}),
    },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw hfResponseError(input.model, input.fileName, response.status);
  }

  const responseRange =
    response.status === 206
      ? parseContentRange(response.headers.get('content-range'))
      : null;
  if (response.status === 206) {
    if (!responseRange || responseRange.start !== resumeBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error(
        `Invalid resume range for ${input.fileName}: expected byte ${resumeBytes}, received ${
          response.headers.get('content-range') ?? 'no Content-Range'
        }.`
      );
    }
    if (
      input.size !== null &&
      responseRange.total !== null &&
      responseRange.total !== input.size
    ) {
      await response.body.cancel().catch(() => {});
      throw new Error(
        `Unexpected remote size for ${input.fileName}: expected ${input.size} bytes, received ${responseRange.total}.`
      );
    }
    const responseLength = contentLengthSize(
      response.headers.get('content-length')
    );
    const rangedLength = responseRange.end - responseRange.start + 1;
    if (responseLength !== null && responseLength !== rangedLength) {
      await response.body.cancel().catch(() => {});
      throw new Error(
        `Invalid ranged response length for ${input.fileName}: expected ${rangedLength} bytes, received ${responseLength}.`
      );
    }
  }

  const append = resumeBytes > 0 && response.status === 206;
  if (append) {
    await input.onBytes(resumeBytes);
  } else {
    resumeBytes = 0;
  }
  const writer = createWriteStream(tempPath, { flags: append ? 'a' : 'w' });
  const reader = response.body.getReader();
  let lastSavedAt = Date.now();

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      const value = Buffer.from(chunk.value);
      if (!writer.write(value)) {
        await once(writer, 'drain');
      }
      await input.onBytes(value.byteLength);

      const nowMs = Date.now();
      if (nowMs - lastSavedAt > 1000) {
        lastSavedAt = nowMs;
        await saveDownloadProgress(input.config, input.model, input.job);
      }
    }
  } finally {
    writer.end();
  }

  await once(writer, 'finish');
  const downloaded = await stat(tempPath);
  const expectedSize =
    input.size ??
    responseRange?.total ??
    (response.status === 200
      ? contentLengthSize(response.headers.get('content-length'))
      : null);
  if (expectedSize !== null && downloaded.size !== expectedSize) {
    throw new Error(
      `Incomplete download for ${input.fileName}: expected ${expectedSize} bytes, received ${downloaded.size}.`
    );
  }
  const expectedSha256 = expectedFileSha256(input.model, input.fileName);
  if (expectedSha256) {
    const actualSha256 = await sha256File(tempPath);
    if (actualSha256 !== expectedSha256) {
      await unlink(tempPath).catch(() => {});
      throw new Error(
        `Checksum mismatch for ${input.fileName}: expected ${expectedSha256}, got ${actualSha256}`
      );
    }
  }
  await rename(tempPath, filePath);
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let nextIndex = 0;
  const workerCount = Math.max(
    1,
    Math.min(items.length, Math.floor(concurrency) || 1)
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= items.length) {
          return;
        }
        await worker(items[index]);
      }
    })
  );
}

function needsMeetingVad(model: LocalModelManifest) {
  return (
    model.type === 'stt' && Boolean(model.sherpaKind || nativeAsrRuntime(model))
  );
}

async function prepareModelMeetingVad(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  if (!needsMeetingVad(model)) return;
  const modelRoot = safeModelPath(config, model);
  const asset = await resolveMeetingVadAsset(
    config.workspaceRoot,
    [modelRoot],
    true
  );
  if (!asset) throw new Error('Speech detector could not be prepared.');
  // Electron already packages and installs the complete model directory.
  // Include this tiny auxiliary file without adding another model to Settings.
  await mkdir(modelRoot, { recursive: true });
  await copyFile(asset, path.join(modelRoot, 'silero_vad.onnx'));
}

async function runModelDownload(
  config: AiBackendConfig,
  model: LocalModelManifest,
  plan: Awaited<ReturnType<typeof resolveModelDownloadPlan>>
) {
  let job =
    modelDownloads.get(model.id) ??
    (await setModelDownloadJob(config, model, {
      message: 'Preparing model download.',
      status: 'queued',
      totalBytes: plan.totalBytes,
    }));

  job = {
    ...job,
    bytesDownloaded: 0,
    message: 'Downloading model files.',
    progress: 0,
    status: 'downloading',
    totalBytes: plan.totalBytes,
    updatedAt: now(),
  };
  modelDownloads.set(model.id, job);
  await saveModelDownloads(config);

  try {
    const entries = [...plan.entries].sort(
      (left, right) => (right.size ?? 0) - (left.size ?? 0)
    );
    let completedFiles = 0;
    await runWithConcurrency(entries, 3, async entry => {
      job.message = `Downloading ${entry.fileName}`;
      await saveDownloadProgress(config, model, job);
      await downloadModelFile({
        config,
        fileName: entry.fileName,
        job,
        model,
        onBytes: async bytes => {
          job.bytesDownloaded += bytes;
          job.progress = job.totalBytes
            ? Math.max(0, Math.min(0.999, job.bytesDownloaded / job.totalBytes))
            : 0;
        },
        size: entry.size,
        url: entry.url,
      });
      completedFiles += 1;
      job.message = `Downloaded ${completedFiles} of ${entries.length} model files.`;
      await saveDownloadProgress(config, model, job);
    });

    await prepareModelMeetingVad(config, model);
    const localFiles = await localModelFilesStatus(config, model, {
      verifyChecksums: true,
    });
    job = {
      ...job,
      bytesDownloaded: localFiles.bytesDownloaded || job.bytesDownloaded,
      message: 'Model files downloaded.',
      progress: 1,
      status: 'downloaded',
      totalBytes: Math.max(job.totalBytes, localFiles.bytesDownloaded),
      updatedAt: now(),
    };
    modelDownloads.set(model.id, job);
    await saveModelDownloads(config);
    if (model.type === 'stt') {
      void resumeRetainedMeetingTranscriptions(config).catch(() => {});
    }
  } catch (downloadError) {
    job = {
      ...job,
      message: errorMessage(downloadError),
      status: 'error',
      updatedAt: now(),
    };
    modelDownloads.set(model.id, job);
    await saveModelDownloads(config);
    throw downloadError;
  }
}

export async function queueModelDownload(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  await ensureModelDownloadsLoaded(config);
  if (activeModelDownloads.has(model.id)) {
    const startingDownload = startingModelDownloads.get(model.id);
    if (startingDownload) {
      return startingDownload;
    }
    const activeDownload = modelDownloads.get(model.id);
    if (activeDownload) {
      return activeDownload;
    }
  }

  let resolveStarting!: (job: LocalModelDownloadJob) => void;
  let rejectStarting!: (error: unknown) => void;
  const starting = new Promise<LocalModelDownloadJob>((resolve, reject) => {
    resolveStarting = resolve;
    rejectStarting = reject;
  });
  startingModelDownloads.set(model.id, starting);

  const download = (async () => {
    try {
      const plan = await resolveModelDownloadPlan(model);
      const job = await setModelDownloadJob(config, model, {
        message: 'Model download queued.',
        progress: 0.01,
        status: 'queued',
        totalBytes: plan.totalBytes,
      });
      resolveStarting(job);
      await runModelDownload(config, model, plan);
    } catch (error) {
      rejectStarting(error);
      throw error;
    }
  })().finally(() => {
    activeModelDownloads.delete(model.id);
    startingModelDownloads.delete(model.id);
  });
  activeModelDownloads.set(model.id, download);
  download.catch(() => {});
  return starting;
}

function assertSeedModelChecksums(model: LocalModelManifest) {
  const files = modelFileNames(model);
  if (!files.length) {
    throw new Error(`Model ${model.id} does not declare seed files.`);
  }

  const unhashedFiles = files.filter(
    fileName => !expectedFileSha256(model, fileName)
  );
  if (unhashedFiles.length) {
    throw new Error(
      `Model ${model.id} cannot be released as a seed without SHA-256 checksums for: ${unhashedFiles.join(
        ', '
      )}`
    );
  }
}

export async function verifyLocalModelSeed(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  assertSeedModelChecksums(model);
  const files = await localModelFilesStatus(config, model, {
    verifyChecksums: true,
  });
  if (!files.complete) {
    throw new Error(
      `Local seed for ${model.id} is incomplete or failed checksum verification at ${safeModelPath(
        config,
        model
      )}.`
    );
  }

  if (
    needsMeetingVad(model) &&
    !(await verifyMeetingVadFile(
      path.join(safeModelPath(config, model), 'silero_vad.onnx')
    ))
  ) {
    throw new Error(
      `Local seed for ${model.id} is missing its verified speech detector.`
    );
  }

  return {
    bytes: files.bytesDownloaded,
    modelId: model.id,
    path: safeModelPath(config, model),
  };
}

export async function prepareLocalModelSeed(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  assertSeedModelChecksums(model);
  const existing = await localModelFilesStatus(config, model, {
    verifyChecksums: true,
  });
  if (!existing.complete) {
    await queueModelDownload(config, model);
    await activeModelDownloads.get(model.id);
  }

  await prepareModelMeetingVad(config, model);
  return verifyLocalModelSeed(config, model);
}

export async function getLocalModelHealth(config: AiBackendConfig): Promise<{
  device: LocalModelDeviceHealth;
  models: LocalModelHealth[];
}> {
  const availableRamGb = roundGb(availableMemoryBytes());
  const modelRoot = path.join(config.workspaceRoot, '.nota', 'models');
  let availableDiskGb: number | null = null;

  try {
    const disk = await statfs(config.workspaceRoot);
    availableDiskGb = roundGb(disk.bavail * disk.bsize);
  } catch {
    availableDiskGb = null;
  }

  const device: LocalModelDeviceHealth = {
    arch: os.arch(),
    availableDiskGb,
    availableRamGb,
    executionProviders: executionProvidersForPlatform(process.platform),
    modelRoot,
    platform: process.platform,
    recommendedSummaryTier: recommendedSummaryTier(availableRamGb),
    totalRamGb: roundGb(os.totalmem()),
  };

  return {
    device,
    models: await Promise.all(
      modelRegistry.map(async model => ({
        ...model,
        ...fitModelToDevice(model, device),
        ...(await modelDownloadStatus(config, model)),
        runtimeProbe: localModelRuntimeProbes.get(model.id),
      }))
    ),
  };
}

function getBaseSttProviderManifests(
  platform: PlatformId = process.platform
): BaseSttProviderManifest[] {
  const isMac = platform === 'darwin';
  const whistleSupported = !isMac || process.arch === 'arm64';
  const isWindows = platform === 'win32';
  const isLinux = platform === 'linux';

  return [
    {
      id: 'cactus-whistle',
      name: 'Whistle — Small, 7 languages',
      platform: whistleSupported
        ? ['macos', 'windows', 'linux']
        : ['windows', 'linux'],
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: whistleSupported,
      modelId: 'cactus-whistle',
      notes:
        'Compact local transcription in English, German, French, Spanish, Italian, Dutch and Polish. Final text after each phrase.',
    },
    ...(['tiny', 'base', 'small', 'medium', 'large-v3'] as const).map(size => ({
      id: `whisper-${size}-cpp` as SttProviderId,
      name: `Whisper ${size === 'large-v3' ? 'Large v3' : size[0].toUpperCase() + size.slice(1)} Q5`,
      platform: ['macos', 'windows', 'linux'] as Array<
        'macos' | 'windows' | 'linux'
      >,
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: false,
      modelId: `whisper-${size}-q5-cpp`,
      notes:
        'Multilingual whisper.cpp with automatic detection or a preferred language. Final text after each phrase.',
    })),
    {
      id: 'apple-speechanalyzer',
      languages: appleSpeechBridge.supportedLocales,
      installedLanguages: appleSpeechBridge.installedLocales,
      systemLocale: appleSpeechBridge.systemLocale,
      name: 'Apple System Speech — Manual only',
      platform: ['macos', 'ios'],
      local: true,
      streaming: true,
      downloadRequired: false,
      defaultForPlatform: false,
      unavailableReason:
        appleSpeechBridge.reason ??
        'Apple SpeechAnalyzer native bridge has not registered yet.',
      notes:
        'Choose an Apple-supported speech language and download its pack on this Mac. Speech recognition runs locally.',
    },
    {
      id: 'nemotron-sherpa',
      name: 'Nemotron 3.5 — Fast live captions',
      platform: ['macos', 'windows', 'linux'],
      local: true,
      streaming: true,
      downloadRequired: true,
      defaultForPlatform: !whistleSupported && (isMac || isWindows || isLinux),
      unavailableReason:
        'Native Nemotron requires the sherpa-onnx runtime and downloaded 560 ms INT8 model files.',
      modelId: 'sherpa-nemotron-3.5-streaming-560ms-int8',
      notes:
        'Fast native streaming model with live partials and automatic transcription across 32 ready locales.',
    },
    {
      id: 'parakeet-sherpa',
      name: 'Parakeet TDT v3 — Multilingual phrase finals',
      platform: ['macos', 'windows', 'linux'],
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: false,
      unavailableReason:
        'Native Parakeet requires the sherpa-onnx runtime and downloaded v3 INT8 model files.',
      modelId: 'sherpa-parakeet-tdt-0.6b-v3-int8',
      notes:
        'Optional native multilingual model that produces final text after each spoken phrase.',
    },
    {
      id: 'cohere-onnx',
      name: 'Cohere Transcribe — 14 languages',
      platform: ['macos', 'windows', 'linux'],
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: false,
      unavailableReason:
        'Native Cohere requires sherpa-onnx, its model files, and multilingual Whisper Tiny for language detection.',
      modelId: 'cohere-transcribe-03-2026-onnx',
      notes:
        'Optional post-meeting accuracy model. Auto-detects each phrase with shared Whisper Tiny, but is slower than realtime on this Mac.',
    },
    {
      id: 'distil-whisper-large-v3-5-onnx',
      name: 'Distil-Whisper Large v3.5 — Accurate English',
      platform: ['macos', 'windows', 'linux'],
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: false,
      unavailableReason:
        'Native Distil-Whisper requires the sherpa-onnx runtime and downloaded model files.',
      modelId: 'distil-whisper-large-v3-5-onnx-q4',
      notes:
        'Higher-accuracy native English model for VAD-chunk and post-meeting transcription.',
    },
    {
      id: 'moonshine-base-onnx',
      name: 'Moonshine Base v2 — Fast English',
      platform: ['macos', 'windows', 'linux'],
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: false,
      unavailableReason:
        'Native Moonshine requires the sherpa-onnx runtime and downloaded model files.',
      modelId: 'moonshine-base-onnx-q4',
      notes:
        'Fast native English model for low-latency VAD-chunk transcription on modest devices.',
    },
    {
      id: 'whisper-tiny-en-onnx',
      name: 'Whisper Tiny — Lightweight multilingual',
      platform: ['macos', 'windows', 'linux'],
      local: true,
      streaming: false,
      downloadRequired: true,
      defaultForPlatform: false,
      unavailableReason:
        'Native Whisper Tiny requires the sherpa-onnx runtime and downloaded model files.',
      modelId: 'whisper-tiny-en-onnx-q4',
      notes:
        'Fast multilingual fallback with automatic spoken-language detection.',
    },
  ];
}

function providerSupportedOnPlatform(
  provider: BaseSttProviderManifest,
  platform: PlatformId
) {
  if (platform === 'darwin') return provider.platform.includes('macos');
  if (platform === 'win32') return provider.platform.includes('windows');
  if (platform === 'linux') return provider.platform.includes('linux');
  return false;
}

function modelById(modelId: string | undefined) {
  return modelRegistry.find(model => model.id === modelId) ?? null;
}

async function sherpaDecoderOptions(
  config: AiBackendConfig,
  model: LocalModelManifest,
  language = 'auto'
) {
  validateMeetingSttLanguage(language);
  if (language !== 'auto') {
    validateMeetingSttLanguageProvider(
      language,
      model.sherpaKind === 'nemotron-streaming' ? 'nemotron-sherpa' : ''
    );
    return { language };
  }
  const detector = modelById(model.languageDetectorModelId);
  if (!detector || !(await localModelFilesStatus(config, detector)).complete) {
    return {};
  }
  return { languageDetectorRoot: safeModelPath(config, detector) };
}

function scheduleMeetingSttRuntimeUnload(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  const vadPath = path.join(
    config.workspaceRoot,
    '.nota',
    'models',
    'shared',
    'silero_vad.onnx'
  );
  scheduleSttRuntimeUnload(sttUnloadKey('silero', vadPath), async () => {
    const pending = sileroVadRuntimes.get(vadPath);
    sileroVadRuntimes.delete(vadPath);
    const loaded = await pending?.catch(() => null);
    if (loaded) await releaseOrtSession(loaded.vad);
  });

  const model = modelById(
    runtime.provider.modelId || runtime.meeting.sttModelId
  );
  if (!model || model.type !== 'stt') {
    return;
  }

  if (isChunkedOnnxProviderId(runtime.provider.id)) {
    const cacheKey = model.id;
    scheduleSttRuntimeUnload(
      sttUnloadKey('transformers', cacheKey),
      async () => {
        const pending = sttPipelines.get(cacheKey);
        sttPipelines.delete(cacheKey);
        const pipeline = await pending?.catch(() => null);
        await pipeline?.dispose?.();
      }
    );
  }
}

function modelDownloadGuidance(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  return `Download ${model.id} from Settings or POST /v1/local/models/${encodeURIComponent(
    model.id
  )}/download, then check GET /v1/local/models/${encodeURIComponent(
    model.id
  )}. Local path: ${safeModelPath(config, model)}`;
}

function publicAppleSpeechBridge() {
  return { ...appleSpeechBridge };
}

function updateAppleSpeechBridge(input: {
  available?: boolean;
  reason?: string | null;
  version?: string | null;
  supportedLocales?: string[];
  installedLocales?: string[];
  systemLocale?: string | null;
}) {
  const timestamp = now();
  if (Array.isArray(input.supportedLocales))
    appleSpeechBridge.supportedLocales = input.supportedLocales.filter(
      value => typeof value === 'string'
    );
  if (Array.isArray(input.installedLocales))
    appleSpeechBridge.installedLocales = input.installedLocales.filter(
      value => typeof value === 'string'
    );
  if (input.systemLocale !== undefined)
    appleSpeechBridge.systemLocale = input.systemLocale;
  appleSpeechBridge.available = input.available === true;
  appleSpeechBridge.reason =
    typeof input.reason === 'string'
      ? input.reason
      : appleSpeechBridge.available
        ? null
        : 'Apple SpeechAnalyzer bridge is not available.';
  appleSpeechBridge.version =
    typeof input.version === 'string' ? input.version : null;
  appleSpeechBridge.registeredAt ||= timestamp;
  appleSpeechBridge.updatedAt = timestamp;
  return publicAppleSpeechBridge();
}

async function runtimeAvailable(runtime: LocalModelManifest['runtime']) {
  if (runtime === 'cactus-needle' || runtime === 'whisper.cpp')
    return nativeAsrRuntimeAvailable(runtime);
  if (runtime === 'apple-speech') {
    return appleSpeechBridge.available;
  }

  try {
    if (runtime === 'sherpa-onnx') {
      return await sherpaRuntimeAvailable();
    }
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<unknown>;
    if (runtime === 'onnxruntime-genai') {
      await dynamicImport('onnxruntime-genai');
      return true;
    }
    await dynamicImport('onnxruntime-node');
    return true;
  } catch {
    return false;
  }
}

function localModelProbeResult(
  model: LocalModelManifest,
  input: Omit<
    LocalModelRuntimeProbe,
    'checkedAt' | 'modelId' | 'modelPath' | 'runtimeId'
  > & { config: AiBackendConfig }
): LocalModelRuntimeProbe {
  const probe: LocalModelRuntimeProbe = {
    canLoad: input.canLoad,
    checkedAt: now(),
    message: input.message,
    modelId: model.id,
    modelPath: safeModelPath(input.config, model),
    runtimeAvailable: input.runtimeAvailable,
    runtimeId: model.runtime,
    status: input.status,
  };
  localModelRuntimeProbes.set(model.id, probe);
  return probe;
}

async function probeLocalModelRuntime(
  config: AiBackendConfig,
  model: LocalModelManifest
): Promise<LocalModelRuntimeProbe> {
  if (model.releaseState === 'blocked') {
    return localModelProbeResult(model, {
      canLoad: false,
      config,
      message:
        model.notes ?? 'This model is blocked until a trusted package exists.',
      runtimeAvailable: false,
      status: 'unsupported',
    });
  }

  if (model.releaseState === 'planned') {
    return localModelProbeResult(model, {
      canLoad: false,
      config,
      message:
        model.notes ??
        'This model is planned, but its runtime path is not ready yet.',
      runtimeAvailable: false,
      status: 'planned',
    });
  }

  const files = await localModelFilesStatus(config, model, {
    verifyChecksums: true,
  });
  if (!files.complete) {
    return localModelProbeResult(model, {
      canLoad: false,
      config,
      message: `${model.id} is not downloaded and verified yet. ${modelDownloadGuidance(
        config,
        model
      )}`,
      runtimeAvailable: false,
      status: 'missing_model',
    });
  }

  const languageDetector = modelById(model.languageDetectorModelId);
  if (
    model.languageDetectorRequired !== false &&
    languageDetector &&
    !(
      await localModelFilesStatus(config, languageDetector, {
        verifyChecksums: true,
      })
    ).complete
  ) {
    return localModelProbeResult(model, {
      canLoad: false,
      config,
      message: `${model.id} also needs the verified ${languageDetector.id} language detector. ${modelDownloadGuidance(
        config,
        languageDetector
      )}`,
      runtimeAvailable: await sherpaRuntimeAvailable(),
      status: 'missing_model',
    });
  }

  if (model.type === 'embedding') {
    const runtimeReady = await runtimeAvailable(model.runtime);
    if (!runtimeReady) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: `${model.runtime} runtime package is not installed.`,
        runtimeAvailable: false,
        status: 'missing_runtime',
      });
    }

    try {
      const probe = await probeEmbeddingModel(config, model.id);
      return localModelProbeResult(model, {
        canLoad: true,
        config,
        message: `Local embedding pipeline loaded successfully with ${probe.dimensions} dimensions.`,
        runtimeAvailable: true,
        status: 'available',
      });
    } catch (probeError) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: errorMessage(probeError),
        runtimeAvailable: true,
        status: 'failed',
      });
    }
  }

  if (model.type === 'text') {
    const runtimeReady = await onnxTextRuntimeAvailable();
    if (!runtimeReady) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: '@huggingface/transformers is not installed.',
        runtimeAvailable: false,
        status: 'missing_runtime',
      });
    }

    if (!isLocalOnnxTextModel(model.id)) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: `${model.id} is not supported by the local ONNX text loader.`,
        runtimeAvailable: true,
        status: 'unsupported',
      });
    }

    try {
      await assertLocalOnnxTextReady(config, model.id);
      return localModelProbeResult(model, {
        canLoad: true,
        config,
        message: 'Local ONNX text pipeline loaded successfully.',
        runtimeAvailable: true,
        status: 'available',
      });
    } catch (probeError) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: errorMessage(probeError),
        runtimeAvailable: true,
        status: 'failed',
      });
    }
  }

  const nativeRuntime = nativeAsrRuntime(model);
  if (nativeRuntime) {
    try {
      await preloadNativeAsr(nativeRuntime, nativeAsrModelPath(config, model));
      return localModelProbeResult(model, {
        config,
        canLoad: true,
        runtimeAvailable: true,
        status: 'available',
        message: `${model.id} loaded with ${nativeRuntime}.`,
      });
    } catch (probeError) {
      return localModelProbeResult(model, {
        config,
        canLoad: false,
        runtimeAvailable: nativeAsrRuntimeAvailable(nativeRuntime),
        status: 'failed',
        message: errorMessage(probeError),
      });
    }
  }
  if (model.runtime === 'sherpa-onnx') {
    const kind = sherpaKindForModel(model);
    if (!kind) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: `${model.id} does not declare a sherpa model kind.`,
        runtimeAvailable: await sherpaRuntimeAvailable(),
        status: 'failed',
      });
    }
    try {
      await preloadSherpaRecognizer(
        kind,
        safeModelPath(config, model),
        await sherpaDecoderOptions(config, model)
      );
      return localModelProbeResult(model, {
        canLoad: true,
        config,
        message: `${model.id} loaded with the native sherpa-onnx runtime.`,
        runtimeAvailable: true,
        status: 'available',
      });
    } catch (probeError) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: errorMessage(probeError),
        runtimeAvailable: await sherpaRuntimeAvailable(),
        status: 'failed',
      });
    }
  }

  const runtimeReady = await runtimeAvailable(model.runtime);
  if (!runtimeReady) {
    return localModelProbeResult(model, {
      canLoad: false,
      config,
      message: `${model.runtime} runtime package is not installed.`,
      runtimeAvailable: false,
      status: 'missing_runtime',
    });
  }

  if (model.runtime === 'onnxruntime') {
    try {
      await loadTransformersSttPipeline(config, model);
      return localModelProbeResult(model, {
        canLoad: true,
        config,
        message: 'Transformers local ASR pipeline loaded successfully.',
        runtimeAvailable: true,
        status: 'available',
      });
    } catch (probeError) {
      return localModelProbeResult(model, {
        canLoad: false,
        config,
        message: errorMessage(probeError),
        runtimeAvailable: true,
        status: 'failed',
      });
    }
  }

  return localModelProbeResult(model, {
    canLoad: false,
    config,
    message:
      'ONNX Runtime GenAI streaming STT adapter is not implemented in Nota yet.',
    runtimeAvailable: true,
    status: 'unsupported',
  });
}

function sttModelRoot(config: AiBackendConfig) {
  return path.join(config.workspaceRoot, '.nota', 'models');
}

function pcm16ToFloat32(pcm: Int16Array) {
  const audio = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index++) {
    const sample = pcm[index] ?? 0;
    audio[index] = sample < 0 ? sample / 32768 : sample / 32767;
  }
  return audio;
}

function onnxExecutionProvidersForPlatform(platform: NodeJS.Platform) {
  switch (platform) {
    case 'darwin':
      return ['coreml', 'cpu'];
    case 'win32':
      return ['dml', 'cpu'];
    case 'linux':
      return ['cuda', 'cpu'];
    default:
      return ['cpu'];
  }
}

async function importOnnxRuntimeNode() {
  const dynamicImport = new Function(
    'specifier',
    'return import(specifier)'
  ) as (specifier: string) => Promise<OrtModule>;
  return dynamicImport('onnxruntime-node');
}

async function createOrtSessionWithFallback(
  ort: OrtModule,
  filePath: string
): Promise<{ executionProvider: string; session: OrtInferenceSession }> {
  const providers = onnxExecutionProvidersForPlatform(process.platform);
  for (const provider of providers) {
    try {
      const session = await ort.InferenceSession.create(filePath, {
        executionProviders: [provider],
      });
      if (provider !== providers[0]) {
        console.warn(
          `[meetings] ${path.basename(filePath)} fell back to the ${provider} execution provider (preferred: ${providers[0]})`
        );
      }
      return { executionProvider: provider, session };
    } catch (providerError) {
      if (provider === providers.at(-1)) {
        throw providerError;
      }
    }
  }
  return {
    executionProvider: 'default',
    session: await ort.InferenceSession.create(filePath),
  };
}

function ortTensor(
  ort: OrtModule,
  type: 'float32' | 'int32' | 'int64',
  data: OrtTensorData,
  dims: readonly number[]
) {
  return new ort.Tensor(type, data, dims);
}

function int64Tensor(
  ort: OrtModule,
  values: number[],
  dims: readonly number[]
) {
  return ortTensor(
    ort,
    'int64',
    BigInt64Array.from(values.map(value => BigInt(value))),
    dims
  );
}

interface SileroVadStream {
  // Returns the max speech probability across complete 512-sample windows in
  // this push, or null when no window completed or the VAD model failed (the
  // caller falls back to energy gating).
  push(pcm16: Int16Array): Promise<number | null>;
}

function createSileroVadStream(runtime: SileroVadRuntime): SileroVadStream {
  return createMeetingSileroVad({
    async infer(samples, state) {
      const result = await runtime.vad.run({
        input: ortTensor(runtime.ort, 'float32', samples, [1, samples.length]),
        sr: int64Tensor(runtime.ort, [16_000], [1]),
        state: ortTensor(runtime.ort, 'float32', state, [2, 1, 128]),
      });
      return {
        probability: Number(result.output?.data?.[0] ?? Number.NaN),
        state: Float32Array.from(result.stateN?.data ?? [], value =>
          Number(value)
        ),
      };
    },
    onFailure(error) {
      console.warn(
        'Meeting speech detector failed; using energy fallback',
        errorMessage(error)
      );
    },
  });
}

function mergeChunksToPcm16(chunks: SttAudioChunk[]) {
  const sampleCount = chunks.reduce(
    (total, chunk) => total + chunk.pcm16.length,
    0
  );
  const pcm = new Int16Array(sampleCount);
  let cursor = 0;
  for (const chunk of chunks) {
    pcm.set(chunk.pcm16, cursor);
    cursor += chunk.pcm16.length;
  }
  return pcm;
}

function transcriptionText(output: unknown): string {
  if (typeof output === 'string') {
    return output.trim();
  }
  if (!output || typeof output !== 'object') {
    return '';
  }
  if ('text' in output && typeof output.text === 'string') {
    return output.text.trim();
  }
  if (Array.isArray(output)) {
    return output
      .map(item => transcriptionText(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

async function loadTransformersSttPipeline(
  config: AiBackendConfig,
  model: LocalModelManifest
) {
  if (model.type !== 'stt') {
    throw new Error(`${model.id} is not an STT model.`);
  }
  if (model.runtime !== 'onnxruntime') {
    throw new Error(
      `${model.id} is not supported by the Transformers STT path.`
    );
  }

  cancelSttRuntimeUnload(sttUnloadKey('transformers', model.id));
  const existing = sttPipelines.get(model.id);
  if (existing) {
    return existing;
  }

  const load = (async () => {
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<{
      env: {
        allowLocalModels: boolean;
        allowRemoteModels: boolean;
        localModelPath: string;
      };
      pipeline: (
        task: string,
        modelId: string,
        options?: Record<string, unknown>
      ) => Promise<AsrPipeline>;
    }>;
    const transformers = await dynamicImport('@huggingface/transformers');
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = sttModelRoot(config);
    return transformers.pipeline('automatic-speech-recognition', model.id, {
      device: 'cpu',
      dtype: 'q4',
      local_files_only: true,
    });
  })();

  sttPipelines.set(model.id, load);
  try {
    return await load;
  } catch (loadError) {
    sttPipelines.delete(model.id);
    throw loadError;
  }
}

function isMeetingSttRuntimeCached(
  config: AiBackendConfig,
  provider: SttProviderManifest,
  model: LocalModelManifest
) {
  const nativeRuntime = nativeAsrRuntime(model);
  if (nativeRuntime)
    return isNativeAsrCached(nativeRuntime, nativeAsrModelPath(config, model));
  const sherpaKind = sherpaKindForModel(model);
  if (sherpaKind) {
    return isSherpaRecognizerCached(sherpaKind, safeModelPath(config, model));
  }
  if (isChunkedOnnxProviderId(provider.id)) {
    return sttPipelines.has(model.id);
  }
  return false;
}

async function preloadMeetingSttRuntime(
  config: AiBackendConfig,
  requestedProviderId?: string
): Promise<SttRuntimePreloadResult> {
  const startedAt = Date.now();
  const providers = await sttProviders(config, process.platform);
  const selection = selectMeetingSttProvider({
    config,
    platform: process.platform,
    providers,
    requestedProviderId: requestedProviderId ?? config.meetingSttProviderId,
  });

  const elapsed = () => Date.now() - startedAt;
  if (selection.error || !selection.provider) {
    return {
      available: false,
      cached: false,
      durationMs: elapsed(),
      message: selection.error ?? 'No STT provider is configured.',
      modelId: null,
      providerId: selection.provider?.id ?? null,
      providerName: selection.provider?.name ?? null,
      requestedProviderId: selection.requestedProviderId,
      status: 'unavailable',
    };
  }

  const provider = selection.provider;
  if (provider.id === 'apple-speechanalyzer') {
    return {
      available: provider.available,
      cached: true,
      durationMs: elapsed(),
      message: provider.available
        ? 'Apple SpeechAnalyzer is managed by the native recorder.'
        : provider.unavailableReason || provider.readiness?.reason || null,
      modelId: null,
      providerId: provider.id,
      providerName: provider.name,
      requestedProviderId: selection.requestedProviderId,
      status: provider.available ? 'native' : 'unavailable',
    };
  }

  const model = modelById(provider.modelId ?? config.meetingSttModelId);
  if (!model || model.type !== 'stt') {
    return {
      available: false,
      cached: false,
      durationMs: elapsed(),
      message: `STT model is not registered for ${provider.name}.`,
      modelId: (provider.modelId ?? config.meetingSttModelId) || null,
      providerId: provider.id,
      providerName: provider.name,
      requestedProviderId: selection.requestedProviderId,
      status: 'unavailable',
    };
  }

  const files = await localModelFilesStatus(config, model);
  if (!files.complete) {
    return {
      available: false,
      cached: false,
      durationMs: elapsed(),
      message: `${model.id} is not downloaded yet. ${modelDownloadGuidance(
        config,
        model
      )}`,
      modelId: model.id,
      providerId: provider.id,
      providerName: provider.name,
      requestedProviderId: selection.requestedProviderId,
      status: 'missing_model',
    };
  }

  const languageDetector = modelById(model.languageDetectorModelId);
  if (
    model.languageDetectorRequired !== false &&
    model.languageDetectorModelId &&
    !languageDetector
  ) {
    return {
      available: false,
      cached: false,
      durationMs: elapsed(),
      message: `Language detector is not registered: ${model.languageDetectorModelId}.`,
      modelId: model.id,
      providerId: provider.id,
      providerName: provider.name,
      requestedProviderId: selection.requestedProviderId,
      status: 'missing_model',
    };
  }
  if (
    model.languageDetectorRequired !== false &&
    languageDetector &&
    !(await localModelFilesStatus(config, languageDetector)).complete
  ) {
    return {
      available: false,
      cached: false,
      durationMs: elapsed(),
      message: `${model.id} also needs ${languageDetector.id} for automatic language detection. ${modelDownloadGuidance(
        config,
        languageDetector
      )}`,
      modelId: model.id,
      providerId: provider.id,
      providerName: provider.name,
      requestedProviderId: selection.requestedProviderId,
      status: 'missing_model',
    };
  }

  const wasCached = isMeetingSttRuntimeCached(config, provider, model);
  validateMeetingSttLanguageProvider(
    config.meetingSttLanguage ?? 'auto',
    provider.id
  );
  const nativeRuntime = nativeAsrRuntime(model);
  const sherpaKind = sherpaKindForModel(model);
  if (nativeRuntime) {
    await preloadNativeAsr(nativeRuntime, nativeAsrModelPath(config, model));
  } else if (sherpaKind) {
    await preloadSherpaRecognizer(
      sherpaKind,
      safeModelPath(config, model),
      await sherpaDecoderOptions(config, model, config.meetingSttLanguage)
    );
  } else if (isChunkedOnnxProviderId(provider.id)) {
    await loadTransformersSttPipeline(config, model);
  } else {
    return {
      available: false,
      cached: false,
      durationMs: elapsed(),
      message: `${provider.name} is ready, but its streaming adapter is not implemented yet.`,
      modelId: model.id,
      providerId: provider.id,
      providerName: provider.name,
      requestedProviderId: selection.requestedProviderId,
      status: 'unsupported',
    };
  }

  return {
    available: true,
    cached: wasCached,
    durationMs: elapsed(),
    message: wasCached
      ? `${provider.name} was already loaded.`
      : `${provider.name} loaded.`,
    modelId: model.id,
    providerId: provider.id,
    providerName: provider.name,
    requestedProviderId: selection.requestedProviderId,
    status: wasCached ? 'cached' : 'loaded',
  };
}

async function transcribeSttChunks(input: {
  language?: string;
  chunks: SttAudioChunk[];
  config: AiBackendConfig;
  modelId: string;
}) {
  if (!input.chunks.length) {
    return '';
  }

  const model = modelById(input.modelId);
  if (!model) {
    throw new Error(`Model is not registered: ${input.modelId}.`);
  }
  if (model.type !== 'stt') {
    throw new Error(`${model.id} is not an STT model.`);
  }

  const files = await localModelFilesStatus(input.config, model);
  if (!files.complete) {
    throw new Error(
      `${model.id} is not downloaded yet. ${modelDownloadGuidance(
        input.config,
        model
      )}`
    );
  }

  const nativeRuntime = nativeAsrRuntime(model);
  if (nativeRuntime) {
    const requestedLanguage = input.language ?? 'auto';
    const language =
      requestedLanguage === 'auto' ||
      model.languages.includes(requestedLanguage)
        ? requestedLanguage
        : new Intl.Locale(requestedLanguage).language;
    if (language !== 'auto' && !model.languages.includes(language))
      throw new Error(
        `${model.id} does not support the retained meeting language ${requestedLanguage}.`
      );
    const decoder = await createNativeAsrDecoder(
      nativeRuntime,
      nativeAsrModelPath(input.config, model),
      language
    );
    const outputs: string[] = [];
    for (const chunk of input.chunks) {
      decoder.pushPcm16(chunk.pcm16);
      const result = await decoder.finish();
      if (result.text) outputs.push(result.text);
    }
    return outputs.join(' ');
  }
  if (model.runtime === 'sherpa-onnx') {
    const kind = sherpaKindForModel(model);
    if (!kind) {
      throw new Error(`${model.id} does not declare a sherpa model kind.`);
    }
    const decoder = await createSherpaUtteranceDecoder(
      kind,
      safeModelPath(input.config, model),
      await sherpaDecoderOptions(input.config, model, input.language)
    );
    const outputs: string[] = [];
    for (const chunk of input.chunks) {
      decoder.pushPcm16(chunk.pcm16);
      const text = (await decoder.finish()).text.trim();
      if (text) {
        outputs.push(text);
      }
    }
    return outputs.join(' ');
  }

  const pipeline = await loadTransformersSttPipeline(input.config, model);
  const audio = pcm16ToFloat32(mergeChunksToPcm16(input.chunks));
  if (rms(audio) <= 0.0005) {
    return '';
  }
  const result = await pipeline(audio, {
    chunk_length_s: 30,
    return_timestamps: false,
    sampling_rate: 16000,
  });
  return transcriptionText(result);
}

async function postMeetingSttModelCandidates(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  if (
    runtime.provider.id !== 'apple-speechanalyzer' &&
    runtime.meeting.sttLanguage &&
    runtime.meeting.sttLanguage !== 'auto'
  ) {
    validateMeetingSttLanguageProvider(
      runtime.meeting.sttLanguage,
      runtime.provider.id
    );
    return [runtime.provider.modelId || runtime.meeting.sttModelId];
  }
  const candidateIds = [
    runtime.provider.modelId,
    runtime.meeting.sttModelId,
    'cactus-whistle',
    'whisper-small-q5-cpp',
    'whisper-base-q5-cpp',
    'whisper-tiny-q5-cpp',
    // This small model is bundled in release builds so Apple Speech and any
    // unavailable live provider still have an offline recovery path.
    'whisper-tiny-en-onnx-q4',
    'moonshine-base-onnx-q4',
    'distil-whisper-large-v3-5-onnx-q4',
    'cohere-transcribe-03-2026-onnx',
  ].filter(
    (modelId, index, all): modelId is string =>
      !!modelId && all.indexOf(modelId) === index
  );
  const sttModels = candidateIds
    .map(modelById)
    .filter((model): model is LocalModelManifest => {
      if (model?.type !== 'stt') return false;
      if (
        runtime.provider.id !== 'apple-speechanalyzer' ||
        !runtime.meeting.sttLanguage ||
        runtime.meeting.sttLanguage === 'auto'
      )
        return true;
      const language = new Intl.Locale(runtime.meeting.sttLanguage).language;
      // Apple language packs are managed by macOS. Recover their retained audio
      // only through a local model that accepts that language explicitly.
      return !!nativeAsrRuntime(model) && model.languages.includes(language);
    });

  const installed: string[] = [];
  for (const model of sttModels) {
    if ((await localModelFilesStatus(config, model)).complete) {
      installed.push(model.id);
    }
  }

  // If nothing is installed, return one actionable model so the retained-spool
  // error points at the download needed for recovery. Release builds seed
  // Whisper Tiny, while development/tests may intentionally omit all models.
  return installed.length
    ? installed
    : [sttModels[0]?.id ?? 'whisper-tiny-q5-cpp'];
}

async function transcribeSttChunksWithModelFallback(input: {
  language?: string;
  chunks: SttAudioChunk[];
  config: AiBackendConfig;
  modelIds: string[];
  onAttempt?: (modelId: string) => void;
}) {
  const result = await firstSuccessfulMeetingSttModel({
    execute: modelId =>
      transcribeSttChunks({
        chunks: input.chunks,
        config: input.config,
        modelId,
        language: input.language,
      }),
    modelIds: input.modelIds,
    onAttempt: input.onAttempt,
  });
  return { modelId: result.modelId, text: result.value };
}

export async function firstSuccessfulMeetingSttModel(input: {
  execute: (modelId: string) => Promise<string>;
  modelIds: string[];
  onAttempt?: (modelId: string) => void;
}) {
  const failures: string[] = [];
  // Decode a stable candidate snapshot. Failed candidates are removed from
  // the caller-owned retry list below, and iterating that same mutable array
  // would skip the model that shifts into the removed index.
  const candidates = input.modelIds.slice();
  for (const modelId of candidates) {
    input.onAttempt?.(modelId);
    try {
      const value = (await input.execute(modelId)).trim();
      if (!value) {
        throw new Error('decoder produced no transcript for captured speech');
      }
      return { modelId, value };
    } catch (error) {
      failures.push(`${modelId}: ${errorMessage(error)}`);
      // A complete model whose decoder fails should not trap every later gap
      // or retry. Keep the durable spool and fall through to another installed
      // model, including the bundled Whisper seed.
      const index = input.modelIds.indexOf(modelId);
      if (index >= 0 && input.modelIds.length > 1) {
        input.modelIds.splice(index, 1);
      }
    }
  }
  throw new Error(
    `No installed recovery model could transcribe captured speech. ${failures.join(
      ' | '
    )}`
  );
}

function contiguousFallbackChunkGroups(
  chunks: MeetingFallbackAudioChunk[],
  uncovered: Set<string>
) {
  const groups: MeetingFallbackAudioChunk[][] = [];
  let current: MeetingFallbackAudioChunk[] = [];
  for (const chunk of chunks) {
    if (uncovered.has(chunk.id)) {
      current.push(chunk);
      continue;
    }
    if (current.length) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) {
    groups.push(current);
  }
  return groups;
}

export async function discardMeetingFallbackAudioAfterRecovery(input: {
  fallbackAudioSpool: Pick<MeetingFallbackAudioSpool, 'discard'>;
  unresolvedGroups: number;
}) {
  if (input.unresolvedGroups > 0) {
    throw new Error(
      `${input.unresolvedGroups} captured speech gap${
        input.unresolvedGroups === 1 ? '' : 's'
      } produced no transcript.`
    );
  }
  await input.fallbackAudioSpool.discard();
}

async function transcribeStoppedMeetingFallback(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  if (!(await runtime.fallbackAudioSpool.hasChunks())) {
    return;
  }

  runtime.stt.status = 'finalizing';
  runtime.stt.message = 'Checking captured speech for transcript gaps.';
  broadcast(runtime, 'status', {
    type: 'status',
    meeting: publicMeeting(runtime),
  });

  try {
    const fallbackSegments: TranscriptSegment[] = [];
    let capturedChunks = 0;
    let completedWindows = 0;
    let recoveredChunks = 0;
    let unresolvedGroups = 0;
    let verifiedChunks = 0;
    let modelIds: string[] | null = null;
    for await (const chunks of runtime.fallbackAudioSpool.windows()) {
      capturedChunks += chunks.length;
      const uncoveredChunks = fallbackAudioChunksWithoutTranscriptCoverage(
        chunks,
        runtime.transcriptSegments
      );
      verifiedChunks += chunks.length - uncoveredChunks.length;
      const uncoveredIds = new Set(uncoveredChunks.map(chunk => chunk.id));
      const groups = contiguousFallbackChunkGroups(chunks, uncoveredIds);

      for (const group of groups) {
        completedWindows++;
        recoveredChunks += group.length;
        modelIds ??= await postMeetingSttModelCandidates(config, runtime);
        const decoded = await transcribeSttChunksWithModelFallback({
          language: runtime.meeting.sttLanguage ?? 'auto',
          chunks: group,
          config,
          modelIds,
          onAttempt: modelId => {
            runtime.stt.message = `Recovering transcript gap ${completedWindows} with ${modelId}.`;
          },
        });
        const { text } = decoded;
        if (!text.trim()) {
          unresolvedGroups++;
          continue;
        }
        const first = group[0];
        const last = group.at(-1) ?? first;
        if (!first || !last) {
          unresolvedGroups++;
          continue;
        }
        fallbackSegments.push({
          createdAt: now(),
          endMs: last.endMs,
          id: randomUUID(),
          meetingId: runtime.meeting.id,
          source: first.source,
          startMs: first.startMs,
          text,
          type: 'final',
        });
      }
    }

    fallbackSegments
      .sort(
        (first, second) =>
          first.startMs - second.startMs || first.endMs - second.endMs
      )
      .forEach(segment => applyTranscriptSegment(runtime, segment));
    await persistMeetings(config);
    // Every uncovered speech window produced a non-empty transcript, or was
    // already covered by a final segment. Only then is it safe to drop the
    // rebuildable PCM spool.
    await discardMeetingFallbackAudioAfterRecovery({
      fallbackAudioSpool: runtime.fallbackAudioSpool,
      unresolvedGroups,
    });
    runtime.stt.message = fallbackSegments.length
      ? `Recovered ${fallbackSegments.length} missing transcript segment${
          fallbackSegments.length === 1 ? '' : 's'
        } from ${recoveredChunks} captured speech chunk${
          recoveredChunks === 1 ? '' : 's'
        }.`
      : recoveredChunks
        ? `Checked ${recoveredChunks} transcript gap chunk${
            recoveredChunks === 1 ? '' : 's'
          }; the local model produced no additional text.`
        : `Verified all ${verifiedChunks || capturedChunks} captured speech chunk${
            (verifiedChunks || capturedChunks) === 1 ? '' : 's'
          } against the live transcript.`;
  } catch (transcriptionError) {
    runtime.stt.message = `Post-meeting transcription unavailable; captured speech remains on disk for retry: ${errorMessage(
      transcriptionError
    )}`;
  }
}

async function finalizeStoppedMeeting(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  try {
    await flushAudioChunks(runtime);
    const session = runtime.sttSession;
    runtime.sttSession = null;
    await session?.stop();
    await transcribeStoppedMeetingFallback(config, runtime);
    if (runtime.stt.status !== 'error') {
      runtime.stt.status = 'stopped';
    }
  } catch (sttError) {
    runtime.stt.status = 'error';
    runtime.stt.message = errorMessage(sttError);
  }

  scheduleMeetingSttRuntimeUnload(config, runtime);
  broadcast(runtime, 'status', {
    type: 'status',
    meeting: publicMeeting(runtime),
  });
  await upsertMeetingSearchDocument(config, runtime).catch(() => {});
  await persistMeetings(config);
}

function startStoppedMeetingFinalization(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  const meetingId = runtime.meeting.id;
  return stoppedMeetingFinalizations.start(meetingId, async () => {
    try {
      await withMeetingAudioOperation(runtime, async () => {
        if (runtime.meeting.status === 'stopped') {
          await finalizeStoppedMeeting(config, runtime);
        }
      });
    } catch (finalizeError) {
      runtime.stt.status = 'error';
      runtime.stt.message = errorMessage(finalizeError);
      broadcast(runtime, 'error', {
        code: 'meeting_stop_finalize_failed',
        message: runtime.stt.message,
        type: 'error',
      });
      await persistMeetings(config).catch(() => {});
      throw finalizeError;
    }
  });
}

export async function finalizeMeetingsBeforeShutdown(config: AiBackendConfig) {
  await ensureMeetingsLoaded(config);

  for (const runtime of meetings.values()) {
    if (runtime.meeting.status === 'stopped') {
      continue;
    }

    runtime.meeting.status = 'stopped';
    runtime.meeting.updatedAt = now();
    if (runtime.stt.status !== 'error') {
      runtime.stt.status = 'finalizing';
      runtime.stt.message = 'Finishing meeting transcription before exit.';
    }
    startStoppedMeetingFinalization(config, runtime).catch(() => {});
  }

  await stoppedMeetingFinalizations.waitAll();
  if (persistMeetingsTimer) {
    clearTimeout(persistMeetingsTimer);
    persistMeetingsTimer = null;
  }
  await persistMeetings(config);
}

export async function resumeRetainedMeetingTranscriptions(
  config: AiBackendConfig
) {
  await ensureMeetingsLoaded(config);
  const recoveries: Promise<void>[] = [];
  for (const runtime of meetings.values()) {
    if (
      runtime.meeting.status !== 'stopped' ||
      !(await runtime.fallbackAudioSpool.hasChunks())
    ) {
      continue;
    }
    runtime.stt.status = 'finalizing';
    runtime.stt.message = 'Resuming retained meeting audio transcription.';
    recoveries.push(startStoppedMeetingFinalization(config, runtime));
  }
  await Promise.allSettled(recoveries);
}

async function sttProviderReadiness(
  config: AiBackendConfig,
  provider: BaseSttProviderManifest,
  platform: PlatformId = process.platform
): Promise<SttProviderReadiness> {
  if (!providerSupportedOnPlatform(provider, platform)) {
    const model = modelById(provider.modelId);
    return {
      available: false,
      canStart: false,
      modelComplete: false,
      modelId: provider.modelId,
      modelPath: model ? safeModelPath(config, model) : undefined,
      reason: `${provider.name} is not supported on ${platform}.`,
      runtimeAvailable: false,
      runtimeId:
        provider.id === 'apple-speechanalyzer'
          ? 'apple-speech'
          : (model?.runtime ?? 'onnxruntime'),
      status: 'unsupported',
    };
  }

  if (provider.id === 'apple-speechanalyzer') {
    if (appleSpeechBridge.available) {
      const locale =
        config.meetingSttProviderId === provider.id &&
        config.meetingSttLanguage !== 'auto'
          ? config.meetingSttLanguage
          : appleSpeechBridge.systemLocale;
      const hasCatalog = appleSpeechBridge.supportedLocales !== undefined;
      const installed =
        !hasCatalog ||
        (!!locale &&
          appleSpeechBridge.installedLocales?.includes(locale) === true);
      return {
        available: installed,
        canStart: installed,
        modelComplete: installed,
        modelId: provider.modelId,
        reason: installed
          ? null
          : locale
            ? `Download the Apple speech language pack for ${locale} in Meeting settings.`
            : 'Choose a supported Apple speech language in Meeting settings.',
        runtimeAvailable: true,
        runtimeId: 'apple-speech',
        status: installed ? 'available' : 'missing_model',
      };
    }

    return {
      available: false,
      canStart: false,
      modelComplete: true,
      modelId: provider.modelId,
      reason:
        appleSpeechBridge.reason ??
        'Apple SpeechAnalyzer native bridge is not registered in Electron yet.',
      runtimeAvailable: false,
      runtimeId: 'apple-speech',
      status: 'missing_runtime',
    };
  }

  const model = modelById(provider.modelId);
  if (!model) {
    return {
      available: false,
      canStart: false,
      modelComplete: false,
      modelId: provider.modelId,
      reason: `Model is not registered: ${provider.modelId ?? 'unknown'}.`,
      runtimeAvailable: false,
      runtimeId: 'onnxruntime',
      status: 'missing_model',
    };
  }

  if (model.releaseState === 'blocked' || model.releaseState === 'planned') {
    return {
      available: false,
      canStart: false,
      modelComplete: false,
      modelId: model.id,
      modelPath: safeModelPath(config, model),
      reason:
        model.notes ??
        `${model.id} is ${model.releaseState} and is not runnable yet.`,
      runtimeAvailable: false,
      runtimeId: model.runtime,
      status: 'unsupported',
    };
  }

  const files = await localModelFilesStatus(config, model);
  let hasRuntime = await runtimeAvailable(model.runtime);
  if (!files.complete) {
    return {
      available: false,
      canStart: false,
      modelComplete: false,
      modelId: model.id,
      modelPath: safeModelPath(config, model),
      reason: `${model.id} is not downloaded yet. ${modelDownloadGuidance(
        config,
        model
      )}`,
      runtimeAvailable: hasRuntime,
      runtimeId: model.runtime,
      status: 'missing_model',
    };
  }

  const languageDetector = modelById(model.languageDetectorModelId);
  if (
    model.languageDetectorRequired !== false &&
    model.languageDetectorModelId &&
    !languageDetector
  ) {
    return {
      available: false,
      canStart: false,
      modelComplete: false,
      modelId: model.id,
      modelPath: safeModelPath(config, model),
      reason: `Language detector is not registered: ${model.languageDetectorModelId}.`,
      runtimeAvailable: hasRuntime,
      runtimeId: model.runtime,
      status: 'missing_model',
    };
  }
  if (
    model.languageDetectorRequired !== false &&
    languageDetector &&
    !(await localModelFilesStatus(config, languageDetector)).complete
  ) {
    return {
      available: false,
      canStart: false,
      modelComplete: false,
      modelId: model.id,
      modelPath: safeModelPath(config, model),
      reason: `${model.id} also needs ${languageDetector.id} for automatic language detection. ${modelDownloadGuidance(
        config,
        languageDetector
      )}`,
      runtimeAvailable: hasRuntime,
      runtimeId: model.runtime,
      status: 'missing_model',
    };
  }

  const sherpaKind = sherpaKindForModel(model);
  if (sherpaKind) {
    const hasSherpaRuntime = await sherpaRuntimeAvailable();
    if (!hasSherpaRuntime) {
      return {
        available: false,
        canStart: false,
        modelComplete: true,
        modelId: model.id,
        modelPath: safeModelPath(config, model),
        reason: 'sherpa-onnx-node runtime package is not installed yet.',
        runtimeAvailable: false,
        runtimeId: model.runtime,
        status: 'missing_runtime',
      };
    }
    return {
      available: true,
      canStart: true,
      modelComplete: true,
      modelId: model.id,
      modelPath: safeModelPath(config, model),
      reason: null,
      runtimeAvailable: true,
      runtimeId: model.runtime,
      status: 'available',
    };
  }

  if (!hasRuntime) {
    return {
      available: false,
      canStart: false,
      modelComplete: true,
      modelId: model.id,
      modelPath: safeModelPath(config, model),
      reason: `${model.runtime} runtime package is not installed yet.`,
      runtimeAvailable: false,
      runtimeId: model.runtime,
      status: 'missing_runtime',
    };
  }

  return {
    available: true,
    canStart: true,
    modelComplete: true,
    modelId: model.id,
    modelPath: safeModelPath(config, model),
    reason: null,
    runtimeAvailable: true,
    runtimeId: model.runtime,
    status: 'available',
  };
}

export function validateAppleSpeechLanguage(
  language: unknown,
  providerId: string
) {
  if (
    providerId === 'apple-speechanalyzer' &&
    typeof language === 'string' &&
    language !== 'auto' &&
    !appleSpeechBridge.supportedLocales?.includes(language)
  ) {
    throw new Error(
      'Selected language is not supported by Apple Speech on this device.'
    );
  }
}

export async function getSttProviderManifests(
  config: AiBackendConfig,
  platform: PlatformId = process.platform
): Promise<SttProviderManifest[]> {
  return Promise.all(
    getBaseSttProviderManifests(platform).map(async provider => {
      const readiness = await sttProviderReadiness(config, provider, platform);
      const transcriptMode = transcriptModeForProvider(provider, readiness);
      return {
        ...provider,
        available: readiness.available,
        canProduceTranscript: canProduceTranscript(provider, readiness),
        readiness,
        transcriptMode,
        unavailableReason: readiness.reason ?? provider.unavailableReason,
      };
    })
  );
}

function transcriptModeForProvider(
  provider: BaseSttProviderManifest,
  readiness: SttProviderReadiness
): SttTranscriptMode {
  if (!readiness.available) {
    return readiness.status === 'unsupported'
      ? 'planned-streaming'
      : 'unavailable';
  }
  if (provider.id === 'apple-speechanalyzer') {
    return 'native-streaming';
  }
  if (provider.id === 'nemotron-sherpa') {
    return 'native-streaming';
  }
  if (isChunkedOnnxProviderId(provider.id)) {
    return 'vad-chunk';
  }
  if (
    readiness.runtimeId === 'sherpa-onnx' ||
    readiness.runtimeId === 'cactus-needle' ||
    readiness.runtimeId === 'whisper.cpp'
  ) {
    return 'vad-chunk';
  }
  return 'planned-streaming';
}

function canProduceTranscript(
  provider: BaseSttProviderManifest,
  readiness: SttProviderReadiness
) {
  return (
    readiness.available &&
    (provider.id === 'apple-speechanalyzer' ||
      readiness.runtimeId === 'sherpa-onnx' ||
      readiness.runtimeId === 'cactus-needle' ||
      readiness.runtimeId === 'whisper.cpp' ||
      isChunkedOnnxProviderId(provider.id))
  );
}

function canProduceTranscriptAfterSetup(provider: SttProviderManifest) {
  if (
    nativeAsrRuntime(modelById(provider.modelId)) ||
    sherpaKindForModel(modelById(provider.modelId)) ||
    isChunkedOnnxProviderId(provider.id)
  ) {
    return provider.readiness?.status === 'missing_model';
  }
  if (provider.id === 'apple-speechanalyzer') {
    return provider.readiness?.status === 'missing_runtime';
  }
  return false;
}

async function sttProviders(config: AiBackendConfig, platform: PlatformId) {
  return getSttProviderManifests(config, platform);
}

export function selectMeetingSttProvider(input: {
  config: AiBackendConfig;
  platform: PlatformId;
  providers: SttProviderManifest[];
  requestedProviderId?: string;
}): {
  error: string | null;
  provider: SttProviderManifest | null;
  requestedProviderId: SttProviderId | 'auto';
} {
  const requested =
    typeof input.requestedProviderId === 'string' &&
    input.requestedProviderId.trim()
      ? input.requestedProviderId.trim()
      : 'auto';

  if (requested !== 'auto') {
    const explicit = input.providers.find(
      provider => provider.id === requested
    );
    if (!explicit) {
      return {
        error: `Unsupported STT provider: ${requested}`,
        provider: null,
        requestedProviderId: 'auto',
      };
    }
    if (!explicit.available) {
      return {
        error:
          explicit.unavailableReason ||
          explicit.readiness?.reason ||
          `${explicit.name} is not available.`,
        provider: null,
        requestedProviderId: explicit.id,
      };
    }
    return {
      error: null,
      provider: explicit,
      requestedProviderId: explicit.id,
    };
  }

  const platformOrder = [
    'cactus-whistle',
    'nemotron-sherpa',
    'whisper-small-cpp',
    'whisper-base-cpp',
    'whisper-tiny-cpp',
    'whisper-medium-cpp',
    'whisper-large-v3-cpp',
    'parakeet-sherpa',
    'whisper-tiny-en-onnx',
    'moonshine-base-onnx',
    'cohere-onnx',
    'distil-whisper-large-v3-5-onnx',
  ];
  const orderedProviders = platformOrder
    .map(providerId =>
      input.providers.find(provider => provider.id === providerId)
    )
    .filter((provider): provider is SttProviderManifest => {
      if (!provider) return false;
      const language = input.config.meetingSttLanguage;
      if (!language || language === 'auto') return true;
      try {
        validateMeetingSttLanguageProvider(language, provider.id);
        return true;
      } catch {
        return false;
      }
    });
  const configured = input.providers.find(
    provider =>
      input.config.meetingSttProviderId !== 'auto' &&
      provider.id !== 'apple-speechanalyzer' &&
      provider.id === input.config.meetingSttProviderId
  );
  // An explicit request remains strict above. In Auto mode, however, the saved
  // provider is only a preference: skip it when it cannot currently transcribe
  // so a bundled/installed provider can keep meeting capture working.
  const availablePriority = [configured, ...orderedProviders].filter(
    (provider): provider is SttProviderManifest => !!provider
  );
  const uniqueAvailablePriority = availablePriority.filter(
    (provider, index, all) =>
      all.findIndex(candidate => candidate.id === provider.id) === index
  );
  const available =
    uniqueAvailablePriority.find(provider => provider.canProduceTranscript) ??
    uniqueAvailablePriority.find(provider => provider.available);
  if (available) {
    return {
      error: null,
      provider: available,
      requestedProviderId: 'auto',
    };
  }

  const uniqueFallbackPriority = orderedProviders.filter(
    (provider, index, all) =>
      all.findIndex(candidate => candidate.id === provider.id) === index
  );
  const actionableFallback = uniqueFallbackPriority.find(provider =>
    canProduceTranscriptAfterSetup(provider)
  );

  return {
    error: null,
    provider:
      actionableFallback ??
      uniqueFallbackPriority[0] ??
      orderedProviders[0] ??
      null,
    requestedProviderId: 'auto',
  };
}

function now() {
  return new Date().toISOString();
}

function error(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(runtime: MeetingRuntime, event: string, data: unknown) {
  for (const client of runtime.clients) {
    writeSse(client, event, data);
  }
}

function publicMeeting(runtime: MeetingRuntime) {
  return {
    ...runtime.meeting,
    partialSegment: runtime.partialSegment,
    stt: runtime.stt,
    transcriptSegments: runtime.transcriptSegments,
  };
}

function reserveMeetingRuntime(runtime: MeetingRuntime) {
  const active = [...meetings.values()].find(
    candidate => candidate.meeting.status === 'recording'
  );
  if (active) {
    return active;
  }

  // This synchronous check-and-set is the process-wide start guard. There is
  // deliberately no await between inspecting the global map and reserving the
  // session, so concurrent HTTP starts cannot both become active.
  meetings.set(runtime.meeting.id, runtime);
  return null;
}

function meetingsCachePath(config: AiBackendConfig) {
  return path.join(
    path.dirname(config.settingsPath),
    'meetings',
    'sessions.json'
  );
}

function meetingFallbackAudioSpool(config: AiBackendConfig, meetingId: string) {
  const meetingCacheRoot = path.dirname(meetingsCachePath(config));
  const safeMeetingId = meetingId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return new MeetingFallbackAudioSpool(
    path.join(meetingCacheRoot, 'fallback-audio', `${safeMeetingId}.spool`)
  );
}

function persistedMeetingRuntime(runtime: MeetingRuntime) {
  return {
    meeting: runtime.meeting,
    partialSegment: runtime.partialSegment,
    stt: runtime.stt,
    transcriptSegments: runtime.transcriptSegments,
  } satisfies PersistedMeetingRuntime;
}

let persistMeetingsSaveQueue = Promise.resolve();

function persistMeetings(config: AiBackendConfig) {
  const filePath = meetingsCachePath(config);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const payload = JSON.stringify(
    {
      meetings: [...meetings.values()]
        .map(persistedMeetingRuntime)
        .sort((a, b) => b.meeting.updatedAt.localeCompare(a.meeting.updatedAt)),
      updatedAt: now(),
      version: 1,
    } satisfies PersistedMeetingsFile,
    null,
    2
  );
  const save = persistMeetingsSaveQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(temporaryPath, payload);
      await rename(temporaryPath, filePath);
    });
  persistMeetingsSaveQueue = save;
  return save;
}

async function persistMeetingMutation(
  config: AiBackendConfig,
  mutation: 'meeting summary' | 'meeting update'
) {
  try {
    await persistMeetings(config);
  } catch (persistenceError) {
    throw new Error(
      `Failed to persist ${mutation}: ${errorMessage(persistenceError)}`
    );
  }
}

// Live transcription can finalize an utterance every couple of seconds;
// rewriting the full sessions cache each time churns the disk for a file that
// only needs to be roughly current (it is rebuildable runtime cache).
let persistMeetingsTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_MEETINGS_DEBOUNCE_MS = 3000;

function schedulePersistMeetings(config: AiBackendConfig) {
  if (persistMeetingsTimer) {
    return;
  }
  persistMeetingsTimer = setTimeout(() => {
    persistMeetingsTimer = null;
    persistMeetings(config).catch(() => {});
  }, PERSIST_MEETINGS_DEBOUNCE_MS);
}

function readPersistedSttState(
  value: unknown,
  provider: SttProviderManifest
): SttState {
  const record =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const audioFramesBySource =
    record.audioFramesBySource && typeof record.audioFramesBySource === 'object'
      ? (record.audioFramesBySource as Record<string, unknown>)
      : {};
  const lastAudioFrameLevel =
    typeof record.lastAudioFrameLevel === 'number' &&
    Number.isFinite(record.lastAudioFrameLevel)
      ? record.lastAudioFrameLevel
      : null;
  const lastAudioFrameSource =
    record.lastAudioFrameSource === 'mic' ||
    record.lastAudioFrameSource === 'system'
      ? record.lastAudioFrameSource
      : null;
  const requestedProviderId =
    record.requestedProviderId === 'nemotron-onnx'
      ? 'nemotron-sherpa'
      : record.requestedProviderId;
  return {
    audioFrames: Number(record.audioFrames) || 0,
    audioFramesBySource: {
      mic: Number(audioFramesBySource.mic) || 0,
      system: Number(audioFramesBySource.system) || 0,
    },
    completedSpeechChunks: Number(record.completedSpeechChunks) || 0,
    decodeRealtimeFactor:
      typeof record.decodeRealtimeFactor === 'number' &&
      Number.isFinite(record.decodeRealtimeFactor)
        ? record.decodeRealtimeFactor
        : null,
    detectedLanguage:
      typeof record.detectedLanguage === 'string'
        ? record.detectedLanguage
        : null,
    executionProvider:
      typeof record.executionProvider === 'string'
        ? record.executionProvider
        : null,
    failedSpeechChunks: Number(record.failedSpeechChunks) || 0,
    lastNormalizedAudioFrameAt:
      typeof record.lastNormalizedAudioFrameAt === 'string'
        ? record.lastNormalizedAudioFrameAt
        : null,
    lastSpeechChunkAt:
      typeof record.lastSpeechChunkAt === 'string'
        ? record.lastSpeechChunkAt
        : null,
    lastAudioFrameAt:
      typeof record.lastAudioFrameAt === 'string'
        ? record.lastAudioFrameAt
        : null,
    lastAudioFrameLevel,
    lastAudioFrameSource,
    message:
      typeof record.message === 'string'
        ? record.message
        : 'Meeting cache was restored after backend restart.',
    normalizedAudioFrames: Number(record.normalizedAudioFrames) || 0,
    requestedProviderId:
      requestedProviderId === 'auto' ||
      isKnownSttProviderId(requestedProviderId)
        ? requestedProviderId
        : provider.id,
    providerId: provider.id,
    queuedSpeechChunks: 0,
    readiness: provider.readiness ?? null,
    speechChunks: Number(record.speechChunks) || 0,
    status: 'stopped',
  };
}

function readPersistedMeeting(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const meeting = record.meeting as Record<string, unknown> | undefined;
  if (
    !meeting ||
    typeof meeting.id !== 'string' ||
    (!isKnownSttProviderId(meeting.providerId) &&
      meeting.providerId !== 'nemotron-onnx') ||
    typeof meeting.sttModelId !== 'string' ||
    typeof meeting.createdAt !== 'string' ||
    typeof meeting.updatedAt !== 'string'
  ) {
    return null;
  }

  const transcriptSegments = Array.isArray(record.transcriptSegments)
    ? record.transcriptSegments.filter(
        (segment): segment is TranscriptSegment =>
          !!segment &&
          typeof segment === 'object' &&
          typeof (segment as TranscriptSegment).id === 'string' &&
          typeof (segment as TranscriptSegment).meetingId === 'string' &&
          typeof (segment as TranscriptSegment).text === 'string'
      )
    : [];
  const partialSegment =
    record.partialSegment &&
    typeof record.partialSegment === 'object' &&
    typeof (record.partialSegment as TranscriptSegment).id === 'string'
      ? (record.partialSegment as TranscriptSegment)
      : null;

  return {
    meeting: {
      createdAt: meeting.createdAt,
      docId: typeof meeting.docId === 'string' ? meeting.docId : null,
      id: meeting.id,
      microphoneRecordingPath:
        typeof meeting.microphoneRecordingPath === 'string'
          ? meeting.microphoneRecordingPath
          : null,
      providerId: meeting.providerId,
      recordingDurationMs:
        typeof meeting.recordingDurationMs === 'number' &&
        Number.isFinite(meeting.recordingDurationMs)
          ? meeting.recordingDurationMs
          : null,
      recordingPath:
        typeof meeting.recordingPath === 'string'
          ? meeting.recordingPath
          : null,
      savedTranscriptSegmentIds: Array.isArray(
        meeting.savedTranscriptSegmentIds
      )
        ? meeting.savedTranscriptSegmentIds.filter(
            (segmentId): segmentId is string =>
              typeof segmentId === 'string' && !!segmentId
          )
        : [],
      savedTranscriptSegmentSnapshots: readSavedTranscriptSegmentSnapshots(
        meeting.savedTranscriptSegmentSnapshots
      ),
      status: 'stopped',
      sttModelId: meeting.sttModelId,
      sttLanguage:
        typeof meeting.sttLanguage === 'string' ? meeting.sttLanguage : 'auto',
      summary: typeof meeting.summary === 'string' ? meeting.summary : null,
      summaryDocIds: Array.isArray(meeting.summaryDocIds)
        ? meeting.summaryDocIds.filter(
            (docId): docId is string => typeof docId === 'string' && !!docId
          )
        : typeof meeting.docId === 'string'
          ? [meeting.docId]
          : [],
      transcriptSaveInitialized: meeting.transcriptSaveInitialized === true,
      updatedAt: meeting.updatedAt,
      workspaceId:
        typeof meeting.workspaceId === 'string' ? meeting.workspaceId : null,
    } satisfies MeetingSession,
    partialSegment,
    stt: record.stt,
    transcriptSegments,
  };
}

function readSavedTranscriptSegmentSnapshots(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        !!entry[0].trim() && typeof entry[1] === 'string' && !!entry[1].trim()
    )
  );
}

function ensureMeetingsLoaded(config: AiBackendConfig) {
  meetingsLoading ??= loadMeetings(config).catch(error => {
    meetingsLoading = null;
    throw error;
  });
  return meetingsLoading;
}

async function loadMeetings(config: AiBackendConfig) {
  let parsed: PersistedMeetingsFile;
  try {
    parsed = JSON.parse(
      await readFile(meetingsCachePath(config), 'utf8')
    ) as PersistedMeetingsFile;
  } catch {
    return;
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.meetings)) {
    return;
  }

  const providers = await sttProviders(config, process.platform);
  for (const candidate of parsed.meetings) {
    const stored = readPersistedMeeting(candidate);
    if (!stored || meetings.has(stored.meeting.id)) {
      continue;
    }
    const recoveryProviderId =
      stored.meeting.providerId === 'nemotron-onnx'
        ? 'nemotron-sherpa'
        : stored.meeting.providerId;
    const provider = providers.find(item => item.id === recoveryProviderId);
    if (!provider) {
      continue;
    }
    meetings.set(stored.meeting.id, {
      audioOperation: Promise.resolve(),
      clients: new Set(),
      fallbackAudioSpool: meetingFallbackAudioSpool(config, stored.meeting.id),
      meeting: stored.meeting,
      partialSegment: stored.partialSegment,
      provider,
      stt: readPersistedSttState(stored.stt, provider),
      sttSession: null,
      transcriptSegments: stored.transcriptSegments,
      vad: {
        mic: new MeetingAudioVadBuffer(),
        system: new MeetingAudioVadBuffer(),
      },
    });
  }
}

async function getMeetingRuntime(config: AiBackendConfig, id: string) {
  await ensureMeetingsLoaded(config);
  return meetings.get(id) ?? null;
}

function formatMs(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}`;
}

function formatMsRange(segment: Pick<TranscriptSegment, 'endMs' | 'startMs'>) {
  return `${formatMs(segment.startMs)} - ${formatMs(segment.endMs)}`;
}

function transcriptText(runtime: MeetingRuntime) {
  return runtime.transcriptSegments
    .map(segment => {
      const speaker =
        runtime.provider.id === 'apple-speechanalyzer'
          ? segment.source === 'mic'
            ? 'You'
            : 'Meeting'
          : 'Speaker';
      return `[${formatMsRange(segment)}] ${speaker}: ${segment.text}`;
    })
    .join('\n');
}

function normalizedTranscriptText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function transcriptSegmentOverlap(
  first: Pick<TranscriptSegment, 'endMs' | 'startMs'>,
  second: Pick<TranscriptSegment, 'endMs' | 'startMs'>
) {
  return Math.max(
    0,
    Math.min(first.endMs, second.endMs) -
      Math.max(first.startMs, second.startMs)
  );
}

const FALLBACK_TRANSCRIPT_COVERAGE_TOLERANCE_MS = 250;

export function fallbackAudioChunksWithoutTranscriptCoverage(
  chunks: MeetingFallbackAudioChunk[],
  transcriptSegments: TranscriptSegment[]
) {
  return chunks.filter(chunk => {
    return !transcriptSegments.some(segment => {
      if (segment.type !== 'final' || segment.source !== chunk.source) {
        return false;
      }
      // A mixed live decoder labels each final with its dominant source. That
      // final cannot prove simultaneous speech from the other source was
      // decoded, so only suppress the matching source's durable audio.
      // Partial overlap is not enough: it can represent a decoded prefix with
      // the end of an utterance missing. A small boundary tolerance accounts
      // for VAD pre/post-roll around an otherwise complete native final.
      return (
        transcriptSegmentOverlap(chunk, segment) > 0 &&
        segment.startMs <=
          chunk.startMs + FALLBACK_TRANSCRIPT_COVERAGE_TOLERANCE_MS &&
        segment.endMs >= chunk.endMs - FALLBACK_TRANSCRIPT_COVERAGE_TOLERANCE_MS
      );
    });
  });
}

export function shouldCoalesceFinalTranscriptSegments(
  first: Pick<TranscriptSegment, 'endMs' | 'id' | 'startMs'>,
  second: Pick<TranscriptSegment, 'endMs' | 'id' | 'startMs'>
) {
  if (first.id === second.id) {
    return true;
  }

  const overlap = transcriptSegmentOverlap(first, second);
  if (overlap <= 0) {
    return false;
  }

  const firstDurationMs = Math.max(0, first.endMs - first.startMs);
  const secondDurationMs = Math.max(0, second.endMs - second.startMs);
  const shorterDurationMs = Math.min(firstDurationMs, secondDurationMs);
  if (shorterDurationMs <= 0) {
    return false;
  }

  return overlap >= Math.max(1, Math.min(400, shorterDurationMs / 3));
}

function finalTranscriptCount(runtime: MeetingRuntime) {
  return runtime.transcriptSegments.filter(segment => segment.type === 'final')
    .length;
}

function meetingSearchDocId(runtime: MeetingRuntime) {
  return runtime.meeting.docId || `meeting:${runtime.meeting.id}`;
}

function meetingSearchMarkdown(runtime: MeetingRuntime) {
  const meeting = runtime.meeting;
  const transcript = transcriptText(runtime).trim();
  return [
    `# Meeting ${meeting.createdAt.slice(0, 10)}`,
    '',
    `- Meeting ID: ${meeting.id}`,
    `- Workspace ID: ${meeting.workspaceId ?? 'local'}`,
    `- Started: ${meeting.createdAt}`,
    `- Stopped: ${meeting.status === 'stopped' ? meeting.updatedAt : 'not stopped'}`,
    `- Recording: ${meeting.recordingPath || 'not saved'}`,
    `- Microphone recording: ${meeting.microphoneRecordingPath || 'not saved'}`,
    `- STT provider: ${meeting.providerId}`,
    `- STT model: ${meeting.sttModelId || 'none'}`,
    '',
    '## Transcript',
    '',
    transcript || '_No transcript captured yet._',
    '',
    '## Summary',
    '',
    meeting.summary?.trim() || '_No summary generated yet._',
  ].join('\n');
}

async function upsertMeetingSearchDocument(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  // Once the renderer links a real Nota document, its canonical Markdown export
  // owns this docId in the workspace index. The synthetic meeting mirror exists
  // only until that linkage and must never overwrite renderer-owned note content.
  if (runtime.meeting.docId) {
    return;
  }
  const workspaceId = runtime.meeting.workspaceId || 'local';
  const title = `Meeting ${runtime.meeting.createdAt.slice(0, 10)}`;
  await upsertWorkspaceContentDocuments(config, {
    documents: [
      {
        docId: meetingSearchDocId(runtime),
        markdown: meetingSearchMarkdown(runtime),
        source: 'transcript',
        title,
        updatedAt: runtime.meeting.updatedAt,
      },
    ],
    workspaceId,
  });
}

function applyTranscriptSegment(
  runtime: MeetingRuntime,
  segment: TranscriptSegment
) {
  runtime.meeting.updatedAt = now();
  if (segment.type === 'final' && segment.language) {
    runtime.stt.detectedLanguage = segment.language;
  }

  if (segment.type === 'partial') {
    runtime.partialSegment = segment;
  } else {
    const overlapIndex = runtime.transcriptSegments.findIndex(existing => {
      if (existing.type !== 'final' || existing.source !== segment.source) {
        return false;
      }
      return shouldCoalesceFinalTranscriptSegments(existing, segment);
    });

    if (overlapIndex >= 0) {
      const existing = runtime.transcriptSegments[overlapIndex];
      if (existing) {
        const existingText = normalizedTranscriptText(existing.text);
        const nextText = normalizedTranscriptText(segment.text);
        const sameSegment = existing.id === segment.id;
        const related =
          sameSegment ||
          existingText.includes(nextText) ||
          nextText.includes(existingText);
        if (related) {
          const keepNext = sameSegment || nextText.length > existingText.length;
          const merged = {
            ...existing,
            endMs: Math.max(existing.endMs, segment.endMs),
            language: keepNext
              ? (segment.language ?? existing.language)
              : existing.language,
            startMs: Math.min(existing.startMs, segment.startMs),
            text: keepNext ? segment.text : existing.text,
          };
          runtime.transcriptSegments[overlapIndex] = merged;
          runtime.partialSegment = null;
          broadcast(runtime, segment.type, {
            segment: merged,
            type: segment.type,
          });
          return;
        }
      }
    }

    runtime.transcriptSegments.push(segment);
    runtime.partialSegment = null;
  }

  broadcast(runtime, segment.type, { type: segment.type, segment });
}

async function persistTranscriptEvent(
  config: AiBackendConfig,
  runtime: MeetingRuntime,
  segment: TranscriptSegment
) {
  schedulePersistMeetings(config);
  if (segment.type === 'final') {
    await upsertMeetingSearchDocument(config, runtime).catch(() => {});
  }
}

function readTranscriptSegmentInput(req: Request, meetingId: string) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    throw new Error('Transcript text is required.');
  }

  const type: TranscriptSegmentType =
    body.type === 'partial' ? 'partial' : 'final';
  const source: TranscriptSource = body.source === 'system' ? 'system' : 'mic';
  const startMs = Number.isFinite(Number(body.startMs))
    ? Math.max(0, Number(body.startMs))
    : 0;
  const endMs = Number.isFinite(Number(body.endMs))
    ? Math.max(startMs, Number(body.endMs))
    : startMs;
  const confidence = Number.isFinite(Number(body.confidence))
    ? Math.max(0, Math.min(1, Number(body.confidence)))
    : undefined;
  const language =
    typeof body.language === 'string' &&
    /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(body.language.trim())
      ? body.language.trim()
      : undefined;

  return {
    id: typeof body.id === 'string' ? body.id : randomUUID(),
    meetingId,
    type,
    text,
    startMs,
    endMs,
    source,
    language,
    confidence,
    createdAt: now(),
  } satisfies TranscriptSegment;
}

function readAudioLevelInput(req: Request) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const source: TranscriptSource = body.source === 'mic' ? 'mic' : 'system';
  const rawLevel = Number(body.level);
  const level = Number.isFinite(rawLevel)
    ? Math.max(0, Math.min(1, rawLevel))
    : 0;

  return { level, source };
}

function audioLevelFromPcmF32Le(pcm: Buffer) {
  const sampleCount = Math.floor(
    pcm.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  if (!sampleCount) {
    return 0;
  }

  const stride = Math.max(1, Math.floor(sampleCount / 4096));
  let count = 0;
  let sum = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += stride) {
    const sample = pcm.readFloatLE(
      sampleIndex * Float32Array.BYTES_PER_ELEMENT
    );
    if (!Number.isFinite(sample)) {
      continue;
    }
    sum += sample * sample;
    count++;
  }

  if (!count) {
    return 0;
  }
  return Math.min(1, Math.sqrt(sum / count) * 4);
}

const AUDIO_FRAME_MAX_BYTES = 1024 * 1024 * 2;

function readAudioFrameId(value: unknown) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 256 && /^[a-z0-9:._-]+$/i.test(id) ? id : null;
}

function readBinaryAudioFrameInput(req: Request, pcm: Buffer): AudioFrame {
  const query = req.query;
  const source: TranscriptSource = query.source === 'mic' ? 'mic' : 'system';
  const sampleRate = Number.isFinite(Number(query.sampleRate))
    ? Math.max(8000, Math.min(192000, Number(query.sampleRate)))
    : 48000;
  const channels = Number.isFinite(Number(query.channels))
    ? Math.max(1, Math.min(8, Number(query.channels)))
    : 2;
  const startMs = Number.isFinite(Number(query.startMs))
    ? Math.max(0, Number(query.startMs))
    : 0;
  const endMs = Number.isFinite(Number(query.endMs))
    ? Math.max(startMs, Number(query.endMs))
    : startMs;

  if (
    !pcm.byteLength ||
    pcm.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
  ) {
    throw new Error('Audio frame must contain Float32 PCM samples.');
  }
  if (pcm.byteLength > AUDIO_FRAME_MAX_BYTES) {
    throw new Error('Audio frame is too large.');
  }

  return {
    channels,
    encoding: 'f32le',
    endMs,
    id: readAudioFrameId(query.frameId),
    level: audioLevelFromPcmF32Le(pcm),
    pcm,
    sampleRate,
    source,
    startMs,
  };
}

function readAudioFrameInput(req: Request): AudioFrame {
  // Binary path: raw f32le PCM body with metadata in query params. This is the
  // live-meeting hot path, so it skips base64 and JSON entirely.
  if (Buffer.isBuffer(req.body)) {
    return readBinaryAudioFrameInput(req, req.body);
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const source: TranscriptSource = body.source === 'mic' ? 'mic' : 'system';
  const sampleRate = Number.isFinite(Number(body.sampleRate))
    ? Math.max(8000, Math.min(192000, Number(body.sampleRate)))
    : 48000;
  const channels = Number.isFinite(Number(body.channels))
    ? Math.max(1, Math.min(8, Number(body.channels)))
    : 2;
  const startMs = Number.isFinite(Number(body.startMs))
    ? Math.max(0, Number(body.startMs))
    : 0;
  const endMs = Number.isFinite(Number(body.endMs))
    ? Math.max(startMs, Number(body.endMs))
    : startMs;
  const encoding = body.encoding === 'f32le' ? 'f32le' : null;
  const pcmBase64 =
    typeof body.pcmBase64 === 'string' ? body.pcmBase64.trim() : '';

  if (encoding !== 'f32le') {
    throw new Error('Only f32le PCM audio frames are supported.');
  }
  if (!pcmBase64) {
    throw new Error('Audio frame pcmBase64 is required.');
  }

  const pcm = Buffer.from(pcmBase64, 'base64');
  if (
    !pcm.byteLength ||
    pcm.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
  ) {
    throw new Error('Audio frame must contain Float32 PCM samples.');
  }
  if (pcm.byteLength > AUDIO_FRAME_MAX_BYTES) {
    throw new Error('Audio frame is too large.');
  }

  return {
    channels,
    encoding,
    endMs,
    id: readAudioFrameId(body.frameId),
    level: audioLevelFromPcmF32Le(pcm),
    pcm,
    sampleRate,
    source,
    startMs,
  };
}

function f32Samples(frame: AudioFrame) {
  const sampleCount = Math.floor(
    frame.pcm.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index++) {
    const sample = frame.pcm.readFloatLE(
      index * Float32Array.BYTES_PER_ELEMENT
    );
    samples[index] = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;
  }
  return samples;
}

function downmixMono(samples: Float32Array, channels: number) {
  const frameCount = Math.floor(samples.length / channels);
  const mono = new Float32Array(frameCount);
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += samples[frameIndex * channels + channel] ?? 0;
    }
    mono[frameIndex] = sum / channels;
  }
  return mono;
}

// Windowed-sinc (Lanczos) resampler. Naive linear interpolation images
// high frequencies past Nyquist when downsampling (48k -> 16k), which adds
// aliasing noise that measurably degrades ASR accuracy. The sinc kernel acts
// as an anti-alias low-pass; the kernel widens by the decimation ratio when
// downsampling so it filters out content above the target Nyquist.
function resampleSinc(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number
) {
  if (sourceRate === targetRate || samples.length < 2) {
    return samples;
  }
  const ratio = sourceRate / targetRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(targetLength);
  const lobes = 8;
  const filterScale = ratio > 1 ? ratio : 1;
  const support = lobes * filterScale;

  for (let index = 0; index < targetLength; index++) {
    const center = index * ratio;
    const first = Math.ceil(center - support);
    const last = Math.floor(center + support);
    let acc = 0;
    let norm = 0;
    for (let tap = first; tap <= last; tap++) {
      if (tap < 0 || tap >= samples.length) {
        continue;
      }
      const x = (center - tap) / filterScale;
      if (x <= -lobes || x >= lobes) {
        continue;
      }
      let weight: number;
      if (x === 0) {
        weight = 1;
      } else {
        const px = Math.PI * x;
        weight = (Math.sin(px) / px) * (Math.sin(px / lobes) / (px / lobes));
      }
      acc += (samples[tap] ?? 0) * weight;
      norm += weight;
    }
    output[index] = norm !== 0 ? acc / norm : 0;
  }
  return output;
}

function pcm16(samples: Float32Array) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    output[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return output;
}

function rms(samples: Float32Array) {
  if (!samples.length) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

const AUDIO_FRAME_SPEECH_LEVEL = 0.008;
function normalizeAudioFrame(frame: AudioFrame): NormalizedAudioFrame {
  const mono = downmixMono(f32Samples(frame), frame.channels);
  const resampled = resampleSinc(mono, frame.sampleRate, 16000);
  const level = rms(resampled);
  return {
    durationMs: Math.max(0, frame.endMs - frame.startMs),
    endMs: frame.endMs,
    level,
    pcm16: pcm16(resampled),
    sampleRate: 16000,
    source: frame.source,
    speech: level >= AUDIO_FRAME_SPEECH_LEVEL,
    startMs: frame.startMs,
  };
}

async function applyAudioFrameToStt(
  runtime: MeetingRuntime,
  normalized: NormalizedAudioFrame
) {
  const timestamp = now();
  runtime.stt.normalizedAudioFrames++;
  runtime.stt.lastNormalizedAudioFrameAt = timestamp;
  await runtime.sttSession?.pushAudioFrame(normalized);

  const chunk = runtime.vad[normalized.source].append(normalized);
  if (!chunk) {
    return null;
  }

  runtime.stt.speechChunks++;
  runtime.stt.lastSpeechChunkAt = timestamp;
  await runtime.sttSession?.pushAudioChunk?.(chunk);
  broadcast(runtime, 'audio-chunk', {
    chunk: {
      durationMs: chunk.durationMs,
      endMs: chunk.endMs,
      id: chunk.id,
      level: chunk.level,
      sampleRate: chunk.sampleRate,
      source: chunk.source,
      startMs: chunk.startMs,
    },
    type: 'audio-chunk',
  });
  return chunk;
}

async function flushAudioChunks(runtime: MeetingRuntime) {
  for (const source of ['mic', 'system'] satisfies TranscriptSource[]) {
    const chunk = runtime.vad[source].flush();
    if (!chunk) {
      continue;
    }
    runtime.stt.speechChunks++;
    runtime.stt.lastSpeechChunkAt = now();
    await runtime.sttSession?.pushAudioChunk?.(chunk);
  }
}

function readPcm16Buffer(buffer: Buffer) {
  if (buffer.byteLength % Int16Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('PCM16 audio must contain whole 16-bit samples.');
  }
  const pcm = new Int16Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Int16Array.BYTES_PER_ELEMENT
  );
  return new Int16Array(pcm);
}

function transcriptionChunkFromPcm16(
  pcm16: Int16Array,
  source: TranscriptSource
): SttAudioChunk {
  const durationMs = Math.round((pcm16.length / 16000) * 1000);
  return {
    durationMs,
    endMs: durationMs,
    id: randomUUID(),
    level: rms(pcm16ToFloat32(pcm16)),
    pcm16,
    sampleRate: 16000,
    source,
    startMs: 0,
  };
}

function wavFormatName(formatCode: number) {
  switch (formatCode) {
    case 1:
      return 'pcm';
    case 3:
      return 'float';
    default:
      return `format ${formatCode}`;
  }
}

function readWavBuffer(buffer: Buffer, source: TranscriptSource) {
  if (
    buffer.byteLength < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('WAV audio must start with a RIFF/WAVE header.');
  }

  let cursor = 12;
  let format: {
    bitsPerSample: number;
    channels: number;
    formatCode: number;
    sampleRate: number;
  } | null = null;
  let data: Buffer | null = null;

  while (cursor + 8 <= buffer.byteLength) {
    const chunkId = buffer.toString('ascii', cursor, cursor + 4);
    const chunkSize = buffer.readUInt32LE(cursor + 4);
    const chunkStart = cursor + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.byteLength) {
      throw new Error(`Invalid WAV chunk size for ${chunkId}.`);
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new Error('WAV fmt chunk is too small.');
      }
      format = {
        formatCode: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkStart, chunkEnd);
    }

    cursor = chunkEnd + (chunkSize % 2);
  }

  if (!format) {
    throw new Error('WAV audio is missing a fmt chunk.');
  }
  if (!data) {
    throw new Error('WAV audio is missing a data chunk.');
  }
  if (format.channels < 1 || format.channels > 8) {
    throw new Error(`Unsupported WAV channel count: ${format.channels}.`);
  }
  if (format.sampleRate < 8000 || format.sampleRate > 192000) {
    throw new Error(`Unsupported WAV sample rate: ${format.sampleRate}.`);
  }

  const sampleCount = Math.floor(data.byteLength / (format.bitsPerSample / 8));
  const samples = new Float32Array(sampleCount);
  if (format.formatCode === 1 && format.bitsPerSample === 16) {
    for (let index = 0; index < sampleCount; index++) {
      const sample = data.readInt16LE(index * 2);
      samples[index] = sample < 0 ? sample / 32768 : sample / 32767;
    }
  } else if (format.formatCode === 3 && format.bitsPerSample === 32) {
    for (let index = 0; index < sampleCount; index++) {
      const sample = data.readFloatLE(index * 4);
      samples[index] = Number.isFinite(sample)
        ? Math.max(-1, Math.min(1, sample))
        : 0;
    }
  } else {
    throw new Error(
      `Unsupported WAV ${wavFormatName(format.formatCode)} ${format.bitsPerSample}-bit audio. Use PCM16 or Float32 WAV.`
    );
  }

  const mono = downmixMono(samples, format.channels);
  const resampled = resampleSinc(mono, format.sampleRate, 16000);
  return transcriptionChunkFromPcm16(pcm16(resampled), source);
}

function readF32LeBuffer(
  buffer: Buffer,
  input: {
    channels: number;
    sampleRate: number;
    source: TranscriptSource;
  }
) {
  if (
    !buffer.byteLength ||
    buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
  ) {
    throw new Error('Float32 PCM audio must contain whole 32-bit samples.');
  }

  const sampleCount = Math.floor(
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index++) {
    const sample = buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
    samples[index] = Number.isFinite(sample)
      ? Math.max(-1, Math.min(1, sample))
      : 0;
  }

  const mono = downmixMono(samples, input.channels);
  const resampled = resampleSinc(mono, input.sampleRate, 16000);
  return transcriptionChunkFromPcm16(pcm16(resampled), input.source);
}

function readTranscriptionChunks(req: Request): SttAudioChunk[] {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const source: TranscriptSource = body.source === 'mic' ? 'mic' : 'system';
  const sampleRate = Number.isFinite(Number(body.sampleRate))
    ? Number(body.sampleRate)
    : Number.isFinite(Number(body.sample_rate))
      ? Number(body.sample_rate)
      : 16000;
  const file = req.file;
  const format =
    typeof body.format === 'string' ? body.format.toLowerCase() : 'pcm16le';
  const channels = Number.isFinite(Number(body.channels))
    ? Math.max(1, Math.min(8, Number(body.channels)))
    : 2;
  if (file) {
    const fileName = file.originalname.toLowerCase();
    const mimeType = file.mimetype.toLowerCase();
    if (
      format === 'wav' ||
      format === 'wave' ||
      mimeType === 'audio/wav' ||
      mimeType === 'audio/wave' ||
      mimeType === 'audio/x-wav' ||
      fileName.endsWith('.wav')
    ) {
      return [readWavBuffer(file.buffer, source)];
    }

    if (format !== 'pcm16le' && format !== 'pcm16') {
      if (format === 'f32le' || format === 'float32le') {
        return [
          readF32LeBuffer(file.buffer, {
            channels,
            sampleRate,
            source,
          }),
        ];
      }
      throw new Error(
        'Multipart transcription supports pcm16le, f32le, or wav files.'
      );
    }
    if (sampleRate !== 16000) {
      throw new Error('Local PCM transcription expects 16 kHz input.');
    }
    const pcm16 = readPcm16Buffer(file.buffer);
    return [transcriptionChunkFromPcm16(pcm16, source)];
  }

  if (typeof body.pcm16Base64 === 'string' && body.pcm16Base64.trim()) {
    if (sampleRate !== 16000) {
      throw new Error('Local PCM transcription expects 16 kHz input.');
    }
    const pcm16 = readPcm16Buffer(Buffer.from(body.pcm16Base64, 'base64'));
    return [transcriptionChunkFromPcm16(pcm16, source)];
  }

  if (
    typeof body.pcmBase64 === 'string' &&
    body.pcmBase64.trim() &&
    body.encoding === 'f32le'
  ) {
    const frame = readAudioFrameInput(req);
    return [
      mergeFramesToChunk([normalizeAudioFrame(frame)], frame.source),
    ].filter(Boolean) as SttAudioChunk[];
  }

  throw new Error(
    'Provide a multipart wav/pcm16le file, pcm16Base64, or f32le pcmBase64 audio.'
  );
}

function selectedTranscriptionModelId(req: Request, config: AiBackendConfig) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const explicit =
    typeof body.model === 'string'
      ? body.model
      : typeof body.modelId === 'string'
        ? body.modelId
        : '';
  if (explicit) {
    return explicit;
  }

  const configured = modelById(config.meetingSttModelId);
  if (
    configured?.type === 'stt' &&
    (configured.runtime === 'onnxruntime' ||
      configured.runtime === 'sherpa-onnx')
  ) {
    return configured.id;
  }
  return 'cohere-transcribe-03-2026-onnx';
}

function createUnavailableSttSession(
  runtime: MeetingRuntime,
  provider: SttProviderManifest
): SttProviderSession {
  const message =
    provider.unavailableReason ?? `${provider.name} is not available.`;
  runtime.stt.status = 'unavailable';
  runtime.stt.message = message;
  broadcast(runtime, 'error', {
    code: 'stt_provider_unavailable',
    message,
    type: 'error',
  });

  return {
    async pushAudioFrame() {
      // Audio capture still flows through this session so provider wiring can be
      // added without changing the meeting frontend contract.
    },
    async stop() {
      runtime.stt.status = 'stopped';
      runtime.stt.message = message;
    },
  };
}

type UtteranceDecoder = MeetingUtteranceDecoder;

// Legacy whole-utterance backend retained for an installed Transformers STT
// manifest. Current Whisper/Cohere/Moonshine/Distil models use native sherpa.
function createTransformersUtteranceDecoder(
  config: AiBackendConfig,
  modelId: string
): UtteranceDecoder {
  let buffers: Int16Array[] = [];
  let totalSamples = 0;
  return {
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
      const merged = new Int16Array(totalSamples);
      let cursor = 0;
      for (const buffer of buffers) {
        merged.set(buffer, cursor);
        cursor += buffer.length;
      }
      buffers = [];
      totalSamples = 0;
      const text = await transcribeSttChunks({
        chunks: [transcriptionChunkFromPcm16(merged, 'mic')],
        config,
        modelId,
      });
      const model = modelById(modelId);
      const language =
        model?.languageDetection === 'fixed' && model.languages.length === 1
          ? (model.languages[0] ?? null)
          : null;
      return { language, text: text.trim() };
    },
  };
}

// Small shared Silero asset, provisioned with native STT downloads/seeds.
// Older installs can migrate their existing copy without loading legacy ASR.
async function loadSharedSileroVad(
  config: AiBackendConfig
): Promise<SileroVadStream | null> {
  try {
    const runtime = await loadSileroVadRuntime(config);
    return runtime ? createSileroVadStream(runtime) : null;
  } catch (error) {
    console.warn('Meeting speech detector could not load', errorMessage(error));
    return null;
  }
}

// One capture pipeline serves streaming and phrase-final providers. Model loading,
// ordered acceptance, transcript durability and session status remain here.
function createMixedCaptureSttSession(
  config: AiBackendConfig,
  runtime: MeetingRuntime,
  provider: SttProviderManifest,
  createDecoder: (model: LocalModelManifest) => Promise<UtteranceDecoder>
): SttProviderSession {
  let pipeline: ReturnType<typeof createMeetingCapturePipeline> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let pendingFrames = 0;
  let queuedAudioMs = 0;
  let acceptingFrames = true;
  let vadWarning = '';
  let lateWarning = '';
  const warning = () => `${vadWarning}${lateWarning}`;

  runtime.stt.status = 'starting';
  runtime.stt.message = `Loading ${provider.name} for live transcription.`;

  const ready = (async () => {
    const model = modelById(provider.modelId ?? runtime.meeting.sttModelId);
    if (!model || model.type !== 'stt') {
      throw new Error(`STT model is not registered for ${provider.name}.`);
    }
    const files = await localModelFilesStatus(config, model);
    if (!files.complete) {
      throw new Error(
        `${model.id} is not downloaded yet. ${modelDownloadGuidance(config, model)}`
      );
    }
    const decoder = await createDecoder(model);
    const vad = await loadSharedSileroVad(config);
    runtime.stt.executionProvider = decoder.executionProvider ?? null;
    pipeline = createMeetingCapturePipeline({
      decoder,
      onEmptyFinal(id) {
        if (runtime.partialSegment?.id === id) runtime.partialSegment = null;
      },
      onMetrics(metrics) {
        runtime.stt.decodeRealtimeFactor = metrics.decodeRealtimeFactor;
        runtime.stt.pipeline = { ...metrics, queuedAudioMs };
        const nextVadWarning =
          metrics.vadMode === 'energy'
            ? ' Speech detection is using an energy fallback; quiet speech may be missed.'
            : '';
        const nextLateWarning =
          metrics.lateAudioMs > 0
            ? ' Some late audio missed live mixing; the recording is preserved.'
            : '';
        if (nextVadWarning !== vadWarning || nextLateWarning !== lateWarning) {
          vadWarning = nextVadWarning;
          lateWarning = nextLateWarning;
          runtime.stt.message = `Live transcription is running with ${provider.name}.${warning()}`;
          broadcast(runtime, 'status', {
            type: 'status',
            meeting: publicMeeting(runtime),
          });
        }
      },
      async onTranscript(captureSegment) {
        const segment: TranscriptSegment = {
          ...captureSegment,
          createdAt: now(),
          meetingId: runtime.meeting.id,
        };
        applyTranscriptSegment(runtime, segment);
        if (segment.type !== 'final') return;
        if (segment.language) runtime.stt.detectedLanguage = segment.language;
        const count = finalTranscriptCount(runtime);
        runtime.stt.completedSpeechChunks = count;
        runtime.stt.message = `Transcribed ${count} utterance${count === 1 ? '' : 's'} live.${warning()}`;
        await persistTranscriptEvent(config, runtime, segment).catch(() => {});
      },
      vad,
    });
    vadWarning = vad
      ? ''
      : ' Speech detection is using an energy fallback; quiet speech may be missed.';
    if (runtime.stt.status === 'starting') {
      runtime.stt.status = 'running';
      runtime.stt.message = `Live transcription is running with ${provider.name}.${warning()}`;
      broadcast(runtime, 'status', {
        type: 'status',
        meeting: publicMeeting(runtime),
      });
    }
  })();
  ready.catch(loadError => {
    runtime.stt.status = 'error';
    runtime.stt.message = errorMessage(loadError);
    broadcast(runtime, 'error', {
      code: 'stt_load_failed',
      message: runtime.stt.message,
      type: 'error',
    });
  });

  return {
    async pushAudioFrame(frame) {
      if (!acceptingFrames) return;
      pendingFrames++;
      queuedAudioMs += (frame.pcm16.length * 1000) / 16_000;
      runtime.stt.queuedSpeechChunks = pendingFrames;
      if (runtime.stt.pipeline)
        runtime.stt.pipeline.queuedAudioMs = queuedAudioMs;
      if (pendingFrames === 12) {
        runtime.stt.message = `Catching up on queued audio with ${provider.name}.${warning()}`;
        broadcast(runtime, 'status', {
          type: 'status',
          meeting: publicMeeting(runtime),
        });
      }
      chain = chain
        .then(async () => {
          await ready;
          await pipeline?.push(frame);
        })
        .catch(frameError => {
          if (runtime.stt.status !== 'error') {
            runtime.stt.status = 'error';
            runtime.stt.message = errorMessage(frameError);
            broadcast(runtime, 'error', {
              code: 'stt_stream_failed',
              message: runtime.stt.message,
              type: 'error',
            });
          }
        })
        .finally(() => {
          pendingFrames--;
          queuedAudioMs = Math.max(
            0,
            queuedAudioMs - (frame.pcm16.length * 1000) / 16_000
          );
          runtime.stt.queuedSpeechChunks = Math.max(0, pendingFrames);
          if (runtime.stt.pipeline)
            runtime.stt.pipeline.queuedAudioMs = queuedAudioMs;
        });
    },
    async stop() {
      acceptingFrames = false;
      if (pendingFrames > 0) {
        runtime.stt.message = `Finishing ${pendingFrames} queued audio frame${pendingFrames === 1 ? '' : 's'} before stopping.${warning()}`;
        broadcast(runtime, 'status', {
          type: 'status',
          meeting: publicMeeting(runtime),
        });
      }
      await chain.catch(() => {});
      await ready.catch(() => {});
      runtime.stt.queuedSpeechChunks = 0;
      try {
        await pipeline?.stop();
      } catch (stopError) {
        runtime.stt.status = 'error';
        runtime.stt.message = errorMessage(stopError);
      }
      if (runtime.stt.status !== 'error') {
        const count = finalTranscriptCount(runtime);
        runtime.stt.status = 'stopped';
        runtime.stt.message = count
          ? `Live transcription finished with ${count} utterance${count === 1 ? '' : 's'}.${warning()}`
          : `Live transcription stopped without captured speech.${warning()}`;
      }
    },
  };
}

function createAppleSpeechSttSession(
  runtime: MeetingRuntime
): SttProviderSession {
  runtime.stt.status = 'running';
  runtime.stt.message =
    'Apple SpeechAnalyzer bridge is ready for native transcript events.';

  return {
    async pushAudioFrame() {
      // The native Apple bridge owns audio ingestion and pushes transcript
      // events into /v1/meetings/:id/apple-speech/events.
    },
    async stop() {
      runtime.stt.status = 'stopped';
      runtime.stt.message = 'Apple SpeechAnalyzer bridge stopped.';
    },
  };
}

function createPendingAdapterSttSession(
  runtime: MeetingRuntime,
  provider: SttProviderManifest
): SttProviderSession {
  runtime.stt.status = 'unavailable';
  runtime.stt.message = `${provider.name} is ready, but its streaming adapter is not implemented yet.`;
  broadcast(runtime, 'error', {
    code: 'stt_adapter_unimplemented',
    message: runtime.stt.message,
    type: 'error',
  });

  return {
    async pushAudioFrame() {
      // Keep capture flowing without turning every audio frame into an error.
    },
    async stop() {
      runtime.stt.status = 'stopped';
    },
  };
}

async function startSttSession(
  config: AiBackendConfig,
  runtime: MeetingRuntime
) {
  const provider = runtime.provider;
  validateMeetingSttLanguageProvider(
    runtime.meeting.sttLanguage ?? 'auto',
    provider.id
  );

  runtime.stt.status = 'starting';
  runtime.stt.message = null;
  runtime.stt.readiness = provider.readiness ?? null;

  if (!provider.available) {
    runtime.sttSession = createUnavailableSttSession(runtime, provider);
    return;
  }

  const nativeModel = modelById(provider.modelId);
  const nativeRuntime = nativeAsrRuntime(nativeModel);
  if (nativeRuntime) {
    runtime.sttSession = createMixedCaptureSttSession(
      config,
      runtime,
      provider,
      async model =>
        createNativeAsrDecoder(
          nativeRuntime,
          nativeAsrModelPath(config, model),
          runtime.meeting.sttLanguage ?? 'auto'
        )
    );
    return;
  }
  // Native sherpa models share mixing, gain control, VAD and segmentation.
  // Streaming transducers can return partials;
  // offline models finalize once per VAD-cut utterance.
  if (provider.modelId && sherpaKindForModel(modelById(provider.modelId))) {
    runtime.sttSession = createMixedCaptureSttSession(
      config,
      runtime,
      provider,
      async model => {
        const sherpaKind = sherpaKindForModel(model);
        if (!sherpaKind) {
          throw new Error(`${model.id} does not declare a sherpa model kind.`);
        }
        return createSherpaUtteranceDecoder(
          sherpaKind,
          safeModelPath(config, model),
          await sherpaDecoderOptions(
            config,
            model,
            runtime.meeting.sttLanguage ?? 'auto'
          )
        );
      }
    );
    return;
  }
  if (isChunkedOnnxProviderId(provider.id)) {
    runtime.sttSession = createMixedCaptureSttSession(
      config,
      runtime,
      provider,
      async model => createTransformersUtteranceDecoder(config, model.id)
    );
    return;
  }
  if (provider.id === 'apple-speechanalyzer') {
    runtime.sttSession = createAppleSpeechSttSession(runtime);
    return;
  }

  runtime.sttSession = createPendingAdapterSttSession(runtime, provider);
}

function meetingSummaryInput(req: Request, runtime: MeetingRuntime) {
  const meeting = runtime.meeting;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const transcript =
    typeof body.transcript === 'string' ? body.transcript.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : 'Meeting';
  const source =
    [
      (transcript || transcriptText(runtime)) &&
        `Transcript:\n${transcript || transcriptText(runtime)}`,
      notes && `Notes:\n${notes}`,
    ]
      .filter(Boolean)
      .join('\n\n') ||
    'No transcript has been captured yet. Summarize only the meeting metadata and make the missing transcript explicit.';

  return [
    `Title: ${title}`,
    `Meeting ID: ${meeting.id}`,
    `Workspace ID: ${meeting.workspaceId ?? 'local'}`,
    `Started: ${meeting.createdAt}`,
    `Stopped: ${meeting.updatedAt}`,
    '',
    source,
  ].join('\n');
}

export function registerMeetingRoutes({
  app,
  config,
  models: _models,
  store: _store,
}: {
  app: import('express').Express;
  config: AiBackendConfig;
  models: AiModelRouter;
  store: CopilotStore;
}) {
  app.get('/v1/stt/providers', async (_req, res) => {
    const providers = await sttProviders(config, process.platform);
    res.json({
      platform: process.platform,
      providers,
      models: modelRegistry.filter(model => model.type === 'stt'),
      pipeline: [
        'audio-capture',
        'resample-16k-mono-pcm',
        'vad',
        'stt-provider',
        'transcript-normalizer',
        'meeting-timeline',
        'summary-chat',
      ],
    });
  });

  app.get('/v1/stt/runtime', async (_req, res) => {
    const providers = await sttProviders(config, process.platform);
    const selectedProvider =
      providers.find(provider => provider.id === config.meetingSttProviderId) ??
      null;
    const selection = selectMeetingSttProvider({
      config,
      platform: process.platform,
      providers,
      requestedProviderId: config.meetingSttProviderId,
    });
    const resolvedProvider = selection.provider;
    res.json({
      autoSelectionError: selection.error,
      platform: process.platform,
      resolvedProvider,
      resolvedProviderId: resolvedProvider?.id ?? null,
      selectedProviderId: selectedProvider?.id ?? config.meetingSttProviderId,
      selectedModelId:
        config.meetingSttModelId || resolvedProvider?.modelId || null,
      selectedProvider,
      transcriptAvailable:
        resolvedProvider?.canProduceTranscript === true &&
        resolvedProvider?.available === true,
      providers,
    });
  });

  app.post('/v1/stt/runtime/preload', async (req: Request, res: Response) => {
    const requestedProviderId =
      typeof req.body?.providerId === 'string'
        ? req.body.providerId
        : config.meetingSttProviderId;
    try {
      const preload = await preloadMeetingSttRuntime(
        config,
        requestedProviderId
      );
      console.info(
        `[meetings] STT preload ${preload.status} provider=${
          preload.providerId ?? 'none'
        } model=${preload.modelId ?? 'none'} cached=${preload.cached} durationMs=${
          preload.durationMs
        }`
      );
      res.json({ preload });
    } catch (preloadError) {
      error(res, 503, errorMessage(preloadError));
    }
  });

  app.get('/v1/meetings', async (req, res) => {
    await ensureMeetingsLoaded(config);
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : null;
    const items = [...meetings.values()]
      .filter(
        runtime => !workspaceId || runtime.meeting.workspaceId === workspaceId
      )
      .sort((a, b) => b.meeting.updatedAt.localeCompare(a.meeting.updatedAt))
      .map(runtime => publicMeeting(runtime));
    res.json({ meetings: items });
  });

  app.get('/v1/stt/apple-speech/bridge', async (_req, res) => {
    const providers = await sttProviders(config, process.platform);
    const provider =
      providers.find(provider => provider.id === 'apple-speechanalyzer') ??
      null;
    res.json({
      bridge: publicAppleSpeechBridge(),
      provider,
    });
  });

  app.post('/v1/stt/apple-speech/bridge', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const bridge = updateAppleSpeechBridge({
      available: body.available === true,
      supportedLocales: body.supportedLocales,
      installedLocales: body.installedLocales,
      systemLocale: body.systemLocale,
      reason:
        typeof body.reason === 'string'
          ? body.reason
          : body.available === true
            ? null
            : undefined,
      version: typeof body.version === 'string' ? body.version : null,
    });
    const providers = await sttProviders(config, process.platform);
    res.json({
      bridge,
      provider:
        providers.find(provider => provider.id === 'apple-speechanalyzer') ??
        null,
    });
  });

  const localModelRoutes = {
    download: ['/v1/stt/models/:id/download', '/v1/local/models/:id/download'],
    downloadEvents: [
      '/v1/stt/models/:id/download/events',
      '/v1/local/models/:id/download/events',
    ],
    health: ['/v1/stt/models', '/v1/local/models'],
    probe: ['/v1/stt/models/:id/probe', '/v1/local/models/:id/probe'],
  };

  function routeModel(req: Request, res: Response) {
    const model = modelRegistry.find(
      candidate => candidate.id === req.params.id
    );
    if (!model) {
      error(res, 404, `Unknown local model: ${req.params.id}`);
      return null;
    }
    return model;
  }

  app.get(localModelRoutes.health, async (_req, res) => {
    res.json(await getLocalModelHealth(config));
  });

  app.get(localModelRoutes.download, async (req, res) => {
    const model = routeModel(req, res);
    if (!model) return;
    await ensureModelDownloadsLoaded(config);
    const status = await modelDownloadStatus(config, model);
    res.json({
      download: {
        ...status,
        files: await modelDownloadFileStatuses(config, model),
        message: modelDownloads.get(model.id)?.message ?? null,
        modelId: model.id,
        requestedAt: modelDownloads.get(model.id)?.requestedAt ?? null,
      },
      model,
    });
  });

  app.post(localModelRoutes.probe, async (req, res) => {
    const model = routeModel(req, res);
    if (!model) return;
    try {
      const probe = await probeLocalModelRuntime(config, model);
      const localModelHealth = await getLocalModelHealth(config);
      const modelCatalog = _models.models(localModelHealth.models);
      _store.setDefaultModel(
        modelCatalog.defaultModel,
        modelCatalog.optionalModels
          .filter(candidate => candidate.selectable)
          .map(candidate => candidate.id)
      );
      res.status(probe.canLoad ? 200 : 409).json({
        download: {
          ...(await modelDownloadStatus(config, model)),
          files: await modelDownloadFileStatuses(config, model),
          message: modelDownloads.get(model.id)?.message ?? null,
          modelId: model.id,
          requestedAt: modelDownloads.get(model.id)?.requestedAt ?? null,
        },
        model,
        probe,
      });
    } catch (probeError) {
      error(res, 500, errorMessage(probeError));
    }
  });

  app.post(localModelRoutes.download, async (req, res) => {
    const model = routeModel(req, res);
    if (!model) return;
    await ensureModelDownloadsLoaded(config);

    let job: LocalModelDownloadJob;
    if (model.releaseState === 'blocked') {
      job = await setModelDownloadJob(config, model, {
        message:
          model.notes ??
          'This model is blocked until a trusted package is available.',
        status: 'blocked',
      });
    } else if (!model.downloadUrl) {
      job = await setModelDownloadJob(config, model, {
        message: 'This model does not have a download URL yet.',
        status: 'missing_url',
      });
    } else if (req.body?.dryRun === true) {
      try {
        const plan = await resolveModelDownloadPlan(model);
        const status = await modelDownloadStatus(config, model);
        res.json({
          download: {
            ...status,
            files: await modelDownloadFileStatuses(config, model),
            message: 'Download manifest resolved.',
            modelId: model.id,
            plan,
            requestedAt: modelDownloads.get(model.id)?.requestedAt ?? null,
          },
          model,
        });
        return;
      } catch (downloadError) {
        error(res, 502, errorMessage(downloadError));
        return;
      }
    } else if (model.releaseState === 'planned') {
      job = await setModelDownloadJob(config, model, {
        message:
          'Model registry entry exists, but the downloader/runtime is not wired yet.',
        status: 'planned',
      });
    } else {
      try {
        const languageDetector = modelById(model.languageDetectorModelId);
        if (languageDetector) {
          await queueModelDownload(config, languageDetector);
        }
        job = await queueModelDownload(config, model);
      } catch (downloadError) {
        job = await setModelDownloadJob(config, model, {
          message: errorMessage(downloadError),
          status: 'error',
        });
      }
    }

    res.status(job.status === 'queued' ? 202 : 409).json({
      download: {
        ...job,
        files: await modelDownloadFileStatuses(config, model),
        modelId: model.id,
      },
      model,
    });
  });

  app.get(localModelRoutes.downloadEvents, async (req, res) => {
    const model = routeModel(req, res);
    if (!model) return;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const writeStatus = async () => {
      const status = await modelDownloadStatus(config, model);
      writeSse(res, 'status', {
        download: {
          ...status,
          files: await modelDownloadFileStatuses(config, model),
          message: modelDownloads.get(model.id)?.message ?? null,
          modelId: model.id,
          requestedAt: modelDownloads.get(model.id)?.requestedAt ?? null,
        },
        model,
      });
    };

    let statusWrite = writeStatus();
    const progress = setInterval(() => {
      statusWrite = statusWrite.catch(() => {}).then(() => writeStatus());
    }, 1000);
    await statusWrite;
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);
    req.on('close', () => {
      clearInterval(progress);
      clearInterval(heartbeat);
    });
  });

  const createReservedMeetingRuntime = async (
    body: Record<string, unknown>
  ) => {
    // Snapshot before asynchronous provider discovery; later settings changes
    // must not alter this session or its recovered utterances.
    const reservationConfig = { ...config };
    let sttLanguage = validateMeetingSttLanguage(
      body.sttLanguage !== undefined
        ? body.sttLanguage
        : reservationConfig.meetingSttLanguage
    );
    const providers = await sttProviders(
      {
        ...reservationConfig,
        meetingSttLanguage: sttLanguage,
        ...(typeof body.providerId === 'string' && body.providerId !== 'auto'
          ? { meetingSttProviderId: body.providerId }
          : {}),
      },
      process.platform
    );
    const selection = selectMeetingSttProvider({
      config: reservationConfig,
      platform: process.platform,
      providers,
      requestedProviderId:
        typeof body.providerId === 'string'
          ? body.providerId
          : reservationConfig.meetingSttProviderId,
    });
    if (selection.error || !selection.provider) {
      throw new Error(selection.error ?? 'No STT provider is configured.');
    }
    const provider = selection.provider;
    const providerId = provider.id;
    validateMeetingSttLanguageProvider(sttLanguage, providerId);
    validateAppleSpeechLanguage(sttLanguage, providerId);
    if (providerId === 'apple-speechanalyzer' && sttLanguage === 'auto')
      sttLanguage = appleSpeechBridge.systemLocale ?? 'auto';
    const requestedSttModelId =
      typeof body.sttModelId === 'string' ? body.sttModelId.trim() : '';
    if (
      requestedSttModelId &&
      provider.modelId &&
      requestedSttModelId !== provider.modelId
    ) {
      throw new Error(
        `${provider.name} uses ${provider.modelId}; received ${requestedSttModelId}.`
      );
    }
    const sttModelId = requestedSttModelId || provider.modelId || '';

    const timestamp = now();
    const meeting: MeetingSession = {
      id: randomUUID(),
      providerId,
      sttModelId,
      sttLanguage,
      workspaceId:
        typeof body.workspaceId === 'string' ? body.workspaceId : null,
      docId: typeof body.docId === 'string' ? body.docId : null,
      microphoneRecordingPath: null,
      recordingDurationMs: null,
      recordingPath: null,
      savedTranscriptSegmentIds: [],
      savedTranscriptSegmentSnapshots: {},
      status: 'recording',
      summary: null,
      summaryDocIds: [],
      transcriptSaveInitialized: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const runtime: MeetingRuntime = {
      audioOperation: Promise.resolve(),
      clients: new Set(),
      fallbackAudioSpool: meetingFallbackAudioSpool(config, meeting.id),
      meeting,
      partialSegment: null,
      provider,
      stt: {
        audioFrames: 0,
        audioFramesBySource: {
          mic: 0,
          system: 0,
        },
        completedSpeechChunks: 0,
        decodeRealtimeFactor: null,
        detectedLanguage: null,
        executionProvider: null,
        failedSpeechChunks: 0,
        lastNormalizedAudioFrameAt: null,
        lastSpeechChunkAt: null,
        lastAudioFrameAt: null,
        lastAudioFrameLevel: null,
        lastAudioFrameSource: null,
        message: 'Meeting capture is reserved and waiting for native audio.',
        normalizedAudioFrames: 0,
        requestedProviderId: selection.requestedProviderId,
        providerId,
        queuedSpeechChunks: 0,
        readiness: provider.readiness ?? null,
        speechChunks: 0,
        status: 'starting',
      },
      sttSession: null,
      transcriptSegments: [],
      vad: {
        mic: new MeetingAudioVadBuffer(),
        system: new MeetingAudioVadBuffer(),
      },
    };
    return runtime;
  };

  const activateMeetingRuntime = async (runtime: MeetingRuntime) => {
    if (runtime.sttSession) {
      return;
    }
    runtime.meeting.status = 'recording';
    runtime.meeting.updatedAt = now();
    try {
      await startSttSession(config, runtime);
    } catch (sttError) {
      runtime.stt.status = 'error';
      runtime.stt.message = errorMessage(sttError);
      broadcast(runtime, 'error', {
        code: 'stt_start_failed',
        message: runtime.stt.message,
        type: 'error',
      });
    }
  };

  const respondMeetingConflict = (res: Response, active: MeetingRuntime) => {
    res.status(409).json({
      error:
        'Another meeting is already recording. Stop it before starting a new meeting.',
      meeting: publicMeeting(active),
    });
  };

  app.post('/v1/meetings/reserve', async (req: Request, res: Response) => {
    await ensureMeetingsLoaded(config);
    let runtime: MeetingRuntime;
    try {
      runtime = await createReservedMeetingRuntime(
        req.body && typeof req.body === 'object' ? req.body : {}
      );
    } catch (reserveError) {
      error(res, 400, errorMessage(reserveError));
      return;
    }
    const active = reserveMeetingRuntime(runtime);
    if (active) {
      respondMeetingConflict(res, active);
      return;
    }
    await persistMeetings(config);
    res.json({ meeting: publicMeeting(runtime) });
  });

  app.post('/v1/meetings/start', async (req: Request, res: Response) => {
    await ensureMeetingsLoaded(config);
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : {};
    const requestedMeetingId =
      typeof body.meetingId === 'string' ? body.meetingId.trim() : '';
    let runtime: MeetingRuntime;

    if (requestedMeetingId) {
      const existing = meetings.get(requestedMeetingId);
      if (!existing) {
        error(res, 404, `Meeting reservation not found: ${requestedMeetingId}`);
        return;
      }
      if (
        typeof body.workspaceId === 'string' &&
        existing.meeting.workspaceId !== body.workspaceId
      ) {
        error(res, 409, 'Meeting reservation belongs to another workspace.');
        return;
      }
      if (existing.meeting.status === 'stopped') {
        if (body.resume !== true) {
          error(res, 409, `Meeting is already stopped: ${requestedMeetingId}`);
          return;
        }
        const active = [...meetings.values()].find(
          candidate =>
            candidate.meeting.id !== requestedMeetingId &&
            candidate.meeting.status === 'recording'
        );
        if (active) {
          respondMeetingConflict(res, active);
          return;
        }
        await stoppedMeetingFinalizations.wait(existing.meeting.id);
        await withMeetingAudioOperation(existing, async () => {
          await existing.fallbackAudioSpool.reopen();
          existing.vad.mic = new MeetingAudioVadBuffer();
          existing.vad.system = new MeetingAudioVadBuffer();
          existing.sttSession = null;
          existing.stt.status = 'starting';
          existing.stt.message = 'Resuming recovered native meeting audio.';
          await activateMeetingRuntime(existing);
        });
        await persistMeetings(config);
        res.json({ meeting: publicMeeting(existing) });
        return;
      }
      runtime = existing;
    } else {
      try {
        runtime = await createReservedMeetingRuntime(body);
      } catch (startError) {
        error(res, 400, errorMessage(startError));
        return;
      }
      const active = reserveMeetingRuntime(runtime);
      if (active) {
        respondMeetingConflict(res, active);
        return;
      }
    }

    await activateMeetingRuntime(runtime);
    await persistMeetings(config);
    res.json({ meeting: publicMeeting(runtime) });
  });

  app.post('/v1/meetings/:id/stop', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    const wasStopped = runtime.meeting.status === 'stopped';
    runtime.meeting.status = 'stopped';
    runtime.meeting.updatedAt = now();
    if (persistMeetingsTimer) {
      clearTimeout(persistMeetingsTimer);
      persistMeetingsTimer = null;
    }
    const hasRetainedFallback =
      wasStopped && (await runtime.fallbackAudioSpool.hasChunks());
    const shouldFinalize = !wasStopped || hasRetainedFallback;
    const finalization = shouldFinalize
      ? startStoppedMeetingFinalization(config, runtime)
      : stoppedMeetingFinalizations.wait(runtime.meeting.id);
    if (shouldFinalize) {
      runtime.stt.status = 'finalizing';
      runtime.stt.message = hasRetainedFallback
        ? 'Retrying retained meeting audio transcription.'
        : runtime.stt.queuedSpeechChunks > 0
          ? `Finishing ${runtime.stt.queuedSpeechChunks} queued audio frame${
              runtime.stt.queuedSpeechChunks === 1 ? '' : 's'
            } before stop completes.`
          : 'Finishing meeting transcription before stop completes.';
    }
    broadcast(runtime, 'status', {
      type: 'status',
      meeting: publicMeeting(runtime),
    });
    await persistMeetings(config).catch(() => {});
    try {
      await finalization;
    } catch (finalizationError) {
      error(
        res,
        500,
        `Meeting finalization failed: ${errorMessage(finalizationError)}`
      );
      return;
    }
    res.json({ meeting: publicMeeting(runtime) });
  });

  app.get('/v1/meetings/:id', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    res.json({ meeting: publicMeeting(runtime) });
  });

  app.patch('/v1/meetings/:id', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }

    const docId = typeof req.body?.docId === 'string' ? req.body.docId : '';
    const summaryDocId =
      typeof req.body?.summaryDocId === 'string' ? req.body.summaryDocId : '';
    const recordingPath =
      typeof req.body?.recordingPath === 'string' ? req.body.recordingPath : '';
    const microphoneRecordingPath =
      typeof req.body?.microphoneRecordingPath === 'string'
        ? req.body.microphoneRecordingPath
        : '';
    const hasSavedTranscriptSegmentIds = Object.hasOwn(
      req.body ?? {},
      'savedTranscriptSegmentIds'
    );
    const requestedSavedTranscriptSegmentIds =
      req.body?.savedTranscriptSegmentIds;
    const hasSavedTranscriptSegmentSnapshots = Object.hasOwn(
      req.body ?? {},
      'savedTranscriptSegmentSnapshots'
    );
    const requestedSavedTranscriptSegmentSnapshots: unknown =
      req.body?.savedTranscriptSegmentSnapshots;
    if (
      hasSavedTranscriptSegmentIds &&
      (!Array.isArray(requestedSavedTranscriptSegmentIds) ||
        requestedSavedTranscriptSegmentIds.length > 20_000 ||
        requestedSavedTranscriptSegmentIds.some(
          (segmentId: unknown) =>
            typeof segmentId !== 'string' || !segmentId.trim()
        ))
    ) {
      error(res, 400, 'savedTranscriptSegmentIds must be an array of ids.');
      return;
    }
    const savedTranscriptSegmentSnapshots = readSavedTranscriptSegmentSnapshots(
      requestedSavedTranscriptSegmentSnapshots
    );
    if (
      hasSavedTranscriptSegmentSnapshots &&
      (!savedTranscriptSegmentSnapshots ||
        Object.keys(savedTranscriptSegmentSnapshots).length > 20_000 ||
        Object.keys(savedTranscriptSegmentSnapshots).length !==
          Object.keys(requestedSavedTranscriptSegmentSnapshots as object)
            .length)
    ) {
      error(
        res,
        400,
        'savedTranscriptSegmentSnapshots must map segment ids to content snapshots.'
      );
      return;
    }
    const recordingDurationMs =
      typeof req.body?.recordingDurationMs === 'number' &&
      Number.isFinite(req.body.recordingDurationMs)
        ? Math.max(0, Math.round(req.body.recordingDurationMs))
        : null;
    if (
      !docId.trim() &&
      !summaryDocId.trim() &&
      !recordingPath.trim() &&
      !microphoneRecordingPath.trim() &&
      !hasSavedTranscriptSegmentIds &&
      !hasSavedTranscriptSegmentSnapshots &&
      recordingDurationMs === null
    ) {
      error(
        res,
        400,
        'docId, summaryDocId, transcript snapshot, or recording metadata is required.'
      );
      return;
    }

    const previousSearchDocId = meetingSearchDocId(runtime);
    const nextDocId = docId.trim();
    if (nextDocId) {
      runtime.meeting.docId = nextDocId;
    }
    const nextSummaryDocId = summaryDocId.trim();
    if (
      nextSummaryDocId &&
      !runtime.meeting.summaryDocIds.includes(nextSummaryDocId)
    ) {
      runtime.meeting.summaryDocIds = [
        nextSummaryDocId,
        ...runtime.meeting.summaryDocIds,
      ].slice(0, 50);
    }
    if (recordingPath.trim()) {
      runtime.meeting.recordingPath = recordingPath.trim();
    }
    if (microphoneRecordingPath.trim()) {
      runtime.meeting.microphoneRecordingPath = microphoneRecordingPath.trim();
    }
    if (hasSavedTranscriptSegmentIds || hasSavedTranscriptSegmentSnapshots) {
      const finalSegmentIds = new Set(
        runtime.transcriptSegments
          .filter(segment => segment.type === 'final')
          .map(segment => segment.id)
      );
      runtime.meeting.savedTranscriptSegmentIds = [
        ...new Set(
          (hasSavedTranscriptSegmentIds
            ? (requestedSavedTranscriptSegmentIds as string[])
            : Object.keys(savedTranscriptSegmentSnapshots ?? {})
          )
            .map(segmentId => segmentId.trim())
            .filter(segmentId => finalSegmentIds.has(segmentId))
        ),
      ];
      // Never derive an acknowledgement from the current live transcript: it
      // may have changed since the renderer materialized its saved snapshot.
      // Legacy ID-only requests retain known snapshots but cannot invent them.
      const snapshots = hasSavedTranscriptSegmentSnapshots
        ? savedTranscriptSegmentSnapshots
        : runtime.meeting.savedTranscriptSegmentSnapshots;
      runtime.meeting.savedTranscriptSegmentSnapshots = Object.fromEntries(
        runtime.meeting.savedTranscriptSegmentIds.flatMap(segmentId =>
          snapshots && Object.hasOwn(snapshots, segmentId)
            ? [[segmentId, snapshots[segmentId]]]
            : []
        )
      );
      runtime.meeting.transcriptSaveInitialized = true;
    }
    if (recordingDurationMs !== null) {
      runtime.meeting.recordingDurationMs = recordingDurationMs;
    }
    runtime.meeting.updatedAt = now();
    broadcast(runtime, 'status', {
      type: 'status',
      meeting: publicMeeting(runtime),
    });
    if (nextDocId && previousSearchDocId !== nextDocId) {
      await deleteWorkspaceContentDocuments(config, {
        docIds: [previousSearchDocId],
        workspaceId: runtime.meeting.workspaceId || 'local',
      }).catch(() => {});
    }
    await upsertMeetingSearchDocument(config, runtime).catch(() => {});
    try {
      await persistMeetingMutation(config, 'meeting update');
    } catch (persistenceError) {
      error(res, 500, errorMessage(persistenceError));
      return;
    }
    res.json({ meeting: publicMeeting(runtime) });
  });

  app.get('/v1/meetings/:id/events', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    runtime.clients.add(res);
    writeSse(res, 'status', {
      type: 'status',
      meeting: publicMeeting(runtime),
    });
    for (const segment of runtime.transcriptSegments) {
      writeSse(res, 'final', { type: 'final', segment });
    }
    if (runtime.partialSegment) {
      writeSse(res, 'partial', {
        type: 'partial',
        segment: runtime.partialSegment,
      });
    }

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      runtime.clients.delete(res);
    });
  });

  app.get('/v1/meetings/:id/transcript', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    res.json({
      meeting: publicMeeting(runtime),
      partialSegment: runtime.partialSegment,
      transcript: transcriptText(runtime),
      transcriptSegments: runtime.transcriptSegments,
    });
  });

  app.post('/v1/meetings/:id/transcript', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    if (runtime.meeting.status === 'stopped') {
      error(res, 409, `Meeting is already stopped: ${req.params.id}`);
      return;
    }

    try {
      const segment = readTranscriptSegmentInput(req, runtime.meeting.id);
      applyTranscriptSegment(runtime, segment);
      await persistTranscriptEvent(config, runtime, segment);
      res.json({
        meeting: publicMeeting(runtime),
        partialSegment: runtime.partialSegment,
        segment,
        transcriptSegments: runtime.transcriptSegments,
      });
    } catch (segmentError) {
      error(res, 400, errorMessage(segmentError));
    }
  });

  app.post('/v1/meetings/:id/apple-speech/events', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    if (runtime.meeting.providerId !== 'apple-speechanalyzer') {
      error(
        res,
        409,
        `Meeting ${req.params.id} is not using Apple SpeechAnalyzer.`
      );
      return;
    }
    if (!appleSpeechBridge.available) {
      error(res, 503, 'Apple SpeechAnalyzer bridge is not registered.');
      return;
    }
    if (runtime.meeting.status === 'stopped') {
      error(res, 409, `Meeting is already stopped: ${req.params.id}`);
      return;
    }

    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.type === 'error') {
        runtime.stt.status = 'error';
        runtime.stt.message =
          typeof body.message === 'string'
            ? body.message
            : 'Apple SpeechAnalyzer bridge failed.';
        broadcast(runtime, 'error', {
          code:
            typeof body.code === 'string'
              ? body.code
              : 'apple_speech_bridge_failed',
          message: runtime.stt.message,
          type: 'error',
        });
        await persistMeetings(config).catch(() => {});
        res.json({ meeting: publicMeeting(runtime) });
        return;
      }

      const segment = readTranscriptSegmentInput(req, runtime.meeting.id);
      applyTranscriptSegment(runtime, segment);
      runtime.stt.message =
        segment.type === 'partial'
          ? 'Receiving Apple SpeechAnalyzer partial transcript.'
          : 'Received Apple SpeechAnalyzer final transcript.';
      await persistTranscriptEvent(config, runtime, segment);
      res.json({
        meeting: publicMeeting(runtime),
        partialSegment: runtime.partialSegment,
        segment,
        transcriptSegments: runtime.transcriptSegments,
      });
    } catch (segmentError) {
      error(res, 400, errorMessage(segmentError));
    }
  });

  app.post('/v1/meetings/:id/audio-level', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    if (runtime.meeting.status === 'stopped') {
      error(res, 409, `Meeting is already stopped: ${req.params.id}`);
      return;
    }

    const input = readAudioLevelInput(req);
    runtime.meeting.updatedAt = now();
    broadcast(runtime, 'audio-level', {
      type: 'audio-level',
      ...input,
    });
    res.json(input);
  });

  const rawAudioBody = express.raw({
    limit: AUDIO_FRAME_MAX_BYTES,
    type: 'application/octet-stream',
  });

  app.post('/v1/meetings/:id/audio-frame', rawAudioBody, async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }
    if (runtime.meeting.status === 'stopped') {
      error(res, 409, `Meeting is already stopped: ${req.params.id}`);
      return;
    }

    try {
      const frame = readAudioFrameInput(req);
      await withMeetingAudioOperation(runtime, async () => {
        // Stop closes intake synchronously and queues finalization behind any
        // acceptance already in flight. A queued late request must not reopen it.
        if (runtime.meeting.status === 'stopped') {
          error(res, 409, `Meeting is already stopped: ${req.params.id}`);
          return;
        }
        const normalized = normalizeAudioFrame(frame);
        const accepted = await runtime.fallbackAudioSpool.accept(
          normalized,
          frame.id
        );
        if (!accepted) {
          res.json({
            audioFrames: runtime.stt.audioFrames,
            chunk: null,
            duplicate: true,
            level: frame.level,
            stt: runtime.stt,
          });
          return;
        }
        const timestamp = now();
        runtime.meeting.updatedAt = timestamp;
        runtime.stt.audioFrames++;
        runtime.stt.audioFramesBySource[frame.source]++;
        runtime.stt.lastAudioFrameAt = timestamp;
        runtime.stt.lastAudioFrameLevel = frame.level;
        runtime.stt.lastAudioFrameSource = frame.source;

        broadcast(runtime, 'audio-level', {
          level: frame.level,
          source: frame.source,
          type: 'audio-level',
        });

        const chunk = await applyAudioFrameToStt(runtime, normalized);
        res.json({
          audioFrames: runtime.stt.audioFrames,
          chunk: chunk
            ? {
                durationMs: chunk.durationMs,
                endMs: chunk.endMs,
                id: chunk.id,
                level: chunk.level,
                sampleRate: chunk.sampleRate,
                source: chunk.source,
                startMs: chunk.startMs,
              }
            : null,
          duplicate: false,
          level: frame.level,
          stt: runtime.stt,
        });
      });
    } catch (audioError) {
      runtime.stt.status = 'error';
      runtime.stt.message = errorMessage(audioError);
      broadcast(runtime, 'error', {
        code: 'audio_frame_failed',
        message: runtime.stt.message,
        type: 'error',
      });
      error(res, 400, runtime.stt.message);
    }
  });

  app.post(
    '/v1/audio/transcriptions',
    transcriptionUpload.single('file'),
    async (req, res) => {
      try {
        const modelId = selectedTranscriptionModelId(req, config);
        const model = modelById(modelId);
        if (!model) {
          error(res, 404, `Unknown local transcription model: ${modelId}`);
          return;
        }
        if (model.type !== 'stt') {
          error(res, 400, `${model.id} is not a transcription model.`);
          return;
        }
        if (
          model.runtime !== 'onnxruntime' &&
          model.runtime !== 'sherpa-onnx' &&
          !nativeAsrRuntime(model)
        ) {
          error(
            res,
            503,
            `${model.id} does not have a local file transcription adapter yet.`
          );
          return;
        }

        const chunks = readTranscriptionChunks(req);
        const text = await transcribeSttChunks({
          chunks,
          config,
          modelId: model.id,
        });
        res.json({
          duration:
            chunks.reduce((total, chunk) => total + chunk.durationMs, 0) / 1000,
          model: model.id,
          provider: 'local',
          text,
        });
      } catch (transcriptionError) {
        const message = errorMessage(transcriptionError);
        const status = message.includes('downloaded yet') ? 503 : 400;
        error(res, status, message);
      }
    }
  );

  app.post('/v1/meetings/:id/summary', async (req, res) => {
    const runtime = await getMeetingRuntime(config, req.params.id);
    if (!runtime) {
      error(res, 404, `Meeting not found: ${req.params.id}`);
      return;
    }

    try {
      await stoppedMeetingFinalizations.wait(runtime.meeting.id);

      const providedSummary =
        typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';
      if (providedSummary) {
        runtime.meeting.summary = providedSummary;
        runtime.meeting.updatedAt = now();
        await upsertMeetingSearchDocument(config, runtime).catch(() => {});
        await persistMeetingMutation(config, 'meeting summary');
        res.json({
          meeting: publicMeeting(runtime),
          summary: {
            text: providedSummary,
            model: 'nota-ai-chat',
            provider: 'local',
          },
        });
        return;
      }

      const requestedModelId =
        typeof req.body?.modelId === 'string' ? req.body.modelId : undefined;
      const selected = _models.select(requestedModelId);
      const summary = await generateMeetingSummary({
        config,
        prompt: meetingSummaryInput(req, runtime),
        selected,
      });

      runtime.meeting.summary = summary.text;
      runtime.meeting.updatedAt = now();
      await upsertMeetingSearchDocument(config, runtime).catch(() => {});
      await persistMeetingMutation(config, 'meeting summary');
      res.json({
        meeting: publicMeeting(runtime),
        summary: {
          model: summary.model,
          provider: summary.provider,
          runtime: summary.runtime,
          structured: summary.structured,
          text: summary.text,
        },
      });
    } catch (summaryError) {
      error(res, 500, errorMessage(summaryError));
    }
  });
}
