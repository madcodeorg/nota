/* oxlint-disable no-var-requires */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

// Should not load @nota/native for unsupported platforms
import type { ShareableContent as ShareableContentType } from '@nota/native';
import { app, systemPreferences } from 'electron';
import fs from 'fs-extra';
import {
  BehaviorSubject,
  distinctUntilChanged,
  groupBy,
  interval,
  mergeMap,
  Subject,
  throttleTime,
} from 'rxjs';
import { filter, map, shareReplay } from 'rxjs/operators';

import { isMacOS, isWindows, shallowEqual } from '../../shared/utils';
import { beforeAppQuit } from '../cleanup';
import { logger } from '../logger';
import {
  getMacOSPermissionClient,
  type MacOSPermissionClient,
} from '../security/permission-client';
import {
  MeetingSettingsKey,
  MeetingSettingsSchema,
} from '../shared-state-schema';
import { globalStateStorage } from '../shared-storage/storage';
import { getMainWindow } from '../windows-manager';
import { popupManager } from '../windows-manager/popup';
import { isAppNameAllowed } from './allow-list';
import {
  forwardAudioSamples,
  markAudioForwardCaptureStopped,
  stopAudioForwardForRecording,
} from './audio-forward';
import { runBeforeRecordingStateClear } from './cleanup-hooks';
import { ensureNativeRecordingRuntimeDependencies } from './native-runtime';
import { rawAudioReadWindow } from './raw-audio-read';
import { RawRecordingArchive } from './raw-recording-archive';
import { recordingStateMachine } from './state-machine';
import { SystemAudioAccessProbe } from './system-audio-access';
import { SystemAudioRecoveryJournal } from './system-audio-recovery';
import type {
  AppGroupInfo,
  Recording,
  RecordingStatus,
  TappableAppInfo,
} from './types';

export const MeetingsSettingsState = {
  $: globalStateStorage.watch<MeetingSettingsSchema>(MeetingSettingsKey).pipe(
    map(v => MeetingSettingsSchema.parse(v ?? {})),
    shareReplay(1)
  ),

  get value() {
    return MeetingSettingsSchema.parse(
      globalStateStorage.get(MeetingSettingsKey) ?? {}
    );
  },

  set value(value: MeetingSettingsSchema) {
    globalStateStorage.set(MeetingSettingsKey, value);
  },
};

const subscribers: Subscriber[] = [];

// recordings are saved in the app data directory
// may need a way to clean up old recordings
export const SAVED_RECORDINGS_DIR = path.join(
  app.getPath('sessionData'),
  'recordings'
);

const systemAudioRecovery = new SystemAudioRecoveryJournal(
  path.join(SAVED_RECORDINGS_DIR, 'meeting-recovery'),
  SAVED_RECORDINGS_DIR
);

let recordingFeatureInitialized = false;

const systemAudioAccessProbe = new SystemAudioAccessProbe(() => {
  ensureNativeRecordingRuntimeDependencies();
  return require('@nota/native').ShareableContent;
});

function unsubscribeSafely(subscriber: Subscriber) {
  try {
    subscriber.unsubscribe();
  } catch {
    // ignore unsubscribe error
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorCauseMessages(error: unknown) {
  const messages: string[] = [];
  let current: unknown = error;
  while (current && messages.length < 4) {
    const message = errorMessage(current);
    if (message && !messages.includes(message)) {
      messages.push(message);
    }
    current =
      current instanceof Error && 'cause' in current
        ? (current as Error & { cause?: unknown }).cause
        : null;
  }
  return messages;
}

export function getRecordingRuntimeStatus() {
  if (!checkRecordingAvailable()) {
    return {
      available: false,
      reason: 'Meeting recording is unavailable on this device.',
    };
  }

  if (!isMacOS() && !isWindows()) {
    return {
      available: false,
      reason: 'Meeting recording is only available on macOS and Windows.',
    };
  }

  try {
    ensureNativeRecordingRuntimeDependencies();
    const ShareableContent = require('@nota/native').ShareableContent;
    if (!ShareableContent) {
      return {
        available: false,
        reason: 'Native recording binding did not expose ShareableContent.',
      };
    }
    if (
      isMacOS() &&
      typeof ShareableContent.probeSystemAudioAccess !== 'function'
    ) {
      return {
        available: false,
        reason:
          'The macOS native recording binding is missing probeSystemAudioAccess. Rebuild the complete @nota/native addon, or install an updated Nota build, before recording. Changing privacy permissions will not fix this missing runtime capability.',
      };
    }
    return {
      available: true,
      reason: null,
    };
  } catch (error) {
    const repair = ensureNativeRecordingRuntimeDependencies();
    const missing = repair.missing.length
      ? ` Missing dylibs: ${repair.missing.join(', ')}.`
      : '';
    return {
      available: false,
      reason: `Native recording binding failed to load: ${errorCauseMessages(
        error
      ).join(' | ')}.${missing}`,
    };
  }
}

async function cleanup() {
  for (const recording of recordings.values()) {
    try {
      await stopRecordingSession(recording, 'recording feature cleanup');
      if (!recording.file.closed) {
        await Promise.race([
          recording.archive.end(),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Recording cleanup archive timeout')),
              5000
            );
          }),
        ]);
      }
      systemAudioRecovery.markStopped(
        recording.id,
        recording.archive.bytesAccepted,
        recording.startTime
      );
      const drain = await stopAudioForwardForRecording(recording.id);
      if (drain && !drain.complete) {
        logger.error(
          `Recording ${recording.id} cleanup drain is incomplete at ${drain.cursor}/${drain.archive}: ${drain.reason}`
        );
      }
    } catch (error) {
      logger.error('Failed to finalize recording during cleanup', error);
    } finally {
      if (!recording.file.closed) {
        recording.file.destroy();
      }
    }
  }
  try {
    // Apple Speech uses the finalized archive for its last pump, so its
    // session drain must run while recording metadata is still available.
    await runBeforeRecordingStateClear();
  } catch (error) {
    logger.error('Failed to finish recording cleanup hooks', error);
  }
  recordings.clear();
  stoppedRecordingSessions.clear();

  subscribers.splice(0).forEach(unsubscribeSafely);
  applications$.next([]);
  appGroups$.next([]);
  recordingStatus$.next(null);
  recordingFeatureInitialized = false;
}

