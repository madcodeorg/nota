import { DesktopApiService } from '@nota/core/modules/desktop-api';
import { presentLocalCalendarPermission } from '@nota/core/modules/integration/local-calendar-permission';
import type { LocalCalendarStatus } from '@nota/core/modules/integration/type';
import type { MeetingPermissionReport } from '@nota/core/modules/media/services/meeting-settings';
import { useServiceOptional } from '@nota/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './nota-welcome.css';

type PermissionTarget = 'microphone' | 'systemAudio';

const calendarBridgeMissing: LocalCalendarStatus = {
  available: false,
  authorized: false,
  reason: 'Desktop calendar bridge is unavailable.',
  status: 'unsupported',
  supported: false,
};

function permissionLabel(status: string | undefined) {
  if (!status) return 'Not checked';
  return status.replaceAll('-', ' ');
}

function recordingMessage(report: MeetingPermissionReport | undefined) {
  if (!report)
    return 'Check access when you are ready. Nota will not ask on its own.';
  if (report.ready) return 'Recording access is ready on this device.';
  if (report.runtime.available === false) {
    return (
      report.runtime.reason ??
      'Meeting recording is not available in this build.'
    );
  }
  return (
    report.reasons.microphone ??
    report.reasons.systemAudio ??
    'Some recording access is still needed. You can finish setup and change it later.'
  );
}

export function NotaPermissionsSetup({
  onContinue,
  onSkip,
}: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  // Talks to the desktop bridge directly so this step also runs in the
  // first-launch window, before any workspace services exist.
  const handler = useServiceOptional(DesktopApiService)?.handler;
  const [calendarStatus, setCalendarStatus] =
    useState<LocalCalendarStatus | null>(null);
  const calendarPermission = useMemo(
    () => presentLocalCalendarPermission(calendarStatus),
    [calendarStatus]
  );
  const [report, setReport] = useState<MeetingPermissionReport>();
  const [busy, setBusy] = useState<
    PermissionTarget | 'check' | 'calendar' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const isWindows = globalThis.environment?.isWindows === true;
  const isMacOs = globalThis.environment?.isMacOs === true;

  useEffect(() => {
    if (!handler) {
      setCalendarStatus(calendarBridgeMissing);
      return;
    }
    handler.calendar
      .getLocalCalendarStatus()
      .then(setCalendarStatus)
      .catch(() => undefined);
  }, [handler]);

  const check = useCallback(async () => {
    setBusy('check');
    setError(null);
    try {
      const next = await handler?.recording.checkMeetingPermissions({
        probeSystemAudio: true,
      });
      if (next) setReport(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }, [handler]);

  const request = useCallback(
    async (target: PermissionTarget) => {
      setBusy(target);
      setError(null);
      try {
        await handler?.recording.askForMeetingPermission(target);
        const next = await handler?.recording.checkMeetingPermissions({
          probeSystemAudio: target === 'systemAudio',
        });
        if (next) setReport(next);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(null);
      }
    },
    [handler]
  );

  const connectCalendar = useCallback(async () => {
    setBusy('calendar');
    setError(null);
    try {
      if (!handler) {
        setCalendarStatus(calendarBridgeMissing);
        return;
      }
      if (calendarPermission.action === 'open-settings') {
        await handler.calendar.showLocalCalendarPermissionSetting();
      } else {
        const next = await handler.calendar.requestLocalCalendarAccess();
        setCalendarStatus(next);
        const nextPermission = presentLocalCalendarPermission(next);
        if (
          nextPermission.action === 'open-settings' ||
          nextPermission.action === 'request-full-access'
        ) {
          await handler.calendar.showLocalCalendarPermissionSetting();
        }
      }
      setCalendarStatus(await handler.calendar.getLocalCalendarStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }, [handler, calendarPermission.action]);

  const calendarAction = calendarPermission.action;
  const calendarUnavailable =
    calendarStatus !== null &&
    (!calendarStatus.supported || calendarStatus.status === 'unsupported');

  return (
    <section aria-label="Recording and calendar permissions">
      <div className={styles.box}>
        <section className={styles.choice}>
          <h3 className={styles.choiceTitle}>Meetings</h3>
          <p className={styles.detail}>
            Microphone and system audio are checked only when you press a
            button.
          </p>
          <div className={styles.permissionGrid}>
            <div>
              <strong>Microphone</strong>
              <span className={styles.permissionStatus}>
                {permissionLabel(report?.statuses.microphone)}
              </span>
            </div>
            <div>
              <strong>System audio</strong>
              <span className={styles.permissionStatus}>
                {permissionLabel(report?.statuses.systemAudio)}
              </span>
            </div>
          </div>
          <p className={styles.detail} role="status">
            {recordingMessage(report)}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={() => void check()}
            >
              {busy === 'check' ? 'Checking…' : 'Check access'}
            </button>
            {isMacOs ? (
              <>
                <button
                  type="button"
                  className={styles.subtle}
                  disabled={busy !== null}
                  onClick={() => void request('microphone')}
                >
                  Allow microphone
                </button>
                <button
                  type="button"
                  className={styles.subtle}
                  disabled={busy !== null}
                  onClick={() => void request('systemAudio')}
                >
                  Allow system audio
                </button>
              </>
            ) : null}
          </div>
          {!isMacOs ? (
            <p className={styles.detail}>
              {isWindows
                ? 'Windows manages recording access in its privacy settings. Nota keeps this step optional and checks support when you start a meeting.'
                : 'This platform exposes recording access when a meeting starts. Nota keeps this step optional.'}
            </p>
          ) : null}
        </section>

        <section className={styles.choice}>
          <h3 className={styles.choiceTitle}>Calendar</h3>
          <p className={styles.detail}>
            Connect Apple Calendar so Nota can show upcoming meetings before you
            record.
          </p>
          <p className={styles.detail} role="status">
            {calendarPermission.title}: {calendarPermission.description}
          </p>
          {calendarAction ? (
            <button
              type="button"
              className={styles.button}
              disabled={busy !== null}
              onClick={() => void connectCalendar()}
            >
              {busy === 'calendar'
                ? 'Checking…'
                : (calendarPermission.actionLabel ?? 'Connect calendar')}
            </button>
          ) : null}
          {calendarUnavailable ? (
            <p className={styles.detail}>
              Apple Calendar is unavailable on this platform. You can continue
              without it.
            </p>
          ) : null}
        </section>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.bottom}>
        <button
          type="button"
          className={styles.subtle}
          disabled={busy !== null}
          onClick={onSkip}
        >
          Skip for now
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={busy !== null}
          onClick={onContinue}
        >
          Continue <span aria-hidden="true">→</span>
        </button>
      </div>
      <p className={styles.caption}>
        You can change recording and calendar access later in Settings.
      </p>
    </section>
  );
}
