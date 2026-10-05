import Module, { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  archiveEnd: vi.fn(),
  destroy: vi.fn(),
  markCaptureStopped: vi.fn(),
  markRecoveryStopped: vi.fn(),
  latestRecovery: vi.fn(),
  nativeStop: vi.fn(),
  stopForward: vi.fn(),
  tap: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nota-recording-stop-tests' },
  systemPreferences: {},
}));
vi.mock('fs-extra', () => ({
  default: {
    ensureDirSync: vi.fn(),
    openSync: () => 1,
    closeSync: vi.fn(),
    createWriteStream: (path: string) => ({
      path,
      closed: true,
      destroy: mocks.destroy,
    }),
    statSync: () => ({ size: 16 }),
  },
}));
vi.mock('../../src/main/cleanup', () => ({ beforeAppQuit: vi.fn() }));
vi.mock('../../src/main/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../src/main/shared-storage/storage', async () => {
  const { of } = await import('rxjs');
  return { globalStateStorage: { watch: () => of({}), get: () => ({}) } };
});
vi.mock('../../src/main/windows-manager', () => ({
  getMainWindow: vi.fn(),
}));
vi.mock('../../src/main/windows-manager/popup', () => ({
  popupManager: {},
}));
vi.mock('../../src/main/recording/audio-forward', () => ({
  forwardAudioSamples: vi.fn(),
  markAudioForwardCaptureStopped: mocks.markCaptureStopped,
  stopAudioForwardForRecording: mocks.stopForward,
}));
vi.mock('../../src/main/recording/system-audio-access', () => ({
  SystemAudioAccessProbe: class {
    markGranted = vi.fn();
  },
}));
vi.mock('../../src/main/recording/system-audio-recovery', () => ({
  SystemAudioRecoveryJournal: class {
    latest = mocks.latestRecovery;
    updateFormat = vi.fn();
    markStopped = mocks.markRecoveryStopped;
    findByRecordingId = () => null;
  },
}));
vi.mock('../../src/main/recording/raw-recording-archive', () => ({
  RawRecordingArchive: class {
    bytesAccepted = 16;
    end = mocks.archiveEnd;
    write = vi.fn();
  },
}));

import {
  createRecording,
  recordingStatus$,
  removeRecording,
  serializeRecordingStatus,
  serializeRecoveredRecordingStatus,
  stopRecording,
} from '../../src/main/recording/feature';

const require = createRequire(import.meta.url);
const nativeModuleId = require.resolve('@nota/native');
const previousNativeModule = require.cache[nativeModuleId];
const status = { id: 987, startTime: 1, status: 'recording' as const };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  const nativeModule = new Module(nativeModuleId);
  nativeModule.exports = {
    ShareableContent: { tapGlobalAudio: mocks.tap },
  };
  require.cache[nativeModuleId] = nativeModule;
  mocks.tap.mockReturnValue({
    channels: 1,
    sampleRate: 16000,
    stop: mocks.nativeStop,
  });
  mocks.archiveEnd.mockResolvedValue(undefined);
  mocks.stopForward.mockResolvedValue({ complete: true });
  recordingStatus$.next(status);
});

afterEach(() => {
  removeRecording(status.id);
  vi.clearAllTimers();
  vi.useRealTimers();
  if (previousNativeModule) {
    require.cache[nativeModuleId] = previousNativeModule;
  } else {
    delete require.cache[nativeModuleId];
  }
});

describe('native recording stop retries', () => {
  it('preserves the archived audio length and format when recovering a ready recording', () => {
    mocks.latestRecovery.mockReturnValue({
      archiveBytes: 12_570_624,
      filepath: '/tmp/recovered.opus',
      meetingId: 'recovered-meeting',
      numberOfChannels: 2,
      recordingId: 987,
      sampleRate: 48_000,
      startTime: 1,
      status: 'ready',
      workspaceId: 'workspace-1',
    });
    expect(serializeRecoveredRecordingStatus()).toMatchObject({
      archiveBytes: 12_570_624,
      numberOfChannels: 2,
      recovered: true,
      sampleRate: 48_000,
      status: 'ready',
    });
  });

  it('rejects a failed stop, stops forwarding, and retries the retained native session', async () => {
    const recording = createRecording(status);
    const error = new Error('native resources still retained');
    mocks.nativeStop.mockImplementationOnce(() => {
      throw error;
    });

    await expect(stopRecording(status.id)).rejects.toBe(error);
    expect(mocks.markCaptureStopped).toHaveBeenCalledExactlyOnceWith(status.id);
    expect(mocks.archiveEnd).not.toHaveBeenCalled();
    expect(mocks.markRecoveryStopped).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(createRecording(status)).toBe(recording);

    await expect(stopRecording(status.id)).resolves.toMatchObject({
      status: 'stopped',
    });
    expect(mocks.nativeStop).toHaveBeenCalledTimes(2);
    expect(mocks.markCaptureStopped).toHaveBeenCalledTimes(2);
    expect(mocks.archiveEnd).toHaveBeenCalledOnce();

    await stopRecording(status.id);
    expect(mocks.nativeStop).toHaveBeenCalledTimes(2);
    expect(mocks.markCaptureStopped).toHaveBeenCalledTimes(3);
  });

  it('exposes capture and stop failures while allowing an explicit stop retry', async () => {
    const recording = createRecording(status);
    mocks.nativeStop.mockImplementationOnce(() => {
      throw new Error('retained audio tap');
    });
    const onAudio = mocks.tap.mock.calls[0][1] as (
      error: Error,
      samples: Float32Array
    ) => void;

    onAudio(new Error('capture failed'), new Float32Array());

    expect(recording.captureError?.message).toContain('capture failed');
    expect(recording.captureError?.message).toContain('retained audio tap');
    expect(recording.captureError?.message).toContain('Retry Stop');
    expect(serializeRecordingStatus(recordingStatus$.value!)).toMatchObject({
      error: recording.captureError?.message,
      status: 'create-block-failed',
    });
    expect(mocks.markCaptureStopped).toHaveBeenCalledExactlyOnceWith(status.id);
    expect(mocks.archiveEnd).not.toHaveBeenCalled();

    await stopRecording(status.id);
    expect(mocks.nativeStop).toHaveBeenCalledTimes(2);
    expect(mocks.markCaptureStopped).toHaveBeenCalledTimes(2);
    await stopRecording(status.id);
    expect(mocks.nativeStop).toHaveBeenCalledTimes(2);
  });

  it('does not stop native capture twice after capture-failure cleanup succeeds', async () => {
    createRecording(status);
    const onAudio = mocks.tap.mock.calls[0][1] as (
      error: Error,
      samples: Float32Array
    ) => void;
    onAudio(new Error('capture failed'), new Float32Array());

    await stopRecording(status.id);
    expect(mocks.nativeStop).toHaveBeenCalledOnce();
    expect(mocks.markCaptureStopped).toHaveBeenCalledTimes(2);
  });
});