beforeAppQuit(() => {
  return cleanup();
});

export const applications$ = new BehaviorSubject<TappableAppInfo[]>([]);
export const appGroups$ = new BehaviorSubject<AppGroupInfo[]>([]);

export const updateApplicationsPing$ = new Subject<number>();

// recording id -> recording
// recordings will be saved in memory before consumed and created as an audio block to user's doc
const recordings = new Map<number, Recording>();
const stoppedRecordingSessions = new Set<number>();

// there should be only one active recording at a time
// We'll now use recordingStateMachine.status$ instead of our own BehaviorSubject
export const recordingStatus$ = recordingStateMachine.status$;

function createAppGroup(processGroupId: number): AppGroupInfo | undefined {
  // MUST require dynamically to avoid loading @nota/native for unsupported platforms
  ensureNativeRecordingRuntimeDependencies();
  const SC: typeof ShareableContentType =
    require('@nota/native').ShareableContent;
  const groupProcess = SC?.applicationWithProcessId(processGroupId);
  if (!groupProcess) {
    return;
  }
  return {
    processGroupId: processGroupId,
    apps: [], // leave it empty for now.
    name: groupProcess.name,
    bundleIdentifier: groupProcess.bundleIdentifier,
    // icon should be lazy loaded
    get icon() {
      try {
        return groupProcess.icon;
      } catch (error) {
        logger.error(`Failed to get icon for ${groupProcess.name}`, error);
        return undefined;
      }
    },
    isRunning: false,
  };
}

// pipe applications$ to appGroups$
function setupAppGroups() {
  subscribers.push(
    applications$.pipe(distinctUntilChanged()).subscribe(apps => {
      const appGroups: AppGroupInfo[] = [];
      apps.forEach(app => {
        let appGroup = appGroups.find(
          group => group.processGroupId === app.processGroupId
        );

        if (!appGroup) {
          appGroup = createAppGroup(app.processGroupId);
          if (appGroup) {
            appGroups.push(appGroup);
          }
        }
        if (appGroup) {
          appGroup.apps.push(app);
        }
      });

      appGroups.forEach(appGroup => {
        appGroup.isRunning = appGroup.apps.some(app => app.isRunning);
      });

      appGroups$.next(appGroups);
    })
  );
}

