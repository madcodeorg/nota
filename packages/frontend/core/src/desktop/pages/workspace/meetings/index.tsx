import { notify } from '@nota/component';
import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { WorkspaceDialogService } from '@nota/core/modules/dialogs';
import { DocsService } from '@nota/core/modules/doc';
import {
  type CalendarEvent,
  IntegrationService,
  type LocalCalendarStatus,
  presentLocalCalendarPermission,
} from '@nota/core/modules/integration';
import { JournalService } from '@nota/core/modules/journal';
import {
  hasMeetingPermissionIssue,
  isMeetingPermissionBlocking,
  meetingPermissionRecovery,
  meetingPermissionSettingsFailure,
  openRecordingPermissionSettings,
  shouldProbeSystemAudioOnFocus,
} from '@nota/core/modules/media/meeting-permission-refresh';
import { MeetingSettingsService } from '@nota/core/modules/media/services/meeting-settings';
import { GuardService } from '@nota/core/modules/permissions';
import {
  ViewBody,
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@nota/core/modules/workbench';
import {
  isUserOwnedWorkspaceFlavour,
  WorkspaceService,
} from '@nota/core/modules/workspace';
import {
  createStreamEncoder,
  type OpusStreamEncoder,
} from '@nota/core/utils/opus-encoding';
import {
  useFramework,
  useLiveData,
  useService,
  useServiceOptional,
} from '@nota/infra';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RiAddFill,
  RiCalendarEventFill,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiPauseFill,
  RiPlayFill,
  RiStopFill,
  RiVoiceprintFill,
} from 'react-icons/ri';

import { syncWorkspaceContentIndex } from '../ai-workspace-index';
import { startMeetingCalendarRefresh } from './calendar-refresh';
import {
  createMeetingAudioPostState,
  drainMeetingAudioArchive,
  type MeetingAudioPostState,
  postMeetingAudioBytes,
  retryMeetingAudioOperation,
  takeMeetingAudioSamples,
} from './meeting-audio-retry';
import {
  ensureMeetingAudioContextRunning,
  meetingMicrophoneConstraints,
} from './meeting-microphone';
import {
  ensurePortableMeetingRecording,
  isActiveNativeMeetingRecording,
  isRawMeetingRecording,
} from './meeting-recording';
import {
  formatElapsedTime,
  meetingContentBlockId,
  meetingDurationSeconds,
  meetingSummarySectionMarkdown,
  resolveMeetingSaveDestination,
} from './meeting-save';
import {
  appendMeetingMarkdownDoc as appendMarkdownDoc,
  createMeetingSavePermissionContext,
  executeMeetingSaveOnce,
  finalizePortableMeetingMicRecording,
  workspaceDocExists,
  workspaceDocHasBlock,
} from './meeting-save-executor';
import {
  browserMeetingSaveStorage,
  persistPendingMeetingSave,
} from './meeting-save-worker';
import { finalizeConfirmedMeetingCapture } from './meeting-stop-finalization';
import { createMeetingTranscriptReplayFilter } from './meeting-transcript-replay';
import * as styles from './style.css';

type Artwork = {
  artist: string;
  date: string;
  imageUrl: string;
  objectId?: number;
  title: string;
};

type MeetingState = 'idle' | 'recording' | 'paused' | 'stopped';
type TranscriptSource = 'mic' | 'system';
type TranscriptSegmentType = 'final' | 'partial';

type PreparedMicAudioCapture = {
  audioContext: AudioContext;
  stream: MediaStream;
};

type NativeRecordingStatus = {
  archiveBytes?: number;
  error?: string;
  filepath?: string;
  id: number;
  meetingId?: string;
  numberOfChannels?: number;
  recovered?: boolean;
  sampleRate?: number;
  startTime?: number;
  status: string;
  workspaceId?: string;
};

type NativeRecordingRuntimeStatus = {
  available: boolean;
  reason: string | null;
};

type AudioForwardDrainResult = {
  archive: number;
  complete: boolean;
  cursor: number;
  reason: string | null;
};

type RecordingHandlerWithRuntimeStatus = {
  getRecordingRuntimeStatus?: () => Promise<NativeRecordingRuntimeStatus>;
  // Main-process push of tapped system audio straight to the AI backend;
  // when available the renderer skips its raw-buffer polling loop entirely.
  startMeetingAudioForward?: (input: {
    channels: number;
    fromByte?: number;
    meetingId: string;
    recordingId: number;
    sampleRate: number;
  }) => Promise<{ active: boolean }>;
  stopMeetingAudioForward?: (
    meetingId: string
  ) => Promise<AudioForwardDrainResult>;
  pushAppleSpeechAudioFrame?: (
    meetingId: string,
    frame: {
      channels: number;
      encoding: 'f32le';
      endMs: number;
      frameId?: string;
      pcmBase64: string;
      sampleRate: number;
      source?: 'mic' | 'system';
      startMs: number;
    }
  ) => Promise<void>;
  startAppleSpeechTranscription?: (input: {
    channels?: number;
    meetingId: string;
    recordingId?: number;
    sampleRate?: number;
    source?: 'mic' | 'system';
  }) => Promise<{
    available: boolean;
    reason: string | null;
    version: string | null;
  }>;
  setupAppleSpeechBridge?: () => Promise<{
    available: boolean;
    reason: string | null;
    version: string | null;
  }>;
  transcribeAppleSpeechRawRecording?: (input: {
    channels?: number;
    filepath: string;
    sampleRate?: number;
  }) => Promise<AudioTranscriptionResponse | null>;
  openMicAudioSpool?: (input: {
    channels: number;
    meetingId: string;
    sampleRate: number;
    startMs: number;
  }) => Promise<unknown>;
  appendMicAudioSpool?: (
    meetingId: string,
    pcm: Uint8Array
  ) => Promise<unknown>;
  readMicAudioSpoolFrame?: (
    meetingId: string,
    maximumBytes: number
  ) => Promise<{
    buffer: unknown;
    endBytes: number;
    endMs: number;
    frameId: string;
    startBytes: number;
    startMs: number;
  } | null>;
  acknowledgeMicAudioSpoolFrame?: (
    meetingId: string,
    frameId: string
  ) => Promise<unknown>;
  closeMicAudioSpool?: (meetingId: string) => Promise<unknown>;
  finishMicAudioSpool?: (meetingId: string) => Promise<boolean>;
  getMicAudioSpoolStatus?: (meetingId: string) => Promise<{
    acknowledgedBytes: number;
    archiveBytes: number;
    channels: number;
    closed: boolean;
    pendingBytes: number;
    sampleRate: number;
  } | null>;
  readMicAudioSpoolArchive?: (
    meetingId: string,
    cursor: number,
    maximumBytes: number
  ) => Promise<{
    buffer: unknown;
    nextCursor: number;
  }>;
  getPublishedMicRecordingPath?: (meetingId: string) => Promise<string | null>;
  publishMicRecording?: (
    meetingId: string,
    encoded: Uint8Array
  ) => Promise<string>;
};

type MicAudioSpoolHandler = Required<
  Pick<
    RecordingHandlerWithRuntimeStatus,
    | 'acknowledgeMicAudioSpoolFrame'
    | 'appendMicAudioSpool'
    | 'closeMicAudioSpool'
    | 'finishMicAudioSpool'
    | 'openMicAudioSpool'
    | 'readMicAudioSpoolFrame'
  >
>;

type MicAudioExportHandler = Required<
  Pick<
    RecordingHandlerWithRuntimeStatus,
    | 'getMicAudioSpoolStatus'
    | 'getPublishedMicRecordingPath'
    | 'publishMicRecording'
    | 'readMicAudioSpoolArchive'
  >
>;

type NativeRecordingState = {
  archiveBytes?: number;
  cursor: number;
  filepath?: string | null;
  id: number;
  meetingId?: string;
  numberOfChannels: number;
  recovered?: boolean;
  sampleRate: number;
  startTime?: number;
  status: string;
  workspaceId?: string;
};

type RecordingHandlerWithStartOptions = {
  startRecording?: (
    appGroup?: unknown,
    options?: {
      meetingId?: string;
      suppressPopup?: boolean;
      workspaceId?: string;
    }
  ) => Promise<NativeRecordingStatus | null>;
};

type MeetingPermissionType = 'microphone' | 'systemAudio';
type MeetingMediaAccessStatus =
  | 'denied'
  | 'granted'
  | 'not-determined'
  | 'restricted'
  | 'unknown';
type MeetingPermissionState = Record<MeetingPermissionType, boolean> & {
  checkedAt?: number;
  permissionClient?: {
    bundleIdentifier: string | null;
    displayName: string;
    kind: 'development-host' | 'packaged-build';
  };
  ready?: boolean;
  reasons?: Partial<Record<MeetingPermissionType, string>>;
  runtime?: NativeRecordingRuntimeStatus;
  systemAudioAccessSource?:
    | 'core-audio-probe'
    | 'not-checked'
    | 'platform-compatibility'
    | 'unavailable';
  statuses?: Record<MeetingPermissionType, MeetingMediaAccessStatus>;
};

type MicAudioCapture = {
  stop: () => Promise<void>;
};

class TerminalMicCaptureError extends Error {
  readonly terminal = true;
}

type OwnedMicAudioCapture = {
  capture: MicAudioCapture;
  meetingId: string;
};

type PendingMicAudioCapture = {
  meetingId: string;
  promise: Promise<MicAudioCapture | null>;
};

// The Meetings route can unmount while a user keeps working elsewhere in the
// workspace. Keep microphone ownership at module scope so navigation does not
// silently stop an active meeting. The renderer itself remains the lifetime
// boundary, and explicit meeting stop/restart still drains and releases it.
let activeMicAudioCapture: OwnedMicAudioCapture | null = null;
let pendingMicAudioCapture: PendingMicAudioCapture | null = null;

type TranscriptSegment = {
  id: string;
  meetingId: string;
  type: TranscriptSegmentType;
  text: string;
  startMs: number;
  endMs: number;
  source: TranscriptSource;
  confidence?: number;
  createdAt: string;
};

type MeetingSttState = {
  audioFrames?: number;
  audioFramesBySource?: Partial<Record<TranscriptSource, number>>;
  completedSpeechChunks?: number;
  decodeRealtimeFactor?: number | null;
  executionProvider?: string | null;
  failedSpeechChunks?: number;
  lastAudioFrameLevel?: number | null;
  lastAudioFrameSource?: TranscriptSource | null;
  message?: string | null;
  providerId?: string;
  queuedSpeechChunks?: number;
  status?:
    | 'error'
    | 'finalizing'
    | 'running'
    | 'starting'
    | 'stopped'
    | 'unavailable';
};

type MeetingSessionResponse = {
  meeting: {
    createdAt: string;
    id: string;
    docId?: string | null;
    microphoneRecordingPath?: string | null;
    providerId?: string;
    recordingDurationMs?: number | null;
    recordingPath?: string | null;
    savedTranscriptSegmentIds?: string[];
    savedTranscriptSegmentSnapshots?: Record<string, string>;
    stt?: MeetingSttState;
    sttModelId?: string;
    status: 'recording' | 'stopped';
    summary?: string | null;
    summaryDocIds?: string[];
    partialSegment?: TranscriptSegment | null;
    transcriptSegments?: TranscriptSegment[];
    transcriptSaveInitialized?: boolean;
    updatedAt: string;
    workspaceId?: string | null;
  };
};

type MeetingHistoryItem = MeetingSessionResponse['meeting'];

type MeetingListResponse = {
  meetings: MeetingHistoryItem[];
};

type MeetingSummaryResponse = {
  meeting: MeetingSessionResponse['meeting'];
  summary: {
    model: string;
    provider: string;
    text: string;
  };
};

type AudioTranscriptionResponse = {
  duration: number;
  model: string;
  provider: string;
  text: string;
};

type MeetingSttRuntimePreloadResponse = {
  preload: {
    available: boolean;
    cached: boolean;
    durationMs: number;
    message: string | null;
    modelId: string | null;
    providerId: string | null;
    status: string;
  };
};

type MeetingSsePayload =
  | {
      meeting: MeetingSessionResponse['meeting'];
      type: 'status';
    }
  | {
      segment: TranscriptSegment;
      type: TranscriptSegmentType;
    }
  | {
      level: number;
      source: TranscriptSource;
      type: 'audio-level';
    }
  | {
      code?: string;
      message?: string;
      type: 'error';
    };

const AI_BACKEND_OFFLINE_MESSAGE =
  'Local Nota AI backend is offline. Start or restart the backend, then try again.';
const STT_PRELOAD_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000] as const;
const MIC_AUDIO_FRAME_TARGET_MS = 100;
const MIC_AUDIO_FRAME_MAX_SAMPLES =
  (512 * 1024) / Float32Array.BYTES_PER_ELEMENT;
const MEETING_PERMISSION_TYPES = ['systemAudio', 'microphone'] as const;
const SYSTEM_AUDIO_FRAME_POLL_MS = 250;
const SYSTEM_AUDIO_FRAME_TARGET_MS = 250;
const SYSTEM_AUDIO_FRAME_MAX_BYTES = 256 * 1024;
const CAPTURE_START_WATCHDOG_MS = 4000;
const MEETING_AUDIO_POSTED_EVENT = 'nota:meeting-audio-frame-posted';
const CAPTURE_START_NO_AUDIO_MESSAGE =
  'Meeting recording started, but Nota has not received microphone or app audio yet. Check Microphone and System Audio access, then restart the meeting.';
const DEFAULT_ARTWORK: Artwork = {
  artist: 'Vincent van Gogh',
  date: '1889',
  imageUrl:
    'https://images.metmuseum.org/CRDImages/ep/web-large/DP-42549-001.jpg',
  title: 'Wheat Field with Cypresses',
};
const MEETING_ARTWORK_CACHE_KEY = 'nota:meetings-cover-met-artworks:v1';
const MEETING_LAST_ARTWORK_KEY = 'nota:meetings-cover-last-artwork:v1';

function readCachedArtworkPool() {
  try {
    const raw = window.localStorage.getItem(MEETING_ARTWORK_CACHE_KEY);
    if (!raw) {
      return [];
    }
    const cached = JSON.parse(raw) as { artworks?: Artwork[] };
    return (cached.artworks ?? []).filter(
      artwork =>
        typeof artwork?.imageUrl === 'string' &&
        artwork.imageUrl.startsWith('https://') &&
        typeof artwork.title === 'string' &&
        typeof artwork.artist === 'string' &&
        typeof artwork.date === 'string'
    );
  } catch {
    return [];
  }
}

function artworkStorageKey(artwork: Artwork) {
  return String(artwork.objectId ?? artwork.imageUrl);
}

function pickFreshArtwork(cachedArtworks: Artwork[]) {
  const artworkByImage = new Map<string, Artwork>();
  for (const artwork of [...cachedArtworks, DEFAULT_ARTWORK]) {
    artworkByImage.set(artwork.imageUrl, artwork);
  }
  const pool = [...artworkByImage.values()];
  let lastArtworkKey: string | null = null;
  try {
    lastArtworkKey = window.localStorage.getItem(MEETING_LAST_ARTWORK_KEY);
  } catch {
    // Rotation works without persisted state.
  }
  const candidates =
    pool.length > 1
      ? pool.filter(artwork => artworkStorageKey(artwork) !== lastArtworkKey)
      : pool;
  const next =
    candidates[Math.floor(Math.random() * candidates.length)] ??
    DEFAULT_ARTWORK;
  try {
    window.localStorage.setItem(
      MEETING_LAST_ARTWORK_KEY,
      artworkStorageKey(next)
    );
  } catch {
    // Rotation works without persisted state.
  }
  return next;
}

