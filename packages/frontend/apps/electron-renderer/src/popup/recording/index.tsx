import { useAsyncCallback } from '@nota/core/components/hooks/nota-async-hooks';
import {
  createStreamEncoder,
  type OpusStreamEncoder,
} from '@nota/core/utils/opus-encoding';
import { apis, events } from '@nota/electron-api';
import { useI18n } from '@nota/i18n';
import track from '@nota/track';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './styles.css';

function VoiceprintIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 18 0h-2Z" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="5" width="3" height="14" rx="1" />
      <rect x="14" y="5" width="3" height="14" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

type Status = {
  id: number;
  status:
    | 'new'
    | 'recording'
    | 'paused'
    | 'stopped'
    | 'ready'
    | 'create-block-success'
    | 'create-block-failed';
  appName?: string;
  appGroupId?: number;
  icon?: Buffer;
  filepath?: string;
  sampleRate?: number;
  numberOfChannels?: number;
  startTime?: number;
  suppressPopup?: boolean;
};

export const useRecordingStatus = () => {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    apis?.recording
      .getCurrentRecording()
      .then(status => setStatus(status satisfies Status | null))
      .catch(console.error);

    const unsubscribe = events?.recording.onRecordingStatusChanged(status =>
      setStatus(status satisfies Status | null)
    );

    return () => {
      unsubscribe?.();
    };
  }, []);

  return status;
};

function formatElapsedTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(
      seconds
    ).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}`;
}

export function Recording() {
  const status = useRecordingStatus();
  const t = useI18n();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (
      !status ||
      (status.status !== 'recording' && status.status !== 'paused')
    ) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(
        Math.max(
          0,
          Math.floor((Date.now() - (status.startTime ?? Date.now())) / 1000)
        )
      );
    };

    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [status]);

  const handleDismiss = useAsyncCallback(async () => {
    await apis?.popup?.dismissCurrentRecording();
    track.popup.$.recordingBar.dismissRecording({
      type: 'Meeting record',
      appName: status?.appName || 'System Audio',
    });
  }, [status]);

  const handleStopRecording = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    track.popup.$.recordingBar.finishRecording({
      type: 'Meeting record',
      appName: status.appName || 'System Audio',
    });
    await apis?.recording?.stopRecording(status.id);
  }, [status]);

  const handlePauseRecording = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    await apis?.recording?.pauseRecording(status.id);
  }, [status]);

  const handleResumeRecording = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    await apis?.recording?.resumeRecording(status.id);
  }, [status]);

  const handleProcessStoppedRecording = useAsyncCallback(
    async (currentStreamEncoder?: OpusStreamEncoder) => {
      let id: number | undefined;
      try {
        const result = await apis?.recording?.getCurrentRecording();

        if (!result) {
          return;
        }

        id = result.id;

        const { filepath, sampleRate, numberOfChannels } = result;
        if (!filepath || !sampleRate || !numberOfChannels) {
          return;
        }
        const streamEncoder =
          currentStreamEncoder ??
          createStreamEncoder(result.id, {
            sampleRate,
            numberOfChannels,
          });
        const [buffer] = await Promise.all([
          streamEncoder.finish(),
          new Promise<void>(resolve => {
            setTimeout(() => {
              resolve();
            }, 500);
          }),
        ]);
        await apis?.recording.readyRecording(result.id, buffer);
      } catch (error) {
        console.error('Failed to stop recording', error);
        await apis?.popup?.dismissCurrentRecording();
        if (id) {
          await apis?.recording.removeRecording(id);
        }
      }
    },
    []
  );

  useEffect(() => {
    let removed = false;
    let currentStreamEncoder: OpusStreamEncoder | undefined;

    apis?.recording
      .getCurrentRecording()
      .then(status => {
        if (status) {
          return handleRecordingStatusChanged(status);
        }
        return;
      })
      .catch(console.error);

    const handleRecordingStatusChanged = async (status: Status) => {
      if (removed) {
        return;
      }

      // The Meetings workspace owns suppressed captures, including transcript
      // draining and final archive cleanup. The generic popup encoder must not
      // race that flow by deleting its raw archive behind it.
      if (status.suppressPopup) {
        currentStreamEncoder?.close();
        currentStreamEncoder = undefined;
        return;
      }

      if (status?.status === 'new') {
        track.popup.$.recordingBar.toggleRecordingBar({
          type: 'Meeting record',
          appName: status.appName || 'System Audio',
        });
      }

      if (
        status?.status === 'recording' &&
        status.sampleRate &&
        status.numberOfChannels &&
        (!currentStreamEncoder || currentStreamEncoder.id !== status.id)
      ) {
        currentStreamEncoder?.close();
        currentStreamEncoder = createStreamEncoder(status.id, {
          sampleRate: status.sampleRate,
          numberOfChannels: status.numberOfChannels,
        });
        currentStreamEncoder.poll().catch(console.error);
      }

      if (status?.status === 'stopped') {
        handleProcessStoppedRecording(currentStreamEncoder);
        currentStreamEncoder = undefined;
      }
    };

    const unsubscribe = events?.recording.onRecordingStatusChanged(status => {
      if (status) {
        handleRecordingStatusChanged(status).catch(console.error);
      }
    });

    return () => {
      removed = true;
      unsubscribe?.();
      currentStreamEncoder?.close();
    };
  }, [handleProcessStoppedRecording]);

  const handleStartRecording = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    track.popup.$.recordingBar.startRecording({
      type: 'Meeting record',
      appName: status.appName || 'System Audio',
    });
    await apis?.recording?.startRecording(status.appGroupId);
  }, [status]);

  const handleOpenFile = useAsyncCallback(async () => {
    if (!status) {
      return;
    }
    await apis?.recording?.showSavedRecordings(status.filepath);
  }, [status]);

  const statusText = useMemo(() => {
    if (!status) {
      return '';
    }

    if (status.status === 'new') {
      return 'Ready to record';
    }

    if (status.status === 'paused') {
      return 'Paused';
    }

    if (status.status === 'stopped' || status.status === 'ready') {
      return 'Saving';
    }

    if (status.status === 'create-block-success') {
      return 'Saved';
    }

    if (status.status === 'create-block-failed') {
      return 'Save failed';
    }

    return 'Recording';
  }, [status]);

  const statusMeta = useMemo(() => {
    if (!status) {
      return '';
    }

    const source = status.appName || 'System audio';

    if (status.status === 'new') {
      return source;
    }

    if (status.status === 'recording' || status.status === 'paused') {
      return `${formatElapsedTime(elapsedSeconds)} · ${source}`;
    }

    if (status.status === 'stopped' || status.status === 'ready') {
      return 'Preparing the note';
    }

    if (status.status === 'create-block-success') {
      return source;
    }

    if (status.status === 'create-block-failed') {
      return 'Open saved file or dismiss';
    }

    return source;
  }, [elapsedSeconds, status]);

  const statusState = useMemo(() => status?.status ?? 'new', [status]);

  const controlsElement = useMemo(() => {
    if (!status) {
      return null;
    }

    if (status.status === 'new') {
      return (
        <button
          className={styles.startButton}
          type="button"
          onClick={() => {
            handleStartRecording();
          }}
        >
          <VoiceprintIcon />
          <span>{t['com.affine.recording.start']()}</span>
        </button>
      );
    }

    if (status.status === 'recording') {
      return (
        <>
          <button
            className={styles.secondaryButton}
            aria-label="Pause recording"
            title="Pause recording"
            type="button"
            onClick={() => {
              handlePauseRecording();
            }}
          >
            <PauseIcon />
          </button>
          <button
            className={styles.stopButton}
            aria-label="Stop recording"
            title="Stop recording"
            type="button"
            onClick={() => {
              handleStopRecording();
            }}
          >
            <StopIcon />
          </button>
        </>
      );
    }

    if (status.status === 'paused') {
      return (
        <>
          <button
            className={styles.secondaryButton}
            aria-label="Resume recording"
            title="Resume recording"
            type="button"
            onClick={() => {
              handleResumeRecording();
            }}
          >
            <PlayIcon />
          </button>
          <button
            className={styles.stopButton}
            aria-label="Stop recording"
            title="Stop recording"
            type="button"
            onClick={() => {
              handleStopRecording();
            }}
          >
            <StopIcon />
          </button>
        </>
      );
    }

    if (status.status === 'stopped' || status.status === 'ready') {
      return (
        <button className={styles.processingButton} disabled type="button">
          <span className={styles.spinner} />
          <span>Saving...</span>
        </button>
      );
    }

    if (status.status === 'create-block-success') {
      return (
        <button
          className={styles.doneButton}
          type="button"
          onClick={() => {
            handleDismiss();
          }}
        >
          <VoiceprintIcon />
          <span>{t['com.affine.recording.success.button']()}</span>
        </button>
      );
    }

    return (
      <>
        <button
          className={styles.dismissButton}
          type="button"
          onClick={() => {
            handleDismiss();
          }}
        >
          {t['com.affine.recording.dismiss']()}
        </button>
        <button
          className={styles.errorButton}
          type="button"
          onClick={() => {
            handleOpenFile();
          }}
        >
          {t['com.affine.recording.failed.button']()}
        </button>
      </>
    );
  }, [
    handleDismiss,
    handleOpenFile,
    handlePauseRecording,
    handleResumeRecording,
    handleStartRecording,
    handleStopRecording,
    status,
    t,
  ]);

  if (!status) {
    return null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.capsule}>
        <div className={styles.statusGroup}>
          <div className={styles.iconWrap} data-state={statusState}>
            <VoiceprintIcon />
            <span className={styles.statusDot} data-state={statusState} />
          </div>
          <div className={styles.statusCopy}>
            <span className={styles.statusTitle}>{statusText}</span>
            <span className={styles.statusMeta}>{statusMeta}</span>
          </div>
        </div>
        <div className={styles.controls}>{controlsElement}</div>
      </div>
    </div>
  );
}