function setupNewRunningAppGroup() {
  const appGroupRunningChanged$ = appGroups$.pipe(
    mergeMap(groups => groups),
    groupBy(group => group.processGroupId),
    mergeMap(groupStream$ =>
      groupStream$.pipe(
        distinctUntilChanged((prev, curr) => prev.isRunning === curr.isRunning)
      )
    ),
    filter(group => isAppNameAllowed(group.name))
  );

  subscribers.push(
    appGroupRunningChanged$.subscribe(currentGroup => {
      logger.info(
        'appGroupRunningChanged',
        currentGroup.bundleIdentifier,
        currentGroup.isRunning
      );

      const recordingStatus = recordingStatus$.value;

      if (currentGroup.isRunning) {
        // Background app detection is passive. Manual meeting/Tray starts still
        // call startRecording() directly, but a running app must not open the
        // floating recording popup by itself.
        return;
      } else {
        // when displaying in "new" state but the app is not running any more
        // we should remove the recording
        if (
          recordingStatus?.status === 'new' &&
          currentGroup.bundleIdentifier ===
            recordingStatus.appGroup?.bundleIdentifier
        ) {
          removeRecording(recordingStatus.id);
        }

        // if the recording is stopped and we are recording it,
        // we should stop the recording
        if (
          recordingStatus?.status === 'recording' &&
          recordingStatus.appGroup?.bundleIdentifier ===
            currentGroup.bundleIdentifier
        ) {
          stopRecording(recordingStatus.id).catch(err => {
            logger.error('failed to stop recording', err);
          });
        }
      }
    })
  );
}

function getSanitizedAppId(bundleIdentifier?: string) {
  if (!bundleIdentifier) {
    return 'unknown';
  }

  return isWindows()
    ? createHash('sha256')
        .update(bundleIdentifier)
        .digest('hex')
        .substring(0, 8)
    : bundleIdentifier;
}

function rawRecordingPath(status: RecordingStatus) {
  const appId = getSanitizedAppId(status.appGroup?.bundleIdentifier);
  return path.join(
    SAVED_RECORDINGS_DIR,
    `${appId}-${status.id}-${status.startTime}.raw`
  );
}

export function createRecording(status: RecordingStatus) {
  let recording = recordings.get(status.id);
  if (recording) {
    return recording;
  }
  stoppedRecordingSessions.delete(status.id);

  const bufferedFilePath = rawRecordingPath(status);

  fs.ensureDirSync(SAVED_RECORDINGS_DIR);
  // Create the durable archive path synchronously. The recovery journal is
  // already fsynced at this point, and updateFormat() must be able to resolve
  // that journal immediately after the native tap returns (before Node's
  // WriteStream has necessarily emitted `open`).
  const archiveFileDescriptor = fs.openSync(bufferedFilePath, 'wx');
  fs.closeSync(archiveFileDescriptor);
  const file = fs.createWriteStream(bufferedFilePath, { flags: 'a' });

  let archiveBytes = 0;
  let archiveFailure: Error | undefined;

  const failCapture = (error: Error) => {
    const firstFailure = !archiveFailure;
    archiveFailure ??= error;
    let errorToReport = firstFailure ? archiveFailure : null;
    if (firstFailure) {
      logger.error(`Recording ${status.id} raw archive failed`, error);
    }
    if (recording && !stoppedRecordingSessions.has(recording.id)) {
      recording.captureError = archiveFailure;
      try {
        recording.session.stop();
        stoppedRecordingSessions.add(recording.id);
      } catch (stopError) {
        logger.error(
          'Failed to stop recording after archive failure',
          stopError
        );
        errorToReport = new Error(
          `${archiveFailure.message} Native capture could not stop: ${errorMessage(stopError)}. Retry Stop.`,
          { cause: stopError }
        );
        recording.captureError = errorToReport;
      } finally {
        markAudioForwardCaptureStopped(recording.id);
      }
    }
    if (errorToReport) {
      recordingStateMachine.dispatch({
        type: 'CREATE_BLOCK_FAILED',
        id: status.id,
        error: errorToReport,
      });
    }
  };
  const archive = new RawRecordingArchive(file, {
    onFailure: failCapture,
  });

  function tapAudioSamples(err: Error | null, samples: Float32Array) {
    const recordingStatus = recordingStatus$.getValue();
    if (
      !recordingStatus ||
      recordingStatus.id !== status.id ||
      recordingStatus.status !== 'recording'
    ) {
      return;
    }

    if (err) {
      failCapture(err);
      return;
    }

    try {
      archive.write(samples);
    } catch {
      // RawRecordingArchive has already surfaced and retained the failure.
      return;
    }
    archiveBytes = archive.bytesAccepted;
    if (recording) {
      recording.archiveBytes = archiveBytes;
    }

    // Forward only frames accepted by the durable archive so recovery never
    // claims bytes that were dropped during disk pressure.
    forwardAudioSamples(status.id, samples);
  }

  // MUST require dynamically to avoid loading @nota/native for unsupported platforms
  const SC: typeof ShareableContentType =
    require('@nota/native').ShareableContent;

  const stream = status.app
    ? SC.tapAudio(status.app.processId, tapAudioSamples)
    : SC.tapGlobalAudio(null, tapAudioSamples);
  systemAudioAccessProbe.markGranted();
  try {
    systemAudioRecovery.updateFormat(
      status.id,
      stream.channels,
      stream.sampleRate,
      status.startTime
    );
  } catch (error) {
    stream.stop();
    file.destroy();
    throw error;
  }

  recording = {
    archive,
    archiveBytes,
    captureError: archiveFailure,
    id: status.id,
    startTime: status.startTime,
    app: status.app,
    appGroup: status.appGroup,
    file,
    session: stream,
  };

  recordings.set(status.id, recording);
  if (archiveFailure) {
    failCapture(archiveFailure);
  }

  return recording;
}