function aiBackendUrl(path: string) {
  // Custom Electron schemes expose `location.origin` as "null". Resolve
  // against the full assets:// URL so fetch/EventSource stay on the app
  // protocol proxy, which injects the private loopback credential.
  return new URL(path, location.href).toString();
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(aiBackendUrl(url), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(AI_BACKEND_OFFLINE_MESSAGE);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

type NativeMeetingCaptureOwner = {
  meetingId: string;
  recordingId: number;
  workspaceId: string;
};

const NATIVE_MEETING_CAPTURE_STORAGE_KEY = 'nota:native-meeting-capture:v1';

function readNativeMeetingCaptureOwner() {
  try {
    const raw = window.localStorage.getItem(NATIVE_MEETING_CAPTURE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<NativeMeetingCaptureOwner>;
    if (
      typeof value.meetingId !== 'string' ||
      typeof value.workspaceId !== 'string' ||
      !Number.isSafeInteger(value.recordingId)
    ) {
      return null;
    }
    return value as NativeMeetingCaptureOwner;
  } catch {
    return null;
  }
}

function writeNativeMeetingCaptureOwner(
  workspaceId: string,
  owner: Omit<NativeMeetingCaptureOwner, 'workspaceId'>
) {
  try {
    window.localStorage.setItem(
      NATIVE_MEETING_CAPTURE_STORAGE_KEY,
      JSON.stringify({ ...owner, workspaceId })
    );
  } catch {
    // Main-process recording state remains available for active-session
    // recovery when renderer storage is unavailable.
  }
}

function clearNativeMeetingCaptureOwner(
  workspaceId: string,
  meetingId: string,
  recordingId?: number
) {
  try {
    const owner = readNativeMeetingCaptureOwner();
    if (
      owner?.workspaceId === workspaceId &&
      owner?.meetingId === meetingId &&
      (recordingId === undefined || owner.recordingId === recordingId)
    ) {
      window.localStorage.removeItem(NATIVE_MEETING_CAPTURE_STORAGE_KEY);
    }
  } catch {
    // An obsolete recovery hint is harmless and will be overwritten by the
    // next native meeting capture.
  }
}

function parseMeetingPayload(event: MessageEvent) {
  return JSON.parse(event.data) as MeetingSsePayload;
}

function formatSegmentTimestamp(
  segment: Pick<TranscriptSegment, 'endMs' | 'startMs'>
) {
  const start = formatElapsedTime(Math.round(segment.startMs / 1000));
  const end = formatElapsedTime(Math.round(segment.endMs / 1000));
  return `${start} - ${end}`;
}

function formatCalendarEventTime(event: CalendarEvent) {
  if (event.allDay) {
    return 'All day';
  }
  const start = event.startAt.format('h:mm A');
  const end = event.endAt.format('h:mm A');
  return start === end ? start : `${start} - ${end}`;
}

function calendarEventDetailText(event: CalendarEvent) {
  const attendees = event.attendees?.length
    ? event.attendees.length > 3
      ? `${event.attendees.slice(0, 3).join(', ')} +${
          event.attendees.length - 3
        }`
      : event.attendees.join(', ')
    : '';
  return [event.location, attendees].filter(Boolean).join(' · ');
}

function meetingPermissionLabel(type: MeetingPermissionType) {
  return type === 'systemAudio' ? 'System Audio' : 'Microphone';
}

function meetingPermissionStatusLabel(
  permission: boolean,
  status?: MeetingMediaAccessStatus
) {
  if (status === 'unknown') return 'Not verified';
  if (permission) return 'Allowed';
  if (status === 'not-determined') return 'Not allowed yet';
  if (status === 'restricted') return 'Restricted';
  if (status === 'denied') return 'Off';
  return 'Not verified';
}

function meetingPermissionClientContext(
  permissions: MeetingPermissionState | null | undefined
) {
  const client = permissions?.permissionClient;
  if (environment.isMacOs && client?.kind === 'development-host') {
    return {
      separateInstalledApp:
        ' Installed Nota has separate macOS permissions and was not checked.',
      subject: `${client.displayName} (local development)`,
    };
  }
  return {
    separateInstalledApp: '',
    subject: client ? `${client.displayName} (this running build)` : 'this app',
  };
}

function meetingPermissionSummary(
  permissions: MeetingPermissionState | null,
  missing: MeetingPermissionType[]
) {
  const { separateInstalledApp, subject: permissionSubject } =
    meetingPermissionClientContext(permissions);

  if (permissions?.runtime?.available === false) {
    return (
      permissions.runtime.reason ??
      'The native recording engine is unavailable.'
    );
  }
  if (missing.length === 0) {
    return `System Audio, Microphone, and recording engine checks passed for ${permissionSubject}.${separateInstalledApp}`;
  }

  const messages = missing.map(
    type =>
      meetingPermissionRecovery(type, permissions, environment.isWindows)
        .message
  );
  return `${messages.join(' ')} Access was checked for ${permissionSubject}.${separateInstalledApp}`;
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

function mergeTranscriptSegment(
  segments: TranscriptSegment[],
  next: TranscriptSegment
) {
  const idIndex = segments.findIndex(segment => segment.id === next.id);
  if (idIndex >= 0) {
    return segments.map((segment, index) =>
      index === idIndex ? next : segment
    );
  }

  const overlapIndex = segments.findIndex(segment => {
    if (segment.type !== 'final' || segment.source !== next.source) {
      return false;
    }
    const overlap = transcriptSegmentOverlap(segment, next);
    const durationMs = Math.max(0, next.endMs - next.startMs);
    return overlap >= Math.min(400, durationMs / 3);
  });
  if (overlapIndex < 0) {
    return [...segments, next];
  }

  const existing = segments[overlapIndex];
  if (!existing) {
    return [...segments, next];
  }

  const existingText = normalizedTranscriptText(existing.text);
  const nextText = normalizedTranscriptText(next.text);
  const related =
    existingText.includes(nextText) || nextText.includes(existingText);
  if (!related) {
    return [...segments, next];
  }

  const keepNext = nextText.length > existingText.length;
  const merged = {
    ...existing,
    endMs: Math.max(existing.endMs, next.endMs),
    startMs: Math.min(existing.startMs, next.startMs),
    text: keepNext ? next.text : existing.text,
  };
  return segments.map((segment, index) =>
    index === overlapIndex ? merged : segment
  );
}

function meetingSttStatusText(
  started: boolean,
  sttState: MeetingSttState | null,
  providerId: string | null
) {
  if (!started || !sttState) {
    return '';
  }

  const provider = providerId ?? sttState.providerId ?? 'selected STT';
  if (sttState.queuedSpeechChunks && sttState.queuedSpeechChunks > 0) {
    return `Transcribing ${sttState.queuedSpeechChunks} queued speech chunk${
      sttState.queuedSpeechChunks === 1 ? '' : 's'
    }...`;
  }
  if (sttState.message) {
    if (sttState.message.toLowerCase().includes('speech chunk')) {
      return '';
    }
    return sttState.message;
  }

  switch (sttState.status) {
    case 'starting':
      return `Starting ${provider}...`;
    case 'running':
      return `Listening with ${provider}`;
    case 'unavailable':
      return `${provider} is unavailable.`;
    case 'error':
      return `${provider} failed.`;
    default:
      return '';
  }
}

function providerSupportsLiveTranscript(
  providerId: string | null,
  sttState: MeetingSttState | null
) {
  if (
    sttState?.message
      ?.toLowerCase()
      .includes('streaming adapter is not implemented')
  ) {
    return false;
  }
  if (!providerId) {
    return true;
  }
  return ![
    'cohere-onnx',
    'distil-whisper-large-v3-5-onnx',
    'moonshine-base-onnx',
    'whisper-tiny-en-onnx',
  ].includes(providerId);
}

function hasSttProgress(sttState?: MeetingSttState | null) {
  if (!sttState) {
    return false;
  }
  return (
    (sttState.audioFrames ?? 0) > 0 ||
    (sttState.completedSpeechChunks ?? 0) > 0 ||
    (sttState.queuedSpeechChunks ?? 0) > 0 ||
    Object.values(sttState.audioFramesBySource ?? {}).some(
      count => (count ?? 0) > 0
    )
  );
}

function hasTranscriptProgress(meeting: MeetingSessionResponse['meeting']) {
  return (
    hasSttProgress(meeting.stt) ||
    Boolean(meeting.partialSegment?.text?.trim()) ||
    Boolean(
      meeting.transcriptSegments?.some(segment => segment.text.trim().length)
    )
  );
}

function isMeetingTranscriptionPending(status?: MeetingSttState['status']) {
  return (
    status === 'starting' || status === 'running' || status === 'finalizing'
  );
}

function toAudioBytes(buffer: unknown) {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  if (
    buffer &&
    typeof buffer === 'object' &&
    Array.isArray((buffer as { data?: unknown }).data)
  ) {
    return new Uint8Array((buffer as { data: number[] }).data);
  }
  return new Uint8Array();
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function float32Bytes(samples: Float32Array) {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

function concatFloat32Chunks(chunks: Float32Array[], sampleCount: number) {
  const output = new Float32Array(sampleCount);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

async function postAudioFrame(input: {
  channels: number;
  endMs: number;
  frameId: string;
  meetingId: string;
  pcmBytes: Uint8Array;
  sampleRate: number;
  source: TranscriptSource;
  startMs: number;
}) {
  // Raw binary body with metadata in the query string; avoids base64 and JSON
  // work on the audio hot path.
  const params = new URLSearchParams({
    channels: String(input.channels),
    endMs: String(input.endMs),
    frameId: input.frameId,
    sampleRate: String(input.sampleRate),
    source: input.source,
    startMs: String(input.startMs),
  });
  let response: Response;
  try {
    response = await fetch(
      aiBackendUrl(
        `/v1/meetings/${input.meetingId}/audio-frame?${params.toString()}`
      ),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: input.pcmBytes as BodyInit,
      }
    );
  } catch {
    throw new Error(AI_BACKEND_OFFLINE_MESSAGE);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed: ${response.status}`);
  }
}

function audioFrameByteWidth(channels: number) {
  return Float32Array.BYTES_PER_ELEMENT * Math.max(1, channels);
}

function alignedAudioByteLength(byteLength: number, channels: number) {
  const frameBytes = audioFrameByteWidth(channels);
  return Math.floor(byteLength / frameBytes) * frameBytes;
}

function systemAudioPostChunkBytes(sampleRate: number, channels: number) {
  const frameBytes = audioFrameByteWidth(channels);
  const targetSamples = Math.max(
    1,
    Math.round((sampleRate * SYSTEM_AUDIO_FRAME_TARGET_MS) / 1000)
  );
  const targetBytes = targetSamples * frameBytes;
  const cappedBytes = Math.min(targetBytes, SYSTEM_AUDIO_FRAME_MAX_BYTES);
  return Math.max(frameBytes, alignedAudioByteLength(cappedBytes, channels));
}

async function postSystemAudioBuffer(input: {
  channels: number;
  meetingId: string;
  pcmBytes: Uint8Array;
  sampleRate: number;
  startCursor: number;
  state: MeetingAudioPostState;
}) {
  const chunkBytes = systemAudioPostChunkBytes(
    input.sampleRate,
    input.channels
  );
  return postMeetingAudioBytes({
    byteAlignment: audioFrameByteWidth(input.channels),
    chunkBytes,
    onPostError: error => {
      console.warn('System audio frame failed', error);
    },
    pcmBytes: input.pcmBytes,
    postFrame: frame =>
      postAudioFrame({
        channels: input.channels,
        endMs: audioCursorToMs(
          frame.endCursor,
          input.sampleRate,
          input.channels
        ),
        frameId: `system:${frame.startCursor}:${frame.endCursor}`,
        meetingId: input.meetingId,
        pcmBytes: frame.pcmBytes,
        sampleRate: input.sampleRate,
        source: 'system',
        startMs: audioCursorToMs(
          frame.startCursor,
          input.sampleRate,
          input.channels
        ),
      }),
    startCursor: input.startCursor,
    state: input.state,
    streamKey: `${input.meetingId}:${input.sampleRate}:${input.channels}`,
  });
}

async function activeRecordingMeeting(workspaceId?: string) {
  const params = new URLSearchParams();
  if (workspaceId) {
    params.set('workspaceId', workspaceId);
  }
  const serializedParams = params.toString();
  const query = serializedParams ? `?${serializedParams}` : '';
  const data = await jsonRequest<MeetingListResponse>(`/v1/meetings${query}`);
  return data.meetings.find(meeting => meeting.status === 'recording') ?? null;
}

function assertMeetingWorkspace(
  meeting: MeetingSessionResponse['meeting'],
  workspaceId: string
) {
  if (meeting.workspaceId !== workspaceId) {
    throw new Error(
      'This meeting belongs to a different workspace and cannot be opened or saved here.'
    );
  }
}

// Runs off the renderer main thread; posts each mono 128-sample render
// quantum back to the page. Buffering/flush cadence stays on the main thread
// where it can await network calls.
const MIC_WORKLET_SOURCE = `
class NotaMicCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length && channels[0].length) {
      let mono = channels[0];
      if (channels.length > 1) {
        mono = new Float32Array(channels[0].length);
        for (const channel of channels) {
          for (let i = 0; i < channel.length; i++) {
            mono[i] += channel[i] / channels.length;
          }
        }
      } else {
        mono = mono.slice();
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}
registerProcessor('nota-mic-capture', NotaMicCaptureProcessor);
`;

function supportsMicAudioSpool(
  handler: RecordingHandlerWithRuntimeStatus | undefined
): handler is RecordingHandlerWithRuntimeStatus & MicAudioSpoolHandler {
  return Boolean(
    handler?.openMicAudioSpool &&
    handler.appendMicAudioSpool &&
    handler.readMicAudioSpoolFrame &&
    handler.acknowledgeMicAudioSpoolFrame &&
    handler.closeMicAudioSpool &&
    handler.finishMicAudioSpool
  );
}

function supportsMicAudioExport(
  handler: RecordingHandlerWithRuntimeStatus | undefined
): handler is RecordingHandlerWithRuntimeStatus & MicAudioExportHandler {
  return Boolean(
    handler?.getMicAudioSpoolStatus &&
    handler.getPublishedMicRecordingPath &&
    handler.publishMicRecording &&
    handler.readMicAudioSpoolArchive
  );
}

async function drainStoredMicAudioFrames(input: {
  meetingId: string;
  onAudioFrame?: (frame: {
    channels: number;
    endMs: number;
    frameId: string;
    pcmBytes: Uint8Array;
    sampleRate: number;
    source: TranscriptSource;
    startMs: number;
  }) => Promise<void>;
  sampleRate: number;
  spool: MicAudioSpoolHandler;
}) {
  while (true) {
    const storedFrame = await input.spool.readMicAudioSpoolFrame(
      input.meetingId,
      MIC_AUDIO_FRAME_MAX_SAMPLES * Float32Array.BYTES_PER_ELEMENT
    );
    if (!storedFrame) {
      return;
    }
    const pcmBytes = toAudioBytes(storedFrame.buffer);
    if (pcmBytes.byteLength !== storedFrame.endBytes - storedFrame.startBytes) {
      throw new Error('Microphone spool returned an incomplete audio frame.');
    }
    const frame = {
      channels: 1,
      endMs: storedFrame.endMs,
      frameId: storedFrame.frameId,
      meetingId: input.meetingId,
      pcmBytes,
      sampleRate: input.sampleRate,
      source: 'mic' as const,
      startMs: storedFrame.startMs,
    };

    await retryMeetingAudioOperation(() => postAudioFrame(frame));
    const onAudioFrame = input.onAudioFrame;
    if (onAudioFrame) {
      await retryMeetingAudioOperation(() => onAudioFrame(frame));
    }
    await input.spool.acknowledgeMicAudioSpoolFrame(
      input.meetingId,
      frame.frameId
    );
    window.dispatchEvent(
      new CustomEvent(MEETING_AUDIO_POSTED_EVENT, {
        detail: { meetingId: input.meetingId },
      })
    );
  }
}

async function startMicAudioCapture(input: {
  meetingStartedAt: number;
  meetingId: string;
  onCaptureError?: (error: Error) => void;
  onAudioFrame?: (frame: {
    channels: number;
    endMs: number;
    frameId: string;
    pcmBytes: Uint8Array;
    sampleRate: number;
    source: TranscriptSource;
    startMs: number;
  }) => Promise<void>;
  prepared?: PreparedMicAudioCapture | null;
  spool: MicAudioSpoolHandler;
}): Promise<MicAudioCapture | null> {
  const prepared = input.prepared ?? (await prepareMicAudioCapture());
  if (!prepared) return null;
  const { audioContext, stream } = prepared;
  const sampleRate = audioContext.sampleRate;
  const sourceNode = audioContext.createMediaStreamSource(stream);

  const workletUrl = URL.createObjectURL(
    new Blob([MIC_WORKLET_SOURCE], { type: 'application/javascript' })
  );
  let workletNode: AudioWorkletNode;
  try {
    await ensureMeetingAudioContextRunning(audioContext);
    await audioContext.audioWorklet.addModule(workletUrl);
    // One silent output connected to the destination keeps the node in the
    // pulled rendering graph on all implementations (the processor never
    // writes to it, so nothing is audible).
    workletNode = new AudioWorkletNode(audioContext, 'nota-mic-capture', {
      channelCount: 1,
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await audioContext.close().catch(() => {});
    throw error;
  } finally {
    URL.revokeObjectURL(workletUrl);
  }

  try {
    await input.spool.openMicAudioSpool({
      channels: 1,
      meetingId: input.meetingId,
      sampleRate,
      // Record the moment this replacement renderer actually starts writing,
      // not the earlier permission/worklet setup time. The persisted spool
      // timeline can then retain a real wall-clock gap across reloads.
      startMs: Math.max(0, Date.now() - input.meetingStartedAt),
    });
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await audioContext.close().catch(() => {});
    throw error;
  }

  const stagingChunks: Float32Array[] = [];
  let stagedSamples = 0;
  let disposed = false;
  let captureFailure: Error | null = null;
  let appendQueue: Promise<void> = Promise.resolve();
  let appendQueued = false;
  let postQueue: Promise<void> = Promise.resolve();
  let postQueued = false;

  const surfaceCaptureFailure = (error: unknown) => {
    if (captureFailure) {
      return;
    }
    captureFailure = new TerminalMicCaptureError(
      error instanceof Error ? error.message : String(error)
    );
    input.onCaptureError?.(captureFailure);
  };

  const postSpoolFrames = () =>
    drainStoredMicAudioFrames({
      meetingId: input.meetingId,
      onAudioFrame: input.onAudioFrame,
      sampleRate,
      spool: input.spool,
    });

  const queuePost = () => {
    if (postQueued) {
      return;
    }
    postQueued = true;
    postQueue = postQueue
      .then(postSpoolFrames)
      .catch(error => {
        console.warn('Microphone audio frame failed', error);
        if (!disposed) {
          window.setTimeout(() => {
            if (!disposed) {
              queuePost();
            }
          }, 1000);
        }
      })
      .finally(() => {
        postQueued = false;
      });
  };

  const appendStagedSamples = async (includePartial: boolean) => {
    while (
      stagedSamples > 0 &&
      (includePartial ||
        (stagedSamples / sampleRate) * 1000 >= MIC_AUDIO_FRAME_TARGET_MS)
    ) {
      const pending = takeMeetingAudioSamples(
        stagingChunks,
        Math.min(stagedSamples, MIC_AUDIO_FRAME_MAX_SAMPLES)
      );
      if (!pending.sampleCount) {
        break;
      }
      stagedSamples -= pending.sampleCount;
      const pcm = concatFloat32Chunks(pending.chunks, pending.sampleCount);
      await input.spool.appendMicAudioSpool(input.meetingId, float32Bytes(pcm));
      queuePost();
    }
  };

  const queueAppend = () => {
    if (appendQueued || captureFailure) {
      return;
    }
    appendQueued = true;
    appendQueue = appendQueue
      .then(() => appendStagedSamples(false))
      .catch(surfaceCaptureFailure)
      .finally(() => {
        appendQueued = false;
        if (
          !disposed &&
          !captureFailure &&
          (stagedSamples / sampleRate) * 1000 >= MIC_AUDIO_FRAME_TARGET_MS
        ) {
          queueAppend();
        }
      });
  };

  workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (disposed || captureFailure) {
      return;
    }
    const mono = event.data;
    // IPC/disk writes are normally much faster than capture. Bound this small
    // staging area so an unhealthy main process cannot recreate the old
    // unbounded renderer PCM queue.
    if (stagedSamples + mono.length > sampleRate * 2) {
      surfaceCaptureFailure(
        new Error('Microphone disk spool could not keep up with capture.')
      );
      return;
    }
    stagingChunks.push(mono);
    stagedSamples += mono.length;
    if ((stagedSamples / sampleRate) * 1000 >= MIC_AUDIO_FRAME_TARGET_MS) {
      queueAppend();
    }
  };

  sourceNode.connect(workletNode);
  workletNode.connect(audioContext.destination);
  // A replacement renderer may inherit acknowledged or in-flight disk bytes
  // before its first new microphone sample arrives.
  queuePost();

  let resourcesStopped = false;
  const stop = async () => {
    if (!resourcesStopped) {
      resourcesStopped = true;
      disposed = true;
      workletNode.port.onmessage = null;
      workletNode.disconnect();
      sourceNode.disconnect();
      stream.getTracks().forEach(track => track.stop());
      await audioContext.close().catch(() => {});
    }
    await appendQueue;
    if (!captureFailure) {
      try {
        await appendStagedSamples(true);
      } catch (error) {
        surfaceCaptureFailure(error);
      }
    }
    await input.spool.closeMicAudioSpool(input.meetingId);
    await postQueue;
    // The background pump intentionally swallows transient errors while a
    // meeting is live. Stop must retry and fail explicitly until every
    // durable frame is acknowledged. Deletion happens only after the backend
    // stop and recording metadata PATCH are both confirmed.
    await postSpoolFrames();
    if (captureFailure) {
      throw captureFailure;
    }
  };

  return {
    stop,
  };
}

async function prepareMicAudioCapture(): Promise<PreparedMicAudioCapture | null> {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioContext === 'undefined'
  ) {
    return null;
  }

  const constraints = await meetingMicrophoneConstraints(
    navigator.mediaDevices,
    environment.isMacOs
  );
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    if (!constraints.deviceId) {
      throw error;
    }
    // The preferred device can disappear between enumeration and capture.
    // Fall back to the browser default instead of blocking meeting capture.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
  }

  let audioContext: AudioContext;
  try {
    audioContext = new AudioContext();
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
  try {
    await ensureMeetingAudioContextRunning(audioContext);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await audioContext.close().catch(() => {});
    throw error;
  }
  const track = stream.getAudioTracks()[0];
  console.info('Meeting microphone route prepared', {
    label: track?.label || 'unknown',
    sampleRate: track?.getSettings().sampleRate ?? audioContext.sampleRate,
  });
  return { audioContext, stream };
}

async function disposePreparedMicAudioCapture(
  prepared: PreparedMicAudioCapture | null
) {
  if (!prepared) return;
  prepared.stream.getTracks().forEach(track => track.stop());
  await prepared.audioContext.close().catch(() => {});
}

function audioCursorToMs(cursor: number, sampleRate: number, channels: number) {
  const bytesPerFrame = Float32Array.BYTES_PER_ELEMENT * channels;
  if (!bytesPerFrame || !sampleRate) {
    return 0;
  }
  return Math.round((cursor / bytesPerFrame / sampleRate) * 1000);
}

export const Component = () => {
  const framework = useFramework();
  const desktopApi = useServiceOptional(DesktopApiService);
  const workspaceService = useService(WorkspaceService);
  const workspace = workspaceService.workspace;
  const workspaceId = workspace.id;
  const workbench = useService(WorkbenchService).workbench;
  const workspaceDialogService = useService(WorkspaceDialogService);
  const docsService = useService(DocsService);
  const calendar = useService(IntegrationService).calendar;
  const journalService = useService(JournalService);
  const meetingSettingsService = useService(MeetingSettingsService);
  const meetingSettings = useLiveData(meetingSettingsService.settings$);
  const location = useLiveData(workbench.location$);
  const [today, setToday] = useState(() => dayjs());
  const localCalendarStatus = useLiveData(calendar.localCalendarStatus$);
  const localCalendarPermission = useMemo(
    () => presentLocalCalendarPermission(localCalendarStatus),
    [localCalendarStatus]
  );
  const workspaceCalendars = useLiveData(calendar.workspaceCalendars$);
  const todayCalendarEvents = useLiveData(
    useMemo(() => calendar.eventsByDate$(today), [calendar, today])
  );
  const [artwork, setArtwork] = useState(DEFAULT_ARTWORK);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [meetingDocId, setMeetingDocId] = useState<string | null>(null);
  const [meetingProviderId, setMeetingProviderId] = useState<string | null>(
    null
  );
  const [meetingSttState, setMeetingSttState] =
    useState<MeetingSttState | null>(null);
  const [meetingState, setMeetingState] = useState<MeetingState>('idle');
  const [partialSegment, setPartialSegment] =
    useState<TranscriptSegment | null>(null);
  const [recordingError, setRecordingError] = useState('');
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(
    null
  );
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isPostTranscribing, setIsPostTranscribing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [nativeRecording, setNativeRecording] =
    useState<NativeRecordingState | null>(null);
  const [meetingPermissions, setMeetingPermissions] =
    useState<MeetingPermissionState | null>(null);
  const probeSystemAudioOnNextFocusRef = useRef(false);
  const permissionFocusRefreshRef = useRef<Promise<void> | null>(null);
  const pendingPermissionSettingsReturnRef = useRef(false);
  const [meetingPermissionBusy, setMeetingPermissionBusy] = useState(false);
  const [calendarPermissionBusy, setCalendarPermissionBusy] = useState(false);
  const [calendarEventsLoading, setCalendarEventsLoading] = useState(true);
  const [calendarEventsLoaded, setCalendarEventsLoaded] = useState(false);
  const [calendarEventsError, setCalendarEventsError] = useState('');
  const [calendarEventsWarning, setCalendarEventsWarning] = useState('');
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<
    TranscriptSegment[]
  >([]);
  const nativeRecordingCursorRef = useRef(0);
  const portableRecordingEncoderRef = useRef<OpusStreamEncoder | null>(null);
  const systemAudioPostStateRef = useRef(createMeetingAudioPostState());
  // True while the Electron main process forwards system audio directly to
  // the backend; the renderer polling loop stays off in that mode.
  const systemAudioForwardedRef = useRef(false);
  const [systemAudioForwarded, setSystemAudioForwarded] = useState(false);
  const meetingIdRef = useRef<string | null>(null);
  const meetingStateRef = useRef<MeetingState>('idle');
  const captureWatchdogRef = useRef<number | null>(null);
  const lastPostedAudioFrameAtRef = useRef<number | null>(null);
  const autoStartSearchRef = useRef<string | null>(null);
  const autoStopSearchRef = useRef<string | null>(null);
  const calendarRefreshPromiseRef =
    useRef<Promise<LocalCalendarStatus | null> | null>(null);
  const sttPreloadPromiseRef =
    useRef<Promise<MeetingSttRuntimePreloadResponse> | null>(null);
  const localMeetingDocIdsRef = useRef(new Map<string, string>());
  const localMeetingSummaryDocIdsRef = useRef(new Map<string, string>());
  const started = meetingState === 'recording' || meetingState === 'paused';
  const stopped = meetingState === 'stopped';
  const activeFlow = started || stopped || transcriptSegments.length > 0;
  const compactCover = activeFlow;
  const snippetRows = useMemo(
    () =>
      partialSegment
        ? [...transcriptSegments, partialSegment]
        : transcriptSegments,
    [partialSegment, transcriptSegments]
  );
  const liveTranscriptSupported = useMemo(
    () => providerSupportsLiveTranscript(meetingProviderId, meetingSttState),
    [meetingProviderId, meetingSttState]
  );
  const showTranscriptRows = snippetRows.length > 0;
  const showRecordingStatus =
    started && (liveTranscriptSupported || showTranscriptRows);
  const showRecordingOnlyState =
    started && !liveTranscriptSupported && !showTranscriptRows;
  const sttStatusText = useMemo(
    () => meetingSttStatusText(started, meetingSttState, meetingProviderId),
    [meetingProviderId, meetingSttState, started]
  );
  const missingMeetingPermissions = useMemo(
    () =>
      meetingPermissions
        ? MEETING_PERMISSION_TYPES.filter(type => !meetingPermissions[type])
        : [],
    [meetingPermissions]
  );
  const meetingRuntimeUnavailable =
    meetingPermissions?.runtime?.available === false;
  const showMeetingPermissionPrompt =
    !!desktopApi &&
    meetingState === 'idle' &&
    !activeFlow &&
    meetingPermissions !== null &&
    hasMeetingPermissionIssue(meetingPermissions);
  const showLocalCalendarPanel =
    !!desktopApi &&
    meetingState === 'idle' &&
    !activeFlow &&
    localCalendarStatus !== null &&
    localCalendarStatus.supported !== false;
  const showTodayCalendarEvents =
    !activeFlow &&
    (calendarEventsLoading ||
      !!calendarEventsError ||
      !!calendarEventsWarning ||
      todayCalendarEvents.length > 0 ||
      !!localCalendarStatus?.authorized ||
      workspaceCalendars.some(workspaceCalendar => workspaceCalendar.enabled));
  const preStartStatusText =
    controlBusy && !activeFlow && meetingSttState?.status === 'starting'
      ? meetingSttState.message || 'Loading meeting transcription model...'
      : '';
  const meetingSearchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search]
  );
  const selectedMeetingId = useMemo(
    () => meetingSearchParams.get('meetingId'),
    [meetingSearchParams]
  );
  const newMeetingRequested = useMemo(
    () => meetingSearchParams.get('new') === '1',
    [meetingSearchParams]
  );
  const startMeetingRequested = useMemo(
    () => meetingSearchParams.get('start') === '1',
    [meetingSearchParams]
  );
  const stopMeetingRequested = useMemo(
    () => meetingSearchParams.get('stop') === '1',
    [meetingSearchParams]
  );
  const canSummarize =
    !!meetingId &&
    stopped &&
    !controlBusy &&
    !isSaving &&
    !isSummarizing &&
    !isPostTranscribing &&
    transcriptSegments.some(segment => segment.type === 'final');
  const canSave =
    !!meetingId &&
    stopped &&
    !controlBusy &&
    !isPostTranscribing &&
    !isSaving &&
    !isSummarizing;
  const savedMeetingDocAvailable = Boolean(
    meetingDocId && workspace.docCollection.getDoc(meetingDocId)?.getStore()
  );

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

  useEffect(() => {
    meetingStateRef.current = meetingState;
  }, [meetingState]);

  const clearCaptureWatchdog = useCallback(() => {
    if (captureWatchdogRef.current !== null) {
      window.clearTimeout(captureWatchdogRef.current);
      captureWatchdogRef.current = null;
    }
  }, []);

  const clearNoAudioWarning = useCallback(() => {
    setRecordingError(current =>
      current === CAPTURE_START_NO_AUDIO_MESSAGE ? '' : current
    );
  }, []);

  const noteCaptureProgress = useCallback(() => {
    clearCaptureWatchdog();
    clearNoAudioWarning();
  }, [clearCaptureWatchdog, clearNoAudioWarning]);

  const noteAudioFramePosted = useCallback(() => {
    lastPostedAudioFrameAtRef.current = Date.now();
    noteCaptureProgress();
  }, [noteCaptureProgress]);

  const startCaptureWatchdog = useCallback(
    (id: string) => {
      clearCaptureWatchdog();
      const startedAt = Date.now();
      captureWatchdogRef.current = window.setTimeout(() => {
        captureWatchdogRef.current = null;
        if (
          meetingIdRef.current !== id ||
          meetingStateRef.current !== 'recording'
        ) {
          return;
        }
        const lastPostedAt = lastPostedAudioFrameAtRef.current;
        if (lastPostedAt && lastPostedAt >= startedAt) {
          return;
        }
        setRecordingError(current => current || CAPTURE_START_NO_AUDIO_MESSAGE);
      }, CAPTURE_START_WATCHDOG_MS);
    },
    [clearCaptureWatchdog]
  );

  useEffect(() => {
    return () => {
      clearCaptureWatchdog();
    };
  }, [clearCaptureWatchdog]);

  const {
    accessForWorkspaceDocument,
    assertCanCreateWorkspaceDocument,
    assertCanUpdateWorkspaceDocument,
  } = useMemo(
    () =>
      createMeetingSavePermissionContext({
        guardService: framework.getOptional(GuardService),
        userOwnedWorkspace: isUserOwnedWorkspaceFlavour(workspace.flavour),
      }),
    [framework, workspace.flavour]
  );

  const refreshMeetingHistory = useCallback(async () => {
    window.dispatchEvent(new CustomEvent('nota:meetings-history-refresh'));
  }, []);

  const refreshMeetingPermissions = useCallback(
    async (probeSystemAudio = false) => {
      const permissions =
        ((await desktopApi?.handler.recording.checkMeetingPermissions({
          probeSystemAudio,
        })) as MeetingPermissionState | undefined) ?? null;
      setMeetingPermissions(permissions);
      return permissions;
    },
    [desktopApi]
  );

  const openPermissionSettings = useCallback(
    async (type: MeetingPermissionType) =>
      openRecordingPermissionSettings(
        type,
        async () =>
          desktopApi?.handler.recording.showRecordingPermissionSetting(type),
        value => {
          probeSystemAudioOnNextFocusRef.current = value;
        },
        () => {
          const failure = meetingPermissionSettingsFailure(
            environment.isWindows
          );
          setRecordingError(failure.message);
          notify.warning(failure);
        }
      ),
    [desktopApi]
  );

  const requestMeetingPermissions = useCallback(async () => {
    const recording = desktopApi?.handler.recording;
    if (!recording) {
      return;
    }

    setMeetingPermissionBusy(true);
    setRecordingError('');
    try {
      const current =
        ((await recording.checkMeetingPermissions()) as
          | MeetingPermissionState
          | undefined) ?? meetingPermissions;
      const missing = current
        ? MEETING_PERMISSION_TYPES.filter(type => !current[type])
        : [...MEETING_PERMISSION_TYPES];
      for (const type of missing) {
        const status = current?.statuses?.[type];
        if (
          environment.isWindows ||
          status === 'denied' ||
          status === 'restricted'
        ) {
          continue;
        }
        await recording.askForMeetingPermission(type);
      }
      const next =
        ((await recording.checkMeetingPermissions()) as
          | MeetingPermissionState
          | undefined) ?? null;
      setMeetingPermissions(next);
      const stillMissing = next
        ? MEETING_PERMISSION_TYPES.filter(type => !next[type])
        : missing;
      if (!stillMissing.length) {
        return;
      }
      const settingsRequired = stillMissing.filter(
        type =>
          meetingPermissionRecovery(type, next, environment.isWindows)
            .requiresSettings
      );
      if (
        settingsRequired.length &&
        !(await openPermissionSettings(settingsRequired[0]))
      ) {
        return;
      }
      notify.warning({
        title: settingsRequired.length
          ? 'Meeting permissions still needed'
          : 'Meeting access not verified',
        message: meetingPermissionSummary(next, stillMissing),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingError(message);
      notify.error({ title: 'Meeting permission failed', message });
    } finally {
      setMeetingPermissionBusy(false);
    }
  }, [desktopApi, meetingPermissions, openPermissionSettings]);

  const openMeetingPermissionSettings = useCallback(async () => {
    const recording = desktopApi?.handler.recording;
    if (!recording) {
      return;
    }

    setMeetingPermissionBusy(true);
    setRecordingError('');
    try {
      const type = missingMeetingPermissions[0] ?? 'systemAudio';
      await openPermissionSettings(type);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingError(message);
      notify.error({ title: 'Meeting permission failed', message });
    } finally {
      setMeetingPermissionBusy(false);
    }
  }, [desktopApi, missingMeetingPermissions, openPermissionSettings]);

  const refreshLocalCalendar = useCallback(
    async (force = false, targetDate = today) => {
      const pending = calendarRefreshPromiseRef.current;
      if (pending) {
        if (!force) {
          return pending;
        }
        await pending.catch(() => undefined);
      }
      if (calendarRefreshPromiseRef.current) {
        return calendarRefreshPromiseRef.current;
      }

      setCalendarEventsLoading(true);
      setCalendarEventsError('');
      setCalendarEventsWarning('');
      const refresh = (async () => {
        try {
          // Refresh each source independently so an unavailable EventKit or
          // remote provider cannot suppress events from the other calendars.
          const [statusResult, accountResult, workspaceResult] =
            await Promise.allSettled([
              calendar.refreshLocalCalendarStatus(),
              calendar.loadAccountCalendars(),
              calendar.revalidateWorkspaceCalendars(),
            ]);
          const sourceRefreshResults = [
            statusResult,
            accountResult,
            workspaceResult,
          ];
          for (const result of [accountResult, workspaceResult]) {
            if (result.status === 'rejected') {
              console.warn('Calendar source refresh failed', result.reason);
            }
          }
          if (statusResult.status === 'rejected') {
            console.warn(
              'Apple Calendar status refresh failed',
              statusResult.reason
            );
          }
          const eventRefresh = await calendar.revalidateEvents(targetDate);
          if (
            sourceRefreshResults.some(result => result.status === 'rejected') ||
            eventRefresh.failedSources > 0
          ) {
            setCalendarEventsWarning(
              'Showing available events. Some calendar sources could not be refreshed.'
            );
          }
          setCalendarEventsLoaded(true);
          return statusResult.status === 'fulfilled'
            ? statusResult.value
            : null;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const hasCachedEvents =
            (calendar.eventsByDateMap$.value.get(
              targetDate.format('YYYY-MM-DD')
            )?.length ?? 0) > 0;
          setCalendarEventsError(hasCachedEvents ? '' : message);
          setCalendarEventsWarning(
            hasCachedEvents
              ? 'Showing previously loaded events. Calendar sources could not be refreshed.'
              : ''
          );
          setCalendarEventsLoaded(true);
          throw error;
        } finally {
          setCalendarEventsLoading(false);
          calendarRefreshPromiseRef.current = null;
        }
      })();
      calendarRefreshPromiseRef.current = refresh;
      return refresh;
    },
    [calendar, today]
  );

  useEffect(() => {
    return startMeetingCalendarRefresh({
      initialDay: today,
      onRefresh: ({ day, dayChanged }) => {
        if (dayChanged) {
          setToday(day);
        }
        refreshLocalCalendar(dayChanged, day).catch(() => undefined);
      },
    });
  }, [refreshLocalCalendar, today]);

  const requestLocalCalendarAccess = useCallback(async () => {
    setCalendarPermissionBusy(true);
    setRecordingError('');
    try {
      const status = await calendar.requestLocalCalendarAccess();
      if (status.authorized) {
        await refreshLocalCalendar(true);
        notify.success({ title: 'Apple Calendar connected' });
        return;
      }
      const nextPermission = presentLocalCalendarPermission(status);
      if (
        nextPermission.action === 'request-full-access' ||
        nextPermission.action === 'open-settings'
      ) {
        await calendar.openLocalCalendarSettings().catch(() => undefined);
      }
      notify.warning({
        title: nextPermission.title,
        message: nextPermission.description,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingError(message);
      notify.error({ title: 'Calendar connection failed', message });
    } finally {
      setCalendarPermissionBusy(false);
    }
  }, [calendar, refreshLocalCalendar]);

  const openCalendarSettings = useCallback(async () => {
    setCalendarPermissionBusy(true);
    setRecordingError('');
    try {
      await calendar.openLocalCalendarSettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingError(message);
      notify.error({ title: 'Calendar settings failed', message });
    } finally {
      setCalendarPermissionBusy(false);
    }
  }, [calendar]);

  const retryLocalCalendarAccess = useCallback(async () => {
    setCalendarPermissionBusy(true);
    setRecordingError('');
    try {
      const status = await calendar.refreshLocalCalendarStatus();
      if (status.authorized) {
        await refreshLocalCalendar(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingError(message);
      notify.error({ title: 'Calendar check failed', message });
    } finally {
      setCalendarPermissionBusy(false);
    }
  }, [calendar, refreshLocalCalendar]);

  const handleLocalCalendarPermissionAction = useCallback(() => {
    switch (localCalendarPermission.action) {
      case 'connect':
      case 'request-full-access':
        return requestLocalCalendarAccess();
      case 'open-settings':
        return openCalendarSettings();
      case 'retry':
        return retryLocalCalendarAccess();
      case null:
        return Promise.resolve();
    }
  }, [
    localCalendarPermission.action,
    openCalendarSettings,
    requestLocalCalendarAccess,
    retryLocalCalendarAccess,
  ]);

  const openCalendarManagement = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'workspace:integrations',
    });
  }, [workspaceDialogService]);

  const openCalendarConnectionSettings = useCallback(() => {
    workspaceDialogService.open('setting', {
      activeTab: 'meetings',
    });
  }, [workspaceDialogService]);

  const openMeetingRoute = useCallback(
    (id: string, replaceHistory = true) => {
      workbench.open(
        {
          pathname: '/meetings',
          search: `?meetingId=${encodeURIComponent(id)}`,
        },
        { at: 'active', replaceHistory }
      );
    },
    [workbench]
  );

  const openMeetingStopRoute = useCallback(
    (id: string, replaceHistory = true, intent = Date.now().toString()) => {
      const params = new URLSearchParams({
        intent,
        meetingId: id,
        stop: '1',
      });
      workbench.open(
        {
          pathname: '/meetings',
          search: `?${params.toString()}`,
        },
        { at: 'active', replaceHistory }
      );
    },
    [workbench]
  );

  const openNewMeetingRoute = useCallback(
    (replaceHistory = false) => {
      workbench.open(
        {
          pathname: '/meetings',
          search: '?new=1',
        },
        { at: 'active', replaceHistory }
      );
    },
    [workbench]
  );

  const resetMeetingDraft = useCallback(() => {
    clearCaptureWatchdog();
    setMeetingId(null);
    setMeetingDocId(null);
    meetingIdRef.current = null;
    setMeetingProviderId(null);
    setMeetingSttState(null);
    setMeetingState('idle');
    meetingStateRef.current = 'idle';
    setPartialSegment(null);
    setTranscriptSegments([]);
    setNativeRecording(null);
    setRecordingPath(null);
    setRecordingStartedAt(null);
    setRecordingSeconds(0);
    setIsPostTranscribing(false);
    setIsSaving(false);
    setIsSummarizing(false);
    setRecordingError('');
    nativeRecordingCursorRef.current = 0;
    systemAudioPostStateRef.current = createMeetingAudioPostState();
    lastPostedAudioFrameAtRef.current = null;
  }, [clearCaptureWatchdog]);

  const warnMeetingAlreadyRecording = useCallback(
    (recordingMeeting: MeetingHistoryItem) => {
      const message = 'End the current meeting before starting a new one.';
      setRecordingError(message);
      notify.warning({
        title: 'Meeting already recording',
        message,
      });
      openMeetingRoute(recordingMeeting.id, true);
    },
    [openMeetingRoute]
  );

  const requestNewMeeting = useCallback(() => {
    if (started) {
      if (meetingId) {
        warnMeetingAlreadyRecording({
          createdAt: new Date().toISOString(),
          id: meetingId,
          status: 'recording',
          updatedAt: new Date().toISOString(),
        });
      }
      return;
    }

    openNewMeetingRoute();
  }, [meetingId, openNewMeetingRoute, started, warnMeetingAlreadyRecording]);

  const stopMicCapture = useCallback(async () => {
    const starting = pendingMicAudioCapture;
    // Clearing this is the cancellation token checked before a late capture
    // can publish itself. Do not block Stop on an unresolved permission prompt;
    // a late setup owns no samples yet and is released as soon as it resolves.
    pendingMicAudioCapture = null;
    if (starting) {
      starting.promise
        .then(capture => capture?.stop())
        .catch(error =>
          console.warn('Failed to release late microphone capture', error)
        );
    }

    const owned = activeMicAudioCapture;
    activeMicAudioCapture = null;
    if (!owned) {
      return;
    }
    try {
      await owned.capture.stop();
    } catch (error) {
      // Keep the durable spool owner reachable. Meeting stop aborts before
      // backend finalization and a second Stop replays the same exact frame.
      if (!(error instanceof TerminalMicCaptureError)) {
        activeMicAudioCapture ??= owned;
      }
      throw error;
    }
  }, []);

  const startMicCaptureForMeeting = useCallback(
    async (
      id: string,
      startedAt: number,
      providerId: string | null | undefined,
      recordingState: NativeRecordingState,
      preparedMicCapture?: PreparedMicAudioCapture | null
    ) => {
      if (recordingState.status !== 'recording') {
        await disposePreparedMicAudioCapture(preparedMicCapture ?? null);
        throw new Error(
          'Microphone capture cannot start unless the native meeting recording is actively recording.'
        );
      }
      if (activeMicAudioCapture?.meetingId === id) {
        await disposePreparedMicAudioCapture(preparedMicCapture ?? null);
        return;
      }
      if (pendingMicAudioCapture?.meetingId === id) {
        await disposePreparedMicAudioCapture(preparedMicCapture ?? null);
        await pendingMicAudioCapture.promise;
        return;
      }
      try {
        await stopMicCapture();
      } catch (error) {
        await disposePreparedMicAudioCapture(preparedMicCapture ?? null);
        throw error;
      }
      const appleRecording = desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined;
      if (!supportsMicAudioSpool(appleRecording)) {
        await disposePreparedMicAudioCapture(preparedMicCapture ?? null);
        throw new Error(
          'This desktop build does not include durable microphone capture.'
        );
      }
      let appleMicStarted = false;
      const onMicAudioFrame = async (frame: {
        channels: number;
        endMs: number;
        frameId: string;
        pcmBytes: Uint8Array;
        sampleRate: number;
        source: TranscriptSource;
        startMs: number;
      }) => {
        if (providerId !== 'apple-speechanalyzer') {
          return;
        }
        if (!appleMicStarted) {
          const status = await appleRecording?.startAppleSpeechTranscription?.({
            channels: frame.channels,
            meetingId: id,
            sampleRate: frame.sampleRate,
            source: 'mic',
          });
          if (status && !status.available) {
            throw new Error(
              status.reason ?? 'Apple Speech microphone stream is unavailable.'
            );
          }
          appleMicStarted = true;
        }
        await appleRecording?.pushAppleSpeechAudioFrame?.(id, {
          channels: frame.channels,
          encoding: 'f32le',
          endMs: frame.endMs,
          frameId: frame.frameId,
          pcmBase64: bytesToBase64(frame.pcmBytes),
          sampleRate: frame.sampleRate,
          source: frame.source,
          startMs: frame.startMs,
        });
      };
      let pending: PendingMicAudioCapture | null = null;
      try {
        const capturePromise = startMicAudioCapture({
          meetingStartedAt: startedAt,
          meetingId: id,
          onCaptureError: error => {
            setRecordingError(
              `Microphone capture failed: ${error.message} Stop the meeting to preserve every recoverable frame.`
            );
          },
          onAudioFrame: onMicAudioFrame,
          prepared: preparedMicCapture,
          spool: appleRecording,
        });
        pending = { meetingId: id, promise: capturePromise };
        pendingMicAudioCapture = pending;
        const capture = await capturePromise;
        if (pendingMicAudioCapture !== pending) {
          await capture?.stop();
          return;
        }
        pendingMicAudioCapture = null;
        activeMicAudioCapture = capture ? { capture, meetingId: id } : null;
      } catch (error) {
        const captureStillExpected =
          pendingMicAudioCapture === pending &&
          meetingIdRef.current === id &&
          (meetingStateRef.current === 'recording' ||
            meetingStateRef.current === 'paused');
        if (captureStillExpected) {
          setRecordingError(
            current =>
              current ||
              `Microphone capture unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`
          );
        }
      } finally {
        if (pendingMicAudioCapture === pending) {
          pendingMicAudioCapture = null;
        }
      }
    },
    [desktopApi, stopMicCapture]
  );

  useEffect(() => {
    const onAudioPosted = (event: Event) => {
      const postedMeetingId = (event as CustomEvent<{ meetingId?: string }>)
        .detail?.meetingId;
      if (postedMeetingId === meetingIdRef.current) {
        noteAudioFramePosted();
      }
    };
    window.addEventListener(MEETING_AUDIO_POSTED_EVENT, onAudioPosted);
    return () => {
      window.removeEventListener(MEETING_AUDIO_POSTED_EVENT, onAudioPosted);
    };
  }, [noteAudioFramePosted]);

  useEffect(() => {
    const unsubscribe = desktopApi?.events.recording.onRecordingStatusChanged(
      status => {
        if (
          status?.status === 'create-block-failed' &&
          status.suppressPopup &&
          status.error
        ) {
          setRecordingError(
            `System audio capture failed: ${status.error} Stop and retry before leaving this meeting.`
          );
        }
      }
    );
    return unsubscribe;
  }, [desktopApi]);

  useEffect(() => {
    setArtwork(pickFreshArtwork(readCachedArtworkPool()));
  }, []);

  useEffect(() => {
    refreshMeetingPermissions().catch(error => {
      console.warn('Failed to check meeting permissions', error);
    });
  }, [refreshMeetingPermissions]);

  useEffect(() => {
    let disposed = false;
    const refreshWhenActive = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      if (permissionFocusRefreshRef.current) {
        pendingPermissionSettingsReturnRef.current ||=
          probeSystemAudioOnNextFocusRef.current;
        return;
      }

      pendingPermissionSettingsReturnRef.current = false;
      const probeSystemAudio = shouldProbeSystemAudioOnFocus(
        probeSystemAudioOnNextFocusRef.current
      );
      probeSystemAudioOnNextFocusRef.current = false;
      const refresh = refreshMeetingPermissions(probeSystemAudio)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          if (permissionFocusRefreshRef.current === refresh) {
            permissionFocusRefreshRef.current = null;
            if (
              !disposed &&
              pendingPermissionSettingsReturnRef.current &&
              document.visibilityState !== 'hidden' &&
              document.hasFocus()
            ) {
              refreshWhenActive();
            }
          }
        });
      permissionFocusRefreshRef.current = refresh;
    };

    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [refreshMeetingPermissions]);

  useEffect(() => {
    refreshLocalCalendar().catch(error => {
      console.warn('Failed to refresh local calendar', error);
    });
  }, [refreshLocalCalendar]);

  const preloadMeetingSttRuntime = useCallback(() => {
    if (sttPreloadPromiseRef.current) {
      return sttPreloadPromiseRef.current;
    }

    const preload = jsonRequest<MeetingSttRuntimePreloadResponse>(
      '/v1/stt/runtime/preload',
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    )
      .then(data => {
        console.info('Meeting STT runtime preload', data.preload);
        return data;
      })
      .finally(() => {
        sttPreloadPromiseRef.current = null;
      });
    sttPreloadPromiseRef.current = preload;
    return preload;
  }, []);

  useEffect(() => {
    if (activeFlow || controlBusy) {
      return;
    }

    let disposed = false;
    let timeoutId: number | undefined;
    const schedulePreload = (attempt: number) => {
      timeoutId = window.setTimeout(() => {
        preloadMeetingSttRuntime().catch(error => {
          if (disposed) {
            return;
          }
          const nextAttempt = attempt + 1;
          if (nextAttempt < STT_PRELOAD_RETRY_DELAYS_MS.length) {
            schedulePreload(nextAttempt);
            return;
          }
          console.warn('Failed to preload meeting STT runtime', error);
        });
      }, STT_PRELOAD_RETRY_DELAYS_MS[attempt]);
    };
    schedulePreload(0);

    return () => {
      disposed = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeFlow, controlBusy, preloadMeetingSttRuntime]);

  useEffect(() => {
    if (!started || !recordingStartedAt) {
      return;
    }

    const updateElapsedTime = () => {
      setRecordingSeconds(
        Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000))
      );
    };
    updateElapsedTime();
    const intervalId = window.setInterval(updateElapsedTime, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [recordingStartedAt, started]);

  const reserveMeetingSession = useCallback(async () => {
    await (
      desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined
    )?.setupAppleSpeechBridge?.();
    const data = await jsonRequest<MeetingSessionResponse>(
      '/v1/meetings/reserve',
      {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
      }
    );
    assertMeetingWorkspace(data.meeting, workspaceId);
    return data.meeting;
  }, [desktopApi, workspaceId]);

  const createMeetingSession = useCallback(
    async (input: { meetingId: string; resume?: boolean }) => {
      const data = await jsonRequest<MeetingSessionResponse>(
        '/v1/meetings/start',
        {
          method: 'POST',
          body: JSON.stringify({
            meetingId: input.meetingId,
            resume: input.resume === true,
            workspaceId,
          }),
        }
      );
      assertMeetingWorkspace(data.meeting, workspaceId);
      setMeetingId(data.meeting.id);
      setMeetingDocId(data.meeting.docId ?? null);
      openMeetingRoute(data.meeting.id, true);
      setMeetingProviderId(data.meeting.providerId ?? null);
      setMeetingSttState(data.meeting.stt ?? null);
      setPartialSegment(data.meeting.partialSegment ?? null);
      setTranscriptSegments(data.meeting.transcriptSegments ?? []);
      await refreshMeetingHistory();
      return data.meeting;
    },
    [openMeetingRoute, refreshMeetingHistory, workspaceId]
  );

  const releaseNativeRecording = useCallback(
    async (recordingId: number, targetMeetingId?: string) => {
      await (
        desktopApi?.handler.recording.removeRecording as unknown as (
          recordingId: number,
          meetingId?: string
        ) => Promise<unknown>
      )?.(recordingId, targetMeetingId);
    },
    [desktopApi]
  );

  const closePortableRecordingEncoder = useCallback(() => {
    const encoder = portableRecordingEncoderRef.current;
    portableRecordingEncoderRef.current = null;
    try {
      encoder?.close();
    } catch (error) {
      console.warn('Failed to close portable meeting encoder', error);
    }
  }, []);

  const beginPortableRecordingEncoding = useCallback(
    (recording: NativeRecordingState) => {
      closePortableRecordingEncoder();
      const encoder = createStreamEncoder(recording.id, {
        numberOfChannels: recording.numberOfChannels,
        sampleRate: recording.sampleRate,
      });
      portableRecordingEncoderRef.current = encoder;
      encoder.poll().catch(error => {
        // The raw archive remains canonical recovery input. Stop retries the
        // bounded reader from byte zero if live encoding is interrupted.
        console.warn('Portable meeting encoding paused', error);
      });
    },
    [closePortableRecordingEncoder]
  );

  const finalizePortableRecording = useCallback(
    async (recording: NativeRecordingState | null) => {
      const handler = desktopApi?.handler.recording;
      if (!handler) {
        if (recording?.filepath && isRawMeetingRecording(recording.filepath)) {
          throw new Error(
            'This desktop build cannot create a portable meeting attachment.'
          );
        }
        return recording?.filepath ?? null;
      }

      return ensurePortableMeetingRecording({
        encode: async format => {
          let encoder = portableRecordingEncoderRef.current;
          if (!encoder || encoder.id !== format.id) {
            closePortableRecordingEncoder();
            encoder = createStreamEncoder(format.id, {
              numberOfChannels: format.numberOfChannels,
              sampleRate: format.sampleRate,
            });
            portableRecordingEncoderRef.current = encoder;
          }
          try {
            return await encoder.finish();
          } finally {
            if (portableRecordingEncoderRef.current === encoder) {
              portableRecordingEncoderRef.current = null;
            }
          }
        },
        persistEncoded: (recordingId, buffer) =>
          handler.readyRecording(recordingId, buffer),
        readCurrent: async () =>
          (await handler.getCurrentRecording()) as NativeRecordingStatus | null,
        recording,
      });
    },
    [closePortableRecordingEncoder, desktopApi]
  );

  const finalizePortableMicRecording = useCallback(
    async (targetMeetingId: string) => {
      const handler = desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined;
      if (!supportsMicAudioExport(handler)) {
        throw new Error(
          'This desktop build cannot create a portable microphone attachment.'
        );
      }
      return finalizePortableMeetingMicRecording(handler, targetMeetingId);
    },
    [desktopApi]
  );

  useEffect(
    () => closePortableRecordingEncoder,
    [closePortableRecordingEncoder]
  );

  const syncCurrentNativeRecording = useCallback(
    async (options: { includeTerminal?: boolean } = {}) => {
      const recording = desktopApi?.handler.recording;
      if (!recording) {
        return null;
      }

      const current =
        (await recording.getCurrentRecording()) as NativeRecordingStatus | null;
      const terminalStatuses = new Set([
        'stopped',
        'ready',
        'create-block-success',
        'create-block-failed',
      ]);
      if (
        !current ||
        (!isActiveNativeMeetingRecording(current) &&
          (!options.includeTerminal || !terminalStatuses.has(current.status)))
      ) {
        setNativeRecording(null);
        nativeRecordingCursorRef.current = 0;
        return null;
      }
      if (
        current.recovered &&
        current.filepath &&
        isRawMeetingRecording(current.filepath) &&
        (!current.numberOfChannels || !current.sampleRate)
      ) {
        throw new Error(
          'Recovered system audio is preserved, but its native audio format was not journaled before the crash.'
        );
      }

      const state = {
        archiveBytes: current.archiveBytes,
        cursor: 0,
        filepath: current.filepath ?? null,
        id: current.id,
        meetingId: current.meetingId,
        numberOfChannels: current.numberOfChannels ?? 2,
        recovered: current.recovered,
        sampleRate: current.sampleRate ?? 48000,
        startTime: current.startTime,
        status: current.status,
        workspaceId: current.workspaceId,
      };
      nativeRecordingCursorRef.current = state.cursor;
      setNativeRecording(state);

      if (current.startTime && current.startTime > 0) {
        setRecordingStartedAt(current.startTime);
        setRecordingSeconds(
          Math.max(0, Math.floor((Date.now() - current.startTime) / 1000))
        );
      }

      return state;
    },
    [desktopApi]
  );

  const finalizeConfirmedCapture = useCallback(
    async (input: {
      fallbackDurationMs?: number | null;
      meetingId: string;
      recording: NativeRecordingState | null;
      recordingCursor: number;
      recordingPath?: string | null;
      startedAt: number | null;
      stoppedAt: number;
    }) => {
      const recordingHandler = desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined;
      const cursorDurationMs = input.recording
        ? audioCursorToMs(
            Math.max(input.recordingCursor, input.recording.archiveBytes ?? 0),
            input.recording.sampleRate,
            input.recording.numberOfChannels
          )
        : null;
      const clockDurationMs = input.startedAt
        ? Math.max(0, input.stoppedAt - input.startedAt)
        : null;
      const durationMs =
        cursorDurationMs && cursorDurationMs > 0
          ? cursorDurationMs
          : (input.fallbackDurationMs ?? clockDurationMs);
      const recordingForEncoding = input.recording
        ? {
            ...input.recording,
            filepath:
              input.recordingPath ?? input.recording.filepath ?? undefined,
          }
        : null;
      const recordingPath =
        await finalizePortableRecording(recordingForEncoding);
      const microphoneRecordingPath = await finalizePortableMicRecording(
        input.meetingId
      );
      if (recordingPath) {
        setRecordingPath(recordingPath);
      }

      await finalizeConfirmedMeetingCapture({
        finishMicSpool: async () => {
          if (
            !recordingHandler?.closeMicAudioSpool ||
            !recordingHandler.finishMicAudioSpool
          ) {
            throw new Error(
              'This desktop build cannot finalize its durable microphone capture.'
            );
          }
          // Renderer reload can destroy media tracks before the capture object
          // gets a chance to mark its journal closed. Closing is idempotent;
          // finish still refuses deletion if any frame remains unacknowledged.
          await recordingHandler.closeMicAudioSpool(input.meetingId);
          await recordingHandler.finishMicAudioSpool(input.meetingId);
        },
        persistRecordingMetadata: async () => {
          const data = await jsonRequest<MeetingSessionResponse>(
            `/v1/meetings/${input.meetingId}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                recordingDurationMs: durationMs,
                recordingPath,
                microphoneRecordingPath,
              }),
            }
          );
          assertMeetingWorkspace(data.meeting, workspaceId);
          setRecordingSeconds(meetingDurationSeconds(data.meeting));
          setRecordingStartedAt(null);
        },
        releaseNativeRecording: async () => {
          if (input.recording) {
            await releaseNativeRecording(input.recording.id, input.meetingId);
          }
        },
      });
      clearNativeMeetingCaptureOwner(
        workspaceId,
        input.meetingId,
        input.recording?.id
      );
    },
    [
      desktopApi,
      finalizePortableMicRecording,
      finalizePortableRecording,
      releaseNativeRecording,
      workspaceId,
    ]
  );

  const startNativeRecording = useCallback(
    async (ownership: {
      meetingId: string;
      workspaceId: string;
      microphoneAcquired: boolean;
    }) => {
      const recording = desktopApi?.handler.recording;
      if (!recording) {
        throw new Error('Desktop recording is unavailable.');
      }

      const runtimeStatus = await (
        recording as typeof recording & RecordingHandlerWithRuntimeStatus
      ).getRecordingRuntimeStatus?.();
      if (runtimeStatus && !runtimeStatus.available) {
        throw new Error(
          runtimeStatus.reason ?? 'Meeting recording runtime is unavailable.'
        );
      }

      const available = await recording.checkRecordingAvailable();
      if (!available) {
        throw new Error('Meeting recording is unavailable on this device.');
      }

      const permissions = (await recording.checkMeetingPermissions({
        forceSystemAudioProbe: true,
      })) as MeetingPermissionState | undefined;
      setMeetingPermissions(permissions ?? null);
      if (permissions) {
        for (const type of MEETING_PERMISSION_TYPES) {
          const status = permissions.statuses?.[type];
          if (
            !permissions[type] &&
            type !== 'systemAudio' &&
            status !== 'denied' &&
            status !== 'restricted'
          ) {
            await recording.askForMeetingPermission(type);
          }
        }

        const nextPermissions = (await recording.checkMeetingPermissions()) as
          | MeetingPermissionState
          | undefined;
        setMeetingPermissions(nextPermissions ?? null);
        const missingPermissions = nextPermissions
          ? MEETING_PERMISSION_TYPES.filter(type =>
              isMeetingPermissionBlocking(
                type,
                nextPermissions,
                environment.isWindows,
                ownership.microphoneAcquired
              )
            )
          : [];
        if (missingPermissions.length) {
          throw new Error(
            meetingPermissionSummary(
              nextPermissions ?? null,
              missingPermissions
            )
          );
        }
      }

      const existing =
        (await recording.getCurrentRecording()) as NativeRecordingStatus | null;
      if (
        existing &&
        new Set([
          'stopped',
          'ready',
          'create-block-success',
          'create-block-failed',
        ]).has(existing.status)
      ) {
        const captureOwner = readNativeMeetingCaptureOwner();
        const recoveryMeetingId =
          existing.meetingId ??
          (captureOwner?.recordingId === existing.id
            ? captureOwner.meetingId
            : null);
        if (recoveryMeetingId) {
          throw new Error(
            `The previous meeting capture still needs finalization. Open meeting ${recoveryMeetingId} and retry Stop before starting a new one.`
          );
        }
        try {
          await releaseNativeRecording(existing.id, existing.meetingId);
        } catch (error) {
          throw new Error(
            `The previous meeting capture could not be released. Retry Start after Nota finishes cleanup. ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const current = await syncCurrentNativeRecording();
      if (current) {
        throw new Error(
          'Another native recording is already active. Stop or recover it before starting a new meeting.'
        );
      }

      const setupSuccessful = await recording.setupRecordingFeature();
      if (!setupSuccessful) {
        const nextRuntimeStatus = await (
          recording as typeof recording & RecordingHandlerWithRuntimeStatus
        ).getRecordingRuntimeStatus?.();
        throw new Error(
          nextRuntimeStatus?.reason ||
            'Meeting recording is disabled. Enable it in Meeting Settings, then try again.'
        );
      }

      const startRecordingWithOptions =
        recording.startRecording as unknown as NonNullable<
          RecordingHandlerWithStartOptions['startRecording']
        >;
      const status = await startRecordingWithOptions(undefined, {
        meetingId: ownership.meetingId,
        suppressPopup: true,
        workspaceId: ownership.workspaceId,
      });
      if (!status || status.status !== 'recording') {
        throw new Error('Failed to start meeting recording.');
      }

      const state = {
        archiveBytes: status.archiveBytes,
        cursor: 0,
        filepath: status.filepath ?? null,
        id: status.id,
        meetingId: ownership.meetingId,
        numberOfChannels: status.numberOfChannels ?? 2,
        sampleRate: status.sampleRate ?? 48000,
        startTime: status.startTime,
        status: status.status,
        workspaceId: ownership.workspaceId,
      };
      nativeRecordingCursorRef.current = state.cursor;
      setNativeRecording(state);
      return state;
    },
    [desktopApi, releaseNativeRecording, syncCurrentNativeRecording]
  );

  const startSystemAudioForward = useCallback(
    async (input: {
      fromByte?: number;
      meetingId: string;
      recording: NativeRecordingState;
    }) => {
      const handler = desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined;
      if (!handler?.startMeetingAudioForward) {
        return false;
      }
      try {
        const result = await handler.startMeetingAudioForward({
          channels: input.recording.numberOfChannels,
          fromByte: input.fromByte,
          meetingId: input.meetingId,
          recordingId: input.recording.id,
          sampleRate: input.recording.sampleRate,
        });
        if (result?.active) {
          systemAudioForwardedRef.current = true;
          setSystemAudioForwarded(true);
          return true;
        }
      } catch (error) {
        console.warn('Main-process audio forwarding unavailable', error);
      }
      return false;
    },
    [desktopApi]
  );

  const stopSystemAudioForward = useCallback(
    async (meetingId: string) => {
      if (!systemAudioForwardedRef.current) {
        return null;
      }
      systemAudioForwardedRef.current = false;
      setSystemAudioForwarded(false);
      const handler = desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined;
      try {
        // Drains queued audio into the backend before returning, so the
        // meeting stop request sees the trailing frames.
        const result = await handler?.stopMeetingAudioForward?.(meetingId);
        if (
          result &&
          typeof result.archive === 'number' &&
          typeof result.complete === 'boolean' &&
          typeof result.cursor === 'number'
        ) {
          return result;
        }
        return {
          archive: 0,
          complete: false,
          cursor: 0,
          reason: 'Main-process audio drain returned no acknowledgement.',
        } satisfies AudioForwardDrainResult;
      } catch (error) {
        console.warn('Failed to stop audio forwarding', error);
        return {
          archive: 0,
          complete: false,
          cursor: 0,
          reason: error instanceof Error ? error.message : String(error),
        } satisfies AudioForwardDrainResult;
      }
    },
    [desktopApi]
  );

  const postNativeRecordingAudio = useCallback(
    async (input: {
      cursor?: number;
      meetingId: string;
      recording: NativeRecordingState;
      requireComplete?: boolean;
    }) => {
      if (!desktopApi) {
        return input.cursor ?? input.recording.cursor;
      }

      return drainMeetingAudioArchive({
        hasPendingRetry: () =>
          systemAudioPostStateRef.current.retryFrame !== null,
        onProgress: noteAudioFramePosted,
        post: (pcmBytes, startCursor) =>
          postSystemAudioBuffer({
            channels: input.recording.numberOfChannels,
            meetingId: input.meetingId,
            pcmBytes,
            sampleRate: input.recording.sampleRate,
            startCursor,
            state: systemAudioPostStateRef.current,
          }),
        read: async cursor => {
          const { buffer, nextCursor } =
            await desktopApi.handler.recording.getRawAudioBuffers(
              input.recording.id,
              cursor
            );
          return { nextCursor, pcmBytes: toAudioBytes(buffer) };
        },
        requireComplete: input.requireComplete,
        startCursor: input.cursor ?? input.recording.cursor,
      });
    },
    [desktopApi, noteAudioFramePosted]
  );

  const startMeeting = useCallback(async () => {
    if (
      controlBusy ||
      meetingState === 'recording' ||
      meetingState === 'paused'
    ) {
      return;
    }

    setControlBusy(true);
    try {
      setRecordingError('');
      const recordingMeeting = await activeRecordingMeeting();
      if (recordingMeeting) {
        if (recordingMeeting.workspaceId === workspaceId) {
          warnMeetingAlreadyRecording(recordingMeeting);
        } else {
          setRecordingError(
            'Another meeting is already recording in a different workspace. Stop it there before starting this meeting so Nota never splits one native capture across two transcripts.'
          );
        }
        return;
      }

      setPartialSegment(null);
      setTranscriptSegments([]);
      setMeetingDocId(null);
      setNativeRecording(null);
      setRecordingPath(null);
      setMeetingSttState(null);
      setRecordingStartedAt(null);
      setRecordingSeconds(0);
      setIsPostTranscribing(false);
      await stopMicCapture();
      clearCaptureWatchdog();
      lastPostedAudioFrameAtRef.current = null;
      nativeRecordingCursorRef.current = 0;
      systemAudioPostStateRef.current = createMeetingAudioPostState();
      systemAudioForwardedRef.current = false;
      setSystemAudioForwarded(false);
      let nextMeetingId: string | null = null;
      let preparedMicCapture: PreparedMicAudioCapture | null = null;
      let recordingState: NativeRecordingState | null = null;
      try {
        setMeetingSttState({
          message: 'Reserving durable meeting capture...',
          status: 'starting',
        });
        const reservation = await reserveMeetingSession();
        nextMeetingId = reservation.id;
        // Acquire the microphone before opening the Core Audio system tap.
        // Bluetooth headsets can switch the whole Mac from high-quality
        // playback to a lower-rate call profile when their microphone opens.
        // Starting the native tap after that route settles keeps its journaled
        // sample rate aligned with every callback for the whole meeting.
        preparedMicCapture = await prepareMicAudioCapture();
        recordingState = await startNativeRecording({
          meetingId: reservation.id,
          workspaceId,
          microphoneAcquired:
            preparedMicCapture?.stream
              .getAudioTracks()
              .some(track => track.readyState === 'live') ?? false,
        });
        writeNativeMeetingCaptureOwner(workspaceId, {
          meetingId: reservation.id,
          recordingId: recordingState.id,
        });
        const startedAt = recordingState.startTime ?? Date.now();
        setRecordingStartedAt(startedAt);
        setMeetingState('recording');
        setMeetingSttState({
          message: 'Recording while meeting transcription loads...',
          status: 'starting',
        });
        preloadMeetingSttRuntime().catch(error => {
          console.warn('Failed to preload meeting STT runtime', error);
        });
        setMeetingSttState({
          message: 'Starting meeting session...',
          status: 'starting',
        });
        const meeting = await createMeetingSession({
          meetingId: reservation.id,
        });
        try {
          beginPortableRecordingEncoding(recordingState);
        } catch (error) {
          // Capture and transcription remain live. Finalization retries the
          // encoder from the durable raw archive before saving the note.
          console.warn('Failed to start portable meeting encoding', error);
        }
        meetingIdRef.current = meeting.id;
        meetingStateRef.current = 'recording';
        startCaptureWatchdog(meeting.id);
        // Prefer the main-process push transport; its archive backfill covers
        // audio captured before the meeting session existed. The renderer
        // polling loop remains as fallback for older desktop builds.
        const forwarded = await startSystemAudioForward({
          fromByte: 0,
          meetingId: meeting.id,
          recording: recordingState,
        });
        if (!forwarded) {
          const nextCursor = await postNativeRecordingAudio({
            cursor: 0,
            meetingId: meeting.id,
            recording: recordingState,
          });
          nativeRecordingCursorRef.current = nextCursor;
          setNativeRecording(state =>
            state && state.id === recordingState?.id
              ? { ...state, cursor: nextCursor }
              : state
          );
        }
        if (meeting.providerId === 'apple-speechanalyzer') {
          const recording = desktopApi?.handler.recording as
            | RecordingHandlerWithRuntimeStatus
            | undefined;
          await recording?.startAppleSpeechTranscription?.({
            channels: recordingState.numberOfChannels,
            meetingId: meeting.id,
            recordingId: recordingState.id,
            sampleRate: recordingState.sampleRate,
            source: 'system',
          });
        }
        const preparedCapture = preparedMicCapture;
        preparedMicCapture = null;
        void startMicCaptureForMeeting(
          meeting.id,
          startedAt,
          meeting.providerId,
          recordingState,
          preparedCapture
        ).catch(console.error);
      } catch (error) {
        await disposePreparedMicAudioCapture(preparedMicCapture);
        setMeetingState('idle');
        setMeetingId(null);
        setMeetingDocId(null);
        meetingIdRef.current = null;
        meetingStateRef.current = 'idle';
        setMeetingProviderId(null);
        setMeetingSttState(null);
        setNativeRecording(null);
        setRecordingStartedAt(null);
        setRecordingSeconds(0);
        setIsPostTranscribing(false);
        clearCaptureWatchdog();
        nativeRecordingCursorRef.current = 0;
        if (recordingState?.id != null && desktopApi) {
          await desktopApi.handler.recording
            .stopRecording(recordingState.id)
            .catch(console.error);
        }
        closePortableRecordingEncoder();
        if (nextMeetingId) {
          await stopSystemAudioForward(nextMeetingId).catch(console.error);
          await jsonRequest<MeetingSessionResponse>(
            `/v1/meetings/${nextMeetingId}/stop`,
            {
              method: 'POST',
              body: JSON.stringify({}),
            }
          ).catch(console.error);
        }
        stopMicCapture().catch(console.error);
        setRecordingError(
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      setControlBusy(false);
    }
  }, [
    controlBusy,
    beginPortableRecordingEncoding,
    closePortableRecordingEncoder,
    createMeetingSession,
    clearCaptureWatchdog,
    desktopApi,
    meetingState,
    postNativeRecordingAudio,
    preloadMeetingSttRuntime,
    reserveMeetingSession,
    startMicCaptureForMeeting,
    startCaptureWatchdog,
    startNativeRecording,
    startSystemAudioForward,
    stopMicCapture,
    stopSystemAudioForward,
    warnMeetingAlreadyRecording,
    workspaceId,
  ]);

  const stopMeeting = useCallback(async () => {
    if (controlBusy) {
      return;
    }

    setControlBusy(true);
    try {
      const stoppedAt = Date.now();
      clearCaptureWatchdog();
      let stoppedNativeRecording = nativeRecording;
      if (!stoppedNativeRecording) {
        try {
          stoppedNativeRecording = await syncCurrentNativeRecording({
            includeTerminal: true,
          });
        } catch (error) {
          setRecordingError(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      const stoppedRecordingStartedAt =
        recordingStartedAt ?? stoppedNativeRecording?.startTime ?? null;
      const nativeWasActiveAtStop = isActiveNativeMeetingRecording(
        stoppedNativeRecording
      );
      const recordingId = stoppedNativeRecording?.id;
      const stoppedMeetingId = meetingId;
      let finalRecordingCursor = Math.max(
        nativeRecordingCursorRef.current,
        stoppedNativeRecording?.cursor ?? 0
      );
      let stoppedRecording: NativeRecordingStatus | null = null;
      let captureWarning = '';
      const postPendingSystemAudio = async () => {
        if (systemAudioForwardedRef.current) {
          if (!stoppedMeetingId) {
            return;
          }
          const drain = await stopSystemAudioForward(stoppedMeetingId);
          if (drain?.complete) {
            if (drain.cursor > finalRecordingCursor) {
              noteAudioFramePosted();
            }
            finalRecordingCursor = Math.max(finalRecordingCursor, drain.cursor);
            nativeRecordingCursorRef.current = finalRecordingCursor;
            return;
          }

          if (recordingId == null || !desktopApi || !stoppedNativeRecording) {
            throw new Error(
              drain?.reason ??
                'System audio could not be fully delivered to transcription.'
            );
          }

          const fallbackCursor = Math.max(0, drain?.cursor ?? 0);
          try {
            const nextCursor = await postNativeRecordingAudio({
              cursor: fallbackCursor,
              meetingId: stoppedMeetingId,
              recording: stoppedNativeRecording,
              requireComplete: true,
            });
            const expectedArchiveCursor = drain?.archive ?? 0;
            finalRecordingCursor = Math.max(finalRecordingCursor, nextCursor);
            nativeRecordingCursorRef.current = finalRecordingCursor;
            if (nextCursor < expectedArchiveCursor) {
              throw new Error(
                `System audio recovery stopped at byte ${nextCursor} of ${expectedArchiveCursor}. ${
                  drain?.reason ?? ''
                }`.trim()
              );
            }
          } catch (error) {
            throw new Error(
              `System audio recovery failed from byte ${fallbackCursor}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
          return;
        }
        if (
          recordingId == null ||
          !desktopApi ||
          !stoppedMeetingId ||
          !stoppedNativeRecording
        ) {
          return;
        }
        const previousCursor = finalRecordingCursor;
        const nextCursor = await postNativeRecordingAudio({
          cursor: previousCursor,
          meetingId: stoppedMeetingId,
          recording: stoppedNativeRecording,
          requireComplete: true,
        });
        finalRecordingCursor = Math.max(finalRecordingCursor, nextCursor);
        nativeRecordingCursorRef.current = finalRecordingCursor;
      };
      try {
        // Flushes the renderer queue before the backend stop request so the
        // final microphone words are included in transcription.
        await stopMicCapture();
      } catch (error) {
        if (error instanceof TerminalMicCaptureError) {
          captureWarning = `Microphone capture ended early after a local spool error. Nota preserved every recoverable frame. ${error.message}`;
        } else {
          setRecordingError(
            `Microphone audio is still waiting to be saved. Retry Stop before leaving this meeting. ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          setIsPostTranscribing(false);
          return;
        }
      }
      if (stoppedRecordingStartedAt) {
        setRecordingSeconds(
          Math.max(
            0,
            Math.floor((stoppedAt - stoppedRecordingStartedAt) / 1000)
          )
        );
      }
      setIsPostTranscribing(true);
      if (
        recordingId != null &&
        desktopApi &&
        isActiveNativeMeetingRecording(stoppedNativeRecording)
      ) {
        try {
          stoppedRecording =
            ((await desktopApi.handler.recording.stopRecording(
              recordingId
            )) as NativeRecordingStatus | null) ?? null;
          if (
            !stoppedRecording ||
            isActiveNativeMeetingRecording(stoppedRecording)
          ) {
            throw new Error(
              'Native meeting capture did not reach a finalized state.'
            );
          }
          const finalizedNativeRecording: NativeRecordingState = {
            ...stoppedNativeRecording,
            archiveBytes:
              stoppedRecording.archiveBytes ??
              stoppedNativeRecording.archiveBytes,
            filepath:
              stoppedRecording.filepath ?? stoppedNativeRecording.filepath,
            numberOfChannels:
              stoppedRecording.numberOfChannels ??
              stoppedNativeRecording.numberOfChannels,
            sampleRate:
              stoppedRecording.sampleRate ?? stoppedNativeRecording.sampleRate,
            startTime:
              stoppedRecording.startTime ?? stoppedNativeRecording.startTime,
            status: stoppedRecording.status,
          };
          stoppedNativeRecording = finalizedNativeRecording;
          setNativeRecording(finalizedNativeRecording);
          const nextRecordingPath =
            stoppedRecording?.filepath ?? stoppedNativeRecording?.filepath;
          if (nextRecordingPath) {
            setRecordingPath(nextRecordingPath);
          }
          if (stoppedRecording?.error) {
            captureWarning = `System audio capture ended with a local archive error. Nota preserved every recoverable frame. ${stoppedRecording.error}`;
          }
        } catch (error) {
          setRecordingError(
            `Native meeting capture is still finalizing. Retry Stop before leaving this meeting. ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          setIsPostTranscribing(false);
          return;
        }
      }
      // Always reconcile main-process acknowledgements with the finalized raw
      // archive before asking the backend to stop the meeting.
      try {
        await postPendingSystemAudio();
      } catch (error) {
        setRecordingError(
          `System audio is still waiting to be saved. Retry Stop before leaving this meeting. ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        setIsPostTranscribing(false);
        return;
      }
      if (
        stoppedMeetingId &&
        meetingProviderId === 'apple-speechanalyzer' &&
        desktopApi
      ) {
        try {
          const appleSpeechStopped =
            await desktopApi.handler.recording.stopAppleSpeechTranscription(
              stoppedMeetingId
            );
          if (!appleSpeechStopped && nativeWasActiveAtStop) {
            throw new Error(
              'No Apple Speech session was available to drain. The meeting remains recoverable.'
            );
          }
        } catch (error) {
          setRecordingError(
            `Apple Speech is still finalizing. Retry Stop before leaving this meeting. ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          setIsPostTranscribing(false);
          return;
        }
      }
      if (!stoppedMeetingId) {
        setRecordingError(
          'Audio capture ended locally, but the meeting session is missing. Keep this screen open and retry Stop so Nota can preserve the capture.'
        );
        setIsPostTranscribing(false);
        return;
      }
      try {
        const data = await jsonRequest<MeetingSessionResponse>(
          `/v1/meetings/${stoppedMeetingId}/stop`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        );
        assertMeetingWorkspace(data.meeting, workspaceId);
        await finalizeConfirmedCapture({
          fallbackDurationMs: data.meeting.recordingDurationMs,
          meetingId: stoppedMeetingId,
          recording: stoppedNativeRecording,
          recordingCursor: finalRecordingCursor,
          recordingPath:
            stoppedRecording?.filepath ?? stoppedNativeRecording?.filepath,
          startedAt: stoppedRecordingStartedAt,
          stoppedAt,
        });
        persistPendingMeetingSave(workspaceId, data.meeting.id);
        setNativeRecording(null);
        nativeRecordingCursorRef.current = 0;
        setRecordingStartedAt(null);
        setMeetingState('stopped');
        meetingStateRef.current = 'stopped';
        setMeetingId(data.meeting.id);
        setMeetingDocId(data.meeting.docId ?? null);
        openMeetingRoute(data.meeting.id, true);
        setPartialSegment(data.meeting.partialSegment ?? null);
        setMeetingSttState(data.meeting.stt ?? null);
        const nextSegments = data.meeting.transcriptSegments ?? [];
        setTranscriptSegments(nextSegments);
        const sttStatus = data.meeting.stt?.status;
        setIsPostTranscribing(isMeetingTranscriptionPending(sttStatus));
        await refreshMeetingHistory();
        setRecordingError(captureWarning);
      } catch (error) {
        const stopError =
          error instanceof Error ? error.message : String(error);
        let recoveryError = '';
        try {
          const recovered = await jsonRequest<MeetingSessionResponse>(
            `/v1/meetings/${stoppedMeetingId}`
          );
          assertMeetingWorkspace(recovered.meeting, workspaceId);
          if (recovered.meeting.status === 'stopped') {
            await finalizeConfirmedCapture({
              fallbackDurationMs: recovered.meeting.recordingDurationMs,
              meetingId: stoppedMeetingId,
              recording: stoppedNativeRecording,
              recordingCursor: finalRecordingCursor,
              recordingPath:
                stoppedRecording?.filepath ?? stoppedNativeRecording?.filepath,
              startedAt: stoppedRecordingStartedAt,
              stoppedAt,
            });
            persistPendingMeetingSave(workspaceId, recovered.meeting.id);
            setNativeRecording(null);
            nativeRecordingCursorRef.current = 0;
            setRecordingStartedAt(null);
            setMeetingState('stopped');
            meetingStateRef.current = 'stopped';
            setMeetingId(recovered.meeting.id);
            setMeetingDocId(recovered.meeting.docId ?? null);
            setPartialSegment(recovered.meeting.partialSegment ?? null);
            setMeetingSttState(recovered.meeting.stt ?? null);
            setTranscriptSegments(recovered.meeting.transcriptSegments ?? []);
            const transcriptWarning =
              recovered.meeting.stt?.status === 'error'
                ? `Meeting stopped, but transcription finished with an error. The captured audio and available transcript were preserved. ${recovered.meeting.stt.message ?? stopError}`
                : '';
            setRecordingError(
              [transcriptWarning, captureWarning].filter(Boolean).join(' ')
            );
            setIsPostTranscribing(
              isMeetingTranscriptionPending(recovered.meeting.stt?.status)
            );
            await refreshMeetingHistory();
            return;
          }
        } catch (error) {
          recoveryError =
            error instanceof Error ? error.message : String(error);
          // Keep the locally stopped capture recoverable and let Stop retry
          // once the loopback backend is reachable again.
        }
        setRecordingError(
          `Audio capture ended locally, but Nota could not confirm every meeting finalization step. Retry Stop to preserve the transcript and local recording. ${[
            stopError,
            recoveryError,
          ]
            .filter(Boolean)
            .join(' ')}`
        );
        setIsPostTranscribing(false);
      }
    } finally {
      setControlBusy(false);
    }
  }, [
    controlBusy,
    clearCaptureWatchdog,
    desktopApi,
    finalizeConfirmedCapture,
    meetingId,
    meetingProviderId,
    nativeRecording,
    openMeetingRoute,
    postNativeRecordingAudio,
    recordingStartedAt,
    noteAudioFramePosted,
    refreshMeetingHistory,
    stopMicCapture,
    stopSystemAudioForward,
    syncCurrentNativeRecording,
    workspaceId,
  ]);

  const recoverCrashedMeetingCapture = useCallback(
    async (
      targetMeetingId: string,
      recording: NativeRecordingState,
      fallbackDurationMs?: number | null
    ) => {
      await createMeetingSession({
        meetingId: targetMeetingId,
        resume: true,
      });

      const handler = desktopApi?.handler.recording as
        | RecordingHandlerWithRuntimeStatus
        | undefined;
      if (supportsMicAudioSpool(handler) && supportsMicAudioExport(handler)) {
        try {
          const status = await handler.getMicAudioSpoolStatus(targetMeetingId);
          if (status && status.pendingBytes > 0) {
            await drainStoredMicAudioFrames({
              meetingId: targetMeetingId,
              sampleRate: status.sampleRate,
              spool: handler,
            });
          }
          if (status) {
            await handler.closeMicAudioSpool(targetMeetingId);
          }
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.includes('Microphone spool for meeting') ||
            !error.message.includes('was not found')
          ) {
            throw error;
          }
        }
      }

      const finalRecordingCursor = isRawMeetingRecording(
        recording.filepath ?? ''
      )
        ? await postNativeRecordingAudio({
            cursor: 0,
            meetingId: targetMeetingId,
            recording,
            requireComplete: true,
          })
        : 0;
      const stopped = await jsonRequest<MeetingSessionResponse>(
        `/v1/meetings/${targetMeetingId}/stop`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );
      assertMeetingWorkspace(stopped.meeting, workspaceId);
      await finalizeConfirmedCapture({
        fallbackDurationMs:
          stopped.meeting.recordingDurationMs ?? fallbackDurationMs,
        meetingId: targetMeetingId,
        recording,
        recordingCursor: finalRecordingCursor,
        recordingPath: recording.filepath,
        startedAt: recording.startTime ?? null,
        stoppedAt: Date.now(),
      });
      persistPendingMeetingSave(workspaceId, targetMeetingId);
      setNativeRecording(null);
      nativeRecordingCursorRef.current = 0;
      return stopped.meeting;
    },
    [
      createMeetingSession,
      desktopApi,
      finalizeConfirmedCapture,
      postNativeRecordingAudio,
      workspaceId,
    ]
  );

  const loadMeetingFromHistory = useCallback(
    async (id: string) => {
      if (started || controlBusy) {
        return;
      }

      setControlBusy(true);
      try {
        const data = await jsonRequest<MeetingSessionResponse>(
          `/v1/meetings/${id}`
        );
        systemAudioPostStateRef.current = createMeetingAudioPostState();
        const meeting = data.meeting;
        assertMeetingWorkspace(meeting, workspaceId);
        setMeetingId(meeting.id);
        setMeetingDocId(meeting.docId ?? null);
        setMeetingProviderId(meeting.providerId ?? null);
        setMeetingSttState(meeting.stt ?? null);
        setPartialSegment(meeting.partialSegment ?? null);
        setTranscriptSegments(meeting.transcriptSegments ?? []);
        setRecordingPath(meeting.recordingPath ?? null);
        setMeetingState(
          meeting.status === 'recording' ? 'recording' : 'stopped'
        );
        setIsPostTranscribing(
          meeting.status === 'stopped' &&
            isMeetingTranscriptionPending(meeting.stt?.status)
        );
        const captureOwner = readNativeMeetingCaptureOwner();
        const shouldRecoverNativeRecording =
          meeting.status === 'recording' ||
          (captureOwner?.workspaceId === workspaceId &&
            captureOwner.meetingId === meeting.id);
        const recoveredNativeRecording = await syncCurrentNativeRecording({
          includeTerminal: true,
        });
        const current =
          recoveredNativeRecording &&
          (recoveredNativeRecording.meetingId
            ? recoveredNativeRecording.meetingId === meeting.id &&
              recoveredNativeRecording.workspaceId === workspaceId
            : shouldRecoverNativeRecording &&
              (!captureOwner ||
                (captureOwner.workspaceId === workspaceId &&
                  captureOwner.meetingId === meeting.id &&
                  captureOwner.recordingId === recoveredNativeRecording.id)))
            ? recoveredNativeRecording
            : null;
        if (recoveredNativeRecording && !current) {
          setNativeRecording(null);
          nativeRecordingCursorRef.current = 0;
        }
        if (
          current?.recovered &&
          current.filepath &&
          isRawMeetingRecording(current.filepath)
        ) {
          const recoveredMeeting = await recoverCrashedMeetingCapture(
            meeting.id,
            current,
            meeting.recordingDurationMs
          );
          setMeetingId(recoveredMeeting.id);
          setMeetingDocId(recoveredMeeting.docId ?? null);
          setMeetingProviderId(recoveredMeeting.providerId ?? null);
          setMeetingSttState(recoveredMeeting.stt ?? null);
          setPartialSegment(recoveredMeeting.partialSegment ?? null);
          setTranscriptSegments(recoveredMeeting.transcriptSegments ?? []);
          setRecordingPath(recoveredMeeting.recordingPath ?? null);
          setMeetingState('stopped');
          meetingStateRef.current = 'stopped';
          setRecordingStartedAt(null);
          setIsPostTranscribing(
            isMeetingTranscriptionPending(recoveredMeeting.stt?.status)
          );
          clearNativeMeetingCaptureOwner(workspaceId, meeting.id, current.id);
          await refreshMeetingHistory();
          setRecordingError('');
          return;
        }
        let loadWarning = '';
        if (meeting.status === 'recording') {
          const meetingCreatedAt = Date.parse(meeting.createdAt);
          const captureStartedAt =
            current?.startTime ??
            (Number.isFinite(meetingCreatedAt) ? meetingCreatedAt : Date.now());
          if (current && isActiveNativeMeetingRecording(current)) {
            writeNativeMeetingCaptureOwner(workspaceId, {
              meetingId: meeting.id,
              recordingId: current.id,
            });
            if (current.status === 'recording') {
              // Re-attach the main-process audio forwarder after a renderer
              // reload; idempotent when the forward session is still running.
              await startSystemAudioForward({
                meetingId: meeting.id,
                recording: current,
              });
              if (meeting.providerId === 'apple-speechanalyzer' && desktopApi) {
                const recording = desktopApi.handler.recording as
                  | RecordingHandlerWithRuntimeStatus
                  | undefined;
                await recording?.startAppleSpeechTranscription?.({
                  channels: current.numberOfChannels,
                  meetingId: meeting.id,
                  recordingId: current.id,
                  sampleRate: current.sampleRate,
                  source: 'system',
                });
              }
              void startMicCaptureForMeeting(
                meeting.id,
                captureStartedAt,
                meeting.providerId,
                current
              ).catch(console.error);
            } else {
              setMeetingState('paused');
            }
          } else if (current) {
            loadWarning =
              'The native capture has already ended. Microphone capture was not restarted; choose Stop to finish saving this meeting.';
          } else {
            loadWarning =
              'Nota could not recover an active native capture. Microphone capture was not restarted; choose Stop to preserve the meeting state.';
          }
          if (!current) {
            if (Number.isFinite(meetingCreatedAt)) {
              setRecordingStartedAt(meetingCreatedAt);
              setRecordingSeconds(
                Math.max(0, Math.floor((Date.now() - meetingCreatedAt) / 1000))
              );
            } else {
              setRecordingStartedAt(null);
              setRecordingSeconds(0);
            }
          }
        } else {
          setRecordingStartedAt(null);
          setRecordingSeconds(meetingDurationSeconds(meeting));
          if (current && !isActiveNativeMeetingRecording(current)) {
            await finalizeConfirmedCapture({
              fallbackDurationMs: meeting.recordingDurationMs,
              meetingId: meeting.id,
              recording: current,
              recordingCursor: current.cursor,
              recordingPath: current.filepath ?? meeting.recordingPath,
              startedAt: current.startTime ?? null,
              stoppedAt: Date.now(),
            });
            setNativeRecording(null);
            nativeRecordingCursorRef.current = 0;
          } else if (!current) {
            setNativeRecording(null);
          }
        }
        setRecordingError(loadWarning);
      } catch (error) {
        setRecordingError(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        setControlBusy(false);
      }
    },
    [
      controlBusy,
      desktopApi,
      finalizeConfirmedCapture,
      recoverCrashedMeetingCapture,
      refreshMeetingHistory,
      startMicCaptureForMeeting,
      started,
      startSystemAudioForward,
      syncCurrentNativeRecording,
      workspaceId,
    ]
  );

  useEffect(() => {
    if (
      newMeetingRequested ||
      !selectedMeetingId ||
      selectedMeetingId === meetingId
    ) {
      return;
    }
    loadMeetingFromHistory(selectedMeetingId).catch(console.error);
  }, [
    loadMeetingFromHistory,
    meetingId,
    newMeetingRequested,
    selectedMeetingId,
  ]);

  useEffect(() => {
    if (!newMeetingRequested || startMeetingRequested || controlBusy) {
      return;
    }

    let disposed = false;
    const loadNewMeetingDraft = async () => {
      if (started) {
        if (meetingId) {
          warnMeetingAlreadyRecording({
            createdAt: new Date().toISOString(),
            id: meetingId,
            status: 'recording',
            updatedAt: new Date().toISOString(),
          });
        }
        return;
      }

      resetMeetingDraft();
      try {
        const recordingMeeting = await activeRecordingMeeting();
        if (disposed) {
          return;
        }
        if (recordingMeeting) {
          if (recordingMeeting.workspaceId === workspaceId) {
            warnMeetingAlreadyRecording(recordingMeeting);
          } else {
            setRecordingError(
              'Another meeting is already recording in a different workspace. Stop it there before starting a new meeting.'
            );
          }
          return;
        }
      } catch (error) {
        if (!disposed) {
          setRecordingError(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    };

    loadNewMeetingDraft().catch(console.error);
    return () => {
      disposed = true;
    };
  }, [
    controlBusy,
    meetingId,
    newMeetingRequested,
    resetMeetingDraft,
    started,
    startMeetingRequested,
    warnMeetingAlreadyRecording,
    workspaceId,
  ]);

  useEffect(() => {
    if (!startMeetingRequested || selectedMeetingId || controlBusy || started) {
      return;
    }

    const intentKey = location.search;
    if (autoStartSearchRef.current === intentKey) {
      return;
    }
    autoStartSearchRef.current = intentKey;

    startMeeting().catch(error => {
      console.error(error);
      setRecordingError(error instanceof Error ? error.message : String(error));
    });
  }, [
    controlBusy,
    location.search,
    selectedMeetingId,
    startMeeting,
    startMeetingRequested,
    started,
  ]);

  useEffect(() => {
    if (!stopMeetingRequested || controlBusy) {
      return;
    }

    const intentKey = location.search;
    if (autoStopSearchRef.current === intentKey) {
      return;
    }

    if (started && meetingId) {
      autoStopSearchRef.current = intentKey;
      stopMeeting().catch(error => {
        console.error(error);
        setRecordingError(
          error instanceof Error ? error.message : String(error)
        );
      });
      return;
    }

    let disposed = false;
    activeRecordingMeeting(workspaceId)
      .then(recordingMeeting => {
        if (disposed) {
          return;
        }
        if (recordingMeeting) {
          openMeetingStopRoute(
            recordingMeeting.id,
            true,
            meetingSearchParams.get('intent') ?? Date.now().toString()
          );
          return;
        }
        autoStopSearchRef.current = intentKey;
        setRecordingError('No active meeting is recording.');
      })
      .catch(error => {
        if (!disposed) {
          setRecordingError(
            error instanceof Error ? error.message : String(error)
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, [
    controlBusy,
    location.search,
    meetingId,
    meetingSearchParams,
    openMeetingStopRoute,
    stopMeeting,
    stopMeetingRequested,
    started,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      selectedMeetingId ||
      newMeetingRequested ||
      startMeetingRequested ||
      stopMeetingRequested ||
      controlBusy
    ) {
      return;
    }

    let disposed = false;
    if (!started) {
      resetMeetingDraft();
    }
    const recoverOrOpenActiveMeeting = async () => {
      let current: NativeRecordingStatus | null | undefined;
      try {
        current =
          (await desktopApi?.handler.recording.getCurrentRecording()) as
            | NativeRecordingStatus
            | null
            | undefined;
      } catch (error) {
        console.warn('Failed to check native meeting recovery journal', error);
      }
      if (
        !disposed &&
        current?.meetingId &&
        current.workspaceId === workspaceId &&
        current.recovered
      ) {
        openMeetingRoute(current.meetingId, true);
        return;
      }

      const recordingMeeting = await activeRecordingMeeting(workspaceId);
      if (!disposed && recordingMeeting) {
        openMeetingRoute(recordingMeeting.id, true);
      }
    };
    recoverOrOpenActiveMeeting().catch(error => {
      console.warn('Failed to check recoverable meeting capture', error);
    });

    return () => {
      disposed = true;
    };
  }, [
    controlBusy,
    desktopApi,
    newMeetingRequested,
    openMeetingRoute,
    resetMeetingDraft,
    selectedMeetingId,
    startMeetingRequested,
    started,
    stopMeetingRequested,
    workspaceId,
  ]);

  const saveMeetingTranscript = useCallback(
    async (
      options: {
        background?: boolean;
        meetingId?: string;
        openDocument?: boolean;
        showError?: boolean;
        showSuccess?: boolean;
      } = {}
    ) => {
      const targetMeetingId = options.meetingId?.trim() || meetingId;
      if (!targetMeetingId) {
        return null;
      }
      const isCurrentMeeting = targetMeetingId === meetingId;
      if (!options.background && isCurrentMeeting && !canSave) {
        return null;
      }

      if (!options.background) {
        setIsSaving(true);
        setRecordingError('');
      }
      try {
        const localDocId =
          localMeetingDocIdsRef.current.get(targetMeetingId) ??
          (isCurrentMeeting ? meetingDocId : null);
        const result = await executeMeetingSaveOnce({
          accessForWorkspaceDocument,
          assertCanCreateWorkspaceDocument,
          assertCanUpdateWorkspaceDocument,
          current:
            isCurrentMeeting || localDocId
              ? {
                  docId: localDocId,
                  meetingId: targetMeetingId,
                  recordingPath: isCurrentMeeting ? recordingPath : null,
                  transcriptSegments: isCurrentMeeting
                    ? transcriptSegments
                    : undefined,
                }
              : undefined,
          docPersistence: workspace.engine.doc,
          docsService,
          finalizePortableMicRecording: desktopApi
            ? finalizePortableMicRecording
            : undefined,
          getMeeting: async id => {
            const data = await jsonRequest<MeetingSessionResponse>(
              `/v1/meetings/${id}`
            );
            return data.meeting;
          },
          journalService,
          patchMeeting: async (id, update) => {
            const data = await jsonRequest<MeetingSessionResponse>(
              `/v1/meetings/${id}`,
              {
                body: JSON.stringify(update),
                method: 'PATCH',
              }
            );
            return data.meeting;
          },
          recordingAccess: desktopApi?.handler.recording,
          recordingSavingMode: meetingSettings.recordingSavingMode,
          storage: browserMeetingSaveStorage(),
          targetMeetingId,
          workspace: workspace.docCollection,
          workspaceId,
        });
        const docId = result.docId;
        localMeetingDocIdsRef.current.set(targetMeetingId, docId);
        if (
          result.meeting.summary?.trim() &&
          result.meeting.summaryDocIds?.includes(docId)
        ) {
          localMeetingSummaryDocIdsRef.current.set(targetMeetingId, docId);
        }
        if (meetingIdRef.current === targetMeetingId) {
          setMeetingDocId(docId);
        }
        await refreshMeetingHistory();

        if (options.showSuccess !== false && result.contentAdded) {
          notify.success({
            title:
              result.destination === 'journal-today'
                ? "Meeting saved to today's journal"
                : 'Meeting saved locally',
          });
        } else if (options.showSuccess !== false) {
          notify.success({ title: 'Meeting note already saved' });
        }
        if (options.openDocument === true && !options.background) {
          workbench.openDoc(docId, { at: 'active' });
        }
        return docId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !options.background &&
          isCurrentMeeting &&
          meetingIdRef.current === targetMeetingId
        ) {
          setRecordingError(message);
        }
        if (options.showError !== false) {
          notify.error({ title: 'Failed to save meeting', message });
        }
        return null;
      } finally {
        if (!options.background) {
          setIsSaving(false);
        }
      }
    },
    [
      accessForWorkspaceDocument,
      assertCanCreateWorkspaceDocument,
      assertCanUpdateWorkspaceDocument,
      canSave,
      desktopApi,
      docsService,
      finalizePortableMicRecording,
      journalService,
      meetingDocId,
      meetingId,
      meetingSettings.recordingSavingMode,
      recordingPath,
      refreshMeetingHistory,
      transcriptSegments,
      workbench,
      workspace.docCollection,
      workspace.engine.doc,
      workspaceId,
    ]
  );

  // Persist before the route-level manual save. The workspace side effect owns
  // discovery and retry execution after this route unmounts.
  useEffect(() => {
    if (
      !meetingId ||
      !canSave ||
      meetingSttState?.status === 'finalizing' ||
      (meetingDocId &&
        workspaceDocExists(workspace.docCollection, meetingDocId))
    ) {
      return;
    }
    persistPendingMeetingSave(workspaceId, meetingId);
  }, [
    canSave,
    meetingDocId,
    meetingId,
    meetingSttState?.status,
    workspace.docCollection,
    workspaceId,
  ]);

  const summarizeMeetingToNote = useCallback(async () => {
    if (!meetingId || !canSummarize) {
      return;
    }

    const targetMeetingId = meetingId;
    setIsSummarizing(true);
    setRecordingError('');
    try {
      const docId = await saveMeetingTranscript({
        openDocument: false,
        showError: false,
        showSuccess: false,
      });
      if (!docId) {
        throw new Error(
          'The transcript could not be saved before summarizing. Retry once the meeting note is available.'
        );
      }

      const latest = await jsonRequest<MeetingSessionResponse>(
        `/v1/meetings/${targetMeetingId}`
      );
      let meeting = latest.meeting;
      assertMeetingWorkspace(meeting, workspaceId);
      if (meeting.status !== 'stopped') {
        throw new Error(
          'Meeting finalization has not completed. Retry Stop before summarizing.'
        );
      }

      if (meeting.summary?.trim() && meeting.summaryDocIds?.includes(docId)) {
        await assertCanUpdateWorkspaceDocument(docId);
        await appendMarkdownDoc({
          beforeBlockId: meetingContentBlockId(targetMeetingId, 'transcript'),
          blockId: meetingContentBlockId(targetMeetingId, 'summary'),
          docId,
          markdown: meetingSummarySectionMarkdown({
            headingLevel: journalService.journalDate$(docId).value ? 3 : 2,
            summary: meeting.summary,
          }),
          workspace: workspace.docCollection,
        });
        localMeetingDocIdsRef.current.set(targetMeetingId, docId);
        localMeetingSummaryDocIdsRef.current.set(targetMeetingId, docId);
        notify.success({ title: 'Meeting summary already saved' });
        workbench.openDoc(docId, { at: 'active' });
        return;
      }

      let summaryText = meeting.summary?.trim() ?? '';
      if (!summaryText) {
        const summaryData = await jsonRequest<MeetingSummaryResponse>(
          `/v1/meetings/${targetMeetingId}/summary`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        );
        meeting = summaryData.meeting;
        assertMeetingWorkspace(meeting, workspaceId);
        summaryText = summaryData.summary.text.trim();
      }

      const destination = resolveMeetingSaveDestination({
        existingDocIsJournal: Boolean(journalService.journalDate$(docId).value),
        hasExistingDoc: true,
        preferred: meetingSettings.recordingSavingMode,
      });
      const summaryBlockId = meetingContentBlockId(targetMeetingId, 'summary');
      let summaryAdded = false;
      if (
        localMeetingSummaryDocIdsRef.current.get(targetMeetingId) !== docId &&
        !workspaceDocHasBlock(workspace.docCollection, docId, summaryBlockId)
      ) {
        await assertCanUpdateWorkspaceDocument(docId);
        await appendMarkdownDoc({
          beforeBlockId: meetingContentBlockId(targetMeetingId, 'transcript'),
          blockId: summaryBlockId,
          docId,
          markdown: meetingSummarySectionMarkdown({
            headingLevel: destination === 'journal-today' ? 3 : 2,
            summary: summaryText,
          }),
          workspace: workspace.docCollection,
        });
        localMeetingSummaryDocIdsRef.current.set(targetMeetingId, docId);
        summaryAdded = true;
      }

      localMeetingDocIdsRef.current.set(targetMeetingId, docId);
      await syncWorkspaceContentIndex({
        accessForDocument: accessForWorkspaceDocument,
        documentIds: [docId],
        workspace: workspace.docCollection,
        workspaceId,
      });
      const linked = await jsonRequest<MeetingSessionResponse>(
        `/v1/meetings/${targetMeetingId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            docId,
            recordingPath: recordingPath ?? meeting.recordingPath ?? undefined,
            summaryDocId: docId,
          }),
        }
      );
      assertMeetingWorkspace(linked.meeting, workspaceId);
      if (meetingIdRef.current === targetMeetingId) {
        setMeetingDocId(linked.meeting.docId ?? docId);
      }
      await refreshMeetingHistory();
      notify.success({
        title: summaryAdded
          ? 'Meeting summary added'
          : 'Meeting summary already saved',
      });
      workbench.openDoc(docId, { at: 'active' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecordingError(message);
      notify.error({ title: 'Failed to summarize meeting', message });
    } finally {
      setIsSummarizing(false);
    }
  }, [
    accessForWorkspaceDocument,
    assertCanUpdateWorkspaceDocument,
    canSummarize,
    journalService,
    meetingId,
    meetingSettings.recordingSavingMode,
    recordingPath,
    refreshMeetingHistory,
    saveMeetingTranscript,
    workbench,
    workspace.docCollection,
    workspaceId,
  ]);

  const togglePause = useCallback(async () => {
    if (controlBusy) {
      return;
    }

    setControlBusy(true);
    const recordingState = nativeRecording;
    try {
      if (!desktopApi || !isActiveNativeMeetingRecording(recordingState)) {
        throw new Error(
          'Nota cannot pause or resume microphone capture without an active native meeting recording.'
        );
      }

      if (meetingState === 'paused') {
        await desktopApi.handler.recording.resumeRecording(recordingState.id);
        const resumedRecording = {
          ...recordingState,
          status: 'recording',
        } satisfies NativeRecordingState;
        setNativeRecording(resumedRecording);
        setMeetingState('recording');
        if (meetingId && recordingStartedAt) {
          startMicCaptureForMeeting(
            meetingId,
            recordingStartedAt,
            meetingProviderId,
            resumedRecording
          ).catch(console.error);
        }
      } else {
        await stopMicCapture();
        await desktopApi.handler.recording.pauseRecording(recordingState.id);
        setNativeRecording({ ...recordingState, status: 'paused' });
        setMeetingState('paused');
      }
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : String(error));
    } finally {
      setControlBusy(false);
    }
  }, [
    controlBusy,
    desktopApi,
    meetingId,
    meetingState,
    meetingProviderId,
    nativeRecording,
    recordingStartedAt,
    startMicCaptureForMeeting,
    stopMicCapture,
  ]);

  useEffect(() => {
    const recordingId = nativeRecording?.id;
    const recordingChannels = nativeRecording?.numberOfChannels;
    const recordingSampleRate = nativeRecording?.sampleRate;
    const recordingStatus = nativeRecording?.status;
    if (
      controlBusy ||
      !desktopApi ||
      !meetingId ||
      recordingId == null ||
      recordingChannels == null ||
      recordingSampleRate == null ||
      (recordingStatus !== 'recording' && recordingStatus !== 'paused') ||
      meetingState !== 'recording' ||
      // Main process pushes system audio directly; no renderer polling.
      systemAudioForwarded
    ) {
      return;
    }

    let disposed = false;
    let cursor = nativeRecordingCursorRef.current;

    const poll = async () => {
      if (disposed) {
        return;
      }

      try {
        const nextPostedCursor = await postNativeRecordingAudio({
          cursor,
          meetingId,
          recording: {
            cursor,
            id: recordingId,
            numberOfChannels: recordingChannels,
            sampleRate: recordingSampleRate,
            status: recordingStatus,
          },
        });
        if (disposed) {
          return;
        }

        if (nextPostedCursor !== cursor) {
          cursor = nextPostedCursor;
          setNativeRecording(state =>
            state && state.id === recordingId ? { ...state, cursor } : state
          );
          nativeRecordingCursorRef.current = cursor;
        }
      } catch (error) {
        if (!disposed) {
          setRecordingError(
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      if (!disposed) {
        window.setTimeout(() => {
          poll().catch(console.error);
        }, SYSTEM_AUDIO_FRAME_POLL_MS);
      }
    };

    window.setTimeout(() => {
      poll().catch(console.error);
    }, SYSTEM_AUDIO_FRAME_POLL_MS);
    return () => {
      disposed = true;
    };
  }, [
    controlBusy,
    desktopApi,
    meetingId,
    meetingState,
    nativeRecording?.id,
    nativeRecording?.numberOfChannels,
    nativeRecording?.sampleRate,
    nativeRecording?.status,
    postNativeRecordingAudio,
    systemAudioForwarded,
  ]);

  useEffect(() => {
    if (!meetingId || (!started && !isPostTranscribing)) {
      return;
    }

    const events = new EventSource(
      aiBackendUrl(`/v1/meetings/${meetingId}/events`)
    );
    const transcriptReplay =
      createMeetingTranscriptReplayFilter<TranscriptSegment>();

    const onStatus = (event: MessageEvent) => {
      const payload = parseMeetingPayload(event);
      if (payload.type !== 'status') {
        return;
      }
      transcriptReplay.reset(payload.meeting.transcriptSegments ?? []);
      setPartialSegment(payload.meeting.partialSegment ?? null);
      setMeetingDocId(payload.meeting.docId ?? null);
      setMeetingProviderId(payload.meeting.providerId ?? null);
      setMeetingSttState(payload.meeting.stt ?? null);
      setTranscriptSegments(payload.meeting.transcriptSegments ?? []);
      if (hasTranscriptProgress(payload.meeting)) {
        noteCaptureProgress();
      }
      if (payload.meeting.status === 'stopped') {
        const status = payload.meeting.stt?.status;
        if (
          status === 'stopped' ||
          status === 'error' ||
          status === 'unavailable'
        ) {
          setIsPostTranscribing(false);
        }
      }
    };
    const onPartial = (event: MessageEvent) => {
      const payload = parseMeetingPayload(event);
      if (payload.type === 'partial') {
        if (payload.segment.text.trim()) {
          noteCaptureProgress();
        }
        setPartialSegment(payload.segment);
      }
    };
    const onFinal = (event: MessageEvent) => {
      const payload = parseMeetingPayload(event);
      if (payload.type !== 'final') {
        return;
      }
      if (transcriptReplay.isReplay(payload.segment)) {
        return;
      }
      if (payload.segment.text.trim()) {
        noteCaptureProgress();
      }
      setPartialSegment(null);
      setTranscriptSegments(segments => {
        return mergeTranscriptSegment(segments, payload.segment);
      });
    };
    const onAudioLevel = (event: MessageEvent) => {
      // In main-process forwarding mode the renderer never posts audio frames
      // itself, so the backend's per-frame audio-level events are what proves
      // capture is flowing for the start watchdog.
      const payload = parseMeetingPayload(event);
      if (payload.type === 'audio-level') {
        noteAudioFramePosted();
      }
    };
    const onStreamError = (event: MessageEvent) => {
      if (!event.data) {
        setRecordingError('Meeting transcript stream disconnected.');
        return;
      }
      const payload = parseMeetingPayload(event);
      setRecordingError(
        payload.type === 'error'
          ? payload.message || 'Meeting transcript stream failed.'
          : 'Meeting transcript stream failed.'
      );
      setMeetingSttState({
        message:
          payload.type === 'error'
            ? payload.message || 'Meeting transcript stream failed.'
            : 'Meeting transcript stream failed.',
        providerId: meetingProviderId ?? undefined,
        status: 'error',
      });
    };

    events.addEventListener('status', onStatus);
    events.addEventListener('partial', onPartial);
    events.addEventListener('final', onFinal);
    events.addEventListener('audio-level', onAudioLevel);
    events.addEventListener('error', onStreamError);

    return () => {
      events.removeEventListener('status', onStatus);
      events.removeEventListener('partial', onPartial);
      events.removeEventListener('final', onFinal);
      events.removeEventListener('audio-level', onAudioLevel);
      events.removeEventListener('error', onStreamError);
      events.close();
    };
  }, [
    isPostTranscribing,
    meetingId,
    meetingProviderId,
    noteAudioFramePosted,
    noteCaptureProgress,
    started,
  ]);

  return (
    <>
      <ViewTitle title="Meetings" />
      <ViewIcon icon="meetings" />
      <ViewBody>
        <main
          className={styles.root}
          data-live-transcript={liveTranscriptSupported || showTranscriptRows}
          data-recording={activeFlow}
        >
          <div className={styles.stage} data-active={activeFlow}>
            <section
              className={styles.cover}
              aria-label="Meeting date"
              data-started={compactCover}
            >
              <img
                alt={`${artwork.title}, ${artwork.artist}, ${artwork.date}`}
                className={styles.coverImage}
                decoding="async"
                onError={() => {
                  setArtwork(current =>
                    current.imageUrl === DEFAULT_ARTWORK.imageUrl
                      ? current
                      : DEFAULT_ARTWORK
                  );
                }}
                referrerPolicy="no-referrer"
                src={artwork.imageUrl}
              />
              <div className={styles.dateStack}>
                <div className={styles.day}>{today.format('dddd')}</div>
                <div className={styles.date}>
                  {today.format('MMMM D, YYYY')}
                </div>
              </div>
            </section>
            {preStartStatusText ? (
              <div className={styles.preStartStatus} aria-live="polite">
                <span className={styles.listeningDot} />
                <span>{preStartStatusText}</span>
              </div>
            ) : null}
            {showMeetingPermissionPrompt ? (
              <section className={styles.permissionPanel}>
                <div className={styles.permissionText}>
                  <strong>
                    {meetingRuntimeUnavailable
                      ? 'Recording engine unavailable'
                      : 'Meeting access check'}
                  </strong>
                  <span className={styles.permissionSubtext}>
                    {meetingPermissionSummary(
                      meetingPermissions,
                      missingMeetingPermissions
                    )}
                  </span>
                  <div
                    aria-label="Meeting access status"
                    className={styles.permissionChecks}
                  >
                    {MEETING_PERMISSION_TYPES.map(type => {
                      const allowed = !!meetingPermissions?.[type];
                      const verified =
                        allowed &&
                        meetingPermissions?.statuses?.[type] !== 'unknown';
                      return (
                        <span
                          className={styles.permissionCheck}
                          data-ready={verified}
                          key={type}
                        >
                          {verified ? (
                            <RiCheckboxCircleFill aria-hidden />
                          ) : (
                            <RiErrorWarningFill aria-hidden />
                          )}
                          <span>{meetingPermissionLabel(type)}</span>
                          <span className={styles.permissionCheckState}>
                            {meetingPermissionStatusLabel(
                              allowed,
                              meetingPermissions?.statuses?.[type]
                            )}
                          </span>
                        </span>
                      );
                    })}
                    <span
                      className={styles.permissionCheck}
                      data-ready={!meetingRuntimeUnavailable}
                    >
                      {meetingRuntimeUnavailable ? (
                        <RiErrorWarningFill aria-hidden />
                      ) : (
                        <RiCheckboxCircleFill aria-hidden />
                      )}
                      <span>Recording engine</span>
                      <span className={styles.permissionCheckState}>
                        {meetingRuntimeUnavailable ? 'Unavailable' : 'Ready'}
                      </span>
                    </span>
                  </div>
                </div>
                <div className={styles.permissionActions}>
                  {missingMeetingPermissions.length > 0 ? (
                    <>
                      <button
                        className={styles.permissionButton}
                        disabled={meetingPermissionBusy}
                        type="button"
                        onClick={() => {
                          requestMeetingPermissions().catch(console.error);
                        }}
                      >
                        {missingMeetingPermissions.some(
                          type =>
                            meetingPermissions?.statuses?.[type] === 'unknown'
                        )
                          ? 'Check access'
                          : 'Allow access'}
                      </button>
                      <button
                        className={styles.permissionButton}
                        data-variant="secondary"
                        disabled={meetingPermissionBusy}
                        type="button"
                        onClick={() => {
                          openMeetingPermissionSettings().catch(console.error);
                        }}
                      >
                        Open Settings
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}
            {showLocalCalendarPanel ? (
              <section
                className={styles.calendarPermissionPanel}
                data-connected={localCalendarPermission.connected}
              >
                <div className={styles.calendarPermissionIcon}>
                  <RiCalendarEventFill aria-hidden />
                </div>
                <div className={styles.permissionText}>
                  <strong>{localCalendarPermission.title}</strong>
                  <span className={styles.permissionSubtext}>
                    {localCalendarPermission.description}
                  </span>
                </div>
                <div className={styles.permissionActions}>
                  {localCalendarPermission.connected ? (
                    <>
                      <button
                        className={styles.permissionButton}
                        data-variant="secondary"
                        disabled={calendarPermissionBusy}
                        type="button"
                        onClick={openCalendarConnectionSettings}
                      >
                        Add calendar
                      </button>
                      <button
                        className={styles.permissionButton}
                        data-variant="secondary"
                        disabled={calendarPermissionBusy}
                        type="button"
                        onClick={openCalendarManagement}
                      >
                        Manage calendars
                      </button>
                    </>
                  ) : (
                    <>
                      {localCalendarPermission.action ? (
                        <button
                          className={styles.permissionButton}
                          disabled={calendarPermissionBusy}
                          type="button"
                          onClick={() => {
                            handleLocalCalendarPermissionAction().catch(
                              console.error
                            );
                          }}
                        >
                          {localCalendarPermission.actionLabel}
                        </button>
                      ) : null}
                      <button
                        className={styles.permissionButton}
                        data-variant="secondary"
                        disabled={calendarPermissionBusy}
                        type="button"
                        onClick={openCalendarConnectionSettings}
                      >
                        Add calendar
                      </button>
                    </>
                  )}
                </div>
              </section>
            ) : null}
            {showTodayCalendarEvents ? (
              <section
                aria-label="Today calendar events"
                className={styles.calendarPreview}
                aria-busy={calendarEventsLoading}
              >
                <div className={styles.calendarPreviewHeader}>
                  <RiCalendarEventFill aria-hidden />
                  <span>Today’s events</span>
                  <span className={styles.calendarPreviewCount}>
                    {todayCalendarEvents.length}
                  </span>
                </div>
                {calendarEventsWarning ? (
                  <div
                    className={styles.calendarPreviewStatus}
                    data-error="true"
                  >
                    {calendarEventsWarning}
                  </div>
                ) : null}
                {calendarEventsLoading && !calendarEventsLoaded ? (
                  <div className={styles.calendarPreviewStatus}>
                    Loading today’s events…
                  </div>
                ) : calendarEventsError ? (
                  <div
                    className={styles.calendarPreviewStatus}
                    data-error="true"
                  >
                    Couldn’t refresh today’s events. {calendarEventsError}
                  </div>
                ) : todayCalendarEvents.length === 0 ? (
                  <div className={styles.calendarPreviewStatus}>
                    No events scheduled for today.
                  </div>
                ) : (
                  <div className={styles.calendarEventList}>
                    {todayCalendarEvents.map(event => {
                      const detailText = calendarEventDetailText(event);
                      const joinUrl = event.meetingUrl ?? event.url;
                      return (
                        <div
                          className={styles.calendarEventRow}
                          key={event.id}
                          style={{
                            borderColor:
                              event.calendarColor ?? 'rgba(111, 127, 84, 0.36)',
                          }}
                        >
                          <div className={styles.calendarEventTime}>
                            {formatCalendarEventTime(event)}
                          </div>
                          <div className={styles.calendarEventBody}>
                            <div className={styles.calendarEventTitle}>
                              {event.title || 'Untitled event'}
                            </div>
                            <div className={styles.calendarEventMetaRow}>
                              <div className={styles.calendarEventMeta}>
                                {[event.calendarName, detailText]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                              {joinUrl ? (
                                <a
                                  className={styles.calendarEventLink}
                                  href={joinUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Join
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}
            {activeFlow ? (
              <section
                aria-live="polite"
                className={styles.snippetLayer}
                data-visible={activeFlow}
              >
                {showRecordingStatus ? (
                  <div className={styles.recordingStatus}>
                    <span className={styles.recordingDot} />
                    <span>
                      {meetingState === 'paused' ? 'Paused' : 'Recording'}
                    </span>
                    <span className={styles.recordingTime}>
                      {formatElapsedTime(recordingSeconds)}
                    </span>
                  </div>
                ) : null}
                {showRecordingOnlyState ? (
                  <div className={styles.recordingOnlyStatus}>
                    <span className={styles.recordingDot} />
                    <span>Recording</span>
                    <span className={styles.recordingTime}>
                      {formatElapsedTime(recordingSeconds)}
                    </span>
                  </div>
                ) : null}
                {stopped ? (
                  <div
                    aria-label="Meeting duration"
                    className={styles.recordingStatus}
                  >
                    <RiCheckboxCircleFill aria-hidden />
                    <span>Meeting ended</span>
                    <span className={styles.recordingTime}>
                      {formatElapsedTime(recordingSeconds)}
                    </span>
                  </div>
                ) : null}
                {isPostTranscribing ? (
                  <div className={styles.processingStatus}>
                    <span className={styles.listeningDot} />
                    <span>Transcribing...</span>
                  </div>
                ) : null}
                <div className={styles.snippetList}>
                  {showTranscriptRows
                    ? snippetRows.map(segment => (
                        <div
                          className={styles.snippetRow}
                          data-type={segment.type}
                          key={segment.id}
                        >
                          <span className={styles.snippetTime}>
                            {formatSegmentTimestamp(segment)}
                          </span>
                          <span className={styles.snippet}>{segment.text}</span>
                        </div>
                      ))
                    : null}
                  {showRecordingStatus ? (
                    <div className={styles.listeningLine}>
                      <span className={styles.listeningDot} />
                      <span>{sttStatusText || 'Listening...'}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
            <div
              className={styles.controls}
              data-busy={controlBusy || isSaving}
              data-started={started}
              data-state={meetingState}
            >
              {started ? (
                <>
                  <button
                    aria-label="Stop meeting"
                    className={styles.controlButton}
                    data-variant="stop"
                    disabled={controlBusy}
                    title="Stop meeting"
                    type="button"
                    onClick={() => {
                      stopMeeting().catch(console.error);
                    }}
                  >
                    <RiStopFill aria-hidden />
                    <span>Stop</span>
                  </button>
                  <button
                    aria-label={
                      meetingState === 'paused'
                        ? 'Resume meeting'
                        : 'Pause meeting'
                    }
                    className={styles.controlButton}
                    data-variant="pause"
                    disabled={controlBusy}
                    title={
                      meetingState === 'paused'
                        ? 'Resume meeting'
                        : 'Pause meeting'
                    }
                    type="button"
                    onClick={() => {
                      togglePause().catch(console.error);
                    }}
                  >
                    {meetingState === 'paused' ? (
                      <RiPlayFill aria-hidden />
                    ) : (
                      <RiPauseFill aria-hidden />
                    )}
                    <span>
                      {meetingState === 'paused'
                        ? 'Resume meeting'
                        : 'Pause meeting'}
                    </span>
                  </button>
                </>
              ) : stopped && meetingId ? (
                <>
                  <button
                    aria-label="New meeting"
                    className={styles.startButton}
                    disabled={controlBusy || isSaving || isSummarizing}
                    title="New meeting"
                    type="button"
                    onClick={() => {
                      requestNewMeeting();
                    }}
                  >
                    <RiAddFill aria-hidden />
                    <span>{controlBusy ? 'Working' : 'New meeting'}</span>
                  </button>
                  <button
                    aria-label={
                      savedMeetingDocAvailable
                        ? 'Open saved meeting note'
                        : 'Save meeting'
                    }
                    className={styles.saveButton}
                    disabled={!canSave}
                    title={
                      savedMeetingDocAvailable
                        ? 'Open saved meeting note'
                        : meetingSettings.recordingSavingMode ===
                            'journal-today'
                          ? "Save to today's journal"
                          : 'Save as a new note'
                    }
                    type="button"
                    onClick={() => {
                      saveMeetingTranscript({
                        openDocument: savedMeetingDocAvailable,
                      }).catch(console.error);
                    }}
                  >
                    <span>
                      {isSaving
                        ? 'Saving'
                        : savedMeetingDocAvailable
                          ? 'Open note'
                          : 'Save'}
                    </span>
                  </button>
                  {transcriptSegments.length ? (
                    <button
                      aria-label="Summarize meeting"
                      className={styles.summaryButton}
                      disabled={!canSummarize}
                      title="Summarize meeting"
                      type="button"
                      onClick={() => {
                        summarizeMeetingToNote().catch(console.error);
                      }}
                    >
                      <span>{isSummarizing ? 'Summarizing' : 'Summarize'}</span>
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  aria-label="Start meeting"
                  className={styles.startButton}
                  disabled={controlBusy || isSaving || isSummarizing}
                  title="Start meeting"
                  type="button"
                  onClick={() => {
                    startMeeting().catch(console.error);
                  }}
                >
                  <RiVoiceprintFill aria-hidden />
                  <span>
                    {preStartStatusText
                      ? 'Loading model'
                      : controlBusy
                        ? 'Working'
                        : 'Start'}
                  </span>
                </button>
              )}
            </div>
            {recordingError ? (
              <div className={styles.errorText}>{recordingError}</div>
            ) : null}
          </div>
        </main>
      </ViewBody>
    </>
  );
};
