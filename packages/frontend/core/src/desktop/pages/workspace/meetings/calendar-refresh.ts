import dayjs, { type Dayjs } from 'dayjs';

export const MEETING_CALENDAR_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type MeetingCalendarRefreshReason = 'interval' | 'resume';

export function startMeetingCalendarRefresh({
  initialDay,
  intervalMs = MEETING_CALENDAR_REFRESH_INTERVAL_MS,
  now = () => dayjs(),
  onRefresh,
}: {
  initialDay: Dayjs;
  intervalMs?: number;
  now?: () => Dayjs;
  onRefresh: (input: {
    day: Dayjs;
    dayChanged: boolean;
    reason: MeetingCalendarRefreshReason;
  }) => void;
}) {
  let dayKey = initialDay.format('YYYY-MM-DD');
  const refreshWhenActive = (reason: MeetingCalendarRefreshReason) => {
    if (document.visibilityState === 'hidden') {
      return;
    }

    const day = now();
    const nextDayKey = day.format('YYYY-MM-DD');
    const dayChanged = nextDayKey !== dayKey;
    dayKey = nextDayKey;
    onRefresh({ day, dayChanged, reason });
  };
  const refreshAfterResume = () => refreshWhenActive('resume');
  const intervalId = window.setInterval(
    () => refreshWhenActive('interval'),
    intervalMs
  );

  window.addEventListener('focus', refreshAfterResume);
  window.addEventListener('online', refreshAfterResume);
  document.addEventListener('visibilitychange', refreshAfterResume);

  return () => {
    window.clearInterval(intervalId);
    window.removeEventListener('focus', refreshAfterResume);
    window.removeEventListener('online', refreshAfterResume);
    document.removeEventListener('visibilitychange', refreshAfterResume);
  };
}