async function stopRecordingSession(recording: Recording, reason: string) {
  if (stoppedRecordingSessions.has(recording.id)) {
    logger.info(
      `Recording ${recording.id} native session already stopped; skipping ${reason}`
    );
    markAudioForwardCaptureStopped(recording.id);
    return;
  }

  try {
    recording.session.stop();
    stoppedRecordingSessions.add(recording.id);
  } catch (err) {
    logger.error(`Failed to stop audio stream during ${reason}`, err);
    throw err;
  } finally {
    // Stop live posts even when native resources need another stop attempt.
    // Keep the acknowledgement cursor/session for archive finalization.
    markAudioForwardCaptureStopped(recording.id);
  }
}

export async function getRecording(id: number) {
  const recording = recordings.get(id);
  if (!recording) {
    logger.error(`Recording ${id} not found`);
    return;
  }
  const rawFilePath = String(recording.file.path);
  return {
    archiveBytes: recording.archiveBytes,
    id,
    appGroup: recording.appGroup,
    app: recording.app,
    startTime: recording.startTime,
    filepath: rawFilePath,
    sampleRate: recording.session.sampleRate,
    numberOfChannels: recording.session.channels,
  };
}

// recording popup status
// new: recording is started, popup is shown
// recording: recording is started, popup is shown
// stopped: recording is stopped, popup showing processing status
// create-block-success: recording is ready, show "open app" button
// create-block-failed: recording is failed, show "failed to save" button
// null: hide popup
function setupRecordingListeners() {
  subscribers.push(
    recordingStatus$
      .pipe(distinctUntilChanged(shallowEqual))
      .subscribe(status => {
        const popup = popupManager.get('recording');

        if (status?.suppressPopup) {
          if (popup.showing) {
            popup.hide().catch(err => {
              logger.error('failed to hide suppressed recording popup', err);
            });
          }
        } else if (status && !popup.showing) {
          popup.show().catch(err => {
            logger.error('failed to show recording popup', err);
          });
        }

        if (status?.status === 'recording') {
          let recording = recordings.get(status.id);
          // create a recording if not exists
          if (!recording) {
            recording = createRecording(status);
          }
        } else if (status?.status === 'stopped') {
          const recording = recordings.get(status.id);
          if (recording) {
            stopRecordingSession(
              recording,
              'recording status transition'
            ).catch(error => {
              logger.error('Failed to drain stopped recording', error);
            });
          }
        } else if (
          !status?.suppressPopup &&
          (status?.status === 'create-block-success' ||
            status?.status === 'create-block-failed')
        ) {
          // show the popup for 10s
          setTimeout(
            () => {
              // check again if current status is still ready
              if (
                (recordingStatus$.value?.status === 'create-block-success' ||
                  recordingStatus$.value?.status === 'create-block-failed') &&
                recordingStatus$.value.id === status.id
              ) {
                popup.hide().catch(err => {
                  logger.error('failed to hide recording popup', err);
                });
              }
            },
            status?.status === 'create-block-failed' ? 30_000 : 10_000
          );
        } else if (!status) {
          // status is removed, we should hide the popup
          popupManager
            .get('recording')
            .hide()
            .catch(err => {
              logger.error('failed to hide recording popup', err);
            });
        }
      })
  );
}

function getAllApps(): TappableAppInfo[] {
  if (!recordingFeatureInitialized) {
    return [];
  }

  // MUST require dynamically to avoid loading @nota/native for unsupported platforms
  ensureNativeRecordingRuntimeDependencies();
  const { ShareableContent } = require('@nota/native') as {
    ShareableContent: typeof ShareableContentType;
  };

  const apps = ShareableContent.applications().map(app => {
    try {
      // Check if this process is actively using microphone/audio
      const isRunning = ShareableContent.isUsingMicrophone(app.processId);

      return {
        info: app,
        processId: app.processId,
        processGroupId: app.processGroupId,
        bundleIdentifier: app.bundleIdentifier,
        name: app.name,
        isRunning,
      };
    } catch (error) {
      logger.error('failed to get app info', error);
      return null;
    }
  });

  const filteredApps = apps.filter(
    (v): v is TappableAppInfo =>
      v !== null &&
      !v.bundleIdentifier.startsWith('com.apple') &&
      !v.bundleIdentifier.startsWith('pro.nota') &&
      v.processId !== process.pid
  );
  return filteredApps;
}

