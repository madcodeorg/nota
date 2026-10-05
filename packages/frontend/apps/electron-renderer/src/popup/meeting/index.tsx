import { apis } from '@nota/electron-api';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './styles.css';

type MeetingPopupState = {
  backend: {
    available: boolean;
    error?: string | null;
  };
  calendar: {
    authorized: boolean;
    reason?: string | null;
    status: string;
    supported: boolean;
  };
  now: string;
  recording: {
    elapsedMs?: number | null;
    meetingId?: string | null;
    providerId?: string | null;
    startTime?: number | null;
    status: 'idle' | 'paused' | 'recording';
    sttMessage?: string | null;
    sttStatus?: string | null;
    transcriptCount?: number;
  };
  upcoming: {
    calendarColor?: string | null;
    calendarName?: string | null;
    endAt: string;
    endsInMs: number;
    id: string;
    isLive: boolean;
    isSoon: boolean;
    meetingUrl?: string | null;
    source: 'eventkit' | 'google';
    startAt: string;
    startsInMs: number;
    title: string;
    url?: string | null;
  } | null;
};

type MeetingPopupApi = {
  dismissMeetingPopup?: () => Promise<unknown>;
  getMeetingPopupState?: () => Promise<MeetingPopupState | null>;
  joinMeetingFromPopup?: (url: string) => Promise<unknown>;
  startAndJoinMeetingFromPopup?: (url: string) => Promise<unknown>;
  startMeetingFromPopup?: () => Promise<unknown>;
  stopMeetingFromPopup?: () => Promise<unknown>;
};

function popupApi() {
  return apis?.popup as MeetingPopupApi | undefined;
}

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

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function JoinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="m7 7 10 10" />
      <path d="m17 7-10 10" />
    </svg>
  );
}

function formatDuration(ms?: number | null) {
  if (!ms || ms < 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

function formatStartsIn(ms: number) {
  if (ms <= 0) {
    return 'now';
  }
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function useMeetingPopupState() {
  const [state, setState] = useState<MeetingPopupState | null>(null);

  const refresh = useCallback(async () => {
    const next = (await popupApi()?.getMeetingPopupState?.()) as
      | MeetingPopupState
      | null
      | undefined;
    if (next) {
      setState(next);
    }
  }, []);

  useEffect(() => {
    let disposed = false;

    const refreshSafely = async () => {
      try {
        const next = (await popupApi()?.getMeetingPopupState?.()) as
          | MeetingPopupState
          | null
          | undefined;
        if (!disposed && next) {
          setState(next);
        }
      } catch (error) {
        console.error('Failed to refresh meeting popup state', error);
      }
    };

    refreshSafely().catch(console.error);
    const interval = window.setInterval(() => {
      refreshSafely().catch(console.error);
    }, 2500);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  return { refresh, state };
}

export function MeetingPopup() {
  const { refresh, state } = useMeetingPopupState();
  const [tick, setTick] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const active = state?.recording.status === 'recording';
  const paused = state?.recording.status === 'paused';
  const upcoming = state?.upcoming ?? null;
  const joinUrl = upcoming?.meetingUrl ?? upcoming?.url ?? null;
  const elapsedMs = useMemo(() => {
    if (!state?.recording.startTime) {
      return state?.recording.elapsedMs ?? 0;
    }
    return Math.max(0, tick - state.recording.startTime);
  }, [state?.recording.elapsedMs, state?.recording.startTime, tick]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        await action();
        await refresh();
      } catch (error) {
        console.error('Meeting popup action failed', error);
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh]
  );

  const status = useMemo(() => {
    if (active || paused) {
      return {
        action: 'Stop',
        actionLabel: 'Stop meeting recording',
        primary: paused ? 'Paused' : 'Recording',
        secondary: formatDuration(elapsedMs),
        state: paused ? 'paused' : 'recording',
      } as const;
    }

    if (upcoming) {
      const soon = upcoming.isLive || upcoming.isSoon;
      return {
        action: joinUrl && soon ? 'Join' : 'Start',
        actionLabel:
          joinUrl && soon ? 'Start and join meeting' : 'Start meeting capture',
        primary: upcoming.title || 'Meeting',
        secondary: upcoming.isLive
          ? 'Live now'
          : `Starts in ${formatStartsIn(upcoming.startsInMs)}`,
        state: soon ? 'soon' : 'idle',
      } as const;
    }

    return {
      action: 'Start',
      actionLabel: 'Start meeting capture',
      primary: 'Meetings ready',
      secondary: state?.backend.available
        ? 'Local capture ready'
        : 'Backend starting',
      state: 'idle',
    } as const;
  }, [active, elapsedMs, joinUrl, paused, state?.backend.available, upcoming]);

  const handlePrimary = useCallback(() => {
    if (active || paused) {
      runAction(
        () => popupApi()?.stopMeetingFromPopup?.() ?? Promise.resolve()
      ).catch(console.error);
      return;
    }

    if (joinUrl && (upcoming?.isLive || upcoming?.isSoon)) {
      runAction(
        () =>
          popupApi()?.startAndJoinMeetingFromPopup?.(joinUrl) ??
          Promise.resolve()
      ).catch(console.error);
      return;
    }

    runAction(
      () => popupApi()?.startMeetingFromPopup?.() ?? Promise.resolve()
    ).catch(console.error);
  }, [active, joinUrl, paused, runAction, upcoming]);

  return (
    <div className={styles.root}>
      <div className={styles.capsule}>
        <div className={styles.statusGroup}>
          <div className={styles.iconWrap} data-state={status.state}>
            <VoiceprintIcon />
            <span className={styles.statusDot} data-state={status.state} />
          </div>
          <div className={styles.statusCopy}>
            <span className={styles.statusTitle}>{status.primary}</span>
            <span className={styles.statusMeta}>{status.secondary}</span>
          </div>
        </div>
        <div className={styles.controls}>
          <button
            className={
              active || paused ? styles.stopButton : styles.startButton
            }
            aria-label={status.actionLabel}
            disabled={busy}
            title={status.actionLabel}
            type="button"
            onClick={handlePrimary}
          >
            {active || paused ? (
              <StopIcon />
            ) : status.action === 'Join' ? (
              <JoinIcon />
            ) : (
              <VoiceprintIcon />
            )}
            <span>{status.action}</span>
          </button>
          <button
            aria-label="Close meeting popup"
            className={styles.closeButton}
            title="Close meeting popup"
            type="button"
            onClick={() => {
              (popupApi()?.dismissMeetingPopup?.() ?? Promise.resolve()).catch(
                console.error
              );
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
