// eslint-disable no-var-requires

// Should not load @nota/native for unsupported platforms

import path from 'node:path';

import { shell } from 'electron';

import { isMacOS, isWindows } from '../../shared/utils';
import {
  openMacSystemSettings,
  openWindowsMicrophoneSettings,
} from '../security/open-external';
import type { NamespaceHandlers } from '../type';
import {
  type AppleSpeechAudioFrame,
  type AppleSpeechTranscriptEvent,
  getAppleSpeechBridgeStatus,
  getAppleSpeechFileTranscriptionStatus,
  prepareAppleSpeechLanguage,
  pushAppleSpeechAudioFrame,
  pushAppleSpeechTranscriptEvent,
  registerAppleSpeechBridge,
  setupAppleSpeechBridge,
  startAppleSpeechTranscription,
  stopAppleSpeechTranscription,
  transcribeAppleSpeechRawRecording,
} from './apple-speech-bridge';
import {
  startMeetingAudioForward,
  stopMeetingAudioForward,
} from './audio-forward';
import {
  askForMeetingPermission,
  type CheckMeetingPermissionOptions,
  checkMeetingPermissions,
  checkRecordingAvailable,
  disableRecordingFeature,
  getRawAudioBuffers,
  getRecording,
  getRecordingRuntimeStatus,
  handleBlockCreationFailed,
  handleBlockCreationSuccess,
  pauseRecording,
  readRecordingFile,
  readyRecording,
  recordingStatus$,
  removeRecording,
  resumeRecording,
  SAVED_RECORDINGS_DIR,
  type SerializedRecordingStatus,
  serializeRecordingStatus,
  serializeRecoveredRecordingStatus,
  setupRecordingFeature,
  startRecording,
  stopRecording,
} from './feature';
import { MicAudioSpoolStore } from './mic-audio-spool';
import type { AppGroupInfo } from './types';

const micAudioSpool = new MicAudioSpoolStore(
  path.join(SAVED_RECORDINGS_DIR, 'mic-spool')
);