type Subscriber = {
  unsubscribe: () => void;
};

function setupMediaListeners() {
  ensureNativeRecordingRuntimeDependencies();
  const ShareableContent = require('@nota/native').ShareableContent;
  applications$.next(getAllApps());
  subscribers.push(
    interval(3000).subscribe(() => {
      updateApplicationsPing$.next(Date.now());
    })
  );
  subscribers.push(
    ShareableContent.onApplicationListChanged(() => {
      updateApplicationsPing$.next(Date.now());
    })
  );
  subscribers.push(
    updateApplicationsPing$
      .pipe(distinctUntilChanged(), throttleTime(3000))
      .subscribe(() => {
        applications$.next(getAllApps());
      })
  );

  let appStateSubscribers: Subscriber[] = [];
  const cleanupAppStateSubscribers = () => {
    appStateSubscribers.forEach(unsubscribeSafely);
    appStateSubscribers = [];
  };

  subscribers.push(
    {
      unsubscribe: cleanupAppStateSubscribers,
    },
    applications$.subscribe(apps => {
      cleanupAppStateSubscribers();
      const _appStateSubscribers: Subscriber[] = [];

      apps.forEach(app => {
        try {
          const applicationInfo = app.info;
          _appStateSubscribers.push(
            ShareableContent.onAppStateChanged(applicationInfo, () => {
              updateApplicationsPing$.next(Date.now());
            })
          );
        } catch (error) {
          logger.error(
            `Failed to set up app state listener for ${app.name}`,
            error
          );
        }
      });

      appStateSubscribers = _appStateSubscribers;
    })
  );
}

// will be called when the app is ready or when the user has enabled the recording feature in settings
export function setupRecordingFeature() {
  if (!MeetingsSettingsState.value.enabled) {
    return;
  }

  const runtime = getRecordingRuntimeStatus();
  if (!runtime.available) {
    return false;
  }
  if (recordingFeatureInitialized) {
    return true;
  }

  const subscriberStart = subscribers.length;
  try {
    ensureNativeRecordingRuntimeDependencies();
    recordingFeatureInitialized = true;
    setupMediaListeners();
    // reset all states
    recordingStatus$.next(null);
    setupAppGroups();
    setupNewRunningAppGroup();
    setupRecordingListeners();
    return true;
  } catch (error) {
    subscribers.splice(subscriberStart).forEach(unsubscribeSafely);
    recordingFeatureInitialized = false;
    logger.error('failed to setup recording feature', error);
    return false;
  }
}

export function disableRecordingFeature() {
  recordingStatus$.next(null);
  return cleanup();
}

function normalizeAppGroupInfo(
  appGroup?: AppGroupInfo | number
): AppGroupInfo | undefined {
  return typeof appGroup === 'number'
    ? appGroups$.value.find(group => group.processGroupId === appGroup)
    : appGroup;
}

export interface StartRecordingOptions {
  meetingId?: string;
  suppressPopup?: boolean;
  workspaceId?: string;
}

export function newRecording(
  appGroup?: AppGroupInfo | number,
  options?: StartRecordingOptions
): RecordingStatus | null {
  return recordingStateMachine.dispatch({
    type: 'NEW_RECORDING',
    appGroup: normalizeAppGroupInfo(appGroup),
    suppressPopup: options?.suppressPopup,
  });
}

export function startRecording(
  appGroup?: AppGroupInfo | number,
  options?: StartRecordingOptions
): RecordingStatus | null {
  const state = recordingStateMachine.dispatch(
    {
      type: 'START_RECORDING',
      appGroup: normalizeAppGroupInfo(appGroup),
      suppressPopup: options?.suppressPopup,
    },
    false
  );

  if (state?.status === 'recording' && options?.meetingId) {
    if (!options.workspaceId) {
      throw new Error('workspaceId is required for meeting capture recovery.');
    }
    systemAudioRecovery.begin({
      meetingId: options.meetingId,
      rawPath: rawRecordingPath(state),
      recordingId: state.id,
      startTime: state.startTime,
      workspaceId: options.workspaceId,
    });
  }

  // Publish the state before opening the native tap. Some bindings can emit
  // their first frame synchronously; the callback must already see recording.
  recordingStateMachine.status$.next(state);

  if (state?.status === 'recording') {
    createRecording(state);
  }

  return state;
}

export function pauseRecording(id: number) {
  return recordingStateMachine.dispatch({ type: 'PAUSE_RECORDING', id });
}

export function resumeRecording(id: number) {
  return recordingStateMachine.dispatch({ type: 'RESUME_RECORDING', id });
}

export async function stopRecording(id: number) {
  const recording = recordings.get(id);
  if (!recording) {
    logger.error(`stopRecording: Recording ${id} not found`);
    return;
  }

  if (!recording.file.path) {
    logger.error(`Recording ${id} has no file path`);
    return;
  }

  const { file } = recording;

  // First stop the audio stream to prevent more data coming in.
  await stopRecordingSession(recording, 'stopRecording');

  // Drain the bounded archive queue and end the file with a timeout.
  let archiveFinished = false;

  try {
    await Promise.race([
      recording.archive.end(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('File writing timeout')), 10000)
      ),
    ]);
    const stats = fs.statSync(file.path);
    if (stats.size === 0) {
      throw new Error('Recording is empty');
    }
    archiveFinished = true;
    systemAudioRecovery.markStopped(id, stats.size, recording.startTime);

    const recordingStatus = recordingStateMachine.dispatch({
      type: 'STOP_RECORDING',
      id,
    });

    if (!recordingStatus) {
      logger.error('No recording status to stop');
      return;
    }
    return serializeRecordingStatus(recordingStatus);
  } catch (error: unknown) {
    logger.error('Failed to stop recording', error);
    const recordingStatus = recordingStateMachine.dispatch({
      type: 'CREATE_BLOCK_FAILED',
      id,
      error: error instanceof Error ? error : undefined,
    });
    if (!recordingStatus) {
      logger.error('No recording status to stop');
      return;
    }
    return serializeRecordingStatus(recordingStatus);
  } finally {
    // If the writer failed or timed out, close it before measuring the final
    // recoverable archive. A short/truncated archive is reported by the drain
    // contract instead of being treated as a successful transcript flush.
    if (!archiveFinished && !file.closed) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1000);
        file.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
        file.destroy();
      });
    }

    try {
      const drain = await stopAudioForwardForRecording(id);
      if (drain && !drain.complete) {
        logger.error(
          `Recording ${id} audio forward drain is incomplete at ${drain.cursor}/${drain.archive}: ${drain.reason}`
        );
      }
    } catch (error) {
      logger.error(`Failed to finalize recording ${id} audio archive`, error);
    }

    // Clean up the file stream if it's still open after archive backfill.
    if (!file.closed) {
      file.destroy();
    }
    if (!archiveFinished) {
      try {
        const archiveBytes = fs.existsSync(String(file.path))
          ? fs.statSync(String(file.path)).size
          : recording.archive.bytesAccepted;
        systemAudioRecovery.markStopped(id, archiveBytes, recording.startTime);
      } catch (error) {
        logger.error(`Failed to journal stopped recording ${id}`, error);
      }
    }
  }
}

export async function getRawAudioBuffers(
  id: number,
  cursor?: number
): Promise<{
  buffer: Buffer;
  nextCursor: number;
}> {
  const recording = recordings.get(id);
  const recovered = recording
    ? null
    : systemAudioRecovery.findByRecordingId(id);
  const filepath = recording
    ? String(recording.file.path)
    : recovered?.filepath;
  const channels = recording?.session.channels ?? recovered?.numberOfChannels;
  if (!filepath || !/\.raw$/i.test(filepath)) {
    throw new Error(`getRawAudioBuffers: Recording ${id} not found`);
  }
  if (!channels) {
    throw new Error(
      `getRawAudioBuffers: Recording ${id} is missing its audio format`
    );
  }
  const file = await fsp.open(filepath, 'r');
  try {
    const stats = await file.stat();
    const window = rawAudioReadWindow({
      channels,
      cursor: cursor ?? 0,
      fileSize: stats.size,
    });
    const buffer = Buffer.allocUnsafe(window.length);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await file.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        window.start + bytesRead
      );
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }

    const frameBytes = Float32Array.BYTES_PER_ELEMENT * channels;
    const completeBytesRead = Math.floor(bytesRead / frameBytes) * frameBytes;
    return {
      buffer: buffer.subarray(0, completeBytesRead),
      nextCursor: window.start + completeBytesRead,
    };
  } finally {
    await file.close();
  }
}

function assertRecordingFilepath(filepath: string) {
  const normalizedPath = path.normalize(filepath);
  const normalizedBase = path.normalize(SAVED_RECORDINGS_DIR + path.sep);

  if (!normalizedPath.toLowerCase().startsWith(normalizedBase.toLowerCase())) {
    throw new Error('Invalid recording filepath');
  }

  return normalizedPath;
}

export async function readRecordingFile(filepath: string) {
  const normalizedPath = assertRecordingFilepath(filepath);
  return fsp.readFile(normalizedPath);
}