export const recordingHandlers = {
  getRecording: async (_, id: number) => {
    return getRecording(id);
  },
  getCurrentRecording: async () => {
    // not all properties are serializable, so we need to return a subset of the status
    return recordingStatus$.value
      ? serializeRecordingStatus(recordingStatus$.value)
      : serializeRecoveredRecordingStatus();
  },
  getRecordingRuntimeStatus: async () => {
    return getRecordingRuntimeStatus();
  },
  startRecording: async (
    _,
    appGroup?: AppGroupInfo | number,
    options?: {
      meetingId?: string;
      suppressPopup?: boolean;
      workspaceId?: string;
    }
  ) => {
    const status = startRecording(appGroup, options);
    return status ? serializeRecordingStatus(status) : null;
  },
  pauseRecording: async (_, id: number) => {
    return pauseRecording(id);
  },
  resumeRecording: async (_, id: number) => {
    return resumeRecording(id);
  },
  stopRecording: async (_, id: number) => {
    return stopRecording(id);
  },
  getRawAudioBuffers: async (_, id: number, cursor?: number) => {
    return getRawAudioBuffers(id, cursor);
  },
  openMicAudioSpool: async (
    _,
    input: {
      channels: number;
      meetingId: string;
      sampleRate: number;
      startMs: number;
    }
  ) => {
    return micAudioSpool.open(input);
  },
  appendMicAudioSpool: async (_, meetingId: string, pcm: Uint8Array) => {
    return micAudioSpool.append(meetingId, pcm);
  },
  readMicAudioSpoolFrame: async (
    _,
    meetingId: string,
    maximumBytes: number
  ) => {
    return micAudioSpool.readFrame(meetingId, maximumBytes);
  },
  getMicAudioSpoolStatus: async (_, meetingId: string) => {
    try {
      return await micAudioSpool.status(meetingId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('Microphone spool for meeting') &&
        error.message.includes('was not found')
      ) {
        return null;
      }
      throw error;
    }
  },
  readMicAudioSpoolArchive: async (
    _,
    meetingId: string,
    cursor: number,
    maximumBytes: number
  ) => {
    return micAudioSpool.readArchive(meetingId, cursor, maximumBytes);
  },
  getPublishedMicRecordingPath: async (_, meetingId: string) => {
    return micAudioSpool.publishedPortablePath(meetingId);
  },
  publishMicRecording: async (_, meetingId: string, encoded: Uint8Array) => {
    return micAudioSpool.publishPortable(meetingId, encoded);
  },
  acknowledgeMicAudioSpoolFrame: async (
    _,
    meetingId: string,
    frameId: string
  ) => {
    return micAudioSpool.acknowledge(meetingId, frameId);
  },
  closeMicAudioSpool: async (_, meetingId: string) => {
    return micAudioSpool.close(meetingId);
  },
  finishMicAudioSpool: async (_, meetingId: string) => {
    return micAudioSpool.finish(meetingId);
  },
  // Main-process push of tapped system audio to the AI backend for a live
  // meeting; replaces renderer-side raw-buffer polling when available.
  startMeetingAudioForward: async (
    _,
    input: {
      channels: number;
      fromByte?: number;
      meetingId: string;
      recordingId: number;
      sampleRate: number;
    }
  ) => {
    const recording = await getRecording(input.recordingId);
    return startMeetingAudioForward({
      ...input,
      archiveBytes: recording?.archiveBytes,
      filePath: recording?.filepath ?? null,
    });
  },
  stopMeetingAudioForward: async (_, meetingId: string) => {
    return stopMeetingAudioForward(meetingId);
  },
  readRecordingFile: async (_, filepath: string) => {
    return readRecordingFile(filepath);
  },
  // save the encoded recording buffer to the file system
  readyRecording: async (_, id: number, buffer: Uint8Array) => {
    return readyRecording(id, Buffer.from(buffer));
  },
  handleBlockCreationSuccess: async (_, id: number) => {
    return handleBlockCreationSuccess(id);
  },
  handleBlockCreationFailed: async (_, id: number, error?: Error) => {
    return handleBlockCreationFailed(id, error);
  },
  removeRecording: async (_, id: number, meetingId?: string) => {
    return removeRecording(id, meetingId);
  },
  checkRecordingAvailable: async () => {
    return checkRecordingAvailable();
  },
  setupRecordingFeature: async () => {
    return setupRecordingFeature();
  },
  disableRecordingFeature: async () => {
    return disableRecordingFeature();
  },
  checkMeetingPermissions: async (
    _,
    options?: CheckMeetingPermissionOptions
  ) => {
    return checkMeetingPermissions(options);
  },
  getAppleSpeechBridgeStatus: async () => {
    return getAppleSpeechBridgeStatus();
  },
  getAppleSpeechFileTranscriptionStatus: async () => {
    return getAppleSpeechFileTranscriptionStatus();
  },
  registerAppleSpeechBridge: async (
    _,
    status?: {
      available?: boolean;
      reason?: string | null;
      version?: string | null;
    }
  ) => {
    return registerAppleSpeechBridge(status);
  },
  prepareAppleSpeechLanguage: async (_, locale: string) =>
    prepareAppleSpeechLanguage(locale),
  setupAppleSpeechBridge: async () => {
    return setupAppleSpeechBridge();
  },
  pushAppleSpeechTranscriptEvent: async (
    _,
    meetingId: string,
    event: AppleSpeechTranscriptEvent
  ) => {
    return pushAppleSpeechTranscriptEvent(meetingId, event);
  },
  pushAppleSpeechAudioFrame: async (
    _,
    meetingId: string,
    frame: AppleSpeechAudioFrame
  ) => {
    return pushAppleSpeechAudioFrame(meetingId, frame);
  },
  startAppleSpeechTranscription: async (
    _,
    input:
      | string
      | {
          channels?: number;
          meetingId: string;
          recordingId?: number;
          sampleRate?: number;
          source?: 'mic' | 'system';
        }
  ) => {
    return startAppleSpeechTranscription(input);
  },
  stopAppleSpeechTranscription: async (_, meetingId: string) => {
    return stopAppleSpeechTranscription(meetingId);
  },
  transcribeAppleSpeechRawRecording: async (
    _,
    input: {
      channels?: number;
      filepath: string;
      sampleRate?: number;
      locale?: string;
    }
  ) => {
    return transcribeAppleSpeechRawRecording(input);
  },
  askForMeetingPermission: async (
    _,
    type: 'screen' | 'systemAudio' | 'microphone'
  ) => {
    return askForMeetingPermission(type);
  },
  showRecordingPermissionSetting: async (
    _,
    type: 'screen' | 'systemAudio' | 'microphone'
  ) => {
    if (isMacOS()) {
      const anchorMap = {
        screen: 'Privacy_ScreenCapture',
        systemAudio: 'Privacy_ScreenCapture',
        microphone: 'Privacy_Microphone',
      };
      return openMacSystemSettings(anchorMap[type]);
    }
    if (isWindows() && type === 'microphone') {
      return openWindowsMicrophoneSettings();
    }
    return false;
  },
  showSavedRecordings: async (_, subpath?: string) => {
    const normalizedDir = path.normalize(
      path.join(SAVED_RECORDINGS_DIR, subpath ?? '')
    );
    const normalizedBase = path.normalize(SAVED_RECORDINGS_DIR);

    if (!normalizedDir.startsWith(normalizedBase)) {
      throw new Error('Invalid directory');
    }
    return shell.showItemInFolder(normalizedDir);
  },
} satisfies NamespaceHandlers;

export const recordingEvents = {
  onRecordingStatusChanged: (
    fn: (status: SerializedRecordingStatus | null) => void
  ) => {
    const sub = recordingStatus$.subscribe(status => {
      fn(status ? serializeRecordingStatus(status) : null);
    });
    return () => {
      try {
        sub.unsubscribe();
      } catch {
        // ignore unsubscribe error
      }
    };
  },
};