export async function readyRecording(id: number, buffer: Buffer) {
  logger.info('readyRecording', id);

  const recordingStatus = recordingStatus$.value;
  const recording = recordings.get(id);
  const recovered = systemAudioRecovery.findByRecordingId(
    id,
    recording?.startTime ??
      (recordingStatus?.id === id ? recordingStatus.startTime : undefined)
  );
  if (recovered) {
    const filepath = await systemAudioRecovery.publishPortable(
      id,
      buffer,
      recovered.startTime
    );
    if (!filepath) {
      throw new Error(`Recovered recording ${id} could not be published.`);
    }
    if (recordingStatus?.id === id) {
      recordingStateMachine.dispatch({
        type: 'SAVE_RECORDING',
        id,
        filepath,
      });
    }
    return filepath;
  }
  if (!recordingStatus || recordingStatus.id !== id || !recording) {
    logger.error(`readyRecording: Recording ${id} not found`);
    return;
  }

  const rawFilePath = String(recording.file.path);

  const filepath = rawFilePath.replace('.raw', '.opus');

  if (!filepath) {
    logger.error(`readyRecording: Recording ${id} has no filepath`);
    return;
  }

  await fs.writeFile(filepath, buffer);

  // can safely remove the raw file now
  logger.info('remove raw file', rawFilePath);
  if (rawFilePath) {
    try {
      await fs.unlink(rawFilePath);
    } catch (err) {
      logger.error('failed to remove raw file', err);
    }
  }
  // Update the status through the state machine
  recordingStateMachine.dispatch({
    type: 'SAVE_RECORDING',
    id,
    filepath,
  });

  // bring up the window
  getMainWindow()
    .then(mainWindow => {
      if (mainWindow) {
        mainWindow.show();
      }
    })
    .catch(err => {
      logger.error('failed to bring up the window', err);
    });
  return filepath;
}

export async function handleBlockCreationSuccess(id: number) {
  recordingStateMachine.dispatch({
    type: 'CREATE_BLOCK_SUCCESS',
    id,
  });
}

export async function handleBlockCreationFailed(id: number, error?: Error) {
  recordingStateMachine.dispatch({
    type: 'CREATE_BLOCK_FAILED',
    id,
    error,
  });
}

export function removeRecording(id: number, meetingId?: string) {
  stoppedRecordingSessions.delete(id);
  recordings.delete(id);
  recordingStateMachine.dispatch({ type: 'REMOVE_RECORDING', id });
  if (meetingId) {
    systemAudioRecovery.release(id, meetingId);
  }
}

export interface SerializedRecordingStatus {
  archiveBytes?: number;
  id: number;
  status: RecordingStatus['status'];
  appName?: string;
  // if there is no app group, it means the recording is for system audio
  appGroupId?: number;
  icon?: Buffer;
  startTime: number;
  filepath?: string;
  sampleRate?: number;
  numberOfChannels?: number;
  meetingId?: string;
  recovered?: boolean;
  suppressPopup?: boolean;
  workspaceId?: string;
  error?: string;
}

export function serializeRecoveredRecordingStatus(): SerializedRecordingStatus | null {
  const recovered = systemAudioRecovery.latest();
  if (!recovered) {
    return null;
  }
  return {
    archiveBytes: recovered.archiveBytes,
    filepath: recovered.filepath,
    id: recovered.recordingId,
    meetingId: recovered.meetingId,
    numberOfChannels: recovered.numberOfChannels ?? undefined,
    recovered: true,
    sampleRate: recovered.sampleRate ?? undefined,
    startTime: recovered.startTime,
    status: recovered.status,
    workspaceId: recovered.workspaceId,
  };
}

export function serializeRecordingStatus(
  status: RecordingStatus
): SerializedRecordingStatus | null {
  const recording = recordings.get(status.id);
  const meetingRecovery = systemAudioRecovery.findByRecordingId(
    status.id,
    status.startTime
  );
  return {
    archiveBytes: recording?.archiveBytes ?? meetingRecovery?.archiveBytes,
    id: status.id,
    status: status.status,
    appName: status.appGroup?.name,
    appGroupId: status.appGroup?.processGroupId,
    icon: status.appGroup?.icon,
    startTime: status.startTime,
    filepath:
      status.filepath ?? (recording ? String(recording.file.path) : undefined),
    meetingId: meetingRecovery?.meetingId,
    sampleRate: recording?.session.sampleRate,
    numberOfChannels: recording?.session.channels,
    suppressPopup: status.suppressPopup,
    workspaceId: meetingRecovery?.workspaceId,
    error: status.error ?? recording?.captureError?.message,
  };
}

export const getMacOSVersion = () => {
  try {
    const stdout = execSync('sw_vers -productVersion').toString();
    const [major, minor, patch] = stdout.trim().split('.').map(Number);
    return { major, minor, patch };
  } catch (error) {
    logger.error('Failed to get MacOS version', error);
    return { major: 0, minor: 0, patch: 0 };
  }
};

// check if the system is MacOS and the version is >= 14.2
export const checkRecordingAvailable = () => {
  if (isMacOS()) {
    const version = getMacOSVersion();
    return (version.major === 14 && version.minor >= 2) || version.major > 14;
  }
  if (isWindows()) {
    return true;
  }
  return false;
};

export type MeetingMediaAccessStatus =
  | 'denied'
  | 'granted'
  | 'not-determined'
  | 'restricted'
  | 'unknown';

export interface MeetingPermissionReport {
  checkedAt: number;
  microphone: boolean;
  permissionClient: MacOSPermissionClient;
  ready: boolean;
  runtime: ReturnType<typeof getRecordingRuntimeStatus>;
  systemAudio: boolean;
  systemAudioAccessSource:
    | 'core-audio-probe'
    | 'not-checked'
    | 'platform-compatibility'
    | 'unavailable';
  reasons: Partial<Record<'microphone' | 'systemAudio', string>>;
  statuses: Record<'microphone' | 'systemAudio', MeetingMediaAccessStatus>;
}

export type CheckMeetingPermissionOptions = {
  /**
   * Start and stop the real Core Audio tap to verify System Audio access.
   * Leave this false for passive page/settings refreshes because creating the
   * tap can itself trigger the macOS permission prompt.
   */
  probeSystemAudio?: boolean;
  /** Bypass the short duplicate-probe cache for recording startup. */
  forceSystemAudioProbe?: boolean;
};

export const checkMeetingPermissions = (
  options: CheckMeetingPermissionOptions = {}
) => {
  const runtime = getRecordingRuntimeStatus();
  if (isWindows()) {
    let microphoneStatus: MeetingMediaAccessStatus = 'unknown';
    try {
      microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
    } catch (error) {
      logger.error('Failed to read Windows microphone access status', error);
    }
    const microphone = microphoneStatus === 'granted';
    const microphoneReasons = {
      denied:
        'Windows microphone access is off. Enable microphone access for desktop apps in Windows Settings, then try again.',
      restricted:
        'Windows microphone access is restricted by system policy. Check Windows Settings or contact your administrator.',
      'not-determined':
        'Windows microphone access has not been determined. Starting a recording will attempt microphone capture.',
      unknown:
        'Windows microphone access could not be verified. Starting a recording will attempt microphone capture.',
    };
    return {
      checkedAt: Date.now(),
      // Compatibility means Windows capture can be attempted, not that WASAPI
      // access is verified. The screen permission API cannot verify it.
      systemAudio: true,
      microphone,
      permissionClient: getMacOSPermissionClient(),
      ready: runtime.available && microphone,
      runtime,
      systemAudioAccessSource: 'platform-compatibility',
      reasons: {
        systemAudio:
          'Windows system audio access is verified when recording starts.',
        ...(microphoneStatus === 'granted'
          ? {}
          : { microphone: microphoneReasons[microphoneStatus] }),
      },
      statuses: {
        systemAudio: 'unknown',
        microphone: microphoneStatus,
      },
    } satisfies MeetingPermissionReport;
  }

  if (!isMacOS()) {
    return undefined;
  }
  const microphoneStatus = systemPreferences.getMediaAccessStatus('microphone');
  const systemAudioAccess =
    options.probeSystemAudio || options.forceSystemAudioProbe
      ? systemAudioAccessProbe.check(options.forceSystemAudioProbe)
      : systemAudioAccessProbe.peek();
  const systemAudio = systemAudioAccess?.available ?? false;
  const microphone = microphoneStatus === 'granted';

  return {
    checkedAt: Date.now(),
    systemAudio,
    microphone,
    permissionClient: getMacOSPermissionClient(),
    ready: systemAudio && microphone && runtime.available,
    runtime,
    systemAudioAccessSource: systemAudioAccess
      ? 'core-audio-probe'
      : 'not-checked',
    reasons: systemAudioAccess?.reason
      ? { systemAudio: systemAudioAccess.reason }
      : {},
    statuses: {
      systemAudio: systemAudioAccess?.status ?? 'unknown',
      microphone: microphoneStatus,
    },
  } satisfies MeetingPermissionReport;
};

export const askForMeetingPermission = async (
  type: 'microphone' | 'screen' | 'systemAudio'
) => {
  if (!isMacOS()) {
    return false;
  }
  if (type === 'screen' || type === 'systemAudio') {
    return systemAudioAccessProbe.check(true).available;
  }
  return systemPreferences.askForMediaAccess(type);
};
